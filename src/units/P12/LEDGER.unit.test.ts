// src/units/P12/LEDGER.unit.test.ts
// P12 under the Closure Ledger: the tests for the LOCAL criteria of the P12 work
// order (`tapestry-parity-build`, ticket P12 "Tapestry's hashed identifier as the
// account identifier"). DC1 (D1) and DC2 (D2) are ruled below and exercised in
// I2, I3 and I4; LV1 and LV2 are deferred live rows and get no test.
//
// One `describe('unit:P12.<criterion>')` per LOCAL criterion. Expected values
// come from the witnesses, never from what the engine answers today:
//   · the work order's authority (docs/BTI-Parity-Build-Tickets.md, P12 in
//     section B): "the link accepts Tapestry's hashed identifier, both the
//     first-landing hash and the hashed email, as the account identifier, and
//     merge-never-override holds across the change from one to the other";
//   · freeze sheet items 28 (D1: an identifier change merges only on a signed
//     statement naming both identifiers; D2: the format is a tenant setting) and
//     45 (the format lives in the reflex document);
//   · the parity document, section 5 row B8 and section 6 (cited by number
//     only): on the change to the hashed-email form the backend signs and the
//     two identities merge, the history kept and added, recent behaviour still
//     outranking both;
//   · the existing contract the work order cites: src/identity/link.ts (the
//     person is named by the account identifier and the browser's profile folds
//     into the person's), src/reflex/identityMerge.ts (a merge adds the decayed
//     evidence of both profiles), src/identity/assertion.ts:54-56 (the signed
//     material: tenant, visitor, account, expiry).
//
// THE READINGS THIS FILE RULES:
//   FORMAT (D2, item 45). The reflex document carries `accountIdFormat: {
//     firstLanding?: string, hashedEmail?: string }`, each value the source of a
//     regular expression anchored at both ends (`^…$`). At least one form is
//     declared; no other key is admitted. Publication refuses, with an error
//     naming `accountIdFormat`, a value that is not an object, an object with no
//     form, an unknown form, a pattern that does not compile and a pattern not
//     anchored with `^` and `$`. A tenant that declares none links exactly as
//     today. The fixture's forms are synthetic (Tapestry's are LIVE2): a
//     first-landing hash `tfl1.` + 32 hex, a hashed e-mail as 64 hex (SHA-256).
//   STATEMENT (D1). The link body may carry `accountChange: { from, exp,
//     statement }`; `to` is the link's own `accountId`. The statement is the
//     HMAC-SHA256, base64url, keyed by the tenant's identity secret (verified as
//     today's assertion is, src/identity/assertion.ts), over exactly
//         tenant \n account-change \n from \n to \n exp
//     (`account-change` separates it from a link assertion, whose material is
//     tenant \n visitorId \n accountId \n exp). `exp` is unix seconds, in the
//     future and at most 24 h ahead, as for the assertion. On a verified
//     statement the link merges the `from` account's profile into the `to`
//     account's (and the linking browser's into it, as today): merge, never
//     override — decayed evidence added, so recent behaviour outranks both.
//     A change statement that is missing, names another pair, is signed with a
//     secret the tenant does not hold, has expired or expires more than 24 h
//     ahead (ASSERTION_MAX_TTL_S, the assertion's own ceiling), and an
//     identifier outside the declared format, are each refused with a named
//     error (the error text names `account change`/`accountChange` or
//     `accountIdFormat`) and merge nothing: no profile changes and the browser
//     stays anonymous.
//   ONCE (D1, I3). A verified statement merges the `from` profile ONCE. The
//     same valid statement presented again — by the browser that is now signed
//     in as the `to` account, and on the SDK's retry after a 409 and a detach,
//     which carries it again (I5) — merges nothing more: the `from` account's
//     evidence is never added to the `to` account a second time. The retry is a
//     link like any other (backend proof for the fresh visitor) and is
//     accepted, because I5 carries the statement again precisely so that the
//     retried sign-in succeeds; what the statement merges is not repeated.
//   SDK. `identify(accountId, { …, accountChange })` carries the member verbatim
//     on every link request of that call, including the retry after a 409 and a
//     detach; without the option the body is exactly today's.
//
// NO NEW EXPORT IS IMPORTED. The ruled members are read loosely; the SDK option
// is passed through a type assertion so no excess-property error is added.
//
// HARNESS: src/units/_parity.ts (the mounted app on both shopper hosts) and
// src/units/_parity3.ts (the identity routes mounted beside it as src/index.ts
// mounts them; the tenant's identity material; the hydrate projection read with
// the person's own session capability). The SDK leg drives the real
// `src/sdk/index` entry over the repository's test host (src/sdk/identify.test.ts's
// idiom).
//
// R10 (tests that lock present behaviour, listed for the lead):
//   · src/sdk/identify.test.ts:37 asserts the link body's exact key set; held by
//     the ruling that `accountChange` is sent only when the caller gives it.
//   · src/routes/identity.ts:71-75 `linkSchema` strips unknown members today, so
//     no existing test asserts a refusal of an unknown link member.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateReflexConfig } from '@/reflex/configStore';
import { mergeReflexStates } from '@/reflex/identityMerge';
import { createCore } from '@/sdk/core';
import { createIdentity } from '@/sdk/identify';
import { syntheticSession, testHost } from '@/sdk/testHost';
import type { RequestInitLike } from '@/sdk/types';

import {
  asOperator, expectPublished, HOSTS, learnDocument, MODULES, mount, productView, recentSlot, REFLEX_DOCUMENT, shopperOn, TENANT,
  VIEW_TABBY_26, VIEW_TABBY_WALLET, type Mounted, type Shopper,
} from '../_parity';
import { hmacOf, identityDoor, identitySecretOf, missingStatements, sha256Hex, type IdentityDoor } from '../_parity3';

const DAY_MS = 86_400_000;
const K = 1.8;
const TAU_DAYS = 14;
/** The shipped registry's affinity of decayed evidence R (src/reflex/core.ts: a = R / (R + K), K = 1.8, τ = 14 days). */
const aff = (r: number) => r / (r + K);

/** COA-C2621 · Willow Shoulder Bag · Handbags (src/data/coach-catalog.json). */
const VIEW_WILLOW = productView({ productId: 'COA-C2621', line: 'Willow', category: 'Handbags', subcategory: 'Shoulder Bags',
  silhouette: 'shoulder', occasion: ['work', 'everyday'], price_usd: 350 });

/** The tenant's declared hashed-identifier format (ruled above). */
const FORMAT = { firstLanding: '^tfl1\\.[0-9a-f]{32}$', hashedEmail: '^[0-9a-f]{64}$' };
const REFLEX_WITH_FORMAT = { ...REFLEX_DOCUMENT, accountIdFormat: FORMAT };
/** A page with nothing but the pinned recently-viewed slot: no layout declaration, so no P02 precondition. */
const SLOTS = { version: 'parity-p12-slots', governanceVersion: 3, pages: { pdp: [recentSlot()] } };
const documents = (reflex: unknown) => ({ pieces: MODULES, slots: SLOTS, learn: learnDocument(), reflex });

let FL = '', HE = '', OTHER_HE = '';
async function identifiers() {
  FL = `tfl1.${(await sha256Hex('tapestry first-landing cookie 7f3a-11e9')).slice(0, 32)}`;
  HE = await sha256Hex('jordan.lee@example.com');
  OTHER_HE = await sha256Hex('sam.rivera@example.com');
  return { FL, HE, OTHER_HE };
}

const changeMaterial = (from: string, to: string, exp: number) => `${TENANT}\naccount-change\n${from}\n${to}\n${exp}`;
async function accountChange(secret: string, from: string, to: string, exp = Math.floor(Date.now() / 1000) + 600) {
  return { from, exp, statement: await hmacOf(secret, changeMaterial(from, to, exp)) };
}

/** The backend-signed link of one browser, exactly as src/identity/assertion.ts verifies it, with any extra member. */
async function link(m: Mounted, door: IdentityDoor, s: Shopper, accountId: string, extra: Record<string, unknown> = {}) {
  return linkAs(m, door, { visitorId: s.subject, capability: s.grant.capability }, accountId, extra);
}
/** The same link for a browser known only by the session it carries (a signed-in browser, or the fresh visitor a detach mints). */
async function linkAs(m: Mounted, door: IdentityDoor, browser: { visitorId: string; capability: string }, accountId: string, extra: Record<string, unknown> = {}) {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const assertion = await hmacOf(identitySecretOf(m), `${TENANT}\n${browser.visitorId}\n${accountId}\n${exp}`);
  return door.call(`/v1/${TENANT}/identity/link`, browser.capability, { visitorId: browser.visitorId, accountId, source: 'login', exp, assertion, ...extra });
}
/** The session a link or a detach answers (`session`: capability and subject, src/identity/sessionCapability.ts). */
const sessionOf = (answer: { body: Record<string, unknown> }) => {
  const session = (answer.body.session ?? {}) as { capability?: string; subject?: string };
  return { visitorId: session.subject ?? '', capability: session.capability ?? '' };
};

type Dims = Record<string, Record<string, number>>;
/** The SDK-visible hydrate projection read with a session capability (`GET /realtime/reflex`). */
async function profileOf(door: IdentityDoor, capability: string, what: string): Promise<Dims> {
  const read = await door.call('/realtime/reflex', capability);
  expect(read.status, `PRECONDITION: ${what}'s profile reads (${JSON.stringify(read.body).slice(0, 200)})`).toBe(200);
  return ((read.body.affinity as { dims?: Dims } | null)?.dims ?? {});
}
const personOf = (answer: { body: Record<string, unknown> }) => ((answer.body.session ?? {}) as { capability?: string }).capability ?? '';
const pick = (dims: Dims) => ({ Tabby: dims.line?.Tabby ?? 0, Willow: dims.line?.Willow ?? 0, Handbags: dims.category?.Handbags ?? 0,
  'Small Leather Goods': dims.category?.['Small Leather Goods'] ?? 0, evening: dims.occasion?.evening ?? 0 });

async function viewed(s: Shopper, views: Array<{ type: string; data: Record<string, unknown> }>, host: string) {
  for (const view of views) expect((await s.action(view)).status, `${host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
}

afterEach(() => { vi.useRealTimers(); });

// ===========================================================================
// unit:P12.I1 — the hashed identifier, in either form, is the account identifier
// ===========================================================================

describe('unit:P12.I1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a signed link whose account identifier is in the tenant's declared format, first-landing or hashed-email, links the browser to that account and merges the anonymous profile into it without overriding the account's history`, async () => {
      await identifiers();
      const m = await mount(host, documents(REFLEX_WITH_FORMAT));
      expectPublished(m, 'P12.I1 — the reflex document declaring `accountIdFormat` publishes');
      const door = identityDoor(m);
      for (const [form, accountId] of [['first-landing', FL], ['hashed-email', HE]] as const) {
        // The account's history: an earlier browser, two views of the Tabby Shoulder Bag 26, linked to the account.
        const earlier = await shopperOn(m);
        await viewed(earlier, [VIEW_TABBY_26, VIEW_TABBY_26], host);
        const first = await link(m, door, earlier, accountId);
        expect([first.status, first.body.outcome ?? first.body.error], `${host}: P12.I1 — the ${form} identifier ${accountId} is accepted as the account identifier`).toEqual([200, 'linked']);
        // A new anonymous browser, one view of the Tabby wallet, signs in to the same account.
        const browser = await shopperOn(m);
        await viewed(browser, [VIEW_TABBY_WALLET], host);
        const second = await link(m, door, browser, accountId);
        expect([second.status, second.body.outcome ?? second.body.error], `${host}: P12.I1 — the second browser links to the ${form} account`).toEqual([200, 'linked']);
        expect(second.body.shopperId, `${host}: P12.I1 — both browsers name one person, the account the ${form} identifier names`).toBe(first.body.shopperId);
        const merged = pick(await profileOf(door, personOf(second), `the ${form} account`));
        // LOCKED (src/reflex/identityMerge.ts): the history (2 views) and the anonymous profile (1 view) are added, never replaced.
        const expected = { Tabby: aff(3), Willow: 0, Handbags: aff(2), 'Small Leather Goods': aff(1), evening: aff(3) };
        for (const [value, a] of Object.entries(expected)) {
          expect(merged[value as keyof typeof merged], `${host}: P12.I1 — after the ${form} link the account's ${value} interest is the history and the anonymous profile added`).toBeCloseTo(a, 3);
        }
      }
    });
  }
});

// ===========================================================================
// unit:P12.I2 — a signed statement naming both identifiers merges the two accounts
// ===========================================================================

describe('unit:P12.I2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): decision D1 — a link to the hashed-email account carrying a statement signed over both identifiers merges the first-landing account's profile and the hashed-email account's profile without overriding either, with recent behaviour outranking both histories`, async () => {
      await identifiers();
      const t0 = Date.now();
      vi.useFakeTimers({ toFake: ['Date'], now: t0 });
      const m = await mount(host, documents(REFLEX_WITH_FORMAT));
      expectPublished(m, 'P12.I2 — the reflex document declaring `accountIdFormat` publishes');
      const door = identityDoor(m), secret = identitySecretOf(m);
      // Day 0. The first-landing account: two views of the Tabby 26. The hashed-email account: two views of the Willow.
      const firstLanding = await shopperOn(m);
      await viewed(firstLanding, [VIEW_TABBY_26, VIEW_TABBY_26], host);
      expect((await link(m, door, firstLanding, FL)).status, `${host}: PRECONDITION — the first-landing account is linked`).toBe(200);
      const hashedEmail = await shopperOn(m);
      await viewed(hashedEmail, [VIEW_WILLOW, VIEW_WILLOW], host);
      const heLink = await link(m, door, hashedEmail, HE);
      expect(heLink.status, `${host}: PRECONDITION — the hashed-email account is linked`).toBe(200);
      // Day 2. The shopper's e-mail becomes known on a fresh browser after one view of the Tabby wallet; the site's backend signs the change.
      vi.setSystemTime(t0 + 2 * DAY_MS);
      const browser = await shopperOn(m);
      await viewed(browser, [VIEW_TABBY_WALLET], host);
      const changed = await link(m, door, browser, HE, { accountChange: await accountChange(secret, FL, HE) });
      expect([changed.status, changed.body.error ?? changed.body.outcome], `${host}: P12.I2 — the link carrying the signed change statement is accepted`).toEqual([200, 'linked']);
      expect(changed.body.shopperId, `${host}: P12.I2 — the browser now carries the hashed-email account`).toBe(heLink.body.shopperId);
      const merged = pick(await profileOf(door, personOf(changed), 'the hashed-email account'));
      // Both histories are two days old (decayed by e^(−2/14)); the wallet view is now.
      const d = Math.exp(-2 / TAU_DAYS);
      const expected = { Tabby: aff(2 * d + 1), Willow: aff(2 * d), Handbags: aff(4 * d), 'Small Leather Goods': aff(1), evening: aff(2 * d + 1) };
      for (const [value, a] of Object.entries(expected)) {
        expect(merged[value as keyof typeof merged], `${host}: P12.I2 — ${value}: the first-landing history, the hashed-email history and the recent view are all added, the histories decayed and the recent view at full weight`).toBeCloseTo(a, 3);
      }
    });
  }

  it('logic: LOCKED — a merge adds the decayed evidence of both profiles, so a recent signal outranks the same signal in either history (src/reflex/identityMerge.ts)', () => {
    type State = Parameters<typeof mergeReflexStates>[0];
    const config = REFLEX_DOCUMENT as unknown as Parameters<typeof mergeReflexStates>[3];
    const t0 = 1_760_000_000_000, now = t0 + 2 * DAY_MS;
    const history = (value: string) => ({ v: 1, dims: { line: { [value]: { s: 2, t: t0 } } }, audiences: [], configVersion: 'p12' }) as unknown as State;
    const recent = { v: 1, dims: { line: { Tabby: { s: 1, t: now } } }, audiences: [], configVersion: 'p12' } as unknown as State;
    const merged = mergeReflexStates(mergeReflexStates(history('Tabby'), history('Willow'), now, config).state, recent, now, config);
    const dims = merged.state.dims as Record<string, Record<string, { s: number; t: number }>>;
    const at = (entry: { s: number; t: number } | undefined) => entry ? entry.s * Math.exp(-(now - entry.t) / (TAU_DAYS * DAY_MS)) : 0;
    expect(at(dims.line?.Tabby), 'P12.I2 — Tabby: two decayed history views plus one recent view').toBeCloseTo(2 * Math.exp(-2 / TAU_DAYS) + 1, 6);
    expect(at(dims.line?.Willow), 'P12.I2 — Willow: two decayed history views').toBeCloseTo(2 * Math.exp(-2 / TAU_DAYS), 6);
  });
});

// ===========================================================================
// unit:P12.I3 — without a valid statement naming both, or outside the format: nothing merges
// ===========================================================================

describe('unit:P12.I3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): decisions D1 and D2 — a change statement that is missing, names another pair, is signed with a secret the tenant does not hold, has expired or expires more than 24 hours ahead, and an identifier outside the declared format, are each refused with a named error and merge nothing; a valid statement merges once, and the same statement presented again, by the signed-in browser and on the SDK's retry after a 409 and a detach, merges nothing more`, async () => {
      await identifiers();
      const m = await mount(host, documents(REFLEX_WITH_FORMAT));
      expectPublished(m, 'P12.I3 — the reflex document declaring `accountIdFormat` publishes');
      const door = identityDoor(m), secret = identitySecretOf(m);
      const firstLanding = await shopperOn(m);
      await viewed(firstLanding, [VIEW_TABBY_26, VIEW_TABBY_26], host);
      const flLink = await link(m, door, firstLanding, FL);
      expect(flLink.status, `${host}: PRECONDITION — the first-landing account is linked`).toBe(200);
      const hashedEmail = await shopperOn(m);
      await viewed(hashedEmail, [VIEW_WILLOW, VIEW_WILLOW], host);
      const heLink = await link(m, door, hashedEmail, HE);
      expect(heLink.status, `${host}: PRECONDITION — the hashed-email account is linked`).toBe(200);
      const browser = await shopperOn(m);
      await viewed(browser, [VIEW_TABBY_WALLET], host);
      const before = { fl: pick(await profileOf(door, personOf(flLink), 'the first-landing account')), he: pick(await profileOf(door, personOf(heLink), 'the hashed-email account')),
        browser: pick(await profileOf(door, browser.grant.capability, 'the browser')) };
      const now = Math.floor(Date.now() / 1000);
      const cases: Array<{ name: string; accountId: string; extra: Record<string, unknown>; error: RegExp }> = [
        { name: 'a change with no statement', accountId: HE, extra: { accountChange: { from: FL, exp: now + 600 } }, error: /account ?change/i },
        { name: 'a statement signed over another pair (first-landing to another hashed e-mail)', accountId: HE,
          extra: { accountChange: { ...(await accountChange(secret, FL, OTHER_HE)) } }, error: /account ?change/i },
        { name: 'a statement signed with a secret the tenant does not hold', accountId: HE,
          extra: { accountChange: await accountChange('a-secret-this-tenant-never-held', FL, HE) }, error: /account ?change/i },
        { name: 'an expired statement', accountId: HE, extra: { accountChange: await accountChange(secret, FL, HE, now - 60) }, error: /account ?change/i },
        { name: 'a statement whose expiry lies more than 24 hours ahead', accountId: HE,
          extra: { accountChange: await accountChange(secret, FL, HE, now + 24 * 3600 + 600) }, error: /account ?change/i },
        { name: 'an identifier outside the declared format (a raw e-mail address)', accountId: 'jordan.lee@example.com', extra: {}, error: /accountIdFormat|format/i },
      ];
      for (const c of cases) {
        const refused = await link(m, door, browser, c.accountId, c.extra);
        expect([refused.status >= 400 && refused.status < 500, c.error.test(String(refused.body.error ?? ''))],
          `${host}: P12.I3 — ${c.name} is refused with a named error (status ${refused.status}, ${JSON.stringify(refused.body).slice(0, 160)})`).toEqual([true, true]);
        const after = { fl: pick(await profileOf(door, personOf(flLink), 'the first-landing account')), he: pick(await profileOf(door, personOf(heLink), 'the hashed-email account')),
          browser: pick(await profileOf(door, browser.grant.capability, 'the browser')) };
        for (const key of ['fl', 'he', 'browser'] as const) {
          for (const [value, a] of Object.entries(before[key])) {
            expect(after[key][value as keyof typeof after.fl], `${host}: P12.I3 — after ${c.name}, nothing merged into the ${key} profile (${value})`).toBeCloseTo(a, 3);
          }
        }
      }

      // The valid statement, signed over both identifiers: the first-landing profile merges ONCE.
      const statement = await accountChange(secret, FL, HE);
      const changed = await link(m, door, browser, HE, { accountChange: statement });
      expect([changed.status, changed.body.error ?? changed.body.outcome], `${host}: P12.I3 — the valid statement is accepted`).toEqual([200, 'linked']);
      const signedIn = sessionOf(changed);
      const once = { Tabby: aff(3), Willow: aff(2), Handbags: aff(4), 'Small Leather Goods': aff(1), evening: aff(3) };
      const expectOnce = (merged: ReturnType<typeof pick>, when: string) => {
        for (const [value, a] of Object.entries(once)) {
          expect(merged[value as keyof typeof merged], `${host}: P12.I3 — ${when}, the hashed-email account holds the first-landing history once, its own and the browser's (${value})`).toBeCloseTo(a, 3);
        }
      };
      expectOnce(pick(await profileOf(door, signedIn.capability, 'the hashed-email account')), 'after the valid statement');

      // The same statement presented again by the browser now signed in as the hashed-email account.
      await linkAs(m, door, signedIn, HE, { accountChange: statement });
      expectOnce(pick(await profileOf(door, signedIn.capability, 'the hashed-email account')), 'after the signed-in browser presents the same statement again');

      // The SDK's retry (I5): a 409 answer, a detach, then the fresh visitor's link carrying the statement again.
      const detached = await door.call(`/v1/${TENANT}/identity/detach`, signedIn.capability, { visitorId: signedIn.visitorId });
      expect([detached.status, detached.body.detached ?? null], `${host}: PRECONDITION — the signed-in browser detaches (${JSON.stringify(detached.body).slice(0, 160)})`).toEqual([200, true]);
      const fresh = sessionOf(detached);
      const retried = await linkAs(m, door, fresh, HE, { accountChange: statement });
      expect([retried.status, retried.body.error ?? retried.body.outcome, retried.body.shopperId ?? null],
        `${host}: P12.I3 — the retry carrying the same statement links the fresh visitor to the hashed-email account`).toEqual([200, 'linked', heLink.body.shopperId]);
      expectOnce(pick(await profileOf(door, sessionOf(retried).capability, 'the hashed-email account')), 'after the retry carrying the same statement again');
    });
  }
});

// ===========================================================================
// unit:P12.I4 — the format is a tenant setting
// ===========================================================================

const MALFORMED: Array<{ name: string; value: unknown }> = [
  { name: 'not an object', value: '^[0-9a-f]{64}$' },
  { name: 'no form declared', value: {} },
  { name: 'an unknown form', value: { email: '^[0-9a-f]{64}$' } },
  { name: 'a pattern that does not compile', value: { firstLanding: '^tfl1\\.([0-9a-f]{32}$' } },
  { name: 'a pattern not anchored at both ends', value: { hashedEmail: '[0-9a-f]{64}' } },
];

describe('unit:P12.I4', () => {
  it('logic: decision D2 — the reflex document validator admits a declared format and keeps it, and refuses every malformed format with an error naming accountIdFormat', () => {
    const admitted = validateReflexConfig(REFLEX_WITH_FORMAT);
    expect(admitted.ok, `P12.I4 — a well-formed format is admitted: ${JSON.stringify(admitted).slice(0, 200)}`).toBe(true);
    expect((admitted as { config?: Record<string, unknown> }).config?.accountIdFormat, 'P12.I4 — and kept on the document').toEqual(FORMAT);
    for (const bad of MALFORMED) {
      const refused = validateReflexConfig({ ...REFLEX_DOCUMENT, accountIdFormat: bad.value });
      expect.soft(refused.ok ? 'admitted' : (refused as { errors: string[] }).errors.some(e => e.includes('accountIdFormat')) ? 'refused by name' : `refused without naming it: ${(refused as { errors: string[] }).errors.join('; ')}`,
        `P12.I4 — ${bad.name} is refused with an error naming accountIdFormat`).toBe('refused by name');
    }
  });

  for (const host of HOSTS) {
    it(`host (${host}): publication through the operator's reflex route refuses a malformed format by name and keeps the revision in force, and a tenant that declares no format links any identifier exactly as today`, async () => {
      await identifiers();
      const m = await mount(host, documents(REFLEX_DOCUMENT));
      expectPublished(m, 'P12.I4 — the registry without a format publishes');
      const inForce = await asOperator(m, 'GET', `/config/reflex`);
      expect(inForce.status, `PRECONDITION: the operator reads the reflex document (${JSON.stringify(inForce.body).slice(0, 200)})`).toBe(200);
      // The authored preconditions of the revision in force at each write (kit 02: If-Match plus Idempotency-Key).
      const headers = async () => {
        const head = (await asOperator(m, 'GET', `/config/reflex`)).body;
        return { 'If-Match': `"${head.revision}/${(head.publication as { revision: number }).revision}/${(head.publication as { digest: string }).digest}"`,
          'Idempotency-Key': `${head.revision}:${crypto.randomUUID()}` };
      };
      for (const bad of MALFORMED) {
        const refused = await asOperator(m, 'PUT', `/config/reflex`, { config: { ...REFLEX_DOCUMENT, accountIdFormat: bad.value }, note: 'p12' }, await headers());
        expect.soft([refused.status, ((refused.body.errors ?? []) as string[]).some(e => String(e).includes('accountIdFormat'))],
          `${host}: P12.I4 — publishing ${bad.name} is refused (422) naming accountIdFormat: ${JSON.stringify(refused.body).slice(0, 200)}`).toEqual([422, true]);
      }
      const after = await asOperator(m, 'GET', `/config/reflex`);
      expect.soft(after.body.revision, `${host}: P12.I4 — the revision in force is unchanged`).toBe(inForce.body.revision);
      // LOCKED (src/identity/link.ts, src/routes/identity.ts:71-75): with no format declared any identifier links as today.
      const door = identityDoor(m);
      for (const accountId of ['cust-000123', 'jordan.lee@example.com', HE]) {
        const browser = await shopperOn(m);
        await viewed(browser, [VIEW_TABBY_WALLET], host);
        const linked = await link(m, door, browser, accountId);
        expect([linked.status, linked.body.outcome ?? linked.body.error], `${host}: P12.I4 — with no format declared, ${accountId} links as today`).toEqual([200, 'linked']);
        expect(pick(await profileOf(door, personOf(linked), accountId))['Small Leather Goods'], `${host}: and the browser's profile is merged as today`).toBeCloseTo(aff(1), 3);
      }
    });
  }
});

// ===========================================================================
// unit:P12.I5 — the SDK carries the statement; the kit documents both
// ===========================================================================

const SHOPPER = 'sh_' + 'c'.repeat(32);
const respond = (json: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => json });

describe('unit:P12.I5', () => {
  it('sdk: identify carries the identifier-change statement verbatim on the link request, also on the retry after a 409 and a detach, and sends exactly today\'s body without it', async () => {
    const statement = { from: 'tfl1.' + '0a'.repeat(16), exp: 1_800_000_000, statement: 'backend-signed-change-statement' };
    const f = testHost();
    // The composition `createClient` (src/sdk/index.ts) wires: the shared core and the identity module.
    const core = createCore({ tenant: 'coach' }, f.host), identity = createIdentity(core);
    const client = { identify: identity.identify, logout: identity.logout, destroy: () => core.disconnect() };
    await core.ready();
    const links: Array<Record<string, unknown>> = [];
    let refuseFirst = false;
    f.host.fetch = async (url: string, init?: RequestInitLike) => {
      f.calls.push({ url, init });
      if (url.endsWith('/identity/link')) {
        links.push(JSON.parse(init?.body ?? '{}'));
        if (refuseFirst) { refuseFirst = false; return respond({ ok: false, error: 'this browser already carries a shopper id; detach first' }, 409); }
        return respond({ ok: true, carry: SHOPPER, shopperId: SHOPPER, outcome: 'linked', session: syntheticSession(f.host.now(), SHOPPER) });
      }
      if (url.endsWith('/identity/detach')) return respond({ ok: true, detached: true, session: syntheticSession(f.host.now()) });
      return respond({ success: true });
    };
    const options = { assertion: 'backend-proof', exp: 1_800_000_000, accountChange: statement } as Parameters<typeof client.identify>[1];
    const result = await client.identify('a'.repeat(64), options);
    expect(result.ok, `PRECONDITION: the identify call succeeds (${JSON.stringify(result)})`).toBe(true);
    expect(links[0]?.accountChange, 'P12.I5 — the link request carries the change statement verbatim').toEqual(statement);

    // The 409 path: proof for the fresh visitor comes from the provider; the statement is not visitor-bound and travels again.
    await client.logout();
    refuseFirst = true;
    const retried = await client.identify('a'.repeat(64), { getAssertion: () => ({ assertion: 'backend-proof-2', exp: 1_800_000_000 }), accountChange: statement } as Parameters<typeof client.identify>[1]);
    expect(retried.ok, `PRECONDITION: the retried identify succeeds (${JSON.stringify(retried)})`).toBe(true);
    expect(links.slice(1).map(body => body.accountChange), 'P12.I5 — every link request of the call carries the statement, the retry included').toEqual([statement, statement]);

    // LOCKED (src/sdk/identify.test.ts:37): without the option the body is exactly today's.
    await client.logout();
    await client.identify('b'.repeat(64), { assertion: 'backend-proof-3', exp: 1_800_000_000 });
    expect(Object.keys(links.at(-1)!).sort(), 'P12.I5 — no accountChange member when the caller gives none').toEqual(['accountId', 'assertion', 'exp', 'visitorId']);
    client.destroy();
  });

  it('logic: the integration guide, the API reference and the payload schemas each document the format setting and the identifier-change statement', () => {
    const missing = missingStatements(['docs/kit/01-integration-guide.md', 'docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md'], [
      { name: 'the account identifier format is a tenant setting in the reflex document (accountIdFormat)', test: s => /accountIdFormat/.test(s) && /reflex/i.test(s) },
      { name: 'an identifier outside the declared format is refused', test: s => /accountIdFormat|declared format/i.test(s) && /refus|reject/i.test(s) },
      { name: 'the identifier-change statement (accountChange) is signed by the backend over both identifiers', test: s => /accountChange/.test(s) && /sign/i.test(s) && /both|from .* to|from and to/i.test(s) },
      { name: 'an identifier change merges the two profiles only on that signed statement, never overriding either', test: s => /accountChange|identifier change|change statement/i.test(s) && /merge/i.test(s) && /only|never/i.test(s) },
    ]);
    expect(missing, 'P12.I5 — every kit document states the format setting and the change statement').toEqual([]);
  });
});
