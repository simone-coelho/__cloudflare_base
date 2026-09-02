// src/routes/content.test.ts
// The write side of the documents CW4 reads, on a fake KV: reads open, writes
// fail closed, every write validated and versioned, rollback rolls forward, the
// import adapter takes JSON, CSV and a pulled URL.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import { invalidateCache } from '@/config/versionedStore';
import { contentRoutes } from './content';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<unknown> { const raw = this.store.get(key); return raw === undefined ? null : JSON.parse(raw); }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
}
const mkEnv = (): Env => ({ CACHE: new FakeKV(), JWT_SECRET: 's', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } as unknown as Env);
const token = () => new jose.SignJWT({ sub: 'ops' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode('s'));
const H = 'http://w';
const piece = (id: string) => ({ id, customerContentId: `CMP-${id}`, type: 'editorial', title: id, tags: { line: ['Drover'] }, slotTypes: ['story'] });

describe('/content routes', () => {
  let env: Env; let auth: Record<string, string>;
  beforeEach(async () => { invalidateCache(); env = mkEnv(); auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }; });

  it('reads the compiled default, refuses unauthenticated writes, stores and versions a valid document', async () => {
    const d0 = await (await contentRoutes.request(`${H}/catalog?scope=coach`, {}, env)).json() as { source: string; revision: number; document: { pieces: unknown[] } };
    expect(d0).toMatchObject({ source: 'compiled-default', revision: 0 });
    expect(d0.document.pieces).toEqual([]);
    expect((await contentRoutes.request(`${H}/catalog?scope=coach`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' }, env)).status).toBe(401);
    const bad = await contentRoutes.request(`${H}/catalog?scope=coach`, { method: 'PUT', headers: auth, body: JSON.stringify({ document: { pieces: [{ id: 'x' }] } }) }, env);
    expect(bad.status).toBe(422);
    const ok = await contentRoutes.request(`${H}/catalog?scope=coach`, { method: 'PUT', headers: auth, body: JSON.stringify({ document: { pieces: [piece('a')] }, note: 'first' }) }, env);
    expect(await ok.json()).toMatchObject({ ok: true, revision: 1, version: 'content+r1' });
    const d1 = await (await contentRoutes.request(`${H}/catalog?scope=coach`, {}, env)).json() as { source: string; revision: number; actor: string; note: string };
    expect(d1).toMatchObject({ source: 'stored', revision: 1, actor: 'ops', note: 'first' });
    expect(await (await contentRoutes.request(`${H}/nope?scope=coach`, {}, env)).json()).toMatchObject({ error: expect.stringContaining('kind') });
  });

  it('validate is open and runs the same validator; slots and learn are kinds too', async () => {
    const r = await contentRoutes.request(`${H}/slots/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: { pages: { home: [{ slot: 'hero', take: 0, weights: {} }] } } }) }, env);
    expect(r.status).toBe(422);
    const ok = await contentRoutes.request(`${H}/learn?scope=coach`, { method: 'PUT', headers: auth, body: JSON.stringify({ document: { holdout: { share: 0.1, arms: ['default', 'no_learning'] } } }) }, env);
    expect(await ok.json()).toMatchObject({ ok: true, revision: 1, version: 'learn+r1' });
  });

  it('history lists revisions and rollback rolls forward', async () => {
    for (const n of ['a', 'b']) await contentRoutes.request(`${H}/catalog?scope=coach`, { method: 'PUT', headers: auth, body: JSON.stringify({ document: { pieces: [piece(n)] } }) }, env);
    const hist = await (await contentRoutes.request(`${H}/catalog/history?scope=coach`, {}, env)).json() as { revisions: Array<{ revision: number }> };
    expect(hist.revisions.map((r) => r.revision)).toEqual([2, 1]);
    const rb = await (await contentRoutes.request(`${H}/catalog/rollback/1?scope=coach`, { method: 'POST', headers: auth, body: '{}' }, env)).json();
    expect(rb).toMatchObject({ ok: true, revision: 3 });
    const now = await (await contentRoutes.request(`${H}/catalog?scope=coach`, {}, env)).json() as { document: { pieces: Array<{ id: string }> } };
    expect(now.document.pieces[0]!.id).toBe('a');
    expect((await contentRoutes.request(`${H}/catalog/revisions/2?scope=coach`, {}, env)).status).toBe(200);
    expect((await contentRoutes.request(`${H}/catalog/revisions/9?scope=coach`, {}, env)).status).toBe(404);
  });

  it('imports JSON (replace), CSV (merge), and reports what it could not use', async () => {
    const j = await (await contentRoutes.request(`${H}/catalog/import?scope=coach`, { method: 'POST', headers: auth, body: JSON.stringify({ content: [{ systemId: 'p1', customerContentId: 'C1', type: 'editorial', title: 'P1', tags: { line: ['Drover'] }, slotTypes: ['chero'] }] }) }, env)).json();
    expect(j).toMatchObject({ ok: true, mode: 'replace', received: 1, imported: 1, pieces: 1, revision: 1 });
    const csv = 'id,customerContentId,type,title,tags,slotTypes\np2,C2,video,P2,occasion:evening,story\n';
    const m = await (await contentRoutes.request(`${H}/catalog/import?scope=coach&format=csv&mode=merge`, { method: 'POST', headers: { ...auth, 'Content-Type': 'text/csv' }, body: csv }, env)).json();
    expect(m).toMatchObject({ ok: true, mode: 'merge', pieces: 2, revision: 2 });
    const bad = await contentRoutes.request(`${H}/catalog/import?scope=coach`, { method: 'POST', headers: auth, body: JSON.stringify({ content: [{ id: 'p3' }] }) }, env);
    expect(bad.status).toBe(422);
    // A missing customer id falls back to the piece id on purpose; type, title and slotTypes cannot.
    expect(await bad.json()).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringContaining('.type'), expect.stringContaining('.title'), expect.stringContaining('slotTypes')]) });
    expect((await contentRoutes.request(`${H}/catalog/import?scope=coach`, { method: 'POST', headers: auth, body: JSON.stringify({ nothing: [] }) }, env)).status).toBe(422);
  });

  it('pulls from a URL through the seam, http(s) only', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [{ id: 'q1', customerContentId: 'Q1', type: 'guide', title: 'Q', tags: {}, slotTypes: ['story'] }] }) } as unknown as Response);
    try {
      const r = await (await contentRoutes.request(`${H}/catalog/pull?scope=coach`, { method: 'POST', headers: auth, body: JSON.stringify({ url: 'https://cms.example/export.json', path: 'content' }) }, env)).json();
      expect(r).toMatchObject({ ok: true, pieces: 1, revision: 1 });
      expect(spy).toHaveBeenCalledWith('https://cms.example/export.json', expect.anything());
      expect((await contentRoutes.request(`${H}/catalog/pull?scope=coach`, { method: 'POST', headers: auth, body: JSON.stringify({ url: 'file:///etc/passwd' }) }, env)).status).toBe(400);
    } finally { spy.mockRestore(); }
  });
});
