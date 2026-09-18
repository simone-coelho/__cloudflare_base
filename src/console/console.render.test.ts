// src/console/console.render.test.ts
// The operator application rendered the way a browser renders it, against a fake
// platform, in the states that matter: signed out and signed in, a slot with a
// published snapshot and one without, the grid and its drill-down, the dials
// before and after a change.
//
// Three properties this file exists to hold, all of them doc 28's:
//
//   1. NOTHING UNBOUNDED. The application never asks for the whole snapshot
//      (GET /lift) or the whole catalog; every catalog-sized list is a page the
//      server cut, and Next carries the server's cursor back.
//   2. CELLS ARE A DRILL-DOWN. The grid asks for level=pooled; opening a piece
//      asks for level=cells with that item, and the URL says so, so the back
//      button works.
//   3. NO STRAY VALUE. Nothing on the page reads "null", "undefined" or "NaN",
//      in any state.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { SLOTS_KIND, validateSlotCatalog } from '@/content/kinds';
import { decideContent, type DecideInput } from '@/content/decide';
import type { SlotCatalog } from '@/content/types';
import type { SlotDiagnostics } from '@/content/slotDiagnostics';
import { slotsIndex } from '@/learn/rows';

const pub = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8');

it('W15 operator SSO completion preserves exact current tenant/login generation and uses only same-origin protected POSTs', async () => {
  for (const race of ['none', 'logout', 'tenant', 'password']) {
    const dom = new JSDOM('<html></html>', { url: 'https://operator.example/console', runScripts: 'outside-only' });
    const w = dom.window as unknown as { eval(source: string): unknown; localStorage: { getItem(key: string): string | null }; location: { search: string }; close(): void };
    let tenant = 'coach', release: () => void = () => undefined;
    const calls: Array<{ path: string; init: RequestInit }> = [], token = (id: string) => 'h.' + Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url') + '.s';
    const federated = { accessToken: token('federated'), refreshToken: 'local-oidc-refresh', user: { id: 'federated', authMode: 'oidc' } };
    Object.assign(w, { fetch: async (path: string, init: RequestInit) => {
      calls.push({ path, init });
      if (path.endsWith('/start')) return Response.json({ authorizationUrl: 'https://issuer.example/authorize?state=public-opaque' });
      if (path.endsWith('/complete')) { await new Promise<void>(resolve => { release = resolve; }); return Response.json(federated); }
      if (path.endsWith('/login')) return Response.json({ accessToken: token('password'), refreshToken: 'password-refresh', user: { id: 'password' } });
      return Response.json({ ok: true });
    } });
    try {
      w.eval(pub('operator-session.js'));
      const session = (w as unknown as { OperatorSession: { setTenantProvider(fn: () => string): void; startFederation(email: string): Promise<string>;
        completeFederation(): Promise<unknown>; signOut(): Promise<void>; signIn(email: string, password: string): Promise<unknown> } }).OperatorSession;
      session.setTenantProvider(() => tenant); expect(await session.startFederation('existing@example.invalid')).toBe('https://issuer.example/authorize?state=public-opaque');
      expect(w.localStorage.getItem('operator-session')).toBeNull(); const completion = session.completeFederation();
      if (race === 'logout') await session.signOut();
      if (race === 'tenant') { tenant = 'harbor'; session.setTenantProvider(() => tenant); }
      if (race === 'password') await session.signIn('other@example.invalid', 'synthetic password');
      release(); await completion;
      const stored = JSON.parse(w.localStorage.getItem('operator-session') || 'null');
      if (race === 'none') expect(stored).toMatchObject({ ...federated, mustChangePassword: false });
      else if (race === 'password') expect(stored).toMatchObject({ user: { id: 'password' }, refreshToken: 'password-refresh' });
      else expect(stored).toBeNull();
      for (const call of calls) { expect(call.path).not.toMatch(/token=|refresh=|https:/); expect(call.init).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'manual' }); }
      expect(new Headers(calls[1]!.init.headers).get('X-Tenant')).toBe('coach'); expect(calls[1]!.init.body).toBe('{}');
      expect(w.location.search).toBe('');
    } finally { release(); w.close(); }
  }
});

it('W14.07 renders only redacted SDK debug metadata and tears down every lifecycle listener',()=>{
  const dom=new JSDOM('<pre id="debug"></pre>',{runScripts:'outside-only'});
  const w=dom.window as unknown as {eval(source:string):unknown;close():void;
    document:{getElementById(id:string):{textContent:string|null}|null};
    debug:{dispose():void;snapshot():unknown[]};retained:unknown[];listenerCount():number;change():void};
  try{
    w.eval(pub('sdk/debug.js'));
    w.eval(`const listeners=new Map(),client={core:{on(name,callback){listeners.set(name,callback);return()=>listeners.delete(name);}}};
      window.debug=EdgePersonalizationDebug.attach(client,{enabled:true,limit:3,element:document.getElementById('debug')});
      listeners.get('sent')({token:'PRIVATE',userId:'PRIVATE'}, {via:'fetch'});
      listeners.get('decisions')({decisions:[{id:'PRIVATE'}]});listeners.get('update')({raw:'PRIVATE'},{rttMs:12.6,fromPush:true});
      window.retained=window.debug.snapshot();window.listenerCount=()=>listeners.size;window.change=()=>listeners.get('identity')({token:'PRIVATE'});`);
    const node=w.document.getElementById('debug')!;
    expect(node.textContent).not.toContain('PRIVATE');expect(node.textContent).toContain('"rttMs":13');expect(w.retained).toHaveLength(3);expect(w.listenerCount()).toBe(6);
    w.change();expect(w.debug.snapshot()).toHaveLength(1);expect(node.textContent).toContain('identity-changed');
    w.debug.dispose();w.debug.dispose();expect(w.listenerCount()).toBe(0);expect(node.textContent).toBe('');expect(w.debug.snapshot()).toEqual([]);
  }finally{w.close();}
});

it('W13 preserves presenter-time frames and renders single-act decision proof without undefined locals', async () => {
  const source = pub('meridian/meridian.js');
  const frame = source.slice(source.indexOf('function onFrame(f)'), source.indexOf('// ── Audience priority'));
  const predict = source.slice(source.indexOf('function predictThenProve('), source.indexOf('// ── THE GATE:'));
  const ids = ['pd-mode', 'pd-note', 'pd-go', 'pd-done', 'pd-act', 'pd-math', 'pd-will', 'pd-decisions', 'pd-why-map', 'pd-why'];
  const dom = new JSDOM(ids.map(id => `<div id="${id}"></div>`).join(''), { runScripts: 'outside-only' });
  const w = dom.window as unknown as { eval(source: string): unknown; close(): void;
    document: { getElementById(id: string): { innerHTML: string; hidden: boolean } | null } };
  try {
    w.eval(`const S = new Proxy({}, { get(){ throw Error('server frame adopted'); }, set(){ throw Error('server frame adopted'); } });\n${frame}\nonFrame({type:'meridian_update',seq:999,state:{dims:{changed:1}},source:'snapshot'}); onFrame({type:'unrelated'});`);
    w.eval(`const $=id=>document.getElementById(id), DONE=[], VERB_PAST={row_click:'Clicked'};
      const proof={moves:[],entered:[],exited:[],heroChanges:false,completion:false,climbs:0,blockChanges:false};
      const forecast=()=>proof, isStageAudience=()=>false, prettyAudience=x=>x, escapeHtml=x=>x;
      const decisionRows=f=>{if(f!==proof)throw Error('wrong forecast');return [{what:'actual decision'}]};
      const decisionsHtml=rows=>rows.map(x=>x.what).join(''), openBandRaw=()=>Promise.resolve('opened');
      ${predict}\nwindow.result=predictThenProve('row_click',{name:'Fixture'});`);
    await expect((dom.window as unknown as { result: Promise<string> }).result).resolves.toBe('opened');
    expect(w.document.getElementById('pd-decisions')!.innerHTML).toBe('actual decision');
    expect(w.document.getElementById('pd-why')!.hidden).toBe(false);
    expect(w.document.getElementById('pd-why-map')!.innerHTML).toBe('');
    const forecast = source.slice(source.indexOf('function forecast(action,'), source.indexOf('const VERB_PAST ='));
    w.eval(`(function(){
      const S={reflex:{dims:{}},config:{},registry:{dimensions:[]},vertical:'retail',items:[],blocks:[],pins:{},decisions:[]};
      const NOW=()=>100,stageTouchFor=()=>null,extractTouches=()=>[],rowPool=()=>[],SHAPE_OF_KEY={},decidingValueFor=()=>null;
      const snapshot=s=>JSON.parse(JSON.stringify(s)), byId=id=>({name:id,title:id});
      const apply=(copy,event)=>{if(copy===S.reflex)throw Error('live state used');copy.dims.changed=1;return {state:copy,changes:{entered:[],exited:[]}}};
      const compose=input=>{if(input.affinity.dims.changed!==1)throw Error('forecast not composed');return [{slot:'hero',itemId:'forecast-hero'},{slot:'row',itemId:'forecast-row'}]};
      ${forecast}
      window.forecastProof={result:forecast('row_click',{id:'record'}),live:S.reflex};
    })()`);
    const proof = (dom.window as unknown as { forecastProof: { result: Record<string, unknown>; live: unknown } }).forecastProof;
    expect(proof.live).toEqual({ dims: {} }); expect(proof.result.heroNextTitle).toBe('forecast-hero');
    expect(proof.result.picksNext).toEqual(['forecast-row']); expect(proof.result.nextDecisions).toHaveLength(2);
    const connect = source.slice(source.indexOf('function connect()'), source.indexOf('// ── The rest of the world'));
    w.eval(`(function(){const S={ws:{close(){throw Error('already closed')}}},RESET_EPOCH=1,API='/api',VID='fixture';
      class WebSocket { constructor(){window.connected=this;} } const onFrame=()=>{throw Error('bad frame')};
      ${connect}\nconnect();window.connected.onmessage({data:'malformed'});window.connected.onmessage({data:'{}'});
    })()`);
  } finally { w.close(); }
});

it('W13 keeps optional pointer capture and transform-only timer cleanup working', () => {
  const compare = pub('meridian/compare.js'), layout = pub('meridian/layout.js');
  const drag = compare.slice(compare.indexOf('  let dragging = false;'), compare.indexOf('  // Keys from inside'));
  const release = layout.slice(layout.indexOf('function release(el,'));
  const dom = new JSDOM('<div id="stage"></div>', { runScripts: 'outside-only' });
  const w = dom.window as unknown as Browser;
  try {
    w.eval(`const stage=document.getElementById('stage');stage.getBoundingClientRect=()=>({left:0,width:200});
      stage.setPointerCapture=()=>{throw Error('unsupported')};const u={stage},view={disabled:false},SEAM_DEFAULT=50;
      window.seams=[];const setSeam=x=>window.seams.push(x);${drag}
      const event=new Event('pointerdown',{cancelable:true});Object.assign(event,{pointerType:'mouse',button:0,pointerId:1,clientX:50});stage.dispatchEvent(event);window.prevented=event.defaultPrevented;
      stage.dispatchEvent(new Event('pointerup'));const move=new Event('pointermove');Object.assign(move,{clientX:100});stage.dispatchEvent(move);`);
    expect((dom.window as unknown as { seams: number[] }).seams).toEqual([25]);
    expect((dom.window as unknown as { prevented: boolean }).prevented).toBe(true);
    w.eval(`(function(){let callback;window.cleared=[];const setTimeout=(fn,ms)=>{callback=fn;window.delay=ms;return 7},clearTimeout=id=>window.cleared.push(id);
      ${release}
      stage.classList.add('flipping');release(stage,100,'ease',20);
      const other=new Event('transitionend');Object.assign(other,{propertyName:'opacity'});stage.dispatchEvent(other);window.stillFlipping=stage.classList.contains('flipping');
      const own=new Event('transitionend');Object.assign(own,{propertyName:'transform'});stage.dispatchEvent(own);window.cleaned=!stage.classList.contains('flipping');
      stage.classList.add('flipping');release(stage,100,'ease',20);callback();window.fallback=!stage.classList.contains('flipping');
    })()`);
    const result = dom.window as unknown as { delay: number; stillFlipping: boolean; cleaned: boolean; fallback: boolean; cleared: number[] };
    expect(result.delay).toBe(270); expect(result.stillFlipping).toBe(true); expect(result.cleaned).toBe(true); expect(result.fallback).toBe(true); expect(result.cleared).toEqual([7, 7]);
  } finally { w.close(); }
});

it('W11.02 Meridian retains its real remote publisher with authored base, reload retry and proved-conflict disposition', async () => {
  const source = pub('meridian/meridian.js'), publisher = source.slice(source.indexOf('const SHAPE_LABEL ='), source.indexOf('const PRISTINE_STRATEGIES ='));
  const dom = new JSDOM('<div id="cfgv"></div><div id="dial-foot"></div>', { url: 'https://synthetic.invalid/', runScripts: 'outside-only' });
  const w = dom.window as unknown as Browser & { sessionStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void } },
    calls: Array<{ url: string; method: string; body: string; headers: Record<string, string> }> = [];
  let mode = 'unknown';
  Object.assign(w, { TextEncoder, confirm: () => true, fetch: async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET'; calls.push({ url, method, body: String(init.body || ''), headers: init.headers as Record<string, string> });
    if (url.includes('/publication')) return Response.json({ code: 'publication_conflict' }, { status: 409 });
    if (method === 'PUT' && mode === 'unknown') throw new Error('Synthetic response lost');
    return Response.json({ ok: true, source: 'stored', revision: method === 'PUT' ? 3 : 2,
      document: { pages: { home: [{ slot: 'hero', take: 1, weights: { category: 0.5 } }] } },
      publication: { revision: 7, digest: 'a'.repeat(64) } });
  } });
  const load = () => w.eval('(function(){ const S={config:{version:"demo"}}, SLOT_STRATEGIES={hero:{broad:0.5}}, $=id=>document.getElementById(id);\n' + publisher
    + '\nwindow.publisher={load:loadSlotsFromStore,save:persistHeroToStore,continue:continueSlotsPublication};})()');
  const api = () => (w as unknown as { publisher: { load(): Promise<void>; save(note: string): void; continue(action?: string): Promise<void> } }).publisher;
  try {
    load(); api().save('local'); await new Promise(r => setTimeout(r, 370)); expect(calls).toEqual([]);
    w.sessionStorage.setItem('tuning-token', 'synthetic-session'); await api().load(); api().save('authored'); await new Promise(r => setTimeout(r, 370));
    const first = calls.find(c => c.method === 'PUT')!; expect(first.headers['If-Match']).toBe('"2/7/' + 'a'.repeat(64) + '"');
    expect(first.headers['X-Tenant']).toBe('meridian'); expect(w.document.body.textContent).toContain('acknowledgement unknown');
    load(); await api().continue(); const retry = calls.filter(c => c.method === 'PUT').at(-1)!;
    expect(retry.body).toBe(first.body); expect(retry.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key']);
    await api().continue('status');
    const discard = Array.from(w.document.querySelectorAll('button')).find(b => b.textContent === 'Discard conflicted draft')!; discard.click();
    expect(w.sessionStorage.getItem('meridian-slots-pending-v1')).toBe('null');
    const count = calls.length; api().save('cannot reuse stale base'); await new Promise(r => setTimeout(r, 370)); expect(calls).toHaveLength(count);
    await api().load(); mode = 'acknowledged'; api().save('reauthored'); await new Promise(r => setTimeout(r, 370));
    expect(w.document.querySelector('#cfgv')!.textContent).toBe('demo+r3');
    expect(w.document.body.textContent).toContain('Stored as revision 3'); expect(w.sessionStorage.getItem('meridian-slots-pending-v1')).toBe('null');
  } finally { w.close(); }
});

type Fixtures = { authority?: { customer: boolean; stampOwner: boolean; tenantRole?: string }; published?: boolean; slots?: boolean; learn?: Record<string, unknown>; dead?: boolean; enforced?: boolean; storedExpiryMs?: number; dayReport?: Record<string, unknown>; windowReport?: Record<string, unknown>;
  publicationReply?: (url: URL, method: string) => Response | undefined;
  reportGate?: (url: URL, method: string) => Promise<void>; contextGate?: () => Promise<void>; reportStatus?: number; buildStatus?: number; keepSavedOnBuild?: boolean;
  slotDocument?: SlotCatalog; registry?: Record<string, unknown>; registryStatus?: number; registryGate?: (tenant: string) => Promise<void>;
  pinFeedback?: (document: SlotCatalog, revision: number | null, operation: string, tenant: string) => Promise<SlotDiagnostics | null>; historyGate?: () => Promise<void>; liveSlotIndex?: boolean };
type CapturedRequest = { url: string; method: string; headers: Record<string, string> };

const SLOTS = {
  ok: true, tenant: 'coach', brand: 'coach', q: null, total: 3,
  pages: [
    { page: 'home', slots: [
      { page: 'home', slot: 'chero', take: 1, pinned: null, dimensions: ['contentType', 'line'], rules: ['freshness'], pieces: 18, reward: 'click', objective: 'unit', gamma: 0, exploration: 'off', autonomy: 'configured', controls: 1, evidence: { items: 2, events: 22, publishedAt: 1_788_000_000_000 } },
      { page: 'home', slot: 'merch', take: 1, pinned: 'cnt_m', dimensions: [], rules: [], pieces: 3, reward: 'click', objective: 'unit', gamma: 0, exploration: 'off', autonomy: 'configured', controls: 0, evidence: null },
    ] },
    { page: 'plp', slots: [
      { page: 'plp', slot: 'strip', take: 3, pinned: null, dimensions: ['category'], rules: ['stage', 'diversity'], pieces: 9, reward: 'purchase', objective: 'revenue', gamma: 0.5, exploration: 'rotation', autonomy: 'assisted', controls: 0, evidence: null },
    ] },
  ],
};

const row = (item: string, over: Record<string, unknown> = {}) => ({
  item, customer_item_id: `CCH-${item.slice(-3)}`, title: `The ${item} story`, key: '*', level: 0, level_words: 'everyone',
  n: 20.816, s: 1.977, p0: 0.074, p_hat: 0.083, lift: 1.116, n0: 30, evidence: 0.41, prior: null, control: null, ...over,
});
const PAGE1 = {
  ok: true, tenant: 'coach', brand: 'coach', slot: 'chero', version: 1_788_000_000_000, published: true,
  publishedAt: 1_788_000_000_000, reward: 'click', objective: 'unit', n0: 30, nMin: 30,
  level: 'pooled', item: null, q: null, sort: 'lift', dir: 'desc', total: 312, offset: 0, limit: 50,
  rows: [row('cnt_aaa'), row('cnt_bbb', { control: 'freeze' }), row('cnt_ccc', { prior: { p: 0.5, n: 200 } })],
  cursor: 'CURSOR-2',
};
const PAGE2 = { ...PAGE1, offset: 50, rows: [row('cnt_ddd')], cursor: null };
const CELLS = {
  ...PAGE1, level: 'cells', item: 'cnt_aaa', total: 2, offset: 0, cursor: null,
  rows: [row('cnt_aaa'), row('cnt_aaa', { key: 'channel=email', level: 1, level_words: 'channel' })],
};
const EMPTY = { ok: true, tenant: 'coach', brand: 'coach', slot: 'chero', version: 0, published: false, level: 'pooled', total: 0, offset: 0, limit: 50, rows: [], cursor: null };

const REFLEX = {
  version: 'reflex-demo-v1+r3', tauMs: 60_000, K: 1.8, thetaIn: 0.6, thetaOut: 0.45, epsilon: 0.0001, maxValuesPerDim: 24,
  weights: { product_view: 1, pdp_view: 1, view_product: 1, wishlist: 2, wishlist_add: 2, add_to_wishlist: 2, save_for_later: 2, add_to_cart: 3, cart_add: 3, purchase: 5, checkout: 5, order_complete: 5, content_impression: 0, content_dwell: 0.5, content_click: 1, video_complete: 2, tick: 0, try_on: 4 },
  dimensions: [
    { key: 'line', source: 'line' },
    { key: 'priceBand', source: 'price_usd', derive: 'band', cuts: [150, 400], labels: ['entry', 'core', 'elevated'], tauMs: 150_000 },
  ],
};
const SLOTS_DOC: SlotCatalog = { version: 'slots-coach', pages: { home: [
  { slot: 'chero', take: 2, weights: { line: 0.35 }, freshness: { weight: 0.2, halfLifeDays: 14 } },
  { slot: 'merch', take: 1, weights: {}, pinnedPieceId: 'cnt_m' },
] } };

const CMP = {
  control: { arm: 'default', n: 220, s: 7, rate: { p: 0.0318, lo: 0.0155, hi: 0.0641 } },
  treatment: { arm: 'personalized', n: 4000, s: 166, rate: { p: 0.0415, lo: 0.0358, hi: 0.048 } },
  difference: { p: 0.0097, lo: -0.0243, hi: 0.0271 }, relative: 0.305, verdict: 'undecided',
  neededPerArm: 4820, confidence: 0.95,
  alsoAt: { confidence: 0.9, difference: { p: 0.0097, lo: -0.019, hi: 0.024 }, verdict: 'undecided' },
  targets: { targets: { minimum: 0.1, target: 0.4, stretch: 0.6 }, relativeLow: -0.76, relativeHigh: 0.85, standing: 'on_track' },
  words: 'personalized 4.2% of 4,000 decisions vs default 3.2% of 220: +1.0 points (+31% relative); the 95% interval runs −2.4 points to +2.7 points, so not yet distinguishable from zero.',
};
const WINDOW = {
  compatibility: { version: 1, experimental: 'unverified' },
  tenant: 'coach', brand: 'coach', from: '2026-08-09', to: '2026-09-05', days: ['2026-09-04', '2026-09-05'], missing: ['2026-09-03'], confidence: 0.95,
  incomplete: [{ date: '2026-09-04', truncated: true, missingHours: [13] }],
  slots: { chero: { arms: [
    { arm: 'default', n: 0, s: 2, rate: { p: 0.0318, lo: 0.0155, hi: 0.0641 } },
    { arm: 'personalized', n: 1, s: 3, rate: { p: 0.0415, lo: 0.0358, hi: 0.048 } },
  ], comparisons: [CMP], compatibility: { status: 'compatible', reasons: [], days: ['2026-09-04', '2026-09-05'] } } },
};
const DAY = {
  tenant: 'coach', brand: 'coach', date: '2026-09-05', builtAt: 1_788_000_000_000,
  counts: { decisions: 117, outcomes: 9, visitors: 9, truncated: true },
  hours: { source: 'aggregates', built: [12], missing: [13] },
  policies: [{ name: 'learning', role: 'learning', credits: 4 }, { name: 'visitor-scope', role: 'reporting', credits: 9 }],
  grids: { chero: { learning: { items: { cnt_aaa: { '*': { n: 20.8, s: 2, p_hat: 0.083, lift: 1.116 } } } }, 'visitor-scope': { items: { cnt_aaa: { '*': { n: 20.8, s: 4, p_hat: 0.14, lift: 1.4 } } } } } },
  exploration: [{ slot: 'chero', decisions: 96, explored: 9, realized: 0.094, configured: 0.1, mode: 'rotation' }],
  holdout: { chero: [{ arm: 'default', decisions: 0, credited: 2, rate: 0.25 }, { arm: 'personalized', decisions: 1, credited: 3, rate: 0.5 }] },
  holdoutComparison: { chero: [CMP] },
};

const LEARN_OFF = { holdout: { share: 0.05, salt: '', arms: ['default'] }, slots: {} };
const LEARN_ON = {
  holdout: { share: 0.1, salt: 'x', arms: ['default', 'no_learning'] },
  policy: { scope: 'visitor', match: 'any', credit: 'first', windowsMs: { click: 1_800_000 } },
  stats: { n0: 30, tauLearnMs: 1_814_400_000, liftMin: 0.5, liftMax: 2, nMin: 30 },
  regional: { enabled: true, kBlend: 1, minEvents: 30 },
  external: { kind: 'table', ref: 'MODEL', timeoutMs: 20, fallback: 'omit' },
  slots: { chero: { gamma: 0.5, reward: 'purchase', objective: 'revenue', exploration: { mode: 'rotation', share: 0.1, floor: 50 }, autonomy: { mode: 'assisted', step: 0.05, min: 0, max: 1, pinned: ['line'], minN: 500 }, external: { weight: 0.3 }, items: { cnt_bbb: { mode: 'freeze', lift: 1.2 } } } },
};

/** A fake platform: what each route the application reads answers with. */
function platform(fx: Fixtures, log: string[], saved: Array<Record<string, unknown>>, requests: CapturedRequest[]) {
  let built: Record<string, unknown> | undefined;
  // Local HTTP persistence, not backend transaction/propagation assurance.
  let slotRevision = 4;
  const slotRevisions = new Map([[4, { document: structuredClone(fx.slotDocument ?? SLOTS_DOC) as SlotCatalog, note: 'retained slot settings' }]]);
  const okJson = (body: unknown, status = 200) => {
    const value = body as Record<string, unknown>;
    const reply = value && value.revision ? { ...value, publication: { revision: 7, digest: 'a'.repeat(64) },
      ...(value.config ? { authored: value.config } : {}) } : body;
    return { ok: status < 300, status, json: async () => reply };
  };
  return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const u = new URL(url, 'http://console.test');
    const p = u.pathname + u.search;
    log.push(`${init?.method || 'GET'} ${p}`);
    const headers = Object.fromEntries(new Headers(init?.headers));
    requests.push({ url: p, method: init?.method || 'GET', headers });
    const publicationReply = fx.publicationReply?.(u, init?.method || 'GET');
    if (publicationReply) return publicationReply;
    // A platform that is up but broken: the shape of a store whose migrations
    // were never applied, which is how POST /auth/login answered 500 and every
    // screen behind it looked like it was still loading.
    if (fx.dead) return okJson({ error: 'Internal server error', message: 'D1_ERROR: no such table' }, 500);
    const signed = Boolean(init?.headers?.authorization);
    // Local caller-contract stub, not a substitute for accepted backend grant proof.
    const tenant = headers['x-tenant'];
    const configScope = tenant === 'brighthour' ? 'tenant:brighthour' : tenant;
    if (u.pathname.startsWith('/config/') && u.searchParams.has('tenant') &&
      u.searchParams.get('scope') !== (u.searchParams.get('tenant') === 'brighthour' ? 'tenant:brighthour' : u.searchParams.get('tenant'))) return okJson({ error: 'Conflicting scope' }, 400);
    if (fx.enforced && !u.pathname.startsWith('/auth/')) {
      if (!signed) return okJson({ error: 'Authorization token required' }, 401);
      const selected = u.pathname.startsWith('/v1/') ? u.pathname.split('/')[2] : u.searchParams.get('scope');
      if (!tenant || (selected && selected !== (u.pathname.startsWith('/config/') ? configScope : tenant))) return okJson({ error: 'Tenant scope unavailable' }, 403);
    }
    // Reuse display data after capturing and checking the actual destination.
    u.pathname = u.pathname.replace(/^\/v1\/[^/]+\//, '/v1/coach/');
    if (u.pathname === '/v1/coach/learn/slots') {
      await fx.contextGate?.();
      const query = u.searchParams.get('q');
      const source = fx.liveSlotIndex ? slotsIndex(slotRevisions.get(slotRevision)!.document, { pieces: [] }, { holdout: { share: 0, salt: '', arms: ['default'] } }, Date.now()) : SLOTS;
      const pages = query ? source.pages.map(page => ({ ...page, slots: page.slots.filter(slot => slot.slot.includes(query)) })).filter(page => page.slots.length) : source.pages;
      return okJson(fx.slots === false ? { ok: true, total: 0, pages: [] } : { ...SLOTS, pages, total: pages.reduce((n, page) => n + page.slots.length, 0) });
    }
    if (u.pathname === '/v1/coach/lift/rows') {
      if (fx.published === false) return okJson(EMPTY);
      if (u.searchParams.get('cursor')) return okJson(PAGE2);
      if (u.searchParams.get('level') === 'cells') return okJson(CELLS);
      return okJson(PAGE1);
    }
    if (u.pathname === '/v1/coach/learn/proposals') {
      return signed
        ? okJson({ ok: true, proposals: [{ id: 'p1', slot: 'chero', dimension: 'line', from: 0.25, to: 0.3, exposures: 900, mode: 'assisted', status: 'proposed', at: 1_788_000_000_000, note: 'the cycle', evidence: [{ dimension: 'line', spread: 0.12 }] }] })
        : okJson({ ok: false, error: 'unauthorized' }, 401);
    }
    if (u.pathname === '/v1/coach/ledger/erasures') {
      return signed
        ? okJson({ ok: true, retentionDays: 90, pending: [{ visitor_id: 'vis-1', erased_at: 1_788_000_000_000, actor: 'ops', rows_removed: 4, objects_rewritten: 1 }] })
        : okJson({ ok: false, error: 'unauthorized' }, 401);
    }
    if (u.pathname === '/v1/coach/learn/report/window') {
      const result = structuredClone(fx.windowReport ?? WINDOW); await fx.reportGate?.(u, 'GET');
      return signed ? okJson({ ok: true, report: result }) : okJson({ ok: false, error: 'unauthorized' }, 401);
    }
    if (u.pathname === '/v1/coach/learn/report') {
      const method = init?.method || 'GET', input = JSON.parse(init?.body || '{}');
      if (method === 'POST') { saved.push(input); if (!fx.keepSavedOnBuild) built = { ...DAY, date: input.date }; }
      const raw = method === 'POST' ? DAY : built ?? fx.dayReport;
      if (!signed || !raw) return okJson({ ok: false, error: 'no report built for that day yet' }, signed ? 404 : 401);
      const report: Record<string, unknown> = { ...structuredClone(raw), tenant, brand: u.searchParams.get('brand') || input.brand || tenant, date: input.date || u.searchParams.get('date') };
      const reply = { ok: true, report, ...(method === 'GET' && u.searchParams.has('slot') ? { page: measurePage(report, u) } : {}) };
      const status = method === 'GET' ? fx.reportStatus ?? 200 : fx.buildStatus ?? 200;
      await fx.reportGate?.(u, method);
      return status === 200 ? okJson(reply) : okJson({ ok: false, error: 'report changed' }, status);
    }
    if (u.pathname === '/v1/coach/learn/exploring') {
      return okJson({
        ok: true, tenant: 'coach', brand: 'coach', slot: 'chero', version: 1_788_000_000_000, published: true,
        mode: 'rotation', share: 0.1, floor: 50, total: 2, offset: 0, limit: 50, cursor: null,
        rows: [
          { item: 'cnt_new', customer_item_id: 'CCH-NEW', title: 'The new story', n: 3.2, to_floor: 46.8 },
          { item: 'cnt_thin', customer_item_id: null, title: null, n: 11, to_floor: 39 },
        ],
      });
    }
    if (/^\/v1\/coach\/visitors\/[^/]+\/receipts$/.test(u.pathname)) {
      if (!signed) return okJson({ ok: false, error: 'unauthorized' }, 401);
      if (u.pathname.includes('erased-one')) return okJson({ ok: false, error: 'erased at the visitor\'s request' }, 410);
      return okJson({
        ok: true, tenant: 'coach', visitor_id: 'vis-1', total: 1, offset: 0, limit: 50, cursor: null,
        receipts: [{
          decision_id: 'd1', at: 1_788_000_000_000, page: 'home', slot: 'chero', position: 0,
          item: 'cnt_aaa', customer_item_id: 'CCH-AAA', title: 'The Tabby story', arm: 'personalized',
          explored: false, authority: 'engine', context: 'email, third visit, considering, in US-NY, leading interest line tabby',
          score_base: 0.42, score_final: 0.58,
          why: ['Interest matched: line tabby (interest 0.8 × weight 0.35).', 'What is trending in US-NY contributed 0.04.'],
        }],
      });
    }
    if (u.pathname === '/v1/coach/lift/history') return okJson({ ok: true, versions: [{ version: 1_788_000_000_000, size: 2048, uploaded: '2026-09-05T00:00:00Z' }] });
    if (u.pathname === '/content/slots/history') {
      const revisions = [...slotRevisions].reverse().map(([revision, row]) => ({
        revision, version: row.document.version, actor: 'Local Ops', note: row.note, at: 1_788_000_000_000,
      }));
      await fx.historyGate?.(); return okJson({ ok: true, revisions });
    }
    if (u.pathname.startsWith('/content/slots/rollback/')) {
      const previous = slotRevisions.get(Number(u.pathname.split('/').at(-1)));
      if (!previous) return okJson({ ok: false }, 404);
      const valid = validateSlotCatalog(previous.document);
      if (!valid.ok) return okJson({ ok: false, errors: valid.errors }, 404);
      slotRevision++;
      const revision = slotRevision, document = SLOTS_KIND.stamp!(valid.value, revision);
      slotRevisions.set(revision, { document, note: 'rollback' });
      const pinDiagnostics = await fx.pinFeedback?.(document, revision, 'rollback', tenant);
      return okJson({ ok: true, revision, pinDiagnostics });
    }
    if (u.pathname.endsWith('/history')) {
      const kind = u.pathname.split('/').slice(-2)[0];
      return okJson({ ok: true, revisions: kind === 'priors' ? [] : [
        { revision: 2, version: `${kind}-v1+r2`, actor: 'Local Ops', note: 'the second', at: 1_788_000_000_000 },
        { revision: 1, version: `${kind}-v1+r1`, actor: 'ops', note: 'the first', at: 1_787_000_000_000 },
      ] });
    }
    if (u.pathname.includes('/rollback/')) return okJson({ ok: true, revision: 7 });
    if (u.pathname === '/config/reflex/validate') return okJson({ valid: true, errors: [], warnings: [] });
    if (u.pathname === '/config/reflex') {
      if (init?.method === 'PATCH') {
        saved.push(JSON.parse(init.body || '{}') as Record<string, unknown>);
        return okJson({ ok: true, revision: 4, version: 'reflex-demo-v1+r4', config: REFLEX });
      }
      const config = structuredClone(fx.registry ?? REFLEX), status = fx.registryStatus ?? 200;
      await fx.registryGate?.(tenant);
      if (status !== 200) return okJson({ error: 'Registry unavailable' }, status);
      return okJson({
        scope: 'coach', source: 'stored', revision: 3, actor: 'ops', note: 'first', at: 1_788_000_000_000,
        config, inherited: ['content_click', 'content_dwell', 'content_impression', 'video_complete'],
        warnings: ["dimension 'contentType' (source 'contentType') is in the compiled default and not in this document"],
      });
    }
    if (u.pathname === '/content/slots/validate') {
      const body = JSON.parse(init?.body || '{}') as { document?: unknown };
      const valid = validateSlotCatalog(body.document);
      return valid.ok ? okJson({ valid: true, document: valid.value, pinDiagnostics: await fx.pinFeedback?.(valid.value, null, 'validate', tenant) }) : okJson({ valid: false, errors: valid.errors }, 422);
    }
    if (u.pathname === '/content/slots') {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body || '{}') as Record<string, unknown>;
        const valid = validateSlotCatalog(body.document);
        if (!valid.ok) return okJson({ ok: false, errors: valid.errors }, 422);
        saved.push(body);
        slotRevision++;
        const document = SLOTS_KIND.stamp!(valid.value, slotRevision);
        slotRevisions.set(slotRevision, { document, note: String(body.note ?? '') });
        const revision = slotRevision, pinDiagnostics = await fx.pinFeedback?.(document, revision, 'PUT', tenant);
        return okJson({ ok: true, revision, document, pinDiagnostics });
      }
      const revision = slotRevision, document = structuredClone(slotRevisions.get(revision)!.document);
      return okJson({ ok: true, source: 'stored', revision, document, pinDiagnostics: await fx.pinFeedback?.(document, revision, 'GET', tenant) });
    }
    if (u.pathname === '/content/learn/validate') return okJson({ valid: true, errors: [] });
    if (u.pathname === '/content/learn') {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body || '{}') as Record<string, unknown>;
        saved.push(body);
        return okJson({ ok: true, revision: 9, document: body.document });
      }
      return okJson({ ok: true, source: 'stored', revision: 2, document: fx.learn || LEARN_OFF });
    }
    if (u.pathname === '/auth/login' || u.pathname === '/auth/refresh') {
      const b = JSON.parse(init?.body || '{}') as { email?: string; password?: string };
      if (u.pathname === '/auth/login' && b.password !== 'right-password' && b.password !== 'temp-password') return okJson({ error: 'Invalid credentials' }, 401);
      const token = 'h.' + Buffer.from(JSON.stringify({ sub: 'ops-1', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url') + '.s';
      return okJson({ accessToken: token, refreshToken: 'r', user: { id: 'ops-1', email: b.email, name: 'Test Operator', roles: ['admin'] }, mustChangePassword: b.password === 'temp-password', expiresIn: 900 });
    }
    if (u.pathname === '/auth/password') {
      const b = JSON.parse(init?.body || '{}') as { newPassword?: string };
      saved.push({ passwordChangedTo: b.newPassword });
      const token = 'h.' + Buffer.from(JSON.stringify({ type: 'access', sid: 'replacement-session', exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url') + '.s';
      return okJson({ ok: true, accessToken: token, refreshToken: 'replacement-refresh', mustChangePassword: false,
        user: { id: 'ops-1', email: 'ops@brand.test', name: 'Test Operator', roles: ['operator'] } });
    }
    if (u.pathname === '/auth/authority') return signed ? okJson(fx.authority ?? { customer: false, stampOwner: true }) : okJson({ error: 'unauthorized' }, 401);
    if (u.pathname === '/auth/memberships' && init?.method !== 'POST') return okJson({ ok: true, users: [
      { id: 'ops-1', accountId: 'ops-1', email: 'ops@brand.test', name: 'Test Operator', role: 'admin', roles: ['admin'], revision: 'member-self', disabled: false },
      { id: 'ops-2', accountId: 'ops-2', email: 'buyer@brand.test', name: 'A Buyer', role: 'operator', roles: ['operator'], revision: 'member-buyer', disabled: false },
    ] });
    if (u.pathname === '/auth/memberships' && init?.method === 'POST') { saved.push({ membership: JSON.parse(init.body || '{}') }); return okJson({ ok: true }, 201); }
    if (u.pathname.startsWith('/auth/memberships/')) { saved.push({ membershipPath: u.pathname, method: init?.method, body: init?.body }); return okJson({ ok: true }); }
    if (u.pathname === '/auth/users' && init?.method !== 'POST') {
      return signed ? okJson({ ok: true, users: [
        { id: 'ops-1', email: 'ops@brand.test', name: 'Test Operator', roles: ['admin'], disabled: false, mustChangePassword: false, lastSignInAt: 1_788_000_000_000 },
        { id: 'ops-2', email: 'buyer@brand.test', name: 'A Buyer', roles: ['operator'], disabled: false, mustChangePassword: true, lastSignInAt: null },
      ] }) : okJson({ ok: false, error: 'unauthorized' }, 401);
    }
    if (u.pathname === '/auth/users' && init?.method === 'POST') {
      const b = JSON.parse(init.body || '{}') as { email?: string };
      saved.push({ createdAccount: b.email });
      return okJson({ ok: true, user: { id: 'ops-3', email: b.email, name: 'New', roles: ['operator'] }, temporaryPassword: 'Temp-1234-Temp' }, 201);
    }
    if (u.pathname === '/auth/audit') {
      return signed ? okJson({ ok: true, entries: [
        { at: 1_788_000_000_000, action: 'sign_in', actorEmail: null, targetEmail: 'ops@brand.test' },
        { at: 1_787_900_000_000, action: 'account_created', actorEmail: 'ops@brand.test', targetEmail: 'buyer@brand.test' },
      ] }) : okJson({ ok: false, error: 'unauthorized' }, 401);
    }
    if (u.pathname === '/auth/logout') return okJson({ success: true });
    return okJson({ ok: false, error: `unstubbed ${p}` }, 404);
  };
}

/** Only the browser protocol is synthetic; route/identity coverage uses actual Hono separately. */
function measurePage(report: Record<string, unknown>, u: URL) {
  const slot = u.searchParams.get('slot')!, offset = Number((u.searchParams.get('cursor') || 'page-0').slice(5));
  type Snap = { items: Record<string, Record<string, unknown>>; slotRates?: Record<string, unknown> };
  const grid = (report.grids as Record<string, Record<string, Snap>>)[slot];
  const names = (report.policies as Array<{ name: string }>).map(p => p.name), items = [...new Set(names.flatMap(n => Object.keys(grid?.[n]?.items ?? {})))].sort(), projected: Record<string, unknown> = {};
  if (grid) for (const n of names) if (grid[n]) {
    const s = grid[n]!; projected[n] = { ...s, items: Object.fromEntries(items.slice(offset, offset + 50).filter(i => s.items[i]).map(i => [i, s.items[i]!['*'] ? { '*': s.items[i]!['*'] } : {}])), slotRates: s.slotRates?.['*'] ? { '*': s.slotRates['*'] } : {} };
  }
  report.grids = grid ? { [slot]: projected } : {};
  return { slot, revision: 'a'.repeat(64), total: items.length, offset, limit: 50, next: offset + 50 < items.length ? 'page-' + (offset + 50) : null, previous: offset ? 'page-' + (offset - 50) : null };
}

type El = {
  value: string; hidden: boolean; disabled: boolean; textContent: string | null; dataset: Record<string, string>;
  firstChild: { textContent: string | null } | null;
  click: () => void; focus: () => void; getAttribute: (name: string) => string | null;
  querySelectorAll: (sel: string) => ArrayLike<El>; querySelector: (sel: string) => El | null;
  dispatchEvent: (e: unknown) => boolean;
};
type Browser = Record<string, unknown> & {
  document: { body: El; getElementById: (id: string) => unknown; querySelectorAll: (sel: string) => ArrayLike<El>; querySelector: (s: string) => El | null };
  eval: (s: string) => unknown; close: () => void; location: { hash: string };
  localStorage: { setItem: (key: string, value: string) => void };
  Event: new (type: string, options: object) => unknown;
};

async function open(fx: Fixtures = {}, hash = '#/work?scope=coach') {
  const log: string[] = [];
  const saved: Array<Record<string, unknown>> = [];
  const requests: CapturedRequest[] = [];
  const intervals: Array<() => void> = [];
  const dom = new JSDOM(pub('console/index.html'), { url: `http://console.test/console/${hash}`, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as unknown as Browser;
  w.fetch = platform(fx, log, saved, requests);
  w.Headers = Headers;
  w.TextEncoder = TextEncoder;
  w.setInterval = (callback: () => void) => { intervals.push(callback); return intervals.length; };
  if (fx.storedExpiryMs !== undefined) w.localStorage.setItem('operator-session', JSON.stringify({ accessToken: 'stale-token', refreshToken: 'synthetic-refresh', exp: Date.now() + fx.storedExpiryMs, user: { name: 'Test Operator' } }));
  w.confirm = () => true;
  w.eval(pub('operator-session.js'));
  intervals.forEach(callback => callback()); // even a timer before page wiring must not refresh
  const beforePageRequests = requests.length;
  w.eval(pub('console/shell.js'));
  w.eval(pub('console/views.js'));
  w.eval(pub('console/views-config.js'));
  w.eval(pub('console/views-measure.js'));
  w.eval(pub('console/views-accounts.js'));
  w.eval(pub('console/views-explore.js'));
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 12)); };
  /** Long enough for the dials' validator, which waits 350ms after the last keystroke. */
  const settleChecked = async () => { await new Promise((r) => setTimeout(r, 450)); await settle(); };
  await settle();
  const $ = (id: string) => w.document.getElementById(id) as unknown as El;
  const all = (sel: string) => Array.from(w.document.querySelectorAll(sel));
  const text = () => (w.document.body.textContent || '').replace(/\s+/g, ' ');
  const signIn = async (password = 'right-password') => {
    $('sign-in').click(); await settle();
    $('si-email').value = 'ops@brand.test'; $('si-password').value = password;
    $('sign-in-form').dispatchEvent(new (w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
    await settle(); await settle();
  };
  const goTo = async (h: string) => { w.location.hash = h; await settle(); await settle(); };
  return { w, log, saved, requests, intervals, beforePageRequests, $, all, text, settle, settleChecked, signIn, goTo, close: () => w.close() };
}

const STRAY = /\b(null|undefined|NaN)\b/;
/** JSON null is deliberate editor syntax, not a leaked value. Exempt only these
 * exact authored labels/sentences; dynamic content and other screens stay guarded. */
function expectNoStrayRulesText(text: string) {
  for (const authored of [
    'Pinned internal piece IDs (JSON string, array or null)',
    '[] or null clears.',
    'Allowed rendering types (JSON array or null)',
    'Matches piece.type exactly, not tags.contentType. Use 1–1000 distinct strings of 1–1024 UTF-16 units; [] is invalid, null removes the limit.',
  ]) text = text.replaceAll(authored, '');
  expect(text).not.toMatch(STRAY); expect(text).not.toContain('[object Object]');
}

/** No screen may sit on a spinner: a load that failed has to say so. */
const STILL_LOADING = /Loading the |Loading…/;


describe('the operator application, rendered', () => {
  it('W15 renders explicit basis controls, default-off exploration and exact basis/unit CSV without hiding old served rows', async () => {
    const c = await open({ learn: LEARN_ON });
    try {
      await c.signIn(); await c.goTo('#/dials?scope=coach&slot=chero');
      const select = c.w.document.querySelector('[data-focus-key="slots.chero.measurementBasis"]')!;
      expect(select.value).toBe('served-v1'); select.value = 'rendered-v1';
      select.dispatchEvent(new c.w.Event('change', { bubbles: true })); await c.settleChecked();
      expect(c.text()).toContain('reset'); c.$('save').click(); await c.settle();
      expect((c.saved.at(-1)!.document as { slots: { chero: { measurementBasis: string; objective: string } } }).slots.chero).toMatchObject({ measurementBasis: 'rendered-v1', objective: 'revenue' });
      const source = pub('console/views.js'), start = source.indexOf('  function downloadPage('), end = source.indexOf('\n  //', start);
      c.w.eval(`(function(){ const S={scope:'coach',slot:'hero'}, csv=rows=>JSON.stringify(rows), download=(name,body)=>{window.w15csv={name,rows:JSON.parse(body)}};
        ${source.slice(start, end)}
        downloadPage([{item:'rendered',key:'*',measurementBasis:'rendered-v1',objective:'revenue',n:2,s:80,p_hat:30,p0:20,lift:1.5,n0:30,evidence:0.1},
          {item:'legacy',key:'*',n:1,s:0,p_hat:0,p0:0,lift:1,n0:30,evidence:0}],null); })()`);
      const csv = (c.w.w15csv as { rows: unknown[][] }).rows;
      expect(csv[0]).toContain('measurement_basis'); expect(csv[0]).toContain('credit_per_exposure_p_hat');
      expect(csv[1]!.slice(4, 6)).toEqual(['rendered-v1', 'revenue']); expect(csv[2]!.slice(4, 6)).toEqual(['served-v1', 'unit']);
    } finally { c.close(); }
  });
  it('W32.05 pages saved comparisons and withholds stale context, navigation and build completions', async () => {
    const items = Object.fromEntries(Array.from({ length: 121 }, (_, i) => ['item-' + String(i).padStart(3, '0'), { '*': { n: i, s: i / 10, lift: 1 }, 'c=not-rendered': { n: 3 } }]));
    const fx: Fixtures = { dayReport: { ...DAY, grids: { chero: { learning: { items } }, merch: { learning: { items: { 'other-slot': {} } } } } }, keepSavedOnBuild: true };
    const c = await open(fx);
    try {
      await c.signIn(); await c.goTo('#/measure?scope=coach&slot=chero');
      const click = (label: string) => c.all('#view button').find(b => b.textContent === label)!.click();
      const shown = () => c.all('#view .itemid').map(e => e.textContent);
      expect(shown()).toHaveLength(50); expect(shown()[0]).toBe('item-000'); expect(c.text()).toContain('121 items, showing 1 to 50');
      click('Next'); await c.settle(); expect(shown()[0]).toBe('item-050'); expect(shown()).toHaveLength(50);
      click('Previous'); await c.settle(); expect(shown()[0]).toBe('item-000');
      expect(c.requests.filter(r => r.url.includes('/learn/report?') && r.method === 'GET').every(r => r.url.includes('slot=chero') && r.url.includes('limit=50'))).toBe(true);
      fx.reportStatus = 409; click('Next'); await c.settle(); expect(shown()).toEqual([]); expect(c.text()).toContain('Report changed');
      fx.reportStatus = 200; click('Reload first page'); await c.settle(); expect(shown()[0]).toBe('item-000');
      let release!: () => void;
      fx.reportGate = async (u) => { if (u.searchParams.get('cursor')) await new Promise<void>(r => { release = r; }); };
      click('Next'); await c.settle(); expect(typeof release).toBe('function');
      await c.goTo('#/measure?scope=coach&slot=merch'); expect(shown()).toEqual(['other-slot']); release(); await c.settle(); expect(shown()).toEqual(['other-slot']);
      fx.reportGate = undefined; await c.goTo('#/measure?scope=coach&slot=chero');
      // A normal refresh retains the signed user and does not strand an in-flight page.
      fx.reportGate = async (u) => { if (u.searchParams.get('cursor')) await new Promise<void>(r => { release = r; }); };
      click('Next'); await c.settle(); await (c.w.OperatorSession as { refresh: () => Promise<unknown> }).refresh(); release(); await c.settle(); expect(shown()[0]).toBe('item-050');
      // Leaving and returning cannot resurrect the old page; capture listener runs before shell routing.
      click('Next'); await c.settle(); await c.goTo('#/work?scope=coach&slot=chero'); release(); await c.settle();
      fx.reportGate = undefined; await c.goTo('#/measure?scope=coach&slot=chero'); expect(shown()[0]).toBe('item-000');
      fx.contextGate = () => new Promise<void>(r => { release = r; });
      await c.goTo('#/measure?scope=meridian&slot=chero');
      expect(typeof release).toBe('function'); expect(shown()).toEqual([]); expect(c.text()).not.toContain('Over the window · chero');
      fx.contextGate = undefined; release(); await c.settle(); expect(shown()[0]).toBe('item-000');
      await c.goTo('#/measure?scope=coach&slot=chero');
      click('Build this day'); await c.settle(); await c.settle();
      expect(c.text()).toContain('Reading the latest saved canonical report'); expect(shown()[0]).toBe('item-000');
      expect(c.saved.at(-1)).not.toHaveProperty('policies'); // canonical build, not a hidden custom overlay
      fx.reportGate = async (u, method) => { if (method === 'POST') await new Promise<void>(r => { release = r; }); };
      click('Build this day'); await c.settle(); click('Reload first page'); await c.settle();
      expect(c.all('#view button').find(b => b.textContent === 'Build this day')!.disabled).toBe(false);
      release(); await c.settle(); expect(shown()[0]).toBe('item-000');
      fx.reportGate = async (u, method) => { if (method === 'GET' && u.pathname.endsWith('/learn/report')) await new Promise<void>(r => { release = r; }); };
      click('Reload first page'); await c.settle(); fx.buildStatus = 503; click('Build this day'); await c.settle();
      expect(c.text()).toContain('The report could not be built');
      expect(c.all('#view button').find(b => b.textContent === 'Reload first page')!.disabled).toBe(false);
      release(); await c.settle(); expect(shown()).toEqual([]);
      fx.buildStatus = undefined; fx.reportGate = undefined; click('Reload first page'); await c.settle();
      fx.reportGate = async (u, method) => { if (method === 'POST') await new Promise<void>(r => { release = r; }); };
      click('Build this day'); await c.settle(); await c.goTo('#/measure?scope=coach&brand=other&slot=merch'); release(); await c.settle(); expect(shown()).toEqual(['other-slot']);
      // Logout invalidates rows immediately, even while a page fetch is outstanding.
      fx.reportGate = async (u) => { if (u.pathname.endsWith('/learn/report')) await new Promise<void>(r => { release = r; }); };
      click('Reload first page'); await c.settle(); await (c.w.OperatorSession as { signOut: () => Promise<void> }).signOut(); release(); await c.settle(); expect(shown()).toEqual([]);
      console.log('W32.05 modern DOM', JSON.stringify({ union_items: 121, rendered_page_items: 50, canonical_gets_paged: true, build_candidate_not_rendered: true }));
    } finally { c.close(); }
  });

  it('W28.01 removes the console Thompson offer and keeps retained settings dormant until an explicit supported choice', async () => {
    const learn = structuredClone(LEARN_ON); learn.slots.chero.exploration.mode = 'thompson';
    const c = await open({ learn });
    try {
      await c.signIn(); await c.goTo('#/dials?scope=coach&slot=chero');
      expect(c.all('select option').some(option => option.value === 'thompson')).toBe(false);
      expect(c.text()).toContain('Exploration is off by default'); expect(c.text()).toContain('Stored Thompson — inactive');
      expect(JSON.parse(c.all('.dormant-exploration')[0]!.textContent!)).toEqual(learn.slots.chero.exploration);
      expect(c.saved).toEqual([]); expect(c.$('savebar').hidden).toBe(true);
      const mode = c.w.document.querySelector('[data-focus-key="slots.chero.exploration.mode"]')!;
      expect(mode.value).toBe(''); mode.value = 'rotation';
      mode.dispatchEvent(new (c.w.window as unknown as { Event: new (type: string, options: object) => unknown }).Event('change', { bubbles: true }));
      await c.settleChecked(); c.$('save').click(); await c.settle(); await c.settle();
      expect(c.saved).toHaveLength(1);
      const document = c.saved[0]!.document as typeof learn;
      expect(document.slots.chero.exploration).toEqual({ ...learn.slots.chero.exploration, mode: 'rotation' });
      expect(document.slots.chero.gamma).toBe(learn.slots.chero.gamma); expect(document.holdout).toEqual(learn.holdout);
    } finally { c.close(); }
  });

  it('W02.04 keeps the replacement password session across renewal and discards stale logout/login completions', async () => {
    for (const race of ['refresh-first', 'password-first', 'logout', 'new-login']) {
      const dom = new JSDOM('<html></html>', { url: 'http://console.test', runScripts: 'outside-only' });
      const w = dom.window as unknown as { localStorage: { setItem(key: string, value: string): void; getItem(key: string): string | null };
        sessionStorage: { getItem(key: string): string | null };
        eval(source: string): unknown; close(): void; fetch: typeof fetch };
      const token = (sid: string) => 'h.' + Buffer.from(JSON.stringify({ type: 'access', sid, exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url') + '.s';
      const replacement = { accessToken: token('replacement'), refreshToken: 'replacement-refresh', user: { id: 'ops-1' } };
      w.localStorage.setItem('operator-session', JSON.stringify({ accessToken: token('old'), refreshToken: 'old-refresh', user: { id: 'ops-1' }, exp: Date.now() + 900_000 }));
      let finishPassword: () => void = () => { throw new Error('No password request'); };
      let finishRefresh: () => void = () => { throw new Error('No refresh request'); };
      const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      w.fetch = (async (url: string) => {
        if (url === '/auth/password') return new Promise(resolve => { finishPassword = () => resolve(response(replacement)); });
        if (url === '/auth/refresh') {
          const renewed = response({ accessToken: token('renewed') });
          return race === 'password-first' ? new Promise(resolve => { finishRefresh = () => resolve(renewed); }) : renewed;
        }
        if (url === '/auth/login') return response({ accessToken: token('new-login'), refreshToken: 'new-login-refresh', user: { id: 'ops-2' } });
        return response({ success: true });
      }) as unknown as typeof fetch;
      try {
        w.eval(pub('operator-session.js'));
        const session = (w as unknown as { OperatorSession: {
          changePassword(a: string, b: string): Promise<unknown>; refresh(): Promise<unknown>;
          signOut(): Promise<void>; signIn(a: string, b: string): Promise<unknown>;
        } }).OperatorSession;
        const password = session.changePassword('old password', 'new password');
        let renewal: Promise<unknown> | undefined;
        if (race === 'refresh-first') await session.refresh();
        if (race === 'password-first') renewal = session.refresh();
        if (race === 'logout') await session.signOut();
        if (race === 'new-login') await session.signIn('another@example.invalid', 'another password');
        finishPassword(); await password;
        if (renewal) { finishRefresh(); await renewal; }
        const stored = JSON.parse(w.localStorage.getItem('operator-session') || 'null');
        if (race === 'logout') { expect(stored).toBeNull(); expect(w.sessionStorage.getItem('tuning-token')).toBeNull(); }
        else if (race === 'new-login') expect(stored).toMatchObject({ refreshToken: 'new-login-refresh', user: { id: 'ops-2' } });
        else {
          expect(stored).toMatchObject({ ...replacement, mustChangePassword: false });
          expect(stored.exp).toBe((JSON.parse(Buffer.from(replacement.accessToken.split('.')[1]!, 'base64url').toString()).exp as number) * 1000);
          expect(w.sessionStorage.getItem('tuning-token')).toBe(replacement.accessToken);
        }
      } finally { w.close(); }
    }
  });
  it('W03.03 carries named auth context through config and content, separating real BrightHour storage', async () => {
    for (const tenant of ['acme', 'globex', 'brighthour']) {
      const c = await open({ enforced: true }, `#/interests?scope=${tenant}`);
      try {
        expect(c.text()).not.toContain('Reading revision 3');
        await c.signIn();
        expect(c.requests.find(r => r.url === '/auth/login')?.headers['x-tenant']).toBe(tenant);
        const start = c.requests.length;
        const K = c.w.document.querySelector('[data-focus-key="K"]')!;
        K.value = '3';
        K.dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('input', { bubbles: true }));
        await c.settleChecked();
        c.$('save').click(); await c.settle();
        await c.goTo(`#/history?scope=${tenant}`);
        c.all('#view .link').find(b => (b.textContent || '').includes('Roll back'))!.click();
        await c.settle();
        await c.w.eval("Console.content('/learn')");
        const config = c.requests.filter(r => r.url.startsWith('/config/'));
        expect(new Set(config.map(r => `${r.method} ${new URL(r.url, 'http://console.test').pathname}`))).toEqual(new Set([
          'GET /config/reflex', 'POST /config/reflex/validate', 'PATCH /config/reflex', 'GET /config/reflex/history', 'POST /config/reflex/rollback/1',
        ]));
        for (const r of config) {
          expect(r.headers['x-tenant']).toBe(tenant);
          expect(new URL(r.url, 'http://console.test').searchParams.get('scope')).toBe(tenant === 'brighthour' ? 'tenant:brighthour' : tenant);
        }
        const content = c.requests.filter(r => r.url.startsWith('/content/'));
        expect(content.length).toBeGreaterThan(0);
        expect(content.every(r => new URL(r.url, 'http://console.test').searchParams.get('scope') === tenant)).toBe(true);
        expect(c.requests.slice(start).every(r => r.headers['x-tenant'] === tenant && r.headers.authorization?.startsWith('Bearer '))).toBe(true);
        expect(c.saved).toEqual([{ patch: { K: 3 }, note: '' }]);
        const denied = await c.w.eval("Console.content('/learn', {scope:'other-brand'})") as { status: number };
        expect(denied.status).toBe(403);
        expect(c.saved).toHaveLength(1);
      } finally { c.close(); }
    }
  });

  it('W03.03 wires stored and background renewal before selfservice and preserves captured tenant during token waits', async () => {
    for (const expiry of [-1, 120_000]) {
      const c = await open({ enforced: true, storedExpiryMs: expiry }, '#/interests?scope=acme');
      try {
        expect(c.beforePageRequests).toBe(0);
        if (expiry > 0) { c.intervals.forEach(callback => callback()); await c.settle(); }
        const refreshed = c.requests.filter(r => r.url === '/auth/refresh');
        expect(refreshed).toHaveLength(1);
        expect(refreshed[0].headers['x-tenant']).toBe('acme');
        const session = c.w.OperatorSession as { token: () => Promise<string>; refresh: () => Promise<string>; changePassword: (a: string, b: string) => Promise<unknown>; signOut: () => Promise<void>; signedIn: () => boolean };
        const original = session.token;
        let release: (token: string) => void = () => { throw new Error('No pending token'); };
        session.token = () => new Promise(resolve => { release = resolve; });
        const pending = c.w.eval("Console.content('/learn')") as Promise<unknown>;
        c.w.eval("Console.state.scope = 'globex'");
        release('synthetic-current-token'); await pending;
        expect(c.requests.at(-1)).toEqual({ url: '/content/learn?scope=acme', method: 'GET', headers: { 'x-tenant': 'acme', authorization: 'Bearer synthetic-current-token' } });
        let tokenReads = 0;
        session.token = async () => { tokenReads++; return 'must-not-read'; };
        const before = c.requests.length;
        for (const expression of ["Console.call('https://other.invalid/content/learn')", "Console.call('/content/learn', {headers:{'x-TeNaNt':'acme'}})"]) {
          expect((await c.w.eval(expression) as { status: number }).status).toBe(0);
        }
        expect(tokenReads).toBe(0); expect(c.requests).toHaveLength(before);
        session.token = original;
        await c.goTo('#/interests?scope=globex');
        await Promise.all([session.refresh(), session.refresh()]);
        expect(c.requests.filter(r => r.url === '/auth/refresh')).toHaveLength(2);
        await session.changePassword('synthetic-old', 'synthetic-new-password');
        const originalFetch = c.w.fetch as (url: string, init: unknown) => Promise<unknown>;
        let completeRefresh: () => void = () => { throw new Error('No pending refresh'); };
        c.w.fetch = async (url: string, init: unknown) => {
          const response = await originalFetch(url, init);
          return url === '/auth/refresh' ? new Promise(resolve => { completeRefresh = () => resolve(response); }) : response;
        };
        const lateRefresh = session.refresh(); await c.settle();
        await session.signOut();
        completeRefresh(); await lateRefresh;
        expect(session.signedIn()).toBe(false);
        const selfservice = c.requests.filter(r => ['/auth/refresh', '/auth/password', '/auth/logout'].includes(r.url)).slice(1);
        expect(selfservice.map(r => r.url)).toEqual(['/auth/refresh', '/auth/password', '/auth/refresh', '/auth/logout']);
        expect(selfservice.every(r => r.headers['x-tenant'] === 'globex')).toBe(true);
        expect(selfservice.filter(r => r.url !== '/auth/refresh').every(r => r.headers.authorization?.startsWith('Bearer '))).toBe(true);
      } finally { c.close(); }
    }
  });

  it('W03.03 retained tuning authenticates read/validation/save/history and keeps demo versus explicit tenant selection', async () => {
    for (const [query, tenant, scope, enforced] of [
      ['scope=acme', 'acme', 'acme', true], ['scope=globex', 'globex', 'globex', true],
      ['scope=brighthour', 'coach', 'brighthour', false], ['tenant=brighthour', 'brighthour', 'tenant:brighthour', true],
    ] as const) {
      const dom = new JSDOM(pub('legacy/tuning.html'), { url: `http://console.test/legacy/tuning.html?${query}`, runScripts: 'outside-only', pretendToBeVisual: true });
      const requests: CapturedRequest[] = [], saved: Array<Record<string, unknown>> = [];
      const w = dom.window as unknown as Browser;
      Object.assign(w, { Headers, fetch: platform({ enforced }, [], saved, requests), confirm: () => true });
      const settle = async () => { await new Promise(resolve => setTimeout(resolve, 100)); };
      const el = (id: string) => w.document.getElementById(id) as unknown as El;
      try {
        w.eval(pub('operator-session.js')); w.eval(pub('tuning.js')); await settle();
        if (enforced) expect(el('messages').textContent).toContain('Could not load');
        el('si-email').value = 'ops@brand.test'; el('si-password').value = 'right-password';
        el('sign-in-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await settle();
        const K = w.document.querySelector('[data-focus-key="K"]') as unknown as El;
        expect(K).not.toBeNull(); K.value = '3'; K.dispatchEvent(new w.Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 450));
        el('save').click(); await settle();
        const rollback = Array.from(w.document.querySelectorAll('#history button'))[0];
        expect(rollback).toBeDefined(); rollback.click(); await settle();
        const config = requests.filter(r => r.url.startsWith('/config/'));
        expect(new Set(config.map(r => `${r.method} ${new URL(r.url, 'http://console.test').pathname}`))).toEqual(new Set([
          'GET /config/reflex', 'GET /config/reflex/history', 'POST /config/reflex/validate', 'PATCH /config/reflex', 'POST /config/reflex/rollback/1',
        ]));
        expect(config.every(r => r.headers['x-tenant'] === tenant && new URL(r.url, 'http://console.test').searchParams.get('scope') === scope)).toBe(true);
        const afterLogin = requests.slice(requests.findIndex(r => r.url === '/auth/login') + 1);
        expect(afterLogin.length).toBeGreaterThan(4);
        expect(afterLogin.every(r => r.headers.authorization?.startsWith('Bearer '))).toBe(true);
        expect(saved).toEqual([{ patch: { K: 3 }, note: '' }]);
      } finally { w.close(); }
    }
    for (const [query, expected, tenant] of [['tenant=acme&scope=globex', 'scope=globex&tenant=acme', 'acme'], ['tenant=&scope=acme', 'scope=acme&tenant=', '']]) {
      const dom = new JSDOM(pub('legacy/tuning.html'), { url: `http://console.test/legacy/tuning.html?${query}`, runScripts: 'outside-only' });
      const w = dom.window as unknown as Browser;
      const requests: CapturedRequest[] = [], saved: Array<Record<string, unknown>> = [];
      try {
        Object.assign(w, { Headers, fetch: platform({}, [], saved, requests) });
        w.eval(pub('operator-session.js')); w.eval(pub('tuning.js'));
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(requests).toHaveLength(2);
        expect(requests.every(r => r.url.includes(expected) && r.headers['x-tenant'] === tenant)).toBe(true);
        expect((w.document.getElementById('messages') as El).textContent).toContain('Could not load');
        expect(saved).toEqual([]);
      } finally { w.close(); }
    }
  });

  it('opens on the work queue, signed out, with a rail and no stray value', async () => {
    const c = await open();
    try {
      expect(c.text()).not.toMatch(STRAY);
      expect(c.$('view-title').textContent).toBe('What needs a person');
      // The rail carries a route per view, and the context the server fed it.
      const rail = c.all('#rail-views a').map((a) => (a.textContent || '').replace(/\d+$/, '').trim());
      expect(rail).toContain('Work');
      expect(rail).toContain('What it has learned');
      expect(rail).toContain('Dials');
      expect(rail).toContain('Slots');
      expect(c.$('slot-count').textContent).toBe('3 slots on 2 pages');
      // A slot was chosen for the operator, skipping the pinned one.
      expect(c.$('slot').value).toBe('chero');
      expect(c.$('where').textContent).toBe('coach · chero');
      // Signed out, the authenticated counts say so rather than showing a zero.
      expect(c.text()).toContain('sign in to fill the proposals and the erasures');
      expect(c.text()).toContain('Read only');
    } finally { c.close(); }
  });

  it('signs in on the page and the counts fill', async () => {
    const c = await open();
    try {
      await c.signIn('wrong-password');
      expect(c.$('si-error').textContent).toBe('That email and password were not accepted.');
      await c.signIn();
      expect(c.$('who').textContent).toBe('Signed in as Test Operator');
      expect(c.$('sign-out').hidden).toBe(false);
      const cards = c.all('.qcard').map((x) => ({
        n: (x.querySelector('.n')!.textContent || '').trim(),
        what: (x.querySelector('.what')!.textContent || '').trim(),
      }));
      expect(cards.find((x) => x.what === 'Historical proposals listed')!.n).toBe('1');
      expect(c.text()).toContain('not a complete audit trail');
      expect(c.all('.qcard.act')).toHaveLength(0);
      expect(c.all('#rail-views a').find((x) => x.textContent === 'Work')!.querySelector('.n')).toBeNull();
      expect(cards.find((x) => x.what === 'Slots with nothing learned yet')!.n).toBe('2');   // merch and strip
      expect(cards.find((x) => x.what === 'Items a person is holding')!.n).toBe('1');
      expect(cards.find((x) => x.what === 'Erasures pending a rewrite')!.n).toBe('1');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('pages the grid from the server, and never asks for the whole snapshot', async () => {
    const c = await open();
    try {
      await c.goTo('#/lift?scope=coach&slot=chero');
      expect(c.$('view-title').textContent).toBe('What this slot has learned');
      // Words, and the design's symbol under each, per doc 28 §9.
      const words = c.all('#view thead th').map((th) => (th.firstChild?.textContent || '').trim());
      const syms = c.all('#view thead th .sym').map((x) => (x.textContent || '').trim());
      expect(words).toEqual(['', 'Piece', 'Shown', 'Paid off', 'Rate', 'The slot’s rate', 'Lift ↓', 'Evidence', 'Held by a person']);
      expect(syms).toEqual(['n', 's', 'p̂', 'p₀', 'p̂ / p₀', 'n / (n + n₀)']);
      expect(c.all('#view tbody tr')).toHaveLength(3);
      expect(c.text()).toContain('312 pieces, showing 1 to 3');   // the page the server cut, not the page size
      expect(c.text()).toContain('reward click');
      expect(c.text()).not.toMatch(STRAY);

      // Next asks the server with the server's own cursor, and the count follows.
      const next = c.all('.pager button').find((b) => b.textContent === 'Next')!;
      next.click(); await c.settle();
      expect(c.log.some((l) => l.includes('cursor=CURSOR-2'))).toBe(true);
      expect(c.text()).toContain('showing 51 to 51');
      const prev = c.all('.pager button').find((b) => b.textContent === 'Previous')!;
      expect(prev.disabled).toBe(false);

      // The unbounded reads doc 28 is written against: never asked for.
      expect(c.log.filter((l) => /GET \/v1\/coach\/lift\?/.test(l))).toEqual([]);
      expect(c.log.filter((l) => /\/content\/catalog/.test(l))).toEqual([]);
    } finally { c.close(); }
  });

  it('opens a piece as a drill-down, in the URL, and comes back', async () => {
    const c = await open();
    try {
      await c.goTo('#/lift?scope=coach&slot=chero');
      const piece = c.all('#view tbody .link')[0]!;
      expect(piece.textContent).toBe('CCH-aaa');
      piece.click(); await c.settle(); await c.settle();
      // The back button works because the drill-down is a route, not a mode.
      expect(c.w.location.hash).toContain('item=cnt_aaa');
      expect(c.log.some((l) => l.includes('level=cells') && l.includes('item=cnt_aaa'))).toBe(true);
      expect(c.text()).toContain('Every context cnt_aaa was shown in');
      expect(c.all('#view thead th').map((th) => (th.firstChild?.textContent || '').trim())).toContain('Context');
      expect(c.all('#view tbody tr')).toHaveLength(2);
      expect(c.text()).toContain('2 contexts, showing 1 to 2');
      expect(c.text()).not.toMatch(STRAY);
      const back = c.all('.toolbar button').find((b) => (b.textContent || '').includes('Every piece'))!;
      back.click(); await c.settle(); await c.settle();
      expect(c.w.location.hash).not.toContain('item=cnt_aaa');
    } finally { c.close(); }
  });

  it('holds a piece: one read, one write, one revision, and the rail follows', async () => {
    const c = await open();
    try {
      await c.signIn();
      await c.goTo('#/lift?scope=coach&slot=chero');
      const freeze = c.all('#view tbody button').find((b) => b.textContent === 'Freeze')!;
      freeze.click(); await c.settle(); await c.settle();
      const put = c.saved[0]!;
      expect((put.note as string)).toContain('froze 1 item at their current lift in chero');
      const doc = put.document as { slots: Record<string, { items: Record<string, unknown> }> };
      expect(doc.slots.chero.items.cnt_aaa).toEqual({ mode: 'freeze', lift: 1.116 });
      expect(c.text()).toContain('as learn revision 9');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('says so when a slot has published nothing, instead of an empty table', async () => {
    const c = await open({ published: false });
    try {
      await c.goTo('#/lift?scope=coach&slot=chero');
      expect(c.text()).toContain('Nothing published for this slot yet');
      expect(c.all('#view tbody tr')).toHaveLength(0);
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('the dials arm the save bar, save once, and leave nothing behind when a dial is switched off', async () => {
    const c = await open({ learn: LEARN_ON });
    try {
      await c.signIn();
      await c.goTo('#/dials?scope=coach&slot=chero');
      expect(c.$('savebar').hidden).toBe(true);           // nothing changed yet
      expect(c.text()).toContain('Reading revision 2 of the learn document');
      for (const label of ['Trust in what was learned', 'What counts as paying off', 'How often', 'Autonomy unavailable', 'Stored settings are dormant', 'Held out of personalization', 'How long evidence lasts'])
        expect(c.text()).toContain(label);
      expect(c.all('[data-focus-key*=".autonomy"]')).toHaveLength(0);
      expect(c.all('select option').some((x) => ['assisted', 'autonomous'].includes(x.value))).toBe(false);
      expect(JSON.parse(c.all('.dormant-autonomy')[0].textContent!)).toEqual(LEARN_ON.slots.chero.autonomy);
      expect(c.text()).not.toMatch(STRAY);

      // A change arms the bar; the note goes with it; one PUT carries the document.
      const trust = c.w.document.querySelector('[data-focus-key="slots.chero.gamma"]')!;
      trust.value = '1';
      trust.dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('input', { bubbles: true }));
      await c.settle();
      // While the platform is still checking the draft, the bar says so and Save is held.
      expect(c.$('changecount').textContent).toBe('1 change, checking…');
      expect(c.$('save').disabled).toBe(true);
      await c.settleChecked();
      expect(c.$('savebar').hidden).toBe(false);
      expect(c.$('changecount').textContent).toBe('1 change');
      expect(c.$('save').disabled).toBe(false);
      c.$('note').value = 'trusting it in full';
      c.$('save').click(); await c.settle(); await c.settle();
      expect(c.saved).toHaveLength(1);
      expect(c.saved[0].note).toBe('trusting it in full');
      expect((c.saved[0].document as { slots: Record<string, { gamma: number }> }).slots.chero.gamma).toBe(1);
      expect((c.saved[0].document as typeof LEARN_ON).slots.chero.autonomy).toEqual(LEARN_ON.slots.chero.autonomy);
      expect((c.saved[0].document as typeof LEARN_ON).slots.chero.exploration).toEqual(LEARN_ON.slots.chero.exploration);
      expect((c.saved[0].document as typeof LEARN_ON).slots.chero.items).toEqual(LEARN_ON.slots.chero.items);
      expect(c.text()).toContain('Saved as learn revision 9');
      expect(c.$('savebar').hidden).toBe(true);
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('leaves the save bar behind when the operator walks away from the dials', async () => {
    const c = await open({ learn: LEARN_ON });
    try {
      await c.signIn();
      await c.goTo('#/dials?scope=coach&slot=chero');
      const trust = c.w.document.querySelector('[data-focus-key="slots.chero.gamma"]')!;
      trust.value = '0.9';
      trust.dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('input', { bubbles: true }));
      await c.settle();
      expect(c.$('savebar').hidden).toBe(false);
      await c.goTo('#/work?scope=coach');
      expect(c.$('savebar').hidden).toBe(true);
    } finally { c.close(); }
  });

  it('shows every slot with what is set on it, and a slot opens the grid', async () => {
    const c = await open();
    try {
      await c.goTo('#/slots?scope=coach');
      expect(c.text()).toContain('home · 2 slots');
      expect(c.text()).toContain('plp · 1 slot');
      expect(c.text()).toContain('pinned to cnt_m');
      expect(c.text()).toContain('nothing yet');
      expect(c.text()).toContain('2 pieces, 22 events');
      expect(c.text()).toContain('unavailable · stored assisted (dormant)');
      expect(c.text()).not.toMatch(STRAY);
      const strip = c.all('#view .link').find((b) => b.textContent === 'strip')!;
      strip.click(); await c.settle(); await c.settle();
      expect(c.w.location.hash).toContain('slot=strip');
      expect(c.$('view-title').textContent).toBe('What this slot has learned');
    } finally { c.close(); }
  });

  it('a brand with no slots says so, and asks for nothing else', async () => {
    const c = await open({ slots: false });
    try {
      expect(c.$('slot-count').textContent).toBe('No slots configured for this brand yet.');
      await c.goTo('#/lift?scope=coach');
      expect(c.text()).toContain('Choose a slot in the rail');
      expect(c.log.filter((l) => l.includes('/lift/rows'))).toEqual([]);
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('the interests screen speaks in shopper terms, names what is inherited, and saves a patch', async () => {
    const c = await open();
    try {
      await c.signIn();
      await c.goTo('#/interests?scope=coach');
      expect(c.$('view-title').textContent).toBe('What the engine notices, and how fast it forgets');
      // A number is shown as its consequence, not as a symbol.
      expect(c.text()).toContain('Interest halves about every 41.6 seconds of inactivity');
      expect(c.text()).toContain('halfway to full strength after about 1.8 product views');
      // The behaviour groups, with the raw event names underneath for the data team.
      expect(c.text()).toContain('Viewed a product');
      expect(c.text()).toContain('product_view, pdp_view, view_product');
      // An action the engine knows and this screen does not group is still tunable.
      expect(c.text()).toContain('try_on');
      // Weights the document never wrote down, and the interest it does not carry.
      expect(c.text()).toContain('Inherited from the shipped defaults');
      expect(c.text()).toContain("dimension 'contentType'");
      // The hysteresis band, drawn to scale, with the sentence that says why the gap is there.
      expect(c.text()).toContain('leaves 0.45');
      expect(c.text()).toContain('joins 0.6');
      expect(c.text()).toContain('stops a shopper flickering in and out');
      // The registry, with the half-life it inherits computed per interest.
      expect(c.text()).toContain('1.7 minutes');   // priceBand's own 150s tau
      expect(c.text()).not.toMatch(STRAY);

      const K = c.w.document.querySelector('[data-focus-key="K"]')!;
      K.value = '3';
      K.dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('input', { bubbles: true }));
      await c.settleChecked();
      expect(c.$('changecount').textContent).toBe('1 change');
      c.$('note').value = 'slower to commit';
      c.$('save').click(); await c.settle(); await c.settle();
      // A patch, not the whole document: only what moved.
      expect(c.saved[0]).toEqual({ patch: { K: 3 }, note: 'slower to commit' });
      expect(c.text()).toContain('Saved as revision 4');
      expect(c.text()).not.toContain('Live now');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('a slot rule switched on writes its defaults, and off leaves nothing behind', async () => {
    const c = await open();
    try {
      await c.signIn();
      await c.goTo('#/rules?scope=coach&slot=chero');
      expect(c.text()).toContain('chero on home, from revision 4 of the slot document');
      expect(c.text()).toContain('Where the shopper is in her journey');
      expect(c.text()).toContain('How fresh the piece is');
      expect(c.text()).toContain('How often she has already seen it');
      expect(c.text()).toContain('How much of one thing it may show');
      // Freshness is on in the fixture, so its own settings are there; stage is off.
      expect(c.text()).toContain('The bonus halves every');
      expect(c.text()).not.toContain('A piece for another stage is worth');
      expectNoStrayRulesText(c.text());

      // Switching a rule on writes the defaults a person can then change.
      const sw = c.all('#view select').find((x) => x.dataset.focusKey === 'rule:Where the shopper is in her journey')!;
      sw.value = 'on';
      sw.dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('change', { bubbles: true }));
      await c.settleChecked();
      expect(c.text()).toContain('A piece for another stage is worth');
      expect(c.text()).toContain('50% of what it would otherwise score');
      c.$('save').click(); await c.settle(); await c.settle();
      const doc = c.saved[0].document as { pages: { home: Array<Record<string, unknown>> } };
      expect(doc.pages.home[0].stage).toEqual({ outOfStage: 0.5, inStage: 0.2 });
      expect(doc.pages.home[0].freshness).toEqual({ weight: 0.2, halfLifeDays: 14 });
      expect(c.text()).toContain('Saved as slots revision 5');
      expectNoStrayRulesText(c.text());
    } finally { c.close(); }
  });

  it('W20.02 shows pin feedback for Rules and History without stale draft scope or activation results', async () => {
    const report = (slotsRevision: number | null, catalogRevision: number): SlotDiagnostics => ({ schema: 'slot-pin-diagnostics/v1', advisory: true,
      status: 'available', slotsRevision, catalog: { source: 'stored', revision: catalogRevision }, checkedAt: '2026-09-13T18:00:00.000Z',
      warningCount: 1, omittedWarningCount: 0, warnings: [{ pageIndex: 0, slotIndex: 1, reason: 'missing_piece' }] });
    const fx: Fixtures = { enforced: true, pinFeedback: async (_doc, revision) => report(revision, 10) };
    const c = await open(fx, '#/rules?scope=coach&slot=chero');
    const edit = (value: string) => { const input = c.all('[data-focus-key="weight:0"]')[0]!; input.value = value; input.dispatchEvent(new c.w.Event('input', { bubbles: true })); };
    const feedback = () => c.all('[data-pin-feedback]').map(el => el.textContent || '').join(' ');
    const rollbackButton = () => {
      const section = c.all('#view section').find(el => el.querySelector('h3')?.textContent === 'The slots and their rules')!;
      return Array.from(section.querySelectorAll('tbody tr')).find(el => el.querySelector('td')?.textContent === '4')!.querySelector('button')!;
    };
    try {
      await c.signIn();
      expect(feedback()).toContain('catalog revision 10'); expect(feedback()).toContain('Page 1, slot 2: Pinned piece is missing');
      expect(feedback()).not.toContain('cnt_m');
      let releaseOld!: () => void, validation = 0;
      fx.pinFeedback = async (_doc, revision, operation) => {
        if (operation !== 'validate') return report(revision, 10);
        const mine = ++validation;
        if (mine === 1) await new Promise<void>(resolve => { releaseOld = resolve; });
        return report(revision, mine === 1 ? 11 : 12);
      };
      edit('0.4'); expect(feedback()).not.toContain('catalog revision 10'); expect(c.text()).toContain('Pin check pending');
      await c.settleChecked(); edit('0.5'); await c.settleChecked();
      expect(feedback()).toContain('catalog revision 12'); releaseOld(); await c.settle(); expect(feedback()).not.toContain('catalog revision 11');
      expect(c.$('save').disabled).toBe(false); // Warnings are advisory, not a publishing prohibition.
      let failReload = false;
      fx.pinFeedback = async (_doc, revision, operation) => {
        if (operation === 'PUT') { failReload = true; return report(revision, 20); }
        if (operation === 'GET' && failReload) throw new Error('Synthetic post-save reload failure');
        return report(revision, 12);
      };
      c.$('save').click(); await c.settle(); await c.settle();
      expect(c.saved).toHaveLength(1); expect(feedback()).toContain('Saved revision 5 response:'); expect(feedback()).toContain('catalog revision 20');
      expect(c.text()).toContain('Pin check unavailable'); expect(c.text()).not.toContain('Live on the next decision');
      failReload = false;
      fx.pinFeedback = async (_doc, revision) => report(revision, 30);
      await c.goTo('#/rules?scope=coach&slot=merch'); await c.goTo('#/rules?scope=coach&slot=chero');
      edit('0.6'); expect(feedback()).not.toContain('catalog revision 30');
      c.$('discard').click(); expect(c.text()).toContain('Pin check pending'); await c.settleChecked();
      expect(c.all('[data-focus-key="weight:0"]')[0]!.value).toBe('0.5');
      // Malformed available payloads never become a green/checked summary.
      for (const malformed of [{ ...report(5, 30), omittedWarningCount: undefined }, { ...report(5, 30), warningCount: -1 },
        { ...report(5, 0) }, { ...report(5, 30), warnings: [{ pageIndex: -1, slotIndex: 0, reason: '<script>' }] }]) {
        fx.pinFeedback = async () => malformed as unknown as SlotDiagnostics;
        await c.goTo('#/rules?scope=coach&slot=merch'); await c.goTo('#/rules?scope=coach&slot=chero');
        expect(feedback()).toContain('Pin check unavailable'); expect(feedback()).not.toContain('catalog revision');
        expect(c.all('#view script')).toEqual([]);
      }
      fx.pinFeedback = async (_doc, revision) => ({ ...report(revision, 30), status: 'not_required', catalog: { source: 'not_read', revision: null }, checkedAt: null, warningCount: 0, omittedWarningCount: 0, warnings: [] });
      await c.goTo('#/rules?scope=coach&slot=merch'); expect(feedback()).toContain('No pins in this document; catalog not read');
      let releaseTenant!: () => void;
      fx.pinFeedback = async (_doc, revision, _operation, tenant) => {
        if (tenant === 'acme') await new Promise<void>(resolve => { releaseTenant = resolve; });
        return report(revision, tenant === 'acme' ? 70 : 80);
      };
      await c.goTo('#/rules?scope=acme&slot=chero'); expect(feedback()).not.toContain('catalog revision');
      await c.goTo('#/rules?scope=globex&slot=chero'); expect(feedback()).toContain('catalog revision 80');
      releaseTenant(); await c.settle(); expect(feedback()).not.toContain('catalog revision 70');
      fx.pinFeedback = async (_doc, revision, operation) => report(revision, operation === 'rollback' ? 40 : 50);
      await c.goTo('#/history?scope=coach&slot=chero');
      let releaseHistory!: () => void;
      fx.historyGate = () => new Promise<void>(resolve => { releaseHistory = resolve; });
      rollbackButton().click(); await c.settle();
      expect(feedback()).toContain('Rollback revision 6 response:'); expect(feedback()).toContain('catalog revision 40');
      expect(c.text()).toContain('Reading the history'); fx.historyGate = undefined; releaseHistory(); await c.settle(); await c.settle();
      expect(c.all('#view a').some(el => el.textContent === 'Inspect current pin checks in Slot rules')).toBe(true);
      await c.goTo('#/rules?scope=coach&slot=chero'); expect(feedback()).toContain('catalog revision 50');
      await c.goTo('#/history?scope=coach&slot=chero');
      let releaseRollback!: () => void;
      fx.pinFeedback = async (_doc, revision, operation) => {
        if (operation === 'rollback') await new Promise<void>(resolve => { releaseRollback = resolve; });
        return report(revision, 90);
      };
      rollbackButton().click(); await c.settle(); await c.goTo('#/history?scope=other&slot=chero');
      releaseRollback(); await c.settle(); expect(feedback()).not.toContain('catalog revision 90');
      // The shell changes scope before its rail finishes loading. Old buttons
      // must refuse before issuing a write under that new scope.
      const oldButton = rollbackButton(); let releaseContext!: () => void;
      fx.contextGate = () => new Promise<void>(resolve => { releaseContext = resolve; });
      await c.goTo('#/history?scope=next&slot=chero');
      const writes = c.log.filter(line => line.startsWith('POST /content/slots/rollback')).length;
      oldButton.click(); await c.settle();
      expect(c.log.filter(line => line.startsWith('POST /content/slots/rollback'))).toHaveLength(writes);
      fx.contextGate = undefined; releaseContext(); await c.settle(); await c.settle();
      expectNoStrayRulesText(c.text());
    } finally { c.close(); }
  }, 20_000);

  it('W20.05 edits unified exact prefixes with real index readback and rollback', async () => {
    const c = await open({ liveSlotIndex: true, pinFeedback: async (_doc, revision) => ({ schema: 'slot-pin-diagnostics/v1', advisory: true, status: 'available', slotsRevision: revision,
      catalog: { source: 'stored', revision: 1 }, checkedAt: '2026-09-13T21:00:00Z', warningCount: 1, omittedWarningCount: 0,
      warnings: [{ pageIndex: 0, slotIndex: 0, pinIndex: 1, reason: 'missing_piece' }] }) });
    const field = () => c.all('[data-focus-key="governance.pin"]')[0]!;
    const edit = (value: string) => { const el = field(); el.value = value; el.dispatchEvent(new c.w.Event('input', { bubbles: true })); };
    const take = (value: number) => { const el = c.all('[data-focus-key="take"]')[0]!; el.value = String(value); el.dispatchEvent(new c.w.Event('input', { bubbles: true })); };
    const save = async () => { await c.settleChecked(); expect(c.$('save').disabled).toBe(false); c.$('save').click(); await c.settle(); };
    const search = async (value: string) => { c.$('slot-q').value = value; c.$('slot-q').dispatchEvent(new c.w.Event('input', { bubbles: true })); await c.settleChecked(); };
    const ids = [' p,"[]\n ', '   '];
    try {
      await c.signIn(); await c.goTo('#/rules?scope=coach&slot=chero');
      edit(JSON.stringify(ids)); await save();
      expect((c.saved[0]!.document as SlotCatalog).pages.home![0]).toMatchObject({ take: 2, pinnedPieceIds: ids });
      expect((c.saved[0]!.document as SlotCatalog).pages.home![0]).not.toHaveProperty('pinnedPieceId');
      expect(c.text()).toContain('0 ranked positions'); expect(c.text()).toContain('pinned position 2');
      take(4); await save(); expect(c.text()).toContain('2 ranked positions');
      expect(c.$('slot').textContent).toContain('2 pinned + ranked');
      await c.goTo('#/slots?scope=coach&slot=chero'); expect(c.all('#view .itemid').map(el => el.textContent)).toContain(`Pinned first: ${JSON.stringify(ids)}; 2 ranked positions`);
      await c.goTo('#/rules?scope=coach&slot=chero');
      expect(field().value).toBe(JSON.stringify(ids));
      for (const text of ['[', '["x","x"]', '[null]', '["x","y","z","w","v"]']) {
        edit(text); await c.settleChecked(); expect(c.$('save').disabled).toBe(true); expect(c.all('[data-focus-key="take"]')[0]!.value).toBe('4');
      }
      edit('['); const stale = field(); await search('merch');
      stale.value = '["wrong-slot"]'; stale.dispatchEvent(new c.w.Event('input', { bubbles: true }));
      expect(field().value).toBe('"cnt_m"'); expect(c.$('save').disabled).toBe(true);
      await search('chero'); expect(field().value).toBe('['); edit('[]'); await save();
      expect((c.saved[2]!.document as SlotCatalog).pages.home![0]!.pinnedPieceIds).toEqual([]);
      take(1); edit('"scalar"'); await save();
      const scalar = (c.saved[3]!.document as SlotCatalog).pages.home![0]!;
      expect(scalar.pinnedPieceId).toBe('scalar'); expect(scalar).not.toHaveProperty('pinnedPieceIds');
      edit('null'); await save(); const clear = (c.saved[4]!.document as SlotCatalog).pages.home![0]!;
      expect(clear).not.toHaveProperty('pinnedPieceId'); expect(clear).not.toHaveProperty('pinnedPieceIds');
      edit('['); c.$('discard').click(); await c.settleChecked(); expect(field().value).toBe('null');
      await search(''); await c.goTo('#/history?scope=coach&slot=chero');
      const section = c.all('#view section').find(el => el.querySelector('h3')?.textContent === 'The slots and their rules')!;
      Array.from(section.querySelectorAll('tbody tr')).find(el => el.querySelector('td')?.textContent === '6')!.querySelector('button')!.click();
      await c.settle(); await c.settle(); expect(c.text()).toContain('Rolled revision 6 forward as revision 10');
      await c.goTo('#/rules?scope=coach&slot=chero'); expect(field().value).toBe(JSON.stringify(ids)); expect(c.text()).toContain('2 ranked positions');
      expectNoStrayRulesText(c.text()); expect(c.saved).toHaveLength(5);
    } finally { c.close(); }
  }, 20_000);

  it('W20.04 edits exact pins tags and rendering types with scoped errors and rollback', async () => {
    const c = await open({ pinFeedback: async (document, revision) => {
      const warnings: NonNullable<SlotDiagnostics['warnings']> = document.pages.home?.[0]?.pinnedPieceId
        ? [{ pageIndex: 0, slotIndex: 0, reason: 'excluded_tag' }, { pageIndex: 0, slotIndex: 0, reason: 'type_not_allowed' }] : [];
      return { schema: 'slot-pin-diagnostics/v1', advisory: true, status: 'available', slotsRevision: revision,
        catalog: { source: 'stored', revision: 7 }, checkedAt: '2026-09-13T20:00:00Z', warningCount: warnings.length, omittedWarningCount: 0, warnings };
    } });
    const field = (key: string) => c.all(`[data-focus-key="governance.${key}"]`)[0]!;
    const edit = (key: string, value: string) => { const el = field(key); el.value = value; el.dispatchEvent(new c.w.Event('input', { bubbles: true })); };
    const search = async (value: string) => { c.$('slot-q').value = value; c.$('slot-q').dispatchEvent(new c.w.Event('input', { bubbles: true })); await c.settleChecked(); };
    const save = async () => { await c.settleChecked(); expect(c.$('save').disabled).toBe(false); c.$('save').click(); await c.settle(); };
    const pin = ' p,"[]\n ', pairs = [{ dimension: 'quote"[]', value: ' x\ny ' }, { dimension: '__proto__', value: '<literal>' }];
    try {
      await c.signIn(); await c.goTo('#/rules?scope=coach&slot=chero');
      expect(field('pin').value).toBe('null'); expect(field('types').value).toBe('null');
      edit('pin', JSON.stringify(pin)); await c.settleChecked();
      expect(c.$('save').disabled).toBe(true); expect(c.text()).toContain('pinned slots must take exactly 1');
      const take = c.all('[data-focus-key="take"]')[0]!; expect(take.value).toBe('2');
      take.value = '1'; take.dispatchEvent(new c.w.Event('input', { bubbles: true }));
      edit('tags', JSON.stringify(pairs)); edit('types', '["film"," film "]'); await save();
      const first = c.saved[0]!.document as SlotCatalog;
      expect(first.pages.home![0]).toMatchObject({ take: 1, pinnedPieceId: pin, excludedTags: pairs, allowedTypes: ['film', ' film '], weights: SLOTS_DOC.pages.home![0]!.weights, freshness: SLOTS_DOC.pages.home![0]!.freshness });
      expect(first.pages.home![1]).toEqual(SLOTS_DOC.pages.home![1]);
      expect(field('pin').value).toBe(JSON.stringify(pin)); expect(field('tags').value).toBe(JSON.stringify(pairs));
      expect(c.text()).toContain('matches an exact excluded tag'); expect(c.text()).toContain('rendering type not allowed');
      edit('pin', '"   "'); await save();
      expect((c.saved[1]!.document as SlotCatalog).pages.home![0]!.pinnedPieceId).toBe('   '); expect(field('pin').value).toBe('"   "');
      edit('pin', JSON.stringify(pin)); await save();
      expect((c.saved[2]!.document as SlotCatalog).pages.home![0]!.pinnedPieceId).toBe(pin);
      for (const [key, value] of [['pin', '""'], ['pin', '123'], ['tags', '[{"dimension":"x","value":"y","extra":1}]'], ['types', '[]']]) {
        edit(key!, value!); await c.settleChecked(); expect(c.$('save').disabled).toBe(true);
        c.$('save').click(); expect(c.saved).toHaveLength(3);
      }
      edit('pin', '"'); edit('tags', '['); edit('types', '["film"," film "]');
      edit('tags', JSON.stringify(pairs)); await c.settleChecked();
      expect(c.$('save').disabled).toBe(true); expect(field('pin').value).toBe('"');
      edit('pin', JSON.stringify(pin)); edit('tags', '['); const stale = field('tags');
      await search('merch'); expect(field('tags').value).toBe('[]'); expect(field('pin').value).toBe('"cnt_m"');
      stale.value = '[]'; stale.dispatchEvent(new c.w.Event('input', { bubbles: true }));
      edit('types', '["film"]'); await c.settleChecked(); expect(c.$('save').disabled).toBe(true);
      await search('chero'); expect(field('tags').value).toBe('[');
      edit('tags', JSON.stringify(pairs)); await save();
      expect((c.saved[3]!.document as SlotCatalog).pages.home![1]!.allowedTypes).toEqual(['film']);
      edit('pin', 'null'); edit('types', 'null'); edit('tags', '[]'); await save();
      const cleared = (c.saved[4]!.document as SlotCatalog).pages.home![0]!;
      expect(cleared).not.toHaveProperty('pinnedPieceId'); expect(cleared).not.toHaveProperty('allowedTypes'); expect(cleared.excludedTags).toEqual([]);
      expect(field('pin').value).toBe('null'); expect(field('types').value).toBe('null');
      edit('pin', '"'); edit('types', '['); c.$('discard').click(); await c.settleChecked();
      expect(field('pin').value).toBe('null'); expect(field('types').value).toBe('null');
      await search(''); await c.goTo('#/history?scope=coach&slot=chero');
      const section = c.all('#view section').find(el => el.querySelector('h3')?.textContent === 'The slots and their rules')!;
      const previous = Array.from(section.querySelectorAll('tbody tr')).find(el => el.querySelector('td')?.textContent === '8')!;
      previous.querySelector('button')!.click(); await c.settle(); await c.settle();
      expect(c.text()).toContain('Rolled revision 8 forward as revision 10');
      await c.goTo('#/rules?scope=coach&slot=chero');
      expect(field('pin').value).toBe(JSON.stringify(pin)); expect(field('types').value).toBe('["film"," film "]'); expect(field('tags').value).toBe(JSON.stringify(pairs));
      edit('tags', '['); await c.goTo('#/rules?scope=brighthour&slot=chero');
      expect(field('tags').value).toBe(JSON.stringify(pairs)); expect(c.text()).not.toContain('must be a valid JSON array');
      expect(c.saved).toHaveLength(5);
    } finally { c.close(); }
  }, 20_000);

  it('W20.03 edits exact hard controls with real validation scoped draft state and History rollback', async () => {
    const c = await open();
    const field = () => c.all('[data-focus-key="governance.excluded"]')[0]!;
    const edit = (value: string) => { const el = field(); el.value = value; el.dispatchEvent(new c.w.Event('input', { bubbles: true })); };
    const off = (on: boolean) => { const el = c.all('[data-focus-key="governance.off"]')[0]!; el.value = String(on); el.dispatchEvent(new c.w.Event('change', { bubbles: true })); };
    const search = async (value: string) => { c.$('slot-q').value = value; c.$('slot-q').dispatchEvent(new c.w.Event('input', { bubbles: true })); await c.settleChecked(); };
    const save = async () => { await c.settleChecked(); expect(c.$('save').disabled).toBe(false); c.$('save').click(); await c.settle(); };
    const ids = [' a ', 'a,b', 'a\nb', '"[]"', '__proto__'];
    try {
      await c.signIn(); await c.goTo('#/rules?scope=coach&slot=chero');
      expect(field().value).toBe('[]'); edit(JSON.stringify(ids)); await save();
      const first = c.saved[0]!.document as SlotCatalog;
      expect(first.pages.home![0]!.excludedPieceIds).toEqual(ids);
      expect(first.pages.home![0]!.weights).toEqual(SLOTS_DOC.pages.home![0]!.weights);
      expect(first.pages.home![0]!.freshness).toEqual(SLOTS_DOC.pages.home![0]!.freshness);
      expect(first.pages.home![1]).toEqual(SLOTS_DOC.pages.home![1]);
      expect(field().value).toBe(JSON.stringify(ids)); expect(c.text()).toContain('from revision 5');
      for (const text of ['[', '["same","same"]', 'null', '[1]']) {
        edit(text); await c.settleChecked(); expect(c.$('save').disabled).toBe(true);
        c.$('save').click(); expect(c.saved).toHaveLength(1); expect(field().value).toBe(text);
      }
      edit('['); const stale = field();
      await search('merch');
      expect(field().value).toBe('[]'); expect(c.$('save').disabled).toBe(true);
      stale.value = '["wrong-slot"]'; stale.dispatchEvent(new c.w.Event('input', { bubbles: true }));
      expect(field().value).toBe('[]'); expect(c.$('save').disabled).toBe(true);
      off(true); await c.settleChecked(); expect(c.$('save').disabled).toBe(true); // Another slot's malformed text still blocks the document.
      await search('chero'); expect(field().value).toBe('[');
      edit(JSON.stringify(ids)); await c.settleChecked();
      await search('merch'); edit('["cnt_m"]'); await save();
      const dormant = c.saved[1]!.document as SlotCatalog;
      expect(dormant.governanceVersion).toBe(3);
      expect(dormant.pages.home![1]).toMatchObject({ offLimits: true, pinnedPieceId: 'cnt_m', excludedPieceIds: ['cnt_m'] });
      expect(dormant.pages.home![0]!.excludedPieceIds).toEqual(ids);
      expect(c.text()).toContain('dormant while off-limits'); expect(c.text()).not.toContain('nothing pinned; the engine ranks the slot');
      off(false); await c.settleChecked(); expect(c.$('save').disabled).toBe(true);
      c.$('save').click(); expect(c.saved).toHaveLength(2);
      c.$('discard').click(); await c.settleChecked(); expect(field().value).toBe('["cnt_m"]');
      expect(c.all('[data-focus-key="governance.off"]')[0]!.value).toBe('true');
      edit('[]'); off(false); await save(); expect(c.saved).toHaveLength(3);
      expect((c.saved[2]!.document as SlotCatalog).pages.home![1]).toMatchObject({ offLimits: false, excludedPieceIds: [], pinnedPieceId: 'cnt_m' });
      await search(''); await c.goTo('#/history?scope=coach&slot=merch');
      const section = c.all('#view section').find(el => el.querySelector('h3')?.textContent === 'The slots and their rules')!;
      const previous = Array.from(section.querySelectorAll('tbody tr')).find(el => el.querySelector('td')?.textContent === '6')!;
      previous.querySelector('button')!.click(); await c.settle(); await c.settle();
      expect(c.text()).toContain('Rolled revision 6 forward as revision 8');
      await c.goTo('#/rules?scope=coach&slot=merch');
      expect(field().value).toBe('["cnt_m"]'); expect(c.all('[data-focus-key="governance.off"]')[0]!.value).toBe('true');
      expect(c.text()).toContain('from revision 8');
      edit('['); await c.goTo('#/rules?scope=brighthour&slot=merch');
      expect(field().value).toBe('["cnt_m"]'); expect(c.text()).not.toContain('must be a valid JSON array');
      expect(c.saved).toHaveLength(3);
    } finally { c.close(); }
  }, 20_000);

  it('W18.01 validates stage bounds and neutral clears with real scoring and the other rule defaults', async () => {
    const c = await open();
    const input = (key: string, value: string) => {
      const el = c.all(`[data-focus-key="${key}"]`)[0]!;
      el.value = value; el.dispatchEvent(new c.w.Event('input', { bubbles: true }));
    };
    const toggleRule = (name: string, value: string) => {
      const el = c.all('#view select').find(x => x.dataset.focusKey === `rule:${name}`)!;
      el.value = value; el.dispatchEvent(new c.w.Event('change', { bubbles: true }));
    };
    const save = async () => { await c.settleChecked(); expect(c.$('save').disabled).toBe(false); c.$('save').click(); await c.settle(); };
    try {
      await c.signIn(); await c.goTo('#/rules?scope=coach&slot=chero');
      toggleRule('Where the shopper is in her journey', 'on'); await c.settleChecked();
      for (const key of ['stage.in', 'stage.out']) {
        expect(c.all(`[data-focus-key="${key}"]`)[0]!.getAttribute('min')).toBe('0');
        expect(c.all(`[data-focus-key="${key}"]`)[0]!.getAttribute('max')).toBe('1');
      }
      expect(c.text()).toContain('Added to its score, not multiplied');
      expect(c.text()).toContain('not eligibility'); expect(c.text()).not.toContain('removes it from this slot');
      input('stage.in', '1'); await c.settleChecked(); expect(c.$('save').disabled).toBe(false);
      input('stage.in', '1.2'); await c.settleChecked(); expect(c.$('save').disabled).toBe(true);
      c.$('save').click(); expect(c.saved).toEqual([]); expect(c.log.some(x => x.startsWith('PUT /content/slots'))).toBe(false);
      input('stage.in', '0.2');
      for (const name of ['How often she has already seen it', 'How much of one thing it may show', 'Season, promotion and margin']) toggleRule(name, 'on');
      await save();
      const modest = c.saved[0]!.document as SlotCatalog, st = modest.pages.home[0]!;
      expect(st).toMatchObject({ stage: { outOfStage: 0.5, inStage: 0.2 }, freshness: { weight: 0.2, halfLifeDays: 14 },
        fatigue: { weight: 0.3, windowHours: 24, cap: 3 }, diversity: { dimension: 'category', max: 2 },
        merchandising: { season: 0, promotion: 0, margin: 0, maxBoost: 2, minBoost: 0.5 } });
      expect(validateSlotCatalog(modest).ok).toBe(true); expect(modest.pages.home[1]).toEqual(SLOTS_DOC.pages.home[1]);
      input('stage.out', ''); input('stage.in', ''); await save();
      const neutral = (c.saved[1]!.document as SlotCatalog).pages.home[0]!;
      expect(neutral.stage).toEqual({ outOfStage: 1, inStage: 0 });
      expect(c.all('[data-focus-key="stage.out"]')[0]!.value).toBe('1');
      expect(c.all('[data-focus-key="stage.in"]')[0]!.value).toBe('0');
      input('stage.out', '0'); await save();
      const zero = (c.saved[2]!.document as SlotCatalog).pages.home[0]!;
      toggleRule('Where the shopper is in her journey', 'off'); await save();
      const off = (c.saved[3]!.document as SlotCatalog).pages.home[0]!;
      expect(off).not.toHaveProperty('stage'); expect(off.weights).toEqual(st.weights);
      const now = Date.parse('2026-09-13T12:00:00Z');
      const decision: DecideInput = { tenant: 'synthetic', brand: 'synthetic', page: 'home', visitorId: 'visitor', sessionId: null,
        identityAnchor: 'visitor', nowMs: now, slots: [st], arm: 'personalized', cell: { channel: 'direct', visit_bucket: '1', stage: 'mid', region: null, affinity: null },
        affinity: { dims: { line: { strong: 0.9, weak: 0.05 } } }, versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'synthetic',
        pieces: [
          { id: 'out', customerContentId: 'cms-out', type: 'editorial', title: 'Out', tags: { line: ['strong'] }, slotTypes: ['chero'], lifecycle: { status: 'live' }, journeyStageFit: ['exploring'], freshnessDate: new Date(now).toISOString() },
          { id: 'in', customerContentId: 'cms-in', type: 'editorial', title: 'In', tags: { line: ['weak'] }, slotTypes: ['chero'], lifecycle: { status: 'live' }, journeyStageFit: ['considering'] },
        ] };
      const moderate = decideContent(decision);
      expect(moderate.records.map(r => r.item_id)).toEqual(['out', 'in']);
      expect(moderate.records[1]!.explain.stage!.applied).toBe(0.2);
      expect(decideContent({ ...decision, slots: [neutral] }).decisions).toEqual(decideContent({ ...decision, slots: [off] }).decisions);
      const stillEligible = decideContent({ ...decision, slots: [zero] }).records.find(r => r.item_id === 'out')!;
      expect(stillEligible.explain.score_final).toBe(0.2); expect(stillEligible.explain.freshness!.applied).toBe(0.2);
      expectNoStrayRulesText(c.text());
    } finally { c.close(); }
  }, 15_000);

  it('W18.01 edits registry weights with validated readback, visible consequences and existing History rollback', async () => {
    const unusual = 'interest" [special]';
    const original: SlotCatalog = structuredClone(SLOTS_DOC);
    original.pages.home[0]!.weights = { topic: 0.6, intent: 0.1, orphan: 0.4 };
    const fx: Fixtures = { enforced: true, slotDocument: original, registry: { ...REFLEX,
      dimensions: [{ key: 'topic', source: 'topic' }, { key: 'intent', source: 'intent' }, { key: unusual, source: unusual }] } };
    const c = await open(fx, '#/rules?scope=brighthour&slot=chero');
    const edit = (index: number, value: string) => {
      const el = c.all(`[data-focus-key="weight:${index}"]`)[0]!; el.focus();
      el.value = value; el.dispatchEvent(new c.w.Event('input', { bubbles: true }));
    };
    try {
      await c.signIn();
      expect(c.all('[data-focus-key^="weight:"]').map(el => el.value)).toEqual(['0.6', '0.1', '0']);
      expect(c.text()).toContain('Weight on ' + unusual); expect(c.text()).toContain('orphan');
      expect(c.text()).toContain('read-only here'); expect(c.all('[data-focus-key="weight:3"]')).toEqual([]);
      for (const request of c.requests.filter(r => r.url.startsWith('/config/reflex'))) {
        expect(request.headers['x-tenant']).toBe('brighthour'); expect(request.url).toContain('scope=tenant%3Abrighthour');
      }
      edit(0, '1.01'); await c.settleChecked(); expect(c.$('save').disabled).toBe(true);
      c.$('save').click(); expect(c.saved).toEqual([]); expect(c.log.some(x => x.startsWith('PUT /content/slots'))).toBe(false);
      edit(0, '0'); edit(1, '1'); edit(2, '0.25'); await c.settleChecked();
      expect(c.$('save').disabled).toBe(false); c.$('note').value = 'prefer intent'; c.$('save').click(); await c.settle();
      const changed = c.saved[0]!.document as SlotCatalog;
      expect(changed.pages.home[0]!.weights).toEqual({ topic: 0, intent: 1, orphan: 0.4, [unusual]: 0.25 });
      expect(changed.pages.home[1]).toEqual(original.pages.home[1]);
      expect(changed.pages.home[0]!.freshness).toEqual(original.pages.home[0]!.freshness);
      expect(c.all('[data-focus-key^="weight:"]').map(el => el.value)).toEqual(['0', '1', '0.25']);
      expect(c.text()).toContain('from revision 5'); expect(c.$('savebar').hidden).toBe(true);
      const decision: DecideInput = { tenant: 'synthetic', brand: 'synthetic', page: 'home', visitorId: 'visitor', sessionId: null,
        identityAnchor: 'visitor', nowMs: 1, slots: original.pages.home, arm: 'personalized', cell: { channel: 'direct', visit_bucket: '1', region: null, affinity: null },
        affinity: { dims: { topic: { first: 0.9 }, intent: { second: 0.8 } } }, versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'synthetic',
        pieces: ['first', 'second'].map((id, i) => ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id,
          tags: { [i ? 'intent' : 'topic']: [id] }, slotTypes: ['chero'], lifecycle: { status: 'live' as const } })) };
      expect(decideContent(decision).decisions[0]!.contentId).toBe('first');
      expect(decideContent({ ...decision, slots: changed.pages.home }).decisions[0]!.contentId).toBe('second');
      edit(2, ''); await c.settleChecked(); c.$('save').click(); await c.settle();
      expect((c.saved[1]!.document as SlotCatalog).pages.home[0]!.weights[unusual]).toBe(0);
      expect(c.all('[data-focus-key="weight:2"]')[0]!.value).toBe('0');
      c.all('#view a').find(el => el.textContent === 'History and rollback')!.click(); await c.settle(); await c.settle();
      const history = c.all('#view section').find(el => el.querySelector('h3')?.textContent === 'The slots and their rules')!;
      const old = Array.from(history.querySelectorAll('tbody tr')).find(el => el.querySelector('td')?.textContent === '4')!;
      old.querySelector('button')!.click(); await c.settle(); await c.settle();
      expect(c.text()).toContain('Rolled revision 4 forward as revision 7');
      await c.goTo('#/rules?scope=brighthour&slot=chero');
      expect(c.all('[data-focus-key^="weight:"]').map(el => el.value)).toEqual(['0.6', '0.1', '0']);
      expect(c.text()).toContain('from revision 7');
      for (const registry of [{}, { dimensions: [] }]) {
        fx.registry = registry;
        await c.goTo('#/rules?scope=brighthour&slot=merch');
        expect(c.text()).toContain('Dimension editor unavailable'); expect(c.all('[data-focus-key^="weight:"]')).toEqual([]);
        await c.goTo('#/rules?scope=brighthour&slot=chero');
        expect(c.text()).toContain('orphan'); expect(c.all('[data-focus-key^="weight:"]')).toEqual([]);
      }
      fx.registryStatus = 503;
      await c.goTo('#/rules?scope=brighthour&slot=merch');
      expect(c.text()).toContain('Dimension editor unavailable'); expectNoStrayRulesText(c.text());
      fx.registryStatus = 200; fx.registry = { dimensions: [{ key: 'late', source: 'late' }] };
      let release!: () => void;
      fx.registryGate = tenant => tenant === 'acme' ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
      await c.goTo('#/rules?scope=acme&slot=chero');
      expect(c.all('[data-focus-key^="weight:"]')).toEqual([]); expect(c.$('savebar').hidden).toBe(true);
      fx.registry = { dimensions: [{ key: 'current', source: 'current' }] };
      await c.goTo('#/rules?scope=globex&slot=chero');
      expect(c.text()).toContain('Weight on current'); release(); await c.settle();
      expect(c.text()).not.toContain('Weight on late'); expect(c.text()).toContain('Weight on current');
      let releaseContext!: () => void;
      fx.contextGate = () => new Promise<void>(resolve => { releaseContext = resolve; });
      edit(0, '1'); await c.settleChecked();
      await c.goTo('#/rules?scope=other&slot=chero');
      const puts = c.log.filter(line => line.startsWith('PUT /content/slots')).length;
      c.$('save').click(); await c.settle();
      expect(c.log.filter(line => line.startsWith('PUT /content/slots'))).toHaveLength(puts);
      releaseContext(); await c.settle();
      expect(c.saved).toHaveLength(2);
    } finally { c.close(); }
  }, 15_000);

  it('W31.01 renders mixed and unknown computation withholding before empty rows without experimental claims', async () => {
    for (const status of ['mixed', 'unknown', 'legacy'] as const) {
      const c = await open({ dayReport: { ...DAY, grids: {}, holdout: {} }, windowReport: { ...WINDOW,
        compatibility: status === 'legacy' ? undefined : WINDOW.compatibility,
        slots: { chero: { ...WINDOW.slots.chero, compatibility: status === 'legacy' ? undefined : {
          status, reasons: [status === 'mixed' ? 'mixed_basis' : 'unknown_basis'], days: WINDOW.days,
        } } } } });
      try {
        await c.signIn(); await c.goTo('#/measure?scope=coach&slot=chero');
        expect(c.text()).toContain('Pooled attribution values withheld, not zero or missing');
        expect(c.text()).toContain('Computation basis: ' + (status === 'mixed' ? 'mixed' : 'unknown'));
        expect(c.text()).toContain('2026-09-04'); expect(c.text()).toContain('2026-09-05');
        expect(c.text()).toContain('served control and enrollment remain unverified');
        expect(c.text()).toContain('Incomplete coverage for 2026-09-04');
        expect(c.all('#view tr').filter(row => /^(default|personalized)$/.test(row.querySelectorAll('td')[0]?.textContent ?? ''))).toHaveLength(0);
        expect(c.saved).toEqual([]); expect(c.text()).not.toMatch(STRAY);
      } finally { c.close(); }
    }
  });

  it('W30.02 renders dated day and window coverage even without grids or arm rows', async () => {
    const coverage = { version: 1, source: 'aggregates', metadata: 'recorded', maturity: 'unknown', truncated: true, visitorsIncomplete: true, missingHours: [14], truncatedHours: [12], unadvancedHours: [13], unknownHours: [13], horizons: [{ hour: 12, horizonMs: 0 }, { hour: 13, horizonMs: null }], minHorizonMs: 99 * 3600_000 };
    const known = { ...coverage, missingHours: [], unknownHours: [], horizons: [{ hour: 12, horizonMs: 0 }, { hour: 13, horizonMs: 3600_000 }] };
    const malformed = { ...known, horizons: [null, {}] };
    for (const detail of [coverage, undefined, known, malformed]) {
      const c = await open({ dayReport: { ...DAY, hours: { source: 'aggregates', built: [12, 13], missing: detail?.missingHours ?? [14] }, grids: {}, holdout: {}, coverage: detail }, windowReport: { ...WINDOW, days: [DAY.date], missing: detail === known ? [] : ['2026-09-03'], slots: {}, coverage: detail ? { version: 1, maturity: 'unknown', minHorizonMs: 99 * 3600_000, days: [...(detail === malformed ? [null] : []), { date: DAY.date, coverage: detail }] } : undefined } });
      try {
        await c.signIn(); await c.goTo('#/measure?scope=coach&slot=chero');
        const text = c.text(); expect(text).toContain('contain no recorded arm counts');
        expect(text).toContain('Outcome maturity: unknown'); expect(text).toContain(detail === known ? 'Minimum reported window contributing horizon: 0h' : 'Minimum window contributing horizon: unknown');
        expect(text).not.toContain('horizon: 99h');
        expect(text).not.toMatch(STRAY);
        if (detail) {
          for (const value of [`${DAY.date}: Truncated hours: 12`, 'Ring progress not advanced for hours: 13', 'Visitor coverage is incomplete', 'does not mean every reported credit is wrong']) expect(text).toContain(value);
          if (detail === coverage) expect(text).toContain('12: 0h, 13: unknown');
          if (detail === malformed) expect(text).toContain('Per-day coverage metadata absent or invalid');
        }
        else expect(text).toContain('Per-day coverage metadata absent or invalid');
        expect(c.saved).toEqual([]);
      } finally { c.close(); }
    }
  });

  it('measurement shows raw attribution diagnostics and ignores legacy inference for window and day', async () => {
    const c = await open();
    try {
      await c.signIn();
      await c.goTo('#/measure?scope=coach&slot=chero');
      expect(c.$('view-title').textContent).toBe('Attribution diagnostics');
      expect(c.text()).toContain('Over the window · chero');
      expect(c.text()).toContain('Experimental inference is unavailable');
      expect(c.text()).toContain('2 days read, 1 day with no report');
      expect(c.text()).toContain('Incomplete coverage for 2026-09-04: source coverage incomplete; 1 hour missing (13)');
      expect(c.text()).toContain('more than one credit per decision');
      expect(c.text()).toContain('184 days inclusive; byte and row budgets can still refuse a smaller window');
      expect(c.text()).not.toMatch(/not yet distinguishable|4,820|on track|minimum 10%|At 90%|paid off|finance|Confidence/);
      expect(c.all('[data-focus-key="conf"]')).toEqual([]);
      expect(c.log.filter((entry) => entry.includes('/learn/report/window')).every((entry) => !entry.includes('confidence='))).toBe(true);
      const armRows = () => c.all('#view tbody tr').filter((row) => /^(default|personalized)/.test(row.textContent || ''));
      const values = (row: El) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent);
      expect(armRows().map(values)).toEqual([['default', '0', '2', '—'], ['personalized', '1', '3', '3']]);
      // A day with no report says so rather than showing an empty table.
      expect(c.text()).toContain('No report for this day yet');
      expect(c.text()).not.toMatch(STRAY);

      // The view forwards both endpoints unchanged; this stub remains a diagnostic,
      // not a claim that its two synthetic report days cover the selected six months.
      for (const [key, value] of [['from', '2026-07-01'], ['to', '2026-12-31']] as const) {
        const input = c.all(`[data-focus-key="${key}"]`)[0]!;
        input.value = value; input.dispatchEvent(new c.w.Event('change', { bubbles: true }));
        await c.settle();
      }
      const request = new URL(c.log.filter(entry => entry.includes('/learn/report/window')).at(-1)!.slice(4), 'https://console.test');
      expect(request.searchParams.get('from')).toBe('2026-07-01'); expect(request.searchParams.get('to')).toBe('2026-12-31');
      expect(c.all('[data-focus-key="from"]')[0]!.value).toBe('2026-07-01'); expect(c.all('[data-focus-key="to"]')[0]!.value).toBe('2026-12-31');
      expect(c.text()).toContain('Experimental inference is unavailable');

      // Building the day reads the ledger and changes nothing served.
      const build = c.all('#view button').find((b) => (b.textContent || '').includes('Build this day'))!;
      build.click(); await c.settle(); await c.settle();
      // The day the view builds is TODAY IN UTC, which is what iso(Date.now())
      // returns. Hardcoding a date made this test fail every night between
      // midnight UTC and midnight local, which is not a property of the code.
      const todayUtc = new Date().toISOString().slice(0, 10);
      expect(c.saved.some((x) => x.date === todayUtc)).toBe(true);
      expect(c.text()).toContain('117 decisions, 9 outcomes, 9 visitors');
      expect(c.text()).toContain('learning 4 · visitor-scope 9');
      expect(c.text()).toContain('9% of 96 decisions in the first position, against 10% configured');
      expect(c.text()).toContain('What each policy would have credited · chero');
      expect(c.text()).toContain('learning multiplier');
      expect(c.text()).toContain('it is not measured business lift');
      expect(c.text()).toContain('incomplete coverage');
      expect(c.text()).toContain('Incomplete coverage: 1 hour missing (13)');
      expect(armRows().map(values)).toEqual([
        ['default', '0', '2', '—'], ['personalized', '1', '3', '3'],
        ['default', '0', '2', '—'], ['personalized', '1', '3', '3'],
      ]);
      expect(c.text()).not.toMatch(/not yet distinguishable|4,820|on track|minimum 10%|paid off|finance|Confidence/);
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('history shows every document, names who changed it, and can roll one back', async () => {
    const c = await open();
    try {
      await c.signIn();
      await c.goTo('#/history?scope=coach&slot=chero');
      for (const title of ['What the engine notices', 'What the engine may do', 'The slots and their rules', 'The content catalog', 'Imported priors'])
        expect(c.text()).toContain(title);
      expect(c.text()).toContain('Local Ops');
      expect(c.text()).toContain('in force');
      // Priors has nothing stored, and says so rather than showing an empty table.
      expect(c.text()).toContain('Nothing stored for this brand');
      expect(c.text()).toContain('Published snapshots · chero');
      expect(c.text()).toContain('2 KB');
      expect(c.text()).not.toMatch(STRAY);
      const back = c.all('#view .link').find((b) => (b.textContent || '').includes('Roll back'))!;
      back.click(); await c.settle(); await c.settle();
      expect(c.text()).toContain('Rolled revision 1 forward as revision 7');
    } finally { c.close(); }
  });

  it('a view that throws shows its own error and leaves the rest of the console standing', async () => {
    const c = await open();
    try {
      await c.goTo('#/work?scope=coach');
      c.w.eval("Console.view({ id: 'boom', group: 'Attention', title: 'Boom', heading: 'Boom', render() { throw new Error('on purpose'); } });");
      await c.goTo('#/boom?scope=coach');
      expect(c.text()).toContain('This screen could not be drawn: on purpose');
      expect(c.text()).toContain('The rest of the console still works');
      // The rail and the context are still there, so the operator can leave.
      expect(c.all('#rail-views a').length).toBeGreaterThan(4);
      expect(c.$('slot').value).toBe('chero');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('a temporary password is asked to be changed, and cannot be dismissed until it is', async () => {
    const c = await open();
    try {
      await c.signIn('temp-password');
      expect(c.$('who').textContent).toBe('Signed in as Test Operator');
      // The console works, and says the account is not finished.
      expect(c.$('password-form').hidden).toBe(false);
      expect(c.$('pw-note').textContent).toBe('You signed in with a temporary password. Choose your own to carry on.');
      c.$('pw-cancel').click(); await c.settle();
      expect(c.$('password-form').hidden).toBe(false);   // it will not go away

      c.$('pw-current').value = 'temp-password';
      c.$('pw-new').value = 'a-chosen-password';
      c.$('password-form').dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
      await c.settle(); await c.settle();
      expect(c.saved.some((x) => x.passwordChangedTo === 'a-chosen-password')).toBe(true);
      expect(c.$('password-form').hidden).toBe(true);
      expect(c.text()).toContain('Your password is changed');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('an ordinary sign-in is not asked to change anything', async () => {
    const c = await open();
    try {
      await c.signIn();
      expect(c.$('password-form').hidden).toBe(true);
      expect(c.$('change-password').hidden).toBe(false);
      c.$('change-password').click(); await c.settle();
      expect(c.$('password-form').hidden).toBe(false);
      c.$('pw-cancel').click(); await c.settle();
      expect(c.$('password-form').hidden).toBe(true);    // this one may be dismissed
    } finally { c.close(); }
  });

  it('proposals and erasures require sign-in; historical proposals stay read only after sign-in', async () => {
    const c = await open();
    try {
      await c.goTo('#/proposals?scope=coach');
      expect(c.text()).toContain('Sign in to read the proposals');
      await c.goTo('#/erasures?scope=coach');
      expect(c.text()).toContain('Sign in to read the erasures');
      await c.signIn();
      await c.goTo('#/proposals?scope=coach');
      expect(c.text()).toContain('line from 0.25 to 0.3');
      expect(c.text()).toContain('line spread 0.12');
      expect(c.text()).toContain('Stored status (unverified)');
      expect(c.text()).toContain('not a complete audit trail');
      expect(c.all('#view button')).toHaveLength(0);
      expect(c.log.some((line) => line.startsWith('POST') && /learn\/(proposals|cycle)/.test(line))).toBe(false);
      await c.goTo('#/erasures?scope=coach');
      expect(c.text()).toContain('vis-1');
      expect(c.text()).toContain('kept 90 days');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  // ── A platform that answers, but answers wrongly ──────────────────────────
  // The preview store once ran without its migrations, so /auth/login answered
  // 500 and every screen behind it read as "still loading". A screen that cannot
  // read its data has to say that, on every route, signed in or out.
  it('never leaves a screen on the word Loading when the platform is broken', async () => {
    for (const route of ['work', 'lift', 'slots', 'dials', 'rules', 'interests', 'proposals', 'erasures', 'measure', 'history']) {
      const c = await open({ dead: true }, `#/${route}?scope=coach&slot=chero`);
      try {
        await c.settle();
        const shown = c.$('view').textContent || '';
        expect(shown, `${route} sat on a loading string`).not.toMatch(STILL_LOADING);
        expect(shown.trim().length, `${route} painted nothing at all`).toBeGreaterThan(0);
        expectNoStrayRulesText(c.text());
      } finally { c.close(); }
    }
  });

  it('says so when a sign-in is refused by a broken platform rather than looking signed in', async () => {
    const c = await open({ dead: true });
    try {
      await c.signIn('right-password');
      // The sign-in did not take, and the console says why instead of pretending.
      expect((c.$('si-error').textContent || '').length).toBeGreaterThan(0);
      expect(c.$('sign-in').hidden).toBe(false);
      expect(c.$('who').textContent).toBe('');
    } finally { c.close(); }
  });

  // ── Accounts, the last screen that lived only on the old page ──────────────
  it('W02.08 tenant administrators see only membership controls and send the selected tenant and revision', async () => {
    const c = await open({ authority: { customer: true, stampOwner: false, tenantRole: 'admin' } }, '#/accounts?scope=acme');
    try {
      await c.signIn();
      expect(c.text()).toContain('Memberships for acme only');
      expect(c.text()).not.toContain('Reset password');
      expect(c.log.some(line => line.includes('/auth/users') || line.includes('/auth/audit'))).toBe(false);
      const button = c.all('#view button').find(el => el.textContent === 'Disable');
      expect(button).toBeDefined(); button!.click(); await c.settle(); await c.settle();
      const write = c.requests.find(r => r.method === 'PATCH' && r.url === '/auth/memberships/ops-2');
      expect(write?.headers).toMatchObject({ 'x-tenant': 'acme', 'if-match': '"member-buyer"' });
      expect(c.saved).toContainEqual({ membershipPath: '/auth/memberships/ops-2', method: 'PATCH', body: '{"disabled":true}' });
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('shows an operator why Accounts is empty rather than refusing them', async () => {
    const c = await open({}, '#/accounts?scope=coach');
    try {
      // Signed out first: an instruction, not an error.
      expect(c.$('view').textContent).toContain('Sign in');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('lists the accounts and the activity for an admin, and never offers to remove yourself', async () => {
    const c = await open({}, '#/accounts?scope=coach');
    try {
      await c.signIn();
      const shown = c.$('view').textContent || '';
      expect(shown).toContain('ops@brand.test');
      expect(shown).toContain('buyer@brand.test');
      // The state of an account nobody has signed into yet is said in words.
      expect(shown).toContain('temporary password, not yet changed');
      // The audit is joined to words, never left as a raw action name.
      expect(shown).toContain('created the account');
      expect(shown).not.toContain('account_created');
      // The person signed in cannot remove themselves.
      expect(shown).toContain('this is you');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('shows a new account\'s temporary password once, in the page, and says it cannot be recovered', async () => {
    const c = await open({}, '#/accounts?scope=coach');
    try {
      await c.signIn();
      const emailBox = c.all('#view input[data-focus-key="acct-email"]')[0];
      const nameBox = c.all('#view input[data-focus-key="acct-name"]')[0];
      emailBox.value = 'new@brand.test';
      nameBox.value = 'New Person';
      const form = c.$('view').querySelector('form') as unknown as { dispatchEvent: (e: unknown) => boolean };
      form.dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
      await c.settle(); await c.settle();
      expect(c.saved.some((x) => x.createdAccount === 'new@brand.test')).toBe(true);
      const shown = c.$('view').textContent || '';
      expect(shown).toContain('Temp-1234-Temp');
      expect(shown).toContain('shown once');
    } finally { c.close(); }
  });

  // ── The last two screens off the old pages, and the rail with nothing left ──
  it('shows what is under the floor, with the slot\'s exploration in words', async () => {
    const c = await open({}, '#/exploring?scope=coach&slot=chero');
    try {
      await c.settle();
      const shown = c.$('view').textContent || '';
      expect(shown).toContain('Exploring by rotation, 10% of this slot’s impressions, until a piece reaches 50 observations');
      expect(shown).toContain('The new story');
      // A piece with no title falls back to its id rather than printing nothing.
      expect(shown).toContain('cnt_thin');
      expect(shown).toContain('2 pieces');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('answers why a shopper saw something, in her own words, and never as a raw record', async () => {
    const c = await open({}, '#/why?scope=coach&visitor=vis-1');
    try {
      await c.signIn();
      const shown = c.$('view').textContent || '';
      expect(shown).toContain('The Tabby story');
      expect(shown).toContain('position 1 in chero on home');
      expect(shown).toContain('leading interest line tabby');
      expect(shown).toContain('Interest matched: line tabby');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('says an erased shopper was forgotten rather than showing an error', async () => {
    const c = await open({}, '#/why?scope=coach&visitor=erased-one');
    try {
      await c.signIn();
      const shown = c.$('view').textContent || '';
      expect(shown).toContain('asked to be forgotten, and was');
      expect(shown).not.toContain('410');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('has no link left in the rail that leaves the application', async () => {
    const c = await open();
    try {
      // Both old pages redirect here now, so an outbound rail link would point
      // at a redirect back to where you already are.
      expect(c.all('#rail-views a.away')).toHaveLength(0);
      const hrefs = c.all('#rail-views a').map((a) => String(a.getAttribute('href') || ''));
      expect(hrefs.length).toBeGreaterThan(10);
      for (const href of hrefs) expect(href.startsWith('#/')).toBe(true);
      expect(c.$('rail-views').textContent).not.toContain('Leaves this console');
    } finally { c.close(); }
  });
});
it('W11.02 rendered console keeps authored conflicts and reset publication uncertainty through exact retry and reload', async () => {
  const fx: Fixtures = { publicationReply: (url, method) => method === 'POST' && url.pathname.endsWith('/items/reset')
    ? Response.json({ ok: true, had: true, resetCompleted: true, publicationOutcome: 'unknown' }) : undefined };
  const c = await open(fx);
  try {
    await c.signIn();
    type Client = { authored: (v: unknown) => unknown; write: (url: string, method: string, body: unknown, base?: unknown) => Promise<{ ok: boolean; status: number; data: Record<string, unknown> }>; render: () => void };
    const client = c.w.Console as Client, base = client.authored({ revision: 2, publication: { revision: 7, digest: 'a'.repeat(64) } });
    const url = '/v1/coach/learn/items/reset', body = { slot: 'chero', item: 'cnt_a', brand: 'coach' };
    const before = c.requests.length;
    expect((await client.write(url, 'POST', body)).status).toBe(428); expect(c.requests).toHaveLength(before);
    const first = await client.write(url, 'POST', body, base); client.render();
    expect(first.status).toBe(503); expect(c.text()).toContain('Reset completed'); expect(c.text()).toContain('unknown');
    const headers = c.requests.at(-1)!.headers, stored = c.w.eval("sessionStorage.getItem('configuration-pending-v1')");
    expect(headers['if-match']).toBe('"2/7/' + 'a'.repeat(64) + '"');
    expect(JSON.parse(String(stored))).toHaveLength(1);
    expect((await client.write(url, 'POST', { ...body, item: 'different' }, base)).status).toBe(409);
    expect(c.requests.filter(r => r.url === url)).toHaveLength(1);
    // Re-evaluate the real client in the same tab: the retained identity, not a
    // newly loaded base, owns this uncertain destructive continuation.
    c.w.eval(pub('console/shell.js'));
    const restored = c.w.Console as Client;
    expect((await restored.write(url, 'POST', body, { revision: 999 })).status).toBe(503);
    expect(c.requests.at(-1)!.headers['idempotency-key']).toBe(headers['idempotency-key']);
    expect(c.requests.at(-1)!.headers['if-match']).toBe(headers['if-match']);
    fx.publicationReply = (u, method) => method === 'POST' && u.pathname.endsWith('/items/reset')
      ? Response.json({ ok: true, had: true, resetCompleted: true, publicationOutcome: 'acknowledged' }) : undefined;
    c.w.eval("window.savedSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if(k==='configuration-pending-v1'&&v==='[]') throw new Error('synthetic local failure'); return window.savedSetItem.call(this,k,v); }");
    expect((await restored.write(url, 'POST', body)).status).toBe(503);
    c.w.eval('Storage.prototype.setItem = window.savedSetItem');
    expect((await restored.write(url, 'POST', body)).ok).toBe(true);
    expect(c.requests.at(-1)!.headers['idempotency-key']).toBe(headers['idempotency-key']);
    expect(JSON.parse(String(c.w.eval("sessionStorage.getItem('configuration-pending-v1')")))).toEqual([]);
    fx.publicationReply = () => Response.json({ ok: false, code: 'publication_conflict', error: 'Definite other operation' }, { status: 409 });
    expect((await restored.write(url, 'POST', body, base)).status).toBe(409); restored.render();
    const status = c.all('button').find(el => el.textContent === 'Check original status')!; status.click(); await c.settle();
    const discard = c.all('button').find(el => el.textContent === 'Discard conflicted draft')!; expect(discard).toBeDefined(); discard.click(); await c.settle();
    expect(JSON.parse(String(c.w.eval("sessionStorage.getItem('configuration-pending-v1')")))).toEqual([]);
  } finally { c.close(); }
});
