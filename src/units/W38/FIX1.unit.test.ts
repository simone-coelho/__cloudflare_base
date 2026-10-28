// src/units/W38/FIX1.unit.test.ts
//
// W38 fix 1 — unit:W38.B4.x: the salt count of a learn history written before
// the W21 annotation survives a purge under the configuration-revision setting.
//
// AUTHORITY: ticket W38 criterion B4 (docs/remediation/delivery-control/program.json;
// decision D3, amendment A35) — "older revisions are purged only under a
// per-category retention setting for configuration revisions … and with that
// setting unset nothing is purged" — read with W21 E1.07 (R130), whose salt
// count a purged history must not lose.
//
// WITNESSES
//   · The delivery review of 8624159 (_evidence/W38-delivery/reviewer/RESUME-NOTE.md,
//     probe B4-salt): when the current learn revision carries no exact salt count
//     — a learn history written before the W21 annotation, which is every
//     deployed tenant at release — a purge under the setting removes early learn
//     revisions and the next learn publication's count is null, where with the
//     setting unset it is exact.
//   · The A35 build note (_evidence/step3/AMENDMENTS.md): a learn revision's
//     salt count is built "so a B4 purge never nulls it (keep W21's 24-revision
//     rule, W21/B2.unit.test.ts:975-978)"; "a carried count is consistent with"
//     the W21 kit sentence pinned at W21/B2.unit.test.ts:762.
//   · docs/kit/02-api-reference.md as built at 8624159, :706: "A learn revision
//     builds its salt count from the one before it, so a purge never turns an
//     exact `saltVersion` into an unknown"; :532: "A learn document published
//     before this release carries no salt-version annotation, so decisions and
//     outcomes under it read `saltVersion: null` until that tenant next
//     publishes its learn document"; :527-529: the count of distinct salts up
//     to the pinned revision, `null` past the 24-revision horizon.
//   · W21 E1.03 (src/content/holdout.ts saltVersionOf): 1 for the first
//     effective salt, unchanged by a revision that keeps it, one more on each
//     rotation; the effective salt of a document whose `holdout.salt` is empty
//     is the brand (DEFAULT_LEARN ships `salt: ''`).
//
// THE PRE-W21 HISTORY. src/config/publication.ts as 6882874 ("W21-B2 (8): the
// salt version is carried where the head is read") found it — last changed at
// 2c9e4bb, the same file at 6882874^ — sealed each revision envelope from
// { schema, kind, scope, revision, value, actor, note, at, operation };
// 6882874 added the one member `derived` and changed nothing else the writer
// stores. A history that writer stored is
// therefore this engine's history with `derived` absent and every digest taken
// over what remains: the envelope's own, the set references that name it, the
// chain of sets (each names its base set's digest) and the head. The history
// is built through the mounted routes and given exactly that form after every
// publication, so each later publication's If-Match and request digest are
// taken over the pre-W21 chain; the engine re-verifies every digest when it
// reads it. Nothing under test is stubbed.
//
// EXPECTED VALUES (from the witnesses, never from the engine): revision 1 is
// DEFAULT_LEARN (effective salt: the brand, `coach`), revisions 2-4 rotate to
// `spring-26`; so revision 5 on `spring-26` counts 2 and revision 6 on
// `autumn-26` counts 3 — with the setting unset (the whole history is read)
// and, by B4 with kit 02 :706, with it set. At the edge (current pre-W21
// learn revision 24, the last whose successor still reads back to revision 1
// through the walk's 24 reads) revision 25 counts 2 either way. Past that
// former horizon (a 26-revision pre-W21 history) the count is taken over the
// whole stored history since P95 (E20; the boundary leg amended by name,
// R-P511): 2 either way, the setting keeping every learn revision while the
// current one carries no exact count — a purge never turns an exact count into
// an unknown.
//
// NOT RULED: which learn revisions the purge removes inside the horizon —
// either the purge spares the learn revisions a later count needs, or the count
// does not need them; there the test observes only the counts, what the setting
// purges of the other kinds, and that nothing is purged with the setting unset.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '@/types/env';
import { carriedSaltVersion, initializePublicationSet, readPublication } from '@/config/publication';
import { invalidateCache, readVersion, type DocumentKind } from '@/config/versionedStore';
import { invalidateSaltVersions, outcomeEnrollment } from '@/content/holdout';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import type { ContentCatalog, LearnConfig } from '@/content/types';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { DEFAULT_STATS } from '@/learn/stats';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import type { RetentionPolicy } from '@/retention';
import { contentRoutes } from '@/routes/content';
import { tenantMiddleware } from '@/tenancy/middleware';

const encoder = new TextEncoder();
const bytesOf = (text: string) => encoder.encode(text).byteLength;
const H = 'https://w38-fix1.invalid';
const SECRET = 'w38-fix1-synthetic-signing-material';
const TENANT = 'coach';
const VISITOR = 'vis-00000000-0000-4000-8000-0000000000f1';
const DAY = 86_400_000, D0 = Date.UTC(2026, 5, 1), at = (day: number) => D0 + day * DAY;

// ─── storage: R2 with R2's own conditional semantics and listing ────────────

class LedgerR2 {
  objects = new Map<string, string>(); etags = new Map<string, string>();
  deletes: string[] = []; seq = 0;
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: this.etags.get(key)!, size: bytesOf(raw), body: new Response(raw).body,
      text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { const raw = this.objects.get(key); return raw === undefined ? null : { key, etag: this.etags.get(key)!, size: bytesOf(raw) }; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const condition = options?.onlyIf, exists = this.objects.has(key);
    if (condition instanceof Headers ? condition.get('If-None-Match') === '*' && exists
      : condition && (('etagMatches' in condition && condition.etagMatches !== this.etags.get(key))
        || ('etagDoesNotMatch' in condition && condition.etagDoesNotMatch === '*' && exists))) return null;
    this.objects.set(key, raw); this.etags.set(key, 'w38-fix1-' + (++this.seq));
    return { key, etag: this.etags.get(key)!, size: bytesOf(raw) };
  }
  /** Recorded AND performed, so a deletion is visible both ways. */
  async delete(keys: string | string[]) { for (const key of [keys].flat()) { this.deletes.push(key); this.objects.delete(key); this.etags.delete(key); } }
  async list(options?: { prefix?: string; startAfter?: string; delimiter?: string; limit?: number; cursor?: string }) {
    const prefix = options?.prefix ?? '', delimiter = options?.delimiter;
    const keys = [...this.objects.keys()].filter(key => key.startsWith(prefix) && (options?.startAfter === undefined || key > options.startAfter)).sort();
    const entries: Array<{ key: string } | { prefix: string }> = [];
    for (const key of keys) {
      const cut = delimiter ? key.indexOf(delimiter, prefix.length) : -1;
      if (cut < 0) { entries.push({ key }); continue; }
      const rolled = key.slice(0, cut + delimiter!.length);
      if (!entries.some(entry => 'prefix' in entry && entry.prefix === rolled)) entries.push({ prefix: rolled });
    }
    const start = Number(options?.cursor ?? 0), end = start + Math.min(options?.limit ?? 1000, 1000), page = entries.slice(start, end);
    return { objects: page.filter((entry): entry is { key: string } => 'key' in entry).map(({ key }) => ({ key, size: bytesOf(this.objects.get(key)!), etag: this.etags.get(key)!, uploaded: new Date(0) })),
      delimitedPrefixes: page.filter((entry): entry is { prefix: string } => 'prefix' in entry).map(entry => entry.prefix),
      truncated: end < entries.length, ...(end < entries.length ? { cursor: String(end) } : {}) };
  }
  /** The revision numbers of one kind whose bodies are stored, ascending. */
  revisions(kind: string): number[] {
    const prefix = `config-publication/v1/${TENANT}/${kind}/rev/`;
    return [...this.objects.keys()].filter(key => key.startsWith(prefix)).map(key => Number(key.slice(prefix.length, -'.json'.length))).sort((a, b) => a - b);
  }
}
class LedgerKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.store.get(key); if (raw === undefined) return null;
    return type === 'stream' ? new Response(raw).body : type === 'json' ? JSON.parse(raw) : raw;
  }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
}

// ─── the stored form the writer before W21 E1.07 produced ───────────────────

/** Canonical JSON (keys sorted, no whitespace): the form every publication object is stored and digested in. */
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value);
const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
const sealed = async (basis: Record<string, unknown>) => ({ ...basis, digest: await sha256(canonical(basis)) });

/**
 * Gives the tenant's stored learn history the form the pre-W21 writer (2c9e4bb)
 * stored: each learn envelope without `derived`, and every digest that names
 * it — set references, the chain of sets, the head — over what remains.
 * Answers how many learn revisions it found annotated (the engine that built
 * the history annotates every one); a store already in that form is left
 * byte for byte as it is.
 */
async function asStoredBeforeW21(storage: LedgerR2): Promise<number> {
  const revisions = `config-publication/v1/${TENANT}/learn/rev/`, sets = `config-publication/v2/${TENANT}/set/`, head = `config-publication/v2/${TENANT}/head.json`;
  const documentDigests = new Map<string, string>(), setDigests = new Map<string, string>();
  let annotated = 0;
  for (const key of [...storage.objects.keys()].filter(key => key.startsWith(revisions))) {
    const { derived, digest, ...basis } = JSON.parse(storage.objects.get(key)!) as Record<string, unknown>;
    if (derived !== undefined) annotated++;
    const envelope = await sealed(basis);
    documentDigests.set(digest as string, envelope.digest);
    await storage.put(key, canonical(envelope));
  }
  const numbers = [...storage.objects.keys()].filter(key => key.startsWith(sets)).map(key => Number(key.slice(sets.length, -'.json'.length))).sort((a, b) => a - b);
  for (const n of numbers) {
    const { digest, ...set } = JSON.parse(storage.objects.get(`${sets}${n}.json`)!) as { digest: string; refs: Record<string, { digest: string }>; operation: { base: { revision: number; digest: string } | null } };
    for (const ref of Object.values(set.refs)) ref.digest = documentDigests.get(ref.digest) ?? ref.digest;
    if (set.operation.base) set.operation.base = { revision: set.operation.base.revision, digest: setDigests.get(set.operation.base.digest) ?? set.operation.base.digest };
    const resealed = await sealed(set as unknown as Record<string, unknown>);
    setDigests.set(digest, resealed.digest);
    await storage.put(`${sets}${n}.json`, canonical(resealed));
  }
  const { digest: _headDigest, ...current } = JSON.parse(storage.objects.get(head)!) as { digest: string; committed: { revision: number; digest: string }; pending: unknown };
  void _headDigest;
  current.committed = { revision: current.committed.revision, digest: setDigests.get(current.committed.digest)! };
  await storage.put(head, canonical(await sealed(current as unknown as Record<string, unknown>)));
  return annotated;
}

// ─── one tenant, its registry and its documents ─────────────────────────────

const policy = (id: string, days: number): RetentionPolicy => ({ id, revision: 1, durationMs: days * DAY, basis: 'occurred', renewal: 'new-record-only' });
/** The registry's seven capture categories (src/retention.ts RETENTION_CATEGORIES), each set. */
const REGISTRY = Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'].map(category => [category, policy('w38-fix1-' + category, 365)]));
/** Decision D3: the configuration-revision retention setting, 30 days. */
const CONFIGURATION = policy('w38-fix1-configuration-revisions', 30);

const KINDS: DocumentKind<unknown>[] = [CONTENT_KIND, SLOTS_KIND, LEARN_KIND, REFLEX_KIND, PRIORS_KIND, PROPOSALS_KIND] as DocumentKind<unknown>[];
const scopeFor = (kind: DocumentKind<unknown>) => kind.name === 'reflex' ? reflexScopeForTenant(TENANT) : TENANT;
/** Coach's catalog: its taxonomy, a cross-category piece and a feed row whose dimension the registry does not know. */
const catalogOf = (n: number) => ({ version: `coach-catalog-${n}`, pieces: [
  { id: 'cnt_tabby', customerContentId: 'CCH-101', type: 'campaign', title: `The Tabby (catalog revision ${n})`,
    tags: { line: ['Tabby'], occasion: [n % 2 ? 'evening' : 'everyday'], category: ['Handbags'], contentType: ['campaign'] }, slotTypes: ['chero', 'story'], lifecycle: { status: 'live' } },
  { id: 'cnt_charms', customerContentId: 'CCH-102', type: 'editorial', title: `Charms for every bag (catalog revision ${n})`,
    tags: { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'], contentType: ['editorial'] }, slotTypes: ['chero', 'story'], lifecycle: { status: 'live' } },
  { id: 'cnt_unknown', customerContentId: 'CCH-103', type: 'editorial', title: `A feed row the registry does not know (catalog revision ${n})`,
    tags: { material: ['pebbled leather'], occasion: ['wombat-unrecognized'] }, slotTypes: ['story'], lifecycle: { status: 'live' } },
] } as unknown as ContentCatalog);
/** A learn document on one salt; `minEvents` moves so no two revisions are the same document. */
const learnOf = (salt: string, n: number) => ({ version: 'coach-learn', holdout: { share: 0.1, salt, arms: ['default'] },
  regional: { enabled: true, kBlend: 1, minEvents: 30 + n }, policy: DEFAULT_LEARN.policy, stats: DEFAULT_STATS,
  slots: { chero: { reward: 'click', objective: 'unit', gamma: 1 }, story: { reward: 'click', objective: 'unit', gamma: 0 } } } as unknown as LearnConfig);

const token = () => new SignJWT({ sub: 'ops', type: 'service', roles: ['admin'] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
  .setIssuer('i').setAudience('a').setExpirationTime('10m').sign(encoder.encode(SECRET));

/**
 * A tenant whose learn history — DEFAULT_LEARN at revision 1, then one learn
 * revision a day on `salts` — and first two catalog revisions were stored by
 * the writer before W21 E1.07, met by this engine in a cold isolate.
 */
async function preW21Tenant(configuration: boolean, salts: string[]) {
  vi.setSystemTime(at(0)); invalidateCache(); invalidateSaltVersions();
  const storage = new LedgerR2();
  const env = { CACHE: new LedgerKV(), STORAGE: storage, JWT_SECRET: SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: configuration ? { ...REGISTRY, configuration: CONFIGURATION } : REGISTRY } }) } as unknown as Env;
  const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>();
  app.use('*', tenantMiddleware()); app.route('/content', contentRoutes);
  let operations = 0;
  /** An operator's PUT through the mounted route, If-Match from the loaded draft (kit 02 §4). */
  const publish = async (day: number, route: 'catalog' | 'learn', kind: DocumentKind<unknown>, document: unknown) => {
    vi.setSystemTime(at(day)); invalidateCache();
    const read = await readPublication(env, kind, TENANT);
    const response = await app.request(H + '/content/' + route, { method: 'PUT', body: JSON.stringify({ document, note: `${route} on day ${day}` }),
      headers: { Authorization: `Bearer ${await token()}`, 'X-Tenant': TENANT, 'Content-Type': 'application/json',
        'If-Match': `"${read.revision}/${read.publication!.revision}/${read.publication!.digest}"`,
        'Idempotency-Key': `${read.revision}:00000000-0000-4000-8000-${(++operations).toString(16).padStart(12, '0')}` } }, env);
    expect(response.status, `${configuration ? 'set' : 'unset'}: ${route} on day ${day} is published: ${await response.clone().text()}`).toBe(200);
  };
  const defaults: Record<string, unknown> = { content: catalogOf(1), slots: DEFAULT_SLOTS, learn: DEFAULT_LEARN, reflex: DEFAULT_REFLEX_CONFIG, prior: EMPTY_PRIORS, proposals: EMPTY_PROPOSALS };
  await initializePublicationSet(env, KINDS.map(kind => ({ kind, scope: scopeFor(kind),
    revision: { revision: 1, value: defaults[kind.name], actor: 'w38-fix1-initializer', note: '', at: at(0) } })), '0:00000000-0000-4000-8000-000000000000');
  // Each step leaves the store as the pre-W21 writer left it, so the next
  // publication's If-Match and request digest are taken over that chain.
  let annotated = await asStoredBeforeW21(storage);
  for (const [i, salt] of salts.entries()) {
    await publish(i + 1, 'learn', LEARN_KIND as DocumentKind<unknown>, learnOf(salt, i + 2));
    annotated += await asStoredBeforeW21(storage);
    if (i < 2) { await publish(i + 1, 'catalog', CONTENT_KIND as DocumentKind<unknown>, catalogOf(i + 2)); annotated += await asStoredBeforeW21(storage); }
  }
  expect(annotated, 'fixture: every learn revision the engine wrote carried its annotation, and now carries none').toBe(salts.length + 1);
  // The W38 build meets the pre-W21 history in a fresh isolate.
  invalidateCache(); invalidateSaltVersions();
  expect(carriedSaltVersion(await readPublication(env, LEARN_KIND, TENANT)), 'fixture: the engine reads the pre-W21 head, which carries no salt annotation (kit 02 :532)').toBeNull();

  /** The count a learn publication carries, and the one an outcome recorded under it is stamped with. */
  const saltCount = async () => {
    invalidateCache();
    const annotation = carriedSaltVersion(await readPublication(env, LEARN_KIND, TENANT));
    invalidateCache();
    const enrollment = await outcomeEnrollment(env, TENANT, TENANT, VISITOR, true);
    return { annotation, outcome: enrollment === null ? 'no enrollment' : enrollment.saltVersion };
  };
  /** Every revision that should still read with nothing purged. */
  const unreadable = async () => {
    invalidateCache();
    const out: string[] = [];
    for (const kind of [CONTENT_KIND, LEARN_KIND] as DocumentKind<unknown>[]) {
      const current = (await readPublication(env, kind, TENANT)).revision;
      for (let n = 1; n <= current; n++) if (!await readVersion(env, kind, TENANT, n).then(revision => revision?.revision === n, () => false)) out.push(`${kind.name} ${n}`);
    }
    return out;
  };
  return { env, storage, publish, saltCount, unreadable };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); invalidateCache(); invalidateSaltVersions(); });
afterEach(() => { vi.useRealTimers(); invalidateCache(); invalidateSaltVersions(); });

// ===========================================================================
// unit:W38.B4.x — a purge never nulls the salt count of a pre-W21 learn history
// ===========================================================================

describe('unit:W38.B4.x', () => {
  /**
   *   day 0     initialized: catalog 1, learn 1 = DEFAULT_LEARN (salt '' → brand `coach`)
   *   day 1-3   learn 2, 3, 4 on `spring-26`; catalog 2 (day 1), 3 (day 2)   — stored by the pre-W21 writer
   *   day 100   catalog 4: with the setting set, the purge runs (catalog 1 and 2 are older than it)
   *   day 101   learn 5 on `spring-26`   → count 2
   *   day 102   catalog 5: the purge runs again
   *   day 103   learn 6 on `autumn-26`   → count 3
   */
  it('B4.x: a learn history written before the W21 annotation keeps its exact salt count across a purge under the configuration-revision setting — the next learn publications carry what they carry with the setting unset, never null', async () => {
    const run = async (configuration: boolean) => {
      const tenant = await preW21Tenant(configuration, ['spring-26', 'spring-26', 'spring-26']);
      await tenant.publish(100, 'catalog', CONTENT_KIND as DocumentKind<unknown>, catalogOf(4));
      const catalogAfterPurge = tenant.storage.revisions('content');
      await tenant.publish(101, 'learn', LEARN_KIND as DocumentKind<unknown>, learnOf('spring-26', 5));
      const fifth = await tenant.saltCount();
      await tenant.publish(102, 'catalog', CONTENT_KIND as DocumentKind<unknown>, catalogOf(5));
      await tenant.publish(103, 'learn', LEARN_KIND as DocumentKind<unknown>, learnOf('autumn-26', 6));
      const sixth = await tenant.saltCount();
      return { catalogAfterPurge, fifth, sixth, deleted: tenant.storage.deletes, unreadable: configuration ? null : await tenant.unreadable() };
    };
    const unset = await run(false), set = await run(true);

    // Unset: the whole pre-W21 history is read, and the counts are W21's.
    expect({ fifth: unset.fifth, sixth: unset.sixth }, 'with the setting unset, learn 5 counts the brand fallback then spring-26 (2) and learn 6 adds autumn-26 (3), on the revision and on the outcome recorded under it (W21 E1.03; kit 02 :527-532)')
      .toEqual({ fifth: { annotation: { salt: 'spring-26', version: 2 }, outcome: 2 }, sixth: { annotation: { salt: 'autumn-26', version: 3 }, outcome: 3 } });
    expect({ deleted: unset.deleted, unreadable: unset.unreadable }, 'with the setting unset nothing is purged: no stored object is deleted and every catalog and learn revision still reads (decisions D2, D3)')
      .toEqual({ deleted: [], unreadable: [] });

    // Set: the purge is in force here, and the counts are the same.
    expect(set.catalogAfterPurge, 'fixture: with the setting set, the day-100 publication purges catalog 1 and 2 (older than 30 days, neither current nor previous, named by no stored decision)').toEqual([3, 4]);
    expect(set.fifth, 'W38.B4.x — after a purge under the configuration-revision setting, the first learn publication on a pre-W21 history carries the exact salt count it carries with the setting unset (spring-26, 2), never null (A35 build note; kit 02 :706 "a purge never turns an exact saltVersion into an unknown")')
      .toEqual(unset.fifth);
    expect(set.sixth, 'W38.B4.x — and after the next purge the rotation to autumn-26 counts 3, as unset').toEqual(unset.sixth);
  }, 60_000);

  /**
   * The exact edge of the carry: a pre-W21 history whose current learn revision
   * is 24. Learn 25's walk reads revisions 24 … 1 — its 24 reads reach revision
   * 1 — so with the setting unset it counts exactly, and a purge must leave the
   * same count (the walk's horizon, src/content/holdout.ts SALT_HISTORY_READS,
   * and the carry's, src/config/publication.ts SALT_CARRY_REVISIONS).
   *
   *   day 0      initialized: catalog 1, learn 1 = DEFAULT_LEARN (brand `coach`)
   *   day 1-23   learn 2 … 24 on `spring-26`; catalog 2 (day 1), 3 (day 2) — stored by the pre-W21 writer
   *   day 100    catalog 4: with the setting set, the purge runs
   *   day 101    learn 25 on `spring-26`  → count 2
   */
  it('B4.x: edge — a pre-W21 history whose current learn revision is 24, the last whose successor still reads back to revision 1, keeps its exact count across the purge: learn 25 carries spring-26, 2 with the setting set, as unset', async () => {
    const run = async (configuration: boolean) => {
      const tenant = await preW21Tenant(configuration, Array.from({ length: 23 }, () => 'spring-26'));
      await tenant.publish(100, 'catalog', CONTENT_KIND as DocumentKind<unknown>, catalogOf(4));
      const catalogAfterPurge = tenant.storage.revisions('content');
      await tenant.publish(101, 'learn', LEARN_KIND as DocumentKind<unknown>, learnOf('spring-26', 25));
      return { catalogAfterPurge, count: await tenant.saltCount() };
    };
    const unset = await run(false), set = await run(true);
    expect(unset.count, 'with the setting unset, learn 25 reads back 24 revisions to revision 1: the brand fallback then spring-26 (W21 E1.03; kit 02 :527-529)')
      .toEqual({ annotation: { salt: 'spring-26', version: 2 }, outcome: 2 });
    expect(set.catalogAfterPurge, 'fixture: with the setting set, the day-100 publication purges catalog 1 and 2').toEqual([3, 4]);
    expect(set.count, 'W38.B4.x edge — with the setting set, learn 25 on a pre-W21 history whose current revision was 24 carries the exact count it carries unset (spring-26, 2), never null')
      .toEqual(unset.count);
  }, 60_000);

  /**
   * The former boundary (P95, E20; amended by name, R-P511): past the 24
   * revisions the old walk read back, the pre-W21 history is counted over the
   * whole stored history, so learn 27 counts exactly with the setting unset;
   * and with it set, the purge keeps every learn revision while the current one
   * carries no exact count (src/config/publication.ts saltCountCarried), so the
   * count is the same — a purge never turns an exact count into an unknown, and
   * never manufactures a smaller one.
   *
   *   day 0      initialized: learn 1 = DEFAULT_LEARN (brand `coach`)
   *   day 1-25   learn 2 … 26 on `spring-26`; catalog 2 (day 1), 3 (day 2) — stored by the pre-W21 writer
   *   day 100    catalog 4: with the setting set, the purge runs (catalog 1 and 2 go) and keeps every learn revision
   *   day 101    learn 27 on `spring-26`  → count 2
   */
  it('B4.x: boundary — past the former 24-revision horizon a pre-W21 history counts exactly with the setting set as unset: the purge keeps every learn revision while the current one carries no exact count (P95, E20)', async () => {
    const run = async (configuration: boolean) => {
      const tenant = await preW21Tenant(configuration, Array.from({ length: 25 }, () => 'spring-26'));
      await tenant.publish(100, 'catalog', CONTENT_KIND as DocumentKind<unknown>, catalogOf(4));
      const catalogAfterPurge = tenant.storage.revisions('content'), learnAfterPurge = tenant.storage.revisions('learn');
      await tenant.publish(101, 'learn', LEARN_KIND as DocumentKind<unknown>, learnOf('spring-26', 27));
      return { catalogAfterPurge, learnAfterPurge, count: await tenant.saltCount() };
    };
    const unset = await run(false), set = await run(true);
    expect(unset.count, 'P95 (E20) — with the setting unset, learn 27 counts over the whole stored pre-W21 history: the brand fallback then spring-26 (W21 E1.03), salt spring-26, version 2')
      .toEqual({ annotation: { salt: 'spring-26', version: 2 }, outcome: 2 });
    expect(set.catalogAfterPurge, 'fixture: with the setting set, the day-100 publication purges catalog 1 and 2').toEqual([3, 4]);
    expect(set.learnAfterPurge, 'W38.B4 with P95 — with the setting set, the day-100 publication keeps every learn revision of this pre-W21 history, whose current revision 26 carries no exact count: the next learn publication counts over all of them')
      .toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    expect(set.count, 'W38.B4.x boundary — with the setting set, learn 27 carries the exact count it carries unset (spring-26, 2): a purge never turns an exact count into an unknown').toEqual(unset.count);
  }, 60_000);
});
