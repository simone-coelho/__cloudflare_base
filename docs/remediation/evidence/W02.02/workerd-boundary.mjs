// Local workerd only. Actual routers and successful in-memory account/KV stores;
// no Wrangler settings, native resources, real credentials, or outbound service.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const valid = { JWT_SECRET: 'w0202-synthetic-signing-material-32bytes', JWT_ISSUER: 'w0202', JWT_AUDIENCE: 'w0202' };
const placeholder = 'development-secret-key-change-in-production';
const expectedBefore = {
  'src/middleware/auth.ts': 'a3a7be192b89395fed567d59b48aed6076f7e80797c8a6c175bff20ff6fce5ea',
  'src/routes/auth.ts': '678fd63e42f5ce93b2cce1eb7f6d7a05ee98cbb33d7f18c3b9e04e279ff8d20e',
  'src/routes/health.ts': 'aff5a4bd2eff3caf35136f4550dbc85e5f1647fb7bbc0f662b71dc5ee65e3d6e',
};
const retained = JSON.parse(readFileSync(new URL('./before-source.json', import.meta.url), 'utf8'));
const before = new Map(retained.files.filter((file) => expectedBefore[file.path]).map((file) => {
  assert.equal(file.sha256, expectedBefore[file.path]);
  assert.equal(createHash('sha256').update(file.content).digest('hex'), file.sha256);
  return [file.path, file.content];
}));
assert.equal(before.size, 3);
const wrapper = `
import { Hono } from 'hono';
import * as jose from 'jose';
import { authRoutes } from './src/routes/auth.ts';
import { healthRoutes } from './src/routes/health.ts';
import { configRoutes } from './src/routes/config.ts';
import { memoryStore } from './src/auth/store.ts';
import { invalidateConfigCache } from './src/reflex/configStore.ts';
import { sdkKey } from './src/middleware/edgeAccess.ts';
export default { async fetch(transport) {
 const input = await transport.json(); invalidateConfigCache();
 const config = {...${JSON.stringify(valid)}, ...input.config};
 for (const field of input.remove || []) delete config[field];
 const calls = [], reads = [], authSeen = [], results = [], store = memoryStore();
 const user = {id:'synthetic-ops',email:'operator@example.invalid',name:'Synthetic',password:'synthetic password 123',roles:['admin'],permissions:['*']};
 const cache = new Map([['user:'+user.email,JSON.stringify(user)],['user_id:'+user.id,JSON.stringify(user)]]);
 const accounts = new Proxy(store,{get(t,k){const v=t[k];return typeof v==='function'?async(...a)=>{calls.push('ACCOUNTS.'+String(k));return v.apply(t,a)}:v;}});
 const env = new Proxy({...config,AUTH_MODE:'enforced',SDK_KEYS:'acme:synthetic-sdk',ACCOUNTS:accounts,CACHE:{
  async get(k,type){calls.push('CACHE.get');const v=cache.get(k);return v===undefined?null:type==='json'?JSON.parse(v):v;},
  async put(k,v){calls.push('CACHE.put');cache.set(k,v);},async delete(k){calls.push('CACHE.delete');cache.delete(k);}
 }},{get(t,k){if(['ACCOUNTS','CACHE','DB'].includes(String(k)))reads.push(String(k));return t[k];}});
 const app = new Hono();app.onError(()=>new Response('Signing failed',{status:500}));
 app.use('*',async(c,next)=>{await next();authSeen.push(Boolean(c.get('auth')?.isAuthenticated));});
 app.route('/auth',authRoutes);app.route('/health',healthRoutes);app.route('/config',configRoutes);
 app.use('/v1/:tenant/*',sdkKey());app.get('/v1/:tenant/probe',c=>{calls.push('sdk.dispatch');return c.json({ok:true});});
 const snapshot=()=>JSON.stringify({users:[...store.users],sessions:[...store.sessions],audit:store.log,cache:[...cache]});
 const json=(value,token,method='POST')=>({method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(value)});
 async function call(path,init){const state=snapshot(), c=calls.length,r=reads.length;const res=await app.request('https://synthetic.invalid'+path,init,env);const text=await res.text();let body;try{body=JSON.parse(text);}catch{body={};}
  results.push({path,status:res.status,error:body.error,cacheControl:res.headers.get('Cache-Control'),calls:calls.slice(c),reads:reads.slice(r),same:state===snapshot(),authenticated:authSeen.at(-1)});return body;}
 await call('/health/ready');await call('/health/live');
 const tokens=await call('/auth/login',json({email:user.email,password:user.password}));
 const afterLogin={accounts:store.users.size,sessions:store.sessions.size,legacyKeys:[...cache.keys()].filter(k=>k.startsWith('user')).length,audit:store.log.map(x=>x.action)};
 if(input.scenario==='flow'){
  let verified=false;
  if(tokens.accessToken&&tokens.refreshToken){
   const access=await jose.jwtVerify(tokens.accessToken,new TextEncoder().encode(config.JWT_SECRET),{issuer:config.JWT_ISSUER,audience:config.JWT_AUDIENCE});
   const refresh=await jose.jwtVerify(tokens.refreshToken,new TextEncoder().encode(config.JWT_SECRET),{issuer:config.JWT_ISSUER,audience:config.JWT_AUDIENCE});
   verified=access.payload.sub===user.id&&access.payload.type===undefined&&refresh.payload.type==='refresh';
   const renewed=await call('/auth/refresh',json({refreshToken:tokens.refreshToken}));
   await call('/auth/me',{headers:{Authorization:'Bearer '+renewed.accessToken}});
   await call('/config/reflex?scope=w0202-runtime',json({patch:{K:7}},renewed.accessToken,'PATCH'));
   const current=await call('/config/reflex?scope=w0202-runtime');
   await call('/auth/me',{headers:{Authorization:'Bearer '+tokens.refreshToken}});
   return Response.json({results,afterLogin,verified,current:{revision:current.revision,K:current.config?.K},configPuts:calls.filter(x=>x==='CACHE.put').length});
  }
  return Response.json({results,afterLogin,verified});
 }
 const signing=typeof config.JWT_SECRET==='string'&&config.JWT_SECRET.length?config:${JSON.stringify(valid)};
 const token=await new jose.SignJWT({sub:user.id,roles:['admin']}).setProtectedHeader({alg:'HS256'}).setIssuedAt()
  .setIssuer(typeof signing.JWT_ISSUER==='string'?signing.JWT_ISSUER:'w0202').setAudience(typeof signing.JWT_AUDIENCE==='string'?signing.JWT_AUDIENCE:'w0202')
  .setExpirationTime('5m').sign(new TextEncoder().encode(signing.JWT_SECRET));
 await call('/auth/login',{method:'POST',body:'{'});
 await call('/auth/refresh',json({refreshToken:token}));await call('/auth/refresh',{method:'POST',body:'{'});
 await call('/auth/me',{headers:{Authorization:'Bearer '+token}});
 await call('/config/reflex?scope=w0202-runtime',json({patch:{K:7}},token,'PATCH'));
 await call('/v1/acme/probe',{headers:{Authorization:'Bearer '+token}});
 return Response.json({results,afterLogin,configPuts:calls.filter(x=>x==='CACHE.put').length});
}};`;

let outbound = 0, requests = 0;
async function runtime(original) {
  const bundled = await build({ stdin: { contents: wrapper, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', conditions: ['workerd', 'worker', 'browser'], logLevel: 'silent',
    plugins: original ? [{ name: 'retained-before-source', setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, (args) => {
        const content = before.get(relative(process.cwd(), args.path));
        if (content !== undefined) return { contents: content, loader: 'ts', resolveDir: dirname(args.path) };
      });
    } }] : [],
  });
  console.log(JSON.stringify({ phase: original ? 'before-inputs' : 'current-inputs', inputs: Object.keys(bundled.metafile.inputs).sort() }));
  const mf = new Miniflare({ modules: [{ type: 'ESModule', path: 'w0202-worker.mjs', contents: bundled.outputFiles[0].text }],
    compatibilityDate: '2025-06-01', outboundService() { outbound++; throw new Error('W02.02 prohibits outbound requests'); } });
  await mf.ready;
  return mf;
}
async function probe(mf, input) {
  requests++;
  const response = await mf.dispatchFetch('http://w0202.local/probe', { method: 'POST', body: JSON.stringify(input) });
  assert.equal(response.status, 200); return response.json();
}
const original = await runtime(true);
try {
  for (const [label, config, remove] of [['missing', {}, ['JWT_SECRET']], ['empty', { JWT_SECRET: '' }],
    ['placeholder', { JWT_SECRET: placeholder }], ['short', { JWT_SECRET: 's' }], ['valid', valid]]) {
    const result = await probe(original, { config, remove });
    assert.equal(result.results[0].status, 200);
    const failedSigning = ['missing', 'empty'].includes(label);
    assert.equal(result.results[2].status, failedSigning ? 500 : 200);
    assert.deepEqual(result.afterLogin, { accounts: 1, sessions: failedSigning ? 0 : 1, legacyKeys: 0,
      audit: failedSigning ? ['account_migrated'] : ['account_migrated', 'sign_in'] });
    if (!failedSigning) { assert.equal(result.configPuts, 3); assert.equal(result.results[7].status, 200); }
    console.log(JSON.stringify({ phase: 'before', label, ready: result.results[0].status, login: result.results[2].status,
      loginCalls: result.results[2].calls, afterLogin: result.afterLogin, configPuts: result.configPuts }));
  }
} finally { await original.dispose(); }

const current = await runtime(false);
let denied = 0, controls = 0;
try {
  const cases = [['missing', {}, ['JWT_SECRET']], ...[null, 123, {}, [], '', ' '.repeat(40), 'a'.repeat(31), 'é'.repeat(15)+'a', placeholder, ' '+placeholder+' ']
    .map((secret, i) => [`secret-${i}`, { JWT_SECRET: secret }]),
    ...['JWT_ISSUER', 'JWT_AUDIENCE'].flatMap(field => [null, 123, {}, [], '', ' \t'].map((value, i) => [`${field}-${i}`, { [field]: value }])),
    ['missing issuer', {}, ['JWT_ISSUER']], ['missing audience', {}, ['JWT_AUDIENCE']]];
  for (const [label, config, remove] of cases) {
    const result = await probe(current, { config, remove });
    for (const step of result.results) {
      if (step.path === '/health/live') { assert.equal(step.status, 200); }
      else { assert.equal(step.status, 503, label+' '+step.path); assert.equal(step.error, 'Authentication configuration unavailable'); assert.equal(step.cacheControl, 'no-store'); denied++; }
      assert.deepEqual(step.calls, []); assert.deepEqual(step.reads, []); assert.equal(step.same, true); assert.equal(step.authenticated, false);
    }
    assert.deepEqual(result.afterLogin, { accounts: 0, sessions: 0, legacyKeys: 2, audit: [] });
    console.log(JSON.stringify({ phase: 'current-negative', label, denials: result.results.length-1, protectedCalls: 0, bindingReads: 0, unchanged: true }));
  }
  for (const [label, key] of [['boundary-ascii', '0123456789abcdef0123456789abcdef'], ['boundary-utf8', 'é'.repeat(16)],
    ['padded', ' '+'a'.repeat(31)], ['long-ascii', 'w0202-long-synthetic-key-'.repeat(5)], ['long-utf8', 'é'.repeat(40)]]) {
    const result = await probe(current, { scenario: 'flow', config: { JWT_SECRET: key, JWT_ISSUER: ' w0202 issuer ', JWT_AUDIENCE: ' w0202 audience ' } });
    assert.equal(result.verified, true); assert.deepEqual(result.current, { revision: 1, K: 7 }); assert.equal(result.configPuts, 3);
    assert.deepEqual(result.afterLogin, { accounts: 1, sessions: 1, legacyKeys: 0, audit: ['account_migrated', 'sign_in'] });
    assert.deepEqual(result.results.map(step => step.status), [200, 200, 200, 200, 200, 200, 200, 401]);
    assert.deepEqual(result.results.at(-1).calls, []); assert.deepEqual(result.results.at(-1).reads, []); assert.equal(result.results.at(-1).same, true);
    controls++;
    console.log(JSON.stringify({ phase: 'current-control', label, keyBytes: new TextEncoder().encode(key).byteLength,
      statuses: result.results.map(step => step.status), configRevision: result.current.revision, configPuts: result.configPuts }));
  }
} finally { await current.dispose(); }
assert.equal(outbound, 0);
console.log(JSON.stringify({ result: 'PASS', runtime: 'workerd/Miniflare, compatibilityDate 2025-06-01', requests, denied, controls, outboundAttempts: outbound,
  limits: 'Actual selected routers, synthetic account/KV stores. Not default-export/native-resource/deployed or customer acceptance. Missing-key signing fails in workerd; no absent-key forgery claim.' }));
