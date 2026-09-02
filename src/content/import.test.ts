import { describe, it, expect, vi } from 'vitest';
import { HttpJsonSource, assemble, candidatesFrom, normalizePiece, normalizeTags, parseCsv, recordsFromJson } from './import';
import { validateContentCatalog } from './kinds';
import { isLiveAt } from './lifecycle';
import type { ContentCatalog, ContentPiece } from './types';

describe('normalization', () => {
  it('reads tags from an object, from strings, and from the csv form', () => {
    expect(normalizeTags({ line: ['Drover'], occasion: 'evening|everyday' })).toEqual({ line: ['Drover'], occasion: ['evening', 'everyday'] });
    expect(normalizeTags('line:Drover;occasion:evening|everyday; contentType:editorial')).toEqual({ line: ['Drover'], occasion: ['evening', 'everyday'], contentType: ['editorial'] });
    expect(normalizeTags(undefined)).toEqual({});
  });

  it('accepts the demo catalog shape, a CMS shape, and the CSV shape, and the validator accepts the result', () => {
    const demo = normalizePiece({ systemId: 'cnt_1', customerContentId: 'CMP-1', vertical: 'retail', type: 'editorial', title: 'T', tags: { line: ['Drover'] }, slotTypes: ['chero'], lifecycle: { status: 'live' }, art: '/x.jpg', excerpt: 'E' });
    const cms = normalizePiece({ id: 'c2', cmsId: 'CMP-2', contentType: 'video', title: 'V', tags: 'occasion:evening', slots: 'story|carousel', status: 'draft', url: 'https://cdn.example/v.mp4', publishAt: '2026-10-01T00:00:00Z', expireAt: '2026-12-01T00:00:00Z' });
    const r = validateContentCatalog({ pieces: [demo, cms] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pieces[0]).toMatchObject({ id: 'cnt_1', customerContentId: 'CMP-1', type: 'editorial', slotTypes: ['chero'], art: '/x.jpg', excerpt: 'E' });
      expect(r.value.pieces[1]).toMatchObject({ id: 'c2', customerContentId: 'CMP-2', type: 'video', slotTypes: ['story', 'carousel'], lifecycle: { status: 'draft' }, renderUrl: 'https://cdn.example/v.mp4', window: { from: '2026-10-01T00:00:00Z', to: '2026-12-01T00:00:00Z' } });
      expect((r.value.pieces[0] as unknown as Record<string, unknown>).vertical).toBeUndefined();
    }
    expect(normalizePiece('nope')).toBeNull();
  });

  it('finds the records in a JSON export by convention or by path', () => {
    expect(recordsFromJson([{ id: 1 }])).toHaveLength(1);
    expect(recordsFromJson({ content: [{ id: 1 }, { id: 2 }] })).toHaveLength(2);
    expect(recordsFromJson({ data: { export: { rows: [{ id: 1 }] } } }, 'data.export.rows')).toHaveLength(1);
    expect(recordsFromJson({ nothing: true })).toEqual([]);
  });
});

describe('csv', () => {
  it('parses quoted fields, embedded commas and newlines, doubled quotes, CRLF', () => {
    const text = 'id,title,tags,slotTypes\r\nc1,"Field Jacket, Ten Years On","line:Drover;occasion:everyday",chero|story\r\nc2,"She said ""yes""\nand meant it",occasion:evening,story\r\n';
    const rows = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: 'c1', title: 'Field Jacket, Ten Years On', tags: 'line:Drover;occasion:everyday', slotTypes: 'chero|story' });
    expect(rows[1]!.title).toBe('She said "yes"\nand meant it');
  });

  it('a csv export becomes a valid catalog', () => {
    const text = 'id,customerContentId,type,title,tags,slotTypes,status,windowFrom\nc1,CMP-1,editorial,T,line:Drover,chero,live,2026-01-01T00:00:00Z\n';
    const r = validateContentCatalog({ pieces: candidatesFrom(parseCsv(text)) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pieces[0]).toMatchObject({ id: 'c1', window: { from: '2026-01-01T00:00:00Z' } });
  });
});

describe('assembly and the window', () => {
  const piece = (id: string, extra: Partial<ContentPiece> = {}): ContentPiece =>
    ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags: {}, slotTypes: ['story'], lifecycle: { status: 'live' }, ...extra });
  const current: ContentCatalog = { version: 'v', pieces: [piece('a'), piece('b')] };

  it('replace drops what is not in the import; merge upserts by id and keeps order', () => {
    expect(assemble(current, [{ id: 'c' }], 'replace').pieces.map((p) => (p as { id: string }).id)).toEqual(['c']);
    expect(assemble(current, [{ id: 'b', title: 'B2' }, { id: 'c' }], 'merge').pieces.map((p) => (p as { id: string }).id)).toEqual(['a', 'b', 'c']);
    expect((assemble(current, [{ id: 'b', title: 'B2' }], 'merge').pieces[1] as { title: string }).title).toBe('B2');
  });

  it('the publish window gates eligibility at decision time', () => {
    const t = Date.parse('2026-11-01T00:00:00Z');
    expect(isLiveAt(piece('x'), t)).toBe(true);
    expect(isLiveAt(piece('x', { lifecycle: { status: 'draft' } }), t)).toBe(false);
    expect(isLiveAt(piece('x', { window: { from: '2026-12-01T00:00:00Z' } }), t)).toBe(false);
    expect(isLiveAt(piece('x', { window: { to: '2026-10-01T00:00:00Z' } }), t)).toBe(false);
    expect(isLiveAt(piece('x', { window: { from: '2026-10-01T00:00:00Z', to: '2026-12-01T00:00:00Z' } }), t)).toBe(true);
  });

  it('the http source pulls JSON and refuses anything but http(s)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ content: [{ id: 'p1' }] }) })) as unknown as typeof fetch;
    const src = new HttpJsonSource('https://cms.example/export', 'content', fetchImpl);
    expect(await src.pull()).toEqual([{ id: 'p1' }]);
    expect(() => new HttpJsonSource('ftp://x', undefined, fetchImpl)).toThrow();
    const bad = new HttpJsonSource('https://cms.example/x', undefined, (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch);
    await expect(bad.pull()).rejects.toThrow('500');
  });
});
