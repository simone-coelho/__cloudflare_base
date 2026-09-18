import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdtemp, chmod, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { gzipSync } from 'node:zlib';
import { verifySDK, sdkBuildOptions, SDK_TARGETS } from './build-sdk.mjs';
import { verifyMeridian, meridianBuildOptions } from './build-meridian.mjs';
import { canonical, sha256, MIGRATIONS, ASSETS, SECURITY_TABLES, SECURITY_ROOTS, validateDesired, validateTransition,
  packageArtifact, validateArtifact, readPinnedArtifact, verifyCommentOnlyAssetRevision, LOCAL_CHECK_COMMANDS, provider, protectedOperation, effect, doMigrationPlan, runStampWorkflow,
  d1Queries, migrateProduct, captureSecurity, securityRestoreSQL, securityRestoration } from './stamp-workflow.mjs';

// Every cloud request passes through the actual bounded serializer to this local
// boundary. No CLI, credentials, customer data or network is used by these tests.
const ACCOUNT='a'.repeat(32), OP='11111111-1111-4111-8111-111111111111';
const OWNER='ops-22222222-2222-4222-8222-222222222222', DBID='33333333-3333-4333-8333-333333333333';
const MATERIAL='9qL8wEfR73mCu5xY02hJ6zN4bAvT1sKd', NOW=1800000000000;
const hash=v=>sha256(canonical(v)), clone=structuredClone;
function memoryStore(){const values=new Map();return{values,async read(k){return clone(values.get(k)??null)},async write(k,v){assert.ok(!values.has(k),'immutable receipt');values.set(k,clone(v));}};}
function desired(fresh=false){
  const script='acme-staging',policy={id:'approved-fixture',revision:1,durationMs:123456,basis:'admitted',renewal:'new-record-only'};
  const d={version:1,customer:'acme',account:ACCOUNT,environment:'staging',script,ownership:'a'.repeat(64),
    resources:{cache:{name:script+'-cache',id:fresh?null:'1'.repeat(32)},sessions:{name:script+'-sessions',id:fresh?null:'2'.repeat(32)},
      database:{name:script+'-database',id:fresh?null:DBID},storage:{name:script+'-storage',id:script+'-storage'},
      queue:{name:script+'-queue',id:fresh?null:'4'.repeat(32)},deadLetter:{name:script+'-deadletter',id:fresh?null:'5'.repeat(32)},analytics:'acme_staging_ops_v1'},
    tenants:{provisioned:['brand-a'],hosts:{'a.example.test':'brand-a'}},origins:['https://a.example.test'],owners:[OWNER],
    vars:{JWT_ISSUER:script,JWT_AUDIENCE:'customer-api',REFLEX_HOST:'session',RETENTION:JSON.stringify({version:1,tenants:{'brand-a':Object.fromEntries(['profile','identity','ledger','online','hourly'].map(k=>[k,clone(policy)]))}})},
    secrets:{JWT_SECRET:MATERIAL,SDK_KEYS:'brand-a:'+MATERIAL,IDENTITY_SALT:MATERIAL,IDENTITY_SECRETS:'brand-a:'+MATERIAL,ALERT_WEBHOOK_URL:'https://alerts.example.test/private-fixture'},
    routes:[{zone:'b'.repeat(32),pattern:'a.example.test/*'}]};return telemetry(d);
}
function telemetry(d){const policies=JSON.parse(d.vars.RETENTION),tenants={};for(const tenant of d.tenants.provisioned){
  const t={environment:d.environment,schema:'ops-v1',analytics:{binding:'ANALYTICS',dataset:d.resources.analytics,accessPolicy:'approved-analytics'},
    monitor:{binding:'CACHE',namespace:'monitor',accessPolicy:'approved-monitor'},alert:{binding:'ALERT_WEBHOOK_URL',destination:'approved-alert',urlSha256:sha256(d.secrets.ALERT_WEBHOOK_URL),accessPolicy:'approved-alert'}};
  tenants[tenant]={telemetry:t};for(const kind of ['analytics','monitor','alert'])policies.tenants[tenant]['telemetry.'+kind+'.'+hash({tenant,environment:d.environment,schema:'ops-v1',...t[kind]})]=clone(policies.tenants[tenant].profile);
}d.vars.TENANT_CONNECTORS=JSON.stringify({version:1,tenants});d.vars.RETENTION=JSON.stringify(policies);return d;}
function authorized(mode,d,extra={}){return{desired:d,authorization:{operation:OP,mode,account:d.account,script:d.script,evidence:'b'.repeat(64),expiresAt:NOW+3600000},...extra};}
test('W12.02 synthetic physical destinations require their own exact policies',()=>{
  const d=desired(),c=JSON.parse(d.vars.TENANT_CONNECTORS),p=JSON.parse(d.vars.RETENTION),t=c.tenants['brand-a'].telemetry;
  t.synthetic={version:1,enabled:true,lifetimeMs:60000,stageMs:5000,decisionMs:200,eventMs:300,thresholdSource:'document-32-server-diagnostics',
    destinations:['CACHE','SESSIONS','STORAGE','EVENT_QUEUE','SHOPPER_REFLEX','DECISION_RING','LEARN_STATS','REGION_TREND','PERSONALIZATION_WEBSOCKET'].map(binding=>({binding,purpose:'isolated-synthetic-monitor',namespace:'ops-synthetic-v1',accessPolicy:'fixture-only'}))};
  d.vars.TENANT_CONNECTORS=JSON.stringify(c);assert.throws(()=>validateDesired(d));
  for(const destination of t.synthetic.destinations)p.tenants['brand-a']['telemetry.monitor.'+hash({tenant:'brand-a',environment:d.environment,schema:'ops-v1',...destination})]=clone(p.tenants['brand-a'].profile);
  d.vars.RETENTION=JSON.stringify(p);assert.deepEqual(validateDesired(d),d);
  for(const mutate of [s=>s.destinations.pop(),s=>s.destinations[0].namespace='monitor',s=>s.destinations[0].accessPolicy='changed',s=>s.decisionMs=1500,s=>s.eventMs=301,s=>s.lifetimeMs=300001]){
    const bad=clone(d),next=JSON.parse(bad.vars.TENANT_CONNECTORS);mutate(next.tenants['brand-a'].telemetry.synthetic);bad.vars.TENANT_CONNECTORS=JSON.stringify(next);assert.throws(()=>validateDesired(bad));
  }
});
const bootstrap={owner:{id:OWNER,email:'owner@example.test',name:'Initial Owner'},password:'Different-Temporary9'};
const part=(name,value,type='application/javascript')=>{const b=Buffer.from(value);return{name,type,bytes:b.length,sha256:sha256(b),base64:b.toString('base64')}};
// All selected transport/recovery cases reuse this ONE actual checked package.
// No fabricated verification receipts and no second Worker compilation.
let actualPackage;
async function fixtureArtifact(){return clone(await (actualPackage??=process.env.STAMP_TEST_ARTIFACT_PATH
  ? readPinnedArtifact(process.env.STAMP_TEST_ARTIFACT_PATH,{digest:process.env.STAMP_TEST_ARTIFACT_DIGEST,
    sha256:process.env.STAMP_TEST_ARTIFACT_SHA256,bytes:Number(process.env.STAMP_TEST_ARTIFACT_BYTES)}) : packageArtifact()));}
test('W13 nonwriting shared options reject mismatched generated bytes without replacing assets',async()=>{
  const paths=[...SDK_TARGETS.map(t=>t.output),'public/meridian/engine.bundle.js'];
  const before=await Promise.all(paths.map(p=>readFile(new URL('../'+p,import.meta.url))));
  const seen=[],wrong=async options=>{seen.push(options);return {outputFiles:[{contents:Buffer.from('wrong generated bytes')}],metafile:{inputs:{},outputs:{}}}};
  await assert.rejects(verifySDK({build:wrong}),/Generated asset mismatch/);
  await assert.rejects(verifyMeridian({build:wrong}),/Generated asset mismatch/);
  assert.ok(seen.every(options=>options.write===false&&options.sourcemap===false&&options.minify===false));
  assert.deepEqual(seen[0],{...(await sdkBuildOptions())[0],plugins:[]});
  assert.deepEqual(seen.at(-1),{...meridianBuildOptions(),plugins:[]});
  for(const [i,path]of paths.entries())assert.deepEqual(await readFile(new URL('../'+path,import.meta.url)),before[i]);
});
function fixture({fresh=false,failRequest}={}){
  const d=desired(),db=new DatabaseSync(':memory:'),resources=new Map(),calls=[],versionRows=[],routeRows=[];
  let count=0,settings={observability:{enabled:false,head_sampling_rate:0,logs:{enabled:false,invocation_logs:false}}},deploymentRows=[],cronRows=[];
  const pathFor=k=>k==='cache'||k==='sessions'?'/storage/kv/namespaces':k==='database'?'/d1/database':k==='storage'?'/r2/buckets':'/queues';
  const rowFor=(k,v)=>k==='cache'||k==='sessions'?{id:v.id,title:v.name}:k==='database'?{uuid:v.id,name:v.name}:k==='storage'?{name:v.name}:
    {queue_id:v.id,queue_name:v.name,settings:{delivery_paused:false,message_retention_period:86400},consumers:[]};
  if(!fresh)for(const k of ['cache','sessions','database','storage','queue','deadLetter'])resources.set(pathFor(k)+'/'+d.resources[k].id,rowFor(k,d.resources[k]));
  const success=result=>new Response(JSON.stringify({success:true,result}),{headers:{'Content-Type':'application/json'}});
  const executeSQL=(sql,params=[])=>{
    if(/^SELECT/.test(sql))return sql.split(';').filter(Boolean).map(s=>({success:true,results:db.prepare(s).all(...params)}));
    db.exec('BEGIN');try{let rows=[];if(/RETURNING id\s*$/.test(sql))rows=db.prepare(sql).all(...params);else if(params.length)db.prepare(sql).run(...params);else db.exec(sql);db.exec('COMMIT');return[{success:true,results:rows}];}
    catch(e){db.exec('ROLLBACK');throw e;}
  };
  const fetch=async(url,init)=>{
    const u=new URL(url),path=u.pathname.replace('/client/v4',''),method=init.method;
    const body=init.body instanceof FormData?init.body:init.body?JSON.parse(init.body):undefined;
    assert.equal(u.origin,'https://api.cloudflare.com');assert.equal(init.redirect,'error');
    calls.push({path,method,body});if(failRequest?.({path,method,body,calls,resources}))throw Error('private-provider-canary');
    if(path==='/accounts/'+ACCOUNT)return success({id:ACCOUNT});
    if(path===`/zones/${'b'.repeat(32)}`)return success(f.zone);
    if(path===`/zones/${'b'.repeat(32)}/workers/routes`){if(method==='POST')routeRows.push({id:'route-id',...body});return success(clone(routeRows));}
    const p=path.replace('/accounts/'+ACCOUNT,'');
    if(p.endsWith('/query'))return success(executeSQL(body.sql,body.params));
    if(p.endsWith('/time_travel/restore')){
      assert.ok(f.bookmarkSQL,'actual historical fixture required');db.exec('BEGIN');try{db.exec(f.bookmarkSQL);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
      return success({previous_bookmark:'00000000-00000000-00000002'});
    }
    if(p.endsWith('/time_travel/bookmark'))return success({bookmark:'00000000-00000000-00000002'});
    if(p==='/workers/scripts')return success(versionRows.length?[{id:d.script,migration_tag:'v7'}]:[]);
    if(p==='/workers/assets/upload'){assert.ok(body instanceof FormData);return success({jwt:'completed-assets-fixture'});}
    if(p.startsWith('/workers/scripts/')){
      const suffix=p.slice(('/workers/scripts/'+d.script).length);
      if(suffix==='/assets-upload-session')return success({jwt:'asset-session-fixture',buckets:[Object.values(body.manifest).map(x=>x.hash)]});
      if(suffix==='/versions'){
        if(method==='POST'){
          const metadata=JSON.parse(body.get('metadata')),id=`99999999-9999-4999-8999-${String(++count).padStart(12,'0')}`;
          const modules=new Map([...body].filter(([k])=>k!=='metadata'));
          versionRows.unshift({id,metadata,modules});return success({id});
        }return success({items:versionRows.map(x=>({id:x.id,annotations:x.metadata.annotations}))});
      }
      if(suffix.startsWith('/versions/')){const row=versionRows.find(x=>suffix.endsWith(x.id));assert.ok(row);return success({id:row.id,resources:{bindings:row.metadata.bindings.map(x=>x.type==='secret_text'?{name:x.name,type:x.type}:x),script_runtime:{compatibility_date:row.metadata.compatibility_date,compatibility_flags:row.metadata.compatibility_flags}}});}
      if(suffix==='/content/v2'){const row=versionRows.find(x=>x.id===u.searchParams.get('version')),form=new FormData();assert.ok(row);for(const[k,v]of row.modules)form.set(k,v,k);const response=new Response(form);response.headers.set('cf-entrypoint',row.metadata.main_module);return response;}
      if(suffix==='/script-settings'){if(method==='PATCH')settings={...settings,...body};return success(clone(settings));}
      if(suffix==='/deployments'){if(method==='POST')deploymentRows.unshift({id:'deployment-'+count,versions:body.versions});return success({deployments:clone(deploymentRows)});}
      if(suffix==='/schedules'){if(method==='PUT')cronRows=clone(body);return success(clone(cronRows));}
    }
    if(p.includes('/consumers')){
      const key=p.split('/consumers')[0],queue=resources.get(key);assert.ok(queue);
      const row={consumer_id:'consumer-id',type:body.type,script:body.script_name,dead_letter_queue:body.dead_letter_queue,settings:body.settings};
      queue.consumers=[row];return success(row);
    }
    if(method==='GET'&&resources.has(p))return success(clone(resources.get(p)));
    if(method==='PATCH'&&resources.has(p)){resources.get(p).settings=body.settings;return success(clone(resources.get(p)));}
    if(['/storage/kv/namespaces','/d1/database','/r2/buckets','/queues'].includes(p)){
      if(method==='POST'){
        const kind=Object.keys(d.resources).find(k=>objectName(d.resources[k])===(body.title??body.name??body.queue_name));assert.ok(kind);
        const row=rowFor(kind,d.resources[kind]);resources.set(p+'/'+d.resources[kind].id,row);return success(row);
      }
      const rows=[...resources].filter(([k])=>k.startsWith(p+'/')).map(([,v])=>v);return success(p==='/r2/buckets'?{buckets:rows}:rows);
    }
    return new Response('{}',{status:404});
  };
  const f={db,resources,calls,versionRows,routeRows,settings,setDeployments:rows=>{deploymentRows=clone(rows)},zone:{id:'b'.repeat(32),account:{id:ACCOUNT},name:'example.test'},executeSQL,fetch,api:provider('z'.repeat(32),{fetch}),close:()=>db.close(),bookmarkSQL:null};return f;
}
const objectName=v=>typeof v==='object'?v.name:null;
async function createFixture(options={}){const f=fixture({fresh:true,...options}),store=memoryStore(),artifact=options.artifact??await fixtureArtifact();
  const result=await runStampWorkflow('create',authorized('create',options.desired??desired(true),{bootstrap}),{api:f.api,store,artifact,operation:OP,execute:true,now:()=>NOW});return{f,store,artifact,result};}

const maintenanceProof=d=>({operation:OP,account:ACCOUNT,script:d.script,database:DBID,evidence:'c'.repeat(64),issuedAt:NOW-100,expiresAt:NOW+600000,
  covers:['active-and-old-versions','http-inflight','durable-object-work','websockets','scheduled-work','queue-inflight','external-d1-writers'],queueEmpty:true,producersStopped:true,resume:true});
const rehash=a=>{delete a.digest;a.digest=hash(a);return a};
const invoke=(f,artifact,mode,d,extra)=>runStampWorkflow(mode,authorized(mode,d,extra),{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW});

function recoveryDesired(fresh=false){const d=desired(fresh),p=JSON.parse(d.vars.RETENTION);for(const policies of Object.values(p.tenants))for(const category of ['recovery','quarantine'])policies[category]=clone(policies.ledger);
  d.vars.RETENTION=JSON.stringify(p);d.vars.LEDGER_RECOVERY_ENABLED='true';d.vars.LEDGER_RECOVERY_CONFIG=JSON.stringify({version:1,sourceQueue:d.resources.queue.name,deadLetterQueue:d.resources.deadLetter.name,
    unknown:{id:'explicit-synthetic-unknown-policy',revision:1,durationMs:123456,basis:'admitted',renewal:'new-record-only',disposal:'delete-on-expiry'}});return d;}
const bothQueueMaintenance=d=>({...maintenanceProof(d),queues:Object.fromEntries(['queue','deadLetter'].map(kind=>[d.resources[kind].id,{empty:true,producersStopped:true}]))});

test('W09.09 explicit recovery config preserves default off and validates all three consumer environments and rollback roots',async()=>{
  const d=recoveryDesired();assert.deepEqual(validateDesired(d),d);
  for(const mutate of [x=>x.vars.LEDGER_RECOVERY_ENABLED=true,x=>x.vars.LEDGER_RECOVERY_ENABLED='TRUE',x=>{const c=JSON.parse(x.vars.LEDGER_RECOVERY_CONFIG);delete c.unknown;x.vars.LEDGER_RECOVERY_CONFIG=JSON.stringify(c)},
    x=>{const c=JSON.parse(x.vars.LEDGER_RECOVERY_CONFIG);c.deadLetterQueue=c.sourceQueue;x.vars.LEDGER_RECOVERY_CONFIG=JSON.stringify(c)},
    x=>{const p=JSON.parse(x.vars.RETENTION);delete p.tenants['brand-a'].quarantine;x.vars.RETENTION=JSON.stringify(p)}]){const bad=clone(d);mutate(bad);assert.throws(()=>validateDesired(bad));}
  const off=clone(d);off.vars.LEDGER_RECOVERY_ENABLED='false';const config=JSON.parse(off.vars.LEDGER_RECOVERY_CONFIG);delete config.unknown;off.vars.LEDGER_RECOVERY_CONFIG=JSON.stringify(config);validateDesired(off);
  assert.throws(()=>validateTransition('upload',d,desired()));assert.throws(()=>validateTransition('rotate',{...d,secrets:{...d.secrets,JWT_SECRET:d.secrets.JWT_SECRET+'9'}},desired(),['JWT_SECRET']));
  const manifest=parseToml(await readFile(new URL('../wrangler.toml',import.meta.url),'utf8'));
  for(const target of [manifest,manifest.env.staging,manifest.env.production]){
    assert.equal(target.vars.LEDGER_RECOVERY_ENABLED,'false');assert.equal(target.queues.consumers.length,2);
    const source=target.queues.consumers.find(q=>q.dead_letter_queue);assert.ok(source);assert.ok(target.queues.consumers.some(q=>q.queue===source.dead_letter_queue&&!q.dead_letter_queue));
    assert.equal(JSON.parse(target.vars.LEDGER_RECOVERY_CONFIG).unknown,undefined);
  }
  for(const path of ['src/ledger/recovery.ts','src/ledger/quarantine.ts','src/routes/ledgerRecovery.ts'])assert.ok(SECURITY_ROOTS.includes(path));
});

test('W09.09 rework intake activation requires explicit policies independently of producer opt-in',async()=>{
  const failures=[];
  for(const missing of ['unknown','quarantine','recovery','none']){
    const d=recoveryDesired(true);d.vars.LEDGER_RECOVERY_ENABLED='false';
    if(missing==='unknown'){const c=JSON.parse(d.vars.LEDGER_RECOVERY_CONFIG);delete c.unknown;d.vars.LEDGER_RECOVERY_CONFIG=JSON.stringify(c);}
    if(['quarantine','recovery'].includes(missing)){const p=JSON.parse(d.vars.RETENTION);delete p.tenants['brand-a'][missing];d.vars.RETENTION=JSON.stringify(p);}
    const {f,artifact,result}=await createFixture({desired:d});
    try{
      const before=f.calls.length;
      if(missing==='none'){
        const active=await invoke(f,artifact,'promote',result.desired,{candidate:result});assert.equal(active.status,'promoted');
        assert.equal(f.resources.get('/queues/'+'5'.repeat(32)).consumers.length,1);assert.equal(active.desired.vars.LEDGER_RECOVERY_ENABLED,'false');
      }else{
        let refused=false;try{await invoke(f,artifact,'promote',result.desired,{candidate:result});}catch{refused=true;}
        if(!refused||f.calls.slice(before).some(x=>x.method!=='GET'))failures.push(missing);
      }
    }finally{f.close();}
  }
  assert.deepEqual(failures,[],'policy-unset activation must refuse before traffic, consumers or other mutations');
});

test('W09.09 both queues use real protected receipt keys and retain pause states through fresh authorized restore continuation',async()=>{
  for(const scenario of ['resume','hold-then-resume','missing-drain','dlq-resume-failure']){
    let fail=false;const {f,artifact,result:uploaded}=await createFixture({desired:recoveryDesired(true),failRequest:({path,method,body})=>fail&&method==='PATCH'&&path.endsWith('/queues/'+'5'.repeat(32))&&body.settings.delivery_paused===false});
    const directory=await mkdtemp(resolve(tmpdir(),'w0909-protected-'));await chmod(directory,0o700);let operationStore;
    try{
      operationStore=await protectedOperation(directory,OP);
      const active=await runStampWorkflow('promote',authorized('promote',uploaded.desired,{candidate:uploaded}),{api:f.api,store:operationStore,artifact,operation:OP,execute:true,now:()=>NOW});await operationStore.close();operationStore=null;
      for(const kind of ['queue','deadLetter'])assert.equal(f.resources.get('/queues/'+active.desired.resources[kind].id).consumers.length,1);
      const source=f.resources.get('/queues/'+'4'.repeat(32)),dlq=f.resources.get('/queues/'+'5'.repeat(32));source.settings.delivery_paused=true;
      f.bookmarkSQL=await securityRestoreSQL(await captureSecurity(d1Queries(f.api,ACCOUNT,DBID,memoryStore()),artifact),artifact);
      const op='66666666-6666-4666-8666-666666666666',maintenance={...bothQueueMaintenance(active.desired),operation:op,resume:scenario!=='hold-then-resume'};
      if(scenario==='missing-drain')delete maintenance.queues['5'.repeat(32)];
      const input=authorized('restore',active.desired,{previous:active,candidate:active,restore:{bookmark:'00000000-00000000-00000001'},maintenance});input.authorization.operation=op;
      operationStore=await protectedOperation(directory,op);const before=f.calls.length;fail=scenario==='dlq-resume-failure';
      const pending=runStampWorkflow('restore',input,{api:f.api,store:operationStore,artifact,operation:op,execute:true,now:()=>NOW});
      if(scenario==='missing-drain'){await assert.rejects(pending);assert.equal(f.calls.slice(before).filter(x=>x.method!=='GET').length,0);continue;}
      if(fail){await assert.rejects(pending);assert.notEqual(f.calls.filter(x=>x.method==='POST'&&x.path.endsWith('/deployments')).at(-1).body.versions[0].version_id,active.version);continue;}
      let result=await pending;assert.equal(source.settings.delivery_paused,true);assert.equal(source.settings.message_retention_period,86400);
      if(scenario==='hold-then-resume'){
        assert.equal(result.status,'restored-quarantined');assert.equal(dlq.settings.delivery_paused,true);await operationStore.close();operationStore=null;
        const next='77777777-7777-4777-8777-777777777777',resume=authorized('restore',active.desired,{previous:result,candidate:active,restore:{resume:true},maintenance:{...bothQueueMaintenance(active.desired),operation:next,issuedAt:NOW}});resume.authorization.operation=next;
        const count=f.calls.filter(x=>x.path.endsWith('/time_travel/restore')).length;operationStore=await protectedOperation(directory,next);
        result=await runStampWorkflow('restore',resume,{api:f.api,store:operationStore,artifact,operation:next,execute:true,now:()=>NOW});
        assert.equal(f.calls.filter(x=>x.path.endsWith('/time_travel/restore')).length,count);
      }
      assert.equal(result.status,'restored-and-resumed');assert.equal(source.settings.delivery_paused,true);assert.equal(dlq.settings.delivery_paused,false);assert.equal(dlq.settings.message_retention_period,86400);
    }finally{if(operationStore)await operationStore.close();f.close();await rm(directory,{recursive:true,force:true});}
  }
});

test('W08.05 recovery provenance distinguishes current material, uploaded code and admitted active resume',async()=>{
  const failures=[];let pendingPackage;
  for(const scenario of ['returned-receipt','unpromoted-resume','active-with-pending-upload','completed-quarantine','resume-schedule-drift','resume-unpause-drift','missing-active','split-active','unknown-active','missing-candidate','rotated-active']){
    let injectResume=()=>false;const {f,artifact,result}=await createFixture({failRequest:request=>injectResume(request)});try{
      let active=result;
      if(scenario!=='missing-active')active=await invoke(f,artifact,'promote',result.desired,{candidate:result});
      let previous=active,candidate=active,selected=artifact;
      if(['unpromoted-resume','active-with-pending-upload','rotated-active'].includes(scenario)){
        const asset=artifact.assets.find(p=>p.name==='/console/views.js');
        const newer=await (pendingPackage??=verifyCommentOnlyAssetRevision(artifact,
          [part(asset.name,Buffer.from(asset.base64,'base64').toString()+'\n// checked pending asset revision\n',asset.type)]));
        assert.deepEqual(newer.modules,artifact.modules,'pending version reuses the once-built Worker');
        const d=clone(active.desired);if(scenario==='rotated-active')d.secrets.JWT_SECRET+='9';
        previous=await invoke(f,newer,scenario==='rotated-active'?'rotate':'upload',d,{previous:active,...(scenario==='rotated-active'?{rotation:['JWT_SECRET']}:{})});
        if(scenario==='unpromoted-resume'){candidate=previous;selected=newer;}
      }
      if(['split-active','unknown-active'].includes(scenario)){
        const rows=[{id:'fixture-active',versions:scenario==='split-active'?[{version_id:active.version,percentage:50},{version_id:'88888888-8888-4888-8888-888888888888',percentage:50}]:[{version_id:'88888888-8888-4888-8888-888888888888',percentage:100}]}];
        f.setDeployments(rows);previous=clone(previous);previous.sourceState.deployments={deployments:rows};
      }
      f.bookmarkSQL=await securityRestoreSQL(await captureSecurity(d1Queries(f.api,ACCOUNT,DBID,memoryStore()),artifact),artifact);
      const before=f.calls.length,extra={previous,...(scenario==='missing-candidate'?{}:{candidate}),restore:{bookmark:'00000000-00000000-00000001'},maintenance:maintenanceProof(previous.desired)};
      if(scenario.startsWith('resume-')){
        let driftAt=null;
        injectResume=({path,method,body})=>{
          if(driftAt===null&&(scenario==='resume-schedule-drift'&&method==='PUT'&&path.endsWith('/schedules')&&body.length
            ||scenario==='resume-unpause-drift'&&method==='PATCH'&&path.includes('/queues/')&&body.settings.delivery_paused===false)){
            const row=f.versionRows.find(x=>x.id===active.version),id='88888888-8888-4888-8888-888888888888',metadata=clone(row.metadata);
            metadata.bindings.find(x=>x.name==='JWT_SECRET').text+='concurrent-rotation';
            f.versionRows.unshift({id,metadata,modules:new Map(row.modules)});f.setDeployments([{id:'concurrent-deployment',versions:[{version_id:id,percentage:100}]}]);driftAt=f.calls.length;
          }return false;
        };
        await assert.rejects(invoke(f,selected,'restore',previous.desired,extra));assert.notEqual(driftAt,null);
        assert.equal(f.calls.slice(driftAt).filter(x=>x.method==='POST'&&x.path.endsWith('/deployments')).length,0,'visible concurrent material/activation is never overwritten');
      }else if(scenario==='completed-quarantine'){
        const held=await invoke(f,selected,'restore',previous.desired,{...extra,maintenance:{...extra.maintenance,resume:false}});
        assert.equal(held.status,'restored-quarantined');
        const nextOperation='66666666-6666-4666-8666-666666666666';
        const resume=authorized('restore',previous.desired,{previous:held,candidate:active,restore:{resume:true},maintenance:{...extra.maintenance,operation:nextOperation,issuedAt:NOW}});
        resume.authorization.operation=nextOperation;
        const run=input=>runStampWorkflow('restore',input,{api:f.api,store:memoryStore(),artifact,operation:nextOperation,execute:true,now:()=>NOW});
        for(const alter of [x=>delete x.maintenance,x=>x.maintenance.expiresAt=NOW,x=>x.maintenance.resume=false,x=>x.candidate=held]){
          const bad=clone(resume);alter(bad);const count=f.calls.length;await assert.rejects(run(bad));
          assert.equal(f.calls.slice(count).filter(x=>x.method!=='GET').length,0);
        }
        const beforeResume=f.calls.length,out=await run(resume);
        assert.equal(out.status,'restored-and-resumed');assert.equal(out.version,active.version);
        assert.equal(f.calls.slice(beforeResume).filter(x=>x.path.includes('/time_travel/restore')||x.path.endsWith('/query')&&!/^SELECT/.test(x.body.sql)).length,0,'continuation never repeats restore or security writes');
        assert.equal(f.calls.filter(x=>x.method!=='GET'&&!x.path.endsWith('/query')).at(-1).path.endsWith('/deployments'),true);
        const count=f.calls.length;await assert.rejects(run(resume));assert.equal(f.calls.slice(count).filter(x=>x.method!=='GET').length,0,'old quarantine receipt is stale after resume');
        assert.equal((await invoke(f,artifact,'reconcile',out.desired,{previous:out})).status,'unchanged');
      }else if(['returned-receipt','active-with-pending-upload'].includes(scenario)){
        const out=await invoke(f,selected,'restore',previous.desired,extra);assert.equal(out.version,active.version);
        assert.equal(f.calls.filter(x=>x.method==='POST'&&x.path.endsWith('/deployments')).at(-1).body.versions[0].version_id,active.version);
        const reconciled=await invoke(f,artifact,'reconcile',out.desired,{previous:out});assert.equal(reconciled.status,'unchanged');
        const repeated=await invoke(f,artifact,'restore',reconciled.desired,{previous:reconciled,candidate:out,restore:extra.restore,maintenance:extra.maintenance});
        const uploaded=await invoke(f,artifact,'upload',repeated.desired,{previous:repeated});
        const rotated=clone(uploaded.desired);rotated.secrets.JWT_SECRET+='8';
        await invoke(f,artifact,'rotate',rotated,{previous:uploaded,rotation:['JWT_SECRET']});
        const count=f.calls.length;await assert.rejects(invoke(f,artifact,'rollback',uploaded.desired,{previous:uploaded}));
        assert.equal(f.calls.slice(count).filter(x=>x.method!=='GET').length,0);
      }else{
        await assert.rejects(invoke(f,selected,'restore',previous.desired,extra));
        assert.equal(f.calls.slice(before).filter(x=>x.method!=='GET').length,0,'unsupported topology/material refuses before effects');
      }
    }catch(e){failures.push({scenario,error:e.message});}finally{f.close();}
  }
  assert.deepEqual(failures,[]);
});

test('W08.05 resource ownership race never adopts an unreceipted concurrently appeared R2 bucket',async()=>{
  const failures=[];
  for(const scenario of ['second-read','wrong-intent','pending-intent','wrong-result']){
    let reads=0;const f=fixture({fresh:true,failRequest:({path,method,resources})=>{
      if(scenario==='second-read'&&method==='GET'&&path.endsWith('/r2/buckets/acme-staging-storage')&&++reads===2)resources.set('/r2/buckets/acme-staging-storage',{name:'acme-staging-storage'});return false;
    }}),store=memoryStore(),artifact=await fixtureArtifact();
    try{
      if(scenario!=='second-read'){
        f.resources.set('/r2/buckets/acme-staging-storage',{name:'acme-staging-storage'});
        const intent={account:scenario==='wrong-intent'?'c'.repeat(32):ACCOUNT,kind:'storage',name:'acme-staging-storage'};
        store.values.set('resource-storage.intent',{intent,commitment:hash(intent)});
        if(scenario!=='pending-intent')store.values.set('resource-storage.done',{result:{name:scenario==='wrong-result'?'other-bucket':'acme-staging-storage'}});
      }
      await assert.rejects(runStampWorkflow('create',authorized('create',desired(true),{bootstrap}),{api:f.api,store,artifact,operation:OP,execute:true,now:()=>NOW}));
      assert.equal(f.calls.filter(x=>x.method==='POST'&&(x.path.endsWith('/r2/buckets')||x.path.endsWith('/versions'))).length,0);
    }catch(e){failures.push({scenario,error:e.message});}finally{f.close();}
  }
  assert.deepEqual(failures,[]);
});

test('W08.05 rollback enforcement closure rejects an older artifact changing only bound DecisionRing protection',async()=>{
  const artifact=await fixtureArtifact(),path='src/durable-objects/DecisionRing.ts';
  if(!artifact.sourcePins.some(x=>x.path===path))artifact.sourcePins.push({path,sha256:'b'.repeat(64),bytes:1,imports:[]});rehash(artifact);
  const {f,result}=await createFixture({artifact});try{
    const unsafe=clone(artifact);unsafe.sourcePins.find(x=>x.path===path).sha256='c'.repeat(64);
    const barrier=unsafe.barriers.find(x=>x.path===path);if(barrier)barrier.sha256='c'.repeat(64);
    unsafe.modules=[part('worker.mjs','export default {fetch(){return new Response("older DecisionRing erasure enforcement")}}','application/javascript+module')];rehash(unsafe);
    assert.throws(()=>validateArtifact(unsafe));const before=f.calls.length;
    await assert.rejects(invoke(f,unsafe,'rollback',result.desired,{previous:result}));
    assert.equal(f.calls.length,before,'unchecked changed enforcement refuses before any provider call');
  }finally{f.close();}
});

test('W08.05 strict intent, material continuity and exact scope fail before provider writes',async()=>{
  const d=desired();assert.deepEqual(validateDesired(d),d);
  for(const change of [x=>x.account='wrong',x=>x.script='other-staging',x=>x.resources.sessions.name=x.resources.cache.name,
    x=>x.secrets.SDK_KEYS='*:'+MATERIAL,x=>x.secrets.IDENTITY_SALT='development-secret',x=>x.origins=['https://foreign.test'],
    x=>x.tenants.hosts['a.example.test']='foreign',x=>x.vars.RETENTION='{}',x=>x.owners=['*']]){
    const bad=clone(d);change(bad);assert.throws(()=>validateDesired(bad),/unavailable/);
  }
  const b=clone(d);b.tenants.provisioned.push('brand-b');b.tenants.hosts['b.example.test']='brand-b';b.origins.push('https://b.example.test');
  b.secrets.SDK_KEYS+=',brand-b:'+MATERIAL+'8';b.secrets.IDENTITY_SECRETS+=',brand-b:'+MATERIAL+'9';
  const retention=JSON.parse(b.vars.RETENTION);retention.tenants['brand-b']=clone(retention.tenants['brand-a']);b.vars.RETENTION=JSON.stringify(retention);
  telemetry(b);
  assert.doesNotThrow(()=>validateTransition('add-brand',b,d));assert.throws(()=>validateTransition('reconcile',b,d));
  const removed=clone(b);removed.secrets.SDK_KEYS='brand-a:'+MATERIAL+'x,brand-b:'+MATERIAL+'8';assert.throws(()=>validateTransition('add-brand',removed,d));
  const rotation=clone(d);rotation.secrets.JWT_SECRET+='9';assert.doesNotThrow(()=>validateTransition('rotate',rotation,d,['JWT_SECRET']));
  rotation.secrets.IDENTITY_SALT+='9';assert.throws(()=>validateTransition('rotate',rotation,d,['JWT_SECRET','IDENTITY_SALT']));
  const alert=clone(d);alert.secrets.ALERT_WEBHOOK_URL+='-rotated';telemetry(alert);
  assert.doesNotThrow(()=>validateTransition('rotate',alert,d,['ALERT_WEBHOOK_URL']));
  const wrongTelemetry=clone(d);wrongTelemetry.vars.TENANT_CONNECTORS=alert.vars.TENANT_CONNECTORS;assert.throws(()=>validateDesired(wrongTelemetry));
  const absentPolicy=clone(d),p=JSON.parse(absentPolicy.vars.RETENTION);delete p.tenants['brand-a'][Object.keys(p.tenants['brand-a']).find(x=>x.startsWith('telemetry.alert.'))];absentPolicy.vars.RETENTION=JSON.stringify(p);assert.throws(()=>validateDesired(absentPolicy));
  const artifact=await fixtureArtifact();
  for(const settings of [{foreign:true},{r2:true}]){
    const f=fixture({fresh:true});try{
      const input=desired(true);
      if(settings.foreign){input.resources.sessions.id='2'.repeat(32);f.resources.set('/storage/kv/namespaces/'+'2'.repeat(32),{id:'2'.repeat(32),title:'foreign-sessions'});}
      else f.resources.set('/r2/buckets/acme-staging-storage',{name:'acme-staging-storage'});
      await assert.rejects(runStampWorkflow('create',authorized('create',input,{bootstrap}),{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW}));
      assert.equal(f.calls.filter(x=>x.method!=='GET').length,0,'all detectable ownership failures precede creates');
    }finally{f.close();}
  }
});

test('W08.05 promotion refuses logging, route and zone prerequisites before any activation or write',async()=>{
  for(const alter of [f=>f.settings.logpush=true,f=>f.settings.observability.enabled=true,
    f=>f.routeRows.push({id:'foreign',pattern:'a.example.test/*',script:'other'}),f=>f.zone.account.id='c'.repeat(32),f=>f.zone.name='other.test']){
    const {f,artifact,result}=await createFixture();try{alter(f);const before=f.calls.length;
      await assert.rejects(runStampWorkflow('promote',authorized('promote',result.desired,{candidate:result}),{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW}));
      assert.equal(f.calls.slice(before).filter(x=>x.method!=='GET').length,0);
    }finally{f.close();}
  }
});

test('W08.05 protected receipts persist before effects; uncertain POST is read-only on replay',async()=>{
  const dir=await mkdtemp(resolve(tmpdir(),'stamp-fixture-'));await chmod(dir,0o700);
  try{const store=await protectedOperation(dir,OP);let writes=0,reads=0;
    const result=await effect(store,'write',{exact:'target'},async()=>{writes++;assert.ok(await store.read('write.intent'));throw Error('private-canary');});assert.equal(result.unconfirmed,true);
    await store.close();const reopened=await protectedOperation(dir,OP);
    const again=await effect(reopened,'write',{exact:'target'},async()=>{writes++;},async()=>{reads++;return{candidate:'uncertain'};});
    assert.equal(again.unconfirmed,true);assert.equal(writes,1);assert.equal(reads,1);await reopened.close();
    await chmod(dir,0o755);await assert.rejects(protectedOperation(dir,OP));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('W08.05 real transport create/rerun, second brand, explicit rotation, immutable promotion and rollback',async()=>{
  const {f,store,artifact,result}=await createFixture();try{
    assert.equal(result.status,'uploaded-not-promoted');assert.equal(f.versionRows.length,1);
    assert.equal(f.db.prepare('SELECT id FROM operator_accounts').get().id,OWNER);
    assert.equal(f.db.prepare('SELECT count(*) n FROM operator_memberships').get().n,0);
    const effects=f.calls.filter(x=>x.method!=='GET').length;
    const repeated=await runStampWorkflow('create',authorized('create',desired(true),{bootstrap}),{api:f.api,store,artifact,operation:OP,execute:true,now:()=>NOW});
    assert.deepEqual(repeated,result);assert.equal(f.calls.filter(x=>x.method!=='GET').length,effects);
    const promoted=await runStampWorkflow('promote',authorized('promote',result.desired,{candidate:result}),{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW});
    assert.equal(promoted.status,'promoted');assert.ok(f.calls.some(x=>x.path.endsWith('/deployments')&&x.method==='POST'));
    const reconciled=await runStampWorkflow('reconcile',authorized('reconcile',promoted.desired,{previous:promoted}),{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW});
    assert.equal(reconciled.status,'unchanged');assert.equal(reconciled.secretCommitment,promoted.secretCommitment);
    const b=clone(result.desired);b.tenants.provisioned.push('brand-b');b.tenants.hosts['b.example.test']='brand-b';b.origins.push('https://b.example.test');
    b.secrets.SDK_KEYS+=',brand-b:'+MATERIAL+'8';b.secrets.IDENTITY_SECRETS+=',brand-b:'+MATERIAL+'9';const r=JSON.parse(b.vars.RETENTION);r.tenants['brand-b']=clone(r.tenants['brand-a']);b.vars.RETENTION=JSON.stringify(r);
    telemetry(b);
    const added=await runStampWorkflow('add-brand',authorized('add-brand',b,{previous:reconciled}),{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW});
    assert.equal(added.desired.secrets.IDENTITY_SALT,result.desired.secrets.IDENTITY_SALT);
    assert.equal(f.versionRows[0].modules.get('worker.mjs').size,f.versionRows[1].modules.get('worker.mjs').size);
    const rotated=clone(b);rotated.secrets.JWT_SECRET+='x';
    const candidate=await runStampWorkflow('rotate',authorized('rotate',rotated,{previous:added,rotation:['JWT_SECRET']}),{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW});
    assert.equal(candidate.desired.secrets.SDK_KEYS,b.secrets.SDK_KEYS);
    for(const mode of ['rollback','restore']){
      const before=f.calls.filter(x=>x.method!=='GET').length;
      await assert.rejects(runStampWorkflow(mode,authorized(mode,added.desired,{previous:added}),{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW}));
      assert.equal(f.calls.filter(x=>x.method!=='GET').length,before,'stale pre-rotation recovery receipt has no effects');
    }
    for(const changed of [x=>x.secrets.IDENTITY_SALT+='9',x=>x.owners=['ops-77777777-7777-4777-8777-777777777777']]){
      const bad=clone(rotated);changed(bad);const before=f.calls.length;
      await assert.rejects(runStampWorkflow('upload',authorized('upload',bad,{previous:candidate}),{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW}));
      assert.equal(f.calls.length,before,'ordinary upload cannot bypass material transition');
    }
    const rollback=await runStampWorkflow('rollback',authorized('rollback',rotated,{previous:candidate}),{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW});
    assert.equal(rollback.status,'promoted');assert.equal(rollback.artifact,artifact.digest);
    const unchecked=clone(artifact);unchecked.modules=[part('worker.mjs','export default {fetch(){return new Response("unchecked feature")}}','application/javascript+module')];rehash(unchecked);
    const beforeUnchecked=f.calls.length;
    await assert.rejects(runStampWorkflow('rollback',authorized('rollback',rotated,{previous:rollback}),{api:f.api,store:memoryStore(),artifact:unchecked,operation:OP,execute:true,now:()=>NOW}));
    assert.equal(f.calls.length,beforeUnchecked,'rehashing unverified Worker bytes is not compatible provenance');
    // A retained older customer asset revision with the identical once-built
    // Worker/check basis: native served-byte checks are actually repeated for
    // these bytes, not fabricated or rebuilt against a newer source checkout.
    const asset=artifact.assets.find(p=>p.name==='/console/views.js');
    const aliased=clone(artifact);
    for(const check of aliased.verification.checks)check.before=check.after=aliased.verification.basis;
    const originalProof=canonical(aliased);
    const older=await verifyCommentOnlyAssetRevision(aliased,[part(asset.name,Buffer.from(asset.base64,'base64').toString()+'\n// retained older asset revision\n',asset.type)]);
    assert.equal(canonical(aliased),originalProof,'shared in-memory basis never rewrites original check evidence');
    assert.notEqual(older.verification.basisDigest,artifact.verification.basisDigest);
    assert.deepEqual(older.verification.checks,artifact.verification.checks,'only proved unaffected executed checks are reused');
    assert.deepEqual(older.modules,artifact.modules,'no second Worker build');
    await assert.rejects(verifyCommentOnlyAssetRevision(artifact,[part(asset.name,Buffer.from(asset.base64,'base64').toString()+'\nwindow.changed=true;\n',asset.type)]));
    const different=await runStampWorkflow('rollback',authorized('rollback',rotated,{previous:rollback}),{api:f.api,store:memoryStore(),artifact:older,operation:OP,execute:true,now:()=>NOW});
    assert.notEqual(different.artifact,rollback.artifact);assert.equal(different.secretCommitment,rollback.secretCommitment);assert.equal(different.barriers,rollback.barriers);
    const unsafe=clone(older),unsafePath=unsafe.barriers[0].path;unsafe.sourcePins.find(x=>x.path===unsafePath).sha256='c'.repeat(64);unsafe.barriers.find(x=>x.path===unsafePath).sha256='c'.repeat(64);delete unsafe.digest;unsafe.digest=hash(unsafe);
    const beforeUnsafe=f.calls.filter(x=>x.method!=='GET').length;
    await assert.rejects(runStampWorkflow('rollback',authorized('rollback',rotated,{previous:different}),{api:f.api,store:memoryStore(),artifact:unsafe,operation:OP,execute:true,now:()=>NOW}));
    assert.equal(f.calls.filter(x=>x.method!=='GET').length,beforeUnsafe,'older enforcement is not compatible rollback');
    const bad=clone(artifact);bad.modules[0].base64=Buffer.from('tampered').toString('base64');assert.throws(()=>validateArtifact(bad));
    assert.throws(()=>doMigrationPlan(artifact.doMigrations,'unknown'));
  }finally{f.close();}
});

test('W08.05 product migration history and transaction-safe current security restore do not replay recovery',async()=>{
  const f=fixture(),artifact=await fixtureArtifact(),store=memoryStore(),db=d1Queries(f.api,ACCOUNT,DBID,store);
  try{
    f.db.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);"+Buffer.from(artifact.migrations[0].base64,'base64').toString()+"INSERT INTO d1_migrations(name) VALUES ('0010_operator_accounts.sql');");
    await migrateProduct(db,artifact);await migrateProduct(db,artifact);
    f.db.exec('CREATE TABLE _cf_KV (key TEXT PRIMARY KEY,value BLOB);');
    assert.deepEqual(f.db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(x=>x.name),MIGRATIONS);
    f.db.prepare('INSERT INTO operator_accounts(id,email,name,roles,permissions,password_hash,must_change_password,disabled,created_at,updated_at,last_sign_in_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(OWNER,'owner@example.test','Owner','["operator"]','["read"]','old-hash',0,0,1,2,null);
    f.db.prepare('INSERT INTO operator_sessions(jti,account_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)').run('old-session',OWNER,'token',1,9);
    const old=await captureSecurity(db,artifact);
    f.db.prepare('INSERT INTO operator_recovery_requests VALUES (?,?,?,?,?,?,?,?,?)').run(OP,'44444444-4444-4444-8444-444444444444','scope',OWNER,'owner@example.test',2,'new-hash','temporary-password+enable',3);
    f.db.prepare('INSERT INTO operator_memberships VALUES (?,?,?,?,?,?,?)').run(OWNER,'brand-a','admin',1,1,'revoked',4);
    f.db.prepare('INSERT INTO operator_service_credentials VALUES (?,?,?,?,?,?,?,?,?)').run('service',OWNER,'brand-a','admin','hash',99,1,OWNER,4);
    f.db.prepare('UPDATE operator_accounts SET disabled=1,updated_at=5').run();
    f.db.prepare('DELETE FROM operator_accounts WHERE id=?').run(OWNER);
    f.db.prepare("INSERT INTO operator_audit(at,action,target_id,target_email) VALUES (6,'account_removed',?,?)").run(OWNER,'owner@example.test');
    const current=await captureSecurity(db,artifact),sql=await securityRestoreSQL(current,artifact);
    f.executeSQL(await securityRestoreSQL(old,artifact));assert.equal(f.db.prepare('SELECT count(*) n FROM operator_sessions').get().n,1);
    f.executeSQL(sql);assert.deepEqual(await captureSecurity(db,artifact),securityRestoration(current,artifact));
    assert.equal(f.db.prepare('SELECT count(*) n FROM operator_accounts').get().n,0);
    const before=await captureSecurity(db,artifact);
    assert.throws(()=>f.executeSQL(sql.replace('CREATE TRIGGER operator_recovery_apply','INSERT INTO no_such_table VALUES (1); CREATE TRIGGER operator_recovery_apply')));
    assert.deepEqual(await captureSecurity(db,artifact),before,'failed middle statement rolls back tables and trigger');
    f.db.exec("INSERT INTO d1_migrations(name) VALUES ('9999_unknown.sql')");await assert.rejects(migrateProduct(db,artifact));
    for(const name of MIGRATIONS)assert.deepEqual(await readFile(new URL('../migrations/product/'+name,import.meta.url)),await readFile(new URL('../migrations/'+name,import.meta.url)));
  }finally{f.close();}
});

test('W08.05 actual restore transport pauses delivery, quarantines and restores protected post-bookmark barriers',async()=>{
  const {f,artifact,result:uploaded}=await createFixture();try{
    const result=await invoke(f,artifact,'promote',uploaded.desired,{candidate:uploaded});
    const d=result.desired,db=d1Queries(f.api,ACCOUNT,DBID,memoryStore()),old=await captureSecurity(db,artifact);
    f.bookmarkSQL=await securityRestoreSQL(old,artifact);
    f.db.exec("UPDATE operator_accounts SET disabled=1,updated_at=updated_at+1; DELETE FROM operator_sessions;");
    const current=await captureSecurity(db,artifact);
    const maintenance={operation:OP,account:ACCOUNT,script:d.script,database:DBID,evidence:'c'.repeat(64),issuedAt:NOW-100,expiresAt:NOW+600000,
      covers:['active-and-old-versions','http-inflight','durable-object-work','websockets','scheduled-work','queue-inflight','external-d1-writers'],queueEmpty:true,producersStopped:true,resume:false};
    const bad=authorized('restore',d,{previous:result,candidate:result,restore:{bookmark:'00000000-00000000-00000001'},maintenance:{...maintenance,expiresAt:NOW}});
    const effects=f.calls.filter(x=>x.method!=='GET').length;await assert.rejects(runStampWorkflow('restore',bad,{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW}));
    assert.equal(f.calls.filter(x=>x.method!=='GET').length,effects);
    const out=await runStampWorkflow('restore',{...bad,maintenance},{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW});
    assert.equal(out.status,'restored-quarantined');assert.deepEqual(await captureSecurity(db,artifact),securityRestoration(current,artifact));
    assert.equal(f.resources.get('/queues/'+'4'.repeat(32)).settings.delivery_paused,true);
    assert.ok(f.calls.some(x=>x.method==='POST'&&x.path.endsWith('/time_travel/restore')));
    assert.ok(f.versionRows[0].modules.has('quarantine.mjs'));
  }finally{f.close();}
});

test('W08.05 restore resumes current traffic last and does not activate after a background-step failure',async()=>{
  for(const failResume of [false,true]){
    const {f,artifact,result:uploaded}=await createFixture({failRequest:({path,method,body})=>failResume&&method==='PATCH'&&path.includes('/queues/')&&body.settings.delivery_paused===false});
    try{const result=await invoke(f,artifact,'promote',uploaded.desired,{candidate:uploaded});
      const d=result.desired,db=d1Queries(f.api,ACCOUNT,DBID,memoryStore());f.bookmarkSQL=await securityRestoreSQL(await captureSecurity(db,artifact),artifact);
      const maintenance={operation:OP,account:ACCOUNT,script:d.script,database:DBID,evidence:'c'.repeat(64),issuedAt:NOW-100,expiresAt:NOW+600000,
        covers:['active-and-old-versions','http-inflight','durable-object-work','websockets','scheduled-work','queue-inflight','external-d1-writers'],queueEmpty:true,producersStopped:true,resume:true};
      const call=runStampWorkflow('restore',authorized('restore',d,{previous:result,candidate:result,restore:{bookmark:'00000000-00000000-00000001'},maintenance}),{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW});
      if(failResume){await assert.rejects(call);assert.notEqual(f.calls.filter(x=>x.method==='POST'&&x.path.endsWith('/deployments')).at(-1).body.versions[0].version_id,result.version);}
      else{assert.equal((await call).status,'restored-and-resumed');assert.equal(f.calls.filter(x=>x.method!=='GET'&&!x.path.endsWith('/query')).at(-1).path.endsWith('/deployments'),true);}
    }finally{f.close();}
  }
});

test('Offline actual Worker/SDK/customer-assets package is pinned once; not a cloud or release check',{timeout:300000},async()=>{
  const artifact=await fixtureArtifact();
  validateArtifact(artifact);assert.ok(artifact.modules[0].bytes>100000);
  assert.ok(artifact.sourcePins.some(x=>x.path==='src/index.ts'));
  assert.deepEqual(artifact.assets.map(x=>x.name).sort(),ASSETS.map(x=>'/'+x));
  assert.equal(artifact.assetContract,'customer-assets-v2');
  const debug=artifact.assets.find(asset=>asset.name==='/sdk/debug.js');assert.ok(debug,'independent required debug asset');
  assert.deepEqual(Buffer.from(debug.base64,'base64'),await readFile(new URL('../public/sdk/debug.js',import.meta.url)));
  assert.ok(artifact.barriers.some(pin=>pin.path==='src/routes/search.ts'),'new search security root');
  assert.ok(artifact.sourcePins.some(pin=>pin.path==='scripts/sql/snowflake-warehouse-v1.sql'),'delivered receiver exact source');
  console.log('Offline artifact identity '+artifact.digest+'; Worker bytes '+artifact.modules[0].bytes+'; assets '+artifact.assets.length+'; source pins '+artifact.sourcePins.length);
  console.log('Offline artifact payload gzip/base64 '+gzipSync(Buffer.from(canonical(artifact))).toString('base64'));
  assert.deepEqual(artifact.verification.checks.map(c=>c.command),artifact.verification.profile==='ci-v1'?[...LOCAL_CHECK_COMMANDS.slice(0,2),'npm test']:LOCAL_CHECK_COMMANDS);
  assert.deepEqual(artifact.verification.native.assets,artifact.assets.map(p=>({name:p.name,status:200,bytes:p.bytes,sha256:p.sha256})));
  assert.equal(artifact.verification.native.sdk.esm,'createClient:function');assert.equal(artifact.verification.native.sdk.iife,'createClient:function');
  assert.equal(artifact.verification.native.omittedStatus,404);assert.equal(artifact.verification.native.outbound,0);
  const config=parseToml(await readFile(new URL('../wrangler.toml',import.meta.url),'utf8'));
  const barriers=new Map(artifact.barriers.map(x=>[x.path,x])),sources=new Map(artifact.sourcePins.map(x=>[x.path,x]));
  for(const environment of ['staging','production'])for(const binding of config.env[environment].durable_objects.bindings)
    assert.ok(barriers.has('src/durable-objects/'+binding.class_name+'.ts'),'actual runtime binding is a rollback barrier: '+binding.class_name);
  for(const path of ['src/ledger/consume.ts','src/ledger/erasure.ts','src/learn/hourly.ts','src/ops/monitor.ts','src/reflex/regionTrend.ts'])assert.ok(barriers.has(path));
  for(const [path,proof]of barriers){assert.equal(sources.get(path).sha256,proof.sha256);if(path!=='src/index.ts')for(const imported of sources.get(path).imports)assert.ok(barriers.has(imported),'effective enforcement dependency '+imported);}
  console.log('Actual enforcement closure '+barriers.size+' pins; every customer-bound DO and background root plus transitive imports verified');
  assert.equal(config.env.staging.d1_databases[0].migrations_dir,'migrations/product');assert.equal(config.env.production.d1_databases[0].migrations_dir,'migrations/product');
  assert.equal(config.vars.JWT_SECRET,undefined);assert.equal(config.d1_databases[0].migrations_dir,'migrations');
  for(const mutate of [a=>delete a.verification,a=>a.verification={evidence:'claimed',sha256:'d'.repeat(64)},
    a=>a.verification.checks[0].exitCode=1,a=>a.verification.checks[1].command='true',
    a=>a.verification.checks[0].completedAt='invalid',a=>a.sourcePins.push(clone(a.sourcePins[0])),
    a=>{const path='src/console/console.render.test.ts';a.verification.basis=a.verification.basis.filter(p=>p.path!==path);a.verification.basisDigest=hash(a.verification.basis);for(const c of a.verification.checks){c.before=c.before.filter(p=>p.path!==path);c.after=c.after.filter(p=>p.path!==path);}},
    a=>a.config.sha256='0'.repeat(64),a=>a.tools.pop(),a=>a.buildOptions.sdk[0].minify=true,
    a=>a.verification.checks[2].after[0].sha256='0'.repeat(64),a=>a.verification.checks[0].stdout.base64='dGFtcGVy',
    a=>a.verification.native.assets[0].status=404,a=>a.verification.native.sdk.esm='not-loaded',
    a=>a.sourcePins.find(p=>p.path==='.eslintrc.json').sha256='0'.repeat(64),
    a=>a.assets[0]=part(a.assets[0].name,'changed after checks',a.assets[0].type)]){
    const bad=clone(artifact);mutate(bad);rehash(bad);assert.throws(()=>validateArtifact(bad));
    const f=fixture();try{await assert.rejects(runStampWorkflow('create',authorized('create',desired(true),{bootstrap}),{api:f.api,store:memoryStore(),artifact:bad,operation:OP,execute:true,now:()=>NOW}));assert.equal(f.calls.length,0);}finally{f.close();}
  }
  await assert.rejects(packageArtifact({verification:{evidence:'caller supplied pass',sha256:'d'.repeat(64)}}));
  // Cross-process custody: even another serialization of the same valid
  // artifact cannot substitute for the exact protected bytes the parent held.
  const directory=await mkdtemp(resolve(tmpdir(),'w13-custody-'));await chmod(directory,0o700);
  const store=await protectedOperation(directory,OP),path=resolve(directory,OP,'artifact.json');
  try {
    await store.write('artifact',artifact);
    const bytes=await readFile(path),identity={digest:artifact.digest,sha256:sha256(bytes),bytes:bytes.length};
    assert.equal((await readPinnedArtifact(path,identity)).digest,artifact.digest);
    const child=()=>spawnSync(process.execPath,['--input-type=module','-e',
      'import {readPinnedArtifact} from "./scripts/stamp-workflow.mjs"; await readPinnedArtifact(process.env.STAMP_TEST_ARTIFACT_PATH,JSON.parse(process.env.STAMP_TEST_EXPECTED)); console.log("exact held artifact");'],
      {encoding:'utf8',env:{...process.env,STAMP_TEST_ARTIFACT_PATH:path,STAMP_TEST_EXPECTED:JSON.stringify(identity)}});
    assert.equal(child().status,0,'valid child reads the exact protected parent bytes');
    await writeFile(path,Buffer.concat([bytes,Buffer.from('\n')]),{mode:0o600});
    assert.equal(validateArtifact(JSON.parse(await readFile(path,'utf8'))).digest,identity.digest,'replacement remains semantically valid');
    const substituted=child();assert.notEqual(substituted.status,0);assert.ok(!substituted.stdout.includes('exact held artifact'));
    await assert.rejects(readPinnedArtifact(path,identity),'parent after-run/final-upload identity also refuses replacement');
    await writeFile(path,bytes,{mode:0o600});await chmod(path,0o644);
    await assert.rejects(readPinnedArtifact(path,identity),'matching bytes in an unprotected file are not accepted');
  } finally {await store.close();await rm(directory,{recursive:true,force:true});}
  console.log('Native artifact load '+artifact.digest+'; exact allowed assets and both SDK exports; omitted 404; outbound 0; workerd '+JSON.parse(await readFile(new URL('../node_modules/workerd/package.json',import.meta.url),'utf8')).version);
});

test('W15 protected OIDC desired state is disabled by default and rejects incomplete or unowned material before effects',async()=>{
  const d=desired();assert.equal(d.vars.OPERATOR_OIDC,undefined);assert.deepEqual(validateDesired(d),d);
  const provider={enabled:true,issuer:'https://issuer.example',authorizationEndpoint:'https://issuer.example/authorize',tokenEndpoint:'https://issuer.example/token',
    jwksUri:'https://issuer.example/keys',origin:'https://a.example.test/',clientId:'synthetic-client',clientSecretRef:'OPERATOR_OIDC_SECRET_FIXTURE',
    algorithms:['ES256'],transactionMs:30000,sessionMs:120000,reauthMs:180000,timeoutMs:500};
  d.vars.OPERATOR_OIDC=JSON.stringify({version:1,tenants:{'brand-a':provider}});d.secrets.OPERATOR_OIDC_SECRET_FIXTURE='synthetic-oidc-material-with-explicit-authority';
  assert.deepEqual(validateDesired(d),d);
  const artifact=await fixtureArtifact(),f=fixture();
  try{
    for(const mutate of [v=>delete v.secrets.OPERATOR_OIDC_SECRET_FIXTURE,v=>v.secrets.OPERATOR_OIDC_SECRET_FIXTURE='short',
      v=>v.secrets.OPERATOR_OIDC_SECRET_UNUSED='not-referenced',v=>{const c=JSON.parse(v.vars.OPERATOR_OIDC);c.tenants['brand-a'].issuer=['https://issuer.example'];v.vars.OPERATOR_OIDC=JSON.stringify(c);},
      v=>{const c=JSON.parse(v.vars.OPERATOR_OIDC);c.tenants['brand-a'].origin='https://foreign.example/';v.vars.OPERATOR_OIDC=JSON.stringify(c);},
      v=>{const c=JSON.parse(v.vars.OPERATOR_OIDC);c.tenants['brand-a'].algorithms=['HS256'];v.vars.OPERATOR_OIDC=JSON.stringify(c);}]){
      const bad=clone(d);mutate(bad);assert.throws(()=>validateDesired(bad));
      await assert.rejects(runStampWorkflow('create',authorized('create',bad),{api:f.api,store:memoryStore(),artifact,operation:OP,execute:true,now:()=>NOW}));
      assert.equal(f.calls.length,0);
    }
    const rotated=clone(d);rotated.secrets.OPERATOR_OIDC_SECRET_FIXTURE+='-rotated';
    assert.doesNotThrow(()=>validateTransition('rotate',rotated,d,['OPERATOR_OIDC_SECRET_FIXTURE']));
    rotated.secrets.IDENTITY_SALT+='changed';assert.throws(()=>validateTransition('rotate',rotated,d,['OPERATOR_OIDC_SECRET_FIXTURE','IDENTITY_SALT']));
  }finally{f.close();}
});

test('W15 current security schema and transactional restore retain links but never resurrect federated sessions or browser secrets',async()=>{
  const artifact=await fixtureArtifact();assert.equal(artifact.schemaContract,'operator-oidc-v2');assert.equal(artifact.migrations.length,4);
  assert.equal(artifact.migrations.at(-1).name,'0013_operator_oidc.sql');assert.equal(SECURITY_TABLES.length,11);
  for(const mutate of [v=>delete v.schemaContract,v=>v.migrations.pop(),v=>v.schemaContract='unknown']){
    const bad=clone(artifact);mutate(bad);rehash(bad);assert.throws(()=>validateArtifact(bad));
  }
  const f=fixture(),db=d1Queries(f.api,ACCOUNT,DBID,memoryStore());
  try{
    await migrateProduct(db,artifact);
    f.db.prepare("INSERT INTO operator_accounts(id,email,name,password_hash,must_change_password,created_at,updated_at) VALUES(?,?,?,?,0,1,1)").run(OWNER,'owner@example.test','Owner','preserved-password');
    f.db.prepare("INSERT INTO operator_accounts(id,email,name,password_hash,must_change_password,created_at,updated_at,auth_mode) VALUES('oidc-person','oidc@example.test','OIDC',NULL,0,2,2,'oidc')").run();
    f.db.prepare('INSERT INTO operator_oidc_links VALUES(?,?,?,?,?,?)').run('oidc-person','https://issuer.example','exact-subject','link-current',0,2);
    f.db.prepare('INSERT INTO operator_memberships VALUES(?,?,?,?,?,?,?)').run('oidc-person','brand-a','operator',0,0,'membership-current',2);
    f.db.prepare('INSERT INTO operator_sessions VALUES(?,?,?,?,?,?)').run('password-session',OWNER,'hash',2,999,'password');
    f.db.prepare('INSERT INTO operator_sessions VALUES(?,?,?,?,?,?)').run('oidc.original','oidc-person','oidc-hash',2,999,'oidc');
    const epoch=f.db.prepare('SELECT epoch FROM operator_oidc_epoch WHERE id=1').get().epoch;
    f.db.prepare('INSERT INTO operator_oidc_sessions VALUES(?,?,?,?,?,?,?,?,?,?)').run('oidc.original','oidc-person','brand-a','https://issuer.example','link-current','a'.repeat(64),2,epoch,2,999);
    f.db.prepare('INSERT INTO operator_oidc_transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('state','cookie','brand-a','https://a.example.test','oidc-person',2,'link-current','a'.repeat(64),epoch,'original-nonce','original-verifier',2,999,null,'oidc.original');
    f.db.prepare('INSERT INTO operator_oidc_completions VALUES(?,?,?,?,?,?,?,?,?)').run('completion','cookie','brand-a','https://a.example.test',epoch,'oidc.original','encrypted-original-credentials',999,null);
    const current=await captureSecurity(db,artifact),expected=securityRestoration(current,artifact),sql=await securityRestoreSQL(current,artifact);
    f.executeSQL(sql);assert.deepEqual(await captureSecurity(db,artifact),expected);
    assert.deepEqual(expected.tables.operator_sessions.map(v=>v.jti),['password-session']);assert.deepEqual(expected.tables.operator_oidc_sessions,[]);
    assert.equal(expected.tables.operator_accounts.find(v=>v.id==='oidc-person').password_hash,null);
    assert.deepEqual(expected.tables.operator_oidc_links,current.tables.operator_oidc_links);assert.deepEqual(expected.tables.operator_memberships,current.tables.operator_memberships);
    assert.notEqual(expected.tables.operator_oidc_epoch[0].epoch,epoch);
    assert.equal(expected.tables.operator_oidc_transactions[0].expires_at,0);assert.equal(expected.tables.operator_oidc_transactions[0].consumed_at,0);
    assert.equal(expected.tables.operator_oidc_transactions[0].verifier,'');assert.equal(expected.tables.operator_oidc_transactions[0].nonce,'');
    assert.equal(expected.tables.operator_oidc_completions[0].payload,'');assert.equal(expected.tables.operator_oidc_completions[0].expires_at,0);assert.equal(expected.tables.operator_oidc_completions[0].consumed_at,0);
    assert.throws(()=>f.executeSQL(sql.replace('CREATE TRIGGER operator_recovery_apply','INSERT INTO unavailable_table VALUES(1); CREATE TRIGGER operator_recovery_apply')));
    assert.deepEqual(await captureSecurity(db,artifact),expected,'an ambiguous failed restore cannot partially restore old grants');
  }finally{f.close();}
});

test('W14 connector material and strict purpose shapes fail before provider effects',async()=>{
  const {generateKeyPairSync,createPublicKey}=await import('node:crypto'),pair=generateKeyPairSync('rsa',{modulusLength:2048});
  const d=desired(),registry=JSON.parse(d.vars.TENANT_CONNECTORS),policies=JSON.parse(d.vars.RETENTION);
  const config={version:1,enabled:true,provider:'snowflake-sql-api',account:'LOCAL_TEST',origin:'https://fixture.snowflakecomputing.com/',user:'LOCAL',
    keyPairRef:'CONNECTOR_SECRET_WAREHOUSE',database:'LOCAL',schema:'PUBLIC',warehouse:'LOCAL',role:'DELIVERY',procedure:'APPLY_DELIVERY_V1',identityNamespace:'local-v1',mappingRevision:'v1',
    approval:{egress:'fixture',metering:'fixture',providerRetention:'fixture'},cadenceMs:60000,startAt:0,timeoutMs:1000,responseBytes:65536,maxObjects:10,maxRows:100,maxBytes:2*1024*1024};
  registry.tenants['brand-a'].warehouse=config;policies.tenants['brand-a']['external.warehouse.'+hash({purpose:'warehouse',tenant:'brand-a',...config})]=clone(policies.tenants['brand-a'].profile);
  d.vars.TENANT_CONNECTORS=JSON.stringify(registry);d.vars.RETENTION=JSON.stringify(policies);
  d.secrets.CONNECTOR_SECRET_WAREHOUSE=JSON.stringify({privateKey:pair.privateKey.export({format:'pem',type:'pkcs8'}).toString().trim(),
    publicKeyFingerprint:'SHA256:'+Buffer.from(sha256(createPublicKey(pair.privateKey).export({format:'der',type:'spki'})),'hex').toString('base64')});
  assert.deepEqual(validateDesired(d),d);
  for(const mutate of [next=>next.secrets.CONNECTOR_SECRET_WAREHOUSE='not-json',next=>delete next.secrets.CONNECTOR_SECRET_WAREHOUSE,
    next=>next.secrets.CONNECTOR_SECRET_UNUSED='not-referenced',next=>{const v=JSON.parse(next.secrets.CONNECTOR_SECRET_WAREHOUSE);v.publicKeyFingerprint='SHA256:'+'A'.repeat(43)+'=';next.secrets.CONNECTOR_SECRET_WAREHOUSE=JSON.stringify(v);},
    next=>{const v=JSON.parse(next.vars.TENANT_CONNECTORS);v.tenants['brand-a'].warehouse.origin=[config.origin];next.vars.TENANT_CONNECTORS=JSON.stringify(v);},
    next=>{const v=JSON.parse(next.vars.TENANT_CONNECTORS);v.tenants['brand-a'].warehouse.account=['LOCAL'];next.vars.TENANT_CONNECTORS=JSON.stringify(v);}]){
    const bad=clone(d);mutate(bad);assert.throws(()=>validateDesired(bad));
  }
  assert.throws(()=>validateTransition('rotate',d,d,['CONNECTOR_SECRET_WAREHOUSE']),'declared rotation must actually change material');
  const rotated=clone(d),nextPair=generateKeyPairSync('rsa',{modulusLength:2048});
  rotated.secrets.CONNECTOR_SECRET_WAREHOUSE=JSON.stringify({privateKey:nextPair.privateKey.export({format:'pem',type:'pkcs8'}).toString().trim(),
    publicKeyFingerprint:'SHA256:'+Buffer.from(sha256(createPublicKey(nextPair.privateKey).export({format:'der',type:'spki'})),'hex').toString('base64')});
  assert.doesNotThrow(()=>validateTransition('rotate',rotated,d,['CONNECTOR_SECRET_WAREHOUSE']));
  rotated.secrets.IDENTITY_SALT+='changed';assert.throws(()=>validateTransition('rotate',rotated,d,['CONNECTOR_SECRET_WAREHOUSE','IDENTITY_SALT']));
});

test('W14 debug handoff has useful closed states, bounded redaction and complete teardown',async()=>{
  const {runInNewContext}=await import('node:vm'),listeners=new Map(),stopped=[],node={textContent:''},context={};
  runInNewContext(await readFile(new URL('../public/sdk/debug.js',import.meta.url),'utf8'),context);
  const client={core:{on:(event,fn)=>{listeners.set(event,fn);return()=>{listeners.delete(event);stopped.push(event);};}}};
  assert.throws(()=>context.EdgePersonalizationDebug.attach(client));
  const debug=context.EdgePersonalizationDebug.attach(client,{enabled:true,element:node,limit:3});
  const privateData={userId:'PRIVATE_ID',capability:'PRIVATE_TOKEN',affinity:{secret:1},query:'PRIVATE_QUERY'};
  listeners.get('sent')(privateData,{via:'fetch',...privateData});listeners.get('decisions')({...privateData,decisions:[privateData,privateData]});
  listeners.get('update')(privateData,{rttMs:12.7,fromPush:true,...privateData});
  assert.equal(debug.snapshot().length,3);assert.equal(debug.snapshot()[1].count,2);assert.equal(debug.snapshot()[2].rttMs,13);assert.ok(!node.textContent.includes('PRIVATE'));
  for(const state of ['connected','reconnecting','unavailable']){listeners.get('socket')(state);assert.equal(debug.snapshot().at(-1).state,state);}
  listeners.get('identity')(privateData);assert.equal(debug.snapshot().length,1);assert.equal(debug.snapshot()[0].kind,'identity-changed');
  debug.dispose();debug.dispose();assert.equal(listeners.size,0);assert.equal(stopped.length,6);assert.equal(node.textContent,'');assert.equal(debug.snapshot().length,0);
});

test('W14 asset-contract retains genuinely verified older W13 bytes without relabelling their source basis',async()=>{
  const {gunzipSync}=await import('node:zlib');
  const evidence=JSON.parse(await readFile(new URL('../docs/remediation/evidence/W13.02/worker.json',import.meta.url),'utf8'));
  const check=evidence.checks.find(value=>value.check==='W13.02-K3.2'),primary=gunzipSync(Buffer.from(check.gzipBase64,'base64'));
  assert.equal(sha256(primary),'93ab394fb0a8832bd399916e488676eec7fc7d649be81db5267b03b6d38ff722');
  const lines=primary.toString().split('\n'),at=lines.findIndex(line=>line.includes('Offline artifact payload gzip/base64 '));assert.ok(at>=0);
  let encoded=lines[at].split('Offline artifact payload gzip/base64 ')[1];
  for(let i=at+1;i<lines.length;i++){const line=lines[i].replace(/^# /,'').trim();if(!/^[A-Za-z0-9+/=]+$/.test(line))break;encoded+=line;}
  const bytes=gunzipSync(Buffer.from(encoded,'base64'));assert.equal(bytes.length,11050433);assert.equal(sha256(bytes),'8c4ec86fe639c4392c3a9afaeaf285aa9aa7ad1ca587042e84d1ba1b3dc8ab39');
  const archived=JSON.parse(bytes);validateArtifact(archived);assert.equal(archived.digest,'497ad9cda3fc1a860eccb016aca0d44596c89e26e019cb78b4a35b7403b26720');
  assert.equal(archived.schemaContract,undefined);assert.equal(archived.migrations.length,3);
  assert.equal(archived.assetContract,undefined);assert.equal(archived.assets.length,12);assert.ok(!archived.barriers.some(pin=>pin.path==='src/routes/search.ts'));
  const forged=clone(archived);forged.assetContract='customer-assets-v2';rehash(forged);assert.throws(()=>validateArtifact(forged));
  const current=await fixtureArtifact();assert.equal(current.assetContract,'customer-assets-v2');
  assert.equal(current.schemaContract,'operator-oidc-v2');
  const f=fixture();try{const db=d1Queries(f.api,ACCOUNT,DBID,memoryStore());await migrateProduct(db,current);await assert.rejects(migrateProduct(db,archived));}finally{f.close();}
  for(const change of [value=>value.assets=value.assets.filter(asset=>asset.name!=='/sdk/debug.js'),value=>value.assets.find(asset=>asset.name==='/sdk/debug.js').base64=Buffer.from('tampered').toString('base64'),value=>value.barriers=value.barriers.filter(pin=>pin.path!=='src/routes/search.ts')]){
    const bad=clone(current);change(bad);rehash(bad);assert.throws(()=>validateArtifact(bad));
  }
});

test('W14 customer-kit executes signed request flow, reconciles lost publication ACK and preserves unrelated concurrent content',async()=>{
  const {runInNewContext}=await import('node:vm');
  const original=await readFile(new URL('./acceptance-run.mjs',import.meta.url),'utf8');
  const script=original.replace(/^#!.*\n/,'').replace(/^import .*from '\.\/lib\/tool-token\.mjs';\n/m,'');
  for(const scenario of ['clean','lost-ack','owned-edit','cleanup-failure','synthetic-protocol-success']){
    const logs=[],calls=[],operations=new Map();let revision=1,put=0,snapshot=false,issued=0,views=0,erased=false,credited=false;
    const success=scenario==='synthetic-protocol-success';let ownedPage,ownedSlots=[],heroDecision,lostRenderAck=false;const offers=new Map(),rendered=new Map(),renderWires=new Map();
    let docs={catalog:{pieces:[{id:'acc-pre-existing',title:'Keep historical fixture'}]},slots:{pages:{existing:[]}},learn:{slots:{existing:{reward:'click'}}}};
    const publication=()=>({revision,digest:String(revision).padStart(64,'a')});
    const apply=body=>{docs={catalog:clone(body.document),slots:clone(body.publicationChanges.find(c=>c.kind==='slots').document),learn:clone(body.publicationChanges.find(c=>c.kind==='learn').document)};
      if(!ownedPage){ownedPage=Object.keys(docs.slots.pages).find(p=>p.startsWith('acceptance-'));ownedSlots=docs.slots.pages[ownedPage].map(s=>s.slot);}
      docs.catalog.pieces=docs.catalog.pieces.map(p=>Object.fromEntries(Object.entries(p).reverse()));revision++;};
    const reply=(body,status=200)=>Response.json(body,{status});
    const fetch=async(input,init)=>{
      const u=new URL(input),body=init.body?JSON.parse(init.body):null;calls.push({url:u.href,method:init.method,headers:init.headers,body});
      assert.equal(u.origin,'https://kit.invalid');assert.equal(init.redirect,'error');assert.ok(init.signal);
      assert.ok(!u.searchParams.has('visitorId')&&!u.searchParams.has('sessionId'));
      const kind=/^\/content\/(catalog|slots|learn)$/.exec(u.pathname)?.[1];
      if(kind&&init.method==='GET')return reply({document:clone(docs[kind]),revision,publication:publication()});
      if(kind&&init.method==='PUT'){
        put++;assert.match(init.headers['If-Match'],/^"\d+\/\d+\/[a-f0-9]{64}"$/);assert.match(init.headers['Idempotency-Key'],/^\d+:[a-f0-9-]{36}$/);
        assert.equal(kind,'catalog');assert.equal(body.publicationChanges.length,2);
        const id=init.headers['Idempotency-Key'];
        if(put===2&&scenario==='cleanup-failure'){operations.set(id,{state:'absent'});return reply({ok:false},503);}
        if(put===1&&scenario==='lost-ack'){operations.set(id,{state:'pending',body});throw Error('Synthetic lost ACK');}
        apply(body);operations.set(id,{state:'committed'});return reply({ok:true});
      }
      if(u.pathname.endsWith('/publication')){const id=init.headers['Idempotency-Key'],operation=operations.get(id);return reply({state:operation?.state??'absent',operationId:id});}
      if(u.pathname.endsWith('/publication/recover')){const id=init.headers['Idempotency-Key'],operation=operations.get(id);assert.equal(operation.state,'pending');apply(operation.body);operation.state='committed';return reply({ok:true});}
      if(u.pathname.endsWith('/identity/session')){issued++;return reply({session:{capability:'signed-capability',subject:'issued-subject'+issued,sessionId:'issued-session'+issued,grantId:'grant',iat:1,exp:9999999999,consent:{instruction:{revision:'consent-r0'}}}});}
      if(u.pathname==='/realtime/session/preferences'){
        assert.equal(init.headers['X-Shopper-Session'],'signed-capability');assert.equal(body.choice.expectedRevision,'consent-r0');assert.equal(body.choice.grantId,'grant');assert.equal(body.trackingConsent,issued===1);return reply({consent:{tracking:body.trackingConsent}});
      }
      if(u.pathname.endsWith('/decisions/snapshot')){
        assert.equal(init.method,'POST');assert.equal(init.headers['X-Shopper-Session'],'signed-capability');assert.deepEqual(Object.keys(body).sort(),['channel','page','pageInstance']);assert.match(body.pageInstance,/^[a-f0-9-]{36}$/);
        if(!snapshot){docs.catalog.pieces.push({id:'concurrent-legitimate',title:'Keep concurrent content'});docs.slots.pages.concurrent=[];docs.learn.slots.concurrent={reward:'purchase'};revision++;}snapshot=true;
        if(scenario==='owned-edit')docs.catalog.pieces.find(p=>p.id!=='acc-pre-existing'&&p.id!=='concurrent-legitimate').title='Concurrent owned edit';
        if(success){
          assert.equal(body.page,ownedPage);const prefix=ownedSlots.find(s=>s.endsWith('-hero')).slice(0,-4),id=name=>prefix+name,mid=views===2,refused=issued===2;
          if(refused){assert.match(init.headers.Cookie,/opt_tracking_consent=false/);return reply({ok:true,arm:'default',write:false,sources:{consent:{tracking:false}},decisions:[]});}
          const entries=[['hero',mid?'h-consider':'h-explore'],['fresh','f-new'],['fresh','f-old'],['rail','r-d1'],['rail','r-t1'],['rail','r-d2'],['story','s-featured']];
          const records=entries.map(([slot,item],i)=>({slot:id(slot),item_id:id(item),position:i,decision_id:'synthetic-owned-'+views+'-'+i,measurementBasis:'rendered-v1',
            candidates:[{contentId:id(item)}],featured_product_ids:slot==='story'?['ACC-P-'+ownedPage.slice('acceptance-'.length)]:[],
            inputs:slot==='rail'&&mid?{served:{[id('rail')]:{[id('r-d1')]:1}}}:{},
            explain:{...(slot==='hero'&&mid?{stage:{visitor:'considering',applied:0.2}}:{}),
              ...(item==='f-new'?{freshness:{applied:0.181}}:item==='f-old'?{freshness:{applied:0.004}}:{}),
              ...(item==='r-t1'?{diversity:{skipped:[id('r-d2')]}}:item==='r-d2'?{diversity:{relaxed:true}}:{}),
              ...(slot==='rail'&&mid?{fatigue:{served:1,applied:-0.1}}:{})}}));
          if(!heroDecision)heroDecision=records[0].decision_id;
          for(const record of records)offers.set(record.decision_id,{record,pageInstance:body.pageInstance});
          assert.equal(rendered.size,mid?7:0); // Fetching a choice did not capture it.
          return reply({ok:true,arm:'personalized',write:false,pageInstance:body.pageInstance,sources:{state:'synthetic-protocol-fixture',consent:{personalized:true}},cell:{stage:mid?'mid':'unknown'},
            decisions:entries.map(([slot,item],i)=>({slot:id(slot),contentId:id(item),order:i,decisionId:records[i].decision_id,renderOffer:'synthetic-offer-'+records[i].decision_id}))});
        }
        return reply({ok:false},503); // Stop before measurement assertions: protocol/cleanup fixture, not fabricated business success.
      }
      if(success&&u.pathname==='/realtime/action'){
        assert.equal(init.headers['X-Shopper-Session'],'signed-capability');assert.equal(body.userId,'issued-subject'+issued);assert.equal(body.sessionId,'issued-session'+issued);assert.ok(body.timestamp);assert.ok(body.eventId);
        if(body.type==='content_impression'){
          const offered=offers.get(body.data.decisionId);assert.ok(offered);assert.equal(body.data.renderOffer,'synthetic-offer-'+offered.record.decision_id);
          assert.equal(body.data.page,ownedPage);assert.equal(body.data.pageInstance,offered.pageInstance);assert.equal(body.data.position,offered.record.position);
          assert.equal(body.data.contentId,offered.record.item_id);assert.equal(body.data.slot,offered.record.slot);
          const row={...offered.record,rendered:{version:1,eventId:body.eventId,at:body.timestamp,pageInstance:body.data.pageInstance}};
          if(rendered.has(row.decision_id)){assert.deepEqual(rendered.get(row.decision_id),row);assert.equal(init.body,renderWires.get(row.decision_id));}
          else{rendered.set(row.decision_id,row);renderWires.set(row.decision_id,init.body);}
          if(!lostRenderAck){lostRenderAck=true;throw Error('Synthetic admitted render ACK loss');}
          return reply({success:true,render:{version:1,decisionId:row.decision_id,eventId:body.eventId,pageInstance:body.data.pageInstance,status:'durable',source:'recovered'}});
        }
        if(body.type==='content_click'&&issued===1){assert.equal(rendered.size,14);const row=rendered.get(body.data.decisionId);assert.ok(row);assert.equal(row.item_id,body.data.contentId);assert.equal(row.slot,body.data.slot);assert.equal(row.position,body.data.position);}
        if(body.type==='product_view')views++;if(body.type==='purchase')credited=true;return reply({success:true});
      }
      if(success&&u.pathname.endsWith('/learn/publish')){const slot=body.slot;assert.ok(ownedSlots.includes(slot));const hero=slot.endsWith('-hero'),item=slot.slice(0,slot.lastIndexOf('-')+1)+(hero?'h-consider':'s-featured');
        return reply({ok:true,snapshot:{measurementBasis:'rendered-v1',objective:hero?'unit':'revenue',items:{[item]:{'*':{s:credited?(hero?1:250):0}}}}});}
      if(success&&u.pathname.endsWith('/lift'))return reply({ok:true});
      if(success&&u.pathname.endsWith('/recent')){assert.equal(init.headers.Authorization,'Bearer operator');const refused=u.pathname.includes('/issued-subject2/');assert.ok(refused||u.pathname.includes('/issued-subject1/'));
        return reply({ring:erased||refused?[]:[...rendered.values()]});}
      if(success&&u.pathname.endsWith('/learn/report'))return reply({report:{counts:{decisions:999,outcomes:888,rows_hidden:777},policies:[{role:'learning'}],
        holdout:Object.fromEntries([...ownedSlots.map(slot=>[slot,[{arm:'personalized',decisions:erased?0:2,credited:erased?0:1}]]),['unrelated-slot',[{arm:'personalized',decisions:123,credited:12}] ]])}});
      if(success&&u.pathname.endsWith('/ledger/erasures')){assert.deepEqual(body,{visitorId:'issued-subject1'});erased=true;return reply({ok:true,ring:'reset'});}
      if(success&&u.pathname.includes('/ledger/')){assert.equal(decodeURIComponent(u.pathname.split('/').at(-1)),heroDecision);assert.equal(erased,true);return reply({ok:false},410);}
      throw Error('Unexpected kit effect '+u.pathname);
    };
    const process={argv:['node','acceptance-run.mjs','--base','https://kit.invalid','--scope','coach','--sdk-key','site','--token','operator'],env:{},exitCode:0,exit(code){this.exitCode=code;throw Error('fixture-exit');}};
    try{await runInNewContext('(async()=>{'+script+'})()', {process,console:{log:(...v)=>logs.push(v.join(' '))},fetch,URL,Response,TextEncoder,TextDecoder,AbortSignal,crypto,setTimeout,clearTimeout,
      structuredClone,isLoopbackTarget:()=>false,tokenFromArgs:()=> 'operator',resolveToolToken:async()=> 'operator'});}catch(error){assert.equal(error.message,'fixture-exit');}
    assert.equal(process.exitCode,success?0:1);assert.equal(snapshot,true);assert.equal(logs.some(line=>line.includes('ENGINEERING CHECKS PASSED')),success);
    assert.ok(docs.catalog.pieces.some(p=>p.id==='acc-pre-existing'));assert.ok(docs.catalog.pieces.some(p=>p.id==='concurrent-legitimate'));
    assert.ok(docs.slots.pages.concurrent);assert.ok(docs.learn.slots.concurrent);assert.ok(!calls.some(c=>c.url.includes('/erasures/rewrite')));
    if(scenario==='clean'||scenario==='lost-ack'||success){assert.equal(put,2);assert.deepEqual(docs.catalog.pieces.map(p=>p.id),['acc-pre-existing','concurrent-legitimate']);}
    else assert.ok(logs.some(line=>line.includes('cleanup incomplete')));
    if(scenario==='lost-ack')assert.equal(calls.filter(c=>c.url.includes('/publication/recover')).length,1);
    if(success){assert.equal(erased,true);assert.equal(issued,2);assert.equal(calls.filter(c=>c.url.endsWith('/ledger/erasures')).length,1);
      assert.equal(lostRenderAck,true);assert.equal(rendered.size,14);assert.equal(renderWires.size,14);
      const impressions=calls.filter(c=>c.body?.type==='content_impression');assert.equal(impressions.length,15);assert.deepEqual(impressions[0].body,impressions[1].body);
      assert.ok(calls.findIndex(c=>c.body?.type==='content_click')>calls.lastIndexOf(impressions.at(-1)));
      assert.ok(logs.some(line=>line.includes('physical erasure sweep and provider/history deletion are not exercised')));}
  }
});

test('W14 customer-kit origin probe executes browser-compatible subprotocols and explicit signed refusal without URL identifiers',async()=>{
  const {runInNewContext}=await import('node:vm'),{EventEmitter}=await import('node:events');
  const shell=await readFile(new URL('./verify-origin.sh',import.meta.url),'utf8'),script=shell.split("<<'JS'\n")[1].split('\nJS')[0].replace(/^import (http|https) from 'node:https?';\n/gm,'');
  const calls=[],logs=[],process={argv:['node','-','https://probe.invalid','https://shop.invalid','site-key','coach'],exitCode:0};let upgraded=false,destroyed=false;
  const fetch=async(input,init={})=>{
    const u=new URL(input);calls.push({url:u.href,init});assert.equal(init.redirect,'error');assert.ok(init.signal);assert.ok(!u.searchParams.has('visitorId')&&!u.searchParams.has('sessionId'));
    if(u.pathname==='/health/ready')return Response.json({ok:true});
    if(init.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'https://shop.invalid','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'content-type,x-sdk-key,x-tenant,x-shopper-session'}});
    if(u.pathname.endsWith('/identity/session'))return Response.json({session:{capability:'signed-capability',subject:'subject',sessionId:'session',grantId:'grant',iat:1,exp:9999999999}});
    const headers=init.headers,body=JSON.parse(init.body);assert.equal(headers['X-Shopper-Session'],'signed-capability');
    if(u.pathname.endsWith('/preferences')){assert.equal(body.trackingConsent,false);assert.equal(body.personalizationEnabled,false);return Response.json({consent:{tracking:false,personalization:false}});}
    if(u.pathname.endsWith('/snapshot')){assert.equal(init.method,'POST');return headers['X-SDK-Key']==='site-key'?Response.json({decisions:[],write:false}):Response.json({ok:false},{status:401});}
    if(u.pathname==='/realtime/action')return Response.json({success:true});throw Error('Unexpected probe');
  };
  const http={request:(url,{headers})=>{
    assert.equal(url.href,'https://probe.invalid/realtime/ws?tenant=coach');assert.equal(headers['X-Shopper-Session'],undefined);assert.equal(headers['X-SDK-Key'],undefined);
    assert.equal(headers['Sec-WebSocket-Protocol'],'shopper-session-v1, signed-capability, sdk-key-v1.c2l0ZS1rZXk');
    const request=new EventEmitter();request.destroy=()=>{destroyed=true;};request.end=()=>queueMicrotask(()=>{upgraded=true;request.emit('upgrade',{statusCode:101},{destroy:()=>{destroyed=true;}});});return request;
  }};
  await runInNewContext('(async()=>{'+script+'})()', {process,console:{log:(...v)=>logs.push(v.join(' '))},fetch,http,https:http,URL,Response,TextEncoder,TextDecoder,AbortSignal,crypto,Buffer,setTimeout,clearTimeout});
  assert.equal(process.exitCode,0);assert.equal(upgraded,true);assert.equal(destroyed,true);assert.ok(logs.some(line=>line.startsWith('CONNECTIVITY PASS')));
  assert.equal(calls.filter(c=>c.url.includes('/snapshot')).length,3);
});
