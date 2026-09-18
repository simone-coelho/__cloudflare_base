import { describe, it, expect, vi } from 'vitest';
import { CSV_COLUMNS, HttpJsonSource, assemble, candidatesFrom, normalizePiece, normalizeTags, parseCsv, recordsFromJson } from './import';
import { CONTENT_KIND, validateContentCatalog } from './kinds';
import { isLiveAt } from './lifecycle';
import type { ContentCatalog, ContentPiece } from './types';
import { INPUT_MAX_BYTES, INPUT_MAX_RECORDS, readInputJson, readInputText } from '@/config/input';
import { parsePriorsCsv } from '@/learn/priors';

describe('normalization', () => {
  it('W19.01 preserves supported metadata and explicit partial-upsert omission semantics', () => {
    const original: ContentPiece = { id: 'p', customerContentId: 'CMS-p', type: 'video', title: 'Title', subtitle: 'Sub',
      tags: { line: ['Drover'], contentType: ['video'] }, slotTypes: ['story'], lifecycle: { status: 'expired' },
      art: '/a.jpg', renderUrl: '/render', excerpt: 'Copy', runtime: '01:30',
      window: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
      merchandising: { season: 0, promotion: 1, margin: 0.4 }, journeyStageFit: ['exploring', 'considering', 'deciding'],
      freshnessDate: '2026-01-01T00:00:00Z', featuredProductIds: ['SKU-1'], inStock: false };
    const current: ContentCatalog = { version: 'catalog', pieces: [original, { ...original, id: 'untouched' }] };
    const normalize = (records: unknown[], mode: 'merge' | 'replace' = 'replace') => validateContentCatalog(assemble(current, candidatesFrom(records), mode));
    const value = (records: unknown[], mode: 'merge' | 'replace' = 'replace') => {
      const result = normalize(records, mode); expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.errors.join('; ')); return result.value;
    };
    expect(CSV_COLUMNS).toContain('merchandising');
    expect(value([original]).pieces).toEqual([original]);
    const cell = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const row = { id: 'p', customerContentId: 'CMS-p', type: 'video', title: 'Title', subtitle: 'Sub',
      tags: 'line:Drover;contentType:video', slotTypes: 'story', status: 'expired', art: '/a.jpg', renderUrl: '/render', excerpt: 'Copy', runtime: '01:30',
      windowFrom: original.window!.from!, windowTo: original.window!.to!, merchandising: JSON.stringify(original.merchandising),
      journeyStageFit: 'explore|consider|decide', freshnessDate: original.freshnessDate!, featuredProductIds: 'SKU-1', inStock: 'false' };
    const csv = Object.keys(row).join(',') + '\n' + Object.values(row).map(cell).join(',');
    expect(value(parseCsv(csv)).pieces).toEqual([original]);
    expect(value([{ ...original, journeyStageFit: ['early', 'mid', 'late'] }]).pieces).toEqual([original]);
    expect(CONTENT_KIND.validateStored!({ pieces: [{ ...original, journeyStageFit: ['explore'] }] }).ok).toBe(false);

    const updated = value([{ id: 'p', title: 'Updated' }], 'merge');
    expect(updated.pieces).toEqual([{ ...original, title: 'Updated' }, current.pieces[1]]);
    expect(value(parseCsv('id,title,status,windowFrom,windowTo,inStock,merchandising\np,Updated,,,,,'), 'merge')).toEqual(updated);
    expect(value([{ id: 'p', window: { from: '2026-01-02T00:00:00Z' } }], 'merge').pieces[0]!.window)
      .toEqual({ from: '2026-01-02T00:00:00Z', to: original.window!.to });
    expect(value(parseCsv('id,windowFrom,windowTo\np,2026-01-02T00:00:00Z,'), 'merge').pieces[0]!.window)
      .toEqual({ from: '2026-01-02T00:00:00Z', to: original.window!.to });
    const cleared = value([{ id: 'p', art: null, window: {}, merchandising: {}, lifecycle: { status: 'live' }, inStock: true,
      tags: { line: ['Tabby'] }, slotTypes: ['hero'], featuredProductIds: [] }], 'merge').pieces[0]!;
    expect(cleared).toEqual({ ...original, art: null, window: undefined, merchandising: undefined, lifecycle: { status: 'live' },
      inStock: true, tags: { line: ['Tabby'] }, slotTypes: ['hero'], featuredProductIds: undefined });
    expect(isLiveAt(updated.pieces[0]!, Date.parse('2026-03-01T00:00:00Z'))).toBe(false);
    expect(isLiveAt(cleared, Date.parse('2026-03-01T00:00:00Z'))).toBe(true);
    expect(value([{ id: 'new', type: 'guide', title: 'New', slotTypes: ['story'] }], 'merge').pieces.map(p => p.id))
      .toEqual(['p', 'untouched', 'new']);
    expect(value([{ id: 'new', type: 'guide', title: 'New', slotTypes: ['story'] }]).pieces[0])
      .toEqual({ id: 'new', customerContentId: 'new', type: 'guide', title: 'New', tags: {}, slotTypes: ['story'], lifecycle: { status: 'live' } });
    expect(normalize([{ id: 'new' }], 'merge').ok).toBe(false);
    expect(normalize([{ title: 'No ID' }], 'merge').ok).toBe(false);
    for (const invalid of [
      { customerContentId: null, cmsId: 'fallback' }, { lifecycle: null, status: 'live' }, { lifecycle: {} },
      { window: null, windowTo: '2027-01-01T00:00:00Z' }, { window: { to: null } },
      { merchandising: null }, { merchandising: '{"promotion":1}' }, { merchandising: { promotion: 1.1 } },
      { merchandising: { promotion: '1' } }, { merchandising: { unknown: 0 } }, { merchandising: { margin: Infinity } },
      { inStock: null, ats: 'Y' }, { inStock: 2 }, { ats: -1 }, { subtitle: 1 }, { runtime: {} }, { renderUrl: null, url: '/fallback' },
      { tags: null }, { tags: { line: [null] } }, { slotTypes: [null] }, { journeyStageFit: [null] }, { featuredProductIds: [{}] },
    ]) expect(normalize([{ id: 'p', ...invalid }], 'merge').ok, JSON.stringify(invalid)).toBe(false);
    for (const bad of ['{', 'null', '[]', '{"promotion":"1"}', '{"promotion":2}', '{"bad":0}']) {
      expect(normalize(parseCsv('id,merchandising\np,' + cell(bad)), 'merge').ok, bad).toBe(false);
    }
    expect(current.pieces).toEqual([original, { ...original, id: 'untouched' }]);
  });

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
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ content: [{ id: 'p1' }] })));
    const src = new HttpJsonSource('https://cms.example/export', 'content', fetchImpl);
    expect(await src.pull()).toEqual([{ id: 'p1' }]);
    expect(() => new HttpJsonSource('ftp://x', undefined, fetchImpl)).toThrow();
    const bad = new HttpJsonSource('https://cms.example/x', undefined, async () => new Response('{}', { status: 500 }));
    await expect(bad.pull()).rejects.toThrow('500');
  });
});

describe('W38.04 input admission', () => {
  it('W38.04 counts streamed local and direct remote bytes before parsing and preserves HTTP decoding', async () => {
    const encoder = new TextEncoder();
    const stream = (chunks: Uint8Array[]) => {
      let pulls = 0, cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(c) { const chunk = chunks[pulls++]; if (chunk) c.enqueue(chunk); else c.close(); },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 });
      return { body, state: () => ({ pulls, cancelled }) };
    };
    const base = JSON.stringify({ content: [{ id: 'é' }], padding: '' });
    const exact = encoder.encode(base.replace('"padding":""', `"padding":"${'x'.repeat(INPUT_MAX_BYTES - encoder.encode(base).length)}"`));
    expect(exact.length).toBe(INPUT_MAX_BYTES);
    const accepted = stream([new Uint8Array(), exact.subarray(0, 21), exact.subarray(21)]);
    const response = new Response(accepted.body, { headers: { 'Content-Length': '1' } });
    expect(await new HttpJsonSource('https://synthetic.invalid/feed', undefined, async () => response).pull()).toEqual([{ id: 'é' }]);
    expect(accepted.body.locked).toBe(false); expect(accepted.state().cancelled).toBe(false);
    for (const remote of [false, true]) {
      const over = stream([exact, new Uint8Array([32]), encoder.encode('must not be read')]);
      const parse = vi.spyOn(JSON, 'parse');
      try {
        const result = remote ? new HttpJsonSource('https://synthetic.invalid/feed', undefined,
          async () => new Response(over.body)).pull() : readInputJson(over.body, {});
        await expect(result).rejects.toMatchObject({ status: 413, code: 'input_budget_exceeded', budget: 'bytes', limit: INPUT_MAX_BYTES, observed: INPUT_MAX_BYTES + 1 });
        expect(parse).not.toHaveBeenCalled(); expect(over.state()).toEqual({ pulls: 2, cancelled: true }); expect(over.body.locked).toBe(false);
      } finally { parse.mockRestore(); }
    }
    const bytes = new Uint8Array([239, 187, 191, 34, 195, 34]); // BOM + JSON string with a malformed UTF-8 sequence.
    expect(await readInputText(stream([bytes.subarray(0, 2), bytes.subarray(2)]).body)).toBe(await new Response(bytes).text());
    expect(await readInputJson(new Response(bytes).body)).toBe('�');
    expect(await readInputJson(new Response('{').body, {})).toEqual({});
    expect(await readInputJson(null, {})).toEqual({});
    const broken = new ReadableStream<Uint8Array>({ pull() { throw new Error('synthetic private transport detail'); } });
    await expect(readInputJson(broken, {})).rejects.toMatchObject({ status: 400, code: 'input_unreadable', message: 'Input stream could not be read' });
    expect(broken.locked).toBe(false);
    console.log('W38.04 stream admission', JSON.stringify({ exact_bytes: exact.length, overflow_pulls: 2, overflow_cancelled: true, oversize_parsed: false }));
  });

  it('W38.04 bounds selected raw records and scanned and materialized CSV cells without changing admitted records', () => {
    const over = new Array(INPUT_MAX_RECORDS + 1).fill(null);
    let normalized = 0; Object.defineProperty(over, 0, { get() { normalized++; return { id: 'unused' }; } });
    for (const call of [() => recordsFromJson(over), () => recordsFromJson({ data: { rows: over } }, 'data.rows'),
      () => recordsFromJson({ pieces: over }), () => candidatesFrom(over), () => candidatesFrom(new Array(INPUT_MAX_RECORDS + 1))]) {
      expect(call).toThrow(expect.objectContaining({ status: 413, budget: 'records' }));
    }
    expect(normalized).toBe(0);
    expect(recordsFromJson(new Array(INPUT_MAX_RECORDS).fill(null))).toHaveLength(INPUT_MAX_RECORDS);
    expect(candidatesFrom(new Array(INPUT_MAX_RECORDS).fill(null))).toEqual([]);
    const records = Array.from({ length: 501 }, (_, i) => ({ id: `p${i}`, type: 'editorial', title: `T${i}`, slotTypes: ['story'] }));
    const candidates = candidatesFrom(records); expect(candidates).toHaveLength(501);
    expect(validateContentCatalog(assemble({ pieces: [] }, candidates, 'replace')).ok).toBe(true);
    expect(candidates.map(x => x.id)).toEqual(records.map(x => x.id));
    expect(parseCsv('id\n' + Array.from({ length: INPUT_MAX_RECORDS }, (_, i) => `p${i}`).join('\n'))).toHaveLength(INPUT_MAX_RECORDS);
    expect(() => parseCsv('id\n' + 'p\n'.repeat(INPUT_MAX_RECORDS + 1))).toThrow(expect.objectContaining({ budget: 'records' }));
    const header = Array.from({ length: 256 }, (_, i) => `c${i}`).join(',');
    expect(Object.keys(parseCsv(header + '\nx')[0]!)).toHaveLength(256);
    expect(() => parseCsv(header + ',extra\nx')).toThrow(expect.objectContaining({ budget: 'csv_fields' }));
    expect(() => parseCsv('id\n' + ','.repeat(256))).toThrow(expect.objectContaining({ budget: 'csv_fields' }));
    expect(() => parseCsv('\n'.repeat(100_000))).toThrow(expect.objectContaining({ budget: 'csv_cells' }));
    expect(() => parseCsv(header + '\n' + Array(391).fill('x').join('\n'))).toThrow(expect.objectContaining({ budget: 'csv_materialized_cells' }));
    const ten = Array.from({ length: 10 }, (_, i) => `c${i}`).join(',');
    expect(parseCsv(ten + '\n' + Array(9999).fill('x,x,x,x,x,x,x,x,x,x').join('\n'))).toHaveLength(9999);
    expect(() => parseCsv('é'.repeat(INPUT_MAX_BYTES / 2 + 1))).toThrow(expect.objectContaining({ budget: 'bytes' }));
    expect(parseCsv('\uFEFFid,title\r\na,"x,y\n""quoted"""\r\n')).toEqual([{ id: 'a', title: 'x,y\n"quoted"' }]);
    expect(parsePriorsCsv('slot,item,cell,p_prior,n_equiv\r\nstory,p1,,0.5,2')).toEqual({ rows: [{ slot: 'story', item: 'p1', cell: '*', p_prior: 0.5, n_equiv: 2 }] });
    expect(() => parsePriorsCsv('slot,item,cell,p_prior,n_equiv\n' + Array(INPUT_MAX_RECORDS + 1).fill('story,p1,*,0.5,2').join('\n'))).toThrow(expect.objectContaining({ budget: 'records' }));
  });
});
