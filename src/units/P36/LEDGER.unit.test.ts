// src/units/P36/LEDGER.unit.test.ts
// P36 under the Closure Ledger, the second parity programme:
// the tests for the LOCAL criteria CH1 to CH6 of the P36 work order ("Vocabularies
// as tenant settings: channel words, visit buckets, ladder order and depth").
// DC1 (decision D1, RESOLVED 2026-10-09, amendment item 55) is ruled and exercised
// inside CH1 to CH4; LV1 and LV2 are deferred live rows and get no test.
//
// One `describe('unit:P36.<criterion>')` per criterion. Every expected value comes
// from the work order, its decision or a witness it cites, never from what the
// engine answers today:
//   · the work order's Done-when (amended ticket file, section E, P36): "the
//     entry-channel vocabulary (paid_social, paid_search_brand,
//     paid_search_nonbrand, organic, email, sms, affiliate, referral, direct, the
//     brand split from a published `utm_campaign` rule), the source platform (from
//     the network list and a token-form `utm_source`), the landing-page type kept
//     for the visit, the visit buckets and the ladder order and depth are
//     per-tenant, versioned settings published without a deployment; the
//     classification of UTM parameters and referrers into those values is a
//     published mapping; an arrival whose evidence maps to no value records as
//     unknown, never a guess; the page may pass its own channel only as a value of
//     the tenant's vocabulary; a tenant without the settings keeps today's six
//     words and classification exactly; a vocabulary change carries W25's grammar
//     bump and prior re-export; the console shows and edits the settings; the kit
//     states the vocabulary and the mapping";
//   · decision D1: the nine values; source platform and landing-page type are
//     context attributes recorded on the visit and usable as seed-signal keys, not
//     learning-cell levels; a tenant without the settings keeps the six words;
//   · the investigation §2.5 (the nine channels against the six words: sms falls
//     through to direct, affiliate into referral, one paid-search word; the source
//     platform as the networks name it, Meta being facebook.com and instagram.com),
//     DI-1, DI-2 (a token-form utm_source names its network), DI-6 (the landing-page
//     type from the first page type of the visit);
//   · the code at af671ce7 for what "today" is: the six words and their tables
//     (src/services/visit.ts:37, :124, :239-250, :426-474), the visit-bucket cut
//     (src/content/cell.ts:44-49), the cell grammar `ladder-cell` version 2 with the
//     order c, v, s, r, a and its refusal naming the migration
//     (src/learn/priors.ts:70-77, :102-110), the seed arithmetic rule weight ×
//     slot weight (unit:W16.C3.01) and the receipt's "Arrival context" sentence
//     (src/learn/receipts.ts:139-141).
//
// THE REPRESENTATION THIS FILE RULES (one for all six criteria):
//   The settings are the learn document's member `contextVocabulary` (the learn
//   document is a published, stamped, versioned revision written by
//   `PUT /content/learn`; no new publication kind, src/config/publication.ts being
//   outside P36's boundary):
//     contextVocabulary: {
//       channels: [{ id, name }],                       // the channel values
//       rules: [{ channel, utmMedium?, utmSource?, utmCampaign?, referrer?, untagged? }],
//       sourcePlatforms: [{ id, name, networks: [registrable domains] }],
//       landingPageTypes: [{ id, name }],
//       visitBuckets?: [lower bounds, ascending from 1], // optional (R-P52); omitted: today's cut [1, 2, 4]
//       ladder?: { order: [key letters], depth },        // optional (R-P52); omitted: today's c, v, s, r, a at depth 5
//     }
//   An id is lower case, words joined by underscores, at most 64 characters.
//   A rule names one channel id and at least one condition; its conditions all
//   hold: `utmMedium` lists mediums (trimmed, lower case); `utmSource` lists
//   sources, matched whole or as a token of a token-form source (split on `_`, `-`
//   and white space); `utmCampaign` lists tokens of the campaign (split the same
//   way); `referrer` is 'none' (a page view whose referrer is empty or the site's
//   own host), 'external' (a referrer host that is not the site's own) or a list of
//   registrable domains (the host is one, or a dot-boundary subdomain of one);
//   `untagged: true` means no utm_medium, utm_source or utm_campaign is declared.
//   Rules are read in order and the first that holds classifies the arrival; when
//   none holds the arrival records as unknown (the projection's `null`, the cell's
//   'unknown').
//   The arrival contract gains `utmCampaign` (src/services/visit.ts ChannelSignals,
//   bounded like `utmSource`), the field the brand split reads.
//   The source platform is the platform whose `networks` hold the referrer's host
//   (dot-boundary) or the network a token-form `utm_source` names (the classifier's
//   own tokens and aliases, src/services/visit.ts:294-303).
//   The landing-page type is the `data.pageType` of the first accepted event of
//   the visit naming one of the tenant's landing-page type ids; later pages of
//   the visit do not change it.
//   Both are recorded on the visit and are seed-signal keys `source_platform` and
//   `landing_page_type` (beside entry_channel, campaign_term, referrer_network,
//   platform); a fired rule is itemised on the record's `explain.contextual` and on
//   the receipt's "Arrival context" sentence, as every seed rule is.
//   "Recorded on the visit" is measured by a later snapshot of the same visit that
//   carries no arrival of its own and is still decided with the recorded value.
//   The page's own channel (the snapshot's `channel`) is admitted only when it is
//   one of the tenant's channel ids (one of the six words for a tenant without
//   the settings), and recorded on the decision's cell as any channel is.
//   A tenant whose published vocabulary changes the channel values has another
//   cell grammar: a priors document declaring the grammar it was exported under
//   before the vocabulary (`ladder-cell`, version 2, c, v, s, r, a) is refused by
//   `PUT /content/priors` with an error naming `cellGrammar` and a migration
//   sentence that names the re-export; a document declaring nothing is read under
//   the tenant's current grammar (W25).
//   The console's dials screen (`#/dials`) carries the control
//   `[data-focus-key="contextVocabulary"]`, a JSON editor showing the stored member
//   and saving through `PUT /content/learn`.
//
// R-P46 (the lead's ruling of 2026-10-09 on the S5 specification review: the
// settings are used where a channel is named, and applied, not only stored):
//   · A seed rule's `entry_channel` value (unit:W16.C3) and a P01 per-context
//     order's `context.channel` admit exactly the tenant's published channel ids
//     (here the nine, so `sms` and `paid_search_brand`) and refuse every other
//     word, today's `paid_search` included, at publication as today (422; the
//     seed rule's refusal naming `entry_channel`, the order's naming the value
//     quoted, as today's validators word them, src/content/kinds.ts:279, :359-360).
//     The same reading holds where a decision re-reads a published rule set or
//     order, so a rule fires and an order serves for a shopper whose visit records
//     that channel. A tenant without the settings admits exactly the six words, as
//     today (the unit:W16.C3 and unit:P01.O5 locks unchanged).
//   · `visitBuckets` lists whole-number lower bounds, strictly ascending from 1;
//     a bucket runs from its bound to the next bound less one and is named by its
//     single number ('1') or its range ('2-3'), the last one open ('4+'), so
//     today's cut [1, 2, 4] names today's buckets '1', '2-3', '4+'
//     (src/content/cell.ts:44-49). The published cut is the shopper's bucket on the
//     decision's cell: under [1, 2, 3, 6] visits 1 to 4 are '1', '2', '3-5', '3-5'.
//     A P01 per-context order names the buckets of the tenant's cut (or `any`)
//     and no other word, refused as today's validator words it, quoting the value
//     (src/content/kinds.ts:367); the decision matches the order against the
//     shopper's bucket under that cut, so under [1, 2, 3, 6] an order naming
//     '3-5' is served to a visit-3 shopper, an `any` order still serves that
//     shopper, and an order naming today's '2-3' is refused (the S5 fix-round-1
//     review's F1). A tenant without the settings keeps '1', '2-3', '4+' in orders.
//   · `ladder.depth` is how many ladder levels below everyone (`*`) the engine
//     consults, in the published order; today's ladder is depth 5. A learned lift
//     is read from the finest consulted level with enough evidence
//     (src/learn/stats.ts:483-495), never from a level beyond the depth: under
//     depth 2 an item learned at every level of the shopper's cell answers from
//     level 2, 'channel and visit bucket' (LEVEL_WORDS, src/learn/stats.ts:37-40),
//     on the record's `explain.lift`. The cell grammar follows the setting: its
//     order is today's order cut at the depth; another order refused (R-P51) and
//     its version is derived
//     from the setting (W25: "bumped whenever the ladder order changes",
//     src/learn/priors.ts:46), so a priors file declaring the grammar in force
//     before the change is refused naming `cellGrammar` and the re-export, a file
//     declaring that version number with the new order is refused naming
//     `cellGrammar`, a file declaring the grammar in force imports, and a row on a
//     cell finer than the depth is refused naming the row (a cell no snapshot
//     builds, W25 G1.01). The refusal of a file declaring another grammar keeps
//     today's sentence naming the grammar in force, `reads <name> version <n>,
//     whose cells are <k>=, … in that order` (src/learn/priors.ts:110); the legs
//     read the grammar in force from it.
//   · The settings' own validation (R-P51 and the review's F3; CH5's refusal legs,
//     refused as CH1 refuses: 422, no revision written): `ladder.order` is today's
//     order c, v, s, r, a and nothing else, so another order, an unknown key letter
//     or a repeated one is refused, and `ladder.depth` runs from 1 to the order's
//     length, each refusal naming `contextVocabulary.ladder`; `visitBuckets` whose
//     bounds are not whole numbers, not strictly ascending or not starting at 1 are
//     refused naming `contextVocabulary.visitBuckets`. Reordering the ladder (with
//     its level words) is outside P36 (R-P51, a residual).
//
// R-P54 (the lead's ruling of 2026-10-12 on the P36 delivery review at 88e39487,
// fix round 1; the legs marked R-P54):
//   · (1) EVERY priors document one PUT publishes, the primary document or a
//     related member of `publicationChanges` (its kind resolved as the route
//     resolves every kind, in any case of the word), is checked against the cell
//     grammar of the learn member the same request publishes, or else the learn
//     document in force; a document declaring another grammar is refused 422
//     naming `cellGrammar` with the migration sentence naming the re-export,
//     writing no revision of any member (CH5's related-member leg; the review's
//     probe O);
//   · (2) the landing-page type is the first event of the visit carrying a page
//     type the tenant's vocabulary names: an event with no type or an unknown
//     type does not set it, and a later event does not replace it (CH3's lock;
//     the review's reading 3; kit 03:695);
//   · (3) a 256-character utm_campaign is kept on the arrival and a 257-character
//     one is refused 400 (CH2's lock; the review's probes B and L, mutant M13).
//
// R-P55 (the lead's ruling of 2026-10-12 on the P36 verification at 7c6e0e22,
// fix round 2; the legs marked R-P55):
//   · the P07 population fan-in reads an arrival exactly as the pipeline stores
//     the visit, under the tenant's vocabulary: on a vocabulary tenant an
//     arrival on a channel outside the six words (sms) or one the vocabulary
//     leaves unknown counts in no context population, and a direct population
//     holds direct arrivals alone, so a direct shopper is never decided on
//     them (CH2, both hosts; a LOCK keeps the tenant without the settings on
//     today's six words term for term). Its populations are read through
//     src/units/_parity2.ts (bindTrend, publishTrends), the P07 harness,
//     unchanged;
//   · kit 02's context-prior section states that only today's six channel words
//     and today's three visit buckets have a context population (CH6).
//   The P07 extension to vocabulary channels and cut buckets
//   (src/reflex/regionTrend.ts:65-81) stays a residual and is not asked here.
//
// RULED MEMBERS THAT DO NOT EXIST YET (read loosely, so no new type error):
// `contextVocabulary` on the learn document; `utmCampaign` on the arrival; the seed
// signals `source_platform` and `landing_page_type`; `data.pageType` read as the
// landing-page type; the console control `contextVocabulary`; under R-P46 the
// tenant's channel ids admitted by seed rules and per-context orders, the
// published visit-bucket cut on the cell, the ladder depth on the lift lookup and
// the grammar derived from the setting; the cut's buckets in a per-context order
// and the refusals of the ladder and the cut (R-P51, F3). No new export is imported.
//
// BOUNDARY NOTE (named, not ruled): the SDK reads the arrival in
// src/sdk/identity.ts:82-97, which is outside P36's allowed paths, so no unit here
// asks the SDK to capture utm_campaign; the host legs send the arrival as the SDK's
// action and snapshot envelopes carry it.
//
// HARNESS: src/units/_parity.ts (mount, both hosts, the shipped console, the P01
// page), src/units/_parity5.ts (the shopper with headers, the home page, putKind)
// and src/units/_parity4.ts (learnedLift, a lift learned through the real fan-in).

import { describe, expect, it, vi } from 'vitest';

import { invalidatePublicationCache } from '@/config/publication';
import { trendKey } from '@/reflex/regionTrend';

import {
  asOperator, declaredSlots, errorsOf, HOSTS, layoutSlot, LAYOUT, learnDocument, learned, loadDocument, M, MODULES, mount, openConsole, pageInstanceOf, putDocument, putSlots, readTree, receiptsOf,
  recentSlot, replayOf, rounded, servedIn, storedDecisions, TENANT, type Answer, type Host, type Mounted,
} from '../_parity';
import { bindTrend, publishTrends } from '../_parity2';
import { learnedLift } from '../_parity4';
import {
  HERO, heroOf, heroSlot, HOME, HOME_ORDER, HOME_PIECES, homeLearn, homeSlots, lineSeed, putKind, readKind, visitorOn, whyOf, type Visitor,
} from '../_parity5';

const SITE = 'www.shop.test';
const PAGE_VIEW = { type: 'page_view', data: { path: '/' } };
const pageView = (pageType?: string) => ({ type: 'page_view', data: { path: '/', ...(pageType ? { pageType } : {}) } });

/** The tenant's context vocabulary: the customer's nine channels (D1) with a published mapping, its source platforms and landing-page types. */
const NINE = ['paid_social', 'paid_search_brand', 'paid_search_nonbrand', 'organic', 'email', 'sms', 'affiliate', 'referral', 'direct'] as const;
const VOCABULARY = {
  channels: [
    { id: 'paid_social', name: 'Paid social' }, { id: 'paid_search_brand', name: 'Paid search (brand)' },
    { id: 'paid_search_nonbrand', name: 'Paid search (non-brand)' }, { id: 'organic', name: 'Organic search' },
    { id: 'email', name: 'Email' }, { id: 'sms', name: 'SMS' }, { id: 'affiliate', name: 'Affiliate' },
    { id: 'referral', name: 'Referral' }, { id: 'direct', name: 'Direct' },
  ],
  rules: [
    { channel: 'sms', utmMedium: ['sms'] },
    { channel: 'email', utmMedium: ['email', 'newsletter', 'crm'] },
    { channel: 'affiliate', utmMedium: ['affiliate'] },
    { channel: 'paid_social', utmMedium: ['paid_social', 'paidsocial'] },
    { channel: 'paid_social', utmMedium: ['cpc', 'paid'], utmSource: ['facebook', 'instagram', 'tiktok', 'pinterest', 'snapchat', 'youtube'] },
    // The brand split, read from the published utm_campaign rule (D1).
    { channel: 'paid_search_brand', utmMedium: ['cpc', 'ppc'], utmCampaign: ['brand'] },
    { channel: 'paid_search_nonbrand', utmMedium: ['cpc', 'ppc'] },
    { channel: 'organic', untagged: true, referrer: ['google.com', 'bing.com'] },
    { channel: 'referral', untagged: true, referrer: 'external' },
    { channel: 'direct', untagged: true, referrer: 'none' },
  ],
  sourcePlatforms: [
    { id: 'meta', name: 'Meta', networks: ['facebook.com', 'instagram.com'] },
    { id: 'tiktok', name: 'TikTok', networks: ['tiktok.com'] },
    { id: 'pinterest', name: 'Pinterest', networks: ['pinterest.com'] },
    { id: 'google', name: 'Google', networks: ['google.com'] },
    { id: 'bing', name: 'Bing', networks: ['bing.com'] },
  ],
  landingPageTypes: [
    { id: 'homepage', name: 'Homepage' }, { id: 'category', name: 'Category page' },
    { id: 'product', name: 'Product page' }, { id: 'editorial', name: 'Editorial or campaign page' },
  ],
  visitBuckets: [1, 2, 4],
  ladder: { order: ['c', 'v', 's', 'r', 'a'], depth: 5 },
};

/**
 * One arrival per channel, and two with no value: `vocabulary` is the value the
 * published rules above give it (first rule that holds; none → null), `today` the
 * word the six-word tables give it (src/services/visit.ts:239-250, :426-474, with
 * src/services/visit.ts:144-148 keeping an arrival with no page-view evidence
 * unknown). `campaign` arrivals carry utm_campaign, which today's arrival contract
 * refuses, so the tenant without the settings is measured without it.
 */
const ARRIVALS: Array<{ name: string; entry: Record<string, string>; vocabulary: string | null; today: string | null; campaign?: true }> = [
  { name: 'paid social', entry: { utmMedium: 'paid_social', utmSource: 'instagram', referrer: 'l.instagram.com', siteHost: SITE }, vocabulary: 'paid_social', today: 'paid_social' },
  { name: 'paid search, brand', entry: { utmMedium: 'cpc', utmSource: 'google', utmCampaign: 'brand_spring_bags', referrer: 'www.google.com', siteHost: SITE }, vocabulary: 'paid_search_brand', today: 'paid_search', campaign: true },
  // "nonbrand" holds the letters of "brand" but not the token: the rule matches tokens, never substrings.
  { name: 'paid search, non-brand', entry: { utmMedium: 'cpc', utmSource: 'google', utmCampaign: 'nonbrand_crossbody', referrer: 'www.google.com', siteHost: SITE }, vocabulary: 'paid_search_nonbrand', today: 'paid_search', campaign: true },
  { name: 'organic search', entry: { referrer: 'www.google.com', siteHost: SITE }, vocabulary: 'organic', today: 'organic' },
  { name: 'email', entry: { utmMedium: 'email', utmSource: 'newsletter', referrer: '', siteHost: SITE }, vocabulary: 'email', today: 'email' },
  { name: 'SMS', entry: { utmMedium: 'sms', utmSource: 'text_platform', referrer: '', siteHost: SITE }, vocabulary: 'sms', today: 'direct' },
  { name: 'affiliate', entry: { utmMedium: 'affiliate', utmSource: 'partner_network', referrer: 'partner.example.net', siteHost: SITE }, vocabulary: 'affiliate', today: 'referral' },
  { name: 'referral', entry: { referrer: 'blog.example.org', siteHost: SITE }, vocabulary: 'referral', today: 'referral' },
  { name: 'direct', entry: { referrer: '', siteHost: SITE }, vocabulary: 'direct', today: 'direct' },
  // A tagged arrival no rule names: today's tables fall through to direct; the published mapping records unknown, never a guess.
  { name: 'a medium no rule names', entry: { utmMedium: 'wombat', referrer: '', siteHost: SITE }, vocabulary: null, today: 'direct' },
  // No page-view evidence at all: unknown in both worlds (unit:W16.C2.04).
  { name: 'no evidence', entry: { utmMedium: 'wombat' }, vocabulary: null, today: null },
];

const SETTINGS = { pieces: [...HOME_PIECES], slots: homeSlots(), learn: homeLearn({ contextVocabulary: VOCABULARY }) };
const NO_SETTINGS = { pieces: [...HOME_PIECES], slots: homeSlots(), learn: homeLearn() };

/** The shopper's visit as the SDK-visible hydrate projects it (`projectVisit` shape, unit:W16.C2.07). */
async function visitOf(v: Visitor): Promise<{ visitNumber?: unknown; entryChannel?: unknown }> {
  const read = await v.hydrate();
  expect(read.status, `the hydrate projection answers: ${JSON.stringify(read.body).slice(0, 200)}`).toBe(200);
  return (read.body.visit ?? {}) as { visitNumber?: unknown; entryChannel?: unknown };
}

/** A first page view carrying the arrival; the action's own status is returned so a refusal is named, not hidden. */
async function arriveWith(m: Mounted, entry: Record<string, string>, event: { type: string; data: Record<string, unknown> } = PAGE_VIEW): Promise<{ v: Visitor; status: number }> {
  const v = await visitorOn(m);
  const answer = await v.action(event, { entry });
  return { v, status: answer.status };
}

/** The cell of the decisions a snapshot made, read back from the ledger the real consumer wrote. */
async function cellsOf(m: Mounted, v: Visitor, decisionIds: Array<string | undefined>): Promise<Array<Record<string, unknown> | undefined>> {
  await m.drainLedger();
  const stored = storedDecisions(m, v.subject);
  return decisionIds.map(id => stored.find(r => r.decision_id === id)?.cell as Record<string, unknown> | undefined);
}

/** Publish the learn document with the given extra members through the operator's own save, no deployment. */
const publishLearn = (m: Mounted, extra: Record<string, unknown>) => putDocument(m, 'learn', homeLearn(extra), 'context vocabulary');

// ===========================================================================
// unit:P36.CH1 — the vocabulary document, its refusals, the next arrival
// ===========================================================================

describe('unit:P36.CH1', () => {
  it('host: a tenant publishes the context vocabulary through PUT /content/learn without a deployment and the revision carries it as authored, and a channel id outside the id grammar, a duplicate id or a rule naming an unknown value is refused with an error naming the value, writing no revision', async () => {
    const m = await mount('session', NO_SETTINGS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const written = await publishLearn(m, { contextVocabulary: VOCABULARY });
    expect(written.status, `P36.CH1 — the vocabulary publishes: ${JSON.stringify(errorsOf(written))}`).toBe(200);
    const stored = (await loadDocument(m, 'learn')).document as Record<string, unknown>;
    expect.soft(stored.contextVocabulary, 'P36.CH1 — the published learn revision carries the context vocabulary as authored').toEqual(VOCABULARY);
    const revision = (await loadDocument(m, 'learn')).revision;

    const withChannels = (channels: unknown[], rules: unknown[] = VOCABULARY.rules.filter(r => channels.some(c => (c as { id: string }).id === r.channel))) =>
      ({ ...VOCABULARY, channels, rules });
    const refusals: Array<[string, unknown, string]> = [
      ['a channel id outside the id grammar (upper case and a space)', withChannels([{ id: 'Paid Social', name: 'Paid social' }, ...VOCABULARY.channels.slice(1)], VOCABULARY.rules.filter(r => r.channel !== 'paid_social')), 'Paid Social'],
      ['a channel id longer than 64 characters', withChannels([...VOCABULARY.channels, { id: 'a'.repeat(65), name: 'Long' }]), 'a'.repeat(65)],
      ['a duplicate channel id', withChannels([...VOCABULARY.channels, { id: 'sms', name: 'Text message' }]), 'sms'],
      ['a rule naming a channel the vocabulary does not list', { ...VOCABULARY, rules: [...VOCABULARY.rules, { channel: 'television', utmMedium: ['tv'] }] }, 'television'],
      ['a duplicate source platform id', { ...VOCABULARY, sourcePlatforms: [...VOCABULARY.sourcePlatforms, { id: 'meta', name: 'Meta again', networks: ['threads.net'] }] }, 'meta'],
      ['a duplicate landing-page type id', { ...VOCABULARY, landingPageTypes: [...VOCABULARY.landingPageTypes, { id: 'product', name: 'Product detail' }] }, 'product'],
    ];
    const outcomes: Array<{ case: string; status: number; named: boolean; errors: string[] }> = [];
    for (const [name, vocabulary, offending] of refusals) {
      const answer = await publishLearn(m, { contextVocabulary: vocabulary });
      const errors = errorsOf(answer);
      outcomes.push({ case: name, status: answer.status, named: errors.some(e => e.includes('contextVocabulary') && e.includes(offending)), errors });
    }
    expect(outcomes.map(o => ({ case: o.case, status: o.status, named: o.named })),
      `P36.CH1 — each is refused (422) with an error naming contextVocabulary and the offending value: ${JSON.stringify(outcomes.map(o => [o.case, o.errors]))}`)
      .toEqual(refusals.map(([name]) => ({ case: name, status: 422, named: true })));
    expect((await loadDocument(m, 'learn')).revision, 'P36.CH1 — and no refused document wrote a revision').toBe(revision);
  }, 120_000);

  for (const host of HOSTS) {
    it(`host (${host}): once the vocabulary is published, with no deployment, the next SMS arrival records sms on the shopper's visit and the decision's cell is sms`, async () => {
      const m = await mount(host, NO_SETTINGS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const sms = ARRIVALS.find(a => a.name === 'SMS')!;
      const before = await arriveWith(m, sms.entry);
      expect(before.status, `${host}: PRECONDITION — the arrival is accepted`).toBe(200);
      expect((await visitOf(before.v)).entryChannel, `${host}: CONTROL — before the vocabulary the SMS arrival falls through to today's direct`).toBe('direct');
      expect((await publishLearn(m, { contextVocabulary: VOCABULARY })).status, `${host}: PRECONDITION — the learn document publishes`).toBe(200);
      const after = await arriveWith(m, sms.entry);
      expect(after.status, `${host}: PRECONDITION — the arrival is accepted`).toBe(200);
      expect.soft((await visitOf(after.v)).entryChannel, `${host}: P36.CH1 — the next arrival is classified by the published rules: sms on the shopper's visit`).toBe('sms');
      const snap = await after.v.snapshot(HOME, { entry: sms.entry });
      expect(snap.status, `${host}: PRECONDITION — the shopper's page is served`).toBe(200);
      const cells = await cellsOf(m, after.v, snap.decisions.map(d => d.decisionId));
      expect(cells.map(c => c?.channel), `${host}: P36.CH1 — and the shopper's decisions are made in the sms cell`).toEqual(snap.decisions.map(() => 'sms'));
    }, 120_000);
  }
});

// ===========================================================================
// unit:P36.CH2 — the nine channels, unknown never a guess, today's locks hold
// ===========================================================================

describe('unit:P36.CH2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on the tenant's published vocabulary an arrival tagged as each of the nine channels records that channel on the shopper's visit, the brand split read from the utm_campaign rule, and an arrival no rule names records unknown`, async () => {
      const m = await mount(host, SETTINGS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const seen: Array<[string, number, unknown]> = [];
      for (const arrival of ARRIVALS) {
        const { v, status } = await arriveWith(m, arrival.entry);
        seen.push([arrival.name, status, status === 200 ? (await visitOf(v)).entryChannel ?? null : 'refused']);
      }
      expect(seen, `${host}: P36.CH2 — each arrival is accepted and classified by the published mapping (nine values, null where no rule holds)`)
        .toEqual(ARRIVALS.map(a => [a.name, 200, a.vocabulary]));
      expect(new Set(ARRIVALS.map(a => a.vocabulary).filter(Boolean)), 'the fixture names every one of the nine values').toEqual(new Set(NINE));
    }, 180_000);

    it(`host (${host}): LOCK — on a tenant without the settings the same arrivals (without utm_campaign) classify exactly as today's six words, so the W16.C2 classification locks hold`, async () => {
      const m = await mount(host, NO_SETTINGS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const seen: Array<[string, number, unknown]> = [];
      for (const arrival of ARRIVALS) {
        const entry = { ...arrival.entry };
        delete entry.utmCampaign;
        const { v, status } = await arriveWith(m, entry);
        seen.push([arrival.name, status, status === 200 ? (await visitOf(v)).entryChannel ?? null : 'refused']);
      }
      // LOCKED (src/services/visit.ts:239-250, :426-474, :144-148): today's words.
      expect(seen, `${host}: P36.CH2 — a tenant without the settings keeps today's classification`).toEqual(ARRIVALS.map(a => [a.name, 200, a.today]));
    }, 180_000);
  }

  // R-P46: the places a channel is named. The home hero carries the seed rules
  // (unit:W16.C3) and the product page its declared layout slot with the
  // per-context orders (P01, on P02's declaration).
  const ORDER_SMS = [M.editorial, M.grid, M.ugc, M.reco1];
  const ORDER_BRAND = [M.reco2, M.reco1, M.grid, M.editorial];
  const CHANNEL_SEEDS = [lineSeed('entry_channel', 'sms', 'Meadow', 0.6), lineSeed('entry_channel', 'paid_search_brand', 'Summit', 0.4)];
  const CHANNEL_ORDERS = [{ context: { channel: 'sms', visitBuckets: 'any' }, modules: ORDER_SMS },
    { context: { channel: 'paid_search_brand', visitBuckets: 'any' }, modules: ORDER_BRAND }];
  /** The slots document of both pages (governanceVersion 4, the version of the layout declaration), with the seed rules and the orders given. */
  const namedSlots = (seeds?: unknown[], orders?: unknown[]) => ({ version: 'parity5-slots', governanceVersion: 4,
    pages: { [HOME]: [heroSlot(seeds)], pdp: [layoutSlot(orders ? { orders } : {}), recentSlot()] } });
  /** Both pages' pieces and slots; the learn document with the vocabulary when one is given. */
  const namedDocs = (vocabulary?: unknown) => ({ pieces: [...HOME_PIECES, ...MODULES], slots: namedSlots(),
    learn: homeLearn({ slots: { [HERO]: { measurementBasis: 'served-v1', reward: 'click' }, [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click' } },
      ...(vocabulary ? { contextVocabulary: vocabulary } : {}) }) });
  /** A slots write: its status, and whether one of its errors carries the given words. */
  async function written(m: Mounted, document: unknown, words: string): Promise<[number, boolean]> {
    const answer = await putSlots(m, document, 'channels where a channel is named');
    return [answer.status, errorsOf(answer).some(e => e.includes(words))];
  }

  for (const host of HOSTS) {
    it(`host (${host}): R-P46 — on a tenant with the vocabulary a seed rule's entry_channel and a per-context order's channel admit the tenant's channel ids (sms, paid_search_brand) and refuse a word outside them; an SMS and a brand-search arrival are lifted by their rule and served their order`, async () => {
      const m = await mount(host, namedDocs(VOCABULARY));
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const published = await putSlots(m, namedSlots(CHANNEL_SEEDS, CHANNEL_ORDERS), 'seeds and orders on the tenant channels');
      expect(published.status, `${host}: P36.CH2 — seed rules and per-context orders naming sms and paid_search_brand publish: ${JSON.stringify(errorsOf(published))}`).toBe(200);
      // paid_search is one of today's six words and not one of this tenant's values.
      const outside = [
        await written(m, namedSlots([lineSeed('entry_channel', 'paid_search', 'Coast', 0.5)], CHANNEL_ORDERS), 'entry_channel'),
        await written(m, namedSlots(CHANNEL_SEEDS, [...CHANNEL_ORDERS, { context: { channel: 'paid_search', visitBuckets: 'any' }, modules: ORDER_SMS }]), `'paid_search'`),
      ];
      expect.soft(outside, `${host}: P36.CH2 — a seed rule and an order naming paid_search, a word outside the tenant's vocabulary, are refused (422) as today's validators name them`)
        .toEqual([[422, true], [422, true]]);
      const served: Array<[string, unknown, unknown]> = [];
      for (const name of ['SMS', 'paid search, brand']) {
        const { v, status } = await arriveWith(m, ARRIVALS.find(a => a.name === name)!.entry);
        expect(status, `${host}: PRECONDITION — the ${name} arrival is accepted`).toBe(200);
        // Later pages of the visit carry no arrival of their own: the channel is the one recorded on the visit.
        const home = await v.snapshot(HOME);
        const pdp = await v.snapshot('pdp', { pageInstance: pageInstanceOf('p36-ch2') });
        expect([home.status, pdp.status], `${host}: PRECONDITION — the ${name} shopper's pages are served`).toEqual([200, 200]);
        served.push([name, heroOf(home).filter(([, score]) => (score ?? 0) > 0), servedIn(pdp, LAYOUT)]);
      }
      expect(served, `${host}: P36.CH2 — the SMS arrival is lifted by the sms rule and served the sms order, the brand-search arrival by the paid_search_brand rule and its order`)
        .toEqual([['SMS', [['story.meadow', 0.6]], ORDER_SMS], ['paid search, brand', [['story.summit', 0.4]], ORDER_BRAND]]);
    }, 180_000);
  }

  it('host: LOCK — on a tenant without the settings a seed rule\'s entry_channel and a per-context order\'s channel admit exactly today\'s six words: sms is refused as today and email publishes', async () => {
    const m = await mount('session', namedDocs());
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const order = (channel: string) => [{ context: { channel, visitBuckets: 'any' }, modules: ORDER_SMS }];
    // LOCKED (src/content/kinds.ts:279, :359-360; unit:W16.C3, unit:P01.O5): the six words, exactly.
    expect([
      await written(m, namedSlots([lineSeed('entry_channel', 'sms', 'Meadow', 0.6)]), 'entry_channel'),
      await written(m, namedSlots(undefined, order('sms')), `'sms'`),
      await written(m, namedSlots([lineSeed('entry_channel', 'email', 'Meadow', 0.6)], order('email')), 'entry_channel'),
    ], 'P36.CH2 — a tenant without the settings keeps the six words where a channel is named').toEqual([[422, true], [422, true], [200, false]]);
  }, 120_000);

  // R-P54 (3): the bound on utm_campaign is the one utm_source carries, 256
  // characters (src/services/visit.ts:115 at 88e39487, ENTRY_LIMITS; kit 03:705
  // "256 characters, like `utmSource`"). A 256-character campaign is kept on the
  // arrival: its last token is `brand`, so the published brand rule reads it as
  // paid_search_brand only when the whole value is kept (a campaign cut short or
  // dropped reads paid_search_nonbrand); a 257-character one is refused 400, as
  // every over-long arrival field is (the review's probe B on both hosts).
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — R-P54 (3): a 256-character utm_campaign is kept on the arrival, its last token read by the published brand rule, and a 257-character one is refused (400)`, async () => {
      const m = await mount(host, SETTINGS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const campaignOf = (length: number) => `${'c'.repeat(length - '_brand'.length)}_brand`;
      const tagged = (length: number) => ({ utmMedium: 'cpc', utmSource: 'google', utmCampaign: campaignOf(length), referrer: 'www.google.com', siteHost: SITE });
      expect([campaignOf(256).length, campaignOf(257).length], 'the fixture: campaigns of 256 and 257 characters').toEqual([256, 257]);
      const kept = await arriveWith(m, tagged(256));
      const recorded = kept.status === 200 ? (await visitOf(kept.v)).entryChannel ?? null : 'refused';
      const over = await arriveWith(m, tagged(257));
      // LOCKED (src/services/visit.ts:115 and :175-176 at 88e39487; the SDK drops the same bound at the page, src/sdk/identity.ts:97).
      expect([kept.status, recorded, over.status],
        `${host}: P36.CH2 — the 256-character campaign is accepted and read whole (paid_search_brand), the 257-character one refused 400`)
        .toEqual([200, 'paid_search_brand', 400]);
    }, 120_000);
  }

  // R-P55 (the lead's ruling of 2026-10-12, P36 fix round 2, after the verification
  // at 7c6e0e22, P36/fix1/reviewer/REPORT.md section 6): the P07 fan-in classifies
  // an arrival exactly as the pipeline stores it. A context population is fed by
  // every scored event at the entry channel and visit bucket of the visit it
  // belongs to (kit 02:341-346 at 7c6e0e22, "Scored events ... fan into
  // population shares per tenant, entry channel and visit bucket"); the visit's
  // entry channel is the one the tenant's published mapping records (CH1 and the
  // first CH2 leg above), so on this tenant an SMS arrival is sms and an arrival
  // whose medium no rule names is unknown. Only today's six channel words and
  // today's three buckets have a context population (src/reflex/regionTrend.ts:
  // 65-81; R-P55's kit statement), so the sms and unknown arrivals count in no
  // population at all: no six-word scope holds them and no `ctx:sms` or
  // `ctx:unknown` scope exists; the direct populations hold the direct arrivals'
  // events alone, and the hourly roll-up sums a channel's buckets into the
  // channel alone (kit 02:344-346). The population's bucket is today's under any
  // published cut (R-P55, "today's three buckets"), so a third visit counts at
  // '2-3'. A first-time direct shopper (λ 1: a page view is weighed 0, so the
  // shopper holds no personal evidence) reads the direct pair when it has at
  // least `minEvents` events, else the channel alone, and nothing when neither
  // exists (kit 02:346-349; unit:P07.C2): before any direct arrival, nothing;
  // after three direct first visits on the Harbor line, the pair (3 events, the
  // minimum) with the shares of the Harbor line and its category alone, so the
  // prior contributes λ × (1 × 1 for the line + 1 × 0.5 for the category) = 1.5
  // to the Harbor piece (the slot's weights, HERO_WEIGHTS; P07's Σ λ·share·w,
  // src/content/decide.ts:866-880) and to no other piece, and only the Harbor
  // piece's receipt names "population prior, direct, first visit". The tenant:
  // the vocabulary of the legs above with the cut [1, 2, 3, 6] (the reviewer's
  // fixture) and P07's block as the P07 unit sets it (enabled, kBlend 1,
  // minEvents 3), rolled up through the operator's route (publishTrends,
  // src/units/_parity2.ts). The populations are read where the decision reads
  // them, the published key `trend:v2:<tenant>:ctx:<channel>[:<bucket>]` (trendKey,
  // as src/units/P07/LEDGER.unit.test.ts:296 and :402-406 read it): its level,
  // its events (one per scored view) and the lines its shares hold (shares decay
  // with time, so only which lines they hold is compared, as unit:P07.C2 does).
  // The expected populations are derived from the fixture, never from the engine:
  // each view counts at `ctx:<channel>:<today's bucket>` and `ctx:<channel>` when
  // its channel is one of the six, the channel read from ARRIVALS (`vocabulary`
  // on this tenant, `today` on the tenant without the settings).
  // CONTROL (a LOCK, green at 7c6e0e22 and after): the tenant without the
  // settings counts the same arrivals by today's six words term for term (the
  // CH2 LOCK above: SMS and the unnamed medium are today's direct), as the P07
  // unit measures its populations, and its direct shopper is decided on them.
  /** Today's six channel words (src/services/visit.ts:37-39): the only channels with a context population. */
  const SIX_WORDS: readonly string[] = ['direct', 'paid_social', 'paid_search', 'email', 'organic', 'referral'];
  /** Today's bucket of a visit number (today's cut [1, 2, 4], src/content/cell.ts), the population's bucket under any published cut. */
  const todayBucket = (visit: number) => (visit === 1 ? '1' : visit <= 3 ? '2-3' : '4+');
  /** P07's block as the P07 unit sets it (CONTEXT_PRIOR, src/units/P07/LEDGER.unit.test.ts:137). */
  const FAN_IN_PRIOR = { enabled: true, kBlend: 1, minEvents: 3 };
  /** One scored view of the population: how its shopper arrived (an ARRIVALS name), on which visit, and the line and category viewed (the home page's own). */
  interface PopulationView { arrival: string; visit: number; line: string; category: string }
  const times = (n: number, view: PopulationView): PopulationView[] => Array.from({ length: n }, () => ({ ...view }));
  /** Three SMS first visits on Meadow, two first visits on a medium no rule names on Summit, and an SMS third visit on Coast. */
  const NOT_DIRECT: PopulationView[] = [...times(3, { arrival: 'SMS', visit: 1, line: 'Meadow', category: 'Shoes' }),
    ...times(2, { arrival: 'a medium no rule names', visit: 1, line: 'Summit', category: 'Jewelry' }),
    { arrival: 'SMS', visit: 3, line: 'Coast', category: 'Accessories' }];
  /** Three direct first visits and a direct third visit, all on Harbor. */
  const DIRECT_VIEWS: PopulationView[] = [...times(3, { arrival: 'direct', visit: 1, line: 'Harbor', category: 'Bags' }),
    { arrival: 'direct', visit: 3, line: 'Harbor', category: 'Bags' }];
  const DIRECT_ARRIVAL = ARRIVALS.find(a => a.name === 'direct')!.entry;
  /** A scored view (weight 1) of a product the catalogue does not hold, carrying the line and category the tenant's pieces name. */
  const viewOf = (view: PopulationView) => ({ type: 'product_view', data: { productId: `sku-${view.line.toLowerCase()}`, line: view.line, category: view.category } });
  type Population = Record<string, { level: string; events: number; lines: string[] }>;
  /** The context populations the views make when each arrival's channel is read as `read` names it (ARRIVALS): only the six words count. */
  function populationOf(views: PopulationView[], read: 'vocabulary' | 'today'): Population {
    const out: Population = {};
    const count = (scope: string, level: string, line: string) => {
      const entry = (out[scope] ??= { level, events: 0, lines: [] });
      entry.events += 1;
      entry.lines = [...new Set([...entry.lines, line])].sort();
    };
    for (const view of views) {
      const channel = ARRIVALS.find(a => a.name === view.arrival)![read];
      if (channel === null || !SIX_WORDS.includes(channel)) continue;
      count(`ctx:${channel}:${todayBucket(view.visit)}`, 'channel_visit', view.line);
      count(`ctx:${channel}`, 'channel', view.line);
    }
    return out;
  }
  /** Every context population published for the tenant, read where the decision reads it (trendKey, P07's read). */
  function publishedPopulation(m: Mounted): Population {
    const prefix = trendKey(TENANT, '');
    return Object.fromEntries([...m.cache.data].filter(([key]) => key.startsWith(`${prefix}ctx:`)).map(([key, value]) => {
      const snapshot = JSON.parse(value) as { level?: unknown; events?: unknown; share?: { line?: Record<string, number> } };
      return [key.slice(prefix.length), { level: String(snapshot.level), events: Number(snapshot.events), lines: Object.keys(snapshot.share?.line ?? {}).sort() }];
    }));
  }
  /** Each view by its own shopper: the visits before it open with a page view (weighed 0, so it counts nothing), 31 minutes apart, and the view opens its own visit. */
  async function populate(m: Mounted, clock: { now: number }, views: PopulationView[]): Promise<void> {
    for (const view of views) {
      const v = await visitorOn(m);
      const entry = ARRIVALS.find(a => a.name === view.arrival)!.entry;
      for (let visit = 1; visit <= view.visit; visit++) {
        if (visit > 1) clock.now += 31 * 60_000;
        expect((await v.action(visit === view.visit ? viewOf(view) : PAGE_VIEW, { entry })).status,
          `${m.host}: PRECONDITION — ${view.arrival}, visit ${visit}: the population shopper's event is accepted`).toBe(200);
      }
    }
  }
  /** A first-time direct shopper's home page: the context prior each hero record itemises, the shares each carries, and the receipts' population-prior sentences. */
  async function directFirstVisit(m: Mounted, clock: { now: number }) {
    clock.now += 60_000;
    const v = await visitorOn(m);
    expect((await v.action(PAGE_VIEW, { entry: DIRECT_ARRIVAL })).status, `${m.host}: PRECONDITION — the direct shopper's arrival is accepted`).toBe(200);
    const snap = await v.snapshot(HOME, { entry: DIRECT_ARRIVAL });
    expect(snap.status, `${m.host}: PRECONDITION — the direct shopper's page is served`).toBe(200);
    await m.drainLedger();
    const ids = new Set(snap.decisions.map(d => d.decisionId));
    const records = storedDecisions(m, v.subject).filter(r => ids.has(r.decision_id) && r.slot === HERO).sort((a, b) => a.item_id.localeCompare(b.item_id));
    expect(records.map(r => [r.cell.channel, r.cell.visit_bucket]), `${m.host}: PRECONDITION — the shopper's four hero decisions are made as a direct first visit`)
      .toEqual(HOME_ORDER.map(() => ['direct', '1']));
    const priors = records.flatMap(r => {
      const c = (r.explain as unknown as { contextPrior?: Record<string, unknown> | null }).contextPrior;
      return c ? [[r.item_id, { channel: c.channel, visitBucket: c.visitBucket, level: c.level, events: c.events, lambda: c.lambda, contribution: c.contribution }] as const] : [];
    });
    const shares = records.map(r => (r.inputs as unknown as { context_share?: unknown } | undefined)?.context_share ?? 'no context shares');
    const sentences = (await receiptsOf(m, v.subject)).filter(r => r.slot === HERO && ids.has(String(r.decision_id)))
      .flatMap(r => ((r.why ?? []) as string[]).filter(w => /population prior/i.test(w)).map(w => [String(r.item), /population prior, direct, first visit/i.test(w)] as const));
    return { priors, shares, sentences };
  }

  for (const host of HOSTS) {
    it(`host (${host}): R-P55 — on the tenant whose vocabulary names sms (cut [1, 2, 3, 6]) with the context prior's block on, the population fan-in reads each arrival as the visit records it: SMS arrivals and arrivals the vocabulary leaves unknown count in no context population, the direct populations hold the direct arrivals' events alone, and a first-time direct shopper is decided on those alone (on nothing before any direct arrival), its receipts itemising no other arrival as direct`, async () => {
      const m = await mount(host, { ...NO_SETTINGS, learn: homeLearn({ contextVocabulary: { ...VOCABULARY, visitBuckets: [1, 2, 3, 6] }, contextPrior: FAN_IN_PRIOR }) });
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const trend = bindTrend(m);
      const clock = { now: Date.now() + 60_000 };
      const mocked = vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
      try {
        // Before any direct arrival: the SMS arrivals and the arrivals no rule names.
        await populate(m, clock, NOT_DIRECT);
        clock.now += 60_000;
        await publishTrends(m, trend);
        const before = populationOf(NOT_DIRECT, 'vocabulary');
        expect([before['ctx:direct:1'] ?? 'none', before['ctx:direct'] ?? 'none'], 'the fixture: before any direct arrival there is no direct population to read').toEqual(['none', 'none']);
        expect.soft(publishedPopulation(m),
          `${host}: P36.CH2 — R-P55: SMS arrivals (sms) and arrivals the vocabulary leaves unknown count in no context population: no six-word scope holds them, no ctx:sms or ctx:unknown scope exists`)
          .toEqual(before);
        expect.soft(await directFirstVisit(m, clock),
          `${host}: P36.CH2 — R-P55: before any direct arrival a first-time direct shopper is decided on no context prior: no record itemises one or carries its shares, no receipt names the population prior`)
          .toEqual({ priors: [], shares: HOME_ORDER.map(() => 'no context shares'), sentences: [] });

        // Then the direct arrivals.
        await populate(m, clock, DIRECT_VIEWS);
        clock.now += 60_000;
        await publishTrends(m, trend);
        const after = populationOf([...NOT_DIRECT, ...DIRECT_VIEWS], 'vocabulary');
        expect(after, 'the fixture: the direct pair of the first visit holds the three Harbor views, at the minimum').toMatchObject({ 'ctx:direct:1': { events: FAN_IN_PRIOR.minEvents, lines: ['Harbor'] } });
        expect.soft(publishedPopulation(m),
          `${host}: P36.CH2 — R-P55: ctx:direct:1 and ctx:direct:2-3 hold exactly the direct arrivals' events (3 and 1, the Harbor line alone), the channel alone their sum, and still no scope holds an SMS or unknown arrival`)
          .toEqual(after);
        expect.soft(await directFirstVisit(m, clock),
          `${host}: P36.CH2 — R-P55: a first-time direct shopper reads the direct pair of the first visit, the direct arrivals' shares alone (Harbor, Bags): the prior contributes 1.5 to the Harbor piece and nothing to the SMS or unknown arrivals' lines, and only the Harbor piece's receipt names "population prior, direct, first visit"`)
          .toEqual({
            priors: [['story.harbor', { channel: 'direct', visitBucket: '1', level: 'channel_visit', events: 3, lambda: 1, contribution: 1.5 }]],
            shares: HOME_ORDER.map(() => ({ category: { Bags: 1 }, line: { Harbor: 1 } })),
            sentences: [['story.harbor', true]],
          });
      } finally { mocked.mockRestore(); }
    }, 180_000);

    it(`host (${host}): LOCK — R-P55 CONTROL: on a tenant without the settings, with the context prior's block on, the same arrivals count by today's six words term for term (SMS and the unnamed medium as direct), and a first-time direct shopper is decided on that direct population`, async () => {
      const m = await mount(host, { ...NO_SETTINGS, learn: homeLearn({ contextPrior: FAN_IN_PRIOR }) });
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const trend = bindTrend(m);
      const clock = { now: Date.now() + 60_000 };
      const mocked = vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
      try {
        const views = [...NOT_DIRECT, ...DIRECT_VIEWS];
        await populate(m, clock, views);
        clock.now += 60_000;
        await publishTrends(m, trend);
        const today = populationOf(views, 'today');
        // LOCKED (src/services/visit.ts:239-250, :426-474: today's words; src/reflex/regionTrend.ts:65-81; unit:P07.C3): today's populations.
        expect(publishedPopulation(m), `${host}: P36.CH2 — a tenant without the settings counts every arrival by today's six words, term for term`).toEqual(today);
        const pair = today['ctx:direct:1']!;
        const read = await directFirstVisit(m, clock);
        expect([read.priors.map(([item, c]) => [item, { ...c, contribution: 'a share of the pair' }]), read.sentences],
          `${host}: P36.CH2 — and a first-time direct shopper there is decided on that direct pair (${pair.events} events), the prior itemised on each piece of a line it holds`)
          .toEqual([HOME_PIECES.filter(p => pair.lines.includes(p.tags.line[0])).map(p => p.id).sort()
            .map(item => [item, { channel: 'direct', visitBucket: '1', level: 'channel_visit', events: pair.events, lambda: 1, contribution: 'a share of the pair' }]),
          HOME_PIECES.filter(p => pair.lines.includes(p.tags.line[0])).map(p => p.id).sort().map(item => [item, true])]);
      } finally { mocked.mockRestore(); }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P36.CH3 — source platform and landing-page type, on the visit and as seed keys
// ===========================================================================

describe('unit:P36.CH3', () => {
  /** Seed rules on the two keys, each tagging its own line, so the lifted piece names the rule that fired. */
  const SEEDS = [
    lineSeed('source_platform', 'meta', 'Meadow', 0.6),
    lineSeed('source_platform', 'tiktok', 'Summit', 0.4),
    lineSeed('landing_page_type', 'product', 'Coast', 0.5),
  ];
  const lifted = (snap: { decisions: Array<{ contentId: string; slot: string; order: number; score?: number }> }) => heroOf(snap).filter(([, score]) => (score ?? 0) > 0);
  /** Mount the tenant with its vocabulary, and publish the seed rules with the merchandiser's own save. */
  async function seeded(host: Host) {
    const m = await mount(host, SETTINGS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const written = await putSlots(m, homeSlots(SEEDS), 'seeds on the source platform and the landing-page type');
    expect(written.status, `${host}: P36.CH3 — seed rules naming source_platform and landing_page_type publish: ${JSON.stringify(errorsOf(written))}`).toBe(200);
    return m;
  }

  for (const host of HOSTS) {
    it(`host (${host}): the source platform from the referrer's network or a token-form utm_source is recorded on the shopper's visit and lifts a matching arrival at the rule's weight, itemised on the receipt; a non-matching arrival is not lifted`, async () => {
      const m = await seeded(host);
      const cases: Array<[string, Record<string, string>, Array<[string, number]>]> = [
        // The referrer's network: instagram.com is Meta's (investigation §2.5).
        ['an untagged click from instagram.com', { referrer: 'l.instagram.com', siteHost: SITE }, [['story.meadow', 0.6]]],
        // A token-form utm_source (DI-2): facebook names facebook.com, Meta's.
        ['a token-form utm_source facebook_ads', { utmMedium: 'paid_social', utmSource: 'facebook_ads', referrer: '', siteHost: SITE }, [['story.meadow', 0.6]]],
        ['a token-form utm_source tiktok', { utmMedium: 'paid_social', utmSource: 'tiktok', referrer: '', siteHost: SITE }, [['story.summit', 0.4]]],
        // A network no platform lists, and no network at all: no rule fires.
        ['a click from a blog', { referrer: 'blog.example.org', siteHost: SITE }, []],
        ['a direct arrival', { referrer: '', siteHost: SITE }, []],
      ];
      const seen: Array<[string, Array<[string, number | undefined]>]> = [];
      for (const [name, entry] of cases) {
        const v = await visitorOn(m);
        expect((await v.action(PAGE_VIEW, { entry })).status, `${host}: PRECONDITION — ${name}: the shopper's page view is accepted`).toBe(200);
        // A later page of the same visit carries no arrival of its own: the platform it is decided with is the one recorded on the visit.
        const snap = await v.snapshot(HOME);
        expect(snap.status, `${host}: PRECONDITION — ${name}: the shopper's page is served`).toBe(200);
        seen.push([name, lifted(snap)]);
      }
      expect(seen, `${host}: P36.CH3 — the platform recorded on the visit lifts the matching piece at exactly the rule's weight (× the slot weight 1), and nothing else`)
        .toEqual(cases.map(([name, , expected]) => [name, expected]));

      const v = await visitorOn(m);
      await v.action(PAGE_VIEW, { entry: { referrer: 'l.instagram.com', siteHost: SITE } });
      await v.snapshot(HOME);
      const why = whyOf(await receiptsOf(m, v.subject), 'story.meadow');
      expect(why.some(s => /source platform/i.test(s) && s.includes('meta')),
        `${host}: P36.CH3 — the receipt itemises the source-platform rule that lifted it (why: ${JSON.stringify(why)})`).toBe(true);
    }, 180_000);

    it(`host (${host}): the landing-page type is the first page type of the visit, recorded on the shopper's visit and kept for its later pages, and lifts a matching arrival at the rule's weight, itemised on the receipt; a non-matching arrival is not lifted`, async () => {
      const m = await seeded(host);
      const direct = { referrer: '', siteHost: SITE };
      const cases: Array<[string, string[], Array<[string, number]>]> = [
        ['landed on a product page', ['product'], [['story.coast', 0.5]]],
        // Kept for the visit: a later category page does not change the landing type.
        ['landed on a product page, then a category page', ['product', 'category'], [['story.coast', 0.5]]],
        ['landed on the homepage, then a product page', ['homepage', 'product'], []],
        ['landed on a page type the vocabulary does not list', ['wombat'], []],
      ];
      const seen: Array<[string, Array<[string, number | undefined]>]> = [];
      for (const [name, pages] of cases) {
        const v = await visitorOn(m);
        for (const pageType of pages) expect((await v.action(pageView(pageType), { entry: direct })).status, `${host}: PRECONDITION — ${name}: page view accepted`).toBe(200);
        const snap = await v.snapshot(HOME);
        expect(snap.status, `${host}: PRECONDITION — ${name}: the shopper's page is served`).toBe(200);
        seen.push([name, lifted(snap)]);
      }
      expect(seen, `${host}: P36.CH3 — the landing-page type recorded on the visit lifts the matching piece at exactly the rule's weight, and nothing else`)
        .toEqual(cases.map(([name, , expected]) => [name, expected]));

      const v = await visitorOn(m);
      await v.action(pageView('product'), { entry: direct });
      await v.snapshot(HOME);
      const why = whyOf(await receiptsOf(m, v.subject), 'story.coast');
      expect(why.some(s => /landing page type/i.test(s) && s.includes('product')),
        `${host}: P36.CH3 — the receipt itemises the landing-page-type rule that lifted it (why: ${JSON.stringify(why)})`).toBe(true);
    }, 180_000);
  }

  // R-P54 (2): "the first page type of the visit" is the first event of the visit
  // carrying a page type the tenant's vocabulary names (kit 03:695 at 88e39487).
  // An event with no page type or with a type the vocabulary does not list does
  // not set it, so a later product page does; once set, a later page of the visit
  // never replaces it (the review's reading 3, the build's reading confirmed). A
  // second rule on the category type, tagging its own line, makes each case name
  // the type that was kept.
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — R-P54 (2): the landing-page type is the first event of the visit carrying a type the vocabulary names: a first page view with no page type or an unknown one does not set it, so a later product page does and lifts the matching arrival, and a type once set is kept when a later page names another`, async () => {
      const m = await mount(host, SETTINGS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const written = await putSlots(m, homeSlots([...SEEDS, lineSeed('landing_page_type', 'category', 'Harbor', 0.3)]), 'seeds on two landing-page types');
      expect(written.status, `${host}: PRECONDITION — seed rules naming landing_page_type product and category publish: ${JSON.stringify(errorsOf(written))}`).toBe(200);
      const direct = { referrer: '', siteHost: SITE };
      const cases: Array<[string, Array<string | undefined>, Array<[string, number]>]> = [
        ['a first page view with no page type, then a product page', [undefined, 'product'], [['story.coast', 0.5]]],
        ['a first page view of a type the vocabulary does not list (wombat), then a product page', ['wombat', 'product'], [['story.coast', 0.5]]],
        ['a page view with no type, then a product page, then a category page', [undefined, 'product', 'category'], [['story.coast', 0.5]]],
        ['an unknown type, then a category page, then a product page', ['wombat', 'category', 'product'], [['story.harbor', 0.3]]],
      ];
      const seen: Array<[string, Array<[string, number | undefined]>]> = [];
      for (const [name, pages] of cases) {
        const v = await visitorOn(m);
        for (const pageType of pages) expect((await v.action(pageView(pageType), { entry: direct })).status, `${host}: PRECONDITION — ${name}: page view accepted`).toBe(200);
        // A later page of the same visit: the landing-page type it is decided with is the one recorded on the visit.
        const snap = await v.snapshot(HOME);
        expect(snap.status, `${host}: PRECONDITION — ${name}: the shopper's page is served`).toBe(200);
        seen.push([name, lifted(snap)]);
      }
      // LOCKED (src/services/visit.ts:277-281 and :347 at 88e39487): the first event naming a vocabulary type sets it, and it is kept.
      expect(seen, `${host}: P36.CH3 — the landing-page type is the first type the vocabulary names, kept for the visit: the rule of that type, and only it, lifts its piece at the rule's weight`)
        .toEqual(cases.map(([name, , expected]) => [name, expected]));
    }, 180_000);
  }
});

// ===========================================================================
// unit:P36.CH4 — the page's own channel, only from the tenant's vocabulary
// ===========================================================================

describe('unit:P36.CH4', () => {
  /** A shopper with no arrival of their own (no page view): the page's own channel is all the decision has. */
  async function pageChannels(m: Mounted, channels: string[]): Promise<Array<[string, unknown]>> {
    const out: Array<[string, unknown]> = [];
    for (const channel of channels) {
      const v = await visitorOn(m);
      const snap = await v.snapshot(HOME, { channel });
      expect(snap.status, `${m.host}: PRECONDITION — the page passing channel ${channel} is served`).toBe(200);
      const cells = await cellsOf(m, v, snap.decisions.map(d => d.decisionId));
      expect(cells.every(Boolean), `${m.host}: PRECONDITION — the ledger holds the decisions of channel ${channel}`).toBe(true);
      out.push([channel, cells[0]?.channel]);
    }
    return out;
  }
  for (const host of HOSTS) {
    it(`host (${host}): on a tenant with the vocabulary the page may pass its own channel only as one of the tenant's values; a word outside the vocabulary, even one of today's six, is ignored`, async () => {
      const m = await mount(host, SETTINGS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      expect(await pageChannels(m, ['sms', 'paid_search_brand', 'paid_search', 'wombat']),
        `${host}: P36.CH4 — sms and paid_search_brand are the tenant's values; paid_search (no longer a value) and wombat are ignored as unknown`)
        .toEqual([['sms', 'sms'], ['paid_search_brand', 'paid_search_brand'], ['paid_search', 'unknown'], ['wombat', 'unknown']]);
    }, 120_000);

    it(`host (${host}): LOCK — on a tenant without the settings the page may pass one of today's six words, and any other word is ignored as today`, async () => {
      const m = await mount(host, NO_SETTINGS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      // LOCKED (src/content/cell.ts:64 with src/services/visit.ts:121-125): the six words, else unknown.
      expect(await pageChannels(m, ['email', 'sms', 'wombat']), `${host}: P36.CH4 — today's six words only`)
        .toEqual([['email', 'email'], ['sms', 'unknown'], ['wombat', 'unknown']]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P36.CH5 — the tenant without the settings as today; the grammar bump
// ===========================================================================

describe('unit:P36.CH5', () => {
  /** A priors document exported under today's grammar, declaring it (W25: src/learn/priors.ts:70-77; kit 03:609-615). */
  const PRIORS_TODAY = { version: 'parity5-priors', cellGrammar: { name: 'ladder-cell', version: 2, order: ['c', 'v', 's', 'r', 'a'] },
    rows: [{ slot: 'home-hero', item: 'story.harbor', cell: 'c=email', p_prior: 0.05, n_equiv: 20 }] };
  const PRIORS_UNDECLARED = { version: 'parity5-priors', rows: [{ slot: 'home-hero', item: 'story.harbor', cell: '*', p_prior: 0.05, n_equiv: 20 }] };

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a tenant without the settings keeps today's words, visit buckets and ladder term for term: four visits decide in cells 1, 2-3 and 4+, each decision replays equal, and a priors file exported under today's grammar imports`, async () => {
      // Mounted first, so the operator token minted at mount stays current under every clock below (all in the past).
      const m = await mount(host, NO_SETTINGS, { recovery: false });
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const T0 = Date.now() - 2 * 86_400_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
      try {
        const v = await visitorOn(m);
        const sms = ARRIVALS.find(a => a.name === 'SMS')!.entry;
        const cells: unknown[] = [], decisions: string[] = [];
        for (let visit = 1; visit <= 4; visit++) {
          clock.mockReturnValue(T0 + (visit - 1) * 31 * 60_000);
          expect((await v.action(PAGE_VIEW, { entry: sms })).status, `${host}: PRECONDITION — visit ${visit} opens`).toBe(200);
          const snap = await v.snapshot(HOME, { entry: sms });
          expect(heroOf(snap).map(([id]) => id), `${host}: PRECONDITION — visit ${visit} is served the catalogue order`).toEqual(HOME_ORDER);
          const stored = await cellsOf(m, v, snap.decisions.map(d => d.decisionId));
          cells.push(stored[0]);
          decisions.push(...snap.decisions.map(d => String(d.decisionId)));
        }
        // LOCKED: today's word for an SMS arrival (src/services/visit.ts:426-474 → direct), today's bucket cut
        // (src/content/cell.ts:44-49), the cell's five keys (src/content/cell.ts:61-70).
        expect(cells, `${host}: P36.CH5 — today's word and buckets, term for term`).toEqual([1, 2, 3, 4].map(n => ({
          channel: 'direct', visit_bucket: n === 1 ? '1' : n <= 3 ? '2-3' : '4+', region: null, affinity: null, stage: 'early' })));
        const replays: unknown[] = [];
        for (const id of decisions) {
          const replay = await replayOf(m, id);
          replays.push([replay.status, replay.body.classification ?? replay.body.reason ?? null]);
        }
        expect(replays, `${host}: P36.CH5 — every decision replays equal`).toEqual(decisions.map(() => [200, 'equal']));
        const imported = await putKind(m, 'priors', PRIORS_TODAY, 'today’s grammar');
        expect(imported.status, `${host}: P36.CH5 — a priors file exported under today's grammar imports: ${JSON.stringify(errorsOf(imported))}`).toBe(200);
      } finally { clock.mockRestore(); }
    }, 180_000);
  }

  it('host: a tenant whose published vocabulary changes the channel values gets the W25 grammar bump — a priors file exported under the previous vocabulary is refused naming cellGrammar, with the migration sentence naming the re-export, while a file declaring nothing is read under the current grammar', async () => {
    const m = await mount('session', NO_SETTINGS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    expect((await putKind(m, 'priors', PRIORS_TODAY, 'before')).status, 'CONTROL — before the vocabulary the file exported under today’s grammar imports').toBe(200);
    expect((await publishLearn(m, { contextVocabulary: VOCABULARY })).status, 'PRECONDITION — the vocabulary (nine values in place of six) publishes').toBe(200);
    const refused = await putKind(m, 'priors', PRIORS_TODAY, 'after');
    const errors = errorsOf(refused);
    expect([refused.status, errors.some(e => e.includes('cellGrammar') && /re-?export/i.test(e))],
      `P36.CH5 — the file exported under the previous vocabulary is refused, naming cellGrammar and the re-export (${JSON.stringify(errors)})`).toEqual([422, true]);
    expect((await putKind(m, 'priors', PRIORS_UNDECLARED, 'undeclared')).status, 'P36.CH5 — a file declaring nothing is read under the current grammar (W25)').toBe(200);
  }, 120_000);

  // R-P46: the published visit buckets and ladder depth applied. Every shopper below
  // arrives direct, a word both the six and the nine name, so only the setting under
  // test moves anything.
  const DIRECT = { referrer: '', siteHost: SITE };
  /** A published cut other than today's [1, 2, 4]: buckets 1, 2, 3-5 and 6+. */
  const CUT = [1, 2, 3, 6];
  /** The vocabulary with the ladder cut at depth 2: everyone, channel, channel and visit bucket. */
  const DEPTH_2 = { ...VOCABULARY, ladder: { order: ['c', 'v', 's', 'r', 'a'], depth: 2 } };
  /** A cold shopper's first visit, arrived direct: the cell the learned rows below are counted in (src/content/cell.ts:61-70). */
  const DIRECT_FIRST = { channel: 'direct', visit_bucket: '1' as const, region: null, affinity: null, stage: 'early' as const };
  /** story.harbor learned at every level of that cell (40 served exposures, 10 clicks), more than the 30 a level needs to answer (nMin). */
  const LEARNED = [{ item: 'story.harbor', exposures: 40, successes: 10 }, { item: 'story.meadow', exposures: 40, successes: 0 }];

  /** The grammar the tenant reads now, as the refusal of a file declaring a grammar no tenant reads names it (today's sentence, src/learn/priors.ts:110). */
  async function grammarInForce(m: Mounted): Promise<{ name: string; version: number; order: string[] } | null> {
    const answer = await putKind(m, 'priors', { version: 'parity5-probe', cellGrammar: { name: 'ladder-cell', version: 0, order: [] }, rows: [] }, 'grammar probe');
    const said = errorsOf(answer).join(' ').match(/reads (\S+) version (\d+), whose cells are ((?:[a-z]+=(?:, )?)+) in that order/);
    return answer.status === 422 && said ? { name: said[1]!, version: Number(said[2]), order: said[3]!.split(', ').map(k => k.replace(/=$/, '')) } : null;
  }
  /** A cold, direct, first-visit shopper's home page: the level and the words of story.harbor's learned lift on the stored record. */
  async function harborLift(m: Mounted): Promise<unknown> {
    const v = await visitorOn(m);
    expect((await v.action(PAGE_VIEW, { entry: DIRECT })).status, `${m.host}: PRECONDITION — the shopper's arrival is accepted`).toBe(200);
    const snap = await v.snapshot(HOME, { entry: DIRECT });
    expect(snap.status, `${m.host}: PRECONDITION — the shopper's page is served`).toBe(200);
    await m.drainLedger();
    const ids = new Set(snap.decisions.map(d => d.decisionId));
    const record = storedDecisions(m, v.subject).find(r => ids.has(r.decision_id) && r.item_id === 'story.harbor');
    expect(record?.cell, `${m.host}: PRECONDITION — the shopper is decided in the learned cell`).toEqual(DIRECT_FIRST);
    const lift = (record?.explain as unknown as { lift?: { level?: number; level_words?: string } | null } | undefined)?.lift;
    return lift ? [lift.level, lift.level_words] : 'no learned lift on the record';
  }

  for (const host of HOSTS) {
    it(`host (${host}): R-P46 — a published visit-bucket cut changes the shopper's bucket: under the cut [1, 2, 3, 6] four visits decide in the buckets 1, 2, 3-5 and 3-5, where today's cut gives 1, 2-3, 2-3 and 4+`, async () => {
      // Mounted first, as the LOCK above is.
      const m = await mount(host, { ...NO_SETTINGS, learn: homeLearn({ contextVocabulary: { ...VOCABULARY, visitBuckets: CUT } }) }, { recovery: false });
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const T0 = Date.now() - 2 * 86_400_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
      try {
        const v = await visitorOn(m);
        const cells: unknown[] = [];
        for (let visit = 1; visit <= 4; visit++) {
          clock.mockReturnValue(T0 + (visit - 1) * 31 * 60_000);
          expect((await v.action(PAGE_VIEW, { entry: DIRECT })).status, `${host}: PRECONDITION — visit ${visit} opens`).toBe(200);
          const snap = await v.snapshot(HOME, { entry: DIRECT });
          expect(heroOf(snap).map(([id]) => id), `${host}: PRECONDITION — visit ${visit} is served the catalogue order`).toEqual(HOME_ORDER);
          const stored = await cellsOf(m, v, snap.decisions.map(d => d.decisionId));
          cells.push([stored[0]?.channel, stored[0]?.visit_bucket]);
        }
        expect(cells, `${host}: P36.CH5 — the published cut places visits 1 to 4 in the buckets 1, 2, 3-5 and 3-5`)
          .toEqual([['direct', '1'], ['direct', '2'], ['direct', '3-5'], ['direct', '3-5']]);
      } finally { clock.mockRestore(); }
    }, 180_000);

    it(`host (${host}): R-P46 — a published ladder depth stops the ladder there: under depth 2 a lift learned at every level is read from channel and visit bucket, never a finer level; the grammar follows the setting, so a priors file declaring the grammar in force before the change, or that version number with the new order, is refused naming cellGrammar, the grammar in force imports, and a row on a finer cell is refused`, async () => {
      const m = await mount(host, SETTINGS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const before = await grammarInForce(m);
      expect(before ? 'named' : 'not named', `${host}: PRECONDITION — a file declaring a grammar no tenant reads is refused, the refusal naming the grammar in force (src/learn/priors.ts:110)`).toBe('named');
      await learnedLift(m, HERO, LEARNED, DIRECT_FIRST, 'served-v1', HOME);
      expect(rounded(await learned(m), 'n')['story.harbor'], `${host}: PRECONDITION — story.harbor's served exposures are learned`).toBe(40);
      expect(await harborLift(m), `${host}: CONTROL — on the full ladder (depth 5) the finest level answers`).toEqual([5, 'channel, visit bucket, stage, region and affinity cell']);
      expect((await publishLearn(m, { contextVocabulary: DEPTH_2 })).status, `${host}: PRECONDITION — the vocabulary with ladder depth 2 publishes`).toBe(200);
      expect.soft(await harborLift(m), `${host}: P36.CH5 — under depth 2 the lift is read from level 2, channel and visit bucket, never from a finer level`).toEqual([2, 'channel and visit bucket']);
      const after = await grammarInForce(m);
      expect.soft(after?.order, `${host}: P36.CH5 — the grammar in force is the published order cut at depth 2 (${JSON.stringify(after)})`).toEqual(['c', 'v']);
      const priors = (cellGrammar: unknown, cell: string) => ({ version: 'parity5-priors', ...(cellGrammar ? { cellGrammar } : {}),
        rows: [{ slot: HERO, item: 'story.harbor', cell, p_prior: 0.05, n_equiv: 20 }] });
      const outcome = async (document: unknown, note: string, words: string[]) => {
        const answer = await putKind(m, 'priors', document, note);
        return [answer.status, errorsOf(answer).some(e => words.every(w => e.includes(w))), errorsOf(answer)];
      };
      const previous = await outcome(priors(before, 'c=direct'), 'exported before the change', ['cellGrammar', 're-export']);
      expect.soft(previous.slice(0, 2), `${host}: P36.CH5 — a file declaring the grammar in force before the change is refused, naming cellGrammar and the re-export (${JSON.stringify(previous[2])})`).toEqual([422, true]);
      const oldNumber = await outcome(priors(before ? { ...before, order: ['c', 'v'] } : null, 'c=direct'), 'the version before the change', ['cellGrammar']);
      expect.soft(oldNumber.slice(0, 2), `${host}: P36.CH5 — the version is derived from the setting: that version number with the new order is refused naming cellGrammar (${JSON.stringify(oldNumber[2])})`).toEqual([422, true]);
      const inForce = after ? await outcome(priors(after, 'c=direct|v=1'), 'exported under the grammar in force', []) : [0, false, ['no grammar in force named']];
      expect.soft(inForce.slice(0, 1), `${host}: P36.CH5 — a file declaring the grammar in force imports (${JSON.stringify(inForce[2])})`).toEqual([200]);
      const finer = await outcome(priors(null, 'c=direct|v=1|s=early'), 'a cell finer than the depth', ['rows[0].cell']);
      expect.soft(finer.slice(0, 2), `${host}: P36.CH5 — a row on a cell finer than the depth is refused, naming the row (${JSON.stringify(finer[2])})`).toEqual([422, true]);
    }, 180_000);
  }

  // R-P46 with the S5 fix-round-1 review's F1: the published cut is also the
  // words a P01 per-context order names. Under [1, 2, 3, 6] the buckets are '1',
  // '2', '3-5' and '6+'; an order context names one of them or `any`, never
  // today's '2-3' or '4+', and the decision matches it against the shopper's
  // bucket under the cut. Every shopper arrives direct, as above. The product
  // page is P01's: its declared layout slot (take 4) and the recently-viewed slot.
  /** The order an `any` context serves, and the order a bucket context serves: neither is the page's own catalogue walk. */
  const ANY_LAYOUT = [M.ugc, M.editorial, M.reco1, M.grid];
  const BUCKET_LAYOUT = [M.reco2, M.ugc, M.grid, M.editorial];
  const ANY_ORDER = { context: { channel: 'any', visitBuckets: 'any' }, modules: ANY_LAYOUT };
  const bucketOrder = (bucket: string) => ({ context: { channel: 'any', visitBuckets: [bucket] }, modules: BUCKET_LAYOUT });
  const pdpSlots = (orders: unknown[]) => declaredSlots([layoutSlot({ orders }), recentSlot()]);
  /** P01's page with the `any` order in force; the learn document carries the vocabulary when one is given. */
  const pdpDocs = (vocabulary?: unknown) => ({ pieces: MODULES, slots: pdpSlots([ANY_ORDER]), learn: learnDocument({}, vocabulary ? { contextVocabulary: vocabulary } : {}) });
  /** A slots write of the product page with the given orders: its status, its errors, and whether one quotes the value as today's validator quotes it. */
  async function ordersWritten(m: Mounted, orders: unknown[], value: string): Promise<{ status: number; errors: string[]; quoted: boolean }> {
    const answer = await putSlots(m, pdpSlots(orders), `orders naming ${value}`);
    const errors = errorsOf(answer);
    return { status: answer.status, errors, quoted: errors.some(e => e.includes(`'${value}'`)) };
  }
  /** One shopper's visits 1 to 3, 31 minutes apart, each opening on a direct arrival: the layout the product page serves on each. */
  async function threeVisits(m: Mounted, v: Visitor, clock: { mockReturnValue: (value: number) => unknown }, T0: number): Promise<string[][]> {
    const layouts: string[][] = [];
    for (let visit = 1; visit <= 3; visit++) {
      clock.mockReturnValue(T0 + (visit - 1) * 31 * 60_000);
      expect((await v.action(PAGE_VIEW, { entry: DIRECT })).status, `${m.host}: PRECONDITION — visit ${visit} opens`).toBe(200);
      const pdp = await v.snapshot('pdp', { pageInstance: pageInstanceOf('p36-cut-orders'), entry: DIRECT });
      expect(pdp.status, `${m.host}: PRECONDITION — visit ${visit}: the product page is served`).toBe(200);
      layouts.push(servedIn(pdp, LAYOUT));
    }
    return layouts;
  }

  for (const host of HOSTS) {
    it(`host (${host}): R-P46 (F1) — on a tenant whose published cut is [1, 2, 3, 6] a per-context order names the cut's buckets: an order naming '3-5' publishes and is served exactly to the visit-3 shopper (bucket '3-5'), not on visits 1 and 2; an any order is served to that shopper; an order naming today's '2-3' is refused quoting the value`, async () => {
      // Mounted first, as the LOCK above is.
      const m = await mount(host, pdpDocs({ ...VOCABULARY, visitBuckets: CUT }), { recovery: false });
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const T0 = Date.now() - 2 * 86_400_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
      try {
        const published = await ordersWritten(m, [ANY_ORDER, bucketOrder('3-5')], '3-5');
        expect.soft(published.status, `${host}: P36.CH5 — an order naming '3-5', a bucket of the published cut, publishes beside the any order: ${JSON.stringify(published.errors)}`).toBe(200);
        const v = await visitorOn(m);
        expect.soft(await threeVisits(m, v, clock, T0),
          `${host}: P36.CH5 — visits 1 and 2 (buckets '1' and '2') are served the any order, visit 3 (bucket '3-5') the '3-5' order exactly`)
          .toEqual([ANY_LAYOUT, ANY_LAYOUT, BUCKET_LAYOUT]);
        expect((await putSlots(m, pdpSlots([ANY_ORDER]), 'the any order alone')).status, `${host}: PRECONDITION — the any order alone publishes`).toBe(200);
        // The same visit: a later page carries no arrival of its own.
        const again = await v.snapshot('pdp', { pageInstance: pageInstanceOf('p36-cut-orders') });
        expect(again.status, `${host}: PRECONDITION — the product page is served again`).toBe(200);
        expect.soft(servedIn(again, LAYOUT), `${host}: P36.CH5 — with the any order alone the visit-3 shopper (bucket '3-5') is served the any order`).toEqual(ANY_LAYOUT);
        const today = await ordersWritten(m, [ANY_ORDER, bucketOrder('2-3')], '2-3');
        expect.soft([today.status, today.quoted],
          `${host}: P36.CH5 — an order naming '2-3', not a bucket of the published cut, is refused (422) quoting the value: ${JSON.stringify(today.errors)}`).toEqual([422, true]);
      } finally { clock.mockRestore(); }
    }, 180_000);

    it(`host (${host}): LOCK — on a tenant without the settings a per-context order names today's buckets: an order naming '2-3' publishes and is served to the shopper on visits 2 and 3, and an order naming '3-5' is refused quoting the value`, async () => {
      const m = await mount(host, pdpDocs(), { recovery: false });
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      const T0 = Date.now() - 2 * 86_400_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
      try {
        // LOCKED (src/content/kinds.ts:331, :367; src/content/decide.ts:280, :299; src/content/cell.ts:44-49; unit:P01.O5): today's words, exactly.
        const published = await ordersWritten(m, [ANY_ORDER, bucketOrder('2-3')], '2-3');
        expect(published.status, `${host}: P36.CH5 — today's '2-3' publishes: ${JSON.stringify(published.errors)}`).toBe(200);
        expect(await threeVisits(m, await visitorOn(m), clock, T0), `${host}: P36.CH5 — visit 1 is served the any order, visits 2 and 3 (bucket '2-3') the '2-3' order`)
          .toEqual([ANY_LAYOUT, BUCKET_LAYOUT, BUCKET_LAYOUT]);
        const refused = await ordersWritten(m, [ANY_ORDER, bucketOrder('3-5')], '3-5');
        expect([refused.status, refused.quoted], `${host}: P36.CH5 — '3-5' is refused (422) quoting the value: ${JSON.stringify(refused.errors)}`).toEqual([422, true]);
      } finally { clock.mockRestore(); }
    }, 180_000);
  }

  // R-P51 and the review's F3: the settings' own validation, refused as CH1
  // refuses (422, no revision written), each refusal naming the member.
  const TODAY_ORDER = ['c', 'v', 's', 'r', 'a'];
  /** The vocabulary with the given ladder and cut, everything else as published above. */
  const vocabularyWith = (ladder: unknown, visitBuckets: unknown = VOCABULARY.visitBuckets) => ({ ...VOCABULARY, visitBuckets, ladder });
  /** Publish each case: its status, its errors, and whether one of them names the member. */
  async function refusedNaming(m: Mounted, cases: Array<[string, unknown]>, member: string) {
    const outcomes: Array<{ case: string; status: number; named: boolean; errors: string[] }> = [];
    for (const [name, vocabulary] of cases) {
      const answer = await publishLearn(m, { contextVocabulary: vocabulary });
      const errors = errorsOf(answer);
      outcomes.push({ case: name, status: answer.status, named: errors.some(e => e.includes(member)), errors });
    }
    return outcomes;
  }

  it('host: R-P51 — the ladder order is confined to today\'s order c, v, s, r, a: a vocabulary naming another order is refused (422) naming contextVocabulary.ladder, writing no revision, while today\'s order with a depth publishes', async () => {
    const m = await mount('session', NO_SETTINGS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const control = await publishLearn(m, { contextVocabulary: vocabularyWith({ order: TODAY_ORDER, depth: 3 }) });
    expect(control.status, `CONTROL — today's order with depth 3 publishes: ${JSON.stringify(errorsOf(control))}`).toBe(200);
    const revision = (await loadDocument(m, 'learn')).revision;
    const cases: Array<[string, unknown]> = [
      ['channel and visit bucket swapped (v, c, s, r, a)', vocabularyWith({ order: ['v', 'c', 's', 'r', 'a'], depth: 5 })],
      // The levels consulted at depth 3 are today's c, v, s; the order named is still another order.
      ['region and affinity swapped below the depth (c, v, s, a, r at depth 3)', vocabularyWith({ order: ['c', 'v', 's', 'a', 'r'], depth: 3 })],
    ];
    const outcomes = await refusedNaming(m, cases, 'contextVocabulary.ladder');
    expect.soft(outcomes.map(o => ({ case: o.case, status: o.status, named: o.named })),
      `P36.CH5 — each is refused (422) with an error naming contextVocabulary.ladder: ${JSON.stringify(outcomes.map(o => [o.case, o.status, o.errors]))}`)
      .toEqual(cases.map(([name]) => ({ case: name, status: 422, named: true })));
    expect.soft((await loadDocument(m, 'learn')).revision, 'P36.CH5 — and no refused document wrote a revision').toBe(revision);
  }, 120_000);

  it('host: F3 — the ladder and the cut are validated: an unknown key letter, a repeated key letter or a depth outside 1 to the order\'s length is refused naming contextVocabulary.ladder, and bounds that are not whole numbers, not strictly ascending or not starting at 1 are refused naming contextVocabulary.visitBuckets, each 422 writing no revision', async () => {
    const m = await mount('session', NO_SETTINGS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    // The edges of both ranges admitted: depth 1, and a cut other than today's.
    const control = await publishLearn(m, { contextVocabulary: vocabularyWith({ order: TODAY_ORDER, depth: 1 }, CUT) });
    expect(control.status, `CONTROL — today's order at depth 1 with the cut [1, 2, 3, 6] publishes: ${JSON.stringify(errorsOf(control))}`).toBe(200);
    const revision = (await loadDocument(m, 'learn')).revision;
    const ladders: Array<[string, unknown]> = [
      ['an unknown key letter (x)', vocabularyWith({ order: ['c', 'v', 's', 'r', 'x'], depth: 5 })],
      ['a repeated key letter (r twice)', vocabularyWith({ order: ['c', 'v', 's', 'r', 'r'], depth: 5 })],
      ['depth 0', vocabularyWith({ order: TODAY_ORDER, depth: 0 })],
      ['depth 6, beyond the order\'s five keys', vocabularyWith({ order: TODAY_ORDER, depth: 6 })],
    ];
    const cuts: Array<[string, unknown]> = [
      ['a bound that is not a whole number (2.5)', vocabularyWith({ order: TODAY_ORDER, depth: 5 }, [1, 2.5, 4])],
      ['bounds written as bucket names, not numbers', vocabularyWith({ order: TODAY_ORDER, depth: 5 }, ['1', '2-3', '4+'])],
      ['a bound repeated, so not strictly ascending', vocabularyWith({ order: TODAY_ORDER, depth: 5 }, [1, 2, 2, 4])],
      ['bounds descending', vocabularyWith({ order: TODAY_ORDER, depth: 5 }, [1, 4, 2])],
      ['bounds not starting at 1', vocabularyWith({ order: TODAY_ORDER, depth: 5 }, [2, 4])],
    ];
    const outcomes = [...await refusedNaming(m, ladders, 'contextVocabulary.ladder'), ...await refusedNaming(m, cuts, 'contextVocabulary.visitBuckets')];
    expect.soft(outcomes.map(o => ({ case: o.case, status: o.status, named: o.named })),
      `P36.CH5 — each is refused (422) with an error naming contextVocabulary.ladder or contextVocabulary.visitBuckets: ${JSON.stringify(outcomes.map(o => [o.case, o.status, o.errors]))}`)
      .toEqual([...ladders, ...cuts].map(([name]) => ({ case: name, status: 422, named: true })));
    expect.soft((await loadDocument(m, 'learn')).revision, 'P36.CH5 — and no refused document wrote a revision').toBe(revision);
  }, 120_000);

  // R-P52 (1), the lead's ruling on the S5 fix-round-2 review's F4: a tenant with
  // the vocabulary learns in its own cells. The learning fan-in counts each served
  // exposure and each credited click under the cell its decision was made in, at
  // every ladder key of that cell (src/learn/stats.ts:47-50), and a decision reads
  // its lift from the keys of its own cell (src/learn/stats.ts:483-495). So on the
  // tenant whose vocabulary names sms, whose cut is [1, 2, 3, 6] and whose ladder
  // stops at depth 2 (the fixtures of the legs above), exposures decided in the cell
  // (sms, '3-5') are counted under c=sms and c=sms|v=3-5, and an SMS shopper on the
  // third visit, decided in that cell, finds that evidence: by the depth leg's
  // arithmetic (40 served exposures and 10 clicks at every level, more than the 30
  // a level needs) the lift is read from level 2, channel and visit bucket. The keys
  // finer than the depth are not ruled here; the legs read the levels the depth
  // consults. A tenant without the settings learns exactly as today: today's words
  // and buckets keep today's keys, and a cell naming a word and a bucket outside
  // them is counted under unknown (src/durable-objects/LearnStats.ts:563-565), as a
  // page-passed word outside the six is ignored (CH4's LOCK); src/units/W16/C5:636
  // and src/units/W16/B9:772 read genuinely unknown channels and are unchanged.
  /** The vocabulary with the cut [1, 2, 3, 6] and the ladder at depth 2. */
  const CUT_DEPTH_2 = { ...DEPTH_2, visitBuckets: CUT };
  /** The SMS arrival of the fixture above: sms under the published rules. */
  const SMS = ARRIVALS.find(a => a.name === 'SMS')!.entry;
  /** The cell an SMS shopper's third visit is decided in under that cut, a cold shopper's stage as DIRECT_FIRST (read loosely: '3-5' is not one of today's bucket words). */
  const SMS_THIRD = { channel: 'sms', visit_bucket: '3-5', region: null, affinity: null, stage: 'early' } as unknown as Parameters<typeof learnedLift>[3];
  /** A direct shopper's second visit under today's cut. */
  const DIRECT_SECOND = { channel: 'direct', visit_bucket: '2-3' as const, region: null, affinity: null, stage: 'early' as const };
  /** The cells an item is counted in, read through every statistics object's own `/snapshot` (as `learned` reads the root): ladder key → [exposures, clicks], rounded, at the levels `from` to `to`. */
  async function learnedCells(m: Mounted, item: string, from = 0, to = 5): Promise<Record<string, [number, number]>> {
    const out: Record<string, [number, number]> = {};
    for (const name of [...m.stats.keys()].sort()) {
      const response = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(name)).fetch('https://learn/snapshot', { method: 'POST' });
      const body = await response.json().catch(() => ({})) as { snapshot?: { items?: Record<string, Record<string, { n: number; s: number }>> } | null };
      for (const [key, counter] of Object.entries(body.snapshot?.items?.[item] ?? {})) {
        const level = key === '*' ? 0 : key.split('|').length;
        if (level >= from && level <= to) out[key] = [Math.round(counter.n), Math.round(counter.s)];
      }
    }
    return out;
  }

  for (const host of HOSTS) {
    it(`host (${host}): R-P52 — on the tenant whose vocabulary names sms, with the cut [1, 2, 3, 6] and the ladder at depth 2, the exposures and clicks decided in the cell (sms, '3-5') are learned under that cell, c=sms and c=sms|v=3-5, and an SMS shopper on the third visit is decided in that cell and answers from level 2, channel and visit bucket, with that evidence`, async () => {
      const m = await mount(host, { ...NO_SETTINGS, learn: homeLearn({ contextVocabulary: CUT_DEPTH_2 }) });
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      await learnedLift(m, HERO, LEARNED, SMS_THIRD, 'served-v1', HOME);
      expect(rounded(await learned(m), 'n')['story.harbor'], `${host}: PRECONDITION — story.harbor's served exposures are learned`).toBe(40);
      expect.soft(await learnedCells(m, 'story.harbor', 1, 2),
        `${host}: P36.CH5 — the exposures and clicks decided in (sms, '3-5') are counted under that cell at the levels the ladder consults, 40 and 10 at each`)
        .toEqual({ 'c=sms': [40, 10], 'c=sms|v=3-5': [40, 10] });
      // The shopper's three visits, 31 minutes apart, after the learning (a later clock, so the published lift is in the past).
      const T1 = Date.now() + 60_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(T1);
      try {
        const v = await visitorOn(m);
        let decisions: Array<{ decisionId?: string }> = [];
        for (let visit = 1; visit <= 3; visit++) {
          clock.mockReturnValue(T1 + (visit - 1) * 31 * 60_000);
          expect((await v.action(PAGE_VIEW, { entry: SMS })).status, `${host}: PRECONDITION — visit ${visit} opens`).toBe(200);
          const snap = await v.snapshot(HOME, { entry: SMS });
          expect(snap.status, `${host}: PRECONDITION — visit ${visit}: the shopper's page is served`).toBe(200);
          decisions = snap.decisions;
        }
        await m.drainLedger();
        const ids = new Set(decisions.map(d => d.decisionId));
        const record = storedDecisions(m, v.subject).find(r => ids.has(r.decision_id) && r.item_id === 'story.harbor');
        expect.soft([record?.cell.channel, record?.cell.visit_bucket],
          `${host}: P36.CH5 — the SMS shopper's third visit is decided in the cell (sms, '3-5'), as CH1 classifies the arrival and the cut leg buckets the visit`).toEqual(['sms', '3-5']);
        const lift = (record?.explain as unknown as { lift?: { level?: number; level_words?: string; n?: number; s?: number } | null } | undefined)?.lift;
        expect.soft(lift ? [lift.level, lift.level_words, Math.round(lift.n ?? -1), Math.round(lift.s ?? -1)] : 'no learned lift on the record',
          `${host}: P36.CH5 — and story.harbor's lift is read from level 2, channel and visit bucket, with the evidence learned in that cell (40 exposures, 10 clicks)`)
          .toEqual([2, 'channel and visit bucket', 40, 10]);
      } finally { clock.mockRestore(); }
    }, 180_000);

    it(`host (${host}): LOCK — on a tenant without the settings the fan-in learns exactly as today: exposures decided in a direct second visit are counted under today's keys, c=direct|v=2-3 down to the finest cell, and a cell naming a word and a bucket outside today's (sms, '3-5') is counted under unknown`, async () => {
      const m = await mount(host, NO_SETTINGS);
      expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
      await learnedLift(m, HERO, [{ item: 'story.meadow', exposures: 40, successes: 10 }], DIRECT_SECOND, 'served-v1', HOME);
      await learnedLift(m, HERO, [{ item: 'story.harbor', exposures: 40, successes: 10 }], SMS_THIRD, 'served-v1', HOME);
      /** The six ladder keys of a cell (src/learn/stats.ts:47-50), each holding the 40 exposures and 10 clicks. */
      const ladder = (c: string, v: string) => Object.fromEntries(['*', `c=${c}`, `c=${c}|v=${v}`, `c=${c}|v=${v}|s=early`, `c=${c}|v=${v}|s=early|r=none`,
        `c=${c}|v=${v}|s=early|r=none|a=none`].map(key => [key, [40, 10]]));
      // LOCKED (src/learn/stats.ts:47-50; src/durable-objects/LearnStats.ts:563-565; src/content/cell.ts:44-49, :64): today's keys, exactly.
      expect([await learnedCells(m, 'story.meadow'), await learnedCells(m, 'story.harbor')],
        `${host}: P36.CH5 — a tenant without the settings learns under today's keys: (direct, '2-3') as itself, (sms, '3-5') as unknown`)
        .toEqual([ladder('direct', '2-3'), ladder('unknown', 'unknown')]);
    }, 120_000);
  }

  // R-P52 (2): `visitBuckets` and `ladder` are optional members of the vocabulary;
  // omitted, they are today's cut [1, 2, 4] and today's order c, v, s, r, a at
  // depth 5. The vocabulary below names today's six words with a mapping of its own
  // (an SMS arrival read as email, where today's tables read it as direct), so the
  // channel values do not change and, with today's cut and ladder, no cell changes:
  // the grammar stays today's, `ladder-cell` version 2 (a change of the channel
  // values bumps it, the bump leg above). Its source platforms and landing-page
  // types are kept: they are not ruled optional.
  const CHANNELS_ONLY = {
    channels: [
      { id: 'direct', name: 'Direct' }, { id: 'paid_social', name: 'Paid social' }, { id: 'paid_search', name: 'Paid search' },
      { id: 'email', name: 'Email' }, { id: 'organic', name: 'Organic search' }, { id: 'referral', name: 'Referral' },
    ],
    rules: [
      { channel: 'email', utmMedium: ['email', 'newsletter', 'sms'] },
      { channel: 'paid_social', utmMedium: ['paid_social', 'paidsocial'] },
      { channel: 'paid_search', utmMedium: ['cpc', 'ppc'] },
      { channel: 'organic', untagged: true, referrer: ['google.com', 'bing.com'] },
      { channel: 'referral', untagged: true, referrer: 'external' },
      { channel: 'direct', untagged: true, referrer: 'none' },
    ],
    sourcePlatforms: VOCABULARY.sourcePlatforms,
    landingPageTypes: VOCABULARY.landingPageTypes,
  };

  it('host: R-P52 — visitBuckets and ladder are optional: a vocabulary naming its channels and rules without them publishes and is in force, and keeps today\'s order at full depth (the grammar in force ladder-cell version 2 with c, v, s, r, a, a lift learned at every level read from level 5), today\'s grammar (a priors file exported under it imports) and today\'s cut (a second visit in 2-3)', async () => {
    const m = await mount('session', NO_SETTINGS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const written = await publishLearn(m, { contextVocabulary: CHANNELS_ONLY });
    expect(written.status, `P36.CH5 — a vocabulary without visitBuckets and ladder publishes: ${JSON.stringify(errorsOf(written))}`).toBe(200);
    expect.soft(await grammarInForce(m), 'P36.CH5 — the grammar in force is today\'s, no bump: ladder-cell version 2, whose cells are c, v, s, r, a in that order')
      .toEqual({ name: 'ladder-cell', version: 2, order: TODAY_ORDER });
    await learnedLift(m, HERO, LEARNED, DIRECT_FIRST, 'served-v1', HOME);
    expect.soft(await harborLift(m), 'P36.CH5 — today\'s order at full depth: a lift learned at every level of the shopper\'s cell is read from level 5')
      .toEqual([5, 'channel, visit bucket, stage, region and affinity cell']);
    const imported = await putKind(m, 'priors', PRIORS_TODAY, 'today’s grammar under the vocabulary');
    expect.soft(imported.status, `P36.CH5 — a priors file exported under today's grammar imports: ${JSON.stringify(errorsOf(imported))}`).toBe(200);
    // One shopper's visits 1 and 2, 31 minutes apart, each arriving by SMS (a later clock, after the publication).
    const T1 = Date.now() + 60_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T1);
    try {
      const v = await visitorOn(m);
      const cells: Array<[unknown, unknown]> = [];
      for (let visit = 1; visit <= 2; visit++) {
        clock.mockReturnValue(T1 + (visit - 1) * 31 * 60_000);
        expect((await v.action(PAGE_VIEW, { entry: SMS })).status, `PRECONDITION — visit ${visit} opens`).toBe(200);
        const snap = await v.snapshot(HOME, { entry: SMS });
        expect(snap.status, `PRECONDITION — visit ${visit}: the shopper's page is served`).toBe(200);
        const stored = await cellsOf(m, v, snap.decisions.map(d => d.decisionId));
        cells.push([stored[0]?.channel, stored[0]?.visit_bucket]);
      }
      expect.soft(cells.map(([, bucket]) => bucket), 'P36.CH5 — today\'s cut: the second visit is decided in 2-3').toEqual(['1', '2-3']);
      expect.soft(cells.map(([channel]) => channel), 'P36.CH5 — and the vocabulary is in force: its rule reads the SMS arrival as email').toEqual(['email', 'email']);
    } finally { clock.mockRestore(); }
  }, 180_000);

  // R-P54 (1), the lead's ruling on the P36 delivery review's CH5 defect (probe O):
  // a priors file published as a related member was checked only by the store's
  // own validator, which reads any grammar this platform derives, so the refusal
  // the bump leg above pins was bypassed. EVERY priors document one PUT publishes,
  // the primary document or a related member of `publicationChanges` (its kind
  // resolved as the route resolves every kind, in any case of the word, as
  // unit:P01.O5.F1.01 rules it for a related slots member), is checked against the
  // cell grammar of the learn member the same request publishes, or else the learn
  // document in force; one declaring another grammar is refused as the bump leg
  // reads the refusal: 422, an error naming cellGrammar with the migration sentence
  // naming the re-export (W25's sentence, src/learn/priors.ts:169 at 88e39487),
  // writing no revision of any member ("nor can it ride a related-set
  // publication", src/units/W34/LEDGER.unit.test.ts:447-449). Publication does not
  // depend on the host, so the leg runs on the session host, as the bump leg does.
  /** `PUT /content/:kind` with the authored preconditions, publishing `related` beside the primary document in one request (as unit:P01.O5.F1.01 publishes). */
  async function publishBeside(m: Mounted, kind: string, document: unknown, related: Array<{ kind: string; document: unknown }>, note: string): Promise<Answer> {
    const base = await readKind(m, kind);
    expect(base.status, `PRECONDITION — the operator reads the ${kind} document: ${JSON.stringify(base.body).slice(0, 200)}`).toBe(200);
    const publication = base.body.publication as { revision: number; digest: string };
    const answer = await asOperator(m, 'PUT', `/content/${kind}?scope=${TENANT}`, { document, note, publicationChanges: related }, {
      'If-Match': `"${base.body.revision as number}/${publication.revision}/${publication.digest}"`,
      'Idempotency-Key': `${base.body.revision as number}:${crypto.randomUUID()}`,
    });
    invalidatePublicationCache();
    return answer;
  }
  /** The revisions of the three documents these publications write: a refused one leaves all three as they were. */
  async function revisionsOf(m: Mounted): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const kind of ['learn', 'slots', 'priors']) out[kind] = (await readKind(m, kind)).body.revision;
    return out;
  }
  /** The refusal as the bump leg reads it: the status, and whether one error names cellGrammar and the re-export. */
  const byGrammar = (answer: Answer): [number, boolean] => [answer.status, errorsOf(answer).some(e => e.includes('cellGrammar') && /re-?export/i.test(e))];
  /** The grammar the priors document in force declares (W25 retains it as the grammar the document was read under, src/learn/priors.ts:208-211 at 88e39487). */
  async function declaredInForce(m: Mounted): Promise<unknown> {
    const declared = ((await readKind(m, 'priors')).body.document as { cellGrammar?: { name?: unknown; version?: unknown; order?: unknown } } | undefined)?.cellGrammar;
    return declared ? { name: declared.name, version: declared.version, order: declared.order } : 'the priors in force declare no grammar';
  }
  /** One prior on the hero, on a channel-level cell every grammar below reads, declaring the given grammar. */
  const priorsUnder = (cellGrammar: unknown, label: string) => ({ version: `parity5-priors-${label}`, cellGrammar,
    rows: [{ slot: HERO, item: 'story.harbor', cell: 'c=email', p_prior: 0.05, n_equiv: 20 }] });

  it('host: R-P54 — a priors file riding a publication is read under the grammar of the learn member that publication carries, or else the learn document in force: published as a related member beside a learn or a slots document, or as the primary document beside a related learn member that changes the channel values, a file declaring another grammar is refused (422) naming cellGrammar with the migration sentence naming the re-export and writes no revision, so the grammar in force and the priors in force agree; the file under that grammar publishes', async () => {
    // (a) A tenant without the settings reads today's grammar: a related priors file declaring a grammar it does not
    // read is refused, as the publication door refused it before P36 (W25).
    const a = await mount('session', NO_SETTINGS);
    expect(a.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const controlA = await publishBeside(a, 'learn', homeLearn(), [{ kind: 'priors', document: PRIORS_TODAY }], 'r-p54 (a) control');
    expect(controlA.status, `CONTROL (a) — a related priors file declaring the grammar in force (today's) publishes beside a learn document: ${JSON.stringify(errorsOf(controlA))}`).toBe(200);
    const beforeA = await revisionsOf(a);
    const odd = await publishBeside(a, 'learn', homeLearn(), [{ kind: 'priors', document: priorsUnder({ name: 'ladder-cell', version: 12345, order: ['c', 'v'] }, 'odd') }], 'r-p54 (a)');
    expect.soft([...byGrammar(odd), await revisionsOf(a)],
      `P36.CH5 (R-P54 a) — on a tenant without the settings a related priors file declaring ladder-cell version 12345 (c, v) beside a learn document is refused (422) naming cellGrammar and the re-export, and no revision is written (${odd.status}: ${JSON.stringify(errorsOf(odd))})`)
      .toEqual([422, true, beforeA]);

    // (b) A vocabulary tenant (the depth leg's: the nine channel values, the ladder at depth 2) reads a derived grammar:
    // today's version-2 file is refused beside a learn document and beside a slots document, the related kind in any case.
    const b = await mount('session', { ...NO_SETTINGS, learn: homeLearn({ contextVocabulary: DEPTH_2 }) });
    expect(b.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const derived = await grammarInForce(b);
    expect(derived?.order ?? 'no grammar in force named', 'PRECONDITION — the vocabulary tenant reads the grammar its depth derives, order c, v (the depth leg)').toEqual(['c', 'v']);
    const learnB = homeLearn({ contextVocabulary: DEPTH_2 });
    const controlsB = [
      await publishBeside(b, 'learn', learnB, [{ kind: 'priors', document: priorsUnder(derived, 'b-learn') }], 'r-p54 (b) control beside learn'),
      await publishBeside(b, 'slots', homeSlots(), [{ kind: 'priors', document: priorsUnder(derived, 'b-slots') }], 'r-p54 (b) control beside slots'),
    ];
    expect(controlsB.map(answer => answer.status),
      `CONTROL (b) — a related priors file declaring the grammar in force publishes beside a learn document and beside a slots document: ${JSON.stringify(controlsB.map(errorsOf))}`).toEqual([200, 200]);
    const beforeB = await revisionsOf(b);
    const casesB: Array<[string, string, unknown, string]> = [
      ['beside a learn document', 'learn', learnB, 'priors'],
      ['beside a slots document', 'slots', homeSlots(), 'priors'],
      ["beside a learn document, the related kind written 'Priors'", 'learn', learnB, 'Priors'],
      ["beside a slots document, the related kind written 'PRIORS'", 'slots', homeSlots(), 'PRIORS'],
    ];
    for (const [name, primary, document, kind] of casesB) {
      const answer = await publishBeside(b, primary, document, [{ kind, document: PRIORS_TODAY }], `r-p54 (b) ${name}`);
      expect.soft([...byGrammar(answer), await revisionsOf(b)],
        `P36.CH5 (R-P54 b) — on a vocabulary tenant today's version-2 priors file ${name} is refused (422) naming cellGrammar and the re-export, and no revision is written (${answer.status}: ${JSON.stringify(errorsOf(answer))})`)
        .toEqual([422, true, beforeB]);
    }

    // (c) A priors publication carrying a related learn member: the file is read under the grammar that learn member
    // derives. CONTROL: with a learn member that leaves the channel values as they are, today's file publishes.
    const c = await mount('session', NO_SETTINGS);
    expect(c.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const imported = await putKind(c, 'priors', PRIORS_TODAY, 'today’s grammar');
    expect(imported.status, `PRECONDITION — a priors file exported under today's grammar imports: ${JSON.stringify(errorsOf(imported))}`).toBe(200);
    const controlC = await publishBeside(c, 'priors', { ...PRIORS_TODAY, version: 'parity5-priors-c-control' }, [{ kind: 'learn', document: homeLearn() }], 'r-p54 (c) control');
    expect(controlC.status,
      `CONTROL (c) — a priors file declaring today's grammar publishes with a related learn member that leaves the channel values as they are: ${JSON.stringify(errorsOf(controlC))}`).toBe(200);
    // With a related learn member whose vocabulary changes the channel values (the same vocabulary as (b)), today's
    // version-2 file is refused, so the tenant keeps today's grammar and its version-2 priors, which agree.
    const beforeC = await revisionsOf(c);
    const stale = await publishBeside(c, 'priors', { ...PRIORS_TODAY, version: 'parity5-priors-c' }, [{ kind: 'learn', document: learnB }], 'r-p54 (c)');
    expect.soft([...byGrammar(stale), await revisionsOf(c)],
      `P36.CH5 (R-P54 c) — a priors file declaring today's version 2, published with a related learn member whose vocabulary changes the channel values, is refused (422) naming cellGrammar and the re-export, and no revision is written (${stale.status}: ${JSON.stringify(errorsOf(stale))})`)
      .toEqual([422, true, beforeC]);
    expect.soft([await declaredInForce(c), await grammarInForce(c)],
      'P36.CH5 (R-P54 c) — and afterwards the priors in force and the grammar in force agree: both today\'s, ladder-cell version 2 with c, v, s, r, a')
      .toEqual([PRIORS_TODAY.cellGrammar, PRIORS_TODAY.cellGrammar]);
    // The learn member of the same request, not the learn document in force: on a tenant whose learn document in force
    // is still today's, the file re-exported under the grammar that learn member derives publishes with it.
    const c2 = await mount('session', NO_SETTINGS);
    expect(c2.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    const imported2 = await putKind(c2, 'priors', PRIORS_TODAY, 'today’s grammar');
    expect(imported2.status, `PRECONDITION — a priors file exported under today's grammar imports: ${JSON.stringify(errorsOf(imported2))}`).toBe(200);
    const migrated = await publishBeside(c2, 'priors', priorsUnder(derived, 'c-migrated'), [{ kind: 'learn', document: learnB }], 'r-p54 (c) re-exported');
    expect.soft(migrated.status,
      `P36.CH5 (R-P54 c) — a priors file declaring the grammar its related learn member derives publishes with it, the learn document in force being today's (${JSON.stringify(errorsOf(migrated))})`).toBe(200);
    expect.soft([await declaredInForce(c2), await grammarInForce(c2)],
      'P36.CH5 (R-P54 c) — and the priors in force and the grammar in force then agree on that derived grammar').toEqual([derived, derived]);
  }, 180_000);
});

// ===========================================================================
// unit:P36.CH6 — the console shows and edits the settings; the kit states them
// ===========================================================================

describe('unit:P36.CH6', () => {
  it('sdk: the shipped dials screen shows the stored context vocabulary in its contextVocabulary control, and an operator edits it there and saves it through PUT /content/learn, the saved revision carrying the edit', async () => {
    const m = await mount('session', NO_SETTINGS);
    expect(m.refused, 'PRECONDITION: the tenant documents publish').toBeNull();
    expect((await publishLearn(m, { contextVocabulary: VOCABULARY })).status, 'PRECONDITION — the vocabulary publishes').toBe(200);
    const c = await openConsole(m, `#/dials?scope=${TENANT}&slot=home-hero`);
    try {
      expect(c.text(), 'PRECONDITION: the dials screen is reading the learn document').toContain('What the engine may do');
      const control = c.control('contextVocabulary');
      expect(control?.value ?? 'no [data-focus-key="contextVocabulary"] control on the dials screen',
        'P36.CH6 — the dials screen shows the stored vocabulary in its contextVocabulary control').toContain('paid_search_brand');
      const edited = { ...VOCABULARY, landingPageTypes: [...VOCABULARY.landingPageTypes, { id: 'checkout', name: 'Checkout' }] };
      expect(await c.type('contextVocabulary', JSON.stringify(edited)), 'P36.CH6 — the control accepts an edit').toBe(true);
      await c.save();
      const puts = c.requests.filter(r => r.method === 'PUT' && r.path.startsWith('/content/learn'));
      expect(puts.length, 'P36.CH6 — the console saved the edit through PUT /content/learn').toBe(1);
      expect(((await loadDocument(m, 'learn')).document as Record<string, unknown>).contextVocabulary,
        'P36.CH6 — and the saved revision carries exactly the edited vocabulary').toEqual(edited);
    } finally { c.close(); }
  }, 120_000);

  it('logic: docs/kit/02-api-reference.md and docs/kit/03-payload-schemas.md document the vocabulary document, the mapping rules, the seed-signal keys and the grammar bump', () => {
    const missing: string[] = [];
    for (const file of ['docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']) {
      const lines = readTree(file).split('\n');
      const has = (...words: string[]) => lines.some(line => words.every(w => line.includes(w)));
      if (!has('contextVocabulary', 'channels')) missing.push(`${file}: the vocabulary document (contextVocabulary with its channels)`);
      if (!has('paid_search_brand', 'sms', 'affiliate')) missing.push(`${file}: the nine channel values`);
      if (!has('utmCampaign')) missing.push(`${file}: the mapping rule on utm_campaign (utmCampaign)`);
      if (!has('untagged', 'referrer', 'rules')) missing.push(`${file}: the mapping rules' conditions (untagged, referrer)`);
      if (!has('source_platform') || !has('landing_page_type')) missing.push(`${file}: the seed-signal keys source_platform and landing_page_type`);
      if (!has('cellGrammar', 'contextVocabulary')) missing.push(`${file}: the grammar bump a vocabulary change carries (cellGrammar with contextVocabulary)`);
    }
    expect(missing, 'P36.CH6 — the kit states the vocabulary, the mapping, the seed keys and the bump').toEqual([]);
  });

  // R-P55 (the lead's ruling of 2026-10-12, P36 fix round 2): kit 02's
  // context-prior section (the paragraph "The context prior." and any that
  // follow it before the next bold or titled paragraph) states that only today's
  // six channel words and today's three visit buckets (1, 2-3, 4+) have a
  // context population (src/reflex/regionTrend.ts:65-81), so a channel of the
  // tenant's vocabulary outside the six gets no context prior, and a bucket of a
  // published cut outside the three has no population of its own. Today's
  // sentence (02:343-344 at 7c6e0e22: "an event whose entry channel is unknown
  // ... counts nothing there") names neither. Each statement is matched on
  // stable words within one sentence of the section, never on a whole sentence,
  // so the wording is the implementer's.
  it('logic: R-P55 — docs/kit/02-api-reference.md\'s context-prior section states that only today\'s six channel words and today\'s three visit buckets (1, 2-3, 4+) have a context population: a channel of the tenant\'s vocabulary outside the six gets no context prior, and a bucket of a published cut outside the three has no population of its own', () => {
    const paragraphs = readTree('docs/kit/02-api-reference.md').split(/\n\s*\n/);
    const start = paragraphs.findIndex(p => p.trimStart().startsWith('**The context prior.**'));
    expect(start, 'PRECONDITION — docs/kit/02-api-reference.md carries the context-prior section (unit:P07.C6)').toBeGreaterThanOrEqual(0);
    const next = paragraphs.findIndex((p, i) => i > start && /^\s*(\*\*|#)/.test(p));
    const sentences = paragraphs.slice(start, next < 0 ? undefined : next).join('\n\n').replace(/[‘’]/g, "'").replace(/`/g, '')
      .split(/(?<=[.!?])\s+|\n\s*\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const six = ['direct', 'paid_social', 'paid_search', 'email', 'organic', 'referral'];
    const statements: Array<{ name: string; test: (s: string) => boolean }> = [
      { name: 'only the six channel words and the three visit buckets (1, 2-3, 4+) have a context population',
        test: s => /\bonly\b/i.test(s) && (/\bsix\b/i.test(s) || six.every(w => s.includes(w))) && ((s.includes('2-3') && s.includes('4+')) || /\bthree\b/i.test(s)) && /\bpopulation/i.test(s) },
      { name: 'a channel of the tenant\'s vocabulary outside the six gets no context prior',
        test: s => /vocabular/i.test(s) && /\b(no|never|none)\b/i.test(s) && /\bprior\b/i.test(s) },
      { name: 'a bucket of a published cut (visitBuckets) outside the three has no population of its own',
        test: s => /visitBuckets|\bcut\b/i.test(s) && /\bbucket/i.test(s) && /\bpopulation/i.test(s) },
    ];
    expect(statements.filter(st => !sentences.some(st.test)).map(st => `docs/kit/02-api-reference.md: ${st.name}`),
      'P36.CH6 — R-P55: kit 02\'s context-prior section states which arrival contexts have a population and what the others get').toEqual([]);
  });
});
