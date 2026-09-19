// src/services/SessionManager.identity.test.ts
//
// CW25 on the session host. What matters:
//
//   after a link, the browser's old cookie lands on the person, for reads AND
//   writes, and a write from the browser cannot rename the person;
//   a second device's link folds in, and the person is the sum;
//   a shared computer's second account inherits nothing;
//   logout detaches a browser; only the person's own session erases the person;
//   an import writes interest and claims no visit.

import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '@/types/env';
import { SessionManager } from '@/services/SessionManager';
import { DEFAULT_REFLEX_CONFIG, apply, audienceKey, emptyState, snapshot, type ReflexState } from '@/reflex/core';
import { newAnonymousSession, SessionAccessError } from '@/identity/sessionCapability';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { consentInstruction, CONSENT_LIFETIME_MS, type Consent } from '@/content/consent';
import { DEFAULT_TENANT } from '@/tenancy/tenant';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) { const r = this.store.get(key); return r === undefined ? null : (type === 'json' ? JSON.parse(r) : r); }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list(options?: { prefix?: string }) { return { keys: [...this.store.keys()].filter(key => key.startsWith(options?.prefix ?? '')).map(name => ({ name })), list_complete: true }; }
}

const cfg = DEFAULT_REFLEX_CONFIG;
const SH = 'sh_' + 'a'.repeat(32);
const SH2 = 'sh_' + 'b'.repeat(32);
const T0 = 1_700_000_000_000;

const browse = (values: string[], at: number): ReflexState => {
  let s = emptyState(cfg);
  values.forEach((v, i) => { s = apply(s, { action: 'product_view', touches: [{ dim: 'line', value: v }] }, at + i * 1000, cfg).state; });
  return s;
};

/**
 * SYNTHETIC test registry, not an approved retention period. An explicit
 * per-category policy is a precondition of a first record and of the import
 * enrichment below (`src/retention.ts:39`, `:72-89`;
 * `src/services/SessionManager.ts:304`); shape from
 * `src/index.api-boundary.test.ts:34-37`.
 */
const SYNTHETIC_POLICY: RetentionPolicy = { id: 'identity-fixture-synthetic', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' };
const SYNTHETIC_RETENTION = JSON.stringify({ version: 1, tenants: { [DEFAULT_TENANT]:
  Object.fromEntries((['profile', 'identity', 'ledger', 'online', 'hourly'] as RetentionCategory[]).map((category) => [category, SYNTHETIC_POLICY])) } });

let kv: FakeKV;
let env: Env;
let sm: SessionManager;

beforeEach(() => {
  kv = new FakeKV();
  env = { SESSIONS: kv, RETENTION: SYNTHETIC_RETENTION } as unknown as Env;
  sm = new SessionManager(env);
});

/** One subject's explicit stored choice. Legacy `preferences` booleans grant
 * nothing (`src/content/consent.ts:139-152`, `:156-163`; settled decision
 * `docs/remediation/decisions/D06-W05-explicit-choice-approved-2026-09-16.json`),
 * so a browser's own record only exists because its subject chose. */
const choiceFor = (subject: string, tenant = DEFAULT_TENANT): Consent => {
  const chosenAt = Date.now() - 1000;
  return consentInstruction({
    version: 1, tenant, subject, revision: 'identity-fixture-explicit-choice',
    tracking: { value: true, chosenAt, expiresAt: chosenAt + CONSENT_LIFETIME_MS },
    personalization: { value: true, chosenAt, expiresAt: chosenAt + CONSENT_LIFETIME_MS },
  });
};
/** The owner operation carrying that one subject's record, as production runs it. */
const held = <T>(subject: string, work: () => Promise<T>, operationEnv: Env = env): Promise<T> =>
  runOwnerOperation({}, operationEnv, work, kv, undefined, async () => choiceFor(subject));

it('W04.02 owned mode rejects pointers, forwarding renewal and repeated read/write promotion', async () => {
  const env = { SESSIONS: kv, RETENTION: SYNTHETIC_RETENTION, JWT_SECRET: 'w0402-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } as unknown as Env;
  const grant = await newAnonymousSession(env, 'coach');
  const owned = new SessionManager(env, { principal: grant });
  await expect(owned.getSession(grant.sessionId)).rejects.toBeInstanceOf(SessionAccessError);
  const owner = {};
  await runOwnerOperation(owner, env, async () => {
  admitOwnerPrincipal(owner, grant);
  await owned.createOrUpdateSession(grant.sessionId, grant.subject, { segments: ['owned'] });
  await device('victim', 'victim-session', ['Tabby'], T0);
  kv.store.set(`user:${grant.subject}`, 'victim-session');
  expect((await owned.getSessionByUserId(grant.subject))?.segments).toEqual(['owned']);
  const raw = await sm.readRaw(grant.sessionId);
  kv.store.set(`session:${grant.sessionId}`, JSON.stringify({ ...raw, forwardTo: 'victim-session', metadata: { ...raw!.metadata, lastSeen: 1 } }));
  const before = [...kv.store];
  await expect(owned.getSession(grant.sessionId)).rejects.toBeInstanceOf(SessionAccessError);
  await expect(owned.createOrUpdateSession(grant.sessionId, grant.subject, { segments: ['must-not-write'] })).rejects.toBeInstanceOf(SessionAccessError);
  await expect(owned.getSession('victim-session')).rejects.toBeInstanceOf(SessionAccessError);
  expect([...kv.store]).toEqual(before);
  }, kv, undefined, async () => choiceFor(grant.subject));
});

/** A browser with a session holding a reflex vector and a few counters. */
async function device(visitorId: string, sessionId: string, values: string[], at: number) {
  await held(visitorId, () => sm.createOrUpdateSession(sessionId, visitorId, {
    reflex: browse(values, at), attributes: { product_views: values.length, viewed_product_line: values.at(-1) },
  }));
  return sessionId;
}

describe('absorbIntoShopper: the first link', () => {
  it('creates the person from the browser, forwards the browser, repoints its user key', async () => {
    await device('vis-phone', 's-phone', ['Tabby', 'Tabby', 'Tabby'], T0);
    const r = await sm.absorbIntoShopper({ shopperId: SH, from: await sm.readRaw('s-phone'), fromSessionId: 's-phone', config: cfg, now: T0 + 5000 });
    expect(r.created).toBe(true);
    expect(r.data.userId).toBe(SH);
    expect(r.data.identity?.shopperId).toBe(SH);
    expect(r.data.reflex?.audiences).toContain(audienceKey('line', 'Tabby'));
    // The browser's record forwards; its content underneath is untouched.
    const tomb = await sm.readRaw('s-phone');
    expect(tomb?.forwardTo).toBe(r.sessionId);
    expect(tomb?.userId).toBe('vis-phone');
    expect(await sm.resolveSessionIdByUserId('vis-phone')).toBe(r.sessionId);
    expect(await sm.resolveSessionIdByUserId(SH)).toBe(r.sessionId);
  });

  // LEFT RED ON PURPOSE (BASE-2, ruling R10). Its assertions are untouched. With
  // the fixture corrected, no owner consent record can authorize this write: the
  // browser's tombstone holds `userId: 'vis-phone'` and the person's record holds
  // the shopper id, while `src/services/SessionManager.ts:381-382` refuses any
  // record whose userId differs from the single instruction subject. Measured:
  // subject sh_… and subject vis-phone both raise SessionAccessError; with no
  // instruction the write is refused and nothing lands. CW25 (document 35 §5 W04)
  // still requires the post-link write to reach the person. Unit to declare:
  // W05.BASE.01.
  it('the old cookie reads the person, and a write from the browser lands on the person without renaming it', async () => {
    await device('vis-phone', 's-phone', ['Tabby', 'Tabby', 'Tabby'], T0);
    const r = await sm.absorbIntoShopper({ shopperId: SH, from: await sm.readRaw('s-phone'), fromSessionId: 's-phone', config: cfg, now: T0 + 5000 });
    expect((await sm.getSession('s-phone'))?.userId).toBe(SH);

    const written = await sm.createOrUpdateSession('s-phone', 'vis-phone', { attributes: { last_page_path: '/bags' } });
    expect(written.userId).toBe(SH);                         // the person's id survived the browser's write
    expect(written.attributes.last_page_path).toBe('/bags');
    const person = await sm.readRaw(r.sessionId);
    expect(person?.attributes.last_page_path).toBe('/bags'); // it landed on the person
    expect((await sm.readRaw('s-phone'))?.attributes.last_page_path).toBeUndefined(); // not on the tombstone
  });
});

describe('absorbIntoShopper: the second device', () => {
  it('folds in: the person is the sum of both devices', async () => {
    await device('vis-phone', 's-phone', ['Tabby', 'Tabby'], T0);
    await device('vis-laptop', 's-laptop', ['Rogue', 'Rogue', 'Tabby'], T0 + 2000);
    const first = await sm.absorbIntoShopper({ shopperId: SH, from: await sm.readRaw('s-phone'), fromSessionId: 's-phone', config: cfg, now: T0 + 6000 });
    const second = await sm.absorbIntoShopper({ shopperId: SH, from: await sm.readRaw('s-laptop'), fromSessionId: 's-laptop', config: cfg, now: T0 + 7000 });
    expect(second.created).toBe(false);
    expect(second.sessionId).toBe(first.sessionId);
    const snap = snapshot(second.data.reflex!, T0 + 7000, cfg);
    // Three Tabby touches across two devices: over the threshold, where each device alone was not.
    expect(snap.dims.line.Tabby).toBeGreaterThanOrEqual(cfg.thetaIn);
    expect(snap.dims.line.Rogue).toBeGreaterThan(0);
    expect(second.data.attributes.product_views).toBe(5);      // counters add
    expect(second.data.metadata.visitCount).toBe(2);            // one visit per device, one person
    expect(second.data.metadata.firstSeen).toBeLessThanOrEqual(first.data.metadata.firstSeen);
    expect(await sm.resolveSessionIdByUserId('vis-laptop')).toBe(first.sessionId);
  });

  it('a browser already forwarding here folds nothing twice', async () => {
    await device('vis-phone', 's-phone', ['Tabby', 'Tabby'], T0);
    const a = await sm.absorbIntoShopper({ shopperId: SH, from: await sm.readRaw('s-phone'), fromSessionId: 's-phone', config: cfg, now: T0 + 6000 });
    const b = await sm.absorbIntoShopper({ shopperId: SH, from: await sm.readRaw('s-phone'), fromSessionId: 's-phone', config: cfg, now: T0 + 6001 });
    expect(b.data.attributes.product_views).toBe(a.data.attributes.product_views);
    expect(b.data.reflex!.dims.line.Tabby.s).toBeCloseTo(a.data.reflex!.dims.line.Tabby.s, 9);
  });
});

describe('a shared computer', () => {
  it('repoint: the second account inherits nothing of the first', async () => {
    await device('vis-shared', 's-shared', ['Tabby', 'Tabby', 'Tabby'], T0);
    await sm.absorbIntoShopper({ shopperId: SH, from: await sm.readRaw('s-shared'), fromSessionId: 's-shared', config: cfg, now: T0 + 5000 });
    const second = await sm.absorbIntoShopper({ shopperId: SH2, from: await sm.readRaw('s-shared'), fromSessionId: 's-shared', config: cfg, now: T0 + 9000, mode: 'repoint' });
    expect(second.created).toBe(true);
    expect(second.data.reflex?.dims).toEqual({});
    expect(second.data.attributes).toEqual({});
    expect((await sm.readRaw('s-shared'))?.forwardTo).toBe(second.sessionId);
    expect(await sm.resolveSessionIdByUserId('vis-shared')).toBe(second.sessionId);
  });
});

describe('leaving', () => {
  it('deleting the browser session detaches the browser and leaves the person whole', async () => {
    await device('vis-phone', 's-phone', ['Tabby'], T0);
    const r = await sm.absorbIntoShopper({ shopperId: SH, from: await sm.readRaw('s-phone'), fromSessionId: 's-phone', config: cfg, now: T0 + 5000 });
    await sm.deleteSession('s-phone');
    expect(await sm.readRaw('s-phone')).toBeNull();
    expect(await sm.resolveSessionIdByUserId('vis-phone')).toBeNull();
    expect((await sm.readRaw(r.sessionId))?.userId).toBe(SH);
    expect(await sm.resolveSessionIdByUserId(SH)).toBe(r.sessionId);
  });

  it("deleting the person's own session erases the person", async () => {
    await device('vis-phone', 's-phone', ['Tabby'], T0);
    const r = await sm.absorbIntoShopper({ shopperId: SH, from: await sm.readRaw('s-phone'), fromSessionId: 's-phone', config: cfg, now: T0 + 5000 });
    await sm.deleteSession(r.sessionId);
    expect(await sm.readRaw(r.sessionId)).toBeNull();
    expect(await sm.resolveSessionIdByUserId(SH)).toBeNull();
  });
});

describe('applyImport', () => {
  // Arithmetic-only service tests. The mounted W04.03/W05.09 fixtures exercise
  // the actual owner-issued preparation, grant, epoch and erasure protocol.
  const asPerson = (work: () => Promise<void>) => held(SH, work);
  it('refuses a cold import and enriches an existing consenting person without claiming a visit', async () => {
    await asPerson(async () => {
    const input = { userId: SH, rows: [{ action: 'purchase', at: T0, touches: [{ dim: 'line', value: 'Brooklyn' }] }], config: cfg, now: T0 };
    expect(await sm.applyImport(input)).toEqual({ applied: false, reason: 'profile_missing' });
    expect(kv.store.size).toBe(0);
    const before = await sm.createOrUpdateSession('s-person', SH, { identity: { shopperId: SH, linkedAt: T0 },
      preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true } });
    const r = await sm.applyImport(input);
    expect(r.applied).toBe(true); if (!r.applied) throw new Error('expected import');
    expect(r.created).toBe(false);
    expect(r.data.metadata).toEqual({ ...before.metadata, lastSegmentUpdate: T0 });
    expect(r.data.identity?.shopperId).toBe(SH);
    const live = await sm.createOrUpdateSession(r.sessionId, SH, {});
    expect(live.metadata.visitCount).toBe(before.metadata.visitCount);
    expect(live.reflex?.dims.line?.Brooklyn).toBeDefined();
    });
  });

  it('requires the already resolved canonical person for a linked browser', async () => {
    await asPerson(async () => {
    const person = await sm.createOrUpdateSession('s-person', SH, { identity: { shopperId: SH, linkedAt: T0 }, reflex: browse(['Tabby'], T0) });
    const linked = { sessionId: 's-person' };
    // Exact retained forwarding shape; constructing it is fixture setup, not
    // a replacement for the separately tested signed account-link protocol.
    kv.store.set('session:s-phone', JSON.stringify({ ...person, userId: 'vis-phone', identity: undefined, forwardTo: linked.sessionId }));
    kv.store.set('user:vis-phone', linked.sessionId);
    const rows = [{ action: 'purchase', at: T0, touches: [{ dim: 'line', value: 'Rogue' }] }];
    const before = [...kv.store];
    await expect(sm.applyImport({ userId: 'vis-phone', rows, config: cfg, now: T0 + 6000 })).rejects.toBeInstanceOf(SessionAccessError);
    expect([...kv.store]).toEqual(before);
    const r = await sm.applyImport({ userId: SH, rows, config: cfg, now: T0 + 6000 });
    expect(r.applied).toBe(true); if (!r.applied) throw new Error('expected import');
    expect(r.sessionId).toBe(linked.sessionId);
    expect(r.data.userId).toBe(SH);
    });
  });
});

describe('the forward renews itself under a returning browser', () => {
  it('rewrites the browser record and its user key once the record is a day old', async () => {
    await device('vis-phone', 's-phone', ['Tabby'], T0);
    const r = await sm.absorbIntoShopper({ shopperId: SH, from: await sm.readRaw('s-phone'), fromSessionId: 's-phone', config: cfg, now: T0 + 5000 });
    const raw = JSON.parse(kv.store.get('session:s-phone')!);
    raw.metadata.lastSeen = Date.now() - 2 * 24 * 3600_000;
    kv.store.set('session:s-phone', JSON.stringify(raw));
    kv.store.delete('user:vis-phone');
    await sm.getSession('s-phone');
    expect(JSON.parse(kv.store.get('session:s-phone')!).metadata.lastSeen).toBeGreaterThan(Date.now() - 60_000);
    expect(kv.store.get('user:vis-phone')).toBe(r.sessionId);
  });
});
