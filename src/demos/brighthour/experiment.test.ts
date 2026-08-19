// @vitest-environment node
// src/demos/brighthour/experiment.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Beat 13. What this suite pins is the one claim the beat makes out loud:
// "the assignment rides in the same row as the affinity scores, and the
// experiment it names is real."
//
// So it tests the two halves of that separately, and hard:
//
//   1. THE ASSIGNMENT IS THE PLATFORM'S. The degraded path is not a plausible
//      -looking coin flip — it is Optimizely's own bucketer (murmurhash3 seed 1
//      over visitorId+experimentId, resolved against the datafile's published
//      trafficAllocation). It is checked against the REAL SDK, arm for arm,
//      over a thousand visitors. If our arithmetic ever drifts from theirs,
//      this file fails rather than the demo.
//
//   2. THE LAUNCH CANNOT DUPLICATE. Every call is driven through a recording
//      fetch stub, so the exact REST sequence is visible, and the second call
//      is asserted to touch the network zero times.
//
// The stubbed calls here are the SAME shapes verified live against the real API
// (flag 587385 / experiment 9300003368088) — the ids below are the ones the
// project actually minted, so a shape change shows up as a test failure.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BH_EVENT_KEY,
  BH_FLAG_KEY,
  BH_IDS_KV_KEY,
  BH_RULE_KEY,
  BH_VARIATION_KEYS,
  bucketValue,
  chooseFraming,
  clearBhExperimentMemo,
  frameOffer,
  getBhExperimentIds,
  launchBhExperiment,
  presenterUrls,
  saveBhExperimentIds,
  stampExperiment,
  type BhExperimentIds,
  type StampableRow,
} from './experiment';

// ── The real ids the live project minted for this experiment ─────────────────

const PROJECT_ID = '4919568555048960';
const ACCOUNT_ID = '8543082612';
const FLAG_ID = 587385;
const EVENT_ID = 6396045100318720;
const EXPERIMENT_ID = '9300003368088';
const CAMPAIGN_ID = '9300002619824';
const VARIATION_IDS: Record<string, string> = { time_language: '1848510', value_language: '1848511' };

/** A v4 datafile carrying exactly our rule — the shape the CDN publishes. */
function datafileFixture(revision = '103') {
  return {
    version: '4',
    accountId: ACCOUNT_ID,
    projectId: PROJECT_ID,
    revision,
    anonymizeIP: true,
    botFiltering: false,
    sendFlagDecisions: true,
    attributes: [],
    audiences: [],
    typedAudiences: [],
    groups: [],
    rollouts: [{ id: 'bh_rollout', experiments: [] }],
    events: [{ id: String(EVENT_ID), key: BH_EVENT_KEY, experimentIds: [EXPERIMENT_ID] }],
    featureFlags: [
      { id: String(FLAG_ID), key: BH_FLAG_KEY, rolloutId: 'bh_rollout', experimentIds: [EXPERIMENT_ID], variables: [] },
    ],
    experiments: [
      {
        id: EXPERIMENT_ID,
        key: BH_RULE_KEY,
        status: 'Running',
        layerId: CAMPAIGN_ID,
        forcedVariations: {},
        audienceIds: [],
        audienceConditions: [],
        variations: BH_VARIATION_KEYS.map((key) => ({
          id: VARIATION_IDS[key],
          key,
          featureEnabled: true,
          variables: [],
        })),
        trafficAllocation: [
          { entityId: VARIATION_IDS.time_language, endOfRange: 5000 },
          { entityId: VARIATION_IDS.value_language, endOfRange: 10000 },
        ],
      },
    ],
  };
}

function idsFixture(): BhExperimentIds {
  const df = datafileFixture();
  const exp = df.experiments[0];
  return {
    flagKey: BH_FLAG_KEY,
    flagId: FLAG_ID,
    ruleKey: BH_RULE_KEY,
    environment: 'development',
    projectId: PROJECT_ID,
    eventKey: BH_EVENT_KEY,
    eventId: EVENT_ID,
    flagVariationIds: { time_language: 1848510, value_language: 1848511 },
    datafile: {
      experimentId: EXPERIMENT_ID,
      campaignId: CAMPAIGN_ID,
      variationIds: { ...VARIATION_IDS },
      trafficAllocation: exp.trafficAllocation.map((t) => ({ entityId: t.entityId, endOfRange: t.endOfRange })),
      eventEntityId: String(EVENT_ID),
      accountId: ACCOUNT_ID,
      revision: '103',
      readAt: 1,
    },
    createdAt: 1,
    ruleCreated: true,
    enabled: true,
    ...presenterUrls(PROJECT_ID, 'development'),
  };
}

// ── A KV that behaves like KV enough for this module ─────────────────────────

class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function envFixture(overrides: Record<string, unknown> = {}) {
  return {
    CACHE: new FakeKV(),
    OPTIMIZELY_API_TOKEN: 'test-token',
    OPTIMIZELY_PROJECT_ID: PROJECT_ID,
    OPTIMIZELY_ENVIRONMENT: 'development',
    OPTIMIZELY_ACCOUNT_ID: ACCOUNT_ID,
    OPTIMIZELY_SDK_KEY: 'TESTSDKKEY',
    ...overrides,
  } as never;
}

beforeEach(() => {
  clearBhExperimentMemo();
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearBhExperimentMemo();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 · The assignment is the platform's own arithmetic
// ─────────────────────────────────────────────────────────────────────────────

describe('bucketing', () => {
  /**
   * THE LOAD-BEARING TEST.
   *
   * The demo stamps a variation id into an export row a customer's analysts may
   * later join against Optimizely's own results. If our local bucketing and the
   * SDK's ever disagreed, that row would be a lie told in good faith. So: build
   * a real SDK client over the same datafile and demand agreement on every
   * single visitor.
   */
  it('agrees with the real Optimizely SDK on every visitor, 1000/1000', async () => {
    const lite = await import('@optimizely/optimizely-sdk/lite');
    const sdk = (lite as unknown as { default?: typeof lite }).default ?? lite;
    const client = sdk.createInstance({
      datafile: datafileFixture() as never,
      eventDispatcher: { dispatchEvent: () => {} },
      errorHandler: { handleError: () => {} },
      logger: { log: () => {} } as never,
    });
    expect(client).toBeTruthy();
    await client!.onReady();

    const ids = idsFixture();
    let mismatches = 0;
    for (let i = 0; i < 1000; i++) {
      const visitorId = `bh_v_${i}`;
      const sdkArm = client!.createUserContext(visitorId)!.decide(BH_FLAG_KEY).variationKey;
      const ours = chooseFraming(visitorId, ids).variationKey;
      if (sdkArm !== ours) mismatches += 1;
    }
    expect(mismatches).toBe(0);
    client!.close?.();
  });

  it('splits roughly 50/50 over 1000 synthetic visitors', () => {
    const ids = idsFixture();
    const counts: Record<string, number> = { time_language: 0, value_language: 0 };
    for (let i = 0; i < 1000; i++) counts[chooseFraming(`bh_v_${i}`, ids).variationKey] += 1;

    expect(counts.time_language + counts.value_language).toBe(1000);
    // A 50/50 rule over 1000 visitors: anything outside ±5pp would mean the
    // allocation was not being read, not that the coin was unlucky.
    expect(counts.time_language).toBeGreaterThan(450);
    expect(counts.time_language).toBeLessThan(550);
  });

  it('is stable: the same visitor gets the same arm, every time', () => {
    const ids = idsFixture();
    for (const visitorId of ['bh_alpha_1', 'bh_beta_2', 'bh_gamma_3']) {
      const first = chooseFraming(visitorId, ids);
      for (let i = 0; i < 25; i++) {
        expect(chooseFraming(visitorId, ids).variationKey).toBe(first.variationKey);
      }
    }
  });

  it('salts on the datafile experiment id once published, and says so', () => {
    const unlaunched = chooseFraming('bh_alpha_1', null);
    expect(unlaunched.launched).toBe(false);
    expect(unlaunched.sdkIdentical).toBe(false);
    expect(unlaunched.bucketedOn).toBe(BH_RULE_KEY);
    expect(unlaunched.experimentId).toBeNull();

    const launched = chooseFraming('bh_alpha_1', idsFixture());
    expect(launched.launched).toBe(true);
    expect(launched.sdkIdentical).toBe(true);
    expect(launched.bucketedOn).toBe(EXPERIMENT_ID);
    expect(launched.bucket).toBe(bucketValue('bh_alpha_1', EXPERIMENT_ID));
    expect(launched.source).toBe('hash'); // chooseFraming IS the fallback path
  });

  /** The live check that produced these numbers, frozen as a regression. */
  it('reproduces the arms observed against the live project', () => {
    const ids = idsFixture();
    expect(chooseFraming('bh_alpha_1', ids)).toMatchObject({
      variationKey: 'value_language',
      variationId: '1848511',
      experimentId: EXPERIMENT_ID,
      campaignId: CAMPAIGN_ID,
      bucket: 6224,
    });
    expect(chooseFraming('bh_beta_2', ids)).toMatchObject({
      variationKey: 'time_language',
      variationId: '1848510',
      bucket: 1508,
    });
    expect(chooseFraming('bh_gamma_3', ids).bucket).toBe(8466);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Framing: the arm changes the language and nothing else
// ─────────────────────────────────────────────────────────────────────────────

describe('frameOffer', () => {
  const time = chooseFraming('bh_beta_2', idsFixture()).framing;
  const value = chooseFraming('bh_alpha_1', idsFixture()).framing;

  it('passes the composer window language through untouched on the control arm', () => {
    expect(time.style).toBe('time');
    for (const language of ['One-Day Price', 'Ends Today', 'Last Hours']) {
      expect(frameOffer(time, { windowLanguage: language })).toBe(language);
    }
  });

  it('re-describes the same window as worth on the treatment arm', () => {
    expect(value.style).toBe('value');
    expect(frameOffer(value, { windowLanguage: 'One-Day Price' })).toBe("Today's best price");
    expect(frameOffer(value, { windowLanguage: 'Last Hours' })).toBe('Best value on the floor');
    // Never a countdown, on either arm — §A6 is a property of the surface.
    expect(frameOffer(value, { windowLanguage: 'Last Hours' })).not.toMatch(/\d/);
  });

  it('still says something when the slot has no live offer at all', () => {
    expect(frameOffer(time, null)).toBe('Ends Today');
    expect(frameOffer(value, null)).toBe("Today's best price");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 · The row stamp
// ─────────────────────────────────────────────────────────────────────────────

describe('stampExperiment', () => {
  const rows = (): StampableRow[] =>
    ['hero_billboard', 'daily_deal', 'spotlight_for_you', 'deals_rail'].map((slot_id) => ({
      slot_id,
      experiment_id: null,
      variation_id: null,
      campaign_id: null,
    }));

  it('stamps the slot under test, and only that slot', () => {
    const out = rows();
    const stamped = stampExperiment(out, chooseFraming('bh_alpha_1', idsFixture()));

    expect(stamped).toBe(1);
    const deal = out.find((r) => r.slot_id === 'daily_deal')!;
    expect(deal.experiment_id).toBe(EXPERIMENT_ID);
    expect(deal.variation_id).toBe('1848511');
    expect(deal.campaign_id).toBe(CAMPAIGN_ID);

    // Every other slot keeps its nulls: no experiment governs them, and an
    // export that claimed otherwise would not survive the customer's own SQL.
    for (const row of out.filter((r) => r.slot_id !== 'daily_deal')) {
      expect(row.experiment_id).toBeNull();
      expect(row.variation_id).toBeNull();
      expect(row.campaign_id).toBeNull();
    }
  });

  it('stamps nothing before the experiment is launched', () => {
    const out = rows();
    expect(stampExperiment(out, chooseFraming('bh_alpha_1', null))).toBe(0);
    expect(stampExperiment(out, null)).toBe(0);
    expect(out.every((r) => r.experiment_id === null)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 · KV round trip + idempotent launch
// ─────────────────────────────────────────────────────────────────────────────

describe('ids in KV', () => {
  it('round-trips exactly', async () => {
    const env = envFixture();
    const ids = idsFixture();
    await saveBhExperimentIds(env, ids);
    clearBhExperimentMemo(); // force the read to go through KV, not the memo

    const read = await getBhExperimentIds(env);
    expect(read).toEqual(ids);
    expect((env as unknown as { CACHE: FakeKV }).CACHE.store.has(BH_IDS_KV_KEY)).toBe(true);
  });

  it('degrades to "not launched" rather than throwing when KV is unreadable', async () => {
    const env = envFixture({
      CACHE: {
        get: () => Promise.reject(new Error('KV is having a night')),
        put: () => Promise.resolve(),
      },
    });
    await expect(getBhExperimentIds(env)).resolves.toBeNull();
  });
});

describe('launchBhExperiment', () => {
  /**
   * A recording stand-in for the FX REST surface. Every response shape below is
   * one observed against the real API during the live verification.
   */
  function stubFx() {
    const calls: string[] = [];
    const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push(`${method} ${url.split('?')[0]}`);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

      if (url.includes('cdn.optimizely.com/datafiles')) return json(datafileFixture());
      if (url.endsWith(`/flags/${BH_FLAG_KEY}`) && method === 'GET') return json({ title: 'Not Found' }, 404);
      if (url.endsWith('/flags') && method === 'POST') return json({ id: FLAG_ID, key: BH_FLAG_KEY });
      if (url.includes('/variations') && method === 'GET') return json({ items: [] });
      if (url.includes('/variations') && method === 'POST') {
        const key = JSON.parse(String(init?.body ?? '{}')).key as string;
        return json({ id: Number(VARIATION_IDS[key]), key });
      }
      if (url.includes('/v2/events') && method === 'GET') return json([]);
      if (url.includes('/custom_events') && method === 'POST') return json({ id: EVENT_ID, key: BH_EVENT_KEY });
      if (url.includes('/ruleset/enabled') && method === 'POST') return json({ enabled: true });
      if (url.includes('/ruleset') && method === 'GET') return json({ enabled: false, rules: {}, rule_priorities: [] });
      if (url.includes('/ruleset') && method === 'PATCH') return json({ revision: 104 });
      return json({}, 404);
    };
    vi.stubGlobal('fetch', vi.fn(handler));
    return calls;
  }

  it('creates the flag, both variations, the event, the a/b rule — then enables it', async () => {
    const calls = stubFx();
    const env = envFixture();

    const result = await launchBhExperiment(env);

    expect(result.ok).toBe(true);
    expect(result.reused).toBe(false);
    expect(result.ids).toMatchObject({
      flagKey: BH_FLAG_KEY,
      flagId: FLAG_ID,
      ruleKey: BH_RULE_KEY,
      eventKey: BH_EVENT_KEY,
      eventId: EVENT_ID,
      ruleCreated: true,
      enabled: true,
    });

    // Both arms were created, control first.
    expect(Object.keys(result.ids!.flagVariationIds)).toEqual([...BH_VARIATION_KEYS]);

    // The rule went up as a real 50/50 a/b — not a targeted delivery wearing
    // an experiment's name, which is the one substitution this beat cannot make.
    const patch = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(
      ([u, i]) => String(u).includes('/ruleset') && i?.method === 'PATCH' && String(i.body).includes(BH_RULE_KEY)
    );
    const rule = JSON.parse(String(patch![1].body))[0].value;
    expect(rule.type).toBe('a/b');
    expect(rule.percentage_included).toBe(10000);
    expect(rule.variations.time_language.percentage_included).toBe(5000);
    expect(rule.variations.value_language.percentage_included).toBe(5000);
    expect(rule.metrics[0].event_id).toBe(EVENT_ID);

    // …and the platform's own ids came back off the published datafile.
    expect(result.ids!.datafile).toMatchObject({
      experimentId: EXPERIMENT_ID,
      campaignId: CAMPAIGN_ID,
      eventEntityId: String(EVENT_ID),
    });

    expect(calls.filter((c) => c.startsWith('POST') && c.endsWith('/flags')).length).toBe(1);
  });

  it('is idempotent: a second launch returns the same ids and touches nothing', async () => {
    stubFx();
    const env = envFixture();

    const first = await launchBhExperiment(env);
    const callsAfterFirst = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Cold isolate: only KV carries the memory forward.
    clearBhExperimentMemo();
    const second = await launchBhExperiment(env);

    expect(second.reused).toBe(true);
    expect(second.ids).toEqual(first.ids);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(callsAfterFirst);
  });

  it('reuses an existing flag/rule instead of creating a second one', async () => {
    // The platform already has everything — the ensure ladder must find it all.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
        if (url.includes('cdn.optimizely.com/datafiles')) return json(datafileFixture());
        if (url.endsWith(`/flags/${BH_FLAG_KEY}`)) return json({ id: FLAG_ID, key: BH_FLAG_KEY });
        if (url.includes('/variations') && method === 'GET') {
          return json({ items: BH_VARIATION_KEYS.map((key) => ({ id: Number(VARIATION_IDS[key]), key })) });
        }
        if (url.includes('/v2/events') && method === 'GET') return json([{ id: EVENT_ID, key: BH_EVENT_KEY }]);
        if (url.includes('/ruleset')) return json({ enabled: true, rules: { [BH_RULE_KEY]: { enabled: true, type: 'a/b' } } });
        return json({}, 500); // any CREATE at all is a failure of this test
      })
    );

    const result = await launchBhExperiment(envFixture());
    expect(result.ok).toBe(true);
    expect(result.ids!.ruleCreated).toBe(true);
    const posts = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.filter(
      ([, i]) => (i?.method ?? 'GET').toUpperCase() === 'POST'
    );
    expect(posts).toEqual([]);
  });

  it('fails loudly rather than substituting a non-experiment rule', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
        if (url.includes('cdn.optimizely.com/datafiles')) return json(datafileFixture());
        if (url.endsWith(`/flags/${BH_FLAG_KEY}`)) return json({ id: FLAG_ID });
        if (url.includes('/variations') && method === 'GET') {
          return json({ items: BH_VARIATION_KEYS.map((key) => ({ id: Number(VARIATION_IDS[key]), key })) });
        }
        if (url.includes('/v2/events') && method === 'GET') return json([{ id: EVENT_ID, key: BH_EVENT_KEY }]);
        if (url.includes('/ruleset') && method === 'GET') return json({ enabled: false, rules: {} });
        if (url.includes('/ruleset') && method === 'PATCH') return json({ message: 'invalid rule type' }, 400);
        return json({}, 404);
      })
    );

    const result = await launchBhExperiment(envFixture());
    expect(result.ok).toBe(false);
    expect(result.ids).toBeNull();
    expect(result.error).toMatch(/ruleset PATCH rejected: 400/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 · The presenter's URL
// ─────────────────────────────────────────────────────────────────────────────

describe('presenterUrls', () => {
  it('points at the flag rules page for the environment the rule lives in', () => {
    const { presenterUrl, resultsUrl } = presenterUrls(PROJECT_ID, 'development');
    expect(presenterUrl).toBe(
      `https://app.optimizely.com/v2/projects/${PROJECT_ID}/flags/manage/${BH_FLAG_KEY}/rules/development`
    );
    expect(resultsUrl).toContain(`/rule/${BH_RULE_KEY}/results`);
  });
});
