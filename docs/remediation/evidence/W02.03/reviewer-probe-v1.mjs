import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Module } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
const sha = value => createHash('sha256').update(value).digest('hex');
const read = path => readFileSync(path, 'utf8');
const dir = 'docs/remediation/evidence/W02.03/';
const fixturePath = 'src/middleware/auth.claims-boundary.test.ts';
const fixture = read(fixturePath);
assert.equal(sha(fixture), '307efa307c42d2a3904fc0818ae9afaa95224bcd5c882a8a3f71486a491a77e3');
const harness = fixture.match(/const HARNESS_SOURCE = String\.raw`([\s\S]*?)`;/)[1];
const suffix = '\nexport default { async fetch(request) { try { return Response.json(await run(await request.json())); } catch(error) { return Response.json({harnessError:String(error.message)}, {status:500}); } } };';
const manifestPath = process.argv[2] || dir + 'artifact-v1.json';
const manifest = JSON.parse(read(manifestPath));
const digest = sha(JSON.stringify({contract_digest:manifest.contract_digest,configuration:manifest.configuration,files:manifest.files.map(({path,sha256,role})=>({path,sha256,role})).sort((a,b)=>a.path.localeCompare(b.path))}));
assert.equal(digest, manifest.digest);
assert.equal(manifest.files.length, 1045);
const pins = new Map(manifest.files.map(f=>[f.path,f.sha256]));
assert.equal(pins.size, manifest.files.length);
for (const f of manifest.files) assert.equal(sha(readFileSync(f.path)), f.sha256, f.path);
const baseline = JSON.parse(read(dir+'baseline.json'));
assert.equal(sha(baseline.before_source.content), baseline.before_source.sha256);
assert.equal(read(dir+'before-auth.ts.txt'), baseline.before_source.content);
const protectedBaseline = JSON.parse(read(dir+'baseline-source.json'));
const changed = protectedBaseline.files.filter(f => f.absent ? pins.has(f.path) : sha(readFileSync(f.path)) !== f.sha256).map(f=>f.path);
assert.equal(protectedBaseline.files.length,338);
assert.deepEqual(changed,['src/middleware/auth.ts']);
const frozenGraphs = JSON.parse(read(dir+'worker-runtime-inputs.json'));
const worker = JSON.parse(read(dir+'worker-checks.json'));
const stdoutGraph = JSON.parse(worker.checks.find(c=>c.kind==='K1').output.split('\n').find(l=>l.startsWith('W02.03 runtime-inputs ')).slice(22));
assert.deepEqual(Object.keys(frozenGraphs).filter(k=>!(k in stdoutGraph)).sort(), ['collected','command','started']);
for(const key of Object.keys(stdoutGraph)) assert.deepEqual(frozenGraphs[key],stdoutGraph[key]);
for(const graph of frozenGraphs.graphs) for(const index of graph.inputs) {
 const f=frozenGraphs.files[index];
 const expected=f.virtual ? sha(harness+(graph.phase.startsWith('workerd')?suffix:'')) : graph.phase.endsWith('before')&&f.path===baseline.before_source.path ? baseline.before_source.sha256 : pins.get(f.path);
 assert.equal(f.sha256,expected,graph.phase+':'+f.path);
}
assert(frozenGraphs.baselineOnly.every(g=>g.paths.length===0));
let checks=0,outbound=0,disposed=0;
const results=[],graphs=[],instances=[];
const eq=(a,b,message)=>{checks++;assert.deepEqual(a,b,message)};
const hostFetch=globalThis.fetch;
globalThis.fetch=async()=>{outbound++;throw Error('Reviewer forbids host fetch')};
async function compile(runtime){
 const source=harness+(runtime==='workerd'?suffix:'');
 const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'w0203-harness.ts',loader:'ts'},bundle:true,write:false,metafile:true,platform:runtime==='node'?'node':'browser',format:runtime==='node'?'cjs':'esm',conditions:runtime==='node'?undefined:['workerd','worker','browser'],logLevel:'silent'});
 const files=Object.keys(bundle.metafile.inputs).sort().map(path=>({path,virtual:path==='w0203-harness.ts',sha256:sha(path==='w0203-harness.ts'?source:readFileSync(path))}));
 const frozen=frozenGraphs.graphs.find(g=>g.phase===runtime+'-current').inputs.map(i=>frozenGraphs.files[i]);
 eq(files,frozen,runtime+' actual graph'); graphs.push({runtime,files});
 if(runtime==='node'){const filename=resolve('w0203-reviewer-memory.cjs');const mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(process.cwd());mod._compile(bundle.outputFiles[0].text,filename);return mod.exports.run;}
 const mf=new Miniflare({modules:[{type:'ESModule',path:'reviewer.mjs',contents:bundle.outputFiles[0].text}],compatibilityDate:'2025-06-01',outboundService(){outbound++;throw Error('Reviewer forbids outbound')}});
 instances.push(mf);return async input=>{const response=await mf.dispatchFetch('https://reviewer.example.invalid',{method:'POST',body:JSON.stringify(input)});const data=await response.json();eq(response.status,200,data.harnessError);return data};
}
const normal={sub:'fixture-account',roles:['admin'],permissions:['read','write']};
const ops=[{path:'/auth/me'},{path:'/auth/me',method:'HEAD'},{path:'/auth/users'},
 {path:'/config/reflex?scope=w0203-focused',method:'PATCH',body:'{malformed'},
 {path:'/optional'},{path:'/operator/probe',method:'POST'},{path:'/v1/acme/probe'}];
const invalid=[['Unicode whitespace',{...normal,sub:'\u00a0\u2003\ufeff'}],['line separators',{...normal,sub:'\u2028\u2029'}],
 ...['roles','permissions'].flatMap(claim=>[false,null,{0:'admin',length:1},['admin',false],['admin',[]],['admin',{}]].map((value,i)=>[claim+' shape '+i,{...normal,[claim]:value}]))];
try { for(const runtime of ['node','workerd']) {
 const run=await compile(runtime);
 for(const [label,payload] of invalid){const r=await run({payload,ops});eq(r.setup,[200,200,200]);eq(r.results.length,ops.length);
  for(const o of r.results){eq(o.status,401,label);if(o.method!=='HEAD')eq(o.error,'Invalid token');eq(o.calls,[]);eq(o.bindingReads,[]);eq(o.bodyReads,0);eq(o.auth,null);eq(o.stateUnchanged,true)}
  eq(r.stateUnchanged,true);eq(r.config.revision,1);eq(r.config.K,3);eq(r.accountCount,1);eq(r.sessionCount,1);
  results.push({runtime,label,denials:r.results.length,protectedCalls:r.calls,bindingReads:r.bindingReads,bodyReads:r.bodyReads,stateUnchanged:r.stateUnchanged});
 }
 for(const payload of [{sub:'\u200b'}, {sub:'  Ω-reviewer\u00a0',roles:['','ADMIN','admin ','unknown'],permissions:['','*','unknown']}]){
  const r=await run({payload,policy:{},ops:[{path:'/optional'},{path:'/policy'},{path:'/config/reflex?scope=w0203-focused',method:'PATCH',body:{patch:{K:13}}}]});
  eq(r.results.map(o=>o.status),[200,200,200]);for(const o of r.results){eq(o.auth.user.sub,payload.sub);eq(o.auth.user.roles,payload.roles);eq(o.auth.user.permissions,payload.permissions)}
  eq(r.config.actor,payload.sub);eq(r.config.K,13);eq(r.config.revision,2);results.push({runtime,label:'exact valid values',payload,statuses:r.results.map(o=>o.status),config:r.config});
 }
 for(const [label,policy,permissions,roles,status] of [
  ['star literal',{permissions:['write']},['*'],['admin'],403],
  ['case and padding literal',{roles:['admin']},[],['ADMIN','admin '],403],
  ['empty unknown literals',{roles:['unknown'],permissions:['','*']},['','*'],['unknown'],200]]) {
  const r=await run({payload:{...normal,permissions,roles},policy,ops:[{path:'/policy'}]});eq(r.results[0].status,status);eq(r.bindingReads,[]);eq(r.bodyReads,0);
  results.push({runtime,label,status:r.results[0].status});
 }
 const sdk=await run({prepare:false,payload:{sub:null,roles:'not-admin'},env:{JWT_SECRET:'bad'},throwBindings:true,ops:[
  {path:'/v1/acme/probe',headers:{'X-SDK-Key':'synthetic-sdk'}},{path:'/v1/acme/probe',headers:{'X-SDK-Key':'wrong'}},
  {path:'/optional'},{path:'/policy'},{path:'/optional',credential:'none'},{path:'/policy',credential:'none'}]});
 eq(sdk.results.map(o=>o.status),[200,401,503,503,200,401]);eq(sdk.bindingReads,[]);eq(sdk.bodyReads,0);eq(sdk.results[0].auth,null);
 results.push({runtime,label:'SDK config optional priority',statuses:sdk.results.map(o=>o.status),bindingReads:sdk.bindingReads});
 const expired=await run({payload:{sub:null,roles:false},sign:{expired:true},ops:[{path:'/policy'}]});eq(expired.results[0].status,401);eq(expired.results[0].error,'Token expired');eq(expired.calls,[]);eq(expired.bindingReads,[]);
 results.push({runtime,label:'expiry before shape',error:expired.results[0].error});
} } finally { for(const mf of instances){await mf.dispose();disposed++;}globalThis.fetch=hostFetch; }
eq(outbound,0);eq(disposed,1);
console.log(JSON.stringify({completed:new Date().toISOString(),manifestPath,artifactDigest:digest,manifestFileSha256:sha(read(manifestPath)),protectedCount:protectedBaseline.files.length,protectedChanges:changed,verifiedPins:pins.size,workerGraphPayloadEqual:true,fourPhaseGraphVerified:true,baselineOnly:frozenGraphs.baselineOnly,assertions:checks,observations:results,graphs,outbound,disposed,limitations:'Independent additional cases/assertions reuse the fully source-reviewed frozen real-module harness; selected workerd compatibilityDate2025-06-01 only, no nodejs_compat; synthetic stores, not native resource or deployment acceptance.'}));

