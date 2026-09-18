// W11.02 supersedes mutable-KV/fallback oracles with the same bounds and
// history/scope invariants at the single coherent conditional R2 authority.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Env } from '@/types/env';
import { CONTENT_KIND, EMPTY_CATALOG, SLOTS_KIND, DEFAULT_SLOTS, LEARN_KIND, DEFAULT_LEARN } from '@/content/kinds';
import { REFLEX_KIND } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { PRIORS_KIND, EMPTY_PRIORS } from '@/learn/priors';
import { PROPOSALS_KIND, EMPTY_PROPOSALS } from '@/learn/cycle';
import { recoveryDigest } from '@/ledger/recovery';
import { initializePublication, initializePublicationSet, pinPublication, readPinnedPublication, readPublication,
  publicationStatus, recoverPublication, publishSet, PUBLICATION_MAX_BYTES, type PublicationBaseline } from './publication';
import { readRevision, readVersion, readIndex, write, patch, rollback, deepMerge, invalidateCache, RESERVED_PREFIXES, type DocumentKind } from './versionedStore';

class PublicationR2 {
  objects = new Map<string, string>(); etags = new Map<string, string>(); calls: string[] = [];
  puts = 0; failPut = 0; afterWrite = false; failReads = false; badMetadata = false;
  async get(key: string) {
    this.calls.push('get:' + key); if (this.failReads) throw new Error('Synthetic authority outage');
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: this.etags.get(key)!, size: new TextEncoder().encode(raw).length + (this.badMetadata ? 1 : 0), body: new Response(raw).body };
  }
  async put(key: string, raw: string, options: R2PutOptions) {
    this.calls.push('put:' + key); const attempt = ++this.puts;
    if (attempt === this.failPut && !this.afterWrite) throw new Error('Synthetic pre-write outage');
    const conditional = options.onlyIf, exists = this.objects.has(key);
    if (conditional instanceof Headers ? exists : !exists || conditional?.etagMatches !== this.etags.get(key)) return null;
    this.objects.set(key, raw); this.etags.set(key, 'etag-' + attempt);
    if (attempt === this.failPut) throw new Error('Synthetic lost acknowledgement');
    return { key, etag: this.etags.get(key), size: new TextEncoder().encode(raw).length };
  }
}
const piece = (id: string, title = id) => ({ id, customerContentId: 'cms-' + id, type: 'editorial', title,
  tags: { theme: ['夏'] }, slotTypes: ['story'], lifecycle: { status: 'live' as const } });
const kinds: DocumentKind<unknown>[] = [CONTENT_KIND, SLOTS_KIND, LEARN_KIND, REFLEX_KIND, PRIORS_KIND, PROPOSALS_KIND];
const values = [EMPTY_CATALOG, DEFAULT_SLOTS, DEFAULT_LEARN, DEFAULT_REFLEX_CONFIG, EMPTY_PRIORS, EMPTY_PROPOSALS];
const baseline = (scope: string): PublicationBaseline[] => kinds.map((kind, i) => ({ kind, scope,
  revision: { revision: 1, value: values[i], actor: 'synthetic-initializer', note: '', at: 1 } }));
async function fixture(scope = 'atelier-a') {
  const storage = new PublicationR2(), kv = { get: vi.fn(() => { throw new Error('KV not configuration authority'); }), put: vi.fn(() => { throw new Error('KV mutation forbidden'); }) };
  const env = { STORAGE: storage, CACHE: kv } as unknown as Env;
  await initializePublicationSet(env, baseline(scope), '0:' + crypto.randomUUID());
  return { env, storage, kv, scope };
}
async function meta(env: Env, kind = CONTENT_KIND as DocumentKind<unknown>, scope = 'atelier-a', actor = 'writer') {
  const read = await readPublication(env, kind, scope);
  return { actor, expectedRevision: read.revision, expectedPublication: read.publication!, operationId: read.revision + ':' + crypto.randomUUID() };
}
const head = (scope = 'atelier-a') => 'config-publication/v2/' + scope + '/head.json';
beforeEach(() => invalidateCache());

describe('W11.02 coherent all-kind publication', () => {
  it('W11.02 fails closed for every uninitialized corrupt or unreadable kind, without legacy/default authority', async () => {
    const storage = new PublicationR2(), kv = { get: vi.fn(), put: vi.fn() }, env = { STORAGE: storage, CACHE: kv } as unknown as Env;
    for (const kind of kinds) {
      await expect(readRevision(env, kind, 'atelier-a')).rejects.toMatchObject({ status: 503 });
      await expect(readIndex(env, kind, 'atelier-a')).rejects.toMatchObject({ status: 503 });
      await expect(readVersion(env, kind, 'atelier-a', 1)).rejects.toMatchObject({ status: 503 });
      await expect(write(env, kind, 'atelier-a', {}, { actor: 'a' })).rejects.toMatchObject({ status: 428 });
    }
    expect(kv.get).not.toHaveBeenCalled(); expect(kv.put).not.toHaveBeenCalled();
    const f = await fixture();
    for (const kind of kinds) expect((await readPublication(f.env, kind, f.scope)).publication).toEqual((await readPublication(f.env, CONTENT_KIND, f.scope)).publication);
    f.storage.badMetadata = true;
    for (const kind of kinds) await expect(readPublication(f.env, kind, f.scope)).rejects.toMatchObject({ status: 503 });
    f.storage.badMetadata = false; f.storage.objects.set(head(), '{');
    await expect(pinPublication(f.env, f.scope)).rejects.toMatchObject({ status: 503 });
  });

  it('W11.02 serializes cross-kind and stale writers, exact retries, actor/body binding, forward rollback and numeric history beyond50', async () => {
    const f = await fixture(), a = await meta(f.env), b = await meta(f.env, SLOTS_KIND);
    const outcomes = await Promise.allSettled([write(f.env, CONTENT_KIND, f.scope, { pieces: [piece('a')] }, a),
      write(f.env, SLOTS_KIND, f.scope, { pages: {} }, b)]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(o => o.status === 'rejected').map(o => (o as PromiseRejectedResult).reason.status)).toEqual([409]);
    const current = await readPublication(f.env, CONTENT_KIND, f.scope);
    const chosen = current.revision === 2 ? a : await meta(f.env);
    const input = { pieces: [piece('a')] };
    const saved = await write(f.env, CONTENT_KIND, f.scope, input, chosen); expect(saved.ok).toBe(true);
    const n = f.storage.puts;
    expect(await write(f.env, CONTENT_KIND, f.scope, input, chosen)).toEqual(saved);
    expect(f.storage.puts).toBe(n);
    await expect(write(f.env, CONTENT_KIND, f.scope, EMPTY_CATALOG, chosen)).rejects.toMatchObject({ status: 409 });
    await expect(write(f.env, CONTENT_KIND, f.scope, input, { ...chosen, actor: 'other' })).rejects.toMatchObject({ status: 409 });
    for (let i = 0; i < 52; i++) expect((await write(f.env, CONTENT_KIND, f.scope, { pieces: [piece('n' + i)] }, await meta(f.env))).ok).toBe(true);
    const index = await readIndex(f.env, CONTENT_KIND, f.scope); expect(index).toHaveLength(50);
    expect(index.map(r => r.revision)).toEqual(Array.from({ length: 50 }, (_, i) => index[0]!.revision - i));
    expect((await readVersion(f.env, CONTENT_KIND, f.scope, 1))!.value).toEqual(EMPTY_CATALOG);
    const rolled = await rollback(f.env, CONTENT_KIND, f.scope, 1, await meta(f.env));
    expect(rolled).toMatchObject({ ok: true, revision: { revision: index[0]!.revision + 1,
      value: { ...EMPTY_CATALOG, version: 'content-empty+r' + (index[0]!.revision + 1) } } });
    expect(await recoverPublication(f.env, CONTENT_KIND, f.scope, { ...chosen, actor: 'current-successor' })).toEqual(saved);
  });

  it('W11.02 keeps multi-document activation coherent through every pre/post write failure and restart recovery', async () => {
    for (let offset = 1; offset <= 5; offset++) for (const afterWrite of [false, true]) {
      const f = await fixture(), original = await pinPublication(f.env, f.scope), m = await meta(f.env);
      const changes = [{ kind: CONTENT_KIND as DocumentKind<unknown>, scope: f.scope, request: { type: 'catalog', id: 'new' }, candidate: () => ({ pieces: [piece('new')] }) },
        { kind: SLOTS_KIND as DocumentKind<unknown>, scope: f.scope, request: { type: 'slots' }, candidate: () => ({ pages: {} }) }];
      f.storage.failPut = f.storage.puts + offset; f.storage.afterWrite = afterWrite;
      await expect(publishSet(f.env, changes, m)).rejects.toMatchObject({ status: 503 });
      f.storage.failPut = 0;
      const visible = await pinPublication(f.env, f.scope);
      const c = await readPinnedPublication(f.env, CONTENT_KIND, f.scope, visible), s = await readPinnedPublication(f.env, SLOTS_KIND, f.scope, visible);
      expect(c.revision).toBe(s.revision); expect([1, 2]).toContain(c.revision);
      expect((await readPinnedPublication(f.env, CONTENT_KIND, f.scope, original)).value).toEqual(EMPTY_CATALOG);
      invalidateCache();
      const status = await publicationStatus(f.env, CONTENT_KIND, f.scope, m);
      const recovered = status.state === 'absent' ? await publishSet(f.env, changes, m) : await recoverPublication(f.env, CONTENT_KIND, f.scope, { ...m, actor: 'successor' });
      expect(recovered).toMatchObject({ ok: true, revision: { revision: 2, value: { pieces: [piece('new')] } } });
      const puts = f.storage.puts;
      expect(await publishSet(f.env, changes, m)).toEqual(recovered); expect(f.storage.puts).toBe(puts);
      const committed = await pinPublication(f.env, f.scope);
      expect((await readPinnedPublication(f.env, CONTENT_KIND, f.scope, committed)).publication).toEqual((await readPinnedPublication(f.env, SLOTS_KIND, f.scope, committed)).publication);
    }
  });

  it('W11.02 refuses malformed pending secondary envelopes and incomplete transitions before any recovery write', async () => {
    for (const corrupt of ['missing-document', 'schema', 'actor', 'value', 'missing-ref', 'unchanged-ref']) {
      const f = await fixture(), m = await meta(f.env);
      f.storage.failPut = f.storage.puts + 2;
      await expect(publishSet(f.env, [
        { kind: CONTENT_KIND as DocumentKind<unknown>, scope: f.scope, request: 'a', candidate: () => ({ pieces: [piece('a')] }) },
        { kind: SLOTS_KIND as DocumentKind<unknown>, scope: f.scope, request: 'b', candidate: () => ({ pages: {} }) },
      ], m)).rejects.toMatchObject({ status: 503 }); f.storage.failPut = 0;
      const h = JSON.parse(f.storage.objects.get(head())!);
      if (corrupt === 'missing-document') h.pending.documents.pop();
      else if (corrupt === 'missing-ref') delete h.pending.set.refs['prior:atelier-a'];
      else if (corrupt === 'unchanged-ref') h.pending.set.refs['prior:atelier-a'].index[0].actor = 'corrupt';
      else {
        const d = h.pending.documents[1];
        if (corrupt === 'schema') d.schema = 'wrong';
        if (corrupt === 'actor') d.actor = 'wrong';
        if (corrupt === 'value') d.value = { pages: null };
        const { digest: _d, ...basis } = d; void _d; d.digest = await recoveryDigest(basis);
        h.pending.set.refs['slots:atelier-a'].digest = d.digest;
      }
      const { digest: _s, ...sb } = h.pending.set; void _s; h.pending.set.digest = await recoveryDigest(sb);
      const { digest: _h, ...hb } = h; void _h; h.digest = await recoveryDigest(hb);
      f.storage.objects.set(head(), JSON.stringify(h));
      const puts = f.storage.puts;
      await expect(recoverPublication(f.env, CONTENT_KIND, f.scope, m)).rejects.toMatchObject({ status: 503 });
      expect(f.storage.puts).toBe(puts);
    }
  });

  it('W11.02 explicitly adopts exact v1 catalog history and committed original receipts without rewriting or republishing', async () => {
    const storage = new PublicationR2(), env = { STORAGE: storage } as unknown as Env, scope = 'atelier-a';
    const oldMeta = { actor: 'original', expectedRevision: 1, operationId: '1:' + crypto.randomUUID() }, value = { pieces: [piece('old')] };
    const requestDigest = await recoveryDigest({ ...oldMeta, note: '', request: { type: 'replace', candidate: value } });
    const documents = [];
    for (const revision of [1, 2]) {
      const basis = { schema: 'catalog-revision/v1', kind: 'content', scope, revision, value: revision === 1 ? EMPTY_CATALOG : value,
        actor: revision === 1 ? 'initializer' : 'original', note: '', at: revision, operation: revision === 1
          ? { operationId: '0:' + crypto.randomUUID(), expectedRevision: 0, requestDigest: 'a'.repeat(64), initialize: true }
          : { ...oldMeta, requestDigest, initialize: false } };
      if ('actor' in basis.operation) delete (basis.operation as { actor?: string }).actor;
      const document = { ...basis, digest: await recoveryDigest(basis) }; documents.push(document);
      await storage.put('config-publication/v1/' + scope + '/content/rev/' + revision + '.json', JSON.stringify(document), { onlyIf: new Headers({ 'If-None-Match': '*' }) });
    }
    const index = documents.slice().reverse().map(d => ({ revision: d.revision, version: String(d.revision), actor: d.actor, note: d.note, at: d.at }));
    // CONTENT_KIND's versionOf is empty for these documents.
    for (const row of index) row.version = '';
    const basis = { schema: 'catalog-publication/v1', kind: 'content', scope, committed: { revision: 2, digest: documents[1]!.digest }, minRevision: 1, index, pending: null };
    const oldHead = { ...basis, digest: await recoveryDigest(basis) };
    await storage.put('config-publication/v1/' + scope + '/content/head.json', JSON.stringify(oldHead), { onlyIf: new Headers({ 'If-None-Match': '*' }) });
    const pendingBasis = { ...documents[1]!, revision: 3, operation: { operationId: '2:' + crypto.randomUUID(), expectedRevision: 2,
      requestDigest: 'b'.repeat(64), initialize: false } };
    const { digest: _pending, ...pendingRaw } = pendingBasis; void _pending;
    const pending = { ...pendingRaw, digest: await recoveryDigest(pendingRaw) }, heldBasis = { ...basis, pending };
    const heldHead = { ...heldBasis, digest: await recoveryDigest(heldBasis) }, oldHeadKey = 'config-publication/v1/' + scope + '/content/head.json';
    storage.objects.set(oldHeadKey, JSON.stringify(heldHead));
    const heldBytes = new Map(storage.objects), heldPuts = storage.puts;
    await expect(initializePublicationSet(env, [{ kind: CONTENT_KIND, scope, revision: { revision: 2, value, actor: 'original', note: '', at: 2 },
      retainedCatalogHead: { digest: heldHead.digest } }], '1:' + crypto.randomUUID())).rejects.toMatchObject({ status: 503 });
    expect(storage.objects).toEqual(heldBytes); expect(storage.puts).toBe(heldPuts); // No automatic pre-cutover settlement.
    storage.objects.set(oldHeadKey, JSON.stringify(oldHead));
    const oldBytes = new Map(storage.objects);
    const set = await initializePublicationSet(env, [{ kind: CONTENT_KIND as DocumentKind<unknown>, scope,
      revision: { revision: 2, value, actor: 'original', note: '', at: 2 }, retainedCatalogHead: { digest: oldHead.digest } }, ...baseline(scope).slice(1)], '1:' + crypto.randomUUID());
    expect(set.refs['content:atelier-a'].minRevision).toBe(1);
    for (const [key, raw] of oldBytes) expect(storage.objects.get(key)).toBe(raw);
    expect(await readIndex(env, CONTENT_KIND, scope)).toEqual(index);
    expect((await readVersion(env, CONTENT_KIND, scope, 1))!.value).toEqual(EMPTY_CATALOG);
    const puts = storage.puts;
    expect(await publicationStatus(env, CONTENT_KIND, scope, oldMeta)).toMatchObject({ state: 'committed', legacyReceipt: true, revision: 2, actor: 'original' });
    expect(await recoverPublication(env, CONTENT_KIND, scope, { ...oldMeta, actor: 'successor' })).toMatchObject({ ok: true, revision: { revision: 2 } });
    expect(await write(env, CONTENT_KIND, scope, value, oldMeta)).toMatchObject({ ok: true, revision: { revision: 2 } });
    expect(storage.puts).toBe(puts);
    await expect(write(env, CONTENT_KIND, scope, EMPTY_CATALOG, oldMeta)).rejects.toMatchObject({ status: 409 });
  });

  it('W11.02 preserves W38 byte/read-start/LRU bounds and immutable scope-binding snapshots without fallback', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const all = [];
      for (let i = 0; i < 33; i++) {
        const storage = new PublicationR2(), env = { STORAGE: storage } as unknown as Env, scope = 'cache-' + i;
        await initializePublication(env, CONTENT_KIND, scope, { revision: 1, value: EMPTY_CATALOG, actor: 'init', note: '', at: 1 }, '0:' + crypto.randomUUID());
        all.push({ storage, env, scope }); await readRevision(env, CONTENT_KIND, scope);
      }
      all[0]!.storage.failReads = true; await expect(readRevision(all[0]!.env, CONTENT_KIND, all[0]!.scope)).rejects.toMatchObject({ status: 503 });
      const f = all[32]!, before = f.storage.calls.length, cached = await readRevision(f.env, CONTENT_KIND, f.scope);
      expect(f.storage.calls).toHaveLength(before); expect(Object.isFrozen(cached.value)).toBe(true);
      f.storage.failReads = true; clock.mockReturnValue(31000);
      await expect(readRevision(f.env, CONTENT_KIND, f.scope)).rejects.toMatchObject({ status: 503 });
      f.storage.failReads = false; clock.mockReturnValue(100000); invalidateCache();
      const large = [];
      for (let i = 0; i < 5; i++) {
        const storage = new PublicationR2(), env = { STORAGE: storage } as unknown as Env, scope = 'large-' + i;
        await initializePublication(env, CONTENT_KIND, scope, { revision: 1, value: { pieces: [piece('large', 'é'.repeat(850000))] }, actor: 'init', note: '', at: 1 }, '0:' + crypto.randomUUID());
        large.push({ storage, env, scope }); await readRevision(env, CONTENT_KIND, scope);
      }
      large[0]!.storage.failReads = true; await expect(readRevision(large[0]!.env, CONTENT_KIND, large[0]!.scope)).rejects.toMatchObject({ status: 503 });
      for (const x of large.slice(1)) { const n = x.storage.calls.length; await readRevision(x.env, CONTENT_KIND, x.scope); expect(x.storage.calls).toHaveLength(n); }
      const m = await meta(f.env, CONTENT_KIND, f.scope), puts = f.storage.puts;
      await expect(write(f.env, CONTENT_KIND, f.scope, { pieces: [piece('huge', 'é'.repeat(PUBLICATION_MAX_BYTES))] }, m)).rejects.toMatchObject({ status: 413 });
      expect(f.storage.puts).toBe(puts);
      const supported = Array.from({ length: 500 }, (_, i) => piece('asset-' + i));
      expect((await write(f.env, CONTENT_KIND, f.scope, { pieces: supported }, m)).ok).toBe(true);
      expect((await readPublication(f.env, CONTENT_KIND, f.scope)).value.pieces).toHaveLength(500);
    } finally { clock.mockRestore(); invalidateCache(); }
  });

  it('W11.02 fences in-flight cache admissions and pins the old full set across a concurrent new activation', async () => {
    const f = await fixture(), oldPin = await pinPublication(f.env, f.scope, true), m = await meta(f.env);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
    const get = f.storage.get.bind(f.storage); let held = false;
    vi.spyOn(f.storage, 'get').mockImplementation(async key => {
      const value = await get(key); if (!held && key.endsWith('/content/rev/1.json')) { held = true; entered(); await gate; } return value;
    });
    invalidateCache();
    const delayed = readPinnedPublication(f.env, CONTENT_KIND, f.scope, oldPin); await started;
    const saved = await write(f.env, CONTENT_KIND, f.scope, { pieces: [piece('new')] }, m); expect(saved.ok).toBe(true);
    release(); expect((await delayed).revision).toBe(1);
    expect((await readRevision(f.env, CONTENT_KIND, f.scope)).revision).toBe(2);
    expect((await readPinnedPublication(f.env, SLOTS_KIND, f.scope, oldPin)).revision).toBe(1);
  });

  it('W11.02 W38 initialization retries every pre/post acknowledgement fault and refuses occupied immutable history', async () => {
    for (let offset = 1; offset <= 9; offset++) for (const afterWrite of [false, true]) {
      const storage = new PublicationR2(), env = { STORAGE: storage } as unknown as Env, rows = baseline('atelier-a'), id = '0:' + crypto.randomUUID();
      storage.failPut = offset; storage.afterWrite = afterWrite;
      await expect(initializePublicationSet(env, rows, id)).rejects.toMatchObject({ status: 503 });
      const retained = new Map([...storage.objects].filter(([key]) => !key.endsWith('/head.json')));
      storage.failPut = 0; invalidateCache();
      const set = await initializePublicationSet(env, rows, id);
      expect(set.revision).toBe(1); expect(Object.keys(set.refs)).toHaveLength(6);
      for (const [key, raw] of retained) expect(storage.objects.get(key)).toBe(raw);
      const puts = storage.puts; expect(await initializePublicationSet(env, rows, id)).toEqual(set); expect(storage.puts).toBe(puts);
    }
    const f = await fixture(), old = new Map(f.storage.objects), foreign = 'config-publication/v1/foreign/content/rev/1.json';
    f.storage.objects.set(foreign, '{"foreign":true}'); f.storage.etags.set(foreign, 'foreign');
    const puts = f.storage.puts;
    await expect(initializePublicationSet(f.env, baseline('foreign'), '0:' + crypto.randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(f.storage.puts).toBe(puts); expect(f.storage.objects.get(foreign)).toBe('{"foreign":true}');
    expect(f.storage.objects.has(head('foreign'))).toBe(false);
    for (const [key, raw] of old) expect(f.storage.objects.get(key)).toBe(raw);
    await expect(initializePublicationSet(f.env, baseline(f.scope), '0:' + crypto.randomUUID())).rejects.toMatchObject({ status: 503 });
    for (const [key, raw] of old) expect(f.storage.objects.get(key)).toBe(raw);
  });

  it('W11.02 W38 bounds actual streamed bytes before parse or validation, cancelling overflow and accepting exact UTF8 boundaries', async () => {
    const f = await fixture(), key = 'config-publication/v1/atelier-a/content/rev/1.json', raw = f.storage.objects.get(key)!;
    const get = f.storage.get.bind(f.storage), validation = vi.spyOn(CONTENT_KIND, 'validateStored'), parse = vi.spyOn(JSON, 'parse');
    let cancelled = false, pulls = 0;
    const read = vi.spyOn(f.storage, 'get').mockImplementation(async path => path !== key ? get(path) : {
      key, etag: 'synthetic', size: PUBLICATION_MAX_BYTES,
      body: new ReadableStream<Uint8Array>({ pull(c) { pulls++; c.enqueue(new Uint8Array(PUBLICATION_MAX_BYTES + 1)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 }),
    });
    try {
      validation.mockClear(); await expect(readPublication(f.env, CONTENT_KIND, f.scope)).rejects.toMatchObject({ status: 503 });
      expect(pulls).toBe(1); expect(cancelled).toBe(true); expect(validation).not.toHaveBeenCalled();
      expect(parse.mock.calls.some(([text]) => text.includes('\u0000'))).toBe(false);
      const exact = new TextEncoder().encode(raw + ' '.repeat(PUBLICATION_MAX_BYTES - new TextEncoder().encode(raw).length));
      read.mockImplementation(async path => path !== key ? get(path) : { key, etag: 'synthetic', size: exact.length,
        body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(exact.subarray(0, 7)); c.enqueue(exact.subarray(7)); c.close(); } }) });
      expect((await readPublication(f.env, CONTENT_KIND, f.scope)).value).toEqual(EMPTY_CATALOG);
      read.mockRestore();
      const saved = await write(f.env, CONTENT_KIND, f.scope, { pieces: [piece('utf8', '夏🙂é')] }, await meta(f.env)); expect(saved.ok).toBe(true);
      const utfKey = key.replace('/1.json', '/2.json'), utf = new TextEncoder().encode(f.storage.objects.get(utfKey)!);
      const stream = vi.spyOn(f.storage, 'get').mockImplementation(async path => path !== utfKey ? get(path) : { key: utfKey, etag: 'synthetic', size: utf.length,
        body: new ReadableStream<Uint8Array>({ start(c) { for (const byte of utf) c.enqueue(new Uint8Array([byte])); c.close(); } }) });
      try { expect((await readPublication(f.env, CONTENT_KIND, f.scope)).value.pieces[0]!.title).toBe('夏🙂é'); } finally { stream.mockRestore(); }
    } finally { read.mockRestore(); validation.mockRestore(); parse.mockRestore(); }
  });

  it('W11.02 W38 read-start freshness LRU touch binding identity and all mutation-finally fences survive delayed reads', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const a = await fixture(), b = await fixture();
      await write(b.env, CONTENT_KIND, b.scope, { pieces: [piece('binding-b')] }, await meta(b.env));
      expect((await readRevision(a.env, CONTENT_KIND, a.scope)).revision).toBe(1);
      expect((await readRevision(b.env, CONTENT_KIND, b.scope)).revision).toBe(2);
      const fixtures = [a, b]; for (let i = 0; i < 30; i++) fixtures.push(await fixture('lru-' + i));
      invalidateCache(); for (const f of fixtures) await readRevision(f.env, CONTENT_KIND, f.scope);
      await readRevision(a.env, CONTENT_KIND, a.scope); // Real LRU touch protects a, not the next-oldest binding b.
      const extra = await fixture('lru-extra'); await readRevision(extra.env, CONTENT_KIND, extra.scope);
      a.storage.failReads = true; b.storage.failReads = true;
      expect((await readRevision(a.env, CONTENT_KIND, a.scope)).revision).toBe(1);
      await expect(readRevision(b.env, CONTENT_KIND, b.scope)).rejects.toMatchObject({ status: 503 });
      a.storage.failReads = false;
      const get = a.storage.get.bind(a.storage);
      for (const mode of ['slow', 'newer', 'write', 'pre-fail', 'lost-ack', 'late-retry', 'recover']) {
        invalidateCache(); clock.mockReturnValue(1000);
        let release!: () => void, entered!: () => void, held = false;
        const wait = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
        const spy = vi.spyOn(a.storage, 'get').mockImplementation(async path => {
          const value = await get(path); if (!held && path === head()) { held = true; entered(); await wait; } return value;
        });
        const delayed = readRevision(a.env, CONTENT_KIND, a.scope); await started;
        if (mode === 'slow') clock.mockReturnValue(31000);
        else if (mode === 'newer') { clock.mockReturnValue(2000); await readRevision(a.env, CONTENT_KIND, a.scope); }
        else {
          const m = await meta(a.env), input = { pieces: [piece('fence-' + mode)] };
          if (mode === 'pre-fail' || mode === 'lost-ack') { a.storage.failPut = a.storage.puts + 1; a.storage.afterWrite = mode === 'lost-ack'; }
          const outcome = await write(a.env, CONTENT_KIND, a.scope, input, m).then(() => 200, e => e.status);
          expect(outcome).toBe(mode === 'pre-fail' || mode === 'lost-ack' ? 503 : 200); a.storage.failPut = 0;
          // A read admitted during the write must also be invalidated on exit.
          await readRevision(a.env, CONTENT_KIND, a.scope);
          if (mode === 'late-retry' || mode === 'recover') {
            const puts = a.storage.puts;
            if (mode === 'late-retry') await write(a.env, CONTENT_KIND, a.scope, input, m);
            else await recoverPublication(a.env, CONTENT_KIND, a.scope, m);
            expect(a.storage.puts).toBe(puts);
          }
          if (mode === 'lost-ack') await recoverPublication(a.env, CONTENT_KIND, a.scope, m);
        }
        release(); await delayed; spy.mockRestore();
        const count = a.storage.calls.length;
        if (mode === 'slow') { await readRevision(a.env, CONTENT_KIND, a.scope); expect(a.storage.calls.length).toBeGreaterThan(count); }
        else if (mode === 'newer') { clock.mockReturnValue(31500); await readRevision(a.env, CONTENT_KIND, a.scope); expect(a.storage.calls.length).toBe(count); }
        else expect((await readRevision(a.env, CONTENT_KIND, a.scope)).revision).toBe((await readPublication(a.env, CONTENT_KIND, a.scope)).revision);
      }
    } finally { clock.mockRestore(); invalidateCache(); }
  });

  it('W11.02 W38 fences reads actually admitted during held PUTs and invalidates exact no-PUT continuations', async () => {
    for (const mode of ['commit', 'pre-fail', 'lost-ack', 'late-retry', 'recover']) {
      const f = await fixture(), m = await meta(f.env), input = { pieces: [piece('held')] };
      if (mode === 'late-retry' || mode === 'recover') {
        await write(f.env, CONTENT_KIND, f.scope, input, m); await readRevision(f.env, CONTENT_KIND, f.scope);
        const puts = f.storage.puts;
        if (mode === 'late-retry') await write(f.env, CONTENT_KIND, f.scope, input, m); else await recoverPublication(f.env, CONTENT_KIND, f.scope, m);
        expect(f.storage.puts).toBe(puts);
      } else {
        const put = f.storage.put.bind(f.storage); let entered!: () => void, release!: () => void;
        const started = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
        let held = false;
        const spy = vi.spyOn(f.storage, 'put').mockImplementation(async (key, body, options) => {
          const h = JSON.parse(body);
          if (!held && key === head() && (mode === 'pre-fail' || h.pending === null)) {
            held = true; entered(); await gate;
            if (mode === 'pre-fail') throw new Error('Synthetic before PUT');
            const receipt = await put(key, body, options);
            if (mode === 'lost-ack') throw new Error('Synthetic committed response lost');
            return receipt;
          }
          return put(key, body, options);
        });
        const pending = write(f.env, CONTENT_KIND, f.scope, input, m).then(() => 200, error => error.status);
        await started;
        expect((await readRevision(f.env, CONTENT_KIND, f.scope)).revision).toBe(1); // Held mutation still active.
        release(); expect(await pending).toBe(mode === 'commit' ? 200 : 503); spy.mockRestore();
      }
      const reads = f.storage.calls.length; f.storage.failReads = true;
      await expect(readRevision(f.env, CONTENT_KIND, f.scope)).rejects.toMatchObject({ status: 503 });
      expect(f.storage.calls.length).toBeGreaterThan(reads);
    }
    const f = await fixture(), m = await meta(f.env), visible = await pinPublication(f.env, f.scope);
    const key = 'config-publication/v1/atelier-a/content/rev/2.json', foreign = '{"foreign":"immutable"}';
    f.storage.objects.set(key, foreign); f.storage.etags.set(key, 'foreign');
    await expect(write(f.env, CONTENT_KIND, f.scope, { pieces: [piece('cannot-overwrite')] }, m)).rejects.toMatchObject({ status: 409 });
    expect(await pinPublication(f.env, f.scope)).toEqual(visible); expect(f.storage.objects.get(key)).toBe(foreign);
    await expect(recoverPublication(f.env, CONTENT_KIND, f.scope, m)).rejects.toMatchObject({ status: 409 });
    expect(await pinPublication(f.env, f.scope)).toEqual(visible); expect(f.storage.objects.get(key)).toBe(foreign);
  });

  it('W11.02 retains kind validators patch semantics tenant isolation and pure merge safety', async () => {
    const f = await fixture(), other = await fixture('atelier-b');
    const before = await readPublication(f.env, REFLEX_KIND, f.scope);
    const result = await patch(f.env, REFLEX_KIND, f.scope, DEFAULT_REFLEX_CONFIG, { weights: { view: 0 } }, await meta(f.env, REFLEX_KIND));
    expect(result.ok).toBe(true); if (result.ok) { expect(result.revision.value.weights.view).toBe(0); expect(result.revision.value.dimensions).toEqual(before.value.dimensions); }
    expect((await readPublication(other.env, REFLEX_KIND, other.scope)).revision).toBe(1);
    expect(await patch(f.env, REFLEX_KIND, f.scope, DEFAULT_REFLEX_CONFIG, { thetaIn: 0 }, await meta(f.env, REFLEX_KIND))).toMatchObject({ ok: false });
    expect(deepMerge({ a: { b: 1 }, list: [1, 2] }, { a: { c: 2 }, list: [3] })).toEqual({ a: { b: 1, c: 2 }, list: [3] });
    expect(deepMerge({}, JSON.parse('{"__proto__":{"unsafe":true}}'))).toEqual({});
    expect(RESERVED_PREFIXES).toContain('prior:');
  });
});
it('W11.02 native shared R2 serializes distinct workers and publishes a coherent multi-kind set', async () => {
  const source = `import { initializePublicationSet, readPublication, pinPublication, readPinnedPublication, recoverPublication, publishSet } from '@/config/publication';
    import { write } from '@/config/versionedStore'; import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND, EMPTY_CATALOG, DEFAULT_SLOTS, DEFAULT_LEARN } from '@/content/kinds';
    import { REFLEX_KIND } from '@/reflex/configStore'; import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
    import { PRIORS_KIND, EMPTY_PRIORS } from '@/learn/priors'; import { PROPOSALS_KIND, EMPTY_PROPOSALS } from '@/learn/cycle';
    const kinds=[CONTENT_KIND,SLOTS_KIND,LEARN_KIND,REFLEX_KIND,PRIORS_KIND,PROPOSALS_KIND], values=[EMPTY_CATALOG,DEFAULT_SLOTS,DEFAULT_LEARN,DEFAULT_REFLEX_CONFIG,EMPTY_PRIORS,EMPTY_PROPOSALS];
    export default { async fetch(request,env) { const input=await request.json(); try {
      let out; const kind=kinds.find(k=>k.name===(input.kind||'content'));
      if(input.action==='init') out=await initializePublicationSet(env,kinds.map((kind,i)=>({kind,scope:'atelier-a',revision:{revision:1,value:values[i],actor:'fixture',note:'',at:1}})),input.id);
      else if(input.action==='read') {const pin=await pinPublication(env,'atelier-a',input.cache===true);out=await Promise.all(kinds.map(k=>readPinnedPublication(env,k,'atelier-a',pin)));}
      else if(input.action==='recover') out=await recoverPublication(env,kind,'atelier-a',input.meta);
      else if(input.action==='batch') out=await publishSet(env,[{kind:CONTENT_KIND,scope:'atelier-a',request:input.document,candidate:()=>input.document},{kind:SLOTS_KIND,scope:'atelier-a',request:input.slots,candidate:()=>input.slots}],input.meta);
      else out=await write(env,kind,'atelier-a',input.document,input.meta);
      return Response.json(out); } catch(e) { return Response.json({error:e.message,code:e.code},{status:e.status||500}); } } };`;
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: 'w1102-native.ts', loader: 'ts' },
    bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
  const inputs = Object.keys(bundle.metafile!.inputs).sort().map(path => ({ path, sha256: sha(path === 'w1102-native.ts' ? source : readFileSync(path)) }));
  console.info('W11.02 native input identity', JSON.stringify({ source: sha(source), bundle: sha(bundle.outputFiles[0]!.text), inputs }));
  const worker = (name: string) => ({ name, modules: [{ type: 'ESModule' as const, path: 'publication.mjs', contents: bundle.outputFiles[0]!.text }],
    compatibilityDate: '2025-06-01', r2Buckets: { STORAGE: 'w1101-native-shared' }, outboundService() { throw new Error('No external network in W11'); } });
  const runtime = new Miniflare({ cf: false, workers: [worker('a'), worker('b')] });
  try {
    const a = await runtime.getWorker('a'), b = await runtime.getWorker('b');
    const call = (w: typeof a, body: object) => w.fetch('https://synthetic.invalid', { method: 'POST', body: JSON.stringify(body) });
    expect((await call(a, { action: 'init', id: '0:' + crypto.randomUUID() })).status).toBe(200);
    const initial = await (await call(b, { action: 'read', cache: true })).json() as Array<{ revision: number; publication: { revision: number; digest: string } }>;
    expect(initial).toHaveLength(6); expect(new Set(initial.map(v=>v.publication.digest)).size).toBe(1);
    const metas = ['a','b'].map(actor=>({ actor, expectedRevision:1, expectedPublication:initial[0]!.publication, operationId:'1:'+crypto.randomUUID() }));
    const responses = await Promise.all([a,b].map((w,i)=>call(w,{action:'write',kind:i?'slots':'content',document:i?{pages:{}}:{pieces:[piece('race')]},meta:metas[i]})));
    expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    const winner=responses[0].status===200?0:1, loser=1-winner;
    expect(await (await call([a,b][winner]!,{action:'recover',kind:winner?'slots':'content',meta:{...metas[winner],actor:'successor'}})).json()).toMatchObject({ok:true,revision:{revision:2,actor:metas[winner]!.actor}});
    expect((await call([a,b][loser]!,{action:'write',kind:loser?'slots':'content',document:loser?{pages:{}}:EMPTY_CATALOG,meta:metas[loser]})).status).toBe(409);
    const current=await(await call(a,{action:'read'})).json() as typeof initial;
    const result=await call(a,{action:'batch',document:{pieces:[piece('coherent')]},slots:{pages:{home:[{slot:'story',take:1,weights:{}}]}},
      meta:{actor:'joint',expectedRevision:current[0]!.revision,expectedPublication:current[0]!.publication,operationId:current[0]!.revision+':'+crypto.randomUUID()}});
    expect(result.status).toBe(200);
    const coherent=await(await call(b,{action:'read'})).json() as typeof initial;
    expect(new Set(coherent.map(v=>v.publication.digest)).size).toBe(1); expect(coherent[0]!.publication.revision).toBe(3);
    console.info('W11.02 native R2 result',JSON.stringify({workers:2,kinds:6,successfulConcurrentWriters:1,conflicts:1,publication:coherent[0]!.publication,externalCalls:0,notDeployedOrSlo:true}));
  } finally { await runtime.dispose(); }
},60000);
