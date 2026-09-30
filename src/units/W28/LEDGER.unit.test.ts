// src/units/W28/LEDGER.unit.test.ts
// W28 — the Closure Ledger acceptance tests for the criteria of the frozen work
// order that the W28-B1 units do not already prove: R2 to R6 (LANE-LOG R204,
// the later W28 unit). W1, S1, C1, M1 and D1 are proven by
// `src/units/W28/B1.unit.test.ts` and are not restated here. LG1's one failing
// legacy test (`src/content/consent.test.ts` W28.01) is corrected there as
// STALE, arrangement only.
//
// One `describe('unit:W28.<criterion>')` per criterion, one `it` per leg.
//
// WITNESSES
//   · document 35 §5 row W28 (:430): "Withdraw unsupported Thompson offers
//     across validator/UI/kit … Share zero means no exploration-induced reorder
//     … Document true defaults."
//   · docs/kit/02-api-reference.md:321 (Exploration): "operator exploration/slot
//     summaries, the learning console's exploring panel and the day report's
//     `exploration` row all report effective off while identifying the retained
//     setting (`configuredMode`, `unsupported`), and publish no configured share
//     for it"; "A decision the exploration rule made is recorded as `explored`
//     even where the draw agreed with the ranking's own leader … the recorded
//     candidate support is the slot's top candidates by score before that pick
//     was moved to the front, with the explored piece recorded beside them".
//   · docs/kit/02-api-reference.md:310, :327 — the replay manifest and its
//     compatibility markers; "only a trusted historical replay of an absent
//     policy marker preserves the old seeded sampler"; replay classes.
//   · the W28-B1 build review (`_evidence/W28-B1/reviewer-build/REPORT.md`),
//     findings 1-3 and residuals 1-4, routed here by LANE-LOG R204.
//   · the pre-change engine itself: `a75a300`, the parent of W28-B1's build
//     commits `01606ac`/`3ebbcaf`, whose receipts are the "records written before
//     the change" (W28.R2).
//
// ONE REPRESENTATION with W28-B1 for the logic, host and sdk legs: the same six
// Coach pieces (one of them an unknown-value, cross-category piece), the same
// hero slot and weights, the same fixed `T0`, the same retained Thompson dial.
// W28.R6 needs a catalogue larger than the default candidate limit (ten) to
// observe the recorded support on a stored record, and a cold shopper whose
// ranking is catalogue order; it uses its own page for that and demands nothing
// the six-piece world forbids.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { Hono } from 'hono';
import * as jose from 'jose';

import { bucketOf, effectiveExploration, hourKeyOf, type ExploreConfig } from '@/learn/explore';
import { decideContent } from '@/content/decide';
import { buildReport } from '@/learn/report';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { tenantMiddleware } from '@/tenancy/middleware';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { issueSessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { consumeLedger } from '@/ledger/consume';
import { configuredDestinations } from '@/connectors/config';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { liftArchiveKey, liftKey } from '@/learn/fan';
import { recoveryDigest } from '@/ledger/recovery';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
import { replayDecision, replayDeps } from '@/learn/replay';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { DEFAULT_POLICY } from '@/learn/policy';
import type { Env } from '@/types/env';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotCatalog, SlotStrategy } from '@/content/types';

// ---------------------------------------------------------------------------
// The customer's fixture — W28-B1's (docs/architecture/tapestry_requirements.txt
// A.3.6 / :564 occasion_tags; the Coach lines and categories).
// ---------------------------------------------------------------------------

const TENANT = 'coach';
/** W28-B1's pinned decision time, so every bucket in the six-piece world is a constant. */
const T0 = Date.parse('2026-09-19T12:00:00.000Z');
const HOUR_KEY = hourKeyOf(T0);
const DAY_MS = 86_400_000;

const piece = (id: string, tags: Record<string, string[]>, slotTypes = ['hero']): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial', title: id,
  tags, slotTypes, lifecycle: { status: 'live' },
});

const PIECES: ContentPiece[] = [
  piece('cnt-evening-tabby', { occasion: ['evening'], line: ['Tabby'], category: ['Handbags'], contentType: ['editorial'] }),
  piece('cnt-solo-evening', { occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] }),
  piece('cnt-weekend-tabby', { occasion: ['weekend'], line: ['Tabby'], category: ['Handbags'], contentType: ['editorial'] }),
  piece('cnt-weekend', { occasion: ['weekend'], category: ['Handbags'], contentType: ['editorial'] }),
  piece('cnt-rogue', { line: ['Rogue'], category: ['Handbags'], contentType: ['editorial'] }),
  // An occasion and a line this shopper's affinity has never seen, in a category the slot does not weigh.
  piece('cnt-unknown', { occasion: ['special-event'], line: ['Willow'], category: ['Footwear'], contentType: ['video'] }),
];
const AFFINITY = { dims: { occasion: { evening: 0.8, weekend: 0.4 }, line: { Tabby: 0.6, Rogue: 0.2 } } };
const HERO: SlotStrategy = { slot: 'hero', take: 1, weights: { occasion: 0.5, line: 0.25 } };
const HOLDOUT_NONE = { share: 0, salt: '', arms: ['default'] };

/** A lift snapshot carrying only what exploration reads: the root observation count (W28-B1's). */
const snapshotOf = (observations: Record<string, number>): LiftSnapshot => ({
  tenant: TENANT, brand: TENANT, slot: 'hero', reward: 'click', version: 11, publishedAt: T0, events: 2000,
  n0: DEFAULT_STATS.n0, nMin: DEFAULT_STATS.nMin, liftMin: DEFAULT_STATS.liftMin, liftMax: DEFAULT_STATS.liftMax,
  tauLearnMs: DEFAULT_STATS.tauLearnMs,
  items: Object.fromEntries(Object.entries(observations).map(([id, n]) => [id,
    { '*': { level: 0 as const, key: '*', n, s: 0, p0: 0.1, p_hat: 0.1, lift: 1 } }])),
  slotRates: { '*': { n: 2000, s: 200, rate: 0.1 } },
});
const WELL_OBSERVED = snapshotOf(Object.fromEntries(PIECES.map(p => [p.id, 500])));
const LEADER_UNDER_FLOOR = snapshotOf(Object.fromEntries(PIECES.map(p => [p.id, p.id === 'cnt-evening-tabby' ? 4 : 500])));
const TAIL_UNDER_FLOOR = snapshotOf(Object.fromEntries(PIECES.map(p => [p.id, p.id === 'cnt-unknown' ? 4 : 500])));
const TWO_UNDER_FLOOR = snapshotOf({ ...Object.fromEntries(PIECES.map(p => [p.id, 500])), 'cnt-unknown': 2, 'cnt-rogue': 7 });

const bucketAt = (visitorId: string, slot = 'hero', hourKey = HOUR_KEY) => Math.round(bucketOf(visitorId, slot, hourKey) * 1000) / 1000;
const SHOPPERS = Array.from({ length: 400 }, (_, i) => `shopper-${i}`);
/** W28-B1's two visitors: inside a half share, and one whose uniform epsilon draw lands on the leader. Both are `shopper-4`. */
const INSIDE = SHOPPERS.find(v => bucketAt(v) < 0.5)!;
const UNIFORM_LEADER = SHOPPERS.find(v => Math.floor(bucketAt(v) * PIECES.length) % PIECES.length === 0 && bucketAt(v) < 1)!;

const repoFile = (relative: string) => readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8');

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) {
    const v = this.data.get(key);
    return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) as unknown : v;
  }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort();
    const start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string, options?: R2GetOptions) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    const bytes = new TextEncoder().encode(raw), range = options?.range;
    const selected = range && 'length' in range ? bytes.slice(0, range.length ?? bytes.length) : bytes;
    return { key, etag: 'v' + this.versions.get(key), size: bytes.length, customMetadata: this.metadata.get(key),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(selected); c.close(); } }),
      text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if ((absent && old !== null) || (match != null && match !== old && match !== JSON.stringify(old))) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort();
    const start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: (this.objects.get(key) ?? '').length, uploaded: new Date(0) })),
      truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const fixturePolicy: RetentionPolicy = { id: 'w28-ledger-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const allCategories = () => ({ [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(c => [c, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy> });

// ===========================================================================
// unit:W28.R2 — records written before the change replay under the rules they
// were written with: the compatibility is explicit.
//
// W28-B1 changed three things a replay reproduces (the build diff, 01606ac):
// a rotation or epsilon draw that agrees with the ranking's leader is now an
// exploration (`explored`, `explain.exploration`); the recorded support is the
// pre-reorder top-by-score with the explored piece beside it; a `reject`ed or
// `freeze`d piece is no longer chosen by exploration. Its replay reads the
// same `inputs.replay` a pre-change receipt carries, so today every such
// receipt replays against the NEW rules: `explanation`, `candidates-only` —
// and, for a pre-change pick of a controlled piece, `item`, which the build
// review's "never `item`" (R204) missed. LANE-LOG R204 and the build review
// name the remedy: a versioned replay marker (the `pins`, `contentTypes`,
// `governance` precedent, kit 02:310), so each receipt replays under its own.
//
// THE FIXTURE is the receipt itself: the five records below are exactly what
// the pre-change engine (`a75a300`) wrote for W28-B1's world, measured by
// running that engine's own sources on these inputs; the four current-engine
// counterparts are decided here. NOTHING HERE NAMES THE MARKER: whatever the
// build records on a new receipt, the pre-change receipt carries what it
// carries (below, verbatim) and both must replay equal.
//
// CONSTRAINTS for the build, measured (existing assertions that lock the
// manifest as it is today): `src/units/W27/B1.unit.test.ts:562-567` and
// `src/content/consent.test.ts:562` (legacy W27.02) compare a new record's
// `inputs.replay` EXACTLY with today's members; `src/content/consent.test.ts:524`
// (legacy W28.01, LG1) requires a new record's `inputs.replay.exploration` to be
// `'supported-only'`; `src/units/W27/B1.unit.test.ts:724` refuses the value
// `'supported-only-v2'`. A marker inside `inputs.replay` breaks the first two.
//
// THE EDITED RECEIPT (spec review 2026-09-24, W28 defect 1): replaying both
// receipts equal is also what a replay does that tries the new rules and falls
// back to the old ones on any mismatch — no marker anywhere, the rules chosen
// by whichever one the decision happens to match. The second leg closes that:
// each leader-agreement receipt the pre-change engine wrote, edited to carry
// the decision the CHANGED rules make for the same page load — `explored: true`
// and its `explain.exploration` — and nothing else. Measured premise: the
// edited receipt states the current engine's decision in every decision field
// a replay compares (the pre-change and current receipts differ in exactly
// those two members), so a replay that picks its rules by what the decision
// matches replays it equal. A receipt carries the rules it was written under
// only if something on it SAYS so; the edited receipt is a pre-change record,
// written before any such statement existed, so it must not replay equal. Its
// `explain.exploration` holds only the members the pre-change record format
// declares (`mode`, `reason`, `bucket`, `sample`: `a75a300`
// `src/content/types.ts:444`), so wherever the build records its marker —
// outside `inputs.replay` under the pending amendment A20, or anywhere else —
// the edited receipt never borrows it from the current one. How the replay
// answers it (the old rules' decision, or a refusal) is not ruled; that it
// does not answer `equal` is.
// ===========================================================================

type Scenario = { name: string; record: string; visitor: string; limit: number; snapshot: LiftSnapshot; exploration: ExploreConfig;
  controls?: Record<string, { mode: 'reject' }>; historical?: boolean };

/** The receipts the pre-change engine (`a75a300`) wrote, verbatim. */
const PRE_CHANGE: Record<string, DecisionRecord> = {
  rotationLeader: {"decision_id": "coach:mu8c51c0:shopper-4:home:hero:0", "tenant": "coach", "brand": "coach", "visitor_id": "shopper-4", "session_id": "shopper-4", "identity_anchor": "visitor", "ts": 1789819200000, "page": "home", "slot": "hero", "position": 0, "item_id": "cnt-evening-tabby", "customer_item_id": "CMS-EVENING-TABBY", "ranking_position": 0, "candidates": [{"contentId": "cnt-evening-tabby", "score": 0.55}, {"contentId": "cnt-solo-evening", "score": 0.4}, {"contentId": "cnt-weekend-tabby", "score": 0.35}, {"contentId": "cnt-weekend", "score": 0.2}, {"contentId": "cnt-rogue", "score": 0.05}, {"contentId": "cnt-unknown", "score": 0}], "cell": {"channel": "direct", "visit_bucket": "1", "region": "US-NY", "affinity": "occasion:evening"}, "arm": "personalized", "explored": false, "authority": "engine", "versions": {"config": 1, "catalog": 1, "slots": 1, "learn": 1, "lift": 11, "prior": 0, "policy": 1}, "config_label": "w28-ledger", "explain": {"drivers": [{"dim": "occasion", "value": "evening", "a": 0.8, "weight": 0.5}, {"dim": "line", "value": "Tabby", "a": 0.6, "weight": 0.25}], "score_base": 0.55, "lift": null, "score_final": 0.55}, "inputs": {"affinity": {"occasion": {"evening": 0.8, "weekend": 0.4}, "line": {"Tabby": 0.6, "Rogue": 0.2}}, "replay": {"version": 1, "learning": true, "candidateLimit": 6, "exploration": "supported-only", "pins": "prefix-reserved-v2", "contentTypes": "catalog-tags-v1", "governance": "slot-gates-v2", "slots": [{"slot": "hero", "lift": 11, "prior": 0}]}}},
  epsilonLeader: {"decision_id": "coach:mu8c51c0:shopper-4:home:hero:0", "tenant": "coach", "brand": "coach", "visitor_id": "shopper-4", "session_id": "shopper-4", "identity_anchor": "visitor", "ts": 1789819200000, "page": "home", "slot": "hero", "position": 0, "item_id": "cnt-evening-tabby", "customer_item_id": "CMS-EVENING-TABBY", "ranking_position": 0, "candidates": [{"contentId": "cnt-evening-tabby", "score": 0.55}, {"contentId": "cnt-solo-evening", "score": 0.4}, {"contentId": "cnt-weekend-tabby", "score": 0.35}, {"contentId": "cnt-weekend", "score": 0.2}, {"contentId": "cnt-rogue", "score": 0.05}, {"contentId": "cnt-unknown", "score": 0}], "cell": {"channel": "direct", "visit_bucket": "1", "region": "US-NY", "affinity": "occasion:evening"}, "arm": "personalized", "explored": false, "authority": "engine", "versions": {"config": 1, "catalog": 1, "slots": 1, "learn": 1, "lift": 11, "prior": 0, "policy": 1}, "config_label": "w28-ledger", "explain": {"drivers": [{"dim": "occasion", "value": "evening", "a": 0.8, "weight": 0.5}, {"dim": "line", "value": "Tabby", "a": 0.6, "weight": 0.25}], "score_base": 0.55, "lift": {"reward": "click", "objective": "unit", "measurementBasis": "served-v1", "level": 0, "level_words": "everyone", "n": 500, "s": 0, "p0": 0.1, "n0": 30, "p_hat": 0.1, "lift": 1, "gamma": 0, "applied": 0}, "score_final": 0.55}, "inputs": {"affinity": {"occasion": {"evening": 0.8, "weekend": 0.4}, "line": {"Tabby": 0.6, "Rogue": 0.2}}, "replay": {"version": 1, "learning": true, "candidateLimit": 6, "exploration": "supported-only", "pins": "prefix-reserved-v2", "contentTypes": "catalog-tags-v1", "governance": "slot-gates-v2", "slots": [{"slot": "hero", "lift": 11, "prior": 0}]}}},
  truncatedSupport: {"decision_id": "coach:mu8c51c0:shopper-4:home:hero:0", "tenant": "coach", "brand": "coach", "visitor_id": "shopper-4", "session_id": "shopper-4", "identity_anchor": "visitor", "ts": 1789819200000, "page": "home", "slot": "hero", "position": 0, "item_id": "cnt-unknown", "customer_item_id": "CMS-UNKNOWN", "ranking_position": 0, "candidates": [{"contentId": "cnt-unknown", "score": 0}, {"contentId": "cnt-evening-tabby", "score": 0.55}, {"contentId": "cnt-solo-evening", "score": 0.4}], "cell": {"channel": "direct", "visit_bucket": "1", "region": "US-NY", "affinity": "occasion:evening"}, "arm": "personalized", "explored": true, "authority": "default", "versions": {"config": 1, "catalog": 1, "slots": 1, "learn": 1, "lift": 11, "prior": 0, "policy": 1}, "config_label": "w28-ledger", "explain": {"drivers": [], "note": "no signal yet — the slot default (catalogue order)", "score_base": 0, "lift": null, "score_final": 0, "exploration": {"mode": "rotation", "reason": "bucket 0.015 < share 0.5: under-observed, n 4 < floor 50", "bucket": 0.015}}, "inputs": {"affinity": {"occasion": {"evening": 0.8, "weekend": 0.4}, "line": {"Tabby": 0.6, "Rogue": 0.2}}, "replay": {"version": 1, "learning": true, "candidateLimit": 3, "exploration": "supported-only", "pins": "prefix-reserved-v2", "contentTypes": "catalog-tags-v1", "governance": "slot-gates-v2", "slots": [{"slot": "hero", "lift": 11, "prior": 0}]}}},
  controlledPick: {"decision_id": "coach:mu8c51c0:shopper-4:home:hero:0", "tenant": "coach", "brand": "coach", "visitor_id": "shopper-4", "session_id": "shopper-4", "identity_anchor": "visitor", "ts": 1789819200000, "page": "home", "slot": "hero", "position": 0, "item_id": "cnt-unknown", "customer_item_id": "CMS-UNKNOWN", "ranking_position": 0, "candidates": [{"contentId": "cnt-unknown", "score": 0}, {"contentId": "cnt-evening-tabby", "score": 0.55}, {"contentId": "cnt-solo-evening", "score": 0.4}, {"contentId": "cnt-weekend-tabby", "score": 0.35}, {"contentId": "cnt-weekend", "score": 0.2}, {"contentId": "cnt-rogue", "score": 0.05}], "cell": {"channel": "direct", "visit_bucket": "1", "region": "US-NY", "affinity": "occasion:evening"}, "arm": "personalized", "explored": true, "authority": "default", "versions": {"config": 1, "catalog": 1, "slots": 1, "learn": 1, "lift": 11, "prior": 0, "policy": 1}, "config_label": "w28-ledger", "explain": {"drivers": [], "note": "no signal yet — the slot default (catalogue order)", "score_base": 0, "lift": null, "score_final": 0, "exploration": {"mode": "rotation", "reason": "bucket 0.015 < share 0.5: under-observed, n 2 < floor 50", "bucket": 0.015}, "control": "reject"}, "inputs": {"affinity": {"occasion": {"evening": 0.8, "weekend": 0.4}, "line": {"Tabby": 0.6, "Rogue": 0.2}}, "replay": {"version": 1, "learning": true, "candidateLimit": 6, "exploration": "supported-only", "pins": "prefix-reserved-v2", "contentTypes": "catalog-tags-v1", "governance": "slot-gates-v2", "slots": [{"slot": "hero", "lift": 11, "prior": 0}]}}},
  preMarkerLeader: {"decision_id": "coach:mu8c51c0:shopper-4:home:hero:0", "tenant": "coach", "brand": "coach", "visitor_id": "shopper-4", "session_id": "shopper-4", "identity_anchor": "visitor", "ts": 1789819200000, "page": "home", "slot": "hero", "position": 0, "item_id": "cnt-evening-tabby", "customer_item_id": "CMS-EVENING-TABBY", "candidates": [{"contentId": "cnt-evening-tabby", "score": 0.55}, {"contentId": "cnt-solo-evening", "score": 0.4}, {"contentId": "cnt-weekend-tabby", "score": 0.35}, {"contentId": "cnt-weekend", "score": 0.2}, {"contentId": "cnt-rogue", "score": 0.05}, {"contentId": "cnt-unknown", "score": 0}], "cell": {"channel": "direct", "visit_bucket": "1", "region": "US-NY", "affinity": "occasion:evening"}, "arm": "personalized", "explored": false, "authority": "engine", "versions": {"config": 1, "catalog": 1, "slots": 1, "learn": 1, "lift": 11, "prior": 0, "policy": 1}, "config_label": "w28-ledger", "explain": {"drivers": [{"dim": "occasion", "value": "evening", "a": 0.8, "weight": 0.5}, {"dim": "line", "value": "Tabby", "a": 0.6, "weight": 0.25}], "score_base": 0.55, "lift": null, "score_final": 0.55}, "inputs": {"affinity": {"occasion": {"evening": 0.8, "weekend": 0.4}, "line": {"Tabby": 0.6, "Rogue": 0.2}}, "replay": {"version": 1, "learning": true, "candidateLimit": 6, "slots": [{"slot": "hero", "lift": 11, "prior": 0}]}}},
} as unknown as Record<string, DecisionRecord>;

const SCENARIOS: Scenario[] = [
  { name: 'a rotation draw that agreed with the leader', record: 'rotationLeader', visitor: INSIDE, limit: 6, snapshot: LEADER_UNDER_FLOOR,
    exploration: { mode: 'rotation', share: 0.5, floor: 50 } },
  { name: 'an epsilon draw that agreed with the leader', record: 'epsilonLeader', visitor: UNIFORM_LEADER, limit: 6, snapshot: WELL_OBSERVED,
    exploration: { mode: 'epsilon', share: 1, floor: 50 } },
  { name: 'a rotation pick past a candidate limit of three', record: 'truncatedSupport', visitor: INSIDE, limit: 3, snapshot: TAIL_UNDER_FLOOR,
    exploration: { mode: 'rotation', share: 0.5, floor: 50 } },
  { name: 'a rotation pick of a piece the merchandiser rejected', record: 'controlledPick', visitor: INSIDE, limit: 6, snapshot: TWO_UNDER_FLOOR,
    exploration: { mode: 'rotation', share: 0.5, floor: 50 }, controls: { 'cnt-unknown': { mode: 'reject' } } },
  { name: 'a pre-marker receipt whose rotation draw agreed with the leader', record: 'preMarkerLeader', visitor: INSIDE, limit: 6, snapshot: LEADER_UNDER_FLOOR,
    exploration: { mode: 'rotation', share: 0.5, floor: 50 }, historical: true },
];

/** The tenant's documents at revision 1 and the hero archive at version 11, as the replay reads them. */
async function replayWorld(s: Scenario): Promise<Env> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: new UnitKV(), STORAGE: new UnitR2(),
    TENANTS: JSON.stringify({ provisioned: [TENANT] }), RETENTION: JSON.stringify({ version: 1, tenants: allCategories() }),
  } as unknown as Env;
  const learn: LearnConfig = { version: 'w28-ledger-r2', holdout: HOLDOUT_NONE,
    slots: { hero: { gamma: 0, exploration: s.exploration, ...(s.controls ? { items: s.controls } : {}) } } } as LearnConfig;
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w28-ledger-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, { pieces: PIECES }), baseline(SLOTS_KIND, { pages: { home: [HERO] } }), baseline(LEARN_KIND, learn),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
  await (env.STORAGE as unknown as UnitR2).put(liftArchiveKey(TENANT, TENANT, 'hero', 11), JSON.stringify(s.snapshot));
  return env;
}

/** The receipt the CURRENT engine writes for the same page load (W28-B1's seam, with the published documents' identities). */
function currentReceipt(env: Env, s: Scenario): DecisionRecord {
  const set = decideContent({
    tenant: TENANT, brand: TENANT, page: 'home', visitorId: s.visitor, sessionId: s.visitor, identityAnchor: 'visitor', nowMs: T0,
    pieces: PIECES, slots: [HERO], affinity: AFFINITY, cell: { channel: 'direct', visit_bucket: '1', region: 'US-NY', affinity: 'occasion:evening' },
    arm: 'personalized', versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'w28-ledger', candidateLimit: s.limit,
    learning: { snapshots: { hero: s.snapshot }, gammaOf: () => 0, exploreOf: () => s.exploration,
      controlOf: (_slot: string, item: string) => s.controls?.[item] ?? null,
      metadataOf: () => ({ reward: 'click', objective: 'unit', measurementBasis: 'served-v1' }) },
  } as unknown as Parameters<typeof decideContent>[0]);
  const record = set.records[0]!;
  record.retention = captureRetention(env, TENANT, record.ts);
  return record;
}

describe('unit:W28.R2', () => {
  it('logic: a receipt written before the exploration change and one written after it both replay equal, each under its own rules', async () => {
    // The fixture's own premises, measured rather than trusted.
    expect([INSIDE, bucketAt(INSIDE), UNIFORM_LEADER]).toEqual(['shopper-4', 0.015, 'shopper-4']);
    for (const s of SCENARIOS) {
      const env = await replayWorld(s);
      const before = structuredClone(PRE_CHANGE[s.record]!);
      before.retention = captureRetention(env, TENANT, before.ts);

      // LOCK: a receipt the current engine writes replays equal (a pre-marker receipt has no current counterpart).
      if (!s.historical) {
        const after = currentReceipt(env, s);
        const current = await replayDecision(env, after, replayDeps(env));
        expect(current, `${s.name}: the current receipt — ${current.reason ?? JSON.stringify(current.diff)}`)
          .toMatchObject({ ok: true, equal: true, classification: 'equal', diff: [] });
      }

      // RULED: the receipt written before the change replays under the rules it was written with.
      const replay = await replayDecision(env, before, replayDeps(env));
      expect(replay.classification,
        `W28.R2 (${s.name}) — a receipt the pre-change engine wrote must replay equal under the rules it was written with, not as \`${replay.classification}\` on ${JSON.stringify(replay.diff.map(d => d.field))}${replay.reason ? ` (${replay.reason})` : ''}`)
        .toBe('equal');
      expect(replay).toMatchObject({ ok: true, equal: true, diff: [] });
      expect(replay.replayed!.item_id, 'the piece the receipt says was served is the piece the replay serves').toBe(before.item_id);
    }
  });

  it('logic: a receipt written before the change, edited to carry the decision the changed rules make (explored, with its exploration), does not replay equal — a receipt replays under the rules it records, never the rules its decision happens to match', async () => {
    /** The members of `explain.exploration` the pre-change record format declares (`a75a300` `src/content/types.ts:444`). */
    const preChangeExploration = (e: DecisionRecord['explain']['exploration']) => e === undefined ? undefined
      : { mode: e.mode, reason: e.reason, bucket: e.bucket, ...(e.sample !== undefined ? { sample: e.sample } : {}) };
    /** The decision a receipt states, in the fields a replay compares, marker-free. */
    const decisionOf = (r: DecisionRecord) => ({ item_id: r.item_id, ranking_position: r.ranking_position, candidates: r.candidates,
      explored: r.explored, authority: r.authority, exploration: preChangeExploration(r.explain.exploration),
      score_base: r.explain.score_base, score_final: r.explain.score_final, lift: r.explain.lift, drivers: r.explain.drivers });

    for (const s of SCENARIOS.filter(x => x.record === 'rotationLeader' || x.record === 'epsilonLeader')) {
      const env = await replayWorld(s);
      const before = structuredClone(PRE_CHANGE[s.record]!);
      before.retention = captureRetention(env, TENANT, before.ts);
      const after = currentReceipt(env, s);

      // The fixture's premises, measured: the change made this page load an exploration.
      expect({ before: before.explored, after: after.explored, exploration: after.explain.exploration !== undefined },
        `${s.name}: the pre-change engine recorded no exploration and the changed rules record one`)
        .toEqual({ before: false, after: true, exploration: true });

      const edited = structuredClone(before);
      edited.explored = true;
      edited.explain = { ...edited.explain, exploration: preChangeExploration(after.explain.exploration) };
      expect(decisionOf(edited), `${s.name}: the edited receipt states the decision the changed rules make, in every decision field a replay compares`)
        .toEqual(decisionOf(after));

      // RULED: nothing on it says it was written under the changed rules, so it does not replay as if it were.
      const replay = await replayDecision(env, edited, replayDeps(env));
      expect({ equal: replay.equal },
        `W28.R2 (${s.name}) — a pre-change receipt edited to carry the changed rules' decision must not replay equal: which rules a receipt replays under is stated on the receipt (a versioned replay marker, R204), never chosen by whichever rules reproduce its decision. It replayed as \`${replay.classification}\`${replay.diff.length ? ` on ${JSON.stringify(replay.diff.map(d => d.field))}` : ''}${replay.reason ? ` (${replay.reason})` : ''}`)
        .toEqual({ equal: false });
    }
  });
});

// ===========================================================================
// The mounted application for the host and sdk legs: the real routes over real
// Durable Object classes, session host (W28-B1's harness, trimmed).
// ===========================================================================

const OPERATOR_SECRET = 'w28-ledger-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'https://operator.invalid';

interface Mounted {
  env: Env;
  storage: UnitR2;
  fetch: (request: Request) => Promise<Response>;
  drain: () => Promise<void>;
  drainLedger: () => Promise<void>;
  operatorToken: string;
}

function objectState(name: string, pending: Promise<unknown>[]): DurableObjectState {
  const data = new Map<string, unknown>(); const alarms: number[] = [];
  const operations = (target: Map<string, unknown>) => ({
    get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, target.get(v)])) : target.get(k)),
    put: async (k: string | Record<string, unknown>, v?: unknown) => {
      if (typeof k === 'string') target.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) target.set(key, structuredClone(value));
    },
    delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; let n = 0; for (const key of list) if (target.delete(key)) n++; return typeof keys === 'string' ? n > 0 : n; },
    list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
      structuredClone(new Map([...target].filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
        .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit))),
    setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null, deleteAlarm: async () => { alarms.length = 0; },
  });
  return { id: name, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => pending.push(p), storage: {
    ...operations(data), deleteAll: async () => data.clear(),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const candidate = structuredClone(data), result = await run(operations(candidate));
      data.clear(); for (const [key, value] of candidate) data.set(key, value); return result;
    },
  } } as unknown as DurableObjectState;
}

/**
 * The application, in process. `recovery` mounts the durable rendered-admission
 * path the way `src/routes/realtime.sdkContract.test.ts` (W15) and
 * `src/units/W21/B2.unit.test.ts` (W21.E1.08) configure it: the recovery
 * retention categories, the switch, and the real ring and statistics objects.
 */
async function mount(host: 'session' | 'do' = 'session', options: { recovery?: boolean } = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const queued: unknown[] = [];
  const storage = new UnitR2();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: new UnitKV(), SESSIONS: new UnitKV(), STORAGE: storage,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w28-ledger-proof`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    RETENTION: JSON.stringify({ version: 1, tenants: allCategories() }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); }, sendBatch: async (messages: Array<{ body: unknown }>) => { for (const m of messages) queued.push(m.body); } },
  } as unknown as Env;
  try {
    const policies = allCategories();
    for (const destination of await configuredDestinations(env, TENANT, () => { /* no destination diagnostics */ })) policies[TENANT]![destination.category] = fixturePolicy;
    env.RETENTION = JSON.stringify({ version: 1, tenants: policies });
  } catch { /* a malformed registry still reaches the production refusal */ }
  if (options.recovery) env.LEDGER_RECOVERY_ENABLED = 'true';
  const namespaceFor = <T extends { fetch: (request: Request) => Response | Promise<Response> }>(make: (state: DurableObjectState, env: Env) => T) => {
    const registry = new Map<string, T>();
    return { idFromName: (n: string) => n, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let held = registry.get(name);
      // The object's id is its name, as `idFromName` answers it: ShopperReflex checks that it is the object it was asked for.
      if (!held) { held = make(objectState(name, pending), env); registry.set(name, held); }
      return await held.fetch(new Request(input, init));
    } }) };
  };
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e)) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e)) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e)) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));
  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env,
    { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 20)); };
  const drainLedger = async () => {
    await drain();
    if (!queued.length) return;
    const result = await consumeLedger(env, queued.splice(0));
    expect(result.error, 'the fixture ledger batch must be written by the real consumer').toBeUndefined();
  };
  return { env, storage, fetch: fetchOne, drain, drainLedger, operatorToken };
}

/**
 * The tenant's documents at revision 1. A learn document that names the withdrawn
 * mode can no longer be written (`src/content/kinds.ts:561`); it exists only as a
 * RETAINED revision, adopted as reviewed historical bytes (W11 `retainedValue`,
 * the way `src/content/consent.test.ts`'s W28.01 publishes it).
 */
async function publishDocuments(m: Mounted, documents: { pieces: ContentPiece[]; slots: SlotCatalog; learn: LearnConfig; retainedLearn?: boolean }): Promise<void> {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w28-ledger-fixture', note: 'fixture', value } });
  await initializePublicationSet(m.env, [
    baseline(CONTENT_KIND, { pieces: documents.pieces }), baseline(SLOTS_KIND, documents.slots),
    { ...baseline(LEARN_KIND, documents.learn), ...(documents.retainedLearn ? { retainedValue: true as const } : {}) },
    baseline(REFLEX_KIND, { ...DEFAULT_REFLEX_CONFIG, version: 'w28-ledger-coach-registry' }, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
}

/** W28-B1's `publishLift`: the hero snapshot where the engine reads it, its witness answered from its own digest. */
async function publishLift(m: Mounted, snapshot: LiftSnapshot): Promise<void> {
  const witnessed: LiftSnapshot = { ...snapshot, witness: 'b1'.repeat(32) };
  await m.env.CACHE.put(liftKey(TENANT, TENANT, 'hero'), JSON.stringify(witnessed));
  const digest = await recoveryDigest(witnessed);
  m.env.LEARN_STATS = { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({
    ok: true, state: 'healthy', tenant: TENANT, brand: TENANT, slot: 'hero', witness: witnessed.witness,
    publication: { witness: witnessed.witness, digest, version: witnessed.version },
  }) }) } as unknown as DurableObjectNamespace;
  invalidateLiftCache();
}

const operatorGet = async (m: Mounted, path: string) => {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, { headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT } }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
};

type SlotRow = { slot: string; exploration: string; configuredExploration?: string } & Record<string, unknown>;
const slotRows = (body: Record<string, unknown>): SlotRow[] =>
  ((body.pages ?? []) as Array<{ slots: SlotRow[] }>).flatMap(page => page.slots);

// The dials the host legs publish, one slot each, on one page: a retained
// Thompson dial, a supported rotation dial, an `off` dial that kept its share, and
// a slot with no exploration block at all.
const RETAINED_THOMPSON: ExploreConfig = { mode: 'thompson', share: 0.1, floor: 50 };
const DIAL_PAGE: SlotCatalog = { version: 'w28-ledger-dials', pages: { home: [
  { slot: 'hero', take: 1, weights: { occasion: 0.5, line: 0.25 } },
  { slot: 'rail', take: 1, weights: { line: 0.25 } },
  { slot: 'strip', take: 1, weights: { occasion: 0.25 } },
  { slot: 'story', take: 1, weights: { occasion: 0.5 } },
] } } as SlotCatalog;
const DIAL_PIECES = PIECES.map(p => ({ ...p, slotTypes: ['hero', 'rail', 'strip', 'story'] }));
const DIALS: LearnConfig = { version: 'w28-ledger-dials', holdout: HOLDOUT_NONE, slots: {
  hero: { gamma: 0, exploration: RETAINED_THOMPSON },
  rail: { gamma: 0, exploration: { mode: 'rotation', share: 0.1, floor: 50 } },
  // An operator switched exploration off and left the share she had.
  strip: { gamma: 0, exploration: { mode: 'off', share: 0.3, floor: 50 } },
  story: { gamma: 0 },
} } as unknown as LearnConfig;

// ===========================================================================
// unit:W28.R3 — the operator slots summary reads its second word,
// `configuredExploration`, consistently with the canonical words.
//
// `src/learn/rows.ts:252-253` states the retained setting of a slot with its own
// word and its own rule — `configuredExploration`, set where `mode ===
// 'thompson'` — while the day report row, the folded row and `GET
// learn/exploring` all state it through `effectiveExploration`
// (`src/learn/explore.ts:64`) as `configuredMode` and `unsupported` (W28-B1
// build review, finding 1: "a second word and a second rule for the fact W1.01
// canonicalized"; R167(7) named `configuredMode`/`unsupported` canonical). The
// kit is explicit that the SLOT summaries use the canonical words:
// "operator exploration/slot summaries … report effective off while
// identifying the retained setting (`configuredMode`, `unsupported`)" (02:321).
// The second word stays and reads the same: the frozen legacy W28.01
// (`src/learn/phase2.test.ts:177`, this ticket's LG1) reads
// `configuredExploration: 'thompson'` on this row.
//
// NOT RULED: a retained mode other than Thompson. `validateRetainedLearn`
// (`src/content/kinds.ts:560`) admits only rotation|thompson|epsilon|off, so no
// stored document reaches this row with any other mode, and the two rules
// cannot be told apart by any value a customer can hold.
// ===========================================================================

describe('unit:W28.R3', () => {
  it('host: the slots summary identifies each retained setting in the words the exploring answer uses, and its second word reads the same', async () => {
    const m = await mount();
    await publishDocuments(m, { pieces: DIAL_PIECES, slots: DIAL_PAGE, learn: DIALS, retainedLearn: true });
    const slots = await operatorGet(m, `/v1/${TENANT}/learn/slots`);
    expect(slots.status, JSON.stringify(slots.body).slice(0, 300)).toBe(200);
    const rows = slotRows(slots.body);
    expect(rows.map(row => row.slot)).toEqual(['hero', 'rail', 'strip', 'story']);

    for (const slot of ['rail', 'strip', 'story', 'hero']) {
      const exploring = await operatorGet(m, `/v1/${TENANT}/learn/exploring?slot=${slot}`);
      expect(exploring.status).toBe(200);
      const row = rows.find(r => r.slot === slot)!;
      // The canonical statement: the one helper, and the answer that already uses it.
      const canonical = effectiveExploration(DIALS.slots![slot]!.exploration);
      const said = { mode: exploring.body.mode, configuredMode: exploring.body.configuredMode, unsupported: exploring.body.unsupported };
      expect(said, `${slot}: learn/exploring states the canonical words`)
        .toEqual({ mode: canonical.mode ?? 'off', configuredMode: canonical.configuredMode, unsupported: canonical.unsupported });
      expect({ exploration: row.exploration, configuredMode: row.configuredMode, unsupported: row.unsupported },
        `W28.R3 (${slot}) — kit 02:321: the slot summary identifies the retained setting as \`configuredMode\`/\`unsupported\`, the words learn/exploring and the day report use (${JSON.stringify(DIALS.slots![slot]!.exploration ?? null)})`)
        .toEqual({ exploration: said.mode, configuredMode: said.configuredMode, unsupported: said.unsupported });
      expect(row.configuredExploration, `${slot}: the second word reads the same setting (phase2.test.ts:177 keeps it)`).toBe(said.configuredMode);
    }
  });
});

// ===========================================================================
// unit:W28.R4 — the share `GET learn/exploring` publishes for a supported `off`
// document agrees with the report row's `configured: null`.
//
// `src/routes/decisions.ts:310-311` publishes `share: ex?.share ?? 0` whenever
// the mode is supported, so an `off` dial that still stores a share answers
// `mode: 'off', share: 0.3` while the day report's row for the same dial says
// `configured: null` (`effectiveExploration`: "The share a policy that can
// actually run reserves; null when nothing can run"; W28-B1 build review,
// finding 2). The kit: surfaces "publish no configured share" for a dial that
// cannot explore. The value is the one this answer already publishes for the
// two other dials the report reads as `configured: null` — a retained Thompson
// dial (`src/learn/phase2.test.ts:176`, `share: 0`) and a document with no
// exploration block (`src/units/W28/B1.unit.test.ts:633`, `share: 0`) — so
// one fact reads one way on this answer.
// ===========================================================================

describe('unit:W28.R4', () => {
  it('logic: the day report row for an off dial that keeps a stored share publishes no configured share', () => {
    const records = SHOPPERS.slice(0, 4).flatMap(v => decideContent({
      tenant: TENANT, brand: TENANT, page: 'home', visitorId: v, sessionId: v, identityAnchor: 'visitor', nowMs: T0,
      pieces: PIECES, slots: [HERO], affinity: AFFINITY, cell: { channel: 'direct', visit_bucket: '1', region: 'US-NY', affinity: 'occasion:evening' },
      arm: 'personalized', versions: { config: 1, lift: 11, prior: 0, policy: 0 }, configLabel: 'w28-ledger',
      learning: { snapshots: { hero: WELL_OBSERVED }, gammaOf: () => 0, exploreOf: () => ({ mode: 'off', share: 0.3, floor: 50 }) },
    } as unknown as Parameters<typeof decideContent>[0]).records);
    const learn = { version: 'off-with-share', holdout: HOLDOUT_NONE, slots: { hero: { gamma: 0, exploration: { mode: 'off', share: 0.3, floor: 50 } } } } as LearnConfig;
    const report = buildReport({ tenant: TENANT, brand: TENANT, date: '2026-09-19', learning: { name: 'learning', ...DEFAULT_POLICY },
      reporting: [], learn, decisions: records, outcomes: [], now: T0 + 3 * 3_600_000, truncated: false });
    expect(report.exploration.find(row => row.slot === 'hero')).toMatchObject({ mode: 'off', configured: null });
    expect(effectiveExploration({ mode: 'off', share: 0.3, floor: 50 })).toEqual({ mode: 'off', configured: null });
  });

  it('host: learn/exploring answers an off dial that keeps a stored share with the share it answers for every dial that cannot explore', async () => {
    const m = await mount();
    await publishDocuments(m, { pieces: DIAL_PIECES, slots: DIAL_PAGE, learn: DIALS, retainedLearn: true });
    // The two dials whose zero share is already locked, read on this same answer.
    const retained = await operatorGet(m, `/v1/${TENANT}/learn/exploring?slot=hero`);
    expect(retained.body).toMatchObject({ mode: 'off', share: 0, configuredMode: 'thompson', unsupported: true });
    const off = await operatorGet(m, `/v1/${TENANT}/learn/exploring?slot=strip`);
    expect(off.status).toBe(200);
    expect(off.body.mode).toBe('off');
    expect(off.body.share,
      'W28.R4 — an off dial reserves no share (the report row says `configured: null`); the exploring answer must not publish the stored 0.3 as the slot\'s share')
      .toBe(0);
    // A supported mode keeps its configured share, unqualified.
    const rotation = await operatorGet(m, `/v1/${TENANT}/learn/exploring?slot=rail`);
    expect(rotation.body).toMatchObject({ mode: 'rotation', share: 0.1 });
  });
});

// ===========================================================================
// unit:W28.R5 — the operator console names the retained exploration setting.
//
// The modern console (`public/console/`) shows the effective mode but does not
// name the retained setting on any surface that reports exploration: the
// Exploring view (`views-explore.js:52-54`), the slots table (`views.js:303`)
// and the day's exploration line (`views-measure.js:207-210`) (W28-B1 build
// review, residual 3; LANE-LOG R204). The kit says every such surface
// identifies the retained setting. THE WORDS are the console's own: its editor
// already writes "Stored Thompson — inactive" for this dial (`views.js:417`),
// and W28.W1.01 held the legacy console to the same words so the pages agree.
//
// The console runs its own shipped scripts under jsdom; its requests to
// `/v1/...` are answered by the REAL routes of a mounted application holding
// the retained document, and the day report by the real `buildReport` over
// records the retained document served (the route reads a stored report).
//
// OUTSIDE THE WORK ORDER'S allowedPaths: the slots-table leg needs
// `public/console/views.js`, which W28's allowedPaths does not list; it is
// written, and named in the report for the owner's amendment.
// ===========================================================================

const pub = (relative: string) => repoFile(`public/${relative}`);
type El = { value: string; textContent: string | null; click: () => void; dispatchEvent: (e: unknown) => boolean };

async function openConsole(m: Mounted, report: Record<string, unknown>, hash: string) {
  const bridge = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const u = new URL(url, 'http://console.test');
    const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
    if (u.pathname === '/auth/login' || u.pathname === '/auth/refresh') {
      const token = 'h.' + Buffer.from(JSON.stringify({ sub: 'ops-1', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url') + '.s';
      return reply({ accessToken: token, refreshToken: 'r', user: { id: 'ops-1', email: 'ops@brand.test', name: 'Test Operator', roles: ['admin'] }, mustChangePassword: false, expiresIn: 900 });
    }
    if (u.pathname === '/auth/authority') return reply({ customer: false, stampOwner: true });
    if (u.pathname === `/v1/${TENANT}/learn/report`) return reply({ ok: true, report: { ...report, tenant: TENANT, brand: TENANT, date: u.searchParams.get('date') },
      page: { slot: u.searchParams.get('slot'), revision: 'a'.repeat(64), total: 0, offset: 0, limit: 50, next: null, previous: null } });
    if (u.pathname.startsWith(`/v1/${TENANT}/`)) {
      // The platform's own answer: the console's request, reaching the real route with the operator's credential.
      const response = await m.fetch(new Request(OPERATOR_ORIGIN + u.pathname + u.search, { method: init?.method ?? 'GET',
        headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT }, ...(init?.body ? { body: init.body } : {}) }));
      return reply(await response.json().catch(() => ({})), response.status);
    }
    return reply({ ok: false, error: `unstubbed ${u.pathname}` }, 404);
  };
  const dom = new JSDOM(pub('console/index.html'), { url: `http://console.test/console/${hash}`, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as unknown as Record<string, unknown> & { document: { getElementById: (id: string) => unknown; body: { textContent: string | null } };
    eval: (s: string) => unknown; close: () => void; location: { hash: string } };
  w.fetch = bridge; w.Headers = Headers; w.TextEncoder = TextEncoder; w.confirm = () => true;
  w.setInterval = () => 0;
  w.eval(pub('operator-session.js'));
  for (const script of ['shell', 'views', 'views-config', 'views-measure', 'views-accounts', 'views-explore']) w.eval(pub(`console/${script}.js`));
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 15)); };
  await settle();
  const $ = (id: string) => w.document.getElementById(id) as unknown as El;
  $('sign-in').click(); await settle();
  $('si-email').value = 'ops@brand.test'; $('si-password').value = 'right-password';
  $('sign-in-form').dispatchEvent(new (w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
  await settle(); await settle();
  const goTo = async (h: string) => { w.location.hash = h; await settle(); await settle(); };
  return { goTo, view: () => ($('view').textContent ?? '').replace(/\s+/g, ' ').trim(), close: () => w.close() };
}

describe('unit:W28.R5', () => {
  const RETAINED: LearnConfig = { version: 'retained-thompson', holdout: HOLDOUT_NONE, slots: { hero: { gamma: 0, exploration: RETAINED_THOMPSON } } } as LearnConfig;
  /** W28.W1.01's ruled row, produced by the real report over what the retained document served. */
  const retainedReport = () => {
    const records = SHOPPERS.slice(0, 8).flatMap(v => decideContent({
      tenant: TENANT, brand: TENANT, page: 'home', visitorId: v, sessionId: v, identityAnchor: 'visitor', nowMs: T0,
      pieces: PIECES, slots: [HERO], affinity: AFFINITY, cell: { channel: 'direct', visit_bucket: '1', region: 'US-NY', affinity: 'occasion:evening' },
      arm: 'personalized', versions: { config: 1, lift: 11, prior: 0, policy: 0 }, configLabel: 'w28-ledger',
      learning: { snapshots: { hero: WELL_OBSERVED }, gammaOf: () => 0, exploreOf: () => RETAINED_THOMPSON },
    } as unknown as Parameters<typeof decideContent>[0]).records);
    const report = buildReport({ tenant: TENANT, brand: TENANT, date: '2026-09-19', learning: { name: 'learning', ...DEFAULT_POLICY },
      reporting: [], learn: RETAINED, decisions: records, outcomes: [], now: T0 + 3 * 3_600_000, truncated: false });
    expect(report.exploration.find(row => row.slot === 'hero')).toMatchObject({ mode: 'off', configured: null, configuredMode: 'thompson', unsupported: true });
    return JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
  };
  const retainedApp = async () => {
    const m = await mount();
    await publishDocuments(m, { pieces: PIECES, slots: { version: 'w28-ledger-hero', pages: { home: [HERO] } } as SlotCatalog, learn: RETAINED, retainedLearn: true });
    await publishLift(m, WELL_OBSERVED);
    return m;
  };

  it('sdk: the Exploring view says exploration is off and names the stored Thompson setting as inactive', async () => {
    const m = await retainedApp();
    const c = await openConsole(m, retainedReport(), '#/exploring?scope=coach&slot=hero');
    try {
      const view = c.view();
      expect(view, 'the view states the mode the engine runs (views-explore.js:53)').toContain('Exploration is off on this slot');
      expect(view, 'W28.R5 — the Exploring view names the retained setting in the words the console\'s own editor uses').toContain('Stored Thompson — inactive');
    } finally { c.close(); }
  }, 60_000);

  it('sdk: the day\'s exploration line names the stored Thompson setting as inactive', async () => {
    const m = await retainedApp();
    const c = await openConsole(m, retainedReport(), '#/measure?scope=coach&slot=hero');
    try {
      const view = c.view();
      expect(view, 'the day\'s exploration line is on the page (views-measure.js:210)').toContain('with exploration off');
      expect(view, 'W28.R5 — the exploration line names the retained setting the report row carries (configuredMode, unsupported)').toContain('Stored Thompson — inactive');
    } finally { c.close(); }
  }, 60_000);

  it('sdk: the slots table names the stored Thompson setting as inactive beside the effective mode', async () => {
    const m = await retainedApp();
    const c = await openConsole(m, retainedReport(), '#/slots?scope=coach');
    try {
      const view = c.view();
      expect(view, 'the slots table lists the hero slot (views.js:293-303)').toContain('hero');
      expect(view, 'W28.R5 — the slots table names the retained setting it is handed (`configuredExploration`), not only the effective mode').toContain('Stored Thompson — inactive');
    } finally { c.close(); }
  }, 60_000);
});

// ===========================================================================
// unit:W28.R6 — W28.C1.01's record-level clauses, proven on the STORED record.
//
// W28.C1.01 proved the explored flag, the recorded support, the one flagged
// position and the recorded bucket on `decideContent`'s output; its host leg
// could not reach a stored record (`src/routes/decisions.ts:539` passes an
// offer, so `src/content/service.ts:500` captures nothing for an ordinary
// served-basis caller). The path an ordinary shopper's decision takes to the
// ledger is the rendered acknowledgement: a `rendered-v1` slot's answer carries
// a render offer, the SDK's `content_impression` redeems it, and the durable
// admission writes the record to the ledger and the ring (kit 02:315; W21.E1.08
// drives the same path). This unit reads the records THAT path stored — the
// ledger rows the real consumer wrote and the receipts the real ring answers.
//
// THE PAGE: a cold shopper (no affinity yet, so every score is zero and the
// ranking is catalogue order) and no published lift snapshot (so every piece
// has zero observations and rotation takes the lowest id). `hero` (take two)
// puts its lowest id first: rotation agrees with the leader. `rail` holds
// twelve pieces — more than the default candidate limit of ten
// (`src/content/decide.ts`, `candidateLimit ?? 10`) — with its lowest id last:
// the explored piece sits outside the top ten by score. `strip` runs epsilon
// on two pieces for a shopper whose uniform draw names the leader. Unknown and
// cross-category tags ride on the pieces as a real feed carries them.
// ===========================================================================

const R6_HERO = ['cnt-bag-charms-edit', 'cnt-tabby-evening-edit', 'cnt-willow-lookbook'];
const R6_RAIL = ['cnt-rogue-work', 'cnt-shoulder-bag-edit', 'cnt-signature-canvas', 'cnt-tabby-shoulder', 'cnt-tote-weekend',
  'cnt-willow-tote', 'cnt-wallet-slg', 'cnt-pillow-tabby', 'cnt-mini-bag', 'cnt-cassie-crossbody', 'cnt-brooklyn-shoulder', 'cnt-archive-lookbook'];
const R6_STRIP = ['cnt-tabby-strip', 'cnt-charms-strip'];
const R6_PIECES: ContentPiece[] = [
  ...R6_HERO.map((id, i) => piece(id, i === 0 ? { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'] } : { line: ['Tabby'], category: ['Handbags'] }, ['hero'])),
  ...R6_RAIL.map((id, i) => piece(id, i === 11 ? { occasion: ['wombat-unrecognized'], category: ['Unknown'] } : { line: ['Rogue'], category: ['Handbags'] }, ['rail'])),
  ...R6_STRIP.map(id => piece(id, { occasion: ['evening'], category: ['Handbags'] }, ['strip'])),
];
const R6_SLOTS: SlotCatalog = { version: 'w28-ledger-r6', pages: { home: [
  { slot: 'hero', take: 2, weights: { occasion: 0.35, line: 0.25 } },
  { slot: 'rail', take: 1, weights: { line: 0.25 } },
  { slot: 'strip', take: 1, weights: { occasion: 0.25 } },
] } } as SlotCatalog;
const rendered = (exploration: ExploreConfig) => ({ gamma: 0, reward: 'click', objective: 'unit', measurementBasis: 'rendered-v1', exploration });
const R6_LEARN: LearnConfig = { version: 'w28-ledger-r6', holdout: HOLDOUT_NONE, slots: {
  hero: rendered({ mode: 'rotation', share: 1, floor: 50 }),
  rail: rendered({ mode: 'rotation', share: 1, floor: 50 }),
  strip: rendered({ mode: 'epsilon', share: 1, floor: 50 }),
} } as unknown as LearnConfig;

/** A shopper whose buckets THIS hour put every slot inside the share, and whose epsilon draw on `strip` names its leader. */
function r6Shopper(nowMs: number): string {
  const hour = hourKeyOf(nowMs);
  const found = Array.from({ length: 200 }, (_, i) => `vis-00000028-0c06-4000-8000-${String(i).padStart(12, '0')}`)
    .find(v => bucketAt(v, 'hero', hour) < 1 && bucketAt(v, 'rail', hour) < 1 && bucketAt(v, 'strip', hour) < 0.5);
  expect(found, 'a fixture shopper inside every share this hour').toBeDefined();
  return found!;
}

describe('unit:W28.R6', () => {
  for (const host of ['session', 'do'] as const) {
    it(`host (${host}): the records the rendered acknowledgement stored carry the exploration the rule made, one flagged position, the pre-reorder support and the governing bucket, and the receipt says so`, async () => {
      const m = await mount(host, { recovery: true });
      await publishDocuments(m, { pieces: R6_PIECES, slots: R6_SLOTS, learn: R6_LEARN });
      const subject = r6Shopper(Date.now());
      const sessionId = `s-${subject.slice(4)}`;
      const grant = await issueSessionCapability(m.env, { tenant: TENANT, subject, sessionId, kind: 'anonymous' });
      const call = (path: string, body?: unknown) => m.fetch(new Request(`https://synthetic.invalid${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      const chose = await call(`/realtime/session/${sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true,
        choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp } });
      expect(chose.status, await chose.clone().text()).toBe(200);
      await m.drain();

      // The page load, and the render acknowledgement the SDK sends for every piece it rendered.
      const pageInstance = `w28-ledger-r6-${host}`;
      invalidatePublicationCache();
      const snapshot = await call(`/v1/${TENANT}/decisions/snapshot?page=home&pageInstance=${pageInstance}`);
      const served = await snapshot.json() as { decisions?: Array<{ slot: string; contentId: string; decisionId?: string; renderOffer?: string }> };
      await m.drain();
      expect(snapshot.status, JSON.stringify(served).slice(0, 300)).toBe(200);
      const decisions = served.decisions ?? [];
      expect(decisions.map(d => `${d.slot}:${d.contentId}`), 'the exploration rule ran on the served page')
        .toEqual(['hero:cnt-bag-charms-edit', 'hero:cnt-tabby-evening-edit', 'rail:cnt-archive-lookbook', 'strip:cnt-tabby-strip']);
      const positions = new Map<string, number>();
      for (const d of decisions) {
        expect(d.renderOffer, `${d.slot}: the rendered basis offers an acknowledgement`).toBeTruthy();
        const position = positions.get(d.slot) ?? 0; positions.set(d.slot, position + 1);
        const ack = await call('/realtime/action', { type: 'content_impression', source: 'sdk', userId: subject, sessionId, timestamp: Date.now(), eventId: crypto.randomUUID(),
          data: { contentId: d.contentId, decisionId: d.decisionId, renderOffer: d.renderOffer, page: 'home', pageInstance, slot: d.slot, position } });
        expect(ack.status, `${d.slot}:${position} acknowledged: ${await ack.clone().text()}`).toBe(200);
        await m.drain();
      }
      await m.drainLedger();

      // The stored records: the ledger rows the real consumer wrote.
      const stored = [...m.storage.objects.entries()].filter(([key]) => key.includes('/decision/') && key.endsWith('.ndjson'))
        .flatMap(([, raw]) => raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as DecisionRecord))
        .filter(record => record.visitor_id === subject);
      const at = (slot: string, position: number) => {
        const record = stored.find(r => r.slot === slot && r.position === position);
        expect(record, `the ledger stored ${slot}:${position}`).toBeDefined();
        return record!;
      };
      expect(stored.every(record => record.measurementBasis === 'rendered-v1' && record.rendered !== undefined), 'every stored record is the rendered acknowledgement').toBe(true);
      const hour = hourKeyOf(stored[0]!.ts);

      // C1.01(a): a rotation draw that agreed with the ranking's leader is stored as the exploration it was,
      // with the rule and the bucket that governed it (C1.01's last clause: the gate's own input).
      expect(at('hero', 0)).toMatchObject({ item_id: 'cnt-bag-charms-edit', explored: true,
        explain: { exploration: { mode: 'rotation', bucket: bucketAt(subject, 'hero', hour) } } });
      // C1.01, take two: the one position the exploration took is flagged; the ranking filled the other.
      expect(at('hero', 1)).toMatchObject({ item_id: 'cnt-tabby-evening-edit', explored: false });
      // C1.01(b): the stored support is the top ten by score before the pick moved, with the explored piece beside them.
      expect(at('rail', 0)).toMatchObject({ item_id: 'cnt-archive-lookbook', explored: true, explain: { exploration: { mode: 'rotation' } } });
      expect(at('rail', 0).candidates.map(c => c.contentId), 'the stored support: the explored piece, then the top ten by score')
        .toEqual(['cnt-archive-lookbook', ...R6_RAIL.slice(0, 10)]);
      // C1.01, epsilon: a uniform draw that named the leader is stored as the exploration it was.
      expect(at('strip', 0)).toMatchObject({ item_id: 'cnt-tabby-strip', explored: true,
        explain: { exploration: { mode: 'epsilon', bucket: bucketAt(subject, 'strip', hour) } } });

      // And the shopper's receipt, read off the ring the same admission wrote, says it in the operator's words.
      const receipts = await operatorGet(m, `/v1/${TENANT}/visitors/${encodeURIComponent(subject)}/receipts`);
      expect(receipts.status, JSON.stringify(receipts.body).slice(0, 300)).toBe(200);
      const heroReceipt = (receipts.body.receipts as Array<{ slot: string; position: number; explored: boolean; why: string[] }>)
        .find(r => r.slot === 'hero' && r.position === 0);
      expect(heroReceipt, 'the ring holds the hero receipt').toBeDefined();
      expect(heroReceipt!.explored).toBe(true);
      expect(heroReceipt!.why.join(' ')).toContain('Served on purpose to explore (rotation)');
    }, 60_000);
  }
});
