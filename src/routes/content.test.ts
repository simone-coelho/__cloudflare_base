// src/routes/content.test.ts
// Administrative documents on working synthetic KV: reads and writes require
// authentication, every write is validated and versioned, rollback rolls forward, the
// import adapter takes JSON, CSV and a pulled URL.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as jose from 'jose';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { invalidateCache, patch, readVersion, LEGACY_DOCUMENT_MAX_BYTES } from '@/config/versionedStore';
import { initializePublication, initializePublicationSet, publish, readPublication } from '@/config/publication';
import { CONTENT_KIND, EMPTY_CATALOG, LEARN_KIND, DEFAULT_LEARN, SLOTS_KIND, DEFAULT_SLOTS } from '@/content/kinds';
import { contentRoutes } from './content';
import { configRoutes } from './config';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { memoryStore } from '@/auth/store';
import { memoryAuthority } from '@/auth/authority';
import { decisionRoutes } from './decisions';
import { LearnStats } from '@/durable-objects/LearnStats';
import { DEFAULT_STATS, emptyStats, recordExposure } from '@/learn/stats';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ENRICHMENT_MAX_BYTES, type EnrichmentProposal, type EnrichmentReview } from '@/content/enrichment';
import { decideContent, type DecideInput } from '@/content/decide';
import type { ContentCatalog, SlotCatalog } from '@/content/types';
import { INPUT_MAX_BYTES, INPUT_MAX_RECORDS } from '@/config/input';
import { PRIORS_KIND, EMPTY_PRIORS } from '@/learn/priors';
import { PROPOSALS_KIND, EMPTY_PROPOSALS } from '@/learn/cycle';
import type { DocumentKind } from '@/config/versionedStore';
import { replayDecision } from '@/learn/replay';
import { captureRetention } from '@/retention';
import { recoveryDigest } from '@/ledger/recovery';
import type { CatalogDiagnostics } from '@/content/catalogDiagnostics';
import type { SlotDiagnostics } from '@/content/slotDiagnostics';

class FakeKV {
  store = new Map<string, string>();
  calls: string[] = [];
  async get(key: string, type?: string): Promise<unknown> { this.calls.push(`get:${key}`); const raw = this.store.get(key); return raw === undefined ? null : type === 'stream' ? new Response(raw).body : JSON.parse(raw); }
  async put(key: string, value: string): Promise<void> { this.calls.push(`put:${key}`); this.store.set(key, value); }
}
class CatalogR2 {
  objects = new Map<string, string>(); etags = new Map<string, string>(); calls: string[] = [];
  puts = 0; failPut = 0; afterWrite = false;
  async get(key: string) {
    this.calls.push(`get:${key}`); const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: this.etags.get(key), size: new TextEncoder().encode(raw).length, body: new Response(raw).body };
  }
  async put(key: string, raw: string, options: R2PutOptions) {
    this.calls.push(`put:${key}`); const attempt = ++this.puts;
    if (attempt === this.failPut && !this.afterWrite) throw new Error('Synthetic publication outage');
    const condition = options.onlyIf;
    if (condition instanceof Headers ? this.objects.has(key) : condition?.etagMatches !== this.etags.get(key)) return null;
    this.objects.set(key, raw); this.etags.set(key, `catalog-${attempt}`);
    if (attempt === this.failPut) throw new Error('Synthetic lost publication acknowledgement');
    return { key, etag: this.etags.get(key), size: new TextEncoder().encode(raw).length };
  }
}
const mkEnv = (): Env => ({ CACHE: new FakeKV(), STORAGE: new CatalogR2(), JWT_SECRET: 'w0202-synthetic-route-signing-material', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
  TENANTS: JSON.stringify({ provisioned: ['coach'], operatorGrants: { ops: ['coach'] } }) } as unknown as Env);
const token = (payload: jose.JWTPayload = { sub: 'ops' }) => new jose.SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode('w0202-synthetic-route-signing-material'));
const H = 'http://w';
const piece = (id: string) => ({ id, customerContentId: `CMP-${id}`, type: 'editorial', title: id, tags: { line: ['Drover'] }, slotTypes: ['story'] });
const fixtureKinds: DocumentKind<unknown>[] = [CONTENT_KIND, SLOTS_KIND, LEARN_KIND, REFLEX_KIND, PRIORS_KIND, PROPOSALS_KIND];
const fixtureStorage = new WeakMap<Env, CatalogR2>();
const publicationHeaders = (env: Env, auth: Record<string, string>, revision = 1, id = `${revision}:${crypto.randomUUID()}`, _name = 'content'): Record<string, string> => {
  void _name;
  const scope = auth['X-Tenant'] || 'coach', storage = fixtureStorage.get(env) ?? env.STORAGE as unknown as CatalogR2;
  const raw = storage.objects.get('config-publication/v2/' + scope + '/head.json');
  const parsed = raw ? JSON.parse(raw) : null;
  const head = parsed?.committed ? parsed : { committed: { revision: 1, digest: 'a'.repeat(64) } };
  return { ...auth, 'If-Match': '"' + revision + '/' + head.committed.revision + '/' + head.committed.digest + '"', 'Idempotency-Key': id };
};
const authoredHeaders = (env: Env, auth: Record<string, string>, name: string, scope = auth['X-Tenant'] || 'coach') => {
  const storage = env.STORAGE as unknown as CatalogR2, head = JSON.parse(storage.objects.get('config-publication/v2/' + scope + '/head.json')!);
  const set = JSON.parse(storage.objects.get('config-publication/v2/' + scope + '/set/' + head.committed.revision + '.json')!);
  const n = set.refs[name + ':' + (name === 'reflex' ? reflexScopeForTenant(scope) : scope)].revision;
  return publicationHeaders(env, { ...auth, 'X-Tenant': scope }, n, n + ':' + crypto.randomUUID(), name);
};
const initializeCatalog = async (env: Env, scope = 'coach', catalog: ContentCatalog = EMPTY_CATALOG) => {
  fixtureStorage.set(env, env.STORAGE as unknown as CatalogR2);
  const values = [catalog, DEFAULT_SLOTS, DEFAULT_LEARN, DEFAULT_REFLEX_CONFIG, EMPTY_PRIORS, EMPTY_PROPOSALS];
  return initializePublicationSet(env, fixtureKinds.map((kind, i) => ({ kind, scope: kind.name === 'reflex' ? reflexScopeForTenant(scope) : scope,
    revision: { revision: 1, value: values[i], actor: 'synthetic-cutover', note: '', at: 1 } })), '0:' + crypto.randomUUID());
};
const canonical = (value: unknown): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}' : JSON.stringify(value);
const sealFixture = <T extends object>(value: T) => { const { digest: _d, ...raw } = value as T & { digest?: string }; void _d;
  return { ...raw, digest: createHash('sha256').update(canonical(raw)).digest('hex') }; };
/** Explicit retained/corrupt authority setup, not a production write or KV fallback. */
function seedLegacy(env: Env, key: string, text: string) {
  const kv = env.CACHE as unknown as FakeKV; kv.store.set(key, text);
  const match = /^(content|slots|learn|reflex|prior|proposals):config:(.+):(current|rev:[0-9]+)$/.exec(key); if (!match) return;
  const [,name,scope,part] = match, kind = fixtureKinds.find(k => k.name === name)!, owner = scope.replace(/^tenant:/, '') === 'brighthour' && scope === 'brighthour' && name === 'reflex' ? 'coach' : scope.replace(/^tenant:/, '');
  const storage = env.STORAGE as unknown as CatalogR2, hk = 'config-publication/v2/' + owner + '/head.json';
  const head = JSON.parse(storage.objects.get(hk)!); const sk = 'config-publication/v2/' + owner + '/set/' + head.committed.revision + '.json';
  const set = JSON.parse(storage.objects.get(sk)!); let raw: { revision: number; value: unknown; actor?: string; note?: string; at?: number; operation?: object };
  try { raw = JSON.parse(text); } catch { storage.objects.set('config-publication/v1/' + scope + '/' + name + '/rev/' + set.refs[name + ':' + scope].revision + '.json', text); invalidateCache(); return; }
  if (!raw || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || !Object.hasOwn(raw,'value')) {
    storage.objects.set('config-publication/v1/' + scope + '/' + name + '/rev/' + set.refs[name + ':' + scope].revision + '.json', text); invalidateCache(); return;
  }
  let document = sealFixture({ schema: 'catalog-revision/v1', kind: name, scope, revision: raw.revision, value: raw.value, actor: raw.actor ?? 'retained', note: raw.note ?? '', at: raw.at ?? 1,
    operation: raw.operation ?? { operationId: raw.revision - 1 + ':' + crypto.randomUUID(), expectedRevision: raw.revision - 1, initialize: true, requestDigest: 'a'.repeat(64) } });
  const bodyKey = 'config-publication/v1/' + scope + '/' + name + '/rev/' + raw.revision + '.json';
  const existing = storage.objects.get(bodyKey);
  if (part !== 'current' && existing) {
    const retained = JSON.parse(existing);
    if (canonical(retained.value) === canonical(raw.value) && retained.revision === raw.revision
      && retained.actor === document.actor && retained.note === document.note && retained.at === document.at) document = retained;
  }
  storage.objects.set(bodyKey, canonical(document)); storage.etags.set(bodyKey, 'fixture-seed-' + (++storage.puts));
  if (part === 'current') {
    set.refs[name + ':' + scope] = { kind: name, scope, revision: raw.revision, digest: document.digest, minRevision: raw.revision,
      index: [{ revision: raw.revision, version: kind.versionOf?.(raw.value) ?? String(raw.revision), actor: document.actor, note: document.note, at: document.at }] };
    if (set.operation.kind === name && set.operation.scope === scope) {
      set.operation.expectedRevision = raw.revision - 1; set.operation.operationId = raw.revision - 1 + ':' + set.operation.operationId.split(':')[1];
    }
    const fixed = sealFixture(set); storage.objects.set(sk, canonical(fixed)); head.committed.digest = fixed.digest; storage.objects.set(hk, canonical(sealFixture(head)));
  }
  invalidateCache();
}


it('W10.03 exact human-audited recovery refuses wrong scope, service, revoked authority and audit failure before repair', async () => {
  const env = mkEnv(), accounts = memoryStore(), authority = memoryAuthority(accounts);
  env.ACCOUNTS = accounts; env.AUTHORITY = authority; env.AUTH_MODE = 'enforced'; env.DEPLOYMENT_PROFILE = 'customer';
  env.IDENTITY_SALT = 'synthetic-w1003-audit-salt-not-customer';
  await accounts.put({ id: 'ops', email: 'ops@example.invalid', name: 'Synthetic', roles: ['admin'], permissions: ['*'], updatedAt: 1 });
  await accounts.putSession({ jti: 'session', accountId: 'ops', tokenHash: 'synthetic', createdAt: Date.now(), expiresAt: Date.now() + 300000 });
  const membership = { tenant: 'coach', accountId: 'ops', role: 'admin' as const, revision: 'r1', updatedAt: 1, disabled: false, removed: false };
  authority.memberships.set(JSON.stringify(['ops', 'coach']), membership);
  const human = await token({ sub: 'ops', type: 'access', sid: 'session' }), service = await token({ sub: 'ops', type: 'service' });
  class Storage {
    map = new Map<string, unknown>(); alarm: number | null = null;
    async get(k: string) { return structuredClone(this.map.get(k)); } async put(k: string, v: unknown) { this.map.set(k, structuredClone(v)); }
    async getAlarm() { return this.alarm; } async setAlarm(at: number) { this.alarm = at; }
    async transaction<T>(fn: (storage: Storage) => Promise<T>) { return fn(this); }
  }
  const storage = new Storage(), stats = emptyStats();
  for (let i = 0; i < 300; i++) recordExposure(stats, 'i' + i, { channel: 'direct', visit_bucket: '1', region: null, affinity: null }, Date.now(), DEFAULT_STATS);
  storage.map.set('learn', { tenant: 'coach', brand: 'coach', slot: 'hero', config: { reward: 'click', stats: DEFAULT_STATS }, stats });
  const object = new LearnStats({ storage } as unknown as DurableObjectState, env), calls: string[] = [];
  env.LEARN_STATS = { idFromName: (n: string) => n, get: (n: string) => ({ fetch: (url: string, init?: RequestInit) => {
    calls.push(n + new URL(url).pathname); return object.fetch(new Request(url, init));
  } }) } as unknown as DurableObjectNamespace;
  const app = new Hono(); app.use('*', tenantMiddleware()); app.route('/v1', decisionRoutes);
  const call = (body: unknown, bearer = human, query = '') => app.request('http://w/v1/coach/learn/recovery' + query, {
    method: 'POST', headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json', 'X-Tenant': 'coach' }, body: JSON.stringify(body),
  }, env);
  const status = { operation: 'status', kind: 'stats', brand: 'coach', slot: 'hero' };
  for (const body of [{ ...status, tenant: 'other' }, { ...status, visitorId: 'v1' }]) expect((await call(body)).status).toBe(400);
  expect((await call(status, human, '?tenant=other')).status).toBe(400);
  expect((await call(status, service)).ok).toBe(false); expect(calls).toEqual([]);
  const response = await call(status); expect(response.status).toBe(200);
  const basis = await response.json() as { digest: string; generation: number };
  const repair = { ...status, operation: 'repair', intent: 'coarsen', digest: basis.digest, generation: basis.generation, operationId: 'f'.repeat(32) };
  const before = structuredClone(storage.map), count = calls.length;
  vi.spyOn(accounts, 'audit').mockRejectedValueOnce(new Error('Synthetic admitted audit unavailable'));
  expect((await call(repair)).status).toBe(503); expect(calls).toHaveLength(count); expect(storage.map).toEqual(before);
  expect((await call(repair)).status).toBe(200);
  expect(accounts.log.filter(row => row.action === 'learning_recovery')).toHaveLength(4);
  expect(JSON.stringify(accounts.log)).not.toContain('coach:coach:hero');
  authority.memberships.set(JSON.stringify(['ops', 'coach']), { ...membership, disabled: true });
  expect((await call(status)).ok).toBe(false);
});

describe('/content routes', () => {
  let env: Env; let auth: Record<string, string>;
  const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>(); app.use('*', tenantMiddleware()); app.route('/', contentRoutes);
  beforeEach(async () => { invalidateCache(); env = mkEnv(); await initializeCatalog(env); auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${await token({ sub: 'ops', type: 'service' })}` }; });

  it('W20.05 validates prefix format history and position-specific publication feedback', async () => {
    const slot = { slot: 'story', take: 3, weights: {}, pinnedPieceIds: [' a ', 'b'] };
    const request = (suffix = '', method = 'GET', document?: unknown) => app.request(`${H}/slots${suffix}?scope=coach`,
      { method, headers: authoredHeaders(env, auth, 'slots'), ...(document === undefined ? {} : { body: JSON.stringify({ document }) }) }, env);
    for (const governanceVersion of [undefined, 1, 2, 3]) {
      const input = { ...(governanceVersion === undefined ? {} : { governanceVersion }), pages: { home: [slot] } };
      expect(SLOTS_KIND.validate(input)).toMatchObject({ ok: true, value: { governanceVersion: 3, pages: input.pages } });
    }
    for (const version of [undefined, 1, 2]) {
      const retained = { ...(version === undefined ? {} : { governanceVersion: version }), pages: { home: [{ slot: 'story', take: 3, weights: {}, pinnedPieceIds: { malformed: true } }] } };
      const read = SLOTS_KIND.validateStored!(retained); expect(read.ok).toBe(true);
      if (read.ok) expect(read.value.pages.home![0]).not.toHaveProperty('pinnedPieceIds');
      expect(SLOTS_KIND.validate(retained).ok).toBe(false);
    }
    for (const pins of [null, {}, '', [null], [1], [''], ['a', 'a'], Array(1), Array.from({ length: 51 }, (_, i) => String(i))]) {
      const candidate = { governanceVersion: 3, pages: { home: [{ ...slot, pinnedPieceIds: pins }] } };
      expect(SLOTS_KIND.validateStored!(candidate).ok).toBe(false);
      expect(SLOTS_KIND.validate(candidate).ok).toBe(false);
    }
    for (const candidate of [
      { pages: { home: [{ ...slot, take: 1 }] } }, { pages: { home: [{ ...slot, pinnedPieceId: 'x' }] } },
      { pages: { home: [{ ...slot, pinnedPieceIds: [], pinnedPieceId: 'x' }] } },
      { pages: { home: [{ ...slot, excludedPieceIds: ['b'] }] } },
      { pages: { home: [slot, { slot: 'other', take: 1, weights: {}, pinnedPieceId: 'b' }] } },
    ]) for (const [suffix, method] of [['/validate', 'POST'], ['', 'PUT']] as const) expect((await request(suffix, method, candidate)).status).toBe(422);
    expect(SLOTS_KIND.validate({ pages: { home: [{ ...slot, take: 1, offLimits: true, excludedPieceIds: ['b'] }, { slot: 'other', take: 1, weights: {}, pinnedPieceId: 'b' }] } }).ok).toBe(true);
    expect(SLOTS_KIND.validate({ pages: { home: [{ ...slot, take: 50, pinnedPieceIds: [' '.repeat(2000), ...Array.from({ length: 49 }, (_, i) => String(i))] }] } }).ok).toBe(true);
    const document = { pages: { home: [slot] } };
    expect((await app.request(`${H}/catalog?scope=coach`, { method: 'PUT', headers: publicationHeaders(env, auth), body: JSON.stringify({ document: { pieces: [{ ...piece(' a '), lifecycle: { status: 'live' } }] } }) }, env)).status).toBe(200);
    const preview = await (await request('/validate', 'POST', document)).json() as { pinDiagnostics: SlotDiagnostics };
    expect(preview.pinDiagnostics).toMatchObject({ status: 'available', warningCount: 1, warnings: [{ pageIndex: 0, slotIndex: 0, pinIndex: 1, reason: 'missing_piece' }] });
    const saved = await (await request('', 'PUT', document)).json() as { revision: number; document: SlotCatalog };
    expect(saved.document).toMatchObject({ governanceVersion: 3, pages: document.pages });
    const kv = env.CACHE as unknown as FakeKV, retained = kv.store.get(`slots:config:coach:rev:${saved.revision}`);
    expect((await request('', 'PUT', { pages: { home: [{ ...slot, pinnedPieceIds: [] }] } })).status).toBe(200);
    expect((await request(`/rollback/${saved.revision}`, 'POST', {})).status).toBe(200);
    expect(await (await request()).json()).toMatchObject({ document: { governanceVersion: 3, pages: document.pages }, pinDiagnostics: { warnings: preview.pinDiagnostics.warnings } });
    expect(kv.store.get(`slots:config:coach:rev:${saved.revision}`)).toBe(retained);
  });

  it('W20.04 validates exact constraints through pin feedback and revision rollback', async () => {
    const kv = env.CACHE as unknown as FakeKV;
    const baseSlot = { slot: 'story', take: 1, weights: {} };
    const request = (suffix = '', method = 'GET', body?: unknown) => app.request(`${H}/slots${suffix}?scope=coach`,
      { method, headers: authoredHeaders(env, auth, 'slots'), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const legacy = { pages: { home: [{ ...baseSlot, offLimits: 'old', excludedPieceIds: null, excludedTags: null, allowedTypes: [] }] } };
    expect(SLOTS_KIND.validateStored!(legacy)).toMatchObject({ ok: true, value: { pages: { home: [baseSlot] } } });
    const v1 = { governanceVersion: 1, pages: { home: [{ ...baseSlot, excludedPieceIds: [], excludedTags: { old: true }, allowedTypes: null }] } };
    const raw = JSON.stringify({ revision: 3, value: v1, at: 1, actor: 'old', note: 'retained v1' });
    seedLegacy(env, 'slots:config:coach:current', raw); seedLegacy(env, 'slots:config:coach:rev:3', raw);
    expect(await (await request()).json()).toMatchObject({ revision: 3, document: { governanceVersion: 1, pages: { home: [{ ...baseSlot, excludedPieceIds: [] }] } } });
    expect(SLOTS_KIND.validate(v1).ok).toBe(false);
    const pairs = [{ dimension: 'a:b', value: 'c' }, { dimension: 'a', value: 'b:c' }, { dimension: '__proto__', value: ' x\ny ' }, { dimension: 'x'.repeat(1024), value: 'v'.repeat(1024) }];
    const slot = { ...baseSlot, excludedTags: pairs, allowedTypes: [' film ', 'film', '__proto__'] };
    for (const governanceVersion of [undefined, 1, 2, 3]) {
      const candidate = { ...(governanceVersion === undefined ? {} : { governanceVersion }), pages: { home: [slot] } };
      expect(SLOTS_KIND.validate(candidate)).toMatchObject({ ok: true, value: { governanceVersion: 3, pages: candidate.pages } });
    }
    const invalid = [
      ...[null, {}, [null], [{}], [{ dimension: 'x', value: 'y', extra: 1 }], [{ dimension: '', value: 'y' }], [{ dimension: 'x', value: '' }],
        [{ dimension: 'x'.repeat(1025), value: 'y' }], [{ dimension: 'x', value: 'y'.repeat(1025) }], [pairs[0], pairs[0]],
        Array.from({ length: 1001 }, (_, i) => ({ dimension: 'd', value: String(i) }))].map(excludedTags => ({ ...baseSlot, excludedTags })),
      ...[null, [], [null], [''], ['a', 'a'], ['x'.repeat(1025)], Array.from({ length: 1001 }, (_, i) => String(i))].map(allowedTypes => ({ ...baseSlot, allowedTypes })),
    ];
    const before = [...kv.store]; kv.calls.length = 0;
    for (const bad of invalid) {
      expect(SLOTS_KIND.validateStored!({ governanceVersion: 2, pages: { home: [bad] } }).ok).toBe(false);
      for (const [suffix, method] of [['/validate', 'POST'], ['', 'PUT']] as const) expect((await request(suffix, method, { document: { pages: { home: [bad] } } })).status).toBe(422);
    }
    for (const bad of [{ ...slot, excludedTags: Array(1) }, { ...slot, allowedTypes: Array(1) },
      { ...slot, excludedTags: [{ dimension: 'x', value: 'y', [Symbol('extra')]: 1 }] },
      { ...slot, excludedTags: [Object.create({ dimension: 'x', value: 'y' })] }]) expect(SLOTS_KIND.validate({ pages: { home: [bad] } }).ok).toBe(false);
    expect([...kv.store]).toEqual(before); expect(kv.calls.some(call => call.startsWith('put:'))).toBe(false);
    expect(SLOTS_KIND.validate({ pages: { home: [{ ...baseSlot, excludedTags: Array.from({ length: 1000 }, (_, i) => ({ dimension: 'd', value: String(i) })), allowedTypes: Array.from({ length: 1000 }, (_, i) => String(i)) }] } }).ok).toBe(true);
    const catalog = { pieces: [{ ...piece('tagged'), type: 'film', tags: { contentType: ['video'] }, slotTypes: ['story', 'typepin'] }] };
    expect((await app.request(`${H}/catalog?scope=coach`, { method: 'PUT', headers: publicationHeaders(env, auth), body: JSON.stringify({ document: catalog }) }, env)).status).toBe(200);
    const document: SlotCatalog = { pages: { home: [{ ...slot, pinnedPieceId: 'tagged', excludedTags: [{ dimension: 'contentType', value: 'video' }] },
      { slot: 'typepin', take: 1, weights: {}, pinnedPieceId: 'other', allowedTypes: ['video'] }] } };
    // Distinct pins remain document-valid; catalog-dependent conflicts are advisory.
    const second = { ...catalog.pieces[0]!, id: 'other' };
    expect((await app.request(`${H}/catalog?scope=coach`, { method: 'PUT', headers: publicationHeaders(env, auth, 2), body: JSON.stringify({ document: { pieces: [...catalog.pieces, second] } }) }, env)).status).toBe(200);
    const preview = await (await request('/validate', 'POST', { document })).json() as { pinDiagnostics: SlotDiagnostics };
    expect(preview).toMatchObject({ valid: true, pinDiagnostics: { status: 'available', catalog: { revision: 3 }, warnings: [
      { pageIndex: 0, slotIndex: 0, reason: 'excluded_tag' }, { pageIndex: 0, slotIndex: 1, reason: 'type_not_allowed' },
    ] } });
    expect(await (await request('', 'PUT', { document })).json()).toMatchObject({ revision: 4, document: { governanceVersion: 3, pages: document.pages }, pinDiagnostics: { slotsRevision: 4, warnings: preview.pinDiagnostics.warnings } });
    expect(await (await request('/revisions/4')).json()).toMatchObject({ value: { governanceVersion: 3, pages: document.pages } });
    expect(await (await request('', 'PUT', { document: { pages: { home: [baseSlot] } } })).json()).toMatchObject({ revision: 5 });
    expect(await (await request('/rollback/4', 'POST', {})).json()).toMatchObject({ revision: 6, pinDiagnostics: { warnings: preview.pinDiagnostics.warnings } });
    expect(await (await request()).json()).toMatchObject({ revision: 6, document: { governanceVersion: 3, pages: document.pages } });
    expect(await (await request('/rollback/3', 'POST', {})).json()).toMatchObject({ revision: 7 });
    expect(await (await request()).json()).toMatchObject({ revision: 7, document: { governanceVersion: 3, pages: { home: [{ ...baseSlot, excludedPieceIds: [] }] } } });
    expect(kv.store.get('slots:config:coach:rev:3')).toBe(raw);
  });

  it('W20.03 validates versioned hard controls through publication history rollback and bounded pin feedback', async () => {
    const kv = env.CACHE as unknown as FakeKV;
    const baseSlot = { slot: 'hero', take: 1, weights: { topic: 0.4 } };
    const legacy = { version: 'legacy', pages: { home: [{ ...baseSlot, offLimits: 'formerly unknown', excludedPieceIds: { ignored: true } }] } };
    const raw = JSON.stringify({ revision: 3, value: legacy, actor: 'old', note: 'retained', at: 1 });
    seedLegacy(env, 'slots:config:coach:current', raw); seedLegacy(env, 'slots:config:coach:rev:3', raw);
    const request = (suffix = '', method = 'GET', body?: unknown) => app.request(`${H}/slots${suffix}?scope=coach`,
      { method, headers: authoredHeaders(env, auth, 'slots'), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    expect(await (await request()).json()).toMatchObject({ revision: 3, document: { version: 'legacy', pages: { home: [baseSlot] } } });
    expect(SLOTS_KIND.validate(legacy).ok).toBe(false);
    const ids = [' a ', 'a,b', 'a\nb', '"[]"', '__proto__', 'x'.repeat(1024)];
    const document: SlotCatalog = { pages: { home: [
      { ...baseSlot, excludedPieceIds: ids, offLimits: false },
      { slot: 'pin', take: 2, weights: { topic: 1 }, pinnedPieceId: 'p', offLimits: true, excludedPieceIds: ['p'] },
      { slot: 'active', take: 1, weights: {}, pinnedPieceId: 'p' },
    ] } };
    expect(SLOTS_KIND.validate(document)).toMatchObject({ ok: true, value: { governanceVersion: 3, pages: document.pages } });
    const invalid = [
      ...[null, false, 0, 4, '1'].map(governanceVersion => ({ ...document, governanceVersion })),
      ...[null, 0, 'true', []].map(offLimits => ({ pages: { home: [{ ...baseSlot, offLimits }] } })),
      ...[null, {}, '', [null], [1], [''], ['x'.repeat(1025)], ['a', 'a'], Array.from({ length: 1001 }, (_, i) => String(i))]
        .map(excludedPieceIds => ({ pages: { home: [{ ...baseSlot, excludedPieceIds }] } })),
      { pages: { home: [{ ...baseSlot, pinnedPieceId: 'p', excludedPieceIds: ['p'] }] } },
      { ...document, pages: { home: document.pages.home!.map(slot => ({ ...slot, offLimits: false })) } },
    ];
    const before = [...kv.store]; kv.calls.length = 0;
    for (const candidate of invalid) for (const [suffix, method] of [['/validate', 'POST'], ['', 'PUT']] as const) {
      expect((await request(suffix, method, { document: candidate })).status).toBe(422);
    }
    for (const candidate of [{ pages: { home: [{ ...baseSlot, excludedPieceIds: Array(1) }] } },
      { ...document, governanceVersion: undefined }, { pages: { home: [{ ...baseSlot, offLimits: undefined }] } }]) expect(SLOTS_KIND.validate(candidate).ok).toBe(false);
    expect([...kv.store]).toEqual(before); expect(kv.calls.some(call => call.startsWith('put:'))).toBe(false);
    expect(SLOTS_KIND.validate({ pages: { home: [{ ...baseSlot, excludedPieceIds: Array.from({ length: 1000 }, (_, i) => String(i)) }] } }).ok).toBe(true);
    for (const controls of [{ offLimits: null }, { excludedPieceIds: [null] }]) {
      expect(SLOTS_KIND.validateStored!({ governanceVersion: 1, pages: { home: [{ ...baseSlot, ...controls }] } }).ok).toBe(false);
      expect(SLOTS_KIND.validateStored!({ pages: { home: [{ ...baseSlot, ...controls }] } })).toMatchObject({ ok: true, value: { pages: { home: [baseSlot] } } });
    }
    expect(SLOTS_KIND.validateStored!({ ...document, governanceVersion: 4 }).ok).toBe(false);
    const preview = await (await request('/validate', 'POST', { document })).json() as { pinDiagnostics: SlotDiagnostics };
    expect(preview).toMatchObject({ valid: true, pinDiagnostics: { status: 'available', warnings: [
      { pageIndex: 0, slotIndex: 1, reason: 'off_limits' }, { pageIndex: 0, slotIndex: 2, reason: 'missing_piece' },
    ] } });
    expect(await (await request('', 'PUT', { document, note: 'hard controls' })).json()).toMatchObject({ ok: true, revision: 4 });
    const current = await (await request()).json() as { document: SlotCatalog };
    expect(current.document).toMatchObject({ governanceVersion: 3, pages: document.pages });
    expect(current.document.pages.home![0]!.excludedPieceIds).toEqual(ids);
    expect(await (await request('/revisions/4')).json()).toMatchObject({ value: { governanceVersion: 3, pages: document.pages } });
    const neutral = { pages: { home: [{ ...baseSlot, offLimits: false, excludedPieceIds: [] }] } };
    expect(await (await request('', 'PUT', { document: neutral })).json()).toMatchObject({ revision: 5 });
    expect(await (await request('/rollback/4', 'POST', {})).json()).toMatchObject({ ok: true, revision: 6, pinDiagnostics: { slotsRevision: 6, warnings: preview.pinDiagnostics.warnings } });
    expect(await (await request()).json()).toMatchObject({ revision: 6, document: { governanceVersion: 3, pages: document.pages } });
    expect(kv.store.get('slots:config:coach:rev:3')).toBe(raw);
    // Defensive feedback for an inherited contradictory versioned snapshot, without activating it.
    seedLegacy(env, 'slots:config:coach:current', JSON.stringify({ revision: 7, at: 1, actor: 'fixture', note: '', value: {
      governanceVersion: 1, pages: { home: [{ ...baseSlot, pinnedPieceId: 'p', excludedPieceIds: ['p'] }] },
    } })); invalidateCache();
    expect(await (await request()).json()).toMatchObject({ pinDiagnostics: { warnings: [{ pageIndex: 0, slotIndex: 0, reason: 'excluded' }] } });
  });

  it('W20.02 reports bounded current pin diagnostics on slot reads and validation without crossing authority', async () => {
    const kv = env.CACHE as unknown as FakeKV, storage = env.STORAGE as unknown as CatalogR2;
    const ids = ['valid', 'missing', 'wrong', 'draft', 'future', 'expired', 'stock'];
    const catalog: ContentCatalog = { pieces: ids.filter(id => id !== 'missing').map(id => ({ ...piece(id),
      slotTypes: [id === 'wrong' ? 'other' : id], lifecycle: { status: id === 'draft' ? 'draft' as const : 'live' as const },
      ...(id === 'future' ? { window: { from: '2099-01-01T00:00:00Z' } } : {}),
      ...(id === 'expired' ? { window: { to: '2020-01-01T00:00:00Z' } } : {}), ...(id === 'stock' ? { inStock: false } : {}),
    })) };
    expect((await publish(env, CONTENT_KIND, 'coach', catalog, { actor: 'ops', expectedRevision: 1, expectedPublication: (await readPublication(env, CONTENT_KIND, 'coach')).publication, operationId: `1:${crypto.randomUUID()}` }, () => catalog)).ok).toBe(true);
    const slots: SlotCatalog = { pages: { home: ids.map(id => ({ slot: id, take: 1, weights: {}, pinnedPieceId: id })) } };
    const raw = JSON.stringify({ revision: 3, value: slots, actor: 'old', note: 'retained', at: 1 });
    seedLegacy(env, 'slots:config:coach:current', raw); seedLegacy(env, 'slots:config:coach:rev:3', raw); invalidateCache();
    const call = (path: string, method = 'GET', body?: unknown, headers = auth) => app.request(H + path, { method, headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const current = await call('/slots?scope=coach'); expect(current.status).toBe(200); expect(current.headers.get('cache-control')).toBe('no-store');
    const body = await current.json() as { document: SlotCatalog; pinDiagnostics: SlotDiagnostics };
    expect(body.document).toEqual(slots);
    expect(body.pinDiagnostics).toMatchObject({ schema: 'slot-pin-diagnostics/v1', advisory: true, status: 'available', slotsRevision: 3,
      catalog: { source: 'stored', revision: 2 }, warningCount: 6, omittedWarningCount: 0, warnings: [
        { pageIndex: 0, slotIndex: 1, reason: 'missing_piece' }, { pageIndex: 0, slotIndex: 2, reason: 'slot_type' },
        ...[3, 4, 5, 6].map(slotIndex => ({ pageIndex: 0, slotIndex, reason: 'currently_ineligible' })),
      ] });
    expect(Number.isFinite(Date.parse(body.pinDiagnostics.checkedAt!))).toBe(true);
    expect(JSON.stringify(body.pinDiagnostics)).not.toMatch(/pinnedPieceId|"home"|"draft"/);
    const bounded: SlotCatalog = { pages: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`page${i}`, [{ slot: 'story', take: 1, weights: {}, pinnedPieceId: `private-${i}` }]])) };
    const preview = await (await call('/slots/validate?scope=coach', 'POST', bounded)).json() as { pinDiagnostics: SlotDiagnostics };
    expect(preview.pinDiagnostics).toMatchObject({ status: 'available', slotsRevision: null, warningCount: 60, omittedWarningCount: 10 });
    expect(preview.pinDiagnostics.warnings).toHaveLength(50);
    expect(preview.pinDiagnostics.warnings!.at(-1)).toEqual({ pageIndex: 49, slotIndex: 0, reason: 'missing_piece' });
    expect(JSON.stringify(preview.pinDiagnostics)).not.toContain('private-');
    let reads = storage.calls.length;
    expect(await (await call('/slots/validate?scope=coach', 'POST', { pages: {} })).json()).toMatchObject({ valid: true,
      pinDiagnostics: { status: 'not_required', catalog: { source: 'not_read', revision: null }, checkedAt: null, warningCount: 0 } });
    expect(storage.calls.length).toBe(reads);
    for (const mode of ['open', 'enforced'] as const) {
      env.AUTH_MODE = mode;
      const valid = await call('/slots/validate?scope=coach', 'POST', slots); expect(valid.status).toBe(200);
      expect(await valid.json()).toMatchObject({ pinDiagnostics: { status: 'available' } });
      reads = storage.calls.length;
      for (const suffix of ['?scope=other', '?scope=coach&scope=coach', '?scope=coach&tenant=other']) {
        const r = await call('/slots/validate' + suffix, 'POST', slots);
        expect(r.status).toBe(403);
        if (r.status === 200) expect(await r.json()).toMatchObject({ pinDiagnostics: { status: 'unavailable', warningCount: null, warnings: null } });
      }
      expect(storage.calls.length).toBe(reads);
    }
    env.AUTH_MODE = 'open';
    for (const headers of [{ ...auth, Authorization: `Bearer ${await token({ sub: 'ops' })}` },
      { ...auth, Authorization: `Bearer ${await token({ sub: 'ungranted', type: 'service' })}` }]) {
      const response = await call('/slots/validate?scope=coach', 'POST', slots, headers);
      expect([401, 403]).toContain(response.status);
    }
    expect(storage.calls.length).toBe(reads);
    expect(await (await call('/slots/validate', 'POST', slots)).json()).toMatchObject({ pinDiagnostics: { status: 'available' } });
    seedLegacy(env, 'slots:config:coach:current', '{'); invalidateCache();
    expect((await call('/slots?scope=coach')).status).toBe(503);
    expect(await (await call('/slots/revisions/3?scope=coach')).json()).not.toHaveProperty('pinDiagnostics');
    expect(kv.store.get('slots:config:coach:rev:3')).toBe(raw);
  });

  it('W20.02 preserves slot activation and rollback while diagnosing exact results and later runtime drift', async () => {
    const kv = env.CACHE as unknown as FakeKV, storage = env.STORAGE as unknown as CatalogR2;
    const catalog: ContentCatalog = { pieces: [{ ...piece('pin'), slotTypes: ['hero', 'story'], lifecycle: { status: 'live' } },
      { ...piece('next'), slotTypes: ['hero'], lifecycle: { status: 'live' } }] };
    const publishCatalog = async (candidate: ContentCatalog, expectedRevision: number) => publish(env, CONTENT_KIND, 'coach', candidate,
      { actor: 'ops', expectedRevision, expectedPublication: (await readPublication(env, CONTENT_KIND, 'coach')).publication, operationId: `${expectedRevision}:${crypto.randomUUID()}` }, () => candidate);
    expect((await publishCatalog(catalog, 1)).ok).toBe(true);
    const slots: SlotCatalog = { pages: { home: [{ slot: 'hero', take: 1, weights: {} }, { slot: 'story', take: 1, weights: {}, pinnedPieceId: 'pin' }] } };
    const call = (suffix: string, method: string, document?: unknown) => app.request(`${H}/slots${suffix}?scope=coach`, { method, headers: method === 'GET' || suffix === '/validate' ? auth : authoredHeaders(env, auth, 'slots'),
      ...(document === undefined ? {} : { body: JSON.stringify(document) }) }, env);
    const put = await call('', 'PUT', { document: slots, note: 'activate' }); expect(put.status).toBe(200);
    const activated = await put.json() as { document: SlotCatalog; pinDiagnostics: SlotDiagnostics };
    expect(activated.pinDiagnostics).toMatchObject({ status: 'available', slotsRevision: 2, catalog: { revision: 2 }, warningCount: 0 });
    const retained = storage.objects.get('config-publication/v1/coach/slots/rev/2.json');
    const decide = (pieces: ContentCatalog['pieces'], arm: DecideInput['arm']) => decideContent({ tenant: 'coach', brand: 'coach', page: 'home',
      visitorId: 'synthetic', sessionId: null, identityAnchor: 'visitor', nowMs: Date.now(), pieces, slots: slots.pages.home, arm, affinity: null,
      cell: { channel: 'direct', visit_bucket: '1', region: null, affinity: null }, versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'synthetic' });
    for (const arm of ['default', 'personalized'] as const) expect(decide(catalog.pieces, arm).decisions.map(d => [d.slot, d.contentId])).toEqual([['hero', 'next'], ['story', 'pin']]);
    const changed = structuredClone(catalog); changed.pieces[0]!.inStock = false;
    expect((await publishCatalog(changed, 2)).ok).toBe(true);
    expect(await (await call('', 'GET')).json()).toMatchObject({ pinDiagnostics: { catalog: { revision: 3 }, warnings: [{ pageIndex: 0, slotIndex: 1, reason: 'currently_ineligible' }] } });
    for (const arm of ['default', 'personalized'] as const) {
      const set = decide(changed.pieces, arm); expect(set.decisions.map(d => d.contentId)).toEqual(['next']);
      expect(set.pinDiagnostics).toEqual([{ slot: 'story', pinnedPieceId: 'pin', reason: 'missing_or_ineligible' }]);
    }
    expect(await (await call('', 'PUT', { pages: {} })).json()).toMatchObject({ revision: 3, pinDiagnostics: { status: 'not_required' } });
    const rollback = await call('/rollback/2', 'POST', {}); expect(rollback.status).toBe(200);
    expect(await rollback.json()).toMatchObject({ revision: 4, pinDiagnostics: { slotsRevision: 4, catalog: { revision: 3 }, warningCount: 1 } });
    expect(storage.objects.get('config-publication/v1/coach/slots/rev/2.json')).toBe(retained);
    const reads = storage.calls.length;
    expect((await call('', 'PUT', { pages: { home: [{ ...slots.pages.home[1]!, take: 2 }] } })).status).toBe(422);
    expect(storage.calls.length).toBe(reads);
    const get = storage.get.bind(storage);
    const outage = vi.spyOn(storage, 'get').mockImplementation(async key => { if (key.includes('/content/rev/')) throw new Error('private catalog outage'); return get(key); });
    try {
      const response = await call('', 'PUT', { document: slots }); expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ revision: 5, document: { pages: slots.pages }, pinDiagnostics: { status: 'unavailable', catalog: { revision: null }, warnings: null } });
    } finally { outage.mockRestore(); }
    const head = [...storage.objects.keys()].find(key => key.endsWith('/head.json'))!; expect(head).toBeTruthy();
    const original = storage.objects.get(head)!;
    for (const value of [null, '{']) {
      if (value === null) storage.objects.delete(head); else storage.objects.set(head, value);
      expect(await (await call('/validate', 'POST', slots)).json()).toMatchObject({ valid: true, pinDiagnostics: { status: 'unavailable', warningCount: null, omittedWarningCount: null, warnings: null } });
    }
    storage.objects.set(head, original);
    expect([...kv.store.values()].some(raw => raw.includes('slot-pin-diagnostics'))).toBe(false);
  });

  it('W19.03 reports bounded exact-registry diagnostics for catalog validation and current reads', async () => {
    const kv = env.CACHE as unknown as FakeKV, storage = env.STORAGE as unknown as CatalogR2;
    const key = 'reflex:config:coach:current';
    const config = { ...DEFAULT_REFLEX_CONFIG, version: 'diagnostic-registry', weights: {}, dimensions: [
      { key: 'occasion', source: 'wireOccasion', multi: false }, { key: 'contentType', source: 'wireFormat' },
      { key: 'priceBand', source: 'price', derive: 'band' as const, cuts: [10], labels: ['low', 'high'] },
    ] };
    const seed = (dimensions = config.dimensions) => seedLegacy(env, key, JSON.stringify({ revision: 7, value: { ...config, dimensions }, actor: 'registry-operator', at: 1 }));
    const validate = async (pieces: unknown[], headers = auth) => {
      const response = await app.request(`${H}/catalog/validate`, { method: 'POST', headers, body: JSON.stringify({ pieces }) }, env);
      expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
      return response.json() as Promise<{ valid: true; document: ContentCatalog; diagnostics: CatalogDiagnostics }>;
    };
    seed();
    const pieces = [
      { ...piece('private-id-0'), tags: { Occasion: ['private-value'], occasion: [' ', 'Arbitrary Case'] } },
      { ...piece('private-id-1'), type: 'film', tags: {} },
      { ...piece('private-id-2'), tags: { contentType: [] } },
      { ...piece('private-id-3'), tags: { contentType: [' '] } },
      { ...piece('private-id-4'), tags: { priceBand: ['not-a-band-label'] } },
      { ...piece('private-id-5'), tags: { contentType: ['<not-learning-safe>'] } },
    ];
    const result = await validate(pieces);
    expect(result.document.pieces.map(p => p.tags)).toEqual(pieces.map(p => p.tags));
    // W19-B3 (R10, R84(a)): the channel gains `counts`, the exact occurrence
    // count per code present, so the 50-warning sample can never hide a whole
    // class of defect (W19-B1 build review finding 1; unit W19.F3.02). Still one
    // whole-object equality; the value is this fixture's own three warnings
    // counted by code — one `unknown_dimension` and two
    // `no_nonempty_registered_tags` — and every other member, including
    // W19-B2's `slots` below, is unchanged by this correction.
    expect(result.diagnostics).toEqual({ schema: 'catalog-registry-diagnostics/v1', advisory: true, status: 'available', catalogRevision: null,
      registry: { scope: 'coach', source: 'stored', revision: 7, version: 'diagnostic-registry' },
      // W19-B2 (R82(a)): the channel also names the slots document it compared the
      // pieces' slot types against, as it already names the registry. This fixture's
      // publication set carries SLOTS_KIND at revision 1 with DEFAULT_SLOTS
      // (`initializeCatalog` above), and a baseline value is stored as validated and
      // never stamped (stamping belongs to the write path), so the version is
      // DEFAULT_SLOTS' own.
      slots: { source: 'stored', revision: 1, version: 'slots-default' },
      warningCount: 3, omittedWarningCount: 0,
      counts: { unknown_dimension: 1, no_nonempty_registered_tags: 2 }, warnings: [
        { code: 'unknown_dimension', pieceIndex: 0, dimensionIndex: 0, dimension: 'Occasion', dimensionTruncated: false },
        { code: 'no_nonempty_registered_tags', pieceIndex: 2 }, { code: 'no_nonempty_registered_tags', pieceIndex: 3 },
      ] });
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/private-id|private-value|Arbitrary Case|not-learning-safe/);
    seed([{ key: 'contentType', source: 'numeric', derive: 'band', cuts: [1], labels: ['a', 'b'] }]);
    expect((await validate([pieces[1]])).diagnostics.warningCount).toBe(1); // A derived key cannot supply an implicit render-type tag.
    seed([{ key: 'unrelated', source: 'wire' }]);
    const longDimension = 'x'.repeat(80);
    const bounded = await validate(Array.from({ length: 30 }, (_, i) => ({ ...piece(`private-${i}`), tags: { [longDimension]: ['secret'], unknown: ['secret'] } })));
    expect(bounded.diagnostics).toMatchObject({ warningCount: 90, omittedWarningCount: 40 });
    expect(bounded.diagnostics.warnings).toHaveLength(50);
    expect(bounded.diagnostics.warnings![0]).toEqual({ code: 'unknown_dimension', pieceIndex: 0, dimensionIndex: 0, dimension: 'x'.repeat(64), dimensionTruncated: true });
    expect(bounded.diagnostics.warnings![49]).toEqual({ code: 'unknown_dimension', pieceIndex: 16, dimensionIndex: 1, dimension: 'unknown', dimensionTruncated: false });
    const published = await app.request(`${H}/catalog`, { method: 'PUT', headers: publicationHeaders(env, auth), body: JSON.stringify({ pieces }) }, env);
    expect(published.status).toBe(200);
    const current = await (await app.request(`${H}/catalog`, { headers: auth }, env)).json() as { document: ContentCatalog; diagnostics: CatalogDiagnostics };
    expect(current.document.pieces.map(p => p.tags)).toEqual(pieces.map(p => p.tags)); expect(current.diagnostics.catalogRevision).toBe(2);
    for (const path of ['catalog/history', 'catalog/revisions/2', 'slots']) {
      expect(await (await app.request(`${H}/${path}`, { headers: auth }, env)).json()).not.toHaveProperty('diagnostics');
    }
    storage.objects.delete('config-publication/v1/coach/reflex/rev/7.json'); invalidateCache();
    const unavailable = { status: 'unavailable', registry: { source: 'unavailable', revision: null, version: null }, warningCount: null, omittedWarningCount: null, warnings: null };
    expect((await validate([pieces[1]])).diagnostics).toMatchObject(unavailable);
    for (const raw of ['{', JSON.stringify({ revision: 1, value: {} }), ' '.repeat(LEGACY_DOCUMENT_MAX_BYTES + 1)]) {
      seedLegacy(env, key, raw); expect((await validate([pieces[1]])).diagnostics).toMatchObject(unavailable);
    }
    const get = storage.get.bind(storage);
    const outage = vi.spyOn(storage, 'get').mockImplementation(async key => { if (key.includes('/reflex/rev/')) throw new Error('private registry outage'); return get(key); });
    try { expect((await validate([pieces[1]])).diagnostics).toMatchObject(unavailable); } finally { outage.mockRestore(); }
    env.TENANTS = JSON.stringify({ provisioned: ['coach', 'brighthour'], operatorGrants: { ops: ['coach', 'brighthour'] } });
    const other = { ...auth, 'X-Tenant': 'brighthour' }; seedLegacy(env, 'reflex:config:brighthour:current', JSON.stringify({ revision: 99, value: config }));
    expect((await validate([pieces[1]], other)).diagnostics).toMatchObject({ ...unavailable, registry: { ...unavailable.registry, scope: 'tenant:brighthour' } });
    expect(kv.calls).not.toContain('get:reflex:config:tenant:brighthour:current');
    expect(storage.calls).toContain('get:config-publication/v2/brighthour/head.json');
    const before = [kv.calls.length, storage.calls.length];
    expect((await app.request(`${H}/catalog/validate?scope=coach`, { method: 'POST', headers: other, body: '{' }, env)).status).toBe(403);
    expect((await app.request(`${H}/catalog/validate`, { method: 'POST', body: '{' }, env)).status).toBe(401);
    expect([kv.calls.length, storage.calls.length]).toEqual(before);
  });

  it('W19.03 preserves successful publication and retries while reporting current advisory registry diagnostics', async () => {
    const kv = env.CACHE as unknown as FakeKV, storage = env.STORAGE as unknown as CatalogR2;
    const key = 'reflex:config:coach:current';
    const registry = (revision: number, dimension: string) => seedLegacy(env, key, JSON.stringify({ revision,
      value: { ...DEFAULT_REFLEX_CONFIG, version: `registry-${revision}`, weights: {}, dimensions: [{ key: dimension, source: 'wire' }] } }));
    const call = (path: string, method: string, headers: Record<string, string>, body?: unknown) => app.request(H + path, { method, headers,
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }, env);
    const successful = async (response: Response, revision: number, warningCount: number | null) => {
      expect(response.status).toBe(200);
      const body = await response.json() as { revision: number; document?: ContentCatalog; diagnostics: CatalogDiagnostics };
      expect(body).toMatchObject({ revision, diagnostics: { catalogRevision: revision, warningCount } }); return body;
    };
    registry(1, 'line');
    const bad = { pieces: [{ ...piece('retained-private-id'), tags: { mystery: ['secret'] } }] }, firstHeaders = publicationHeaders(env, auth);
    const first = await successful(await call('/catalog', 'PUT', firstHeaders, { document: bad, note: 'original' }), 2, 2);
    const receipt = await readPublication(env, CONTENT_KIND, 'coach');
    await successful(await call('/catalog', 'PUT', publicationHeaders(env, auth, 2), { pieces: [piece('current')] }), 3, 0);
    registry(2, 'mystery');
    const puts = storage.puts;
    const retry = await successful(await call('/catalog', 'PUT', firstHeaders, { document: bad, note: 'original' }), 2, 0);
    expect(retry.document).toEqual(first.document); expect(storage.puts).toBe(puts);
    expect(retry.diagnostics.registry).toMatchObject({ revision: 2, version: 'registry-2' });
    const retained = await readVersion(env, CONTENT_KIND, 'coach', 2);
    expect({ ...retained, publication: receipt.publication }).toEqual(receipt);
    expect(retained!.publication).toEqual((await readPublication(env, CONTENT_KIND, 'coach')).publication);
    await successful(await call('/catalog', 'GET', auth), 3, 2); // Diagnose returned current, not the earlier retry's catalog.
    await successful(await call('/catalog/import', 'POST', publicationHeaders(env, auth, 3), bad.pieces), 4, 0);
    await successful(await call('/catalog/import?format=csv&mode=merge', 'POST', { ...publicationHeaders(env, auth, 4), 'Content-Type': 'text/csv' },
      'id,type,title,tags,slotTypes\ncsv,video,CSV,mystery:present,story'), 5, 0);
    const remote = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify([{ ...piece('pulled'), tags: { absent: ['value'] } }])));
    try {
      await successful(await call('/catalog/pull', 'POST', publicationHeaders(env, auth, 5), { url: 'https://cms.example/diagnostics' }), 6, 2);
      await successful(await call('/catalog/rollback/2', 'POST', publicationHeaders(env, auth, 6), {}), 7, 0);
      const get = storage.get.bind(storage);
      const outage = vi.spyOn(storage, 'get').mockImplementation(async key => { if (key.includes('/reflex/rev/')) throw new Error('private registry outage'); return get(key); });
      try {
        const committed = await successful(await call('/catalog', 'PUT', publicationHeaders(env, auth, 7), { pieces: [piece('outage-write')] }), 8, null);
        expect(committed.diagnostics).toMatchObject({ status: 'unavailable', warnings: null, omittedWarningCount: null });
        expect(JSON.stringify(committed.diagnostics)).not.toContain('private registry outage');
        expect((await readPublication(env, CONTENT_KIND, 'coach')).value).toEqual(committed.document);
        await successful(await call('/catalog', 'GET', auth), 8, null);
      } finally { outage.mockRestore(); }
      const pending = publicationHeaders(env, auth, 8); storage.failPut = storage.puts + 3;
      const reads = kv.calls.length;
      expect((await call('/catalog/pull', 'POST', pending, { url: 'https://cms.example/diagnostics' })).status).toBe(503);
      expect(kv.calls.length).toBe(reads); storage.failPut = 0;
      const recovered = await successful(await call('/catalog/publication/recover', 'POST', pending), 9, 2);
      expect(recovered.document!.pieces[0]!.id).toBe('pulled');
      await successful(await call('/catalog/publication/recover', 'POST', pending), 9, 2);
      expect(remote).toHaveBeenCalledTimes(2);
      const after = kv.calls.length;
      expect((await call('/catalog', 'PUT', publicationHeaders(env, auth, 9), { pieces: [{ id: 'invalid' }] })).status).toBe(422);
      expect((await call('/catalog', 'PUT', publicationHeaders(env, auth, 1), bad)).status).toBe(409);
      expect(kv.calls.length).toBe(after);
    } finally { remote.mockRestore(); }
    expect(kv.calls.every(call => call === `get:${key}`)).toBe(true);
    expect([...storage.objects.values()].some(raw => raw.includes('catalog-registry-diagnostics'))).toBe(false);
  });

  it('W19.01 publishes equivalent JSON CSV pull and direct catalogs with safe merge retries', async () => {
    const promoted = { ...piece('promoted'), subtitle: 'Sub', art: null, renderUrl: '/render', excerpt: 'Copy', runtime: '01:30',
      lifecycle: { status: 'live' as const }, window: { from: '2026-01-01T00:00:00Z', to: '2030-01-01T00:00:00Z' },
      merchandising: { season: 0.4, promotion: 1, margin: 0 }, journeyStageFit: ['exploring' as const],
      freshnessDate: '2026-01-01T00:00:00Z', featuredProductIds: ['SKU-1'], inStock: true };
    const rival = { ...piece('rival'), tags: { line: ['Tabby'] }, lifecycle: { status: 'live' as const } };
    const catalog: ContentCatalog = { pieces: [promoted, rival] };
    const feed = [{ ...promoted, journeyStageFit: ['explore'] }, rival];
    const csvCell = (v: string) => `"${v.replaceAll('"', '""')}"`;
    // CSV's explicit art spelling is a string, so use the canonical JSON/pull
    // null separately and compare CSV to the same complete item with an asset.
    const csvPromoted = { ...promoted, art: '/a.jpg' };
    const csvRow = { id: promoted.id, customerContentId: promoted.customerContentId, type: promoted.type, title: promoted.title,
      subtitle: promoted.subtitle, tags: 'line:Drover', slotTypes: 'story', status: 'live', art: '/a.jpg', renderUrl: '/render',
      excerpt: 'Copy', runtime: '01:30', windowFrom: promoted.window.from, windowTo: promoted.window.to,
      merchandising: JSON.stringify(promoted.merchandising), journeyStageFit: 'explore', freshnessDate: promoted.freshnessDate,
      featuredProductIds: 'SKU-1', inStock: 'true' };
    const csv = Object.keys(csvRow).join(',') + '\n' + Object.values(csvRow).map(csvCell).join(',') + '\n'
      + Object.keys(csvRow).map(key => csvCell(({ id: rival.id, customerContentId: rival.customerContentId, type: rival.type,
        title: rival.title, tags: 'line:Tabby', slotTypes: 'story', status: 'live' } as Record<string, string>)[key] ?? '')).join(',');
    const storage = env.STORAGE as unknown as CatalogR2;
    const request = (suffix: string, method: string, body: unknown, headers = publicationHeaders(env, auth, revision)) =>
      app.request(`${H}/catalog${suffix}`, { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) }, env);
    const current = () => readPublication(env, CONTENT_KIND, 'coach');
    let revision = 1;
    const remote = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: feed })));
    try {
      for (const [suffix, method, body, expected] of [
        ['', 'PUT', { document: catalog }, catalog], ['/import', 'POST', feed, catalog],
        ['/import?format=csv', 'POST', csv, { pieces: [csvPromoted, rival] }],
        ['/pull', 'POST', { url: 'https://synthetic.invalid/catalog', path: 'content' }, catalog],
      ] as const) {
        const response = await request(suffix, method, body); expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ ok: true, revision: ++revision });
        expect((await current()).value.pieces).toEqual(expected.pieces);
      }
      expect(remote).toHaveBeenCalledTimes(1);
      const beforeDecision = decideContent({ tenant: 'coach', brand: 'coach', page: 'home', visitorId: 'synthetic-visitor',
        sessionId: null, identityAnchor: 'visitor', nowMs: Date.parse('2027-01-01T00:00:00Z'), pieces: (await current()).value.pieces,
        slots: [{ slot: 'story', take: 1, weights: { line: 1 }, merchandising: { promotion: 0.8 } }],
        affinity: { dims: { line: { Drover: 0.4, Tabby: 0.6 } } }, arm: 'personalized',
        cell: { channel: 'direct', visit_bucket: '1', region: 'CA', affinity: 'line:Drover' },
        versions: { config: 1, catalog: revision, slots: 1, learn: 0, lift: 0, prior: 0, policy: 0 }, configLabel: 'synthetic' });
      expect(beforeDecision.records[0]).toMatchObject({ item_id: 'promoted', explain: { score_base: 0.4, score_final: 0.72,
        merchandising: { boost: 1.8, drivers: [{ term: 'promotion', value: 1, weight: 0.8, contribution: 0.32 }] } } });
      const retirement = [{ id: promoted.id, lifecycle: { status: 'expired' }, inStock: false,
        window: { to: '2026-02-01T00:00:00Z' } }];
      expect((await request('/import?mode=merge', 'POST', retirement)).status).toBe(200); revision++;
      const retired = (await current()).value;
      const headers = publicationHeaders(env, auth, revision), update = [{ id: promoted.id, title: 'Refreshed' }];
      expect((await request('/import?mode=merge', 'POST', update, headers)).status).toBe(200); revision++;
      const expected = { ...CONTENT_KIND.stamp!(retired, revision), pieces: [{ ...retired.pieces[0], title: 'Refreshed' }, rival] };
      expect((await current()).value).toEqual(expected);
      const puts = storage.puts;
      expect(await (await request('/import?mode=merge', 'POST', update, headers)).json()).toMatchObject({ ok: true, revision });
      expect(storage.puts).toBe(puts);
      expect((await request('/import?mode=merge', 'POST', [{ id: promoted.id, title: 'Changed retry' }], headers)).status).toBe(409);
      expect((await request('/import?mode=merge', 'POST', update, publicationHeaders(env, auth, revision - 1))).status).toBe(409);
      for (const invalid of [{ merchandising: '{"promotion":1}' }, { merchandising: { promotion: 2 } },
        { lifecycle: null, status: 'live' }, { window: { to: null } }, { inStock: 2 }, { runtime: {} }, { slotTypes: [null] }]) {
        expect((await request('/import?mode=merge', 'POST', [{ id: promoted.id, ...invalid }])).status).toBe(422);
      }
      expect(storage.puts).toBe(puts); expect((await current()).value).toEqual(expected);
      expect((await request('/import?format=csv&mode=merge', 'POST', 'id,title,status,windowFrom,windowTo,inStock,merchandising\npromoted,CSV refresh,,,,,')).status).toBe(200);
      revision++;
      expect((await current()).value.pieces).toEqual([{ ...expected.pieces[0], title: 'CSV refresh' }, rival]);
      expect((await request('/import?mode=merge', 'POST', [{ id: promoted.id, lifecycle: { status: 'live' }, window: {}, inStock: true }])).status).toBe(200);
      expect((await current()).value.pieces[0]).toMatchObject({ lifecycle: { status: 'live' }, inStock: true });
      expect((await current()).value.pieces[0]!.window).toBeUndefined();
    } finally { remote.mockRestore(); }
  });

  it('W19.01 retains historical duplicate-tag receipts and recovery while new writes refuse duplicate tags', async () => {
    // Exact retained original receipt; the current writer must never create duplicate-tag history.
    const duplicate: ContentCatalog = { version: 'legacy', pieces: [
      { ...piece('duplicate'), tags: { line: ['Drover', 'Drover'] }, lifecycle: { status: 'live' } },
      { ...piece('rival'), tags: { line: ['Tabby'] }, lifecycle: { status: 'live' } },
    ] };
    const storage = env.STORAGE as unknown as CatalogR2;
    const oldMeta = { actor: 'old-writer', note: 'retained duplicate tags', expectedRevision: 1, operationId: `1:${crypto.randomUUID()}`, nowMs: 1 };
    const requestDigest = await recoveryDigest({ operationId: oldMeta.operationId, expectedRevision: 1, actor: oldMeta.actor, note: oldMeta.note, request: duplicate });
    seedLegacy(env, 'content:config:coach:current', JSON.stringify({ revision: 2, value: duplicate, actor: oldMeta.actor, note: oldMeta.note, at: 1,
      operation: { operationId: oldMeta.operationId, expectedRevision: 1, initialize: false, requestDigest } }));
    const original = await readPublication(env, CONTENT_KIND, 'coach'), immutable = [...storage.objects].filter(([key]) => key.includes('/rev/'));
    expect(original.value.pieces).toEqual(duplicate.pieces);
    expect((await readVersion(env, CONTENT_KIND, 'coach', 2))!.value).toEqual(original.value);
    const slots = { version: 'retained-slots', pages: { home: [{ slot: 'story', take: 1, weights: { line: 1 } }] } };
    seedLegacy(env, 'slots:config:coach:current', JSON.stringify({ revision: 1, value: slots, actor: 'old', note: '', at: 1 }));
    const recorded = decideContent({ tenant: 'coach', brand: 'coach', page: 'home', visitorId: 'synthetic-visitor', sessionId: null,
      identityAnchor: 'visitor', nowMs: Date.now(), pieces: original.value.pieces, slots: slots.pages.home,
      affinity: { dims: { line: { Drover: 0.4, Tabby: 0.6 } } }, arm: 'personalized',
      cell: { channel: 'direct', visit_bucket: '1', region: 'CA', affinity: 'line:Drover' },
      versions: { config: 1, catalog: 2, slots: 1, learn: 0, lift: 0, prior: 0, policy: 0 }, configLabel: 'synthetic' }).records[0]!;
    env.RETENTION = JSON.stringify({ version: 1, tenants: { coach: { ledger: { id: 'synthetic-history', revision: 1, durationMs: 86400_000, basis: 'occurred', renewal: 'new-record-only' } } } });
    recorded.retention = captureRetention(env, 'coach', recorded.ts);
    expect(recorded).toMatchObject({ item_id: 'duplicate', explain: { score_base: 0.8 } });
    expect(await replayDecision(env, recorded)).toMatchObject({ ok: true, equal: true, diff: [] });
    const puts = storage.puts;
    for (const [suffix, method, body, status] of [
      ['/validate', 'POST', { document: duplicate }, 422], ['', 'PUT', { document: duplicate }, 422],
      ['/rollback/2', 'POST', {}, 404],
    ] as const) {
      const response = await app.request(`${H}/catalog${suffix}`, { method, headers: publicationHeaders(env, auth, 2), body: JSON.stringify(body) }, env);
      expect(response.status).toBe(status);
    }
    expect(storage.puts).toBe(puts);
    await expect(initializePublication(mkEnv(), CONTENT_KIND, 'coach', { revision: 1, value: duplicate, actor: 'new', note: '', at: 1 }, `0:${crypto.randomUUID()}`))
      .rejects.toMatchObject({ status: 422, code: 'invalid_baseline' });
    const beforeRecovery = new Map(storage.objects);
    const oldHeaders = { ...auth, 'If-Match': '"1"', 'Idempotency-Key': oldMeta.operationId };
    const recovery = await app.request(`${H}/catalog/publication/recover`, { method: 'POST', headers: oldHeaders }, env);
    expect(await recovery.json()).toMatchObject({ ok: true, revision: 2 });
    expect(await readPublication(env, CONTENT_KIND, 'coach')).toMatchObject({ revision: 2, actor: oldMeta.actor, note: oldMeta.note, at: 1 });
    expect(storage.objects).toEqual(beforeRecovery);
    for (const [key, bytes] of immutable) if (!key.includes('/slots/')) expect(storage.objects.get(key)).toBe(bytes);
    expect(immutable.length).toBeGreaterThan(0);
    expect(await replayDecision(env, recorded)).toMatchObject({ ok: true, equal: true, diff: [] });
    const corrected = structuredClone(duplicate);
    corrected.pieces[0] = { ...corrected.pieces[0]!, tags: { ...corrected.pieces[0]!.tags, line: ['Drover'] } };
    const response = await app.request(`${H}/catalog`, { method: 'PUT', headers: publicationHeaders(env, auth, 2), body: JSON.stringify({ document: corrected }) }, env);
    expect(response.status).toBe(200);
    expect((await readPublication(env, CONTENT_KIND, 'coach')).value.pieces).toEqual(corrected.pieces);
    expect((await readVersion(env, CONTENT_KIND, 'coach', 2))!.value).toEqual(original.value);
    expect(await replayDecision(env, recorded)).toMatchObject({ ok: true, equal: true, diff: [] });

    // Correctly digested retained evidence, constructed as an old stored object:
    // do not mock current validation or pretend a new capture accepted duplicates.
    const f = await enrichmentPublicationFixture('enforced', false);
    await initializePublicationSet(f.env, [{ kind: CONTENT_KIND, scope: 'atelier-a', retainedValue: true,
      revision: { revision: 1, value: duplicate, actor: 'old-writer', note: '', at: 1 } }], `0:${crypto.randomUUID()}`);
    const id = crypto.randomUUID(), basis = { schema: 'content-enrichment-proposal/v1', id, tenant: 'atelier-a',
      createdAt: '2026-09-01T00:00:00.000Z', createdBy: 'service-a', createdWith: 'service', sample: duplicate,
      labels: [{ id: 'old-label', pieceId: 'duplicate', dimension: 'occasion', value: 'evening' }],
      provenance: { declared: { source: 'synthetic retained sample' }, verified: false } };
    const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
      : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
        : JSON.stringify(value);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(basis)))))
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    const proposal = { ...basis, digest: hash }, key = `content-enrichment/v1/atelier-a/${id}/proposal.json`, bytes = JSON.stringify(proposal);
    f.storage.objects.set(key, bytes); f.storage.etags.set(key, 'synthetic-retained-evidence');
    const read = await f.call(`/${id}`); expect(read.status).toBe(200); expect(await read.json()).toMatchObject({ proposal });
    const reviewed = await f.call(`/${id}/review`, 'POST', { proposalDigest: hash,
      dispositions: [{ labelId: 'old-label', action: 'approve' }] }, f.credentials['human-a']);
    expect(reviewed.status).toBe(201);
    const review = (await reviewed.json() as { review: EnrichmentReview }).review;
    const exported = await f.call(`/${id}/export`); expect(exported.status).toBe(200);
    expect(await exported.json()).toMatchObject({ proposal, review, additions: [{ pieceId: 'duplicate', value: 'evening' }] });
    const beforeRefusal = [...f.storage.objects], beforePuts = f.storage.puts;
    expect((await f.route(`/enrichment/proposals/${id}/publish`, 'POST', { proposalDigest: hash, reviewDigest: review.digest }, publicationHeaders(f.env, f.headers()))).status).toBe(422);
    expect((await f.call('', 'POST', { sample: duplicate, labels: basis.labels, provenance: basis.provenance.declared })).status).toBe(422);
    expect(f.storage.puts).toBe(beforePuts); expect([...f.storage.objects]).toEqual(beforeRefusal);
    expect(f.storage.objects.get(key)).toBe(bytes);
    const aliasSample = structuredClone(corrected); aliasSample.pieces[0] = { ...aliasSample.pieces[0]!, journeyStageFit: ['exploring'] };
    const rawSample = { ...aliasSample, pieces: [{ ...aliasSample.pieces[0], journeyStageFit: ['explore'] }, aliasSample.pieces[1]] };
    const aliasProposal = await f.capture({ sample: rawSample, labels: basis.labels, provenance: basis.provenance.declared });
    const aliasRead = await f.call(`/${aliasProposal.id}`); expect(aliasRead.status).toBe(200);
    expect(await aliasRead.json()).toMatchObject({ proposal: { sample: rawSample } });
  });

  it('W20.01 rejects contradictory pin publication without writes and preserves retained reads through corrected publication', async () => {
    const hero = { slot: 'hero', take: 1, weights: { occasion: 0.5 }, pinnedPieceId: 'p' };
    const legacy = { version: 'retained-pins', pages: { home: [hero, { ...hero, slot: 'story', take: 2 }] } };
    const kv = env.CACHE as unknown as FakeKV;
    const raw = JSON.stringify({ revision: 3, value: legacy, actor: 'old', note: 'retained', at: 1 });
    seedLegacy(env, 'slots:config:coach:current', raw); seedLegacy(env, 'slots:config:coach:rev:3', raw);
    const request = (suffix: string, method = 'GET', body?: unknown) => app.request(`${H}/slots${suffix}?scope=coach`,
      { method, headers: authoredHeaders(env, auth, 'slots'), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    expect(await (await request('')).json()).toMatchObject({ revision: 3, document: legacy });
    expect(await (await request('/revisions/3')).json()).toMatchObject({ revision: 3, value: legacy });
    const before = [...kv.store]; kv.calls.length = 0;
    expect((await app.request(`${H}/slots?scope=coach`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: legacy }) }, env)).status).toBe(401);
    for (const document of [legacy,
      { pages: { home: [hero, { ...hero, slot: 'story' }] } },
      { pages: { home: [{ ...hero, take: 2 }] } },
    ]) {
      for (const [suffix, method] of [['/validate', 'POST'], ['', 'PUT']] as const) {
        const response = await request(suffix, method, { document });
        expect(response.status).toBe(422); expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toMatchObject({ ...(suffix === '/validate' ? { valid: false } : { ok: false }),
          errors: expect.arrayContaining([expect.stringContaining('pin')]) });
      }
    }
    expect((await request('/rollback/3', 'POST', {})).status).toBe(404);
    expect(await patch(env, SLOTS_KIND, 'coach', DEFAULT_SLOTS, { version: 'unrelated-change' }, { actor: 'ops', expectedRevision: 3, expectedPublication: (await readPublication(env, SLOTS_KIND, 'coach')).publication, operationId: '3:' + crypto.randomUUID() })).toMatchObject({ ok: false });
    expect([...kv.store]).toEqual(before); expect(kv.calls.some(call => call.startsWith('put:'))).toBe(false);
    const corrected = { ...legacy, pages: { home: [hero, { ...hero, slot: 'story', pinnedPieceId: 'q' }], other: [hero] } };
    expect(await (await request('/validate', 'POST', { document: corrected })).json()).toMatchObject({ valid: true });
    expect(await (await request('', 'PUT', { document: corrected })).json()).toMatchObject({ ok: true, revision: 4 });
    expect(await (await request('')).json()).toMatchObject({ revision: 4, document: { pages: corrected.pages } });
    expect(await (await request('/revisions/3')).json()).toMatchObject({ revision: 3, value: legacy });
    expect(kv.store.get('slots:config:coach:rev:3')).toBe(raw);
  });

  it('W28.01 rejects new Thompson validation writes patches and rollback while preserving complete retained documents', async () => {
    const legacy = { ...DEFAULT_LEARN, slots: { hero: { gamma: 0.7, reward: 'purchase', objective: 'revenue',
      exploration: { mode: 'thompson', share: 0, floor: 50 }, items: { a: { mode: 'freeze', lift: 1.4 } } } } };
    const kv = env.CACHE as unknown as FakeKV;
    const raw = JSON.stringify({ revision: 3, value: legacy, actor: 'old', note: 'retained', at: 1 });
    seedLegacy(env, 'learn:config:coach:current', raw); seedLegacy(env, 'learn:config:coach:rev:3', raw);
    const request = (suffix: string, method = 'GET', body?: unknown) => app.request(`${H}/learn${suffix}${suffix.includes('?') ? '&' : '?'}scope=coach`,
      { method, headers: authoredHeaders(env, auth, 'learn'), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    expect(await (await request('')).json()).toMatchObject({ revision: 3, document: legacy });
    expect(await (await request('/revisions/3')).json()).toMatchObject({ revision: 3, value: legacy });
    const before = [...kv.store]; kv.calls.length = 0;
    for (const [suffix, method, body] of [['/validate', 'POST', { document: legacy }], ['', 'PUT', { document: legacy }], ['/rollback/3', 'POST', {}]] as const) {
      const response = await request(suffix, method, body); expect(response.status).toBe(suffix.startsWith('/rollback') ? 404 : 422);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(await patch(env, LEARN_KIND, 'coach', DEFAULT_LEARN, { slots: { hero: { gamma: 0.8 } } }, { actor: 'ops', expectedRevision: 3, expectedPublication: (await readPublication(env, LEARN_KIND, 'coach')).publication, operationId: '3:' + crypto.randomUUID() })).toMatchObject({ ok: false });
    expect([...kv.store]).toEqual(before); expect(kv.calls.some(call => call.startsWith('put:'))).toBe(false);
    for (const mode of [['rotation'], { toString: () => 'rotation' }, null]) {
      const validation = LEARN_KIND.validate({ ...legacy, slots: { hero: { exploration: { mode, share: 0, floor: 1 } } } });
      expect(validation.ok).toBe(false);
      if (!validation.ok) expect(validation.errors.join(' ')).not.toContain('thompson');
    }
    const replacement = { ...legacy, slots: { hero: { ...legacy.slots.hero, exploration: { mode: 'off', share: 0, floor: 50 } } } };
    expect(await (await request('', 'PUT', { document: replacement })).json()).toMatchObject({ ok: true, revision: 4 });
    expect(await (await request('/revisions/3')).json()).toMatchObject({ value: legacy });
    expect(CONTENT_KIND.validateStored).toBeTypeOf('function');
  });

  it('requires explicit initialization, refuses unauthenticated writes, stores and versions a valid document', async () => {
    expect((await app.request(`${H}/catalog?scope=coach`, { headers: auth }, mkEnv())).status).toBe(503);
    const d0 = await (await app.request(`${H}/catalog?scope=coach`, { headers: auth }, env)).json() as { source: string; revision: number; document: { pieces: unknown[] } };
    expect(d0).toMatchObject({ source: 'stored', revision: 1 });
    expect(d0.document.pieces).toEqual([]);
    expect((await app.request(`${H}/catalog?scope=coach`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' }, env)).status).toBe(401);
    const bad = await app.request(`${H}/catalog?scope=coach`, { method: 'PUT', headers: publicationHeaders(env, auth), body: JSON.stringify({ document: { pieces: [{ id: 'x' }] } }) }, env);
    expect(bad.status).toBe(422);
    const ok = await app.request(`${H}/catalog?scope=coach`, { method: 'PUT', headers: publicationHeaders(env, auth), body: JSON.stringify({ document: { pieces: [piece('a')] }, note: 'first' }) }, env);
    expect(await ok.json()).toMatchObject({ ok: true, revision: 2, version: 'content+r2' });
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
    const d1 = await (await app.request(`${H}/catalog?scope=coach`, { headers: auth }, env)).json() as { source: string; revision: number; actor: string; note: string };
    expect(d1).toMatchObject({ source: 'stored', revision: 2, actor: 'ops', note: 'first' });
    expect(await (await app.request(`${H}/nope?scope=coach`, { headers: auth }, env)).json()).toMatchObject({ error: expect.stringContaining('kind') });
  });

  it('authenticated validation runs the same validator; slots and learn are kinds too', async () => {
    const r = await app.request(`${H}/slots/validate`, { method: 'POST', headers: auth, body: JSON.stringify({ document: { pages: { home: [{ slot: 'hero', take: 0, weights: {} }] } } }) }, env);
    expect(r.status).toBe(422);
    const ok = await app.request(`${H}/learn?scope=coach`, { method: 'PUT', headers: authoredHeaders(env, auth, 'learn'), body: JSON.stringify({ document: { holdout: { share: 0.1, arms: ['default', 'no_learning'] } } }) }, env);
    expect(await ok.json()).toMatchObject({ ok: true, revision: 2, version: 'learn+r2' });
  });

  it('history lists revisions and rollback rolls forward', async () => {
    for (const [i, n] of ['a', 'b'].entries()) await app.request(`${H}/catalog?scope=coach`, { method: 'PUT', headers: publicationHeaders(env, auth, i + 1), body: JSON.stringify({ document: { pieces: [piece(n)] } }) }, env);
    const hist = await (await app.request(`${H}/catalog/history?scope=coach`, { headers: auth }, env)).json() as { revisions: Array<{ revision: number }> };
    expect(hist.revisions.map((r) => r.revision)).toEqual([3, 2, 1]);
    const rb = await (await app.request(`${H}/catalog/rollback/2?scope=coach`, { method: 'POST', headers: publicationHeaders(env, auth, 3), body: '{}' }, env)).json();
    expect(rb).toMatchObject({ ok: true, revision: 4 });
    const now = await (await app.request(`${H}/catalog?scope=coach`, { headers: auth }, env)).json() as { document: { pieces: Array<{ id: string }> } };
    expect(now.document.pieces[0]!.id).toBe('a');
    expect((await app.request(`${H}/catalog/revisions/3?scope=coach`, { headers: auth }, env)).status).toBe(200);
    expect((await app.request(`${H}/catalog/revisions/9?scope=coach`, { headers: auth }, env)).status).toBe(404);
  });

  it('imports JSON (replace), CSV (merge), and reports what it could not use', async () => {
    const j = await (await app.request(`${H}/catalog/import?scope=coach`, { method: 'POST', headers: publicationHeaders(env, auth), body: JSON.stringify({ content: [{ systemId: 'p1', customerContentId: 'C1', type: 'editorial', title: 'P1', tags: { line: ['Drover'] }, slotTypes: ['chero'] }] }) }, env)).json();
    expect(j).toMatchObject({ ok: true, mode: 'replace', received: 1, imported: 1, pieces: 1, revision: 2 });
    const csv = 'id,customerContentId,type,title,tags,slotTypes\np2,C2,video,P2,occasion:evening,story\n';
    const m = await (await app.request(`${H}/catalog/import?scope=coach&format=csv&mode=merge`, { method: 'POST', headers: { ...publicationHeaders(env, auth, 2), 'Content-Type': 'text/csv' }, body: csv }, env)).json();
    expect(m).toMatchObject({ ok: true, mode: 'merge', pieces: 2, revision: 3 });
    const bad = await app.request(`${H}/catalog/import?scope=coach`, { method: 'POST', headers: publicationHeaders(env, auth, 3), body: JSON.stringify({ content: [{ id: 'p3' }] }) }, env);
    expect(bad.status).toBe(422);
    // A missing customer id falls back to the piece id on purpose; type, title and slotTypes cannot.
    expect(await bad.json()).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringContaining('.type'), expect.stringContaining('.title'), expect.stringContaining('slotTypes')]) });
    expect((await app.request(`${H}/catalog/import?scope=coach`, { method: 'POST', headers: publicationHeaders(env, auth, 3), body: JSON.stringify({ nothing: [] }) }, env)).status).toBe(422);
  });

  it('pulls from a URL through the seam, http(s) only', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: [{ id: 'q1', customerContentId: 'Q1', type: 'guide', title: 'Q', tags: {}, slotTypes: ['story'] }] })));
    try {
      const r = await (await app.request(`${H}/catalog/pull?scope=coach`, { method: 'POST', headers: publicationHeaders(env, auth), body: JSON.stringify({ url: 'https://cms.example/export.json', path: 'content' }) }, env)).json();
      expect(r).toMatchObject({ ok: true, pieces: 1, revision: 2 });
      expect(spy).toHaveBeenCalledWith('https://cms.example/export.json', expect.anything());
      expect((await app.request(`${H}/catalog/pull?scope=coach`, { method: 'POST', headers: publicationHeaders(env, auth, 2), body: JSON.stringify({ url: 'file:///etc/passwd' }) }, env)).status).toBe(400);
    } finally { spy.mockRestore(); }
  });
});

describe.each(['open', 'enforced'] as const)('W03.01 administrative boundaries in %s mode', (mode) => {
  it.each(['absent', 'sdk-only', 'invalid', 'refresh'])('refuses %s credentials before payload, store or remote effects', async (credential) => {
    invalidateCache();
    const env = mkEnv(); env.AUTH_MODE = mode; env.SDK_KEYS = 'synthetic-brand-b:synthetic-site-key';
    env.TENANTS = JSON.stringify({ provisioned: ['synthetic-brand-b'], operatorGrants: { 'synthetic-operator': ['synthetic-brand-b'] } });
    const kv = env.CACHE as unknown as FakeKV;
    const storage = env.STORAGE as unknown as CatalogR2;
    await initializeCatalog(env, 'synthetic-brand-b');
    let payloadReads = 0, bindingReads = 0;
    const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>();
    app.use('*', async (c, next) => {
      c.set('tenant', 'synthetic-brand-b'); // Trusted route fixture context, not query authority.
      const json = c.req.json.bind(c.req), text = c.req.text.bind(c.req);
      c.req.json = <T>() => { payloadReads++; return json() as Promise<T>; };
      c.req.text = () => { payloadReads++; return text(); };
      await next();
    });
    app.route('/content', contentRoutes); app.route('/config', configRoutes);
    const scope = '?scope=synthetic-brand-b';
    const access = await token({ sub: 'synthetic-operator', type: 'service' });
    const auth = { 'Content-Type': 'application/json', 'X-Tenant': 'synthetic-brand-b', Authorization: `Bearer ${access}` };
    for (const [path, body] of [
      ['/content/catalog', { document: { pieces: [{ ...piece('private-piece'), title: 'SYNTHETIC_PRIVATE_CATALOG' }] } }],
      ['/config/reflex', { config: { ...DEFAULT_REFLEX_CONFIG, version: 'SYNTHETIC_PRIVATE_CONFIG', K: 7 } }],
    ] as const) {
      const response = await app.request(H + path + scope, { method: 'PUT', headers: authoredHeaders(env, auth, path.startsWith('/content') ? 'content' : 'reflex'), body: JSON.stringify(body) }, env);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, revision: 2 });
    }
    expect(kv.calls.filter((call) => call.startsWith('put:'))).toHaveLength(0);
    const state = JSON.stringify([...kv.store]), catalogState = JSON.stringify([...storage.objects]);
    Object.defineProperty(env, 'CACHE', { get() { bindingReads++; return kv; } });
    Object.defineProperty(env, 'STORAGE', { get() { bindingReads++; return storage; } });
    const headers: Record<string, string> = { 'Content-Type': 'application/json',
      ...(credential === 'sdk-only' ? { 'X-SDK-Key': 'synthetic-site-key' } : {}),
      ...(credential === 'invalid' ? { Authorization: 'Bearer not-a-jwt' } : {}),
      ...(credential === 'refresh' ? { Authorization: `Bearer ${await token({ sub: 'synthetic-operator', type: 'refresh' })}` } : {}),
    };
    const remote = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('unexpected synthetic remote effect'); });
    try {
      kv.calls.length = 0; storage.calls.length = 0; payloadReads = 0;
      const operations = [
        ['GET', '/config/reflex'], ['HEAD', '/config/reflex'], ['GET', '/config/reflex/history'],
        ['GET', '/config/reflex/revisions/1'], ['POST', '/config/reflex/validate'],
        ['PUT', '/config/reflex'], ['PATCH', '/config/reflex'], ['POST', '/config/reflex/rollback/1'],
        ['GET', '/content/catalog'], ['HEAD', '/content/catalog'], ['GET', '/content/catalog/history'],
        ['GET', '/content/catalog/revisions/1'], ['POST', '/content/catalog/validate'],
        ['PUT', '/content/catalog'], ['POST', '/content/catalog/rollback/1'],
        ['POST', '/content/catalog/import'], ['POST', '/content/catalog/pull'],
        ['GET', '/content/catalog/publication'], ['POST', '/content/catalog/publication/recover'], ['PUT', '/content/CATALOG'],
      ];
      for (const [method, path] of operations) {
        invalidateCache();
        const body = path === '/config/reflex/validate' ? '{"patch":{}}'
          : path === '/content/catalog/pull' ? '{"url":"https://synthetic.invalid/feed"}' : '{';
        const response = await app.request(H + path + scope, { method, headers,
          ...(['GET', 'HEAD'].includes(method) ? {} : { body }) }, env);
        expect(response.status, method + ' ' + path).toBe(401);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE');
      }
      expect(payloadReads).toBe(0); expect(bindingReads).toBe(0); expect(kv.calls).toEqual([]); expect(storage.calls).toEqual([]);
      expect(remote).not.toHaveBeenCalled(); expect(JSON.stringify([...kv.store])).toBe(state);
      expect(JSON.stringify([...storage.objects])).toBe(catalogState);
    } finally { remote.mockRestore(); }
  });
});

describe('W11.01 catalog operation boundary and exact import base', () => {
  it('binds both modes to typed tenant authority, fences imports and recovers a retained pull without another feed call', async () => {
    for (const mode of ['open', 'enforced'] as const) {
      const env = mkEnv(), storage = env.STORAGE as unknown as CatalogR2;
      env.AUTH_MODE = mode; env.TENANTS = JSON.stringify({ provisioned: ['atelier-a', 'atelier-b'], operatorGrants: { alpha: ['atelier-a'], successor: ['atelier-a'], beta: ['atelier-b'] } });
      await initializeCatalog(env, 'atelier-a'); await initializeCatalog(env, 'atelier-b');
      const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>(); app.use('*', tenantMiddleware()); app.route('/content', contentRoutes);
      const auth = { 'Content-Type': 'application/json', 'X-Tenant': 'atelier-a', Authorization: `Bearer ${await token({ sub: 'alpha', type: 'service' })}` };
      const call = (path: string, method = 'GET', headers: Record<string, string> = auth, body?: unknown) => app.request(H + '/content/' + path, { method, headers,
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }, env);
      const before = storage.calls.length;
      for (const suffix of ['?scope=atelier-b', '?tenant=atelier-b', '?scope=atelier-a&scope=atelier-a']) expect((await call('catalog' + suffix)).status).toBe(403);
      for (const path of ['catalog', 'CATALOG', '%63atalog']) {
        expect([401, 403]).toContain((await call(path, 'PUT', { ...auth, Authorization: `Bearer ${await token({ sub: 'alpha' })}` }, '{')).status);
        expect((await call(path, 'PUT', { ...auth, 'X-Tenant': 'atelier-b' }, '{')).status).toBe(403);
      }
      expect(storage.calls.length).toBe(before);
      const remote = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: [piece('pulled')] })));
      try {
        expect((await call('catalog/pull', 'POST', auth, '{')).status).toBe(428);
        expect((await call('catalog/pull', 'POST', { ...publicationHeaders(env, auth), 'If-Match': '1' }, '{')).status).toBe(400);
        expect(remote).not.toHaveBeenCalled();
        const first = publicationHeaders(env, auth), second = publicationHeaders(env, auth);
        const race = await Promise.all([call('catalog/import?mode=merge', 'POST', first, [piece('one')]), call('catalog/import?mode=merge', 'POST', second, [piece('two')])]);
        expect(race.map(r => r.status).sort()).toEqual([200, 409]);
        const winner = race[0].status === 200 ? first : second, id = race[0].status === 200 ? 'one' : 'two';
        expect((await call('catalog/import?mode=merge', 'POST', winner, [piece(id)])).status).toBe(200);
        expect((await call('catalog/import?mode=replace', 'POST', winner, [piece(id)])).status).toBe(409);
        expect((await call('catalog/import?mode=merge', 'POST', publicationHeaders(env, auth, 2), [piece('next')])).status).toBe(200);
        expect((await readPublication(env, CONTENT_KIND, 'atelier-a')).value.pieces.map(p => p.id)).toEqual([id, 'next']);
        expect((await call('catalog/pull', 'POST', publicationHeaders(env, auth, 1), { url: 'https://cms.example/feed' })).status).toBe(409);
        expect(remote).not.toHaveBeenCalled();
        const pendingHeaders = publicationHeaders(env, auth, 3); storage.failPut = storage.puts + 3; storage.afterWrite = false;
        expect((await call('catalog/pull', 'POST', pendingHeaders, { url: 'https://cms.example/feed' })).status).toBe(503);
        expect(remote).toHaveBeenCalledTimes(1); storage.failPut = 0;
        const successor = { ...auth, Authorization: `Bearer ${await token({ sub: 'successor', type: 'service' })}` };
        expect(await (await call('catalog/publication', 'GET', successor)).json()).toMatchObject({ state: 'pending', committedRevision: 3, operationId: pendingHeaders['Idempotency-Key'], actor: 'alpha' });
        expect((await call('catalog/revisions/4')).status).toBe(404);
        expect((await call('catalog/pull', 'POST', pendingHeaders, { url: 'https://cms.example/feed' })).status).toBe(409);
        expect((await call('catalog/publication/recover', 'POST', { ...pendingHeaders, Authorization: successor.Authorization })).status).toBe(200);
        expect(await (await call('catalog', 'GET', successor)).json()).toMatchObject({ revision: 4, actor: 'alpha', document: { pieces: [{ id: 'pulled' }] } });
        expect((await call('catalog/publication/recover', 'POST', { ...pendingHeaders, Authorization: successor.Authorization })).status).toBe(200);
        expect(remote).toHaveBeenCalledTimes(1);
        expect((await readPublication(env, CONTENT_KIND, 'atelier-b')).revision).toBe(1);
        const diagnosticReads = (env.CACHE as unknown as FakeKV).calls;
        expect(diagnosticReads).toEqual([]);
        expect(storage.calls.some(c => c.includes('/reflex/rev/'))).toBe(true);
        expect(diagnosticReads.every(call => call === 'get:reflex:config:atelier-a:current')).toBe(true);
      } finally { remote.mockRestore(); }
    }
  });
});

describe('authenticated reflex administration', () => {
  it('W38.04 bounds every consuming route before effects and preserves authority optional rollback and import replay', async () => {
    invalidateCache(); const env = mkEnv(), kv = env.CACHE as unknown as FakeKV, storage = env.STORAGE as unknown as CatalogR2;
    await initializeCatalog(env);
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${await token({ sub: 'ops', type: 'service' })}` };
    const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>();
    app.use('*', tenantMiddleware()); app.route('/content', contentRoutes); app.route('/config', configRoutes);
    const call = (path: string, method: string, body?: string, headers: Record<string, string> = authoredHeaders(env, auth, path.includes('/config/') ? 'reflex' : path.includes('/priors') ? 'prior' : 'content')) => app.request(H + path, { method, headers, ...(body === undefined ? {} : { body }) }, env);
    const puts = () => kv.calls.filter(c => c.startsWith('put:')).length + storage.puts;
    const before = puts(), state = JSON.stringify([[...kv.store], [...storage.objects]]);
    const oversized = (path: string, method: string, headers: Record<string, string>) => {
      let pulls = 0, cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(c) { pulls++; c.enqueue(new Uint8Array(pulls === 1 ? INPUT_MAX_BYTES : 1)); },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 });
      const request = new Request(H + path, { method, headers: { ...headers, 'Content-Length': '1' }, body, duplex: 'half' } as RequestInit);
      return { result: app.request(request, undefined, env), state: () => ({ pulls, cancelled, locked: body.locked }) };
    };
    const lanes: Array<[string, string, string?]> = [
      ['/config/reflex/validate?scope=coach', 'POST'], ['/config/reflex?scope=coach', 'PUT'], ['/config/reflex?scope=coach', 'PATCH'], ['/config/reflex/rollback/1?scope=coach', 'POST'],
      ...['catalog', 'slots', 'learn', 'priors'].flatMap(kind => [
        [`/content/${kind}/validate?scope=coach`, 'POST'], [`/content/${kind}?scope=coach`, 'PUT'], [`/content/${kind}/rollback/1?scope=coach`, 'POST'],
      ] as Array<[string, string]>),
      ['/content/priors?scope=coach', 'PUT', 'text/csv'], ['/content/catalog/import', 'POST'], ['/content/catalog/import?format=csv', 'POST', 'text/csv'], ['/content/catalog/pull', 'POST'],
    ];
    for (const [path, method, type] of lanes) {
      const operation = oversized(path, method, { ...publicationHeaders(env, auth), ...(type ? { 'Content-Type': type } : {}) });
      const response = await operation.result;
      expect(response.status, path).toBe(413); expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ ok: false, code: 'input_budget_exceeded', budget: 'bytes', limit: INPUT_MAX_BYTES, observed: INPUT_MAX_BYTES + 1 });
      expect(operation.state()).toEqual({ pulls: 2, cancelled: true, locked: false });
    }
    expect(puts()).toBe(before); expect(JSON.stringify([[...kv.store], [...storage.objects]])).toBe(state);
    for (const [headers, expected, suffix] of [
      [{ 'Content-Type': 'application/json' }, 401, ''], [auth, 428, ''], [publicationHeaders(env, auth), 403, '?scope=other'],
    ] as const) {
      const denied = oversized('/content/catalog/import' + suffix, 'POST', headers);
      expect((await denied.result).status).toBe(expected); expect(denied.state().pulls).toBe(0);
    }
    for (const path of ['/config/reflex/rollback/1?scope=coach', '/content/catalog/rollback/1']) {
      const body = new ReadableStream<Uint8Array>({ pull() { throw new Error('private synthetic failure'); } });
      const response = await app.request(new Request(H + path, { method: 'POST', headers: publicationHeaders(env, auth), body, duplex: 'half' } as RequestInit), undefined, env);
      expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, error: 'Input stream could not be read', code: 'input_unreadable' });
    }
    const catalogValidate = vi.spyOn(CONTENT_KIND, 'validate'), priorsValidate = vi.spyOn(PRIORS_KIND, 'validate');
    try {
      for (const [kind, field] of [['catalog', 'pieces'], ['priors', 'rows']]) {
        for (const [suffix, method] of [['', 'PUT'], ['/validate', 'POST']]) {
          const response = await call(`/content/${kind}${suffix}?scope=coach`, method!, JSON.stringify({ document: { [field!]: Array(INPUT_MAX_RECORDS + 1).fill(null) } }), publicationHeaders(env, auth));
          expect(response.status).toBe(413); expect(await response.json()).toMatchObject({ budget: 'records', observed: INPUT_MAX_RECORDS + 1 });
        }
      }
      expect(catalogValidate).not.toHaveBeenCalled(); expect(priorsValidate).not.toHaveBeenCalled();
    } finally { catalogValidate.mockRestore(); priorsValidate.mockRestore(); }
    for (const [path, body, type] of [
      ['/content/catalog/import', JSON.stringify({ content: Array(INPUT_MAX_RECORDS + 1).fill(null) }), 'application/json'],
      ['/content/priors?scope=coach', 'slot,item,cell,p_prior,n_equiv\n' + Array(INPUT_MAX_RECORDS + 1).fill('story,p1,*,0.5,2').join('\n'), 'text/csv'],
    ]) expect((await call(path!, path!.includes('/import') ? 'POST' : 'PUT', body, { ...publicationHeaders(env, auth), 'Content-Type': type! })).status).toBe(413);
    const remote = vi.spyOn(globalThis, 'fetch');
    try {
      for (const response of [new Response(' '.repeat(INPUT_MAX_BYTES + 1)), new Response(JSON.stringify(Array(INPUT_MAX_RECORDS + 1).fill(null)))]) {
        remote.mockResolvedValueOnce(response);
        const result = await call('/content/catalog/pull', 'POST', '{"url":"https://synthetic.invalid/feed"}', publicationHeaders(env, auth));
        expect(result.status).toBe(413); expect(result.headers.get('cache-control')).toBe('no-store'); expect(await result.json()).toMatchObject({ code: 'input_budget_exceeded' });
      }
      remote.mockResolvedValueOnce(new Response('{'));
      expect((await call('/content/catalog/pull', 'POST', '{"url":"https://synthetic.invalid/feed"}', publicationHeaders(env, auth))).status).toBe(502);
    } finally { remote.mockRestore(); }
    expect(puts()).toBe(before); expect(JSON.stringify([[...kv.store], [...storage.objects]])).toBe(state);
    const records = Array.from({ length: 501 }, (_, i) => piece(`admitted-${i}`)), headers = publicationHeaders(env, auth);
    const imported = JSON.stringify({ content: records });
    expect(await (await call('/content/catalog/import', 'POST', imported, headers)).json()).toMatchObject({ ok: true, pieces: 501, received: 501, revision: 2 });
    const afterImport = puts();
    expect(await (await call('/content/catalog/import', 'POST', imported, headers)).json()).toMatchObject({ ok: true, pieces: 501, revision: 2 });
    expect(puts()).toBe(afterImport);
    expect(await (await call('/content/catalog/validate', 'POST', JSON.stringify({ pieces: records }))).json()).toMatchObject({ valid: true });
    expect(await (await call('/content/priors?scope=coach', 'PUT', 'slot,item,cell,p_prior,n_equiv\r\nstory,p1,,0.5,2', { ...authoredHeaders(env, auth, 'prior'), 'Content-Type': 'text/csv' })).json()).toMatchObject({ ok: true, document: { rows: [{ cell: '*', p_prior: 0.5 }] } });
    expect((await call('/config/reflex?scope=coach', 'PUT', JSON.stringify({ config: DEFAULT_REFLEX_CONFIG }))).status).toBe(200);
    for (const body of [undefined, '{']) {
      expect(await (await call('/config/reflex/rollback/1?scope=coach', 'POST', body)).json()).toMatchObject({ ok: true });
    }
    expect(await (await call('/content/catalog/rollback/1', 'POST', '{', publicationHeaders(env, auth, 2))).json()).toMatchObject({ ok: true, revision: 3 });
    expect((await call('/config/reflex/validate?scope=coach', 'POST', '{')).status).toBe(400);
    console.log('W38.04 mounted admission', JSON.stringify({ guarded_lanes: lanes.length, admitted_pieces: 501, remote_refusals: 2, writes_before_refusal: 0 }));
  });

  it('W38.03 returns typed no-store guard failures and patches actual tenant config from a fresh strict base', async () => {
    invalidateCache(); const env = mkEnv(), kv = env.CACHE as unknown as FakeKV;
    env.TENANTS = JSON.stringify({ provisioned: ['coach', 'atelier-a'], operatorGrants: { ops: ['coach', 'atelier-a'] } });
    await initializeCatalog(env); await initializeCatalog(env, 'atelier-a');
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${await token({ sub: 'ops', type: 'service' })}` };
    const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>();
    app.use('*', tenantMiddleware()); app.route('/content', contentRoutes); app.route('/config', configRoutes);
    const call = (path: string, method: string, body?: unknown) => {
      const scope = path.includes('atelier-a') ? 'atelier-a' : 'coach', name = path.includes('/config/') ? 'reflex' : 'learn';
      return app.request(H + path, { method, headers: authoredHeaders(env, { ...auth, 'X-Tenant': scope }, name),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    };
    const reflexScope = reflexScopeForTenant('atelier-a');
    const cases = [
      { path: '/content/learn?scope=coach', key: 'learn:config:coach:current', field: 'document', value: DEFAULT_LEARN,
        large: { ...DEFAULT_LEARN, version: 'é'.repeat(INPUT_MAX_BYTES / 2) } },
      { path: '/config/reflex?tenant=atelier-a', key: `reflex:config:${reflexScope}:current`, field: 'config', value: DEFAULT_REFLEX_CONFIG,
        large: { ...DEFAULT_REFLEX_CONFIG, padding: 'é'.repeat(INPUT_MAX_BYTES / 2) } },
    ];
    for (const c of cases) {
      invalidateCache(); kv.store.clear(); kv.calls.length = 0;
      const oversized = await call(c.path, 'PUT', { [c.field]: c.large });
      expect(oversized.status).toBe(413); expect(oversized.headers.get('cache-control')).toBe('no-store');
      expect(await oversized.json()).toMatchObject({ ok: false, code: 'input_budget_exceeded' }); expect(kv.calls.some(c => c.startsWith('put:'))).toBe(false);
      for (const corrupt of ['{', ' '.repeat(LEGACY_DOCUMENT_MAX_BYTES + 1)]) {
        seedLegacy(env, c.key, corrupt); const before = [...kv.store]; kv.calls.length = 0;
        const refused = await call(c.path, 'PUT', { [c.field]: c.value });
        expect(refused.status).toBe(503); expect(refused.headers.get('cache-control')).toBe('no-store');
        expect(await refused.json()).toMatchObject({ ok: false, code: 'publication_unavailable' });
        expect([...kv.store]).toEqual(before); expect(kv.calls.some(c => c.startsWith('put:'))).toBe(false);
      }
    }
    invalidateCache(); kv.store.clear();
    const path = '/config/reflex?tenant=atelier-a', key = `reflex:config:${reflexScope}:current`;
    const seed = (revision: number, thetaIn: number) => {
      const value = { ...DEFAULT_REFLEX_CONFIG, version: 'tenant-local', K: 7, thetaIn };
      seedLegacy(env, key, JSON.stringify({ revision, value, actor: 'ops', note: '', at: 1 }));
      seedLegacy(env, `reflex:config:${reflexScope}:index`, JSON.stringify([{ revision, version: value.version, actor: 'ops', note: '', at: 1 }]));
    };
    seed(1, 0.7); expect(await (await call(path, 'GET')).json()).toMatchObject({ revision: 1, config: { thetaIn: 0.7 } });
    seed(2, 0.8); // Out-of-isolate update, while the earlier serving value is cached.
    const patched = await call(path, 'PATCH', { patch: { K: 8 } });
    expect(patched.status).toBe(200); expect(await patched.json()).toMatchObject({ ok: true, revision: 3, config: { K: 8, thetaIn: 0.8 } });
    (env.STORAGE as unknown as CatalogR2).objects.delete('config-publication/v1/' + reflexScope + '/reflex/rev/3.json'); invalidateCache(); kv.calls.length = 0;
    const missing = await call(path, 'PATCH', { patch: { K: 9 } });
    expect(missing.status).toBe(503); expect(kv.calls.some(c => c.startsWith('put:'))).toBe(false);
    kv.calls.length = 0;
    const denied = await app.request(H + '/content/learn?scope=coach', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: DEFAULT_LEARN }) }, env);
    expect(denied.status).toBe(401); expect(kv.calls.some(c => c.startsWith('put:'))).toBe(false);
  });

  it('preserves stored reads, merged validation, history, revision and rollback with no-store', async () => {
    invalidateCache();
    const env = mkEnv(), auth = { 'Content-Type': 'application/json', 'X-Tenant': 'synthetic-brand-b', Authorization: `Bearer ${await token({ sub: 'ops', type: 'service' })}` };
    env.TENANTS = JSON.stringify({ provisioned: ['synthetic-brand-b'], operatorGrants: { ops: ['synthetic-brand-b'] } });
    await initializeCatalog(env, 'synthetic-brand-b');
    const app = new Hono(); app.use('*', tenantMiddleware()); app.route('/', configRoutes);
    const scope = '?scope=synthetic-brand-b';
    const call = async (path: string, init: RequestInit = {}) => {
      const response = await app.request(H + path + scope, { ...init, headers: authoredHeaders(env, auth, 'reflex') }, env);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      return response;
    };
    const initial = await call('/reflex', { method: 'PUT', body: JSON.stringify({ config: { ...DEFAULT_REFLEX_CONFIG, version: 'private-config', K: 7 } }) });
    expect(await initial.json()).toMatchObject({ ok: true, revision: 2 });
    expect(await (await call('/reflex', { method: 'PATCH', body: '{"patch":{"K":9}}' })).json()).toMatchObject({ ok: true, revision: 3 });
    expect(await (await call('/reflex')).json()).toMatchObject({ source: 'stored', revision: 3, config: { K: 9 } });
    expect(await (await call('/reflex/history')).json()).toMatchObject({ revisions: [{ revision: 3 }, { revision: 2 }, { revision: 1 }] });
    expect(await (await call('/reflex/revisions/2')).json()).toMatchObject({ revision: 2, config: { K: 7 } });
    expect(await (await call('/reflex/validate', { method: 'POST', body: '{"patch":{}}' })).json()).toMatchObject({ valid: true, config: { K: 9 } });
    expect(await (await call('/reflex/rollback/2', { method: 'POST', body: '{}' })).json()).toMatchObject({ ok: true, revision: 4 });
    expect(await (await call('/reflex')).json()).toMatchObject({ revision: 4, config: { K: 7 } });
    expect((await call('/reflex/revisions/bad')).status).toBe(400);
    expect((await call('/reflex/revisions/99')).status).toBe(404);
    expect((await call('/reflex/validate', { method: 'POST', body: '{' })).status).toBe(400);
  });
});

// Conditional behavior is synthetic: this is route/auth evidence, not native or
// deployed R2 proof. No external storage or provider calls occur in these groups.
class EnrichmentR2 {
  objects = new Map<string, string>();
  calls: string[] = [];
  mode = '';
  metadata(key: string, raw: string) { return { key, etag: 'synthetic-etag', size: new TextEncoder().encode(raw).byteLength }; }
  async get(key: string) {
    this.calls.push(`get:${key}`);
    if (this.mode === 'get-throw') throw new Error('Synthetic unavailable read');
    if (this.mode === 'get-review-throw' && key.endsWith('/review.json')) throw new Error('Synthetic unavailable review read');
    if (this.mode === 'get-undefined') return undefined;
    const raw = this.objects.get(key); if (raw === undefined) return null;
    const metadata = this.metadata(key, raw);
    return { ...metadata, ...(this.mode === 'get-size' ? { size: metadata.size + 1 } : {}),
      body: this.mode === 'get-stream-throw' ? new ReadableStream<Uint8Array>({ start(c) { c.error(new Error('Synthetic body error')); } }) : new Response(raw).body };
  }
  async put(key: string, raw: string, options: R2PutOptions) {
    this.calls.push(`put:${key}`);
    expect(options.onlyIf).toBeInstanceOf(Headers);
    expect((options.onlyIf as Headers).get('If-None-Match')).toBe('*');
    if (this.mode === 'put-throw') throw new Error('Synthetic unavailable write');
    if (this.mode === 'put-undefined') return undefined;
    if (this.objects.has(key)) return null;
    this.objects.set(key, raw);
    if (this.mode === 'put-ambiguous') throw new Error('Synthetic acknowledgement lost');
    return this.mode === 'put-metadata' ? { ...this.metadata(key, raw), size: -1 } : this.metadata(key, raw);
  }
}
const enrichmentInput = () => ({
  sample: { pieces: [{ ...piece('sample'), tags: { theme: ['Original'] }, locale: 'fr-CA' }] },
  labels: [{ id: 'label-1', pieceId: 'sample', dimension: 'Thème', value: 'Été' }],
  provenance: { source: 'https://synthetic.invalid/sample', model: 'caller-declared-model' },
});
async function enrichmentFixture(mode: 'open' | 'enforced' = 'enforced') {
  const env = mkEnv(), storage = new EnrichmentR2(), accounts = memoryStore();
  env.AUTH_MODE = mode; env.STORAGE = storage as unknown as R2Bucket; env.ACCOUNTS = accounts;
  env.TENANTS = JSON.stringify({ provisioned: ['atelier-a', 'atelier-b'], operatorGrants: {
    'service-a': ['atelier-a'], 'human-a': ['atelier-a'], 'service-b': ['atelier-b'], 'human-b': ['atelier-b'],
  } });
  const credentials: Record<string, string> = {};
  for (const suffix of ['a', 'b']) {
    const id = `human-${suffix}`, sid = `session-${suffix}`;
    await accounts.put({ id, email: `${id}@example.invalid`, name: 'Synthetic Reviewer', roles: ['operator'], permissions: ['read'], disabled: false, must_change_password: false });
    await accounts.putSession({ jti: sid, accountId: id, tokenHash: 'synthetic-session-hash', createdAt: Date.now(), expiresAt: Date.now() + 300000 });
    credentials[id] = await token({ sub: id, type: 'access', sid, roles: ['admin'] });
    credentials[`service-${suffix}`] = await token({ sub: `service-${suffix}`, type: 'service', roles: ['admin'] });
  }
  const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>();
  app.use('*', tenantMiddleware()); app.route('/content', contentRoutes);
  const call = (path = '', method = 'GET', body?: unknown, bearer = credentials['service-a']!, tenant = 'atelier-a') =>
    app.request(`${H}/content/catalog/enrichment/proposals${path}`, { method,
      headers: { 'Content-Type': 'application/json', 'X-Tenant': tenant, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }, env);
  const capture = async (input: unknown = enrichmentInput()) => {
    const response = await call('', 'POST', input); expect(response.status).toBe(201);
    return (await response.json() as { proposal: EnrichmentProposal }).proposal;
  };
  return { env, app, storage, accounts, credentials, call, capture };
}

describe('W14.03 supplied enrichment and terminal human review', () => {
  it('preserves a 500-piece/4000-label sample and exports only individually approved/edited tag additions', async () => {
    const f = await enrichmentFixture(), input = enrichmentInput();
    const sample = { version: 'caller-snapshot-unverified', metadata: { locale: 'fr-CA', custom: [false, null, { keep: 'yes' }] },
      pieces: Array.from({ length: 500 }, (_, i) => ({ ...piece(`asset-${i}`), tags: { theme: ['Original'] },
        subtitle: '', art: null, locale: 'fr-CA', lifecycle: { status: 'draft', note: 'preserve' },
        window: { from: '2027-01-01T00:00:00Z', to: '2028-01-01T00:00:00Z', extra: 'preserve' },
        journeyStageFit: ['early', 'early'], featuredProductIds: [' SKU ', ' SKU '], inStock: false,
        eligibility: { markets: ['CA'] }, unknownMetadata: { custom: ['retain', 1] } })) };
    const labels = Array.from({ length: 4000 }, (_, i) => ({ id: `label-${i}`, pieceId: `asset-${Math.floor(i / 8)}`, dimension: `主题 ${i % 8}`, value: `Été ${i}` }));
    const remote = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected provider call'));
    try {
      const proposal = await f.capture({ ...input, sample, labels });
      expect(proposal.sample).toEqual(sample); expect(proposal.labels).toEqual(labels);
      expect(proposal).toMatchObject({ tenant: 'atelier-a', createdBy: 'service-a', createdWith: 'service', provenance: { declared: input.provenance, verified: false } });
      expect(proposal.digest).toMatch(/^[0-9a-f]{64}$/); expect(Number.isFinite(Date.parse(proposal.createdAt))).toBe(true);
      expect(await (await f.call(`/${proposal.id}`)).json()).toMatchObject({ status: 'pending', published: false, review: null, proposal });
      expect((await f.call(`/${proposal.id}/export`)).status).toBe(409);
      const dispositions = labels.map((label, i) => i === 1
        ? { labelId: label.id, action: 'edit', dimension: 'Collection personnelle', value: 'Approuvé' }
        : { labelId: label.id, action: i === 0 ? 'approve' : 'reject' });
      const reviewBody = { proposalDigest: proposal.digest, dispositions };
      for (const action of [['reject'], {}, null, true, 1]) {
        expect((await f.call(`/${proposal.id}/review`, 'POST', { ...reviewBody, dispositions: dispositions.map((d, i) => i === 0 ? { ...d, action } : d) }, f.credentials['human-a'])).status).toBe(422);
      }
      expect((await f.call(`/${proposal.id}/review`, 'POST', { ...reviewBody,
        dispositions: dispositions.map((d, i) => i === 1 ? { labelId: 'label-0', action: 'reject' } : d) }, f.credentials['human-a'])).status).toBe(422);
      const response = await f.call(`/${proposal.id}/review`, 'POST', reviewBody, f.credentials['human-a']);
      expect(response.status).toBe(201); expect(response.headers.get('Cache-Control')).toBe('no-store');
      const { review } = await response.json() as { review: EnrichmentReview };
      expect(review).toMatchObject({ reviewedBy: 'human-a', reviewerType: 'access', proposalDigest: proposal.digest, dispositions });
      const exported = await (await f.call(`/${proposal.id}/export`)).json() as { schema: string; published: boolean; proposal: EnrichmentProposal; review: EnrichmentReview; additions: unknown[] };
      expect(exported).toEqual({ schema: 'content-enrichment-tag-additions/v1', published: false, proposal, review, additions: [
        { labelId: 'label-0', pieceId: 'asset-0', customerContentId: 'CMP-asset-0', dimension: '主题 0', value: 'Été 0', reviewDigest: review.digest },
        { labelId: 'label-1', pieceId: 'asset-0', customerContentId: 'CMP-asset-0', dimension: 'Collection personnelle', value: 'Approuvé', reviewDigest: review.digest },
      ] });
      expect(f.storage.objects.size).toBe(2);
      expect((f.env.CACHE as unknown as FakeKV).calls).toEqual([]); expect(remote).not.toHaveBeenCalled();
    } finally { remote.mockRestore(); }
  });

  it('conditional creates preserve the first terminal review and fail closed on missing, corrupt and ambiguous storage', async () => {
    const f = await enrichmentFixture(), proposal = await f.capture();
    const proposalKey = `content-enrichment/v1/atelier-a/${proposal.id}/proposal.json`, reviewKey = proposalKey.replace('proposal.json', 'review.json');
    const body = (action = 'approve') => ({ proposalDigest: proposal.digest, dispositions: [{ labelId: 'label-1', action }] });
    const original = f.storage.objects.get(proposalKey)!;
    expect((await f.call('/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await f.call('/invalid-id')).status).toBe(400);
    for (const bad of [null, {}, { ...proposal, tenant: 'atelier-b' }, { ...proposal, id: '00000000-0000-4000-8000-000000000000' },
      { ...proposal, createdWith: ['service'] }, { ...proposal, sample: { ...proposal.sample, altered: true } }]) {
      f.storage.objects.set(proposalKey, JSON.stringify(bad));
      expect((await f.call(`/${proposal.id}`)).status).toBe(503);
      expect((await f.call(`/${proposal.id}/review`, 'POST', body(), f.credentials['human-a'])).status).toBe(503);
    }
    f.storage.objects.set(proposalKey, original);
    for (const mode of ['get-throw', 'get-review-throw', 'get-undefined', 'get-size', 'get-stream-throw']) {
      f.storage.mode = mode; expect((await f.call(`/${proposal.id}`)).status).toBe(503);
    }
    f.storage.mode = '';
    Object.defineProperty(f.env, 'STORAGE', { configurable: true, get() { throw new Error('Synthetic missing binding'); } });
    expect((await f.call(`/${proposal.id}`)).status).toBe(503);
    expect((await f.call('', 'POST', enrichmentInput())).status).toBe(503);
    Object.defineProperty(f.env, 'STORAGE', { configurable: true, value: f.storage });
    for (const invalid of [ { ...body(), proposalDigest: '0'.repeat(64) }, { ...body(), dispositions: [] },
      { ...body(), dispositions: [{ labelId: 'unknown', action: 'approve' }] },
      { ...body(), dispositions: [{ labelId: 'label-1', action: 'edit', value: 'missing-dimension' }] }, { ...body(), reviewedBy: 'caller-cannot-attest' } ]) {
      expect([409, 422]).toContain((await f.call(`/${proposal.id}/review`, 'POST', invalid, f.credentials['human-a'])).status);
    }
    for (const mode of ['put-throw', 'put-undefined']) {
      f.storage.mode = mode; expect((await f.call(`/${proposal.id}/review`, 'POST', body(), f.credentials['human-a'])).status).toBe(503);
      expect(f.storage.objects.has(reviewKey)).toBe(false);
    }
    f.storage.mode = '';
    const competing = await Promise.all(['approve', 'reject'].map(action => f.call(`/${proposal.id}/review`, 'POST', body(action), f.credentials['human-a'])));
    expect(competing.map(r => r.status).sort()).toEqual([201, 409]);
    const terminal = f.storage.objects.get(reviewKey)!;
    expect((await f.call(`/${proposal.id}/review`, 'POST', body('edit'), f.credentials['human-a'])).status).toBe(422);
    expect((await f.call(`/${proposal.id}/review`, 'POST', body(), f.credentials['human-a'])).status).toBe(409);
    expect(f.storage.objects.get(reviewKey)).toBe(terminal); expect(f.storage.objects.get(proposalKey)).toBe(original);
    expect(await (await f.call(`/${proposal.id}`)).json()).toMatchObject({ status: 'reviewed', review: JSON.parse(terminal) });
    for (const bad of ['null', '{', JSON.stringify({ ...JSON.parse(terminal), proposalDigest: '0'.repeat(64) }),
      JSON.stringify({ ...JSON.parse(terminal), dispositions: [{ labelId: 'label-1', action: 'reject' }], digest: '0'.repeat(64) })]) {
      f.storage.objects.set(reviewKey, bad); expect((await f.call(`/${proposal.id}`)).status).toBe(503);
      expect((await f.call(`/${proposal.id}/export`)).status).toBe(503);
    }
    f.storage.objects.set(reviewKey, terminal);
    for (const mode of ['put-ambiguous', 'put-metadata']) {
      f.storage.mode = mode;
      const failed = await f.call('', 'POST', enrichmentInput()); expect(failed.status).toBe(503);
      const recovery = await failed.json() as { error: string; proposalId: string };
      expect(Object.keys(recovery).sort()).toEqual(['error', 'proposalId']); expect(recovery.proposalId).toMatch(/^[0-9a-f-]{36}$/);
      f.storage.mode = ''; expect(await (await f.call(`/${recovery.proposalId}`)).json()).toMatchObject({ status: 'pending', review: null });
      const recovered = await (await f.call(`/${recovery.proposalId}`)).json() as { proposal: EnrichmentProposal };
      f.storage.mode = 'put-ambiguous';
      expect((await f.call(`/${recovery.proposalId}/review`, 'POST', { proposalDigest: recovered.proposal.digest, dispositions: [{ labelId: 'label-1', action: 'reject' }] }, f.credentials['human-a'])).status).toBe(503);
      f.storage.mode = ''; expect(await (await f.call(`/${recovery.proposalId}/export`)).json()).toMatchObject({ published: false, additions: [] });
    }
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(proposal.id as `${string}-${string}-${string}-${string}-${string}`);
    try { expect((await f.call('', 'POST', enrichmentInput())).status).toBe(409); expect(f.storage.objects.get(proposalKey)).toBe(original); }
    finally { uuid.mockRestore(); }
    expect((f.env.CACHE as unknown as FakeKV).calls).toEqual([]);
  });

  it('uses actual JWT/session and tenant middleware in both modes, rejects selectors and enforces actual byte/count bounds', async () => {
    for (const mode of ['open', 'enforced'] as const) {
      const f = await enrichmentFixture(mode), proposal = await f.capture(), body = { proposalDigest: proposal.digest, dispositions: [{ labelId: 'label-1', action: 'approve' }] };
      const b = await f.call('', 'POST', enrichmentInput(), f.credentials['service-b'], 'atelier-b'); expect(b.status).toBe(201);
      const other = (await b.json() as { proposal: EnrichmentProposal }).proposal;
      expect((await f.call(`/${proposal.id}`, 'GET', undefined, f.credentials['service-b'], 'atelier-b')).status).toBe(404);
      expect((await f.call(`/${other.id}`, 'GET', undefined, f.credentials['service-a'], 'atelier-a')).status).toBe(404);
      const before = f.storage.calls.length;
      for (const credential of ['', 'bad-token', await token({ sub: 'service-a' }), await token({ sub: 'service-a', type: 'refresh' }),
        await token({ sub: 'ungranted', type: 'service', roles: ['admin'] }), await token({ sub: 'human-a', type: 'access', sid: 'missing' })]) {
        expect([401, 403]).toContain((await f.call('', 'POST', '{', credential)).status);
      }
      for (const suffix of ['?tenant=atelier-b', '?scope=atelier-b', '?scope=atelier-a&scope=atelier-a', '?tenant=atelier-a&tenant=atelier-a']) {
        expect((await f.call(suffix, 'POST', '{')).status).toBe(403);
      }
      expect((await f.call('', 'POST', '{', f.credentials['service-a'], 'atelier-b')).status).toBe(403);
      expect((await f.call('', 'POST', '{', f.credentials['service-a'], 'atelier-a,atelier-b')).status).toBe(403);
      expect((await f.call(`/${proposal.id}/review`, 'POST', '{', f.credentials['service-a'])).status).toBe(403);
      const human = f.accounts.users.get('human-a')!;
      f.accounts.users.set('human-a', { ...human, roles: ['viewer'] as unknown as typeof human.roles });
      expect((await f.call(`/${proposal.id}/review`, 'POST', body, f.credentials['human-a'])).status).toBe(403);
      f.accounts.users.set('human-a', { ...human, disabled: true });
      expect((await f.call(`/${proposal.id}/review`, 'POST', body, f.credentials['human-a'])).status).toBe(401);
      f.accounts.users.set('human-a', { ...human, must_change_password: true });
      expect((await f.call(`/${proposal.id}/review`, 'POST', body, f.credentials['human-a'])).status).toBe(403);
      f.accounts.users.set('human-a', human); f.accounts.sessions.delete('session-a');
      expect((await f.call(`/${proposal.id}/review`, 'POST', body, f.credentials['human-a'])).status).toBe(401);
      expect(f.storage.calls.length).toBe(before);
      expect((await f.call(`/${other.id}/review`, 'POST', { proposalDigest: other.digest, dispositions: [{ labelId: 'label-1', action: 'approve' }] }, f.credentials['human-b'], 'atelier-b')).status).toBe(201);
      expect((await f.call(`/${other.id}/export`, 'GET', undefined, f.credentials['service-a'], 'atelier-b')).status).toBe(403);
      expect((await f.call(`/${other.id}/export`, 'GET', undefined, f.credentials['service-b'], 'atelier-b')).status).toBe(200);
      const input = enrichmentInput(), beforeInvalid = f.storage.objects.size;
      for (const bad of [{ ...input, tenant: 'atelier-b' }, { ...input, sample: { pieces: Array.from({ length: 501 }, (_, i) => piece(`p-${i}`)) } },
        { ...input, labels: Array.from({ length: 4001 }, (_, i) => ({ ...input.labels[0], id: `l-${i}` })) },
        { ...input, labels: [input.labels[0], input.labels[0]] }, { ...input, labels: [{ ...input.labels[0], pieceId: 'unknown' }] },
        { ...input, labels: [{ ...input.labels[0], dimension: '__proto__' }] },
        { ...input, labels: [{ ...input.labels[0], value: 'x'.repeat(257) }] },
        JSON.stringify(input).replace('"locale":"fr-CA"', '"__proto__":{"polluted":true}'),
        { ...input, sample: { ...input.sample, deep: Array.from({ length: 20 }).reduce<unknown>(v => ({ nested: v }), null) } }]) {
        expect((await f.call('', 'POST', bad)).status).toBe(422);
      }
      expect((await f.call('', 'POST', '{')).status).toBe(400);
      const large = JSON.stringify({ ...input, sample: { ...input.sample, padding: 'é'.repeat(ENRICHMENT_MAX_BYTES / 2) } });
      expect(large.length).toBeLessThan(ENRICHMENT_MAX_BYTES);
      const raw = new TextEncoder().encode(large);
      const streamed = new Request(`${H}/content/catalog/enrichment/proposals`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '1', 'X-Tenant': 'atelier-a', Authorization: `Bearer ${f.credentials['service-a']}` },
        body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(raw.subarray(0, 100)); c.enqueue(raw.subarray(100)); c.close(); } }),
        duplex: 'half' } as RequestInit);
      expect((await f.app.fetch(streamed, f.env)).status).toBe(413);
      const empty = JSON.stringify({ ...input, sample: { ...input.sample, padding: '' } });
      const near = empty.replace('"padding":""', `"padding":"${'x'.repeat(ENRICHMENT_MAX_BYTES - new TextEncoder().encode(empty).byteLength)}"`);
      expect(new TextEncoder().encode(near).byteLength).toBe(ENRICHMENT_MAX_BYTES);
      expect((await f.call('', 'POST', near)).status).toBe(413); // Stored server envelope also has its own byte bound.
      expect(f.storage.objects.size).toBe(beforeInvalid); expect((f.env.CACHE as unknown as FakeKV).calls).toEqual([]);
    }
  });
});

// The accepted W11 native-store checks remain unchanged. This exercises the new
// integration with the same conditional route fixture and actual human sessions.
async function enrichmentPublicationFixture(mode: 'open' | 'enforced' = 'enforced', initialize = true, imageUrl?: string) {
  const f = await enrichmentFixture(mode), storage = new CatalogR2(); f.env.STORAGE = storage as unknown as R2Bucket;
  const catalog: ContentCatalog = { version: 'synthetic-catalog', pieces: [
    { ...piece('competitor'), tags: { occasion: ['weekend'] }, lifecycle: { status: 'live' } },
    { ...piece('sample'), tags: { theme: ['Original'] }, lifecycle: { status: 'live' },
      subtitle: 'Subtitle', art: null, renderUrl: imageUrl ?? '/sample', excerpt: 'Retain', runtime: '2 min',
      window: { from: '2026-01-01T00:00:00Z', to: '2028-01-01T00:00:00Z' },
      merchandising: { margin: 0.2 }, journeyStageFit: ['considering'], freshnessDate: '2026-09-01T00:00:00Z',
      featuredProductIds: ['SKU-1', 'SKU-2'], inStock: true },
    { ...piece('draft'), tags: {}, lifecycle: { status: 'draft' } },
    { ...piece('stock'), tags: { occasion: ['evening'] }, lifecycle: { status: 'live' }, inStock: false },
  ] };
  if (initialize) for (const scope of ['atelier-a', 'atelier-b']) await initializeCatalog(f.env, scope, catalog);
  const headers = (who = 'human-a', tenant = 'atelier-a') => ({ 'Content-Type': 'application/json', 'X-Tenant': tenant, Authorization: `Bearer ${f.credentials[who]}` });
  const route = (path: string, method = 'GET', body?: unknown, h: Record<string, string> = headers()) => f.app.request(`${H}/content/catalog${path}`, {
    method, headers: h, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }, f.env);
  const reviewed = async (sample: unknown = catalog, labels = [{ id: 'label-1', pieceId: 'sample', dimension: 'occasion', value: 'evening' }], dispositions?: EnrichmentReview['dispositions']) => {
    const proposal = await f.capture({ sample, labels, provenance: { source: 'synthetic supplied sample' } });
    const response = await f.call(`/${proposal.id}/review`, 'POST', { proposalDigest: proposal.digest,
      dispositions: dispositions ?? labels.map(label => ({ labelId: label.id, action: 'approve' })) }, f.credentials['human-a']);
    expect(response.status).toBe(201);
    const { review } = await response.json() as { review: EnrichmentReview };
    return { proposal, review, body: { proposalDigest: proposal.digest, reviewDigest: review.digest } };
  };
  const current = () => readPublication(f.env, CONTENT_KIND, 'atelier-a');
  return { ...f, storage, catalog, headers, route, reviewed, current };
}

describe('W14.04 explicit human-approved enrichment publication', () => {
  it('W19.03 reports the published enrichment catalog without changing human approval', async () => {
    const f = await enrichmentPublicationFixture(), kv = f.env.CACHE as unknown as FakeKV;
    seedLegacy(f.env, 'reflex:config:atelier-a:current', JSON.stringify({ revision: 3,
      value: { ...DEFAULT_REFLEX_CONFIG, version: 'atelier-registry', weights: {}, dimensions: [{ key: 'occasion', source: 'occasion' }] } }));
    const evidence = await f.reviewed(f.catalog, [
      { id: 'approved', pieceId: 'sample', dimension: 'unknown-approved', value: 'secret' },
      { id: 'rejected', pieceId: 'sample', dimension: 'occasion', value: 'evening' },
    ], [{ labelId: 'approved', action: 'approve' }, { labelId: 'rejected', action: 'reject' }]);
    const path = `/enrichment/proposals/${evidence.proposal.id}/publish`, headers = publicationHeaders(f.env, f.headers());
    const before = [f.storage.puts, kv.calls.length];
    expect((await f.route(path, 'POST', evidence.body, publicationHeaders(f.env, f.headers('service-a')))).status).toBe(403);
    expect([f.storage.puts, kv.calls.length]).toEqual(before);
    const response = await f.route(path, 'POST', evidence.body, headers); expect(response.status).toBe(200);
    const result = await response.json() as { document: ContentCatalog; diagnostics: CatalogDiagnostics };
    expect(result).toMatchObject({ revision: 2, actor: 'human-a', diagnostics: { status: 'available', catalogRevision: 2,
      registry: { scope: 'atelier-a', revision: 3, version: 'atelier-registry' }, warningCount: 4 } });
    expect(result.document.pieces[1]!.tags).toEqual({ theme: ['Original'], 'unknown-approved': ['secret'] });
    expect(result.diagnostics.warnings).toContainEqual({ code: 'unknown_dimension', pieceIndex: 1, dimensionIndex: 1, dimension: 'unknown-approved', dimensionTruncated: false });
    expect((await f.current()).value).toEqual(result.document);
    const puts = f.storage.puts;
    const get = f.storage.get.bind(f.storage);
    const outage = vi.spyOn(f.storage, 'get').mockImplementation(async key => { if (key.includes('/reflex/rev/')) throw new Error('private registry failure'); return get(key); });
    try {
      const retry = await f.route(path, 'POST', evidence.body, headers); expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ revision: 2, actor: 'human-a', document: result.document,
        diagnostics: { status: 'unavailable', warningCount: null, omittedWarningCount: null, warnings: null } });
      expect(f.storage.puts).toBe(puts);
    } finally { outage.mockRestore(); }
    expect([...f.storage.objects.values()].some(raw => raw.includes('catalog-registry-diagnostics'))).toBe(false);
  });

  it('publishes only approved additions, preserves current metadata and makes the deterministic selection explain the new tag', async () => {
    const f = await enrichmentPublicationFixture(), before = await f.current();
    const labels = [
      { id: 'approved', pieceId: 'sample', dimension: 'occasion', value: 'evening' },
      { id: 'edited', pieceId: 'sample', dimension: 'wrong', value: 'wrong' },
      { id: 'rejected', pieceId: 'sample', dimension: 'rejected', value: 'never' },
      { id: 'duplicate', pieceId: 'sample', dimension: 'occasion', value: 'evening' },
      { id: 'existing', pieceId: 'sample', dimension: 'theme', value: 'Original' },
      { id: 'inherited', pieceId: 'sample', dimension: 'toString', value: 'Été' },
      { id: 'draft', pieceId: 'draft', dimension: 'occasion', value: 'evening' },
    ];
    const evidence = await f.reviewed(before.value, labels, labels.map(label => label.id === 'edited'
      ? { labelId: label.id, action: 'edit', dimension: 'Thème', value: 'Approuvé' }
      : { labelId: label.id, action: label.id === 'rejected' ? 'reject' : 'approve' }));
    const unrelated = structuredClone(before.value); unrelated.pieces[0]!.title = 'Latest unrelated title';
    expect((await f.route('', 'PUT', { document: unrelated }, publicationHeaders(f.env, f.headers()))).status).toBe(200);
    const base = await f.current(), requestHeaders = publicationHeaders(f.env, f.headers(), 2);
    const decide = (catalog: ContentCatalog) => decideContent({
      tenant: 'atelier-a', brand: 'atelier-a', page: 'home', visitorId: 'synthetic-visitor', sessionId: null,
      identityAnchor: 'visitor', nowMs: Date.parse('2027-01-01T00:00:00Z'), pieces: catalog.pieces,
      slots: [{ slot: 'story', take: 1, weights: { occasion: 1 } }],
      affinity: { dims: { occasion: { weekend: 0.3, evening: 0.9 } } },
      cell: { channel: 'direct', visit_bucket: '1', region: 'CA', affinity: 'occasion:evening' }, arm: 'personalized',
      versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'synthetic-registry',
    } satisfies DecideInput);
    expect(decide(base.value).records[0]).toMatchObject({ item_id: 'competitor', explain: { score_base: 0.3 } });
    const remote = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected enrichment egress'));
    try {
      const response = await f.route(`/enrichment/proposals/${evidence.proposal.id}/publish`, 'POST', evidence.body, requestHeaders);
      expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
      const receipt = await response.json() as { revision: number; note: string; document: ContentCatalog };
      expect(receipt).toMatchObject({ ok: true, schema: 'content-enrichment-publication/v1', proposalId: evidence.proposal.id,
        ...evidence.body, operationId: requestHeaders['Idempotency-Key'], revision: 3, actor: 'human-a', at: expect.any(Number) });
      expect(JSON.parse(receipt.note)).toEqual({ type: 'enrichment', proposalId: evidence.proposal.id, ...evidence.body });
      const expected = structuredClone(base.value); expected.version = 'synthetic-catalog+r3';
      expected.pieces[1]!.tags = { ...expected.pieces[1]!.tags, occasion: ['evening'], 'Thème': ['Approuvé'], toString: ['Été'] };
      expected.pieces[2]!.tags = { occasion: ['evening'] };
      expect(receipt.document).toEqual(expected); expect((await f.current()).value).toEqual(expected);
      const decision = decide((await f.current()).value);
      expect(decision.records[0]).toMatchObject({ item_id: 'sample', explain: { score_base: 0.9, score_final: 0.9,
        drivers: [{ dim: 'occasion', value: 'evening', a: 0.9, weight: 1 }] } });
      expect(decision.records[0]!.candidates.map(candidate => candidate.contentId)).toEqual(['sample', 'competitor']);
      expect(decide(receipt.document)).toEqual(decision); expect(remote).not.toHaveBeenCalled();
      const proposalKey = `content-enrichment/v1/atelier-a/${evidence.proposal.id}/proposal.json`;
      expect(JSON.parse(f.storage.objects.get(proposalKey)!)).toEqual(evidence.proposal);
      expect(await (await f.call(`/${evidence.proposal.id}`)).json()).toMatchObject({ published: false, review: evidence.review });
      expect(await (await f.call(`/${evidence.proposal.id}/export`)).json()).toMatchObject({ published: false });
      expect(f.storage.objects.size).toBe(22); // Two six-kind initialized sets, two evidence objects and two new immutable documents/sets.
    } finally { remote.mockRestore(); }
  });

  it('refuses evidence, raw sample, identity and no-change conflicts without catalog writes', async () => {
    const f = await enrichmentPublicationFixture(), valid = await f.reviewed();
    const reject = async (id: string, body: unknown, status: number) => {
      const state = JSON.stringify([...f.storage.objects]), puts = f.storage.puts;
      const response = await f.route(`/enrichment/proposals/${id}/publish`, 'POST', body, publicationHeaders(f.env, f.headers()));
      expect(response.status).toBe(status); expect(f.storage.puts).toBe(puts); expect(JSON.stringify([...f.storage.objects])).toBe(state);
    };
    for (const body of [{ ...valid.body, proposalDigest: '0'.repeat(64) }, { ...valid.body, reviewDigest: '0'.repeat(64) }]) await reject(valid.proposal.id, body, 409);
    for (const body of [null, [], {}, { ...valid.body, note: 'caller' }, { ...valid.body, document: f.catalog },
      { ...valid.body, reviewDigest: 'X'.repeat(64) }]) await reject(valid.proposal.id, body, 422);
    await reject('00000000-0000-4000-8000-000000000000', valid.body, 404);
    const pending = await f.capture({ sample: f.catalog, labels: [{ id: 'l', pieceId: 'sample', dimension: 'occasion', value: 'evening' }], provenance: { source: 'synthetic' } });
    await reject(pending.id, { proposalDigest: pending.digest, reviewDigest: valid.review.digest }, 409);
    const rejected = await f.reviewed(f.catalog, undefined, [{ labelId: 'label-1', action: 'reject' }]); await reject(rejected.proposal.id, rejected.body, 409);
    const noop = await f.reviewed(f.catalog, [{ id: 'existing', pieceId: 'sample', dimension: 'theme', value: 'Original' }]); await reject(noop.proposal.id, noop.body, 409);
    for (const mutate of [
      (p: Record<string, unknown>) => { p.customerContentId = 'replaced'; },
      (p: Record<string, unknown>) => { p.title = 'Changed'; },
      (p: Record<string, unknown>) => { p.lifecycle = { status: 'draft' }; },
      (p: Record<string, unknown>) => { delete p.lifecycle; },
      (p: Record<string, unknown>) => { p.window = { from: '2026-02-01T00:00:00Z', to: '2028-01-01T00:00:00Z' }; },
      (p: Record<string, unknown>) => { p.featuredProductIds = ['SKU-2', 'SKU-1']; },
      (p: Record<string, unknown>) => { p.unknownMetadata = { retain: true }; },
      (p: Record<string, unknown>) => { p.tags = { theme: ['Changed'] }; },
    ]) {
      const sample = structuredClone(f.catalog); mutate(sample.pieces[1] as unknown as Record<string, unknown>);
      const drift = await f.reviewed(sample); await reject(drift.proposal.id, drift.body, 409);
    }
    const missing = structuredClone(f.catalog); missing.pieces[1]!.id = 'absent';
    const absent = await f.reviewed(missing, [{ id: 'missing', pieceId: 'absent', dimension: 'occasion', value: 'evening' }]); await reject(absent.proposal.id, absent.body, 409);
    for (const kind of ['proposal', 'review']) {
      const key = `content-enrichment/v1/atelier-a/${valid.proposal.id}/${kind}.json`, original = f.storage.objects.get(key)!;
      f.storage.objects.set(key, JSON.stringify({ ...JSON.parse(original), digest: '0'.repeat(64) }));
      await reject(valid.proposal.id, valid.body, 503); f.storage.objects.set(key, original);
    }
    const head = 'config-publication/v2/atelier-a/head.json', original = f.storage.objects.get(head)!;
    f.storage.objects.set(head, '{}'); await reject(valid.proposal.id, valid.body, 503); f.storage.objects.set(head, original);
    const fresh = await enrichmentPublicationFixture('enforced', false), freshEvidence = await fresh.reviewed();
    const freshState = JSON.stringify([...fresh.storage.objects]), freshPuts = fresh.storage.puts;
    const unavailable = await fresh.route(`/enrichment/proposals/${freshEvidence.proposal.id}/publish`, 'POST', freshEvidence.body, publicationHeaders(fresh.env, fresh.headers()));
    expect(unavailable.status).toBe(503); expect(await unavailable.json()).toMatchObject({ code: 'publication_uninitialized' });
    expect(fresh.storage.puts).toBe(freshPuts); expect(JSON.stringify([...fresh.storage.objects])).toBe(freshState);
  });

  it('enforces current humans in both tenants/modes and retains one original receipt through races, retries and recovery', async () => {
    for (const mode of ['open', 'enforced'] as const) {
      const f = await enrichmentPublicationFixture(mode), evidence = await f.reviewed();
      const path = `/enrichment/proposals/${evidence.proposal.id}/publish`, before = JSON.stringify([...f.storage.objects]);
      let bodyReads = 0, storageReads = 0;
      const reader = vi.spyOn(ReadableStream.prototype, 'getReader');
      Object.defineProperty(f.env, 'STORAGE', { configurable: true, get() { storageReads++; return f.storage; } });
      try {
        const baseline = reader.mock.calls.length;
        for (const credential of ['', 'bad', await token({ sub: 'service-a' }), await token({ sub: 'service-a', type: 'refresh' }),
          f.credentials['service-a']!, await token({ sub: 'human-a', type: 'access', sid: 'missing' })]) {
          const h = { ...publicationHeaders(f.env, f.headers()), Authorization: `Bearer ${credential}` };
          expect([401, 403]).toContain((await f.route(path, 'POST', '{', h)).status);
        }
        for (const suffix of ['?scope=atelier-b', '?tenant=atelier-b', '?scope=atelier-a&scope=atelier-a']) {
          expect((await f.route(path + suffix, 'POST', '{', publicationHeaders(f.env, f.headers()))).status).toBe(403);
        }
        expect((await f.route(path, 'POST', '{', publicationHeaders(f.env, f.headers('human-a', 'atelier-b')))).status).toBe(403);
        const human = f.accounts.users.get('human-a')!;
        for (const changed of [{ ...human, roles: ['viewer'] as unknown as typeof human.roles }, { ...human, disabled: true }, { ...human, must_change_password: true }]) {
          f.accounts.users.set('human-a', changed); expect([401, 403]).toContain((await f.route(path, 'POST', '{', publicationHeaders(f.env, f.headers()))).status);
        }
        f.accounts.users.set('human-a', human);
        const session = f.accounts.sessions.get('session-a')!; f.accounts.sessions.delete('session-a');
        expect((await f.route(path, 'POST', '{', publicationHeaders(f.env, f.headers()))).status).toBe(401); f.accounts.sessions.set('session-a', session);
        expect((await f.route(path, 'POST', '{', f.headers())).status).toBe(428);
        expect((await f.route(path, 'POST', '{', { ...publicationHeaders(f.env, f.headers()), 'If-Match': '1' })).status).toBe(400);
        expect((await f.route(path, 'POST', '{', publicationHeaders(f.env, f.headers(), 1, `2:${crypto.randomUUID()}`))).status).toBe(409);
        bodyReads = reader.mock.calls.length - baseline;
      } finally { reader.mockRestore(); }
      expect(bodyReads).toBe(0); expect(storageReads).toBe(0); expect(JSON.stringify([...f.storage.objects])).toBe(before);
      expect((await f.route(path, 'POST', evidence.body, publicationHeaders(f.env, f.headers('human-b', 'atelier-b')))).status).toBe(404);
      const otherBefore = JSON.stringify([...f.storage.objects].filter(([key]) => key.includes('/atelier-b/')));
      const operation = publicationHeaders(f.env, f.headers()), replacement = { document: { ...f.catalog, version: 'competing', pieces: f.catalog.pieces } };
      const race = await Promise.all([f.route(path, 'POST', evidence.body, operation), f.route('', 'PUT', replacement, publicationHeaders(f.env, f.headers('service-a')))]);
      expect(race.map(response => response.status).sort()).toEqual([200, 409]);
      const next = await f.current(); expect(next.revision).toBe(2);
      const successHeaders = race[0].status === 200 ? operation : publicationHeaders(f.env, f.headers(), 2);
      const success = await f.route(path, 'POST', evidence.body, successHeaders); expect(success.status).toBe(200);
      const receipt = await success.json();
      expect(await (await f.route(path, 'POST', evidence.body, successHeaders)).json()).toEqual(receipt);
      expect((await f.route(path, 'POST', evidence.body, publicationHeaders(f.env, f.headers(), 1))).status).toBe(409);
      const now = await f.current();
      expect((await f.route('', 'PUT', { document: now.value }, publicationHeaders(f.env, f.headers(), now.revision))).status).toBe(200);
      expect(await (await f.route(path, 'POST', evidence.body, successHeaders)).json()).toEqual(receipt);
      // Another currently authorized human cannot replay as the original actor.
      f.env.TENANTS = JSON.stringify({ provisioned: ['atelier-a', 'atelier-b'], operatorGrants: {
        'service-a': ['atelier-a'], 'human-a': ['atelier-a'], 'service-b': ['atelier-b'], 'human-b': ['atelier-a', 'atelier-b'],
      } });
      expect((await f.route(path, 'POST', evidence.body, { ...successHeaders, Authorization: `Bearer ${f.credentials['human-b']}` })).status).toBe(409);
      const recoveryEvidence = await f.reviewed((await f.current()).value, [{ id: 'new', pieceId: 'sample', dimension: 'occasion', value: 'morning' }]);
      const recoveryHeaders = publicationHeaders(f.env, f.headers(), (await f.current()).revision), recoveryPath = `/enrichment/proposals/${recoveryEvidence.proposal.id}/publish`;
      f.storage.failPut = f.storage.puts + 2; f.storage.afterWrite = true;
      expect((await f.route(recoveryPath, 'POST', recoveryEvidence.body, recoveryHeaders)).status).toBe(503); f.storage.failPut = 0;
      expect(await (await f.route('/publication')).json()).toMatchObject({ state: 'pending', actor: 'human-a', operationId: recoveryHeaders['Idempotency-Key'] });
      const evidenceKey = `content-enrichment/v1/atelier-a/${recoveryEvidence.proposal.id}/proposal.json`, retainedEvidence = f.storage.objects.get(evidenceKey)!;
      f.storage.objects.delete(evidenceKey); // Generic recovery consumes already-reserved intent, not a new proposal read.
      expect((await f.route('/publication/recover', 'POST', undefined, { ...recoveryHeaders, Authorization: `Bearer ${f.credentials['service-a']}` })).status).toBe(200);
      f.storage.objects.set(evidenceKey, retainedEvidence);
      const recovered = await f.route(recoveryPath, 'POST', recoveryEvidence.body, recoveryHeaders); expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({ actor: 'human-a', operationId: recoveryHeaders['Idempotency-Key'], ...recoveryEvidence.body });
      expect((await f.current()).value.pieces[1]!.tags.occasion).toEqual(['evening', 'morning']);
      expect(JSON.stringify([...f.storage.objects].filter(([key]) => key.includes('/atelier-b/')))).toBe(otherBefore);
    }
  });
});

describe('W14.07 actual configured model generation and fresh review authority', () => {
  async function fixture(images = false) {
    const f=await enrichmentPublicationFixture('enforced', true, images ? 'https://media.invalid/sample.png' : undefined);
    const configuration={version:1 as const,enabled:true as const,provider:'google' as const,baseURL:'https://generativelanguage.googleapis.com/v1beta' as const,
      apiKeyRef:'CONNECTOR_SECRET_ENRICH',model:'fixture-model',approval:{egress:'local-fixture',metering:'local-fixture',providerRetention:'local-fixture'},
      timeoutMs:2000,requestBytes:65536,responseBytes:65536,maxOutputTokens:1024,fields:['excerpt','subtitle'] as Array<'excerpt'|'subtitle'>,
      taxonomy:[{dimension:'occasion',meaning:'The occasion explicitly supported by the sample.',values:[{value:'evening',meaning:'Evening use'}]}],
      ...(images ? {images:{field:'renderUrl',origins:['https://media.invalid/'],maxBytes:1024,maxImages:1}} : {})};
    f.env.TENANT_CONNECTORS=JSON.stringify({version:1,tenants:{'atelier-a':{enrichment:configuration}}});
    (f.env as unknown as Record<string,unknown>).CONNECTOR_SECRET_ENRICH='synthetic-key-no-provider';
    const {configuredDestinations,connectorDigest}=await import('@/connectors/config');
    const destinations=await configuredDestinations(f.env,'atelier-a',()=>undefined);
    f.env.RETENTION=JSON.stringify({version:1,tenants:{'atelier-a':Object.fromEntries(destinations.map(d=>[d.category,
      {id:'synthetic-model',revision:1,durationMs:60000,basis:'admitted',renewal:'new-record-only'}]))}});
    seedLegacy(f.env,'reflex:config:atelier-a:current',JSON.stringify({revision:2,value:{...DEFAULT_REFLEX_CONFIG,dimensions:[{key:'occasion',source:'occasion'}]}}));
    const input={catalogRevision:1,registryRevision:2,configurationDigest:await connectorDigest({purpose:'enrichment',tenant:'atelier-a',...configuration}),pieceIds:['sample']};
    return {...f,configuration,input};
  }
  const reply=(labels:unknown)=>Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify({labels})}]},finishReason:'STOP'}],
    usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}});
  it('executes the installed Google adapter, binds actual sample/copy/taxonomy and keeps generated proposals human-gated',async()=>{
    const f=await fixture(),calls:Array<{url:string;body:string;redirect:RequestInit['redirect']}>=[];
    const remote=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
      calls.push({url:String(input),body:String(init?.body),redirect:init?.redirect});
      return reply([{pieceId:'sample',dimension:'occasion',value:'evening'}]);
    });
    try{
      const response=await f.call('/generate','POST',f.input);expect(response.status,JSON.stringify({reply:await response.clone().json(),transportCalls:calls.length})).toBe(201);
      const result=await response.json() as {proposal:EnrichmentProposal;published:boolean;review:unknown};
      expect(result).toMatchObject({published:false,review:null,proposal:{provenance:{verified:true,invocation:{purpose:'enrichment',tenant:'atelier-a'}}}});
      expect(calls).toHaveLength(1);expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/fixture-model:generateContent');
      expect(calls[0]!.redirect).toBe('manual');expect(calls[0]!.body).toContain('Retain');expect(calls[0]!.body).toContain('Subtitle');
      expect(calls[0]!.body).not.toContain('renderUrl');expect(calls[0]!.body).not.toContain('competitor');
      expect((await f.call('/'+result.proposal.id+'/export')).status).toBe(409);
      const review=await f.call('/'+result.proposal.id+'/review','POST',{proposalDigest:result.proposal.digest,
        dispositions:result.proposal.labels.map(label=>({labelId:label.id,action:'approve'}))},f.credentials['human-a']);
      expect(review.status).toBe(201);expect((await f.current()).revision).toBe(1);
      for(const labels of [[{pieceId:'foreign',dimension:'occasion',value:'evening'}],[{pieceId:'sample',dimension:'occasion',value:'invented'}],
        [{pieceId:'sample',dimension:'occasion',value:'evening'},{pieceId:'sample',dimension:'occasion',value:'evening'}]]){
        remote.mockResolvedValue(reply(labels));expect((await f.call('/generate','POST',f.input)).status).toBe(503);
      }
      const count=remote.mock.calls.length;
      expect((await f.call('/generate','POST',{...f.input,pieceIds:['competitor']})).status).toBe(503);expect(remote).toHaveBeenCalledTimes(count);
      delete f.env.TENANT_CONNECTORS;expect((await f.call('/generate','POST',f.input)).status).toBe(503);expect(remote).toHaveBeenCalledTimes(count);
    }finally{remote.mockRestore();}
  });
  it('refuses revoked human review after a held proposal read without writing a receipt',async()=>{
    const f=await enrichmentFixture(),proposal=await f.capture();let release!:()=>void,entered!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),seen=new Promise<void>(resolve=>{entered=resolve;});
    const original=f.storage.get.bind(f.storage),get=vi.spyOn(f.storage,'get').mockImplementation(async key=>{
      const result=await original(key);if(key.endsWith('/proposal.json')){entered();await gate;}return result;
    });
    try{
      const pending=f.call('/'+proposal.id+'/review','POST',{proposalDigest:proposal.digest,dispositions:[{labelId:'label-1',action:'approve'}]},f.credentials['human-a']);
      await seen;f.accounts.sessions.delete('session-a');release();expect([401,403,503]).toContain((await pending).status);
      expect([...f.storage.objects.keys()].some(key=>key.endsWith('/review.json'))).toBe(false);
    }finally{release();get.mockRestore();}
  });
  it('prefetches only approved bounded image bytes and refuses image redirects before the model or proposal write',async()=>{
    const f=await fixture(true),image=new Uint8Array([137,80,78,71,13,10,26,10]),calls:string[]=[];
    const remote=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
      const url=String(input);calls.push(url);expect(init?.redirect).toBe('manual');
      if(url==='https://media.invalid/sample.png')return new Response(image,{headers:{'Content-Type':'image/png'}});
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/fixture-model:generateContent');
      expect(String(init?.body)).toContain('inlineData');expect(String(init?.body)).not.toContain('https://media.invalid');
      return reply([{pieceId:'sample',dimension:'occasion',value:'evening'}]);
    });
    try{
      expect((await f.call('/generate','POST',f.input)).status).toBe(201);expect(calls).toHaveLength(2);
      const stored=[...f.storage.objects],before=calls.length;let cancelled=false;
      remote.mockImplementation(async(input,init)=>{calls.push(String(input));expect(String(input)).toBe('https://media.invalid/sample.png');expect(init?.redirect).toBe('manual');
        return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:302,headers:{Location:'https://unapproved.invalid/image'}});});
      expect((await f.call('/generate','POST',f.input)).status).toBe(503);expect(calls).toHaveLength(before+1);expect(cancelled).toBe(true);expect([...f.storage.objects]).toEqual(stored);
      remote.mockResolvedValue(new Response(new Uint8Array(1025),{headers:{'Content-Type':'image/png','Content-Length':'1'}}));
      expect((await f.call('/generate','POST',f.input)).status).toBe(503);expect([...f.storage.objects]).toEqual(stored);
    }finally{remote.mockRestore();}
  });
  it('starts no new model request when the final authorization wait crosses the original destination expiry',async()=>{
    const f=await fixture(),{admitModel,invokeModel,connectorDeadline}=await import('@/connectors/model'),{z}=await import('zod');
    const at=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(at),remote=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No egress allowed'));
    try{
      const admission=await admitModel(f.env,'atelier-a','enrichment');let authorized=0;
      await expect(connectorDeadline(120000,deadline=>invokeModel(f.env,'atelier-a','enrichment',admission,z.object({ok:z.boolean()}),{sample:'approved'},deadline,[],async()=>{
        if(++authorized>=2)clock.mockReturnValue(admission.retention.expiresAt);
      }))).rejects.toThrow();expect(remote).not.toHaveBeenCalled();
    }finally{clock.mockRestore();remote.mockRestore();}
  });
});
