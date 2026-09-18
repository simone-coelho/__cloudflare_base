import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Module } from 'node:module';
import { dirname, resolve } from 'node:path';

// Same actual-module harness in Node/workerd; only credentials and destinations
// are synthetic. No operational scripts, secret discovery or emitted bundles.
const HARNESS_SOURCE = String.raw`
import { Hono } from 'hono';
import * as jose from 'jose';
import { authRoutes } from '@/routes/auth';
import { configRoutes } from '@/routes/config';
import { memoryStore, d1Store } from '@/auth/store';
import { hashPassword } from '@/auth/accounts';
import { invalidateConfigCache, REFLEX_KIND } from '@/reflex/configStore';
import { initializePublicationSet, readPublication, publicationHistory } from '@/config/publication';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { jwt } from '@/middleware/auth';
import { d1Authority } from '@/auth/authority';
import { operatorJwt } from '@/middleware/operatorAuth';
import { sdkKey, operatorWrites } from '@/middleware/edgeAccess';
import { RateLimiter } from '@/durable-objects/RateLimiter';
const CONFIG={JWT_SECRET:'w0203-focused-synthetic-signing-material',JWT_ISSUER:'w0203',JWT_AUDIENCE:'w0203'};
const PASSWORD='w0203 synthetic password';
export async function run(input){
 invalidateConfigCache();
 const store=memoryStore(),values=new Map(),objects=new Map(),calls=[],bindingReads=[],authSeen=[];
 let bodyReads=0;
 await store.put({id:'fixture-account',email:'operator@example.invalid',name:'Synthetic Operator',
  roles:['admin','operator'],permissions:['read','write'],password_hash:await hashPassword(PASSWORD),
  disabled:false,must_change_password:false});
 const accounts=new Proxy(store,{get(target,key){const value=Reflect.get(target,key);
  return typeof value==='function'?(...args)=>{calls.push('ACCOUNTS.'+String(key));return Reflect.apply(value,target,args)}:value}});
 const cache={
  async get(key,type){calls.push('CACHE.get');const raw=values.get(key);return raw===undefined?null:type==='json'?JSON.parse(raw):type==='stream'?new Response(raw).body:raw},
  async put(key,value){calls.push('CACHE.put');values.set(key,value)},
  async delete(key){calls.push('CACHE.delete');values.delete(key)}
 };
 let objectVersion=0;
 const storage={async get(key){calls.push('STORAGE.get');const row=objects.get(key);return row?{key,etag:row.etag,size:new TextEncoder().encode(row.raw).length,body:new Response(row.raw).body,text:async()=>row.raw}:null},
  async put(key,raw,options){calls.push('STORAGE.put');const old=objects.get(key),condition=options?.onlyIf;
   if((condition?.etagDoesNotMatch==='*'||condition instanceof Headers&&condition.get('If-None-Match')==='*')&&old||condition?.etagMatches!==undefined&&condition.etagMatches!==old?.etag)return null;
   const row={raw,etag:'v'+(++objectVersion)};objects.set(key,row);if(key.endsWith('/head.json')&&JSON.parse(raw).committed&&!JSON.parse(raw).pending)calls.push('STORAGE.commit');return{key,etag:row.etag,size:new TextEncoder().encode(raw).length};},
  async delete(key){calls.push('STORAGE.delete');objects.delete(key)},
  async list({prefix=''}){calls.push('STORAGE.list');return{objects:[...objects.keys()].filter(key=>key.startsWith(prefix)).sort().map(key=>({key})),truncated:false}}};
 const operatorGrants=Object.fromEntries(['fixture-account',...(input.grantedSubjects||[])].map(sub=>[sub,['acme','w0203-focused']]));
 const env=new Proxy({...CONFIG,AUTH_MODE:input.mode||'enforced',SDK_KEYS:'acme:synthetic-sdk',ACCOUNTS:accounts,CACHE:cache,STORAGE:storage,
  RATE_LIMITER:{idFromName:name=>name,get:()=>({fetch:async()=>Response.json({allowed:true,remaining:9,resetTime:Math.floor(Date.now()/60000)*60000+60000})})},
  TENANTS:JSON.stringify({provisioned:['acme','w0203-focused'],operatorGrants}),...input.env},
  {get(target,key){if(['ACCOUNTS','CACHE','DB','STORAGE'].includes(String(key))){bindingReads.push(String(key));if(input.throwBindings)throw new Error('Protected binding touched')}
   return Reflect.get(target,key)}});
 const app=new Hono();
 app.use('*',async(c,next)=>{const original=c.req.json.bind(c.req);c.req.json=(...args)=>{bodyReads++;return original(...args)};
  await next();authSeen.push(c.get('auth')??null)});
 app.route('/auth',authRoutes);
 app.use('/config/*',async(c,next)=>{c.set('tenant','w0203-focused');await next()});
 app.route('/config',configRoutes);
 app.get('/optional',jwt({required:false}),c=>{calls.push('optional.dispatch');return c.json({ok:true})});
 // Middleware-only policy harness: no product route currently supplies permissions.
 app.get('/policy',jwt(input.policy||{}),c=>{calls.push('policy.dispatch');return c.json({ok:true})});
 app.get('/write-policy',jwt({permissions:['write']}),c=>{calls.push('write-policy.dispatch');return c.json({ok:true})});
 for(const path of ['/v1/:tenant/*','/realtime/*','/operator/*'])app.use(path,async(c,next)=>{c.set('tenant','acme');await next()});
 app.use('/v1/:tenant/*',sdkKey());app.use('/realtime/*',sdkKey());app.use('/operator/*',operatorWrites());
 app.get('/v1/:tenant/probe',c=>{calls.push('sdk.dispatch');return c.json({ok:true})});
 app.post('/realtime/probe',c=>{calls.push('realtime.dispatch');return c.json({ok:true})});
 app.post('/operator/probe',c=>{calls.push('operator.dispatch');return c.json({ok:true})});
 const snapshot=()=>JSON.stringify({users:[...store.users],sessions:[...store.sessions],audit:store.log,kv:[...values],r2:[...objects]});
 const issue=(payload,opts={})=>{if(opts.omitExpiry){payload={...payload};delete payload.exp;}
  let t=new jose.SignJWT({type:'service',...payload,...(input.legacy?{type:undefined}:{})}).setProtectedHeader({alg:'HS256'}).setIssuedAt()
  .setIssuer(opts.issuer??CONFIG.JWT_ISSUER).setAudience(opts.audience??CONFIG.JWT_AUDIENCE);
  if(!opts.omitExpiry)t=t.setExpirationTime(opts.expired?Math.floor(Date.now()/1000)-30:'5m');
  if(opts.future)t=t.setNotBefore(Math.floor(Date.now()/1000)+300);
  return t.sign(new TextEncoder().encode(opts.wrongKey?'w0203-wrong-synthetic-signing-material':CONFIG.JWT_SECRET))};
 const send=async(path,method='GET',token,body,headers={})=>{
  const response=await app.request('https://w0203.example.invalid'+path,{method,
   headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},
   ...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})},env);
  const text=await response.text();return{response,data:text?JSON.parse(text):null};
 };
 const tokens={};let config,publication,revision;const setup=[];
 if(input.prepare!==false){
  const login=await send('/auth/login','POST',undefined,{email:'operator@example.invalid',password:PASSWORD});
  setup.push(login.response.status);Object.assign(tokens,login.data);
  await initializePublicationSet(env,[{kind:REFLEX_KIND,scope:'w0203-focused',revision:{revision:1,at:1,actor:'synthetic-fixture',note:'',value:{...DEFAULT_REFLEX_CONFIG,K:3}}}],'0:'+crypto.randomUUID());
  const seed=await send('/config/reflex?scope=w0203-focused','GET',tokens.accessToken);
  setup.push(seed.response.status);config=seed.data.config;publication=seed.data.publication;revision=seed.data.revision;
  const me=await send('/auth/me','GET',tokens.accessToken);setup.push(me.response.status);
  if(setup.join(',')!=='200,200,200'||!me.data.account)throw new Error('Successful fixture control failed: '+setup.join(','));
 }
 if(input.secondSession){const second=await send('/auth/login','POST',undefined,{email:'operator@example.invalid',password:PASSWORD});
  if(second.response.status!==200)throw new Error('Second login failed');tokens.second=second.data.accessToken;tokens.secondRefresh=second.data.refreshToken;}
 const signed=await issue(input.accessPatch?{...jose.decodeJwt(tokens.accessToken),...input.accessPatch}:input.payload??{sub:'fixture-account',roles:['admin'],permissions:['read','write']},input.sign);
 const tokenOf=(which)=>which==='none'?undefined:which==='access'?tokens.accessToken:which==='refresh'?tokens.refreshToken:which==='renewed'?tokens.renewed:tokens[which]??signed;
 calls.length=0;bindingReads.length=0;authSeen.length=0;bodyReads=0;
 const before=snapshot(),results=[];
 for(const op of input.ops){
  env.AUTH_MODE=op.mode??input.mode??'enforced';
  if(op.state){const sid=tokens.accessToken&&jose.decodeJwt(tokens.accessToken).sid;
   if(op.state.dropAccount)store.users.delete('fixture-account');
   if(op.state.account)store.users.set('fixture-account',{...store.users.get('fixture-account'),...op.state.account});
   if(op.state.dropSession)store.sessions.delete(sid);
   if(op.state.session)store.sessions.set(sid,{...store.sessions.get(sid),...op.state.session});
   if(op.state.fail)store[op.state.fail]=async()=>{throw new Error('Synthetic account read unavailable')};}
  const startCalls=calls.length,startBindings=bindingReads.length,startBodies=bodyReads,state=snapshot();
  const body=op.body==='full'?{config:{...config,K:19}}:op.body==='renew'?{refreshToken:tokens.refreshToken}
   :op.body==='replacementRenew'?{refreshToken:tokens.replacementRefresh}:op.body==='secondRenew'?{refreshToken:tokens.secondRefresh}
   :op.body==='changePassword'?{currentPassword:PASSWORD,newPassword:'a new synthetic password'}
   :op.body==='changeResetPassword'?{currentPassword:tokens.temporaryPassword,newPassword:'a new synthetic password'}
   :op.body==='resetLogin'?{email:'operator@example.invalid',password:tokens.temporaryPassword}:op.body;
  const write=op.path.startsWith('/config/')&&['PUT','PATCH','POST'].includes(op.method);
  const headers={...(write&&publication?{'If-Match':'"'+revision+'/'+publication.revision+'/'+publication.digest+'"','Idempotency-Key':revision+':'+crypto.randomUUID()}:{}),...op.headers};
  const {response,data}=await send(op.path,op.method||'GET',tokenOf(op.credential??input.credential),body,headers);
  if(response.ok&&data?.publication){publication=data.publication;revision=data.revision;}
  if(op.path==='/auth/refresh'&&data?.accessToken)tokens.renewed=data.accessToken;
  if(op.path==='/auth/password'&&data?.accessToken){tokens.replacement=data.accessToken;tokens.replacementRefresh=data.refreshToken;}
  if(data?.temporaryPassword)tokens.temporaryPassword=data.temporaryPassword;
  if(op.path==='/auth/login'&&data?.accessToken){tokens.recovered=data.accessToken;tokens.recoveredRefresh=data.refreshToken;}
  results.push({path:op.path,method:op.method||'GET',status:response.status,cacheControl:response.headers.get('Cache-Control'),
   error:data?.error,emptyBody:data===null,accountId:data?.account?.id,userCount:data?.users?.length,
   revision:data?.revision,K:data?.config?.K,hasAccessToken:Boolean(data?.accessToken),
   calls:calls.slice(startCalls),bindingReads:bindingReads.slice(startBindings),bodyReads:bodyReads-startBodies,
   auth:authSeen.at(-1),stateUnchanged:state===snapshot()});
 }
 // Fixture-only final inspection is not an effect of the tested request.
 const retainedCalls=[...calls],retainedBindings=[...bindingReads];
 const inspection={...CONFIG,TENANTS:env.TENANTS,STORAGE:storage,CACHE:cache};
 const current=objects.size?await readPublication(inspection,REFLEX_KIND,'w0203-focused'):null;
 const history=current?await publicationHistory(inspection,REFLEX_KIND,'w0203-focused'):[];
 calls.splice(0,calls.length,...retainedCalls);bindingReads.splice(0,bindingReads.length,...retainedBindings);
 return {setup,results,calls,bindingReads,bodyReads,stateUnchanged:before===snapshot(),
  accountCount:store.users.size,sessionCount:store.sessions.size,audit:store.log.map(e=>({action:e.action,actorId:e.actorId})),
  config:current?{revision:current.revision,K:current.value.K,actor:current.actor,index:history.map(e=>({revision:e.revision,actor:e.actor}))}:null,
  accessShape:tokens.accessToken?jose.decodeJwt(tokens.accessToken):null};
}

// Fixture-only controls wrap native transactions and expose storage/alarm observations.
// All admission and expiry behavior below executes the production RateLimiter class.
export class LoginBudgetFixture extends RateLimiter {
 constructor(state){
  const metrics={put:0,setAlarm:0,delete:0,deleteAlarm:0},fault={next:null};
  const storage=new Proxy(state.storage,{get(target,key){
   if(key==='transaction')return callback=>target.transaction(txn=>callback(new Proxy(txn,{get(t,k){
    const fn=Reflect.get(t,k);if(typeof fn!=='function')return fn;
    return(...args)=>{if(k in metrics){metrics[k]++;if(fault.next===k){fault.next=null;throw new Error('synthetic transaction failure')}}
     return Reflect.apply(fn,t,args)};
   }})));
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  super(new Proxy(state,{get(target,key){return key==='storage'?storage:Reflect.get(target,key)}}));
  this.fixtureStorage=state.storage;this.metrics=metrics;this.fault=fault;
 }
 async fetch(request){
  if(new URL(request.url).pathname!=='/fixture/control')return super.fetch(request);
  const {action,value}=await request.json(),storage=this.fixtureStorage,key='operator-login:v1';
  if(action==='reset'){await storage.delete(key);await storage.deleteAlarm();}
  if(action==='expire') {const current=await storage.get(key);await storage.put(key,{...current,windowStart:Math.floor(Date.now()/60000)*60000-60000});}
  if(action==='corrupt')await storage.put(key,value);
  if(action==='fault')this.fault.next='setAlarm';
  if(action==='alarm') {await storage.deleteAlarm();await super.alarm();}
  if(action==='clearMetrics')for(const name of Object.keys(this.metrics))this.metrics[name]=0;
  return Response.json({entries:[...await storage.list()],alarm:await storage.getAlarm(),metrics:this.metrics});
 }
}
export async function budgetProbe(bindings){
 const namespace=bindings.RATE_LIMITER,stub=namespace.get(namespace.idFromName('operator-login:v1'));
 const control=async(action,value)=>(await stub.fetch('https://fixture.invalid/fixture/control',{
  method:'POST',body:JSON.stringify({action,value})})).json();
 const direct=async(n,body={sourceKey:n.toString(16).padStart(64,'0')},method='POST')=>{
  const r=await stub.fetch('https://fixture.invalid/auth/login-budget',{method,...(method==='POST'?{body:JSON.stringify(body)}:{})});
  return{status:r.status,...(r.status===200?await r.json():{})};
 };
 // Keep the concurrent population within one real clock window, without changing production time.
 const remaining=60000-Date.now()%60000;
 if(remaining<12000)await new Promise(resolve=>setTimeout(resolve,remaining+10));
 const started=Date.now();
 await control('reset');
 const same=await Promise.all(Array.from({length:25},()=>direct(1)));
 const sameState=await control('inspect');await control('clearMetrics');
 const denial=await direct(1),afterDenial=await control('inspect');
 const malformed=await direct(1,{sourceKey:'raw source'}),wrongMethod=await direct(1,undefined,'GET');
 await control('reset');
 const many=await Promise.all(Array.from({length:125},(_,i)=>direct(i+1)));
 const manyState=await control('inspect');await control('clearMetrics');
 const globalDenial=await direct(999),afterGlobalDenial=await control('inspect');
 const stale=await control('alarm');
 await control('expire');
 const resetAdmission=await direct(999),resetState=await control('inspect');
 // Generic windows survive auth expiry; no generic request semantics were changed.
 const generic=await stub.fetch('https://fixture.invalid/generic',{method:'POST',body:JSON.stringify({limit:5,window:60})});
 await control('expire');const expired=await control('alarm');
 const malformedStates=[];
 for(const value of [{windowStart:Math.floor(Date.now()/60000)*60000,count:101,sources:{}},
  {windowStart:Math.floor(Date.now()/60000)*60000,count:1,sources:{}},
  {windowStart:Math.floor(Date.now()/60000)*60000+60000,count:1,sources:{['1'.padStart(64,'0')]:1}}]){
  await control('corrupt',value);await control('clearMetrics');
  malformedStates.push({response:await direct(1),state:await control('inspect')});
 }
 await control('reset');await control('fault');
 const fault=await direct(1),faultState=await control('inspect');

 const store=memoryStore(),calls=[];
 await store.put({id:'budget-operator',email:'operator@example.invalid',name:'Synthetic Budget Operator',roles:['admin'],permissions:['*'],
  password_hash:await hashPassword(PASSWORD),disabled:false,must_change_password:false});
 const accounts=new Proxy(store,{get(target,key){const fn=Reflect.get(target,key);
  return typeof fn==='function'?(...args)=>{calls.push('ACCOUNTS.'+String(key));return Reflect.apply(fn,target,args)}:fn}});
 const env={...CONFIG,AUTH_MODE:'enforced',ACCOUNTS:accounts,CACHE:{get:async()=>{calls.push('CACHE.get');return null}},RATE_LIMITER:namespace};
 const app=new Hono();app.route('/auth',authRoutes);
 const send=async(path,body,source,token)=>{
  const response=await app.request('https://fixture.invalid/auth/'+path,{method:'POST',body:JSON.stringify(body),headers:{
   ...(source?{'CF-Connecting-IP':source}:{}),...(token?{Authorization:'Bearer '+token}:{})}},env);
  return{status:response.status,data:await response.json()};
 };
 await control('reset');
 const attempts=[];
 for(let i=0;i<10;i++)attempts.push((await send('login',{email:'operator@example.invalid',password:'wrong synthetic password'},'192.0.2.1')).status);
 const blocked=await send('login',{email:'operator@example.invalid',password:PASSWORD},'192.0.2.1');
 const beforeGood={audit:store.log.length,sessions:store.sessions.size};
 const good=await send('login',{email:'operator@example.invalid',password:PASSWORD},'192.0.2.2');
 const fill=await Promise.all(Array.from({length:101},(_,i)=>direct(i+1000)));
 calls.length=0;let bodyReads=0;
 const stream=new ReadableStream({pull(controller){bodyReads++;controller.enqueue(new TextEncoder().encode('{'));controller.close()}},{highWaterMark:0});
 const denied=await app.fetch(new Request('https://fixture.invalid/auth/login',{method:'POST',body:stream,duplex:'half'}),env);
 const deniedEffects={status:denied.status,bodyReads,calls:[...calls],audit:store.log.map(e=>e.action)};
 const recoveryBefore=await control('inspect');
 const refresh=await send('refresh',{refreshToken:good.data.refreshToken});
 const password=await send('password',{currentPassword:PASSWORD,newPassword:'new synthetic budget password'},undefined,good.data.accessToken);
 const logout=await send('logout',{},undefined,password.data.accessToken);
 const recoveryAfter=await control('inspect');
 await control('expire');
 const recovered=await send('login',{email:'operator@example.invalid',password:'new synthetic budget password'},'192.0.2.1');
 // A native transactional storage fault is a 503 before body/account work at the route.
 await control('reset');await control('fault');calls.length=0;bodyReads=0;
 const faultStream=new ReadableStream({pull(controller){bodyReads++;controller.close()}},{highWaterMark:0});
 const unavailable=await app.fetch(new Request('https://fixture.invalid/auth/login',{method:'POST',body:faultStream,duplex:'half'}),env);
 const unavailableEffects={status:unavailable.status,bodyReads,calls:[...calls]};
 await control('reset');
 return{same,sameState,denial,afterDenial,malformed,wrongMethod,many,manyState,globalDenial,afterGlobalDenial,stale,resetAdmission,resetState,
  genericStatus:generic.status,expired,malformedStates,fault,faultState,attempts,blocked:blocked.status,beforeGood,good:good.status,
  fill:fill.filter(r=>r.allowed).length,deniedEffects,recovery:[refresh.status,password.status,logout.status],recoveryBefore,recoveryAfter,
  recovered:recovered.status,unavailableEffects,elapsedMs:Date.now()-started};
}

// W02.08 uses a separate native database so earlier missing-schema assertions
// keep their original fixtures and remain meaningful.
export async function authorityProbe(bindings){
 const db=bindings.DB,accounts=d1Store(db),authority=d1Authority(db),checks=[],now=Date.now();
 const assert=(ok,label)=>{if(!ok)throw new Error('W02.08 native: '+label);checks.push(label)};
 const password='W0208 synthetic human password',hash=await hashPassword(password);
 for(const id of ['owner','tenant-admin','shared','other'])await accounts.create({id,email:id+'@example.invalid',name:id,
  roles:['admin'],permissions:['*'],password_hash:hash,must_change_password:false,disabled:false,createdAt:now,updatedAt:now});
 const env={...CONFIG,DEPLOYMENT_PROFILE:'customer',AUTH_MODE:'enforced',DB:db,STAMP_OWNER_SUBJECTS:'["owner"]',
  TENANTS:JSON.stringify({provisioned:['acme','globex'],operatorGrants:{'tenant-admin':['acme','globex'],shared:['acme','globex']}}),
  CACHE:{get:async()=>null,delete:async()=>{}},RATE_LIMITER:{idFromName:n=>n,get:()=>({fetch:async()=>Response.json({allowed:true,remaining:9,resetTime:Math.floor(Date.now()/60000)*60000+60000})})}};
 let effects=0;
 const app=new Hono();app.use('*',async(c,next)=>{c.set('tenant',c.req.header('X-Tenant')||'acme');await next()});app.route('/auth',authRoutes);
 app.get('/product',operatorJwt(),c=>{effects++;return c.json({role:c.get('auth').user.roles[0]})});
 const send=async(path,method='GET',token,body,tenant='acme',revision)=>{
  const r=await app.request('https://fixture.invalid'+path,{method,headers:{'Content-Type':'application/json','X-Tenant':tenant,
   ...(token?{Authorization:'Bearer '+token}:{}),...(revision?{'If-Match':JSON.stringify(revision)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
  return{status:r.status,data:await r.json().catch(()=>({}))};
 };
 const login=async(id,p=password)=>send('/auth/login','POST',undefined,{email:id+'@example.invalid',password:p});
 let owner=(await login('owner')).data.accessToken;
 const admin=(await login('tenant-admin')).data.accessToken,shared=(await login('shared')).data.accessToken;
 const state=async()=>JSON.stringify(await Promise.all(['operator_accounts','operator_sessions','operator_audit','operator_memberships','operator_service_credentials','operator_recovery_requests']
  .map(async t=>(await db.prepare('SELECT * FROM '+t+' ORDER BY 1').all()).results)));
 const assign=async(id,tenant,role='operator')=>send('/auth/memberships','POST',owner,{accountId:id,role},tenant);
 assert((await assign('tenant-admin','acme','admin')).status===201,'owner-bootstrap-membership');
 assert((await assign('shared','acme')).status===201&&(await assign('shared','globex')).status===201,'shared-two-memberships');
 assert((await send('/product','GET',shared)).data.role==='operator','native-current-tenant-role-not-global-admin');
 const initialEffects=effects;
 assert((await send('/product','GET',admin,undefined,'globex')).status===403&&effects===initialEffects,'static-grant-cannot-bypass-current-membership');
 assert((await send('/product','GET',owner)).status===403&&effects===initialEffects,'owner-config-is-not-product-grant');
 let before=await state();
 for(const [path,method,body] of [['/auth/users/shared/reset','POST',{}],['/auth/users/shared','DELETE'],['/auth/users/shared','PATCH',{disabled:true}],['/auth/users','POST',{email:'new@example.invalid',name:'New'}]])
  assert((await send(path,method,admin,body)).status===403,'tenant-admin-no-global-'+method+path);
 assert(await state()===before,'global-refusals-zero-effects');
 assert((await send('/auth/memberships','GET',admin,undefined,'globex')).status===403,'cross-tenant-membership-list-refused');
 const member=await authority.member('shared','acme');
 assert((await send('/auth/memberships/shared','PATCH',admin,{role:'admin'},'acme',member.revision)).status===200,'tenant-promotion');
 assert((await send('/product','GET',shared)).data.role==='admin','current-role-on-existing-session');
 const promoted=await authority.member('shared','acme');
 const globalBefore=JSON.stringify(await accounts.getById('shared')),sessionBefore=JSON.stringify((await db.prepare("SELECT * FROM operator_sessions WHERE account_id='shared'").all()).results);
 assert((await send('/auth/memberships/shared','DELETE',admin,undefined,'acme',promoted.revision)).status===200,'membership-remove');
 assert((await send('/product','GET',shared)).status===403&&(await send('/product','GET',shared,undefined,'globex')).status===200,'remove-one-tenant-only');
 assert(JSON.stringify(await accounts.getById('shared'))===globalBefore&&JSON.stringify((await db.prepare("SELECT * FROM operator_sessions WHERE account_id='shared'").all()).results)===sessionBefore,'membership-does-not-change-global-account-or-session');
 const ownerActor={id:'owner',sid:jose.decodeJwt(owner).sid,accountRevision:(await accounts.getById('owner')).updatedAt,owner:true,tenant:'acme'};
 const staleCreate={accountId:'shared',tenant:'acme',role:'operator',disabled:false,removed:false,revision:crypto.randomUUID(),updatedAt:now};
 before=await state();assert(!await authority.changeMember(null,staleCreate,ownerActor,Date.now())&&await state()===before,'removed-generation-blocks-delayed-create');
 const removed=await authority.member('shared','acme');
 assert((await send('/auth/memberships/shared','PATCH',admin,{regrant:true},'acme',removed.revision)).status===200,'explicit-current-generation-regrant');
 assert((await send('/auth/memberships/shared','PATCH',admin,{role:'operator'},'acme',promoted.revision)).status===409,'stale-membership-revision-refused');
 const fresh=await authority.member('shared','acme');
 const actorSnapshot={id:'tenant-admin',sid:jose.decodeJwt(admin).sid,accountRevision:(await accounts.getById('tenant-admin')).updatedAt,owner:false,tenant:'acme',membershipRevision:(await authority.member('tenant-admin','acme')).revision};
 const am=await authority.member('tenant-admin','acme');
 assert(await authority.changeMember(am,{...am,role:'operator',revision:crypto.randomUUID()},ownerActor,Date.now()),'owner-demotes-tenant-admin');
 before=await state();assert(!await authority.changeMember(fresh,{...fresh,disabled:true,revision:crypto.randomUUID()},actorSnapshot,Date.now())&&await state()===before,'stale-tenant-admin-cannot-commit');

 const expiresAt=Math.floor(Date.now()/1000)+600,id=crypto.randomUUID();
 before=await state();
 assert((await send('/auth/service-credentials','POST',owner,{id:crypto.randomUUID(),subject:'invalid-expiry',expiresAt:Number.MAX_SAFE_INTEGER+1})).status===400&&await state()===before,'unsafe-service-expiry-no-write');
 const issued=await send('/auth/service-credentials','POST',owner,{id,subject:'machine-one',role:'operator',expiresAt});
 assert(issued.status===201&&issued.data.token&&!('tokenHash' in issued.data.credential),'native-service-issue-no-hash-disclosure');
 const token=issued.data.token,row=await authority.credential(id);
 assert(row.tokenHash.length===43&&(await send('/product','GET',token)).status===200,'native-base64url-registry-positive');
 const serviceEffects=effects;
 assert((await send('/product','GET',token,undefined,'globex')).status===403&&effects===serviceEffects,'service-exact-tenant-before-effects');
 assert((await send('/auth/users','GET',token)).status===401,'service-cannot-become-human-owner');
 await send('/auth/logout','POST',owner,{});
 assert((await send('/product','GET',token)).status===200,'service-independent-of-human-logout');
 owner=(await login('owner')).data.accessToken;
 const currentOwner={...ownerActor,sid:jose.decodeJwt(owner).sid,accountRevision:(await accounts.getById('owner')).updatedAt};
 const secondId=crypto.randomUUID(),second=await send('/auth/service-credentials','POST',owner,{id:secondId,subject:'machine-two',role:'operator',expiresAt});
 const secondRow=await authority.credential(secondId);
 before=await state();
 for(const actor of [currentOwner,{...currentOwner,sid:'missing'}]){
  let failed=false;try{await authority.issue(secondRow,actor,row)}catch{failed=true}
  assert(failed&&await state()===before,'replacement-existing-id-aborts-before-old-revocation-'+actor.sid.includes('missing'));
 }
 const replacementId=crypto.randomUUID(),replacement=await send('/auth/service-credentials','POST',owner,{id:replacementId,subject:'machine-one',role:'operator',expiresAt,replaces:id});
 assert(replacement.status===201&&(await send('/product','GET',token)).status===401&&(await send('/product','GET',replacement.data.token)).status===200,'atomic-service-replacement');
 before=await state();assert((await send('/auth/service-credentials','POST',owner,{id:crypto.randomUUID(),subject:'machine-one',expiresAt,replaces:id})).status===409&&await state()===before,'retired-service-not-revivable');
 assert((await send('/auth/service-credentials/'+replacementId,'DELETE',owner)).status===200&&(await send('/product','GET',replacement.data.token)).status===401,'individual-service-revocation');
 assert((await send('/product','GET',second.data.token)).status===200,'sibling-service-retained');
 const forged=await new jose.SignJWT({type:'service',sub:'machine-two',roles:['admin']}).setProtectedHeader({alg:'HS256'}).setJti(secondId).setIssuer(CONFIG.JWT_ISSUER).setAudience(CONFIG.JWT_AUDIENCE).setExpirationTime(expiresAt).sign(new TextEncoder().encode(CONFIG.JWT_SECRET));
 assert((await send('/product','GET',forged)).status===401,'registered-token-hash-binds-claims');
 const oldEffects=effects;env.JWT_SECRET='development-secret-key-change-in-production';
 before=await state();assert((await send('/product','GET',second.data.token)).status===503&&await state()===before&&effects===oldEffects,'unsafe-key-no-effects');
 env.JWT_SECRET='w0208-native-replacement-signing-material';
 assert((await send('/product','GET',second.data.token)).status===401&&(await send('/auth/me','GET',owner)).status===401,'new-key-rejects-old-human-and-service');
 owner=(await login('owner')).data.accessToken;
 assert((await send('/auth/users','GET',owner)).status===200,'existing-owner-password-recovers-after-key-change');
 const rotated=await send('/auth/service-credentials','POST',owner,{id:crypto.randomUUID(),subject:'machine-two',expiresAt,replaces:secondId});
 assert(rotated.status===201&&(await send('/product','GET',rotated.data.token)).status===200,'registered-tool-recovers-under-new-key');

 const current={id:'owner',sid:jose.decodeJwt(owner).sid,accountRevision:(await accounts.getById('owner')).updatedAt,owner:true,tenant:'acme'};
 const faultDb=after=>({prepare:sql=>db.prepare(sql),batch:stmts=>{const next=[...stmts];next.splice(after,0,db.prepare("INSERT INTO operator_sessions(jti,account_id,token_hash,created_at,expires_at) VALUES ('fault',NULL,'',0,0)"));return db.batch(next)}});
 for(const after of [0,1,2]){
  const m=await authority.member('shared','acme');before=await state();let failed=false;
  try{await d1Authority(faultDb(after)).changeMember(m,{...m,role:'operator',revision:crypto.randomUUID()},current,Date.now())}catch{failed=true}
  assert(failed&&await state()===before,'membership-native-rollback-'+after);
 }
 const active=await authority.credential(rotated.data.credential.id);
 for(const after of [0,1,2,3]){
  before=await state();let failed=false;try{await d1Authority(faultDb(after)).issue({...active,id:crypto.randomUUID(),createdAt:Date.now()},current,active)}catch{failed=true}
  assert(failed&&await state()===before,'replacement-native-rollback-'+after);
 }
 const target=await accounts.getById('other'),staleActor={id:'owner',sid:current.sid,accountRevision:current.accountRevision};
 await accounts.revokeSessions('owner');before=await state();
 assert(!await accounts.create({...target,id:'stale-owner-create',email:'stale@example.invalid'},staleActor),'stale-owner-create-refused');
 for(const operation of [()=>accounts.patchAccount(target,{disabled:true},Date.now(),staleActor),()=>accounts.resetPassword(target,hash,Date.now(),staleActor),()=>accounts.removeAccount(target,{at:Date.now(),actorId:'owner'},staleActor)]){
  let failed=false;try{await operation()}catch{failed=true}assert(failed&&await state()===before,'stale-owner-native-transaction-refused');
 }

 // Maintenance is one real INSERT/trigger; later exact replay must not fire it.
 const ownerRow=await accounts.getById('owner'),op=crypto.randomUUID(),attempt=crypto.randomUUID(),recoveryHash=await hashPassword('W0208 recovered owner password');
 const insert=(operation=op,email=ownerRow.email,revision=ownerRow.updatedAt)=>db.prepare('INSERT INTO operator_recovery_requests VALUES (?,?,?,?,?,?,?,?,?)')
  .bind(operation,attempt,'synthetic-native-target','owner',email,revision,recoveryHash,'temporary-password+enable',Date.now());
 for(const stage of ['account','session','audit']){
  await db.prepare(stage==='account'?"CREATE TRIGGER fixture_fault BEFORE UPDATE ON operator_accounts BEGIN SELECT RAISE(ABORT,'fixture fault'); END":stage==='session'?"CREATE TRIGGER fixture_fault BEFORE DELETE ON operator_sessions BEGIN SELECT RAISE(ABORT,'fixture fault'); END":"CREATE TRIGGER fixture_fault BEFORE INSERT ON operator_audit BEGIN SELECT RAISE(ABORT,'fixture fault'); END").run();
  if(stage==='session')await db.prepare('INSERT INTO operator_sessions(jti,account_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)').bind('recovery-native-session','owner','synthetic',now,now+600000).run();
  before=await state();let failed=false;try{await insert().run()}catch{failed=true}
  assert(failed&&await state()===before,'recovery-trigger-rollback-'+stage);await db.prepare('DROP TRIGGER fixture_fault').run();
 }
 before=await state();for(const statement of [insert(crypto.randomUUID(),'wrong@example.invalid'),insert(crypto.randomUUID(),ownerRow.email,0)]){
  let failed=false;try{await statement.run()}catch{failed=true}assert(failed&&await state()===before,'recovery-exact-target-revision');
 }
 await insert().run();
 const recovery=await login('owner','W0208 recovered owner password');assert(recovery.status===200&&recovery.data.mustChangePassword,'native-owner-recovery-restricted-login');
 assert((await send('/auth/users','GET',recovery.data.accessToken)).status===403,'recovered-owner-must-change-password');
 const changed=await send('/auth/password','POST',recovery.data.accessToken,{currentPassword:'W0208 recovered owner password',newPassword:'W0208 final synthetic password'});
 assert(changed.status===200&&(await send('/auth/users','GET',changed.data.accessToken)).status===200,'native-owner-recovery-completes');
 before=await state();let duplicate=false;try{await insert().run()}catch{duplicate=true}
 assert(duplicate&&await state()===before,'duplicate-insert-never-replays-trigger');
 // Removed memberships and revoked credentials remain bounded/reconcilable,
 // including the first row beyond two complete pages; nothing is discarded.
 const memberIds=Array.from({length:201},(_,i)=>'page-'+String(i).padStart(3,'0'));
 await db.prepare('INSERT INTO operator_accounts (id,email,name,roles,permissions,password_hash,must_change_password,disabled,created_at,updated_at) SELECT value,value||\'@example.invalid\',value,\'["operator"]\',\'["read"]\',?,0,0,?,? FROM json_each(?)').bind(hash,now,now,JSON.stringify(memberIds)).run();
 await db.prepare("INSERT INTO operator_memberships (account_id,tenant,role,disabled,removed,revision,updated_at) SELECT value,'pages','operator',1,1,value,? FROM json_each(?)").bind(now,JSON.stringify(memberIds)).run();
 const serviceIds=Array.from({length:201},()=>crypto.randomUUID());
 await db.prepare("INSERT INTO operator_service_credentials SELECT value,'page-machine','pages','operator',?,?,?,'owner',? FROM json_each(?)").bind('a'.repeat(43),expiresAt,now,now,JSON.stringify(serviceIds)).run();
 for(const kind of ['members','credentials']){
  const seen=[],lengths=[];let cursor;
  do{const page=await authority[kind]('pages',cursor);lengths.push(page.items.length);seen.push(...page.items.map(r=>r.accountId??r.id));cursor=page.next}while(cursor);
  assert(lengths.join(',')==='100,100,1'&&new Set(seen).size===201,'retained-'+kind+'-bounded-continuation-201');
 }
 return{checks,effects};
}

// One bounded native D1 exercise, using production routes/store and migration0010.
// Faults are SQL constraint failures inside native batches, never fake success.
export async function d1LifecycleProbe(bindings){
 const db=bindings.DB,store=d1Store(db),now=Date.now(),checks=[];
 const assert=(ok,label)=>{if(!ok)throw new Error('W02.06 native: '+label);checks.push(label)};
 // Native D1 metadata contains timings, so compare persisted rows only.
 const state=async()=>JSON.stringify(await Promise.all(['operator_accounts','operator_sessions','operator_audit']
  .map(async table=>(await db.prepare('SELECT * FROM '+table+' ORDER BY 1').all()).results)));
 const s=()=>({jti:crypto.randomUUID(),accountId:'native-target',tokenHash:'synthetic-'+crypto.randomUUID(),createdAt:Date.now(),expiresAt:Date.now()+600000});
 const password='native initial password',hash=await hashPassword(password);
 const initial={id:'native-target',email:'target@example.invalid',name:'Native Target',roles:['admin'],permissions:['*'],
  password_hash:hash,must_change_password:false,disabled:false,createdAt:now,updatedAt:now};
 assert(await store.create(initial),'create');
 assert(await store.create({...initial,id:'native-admin',email:'admin@example.invalid'}),'create-admin');
 const env={...CONFIG,AUTH_MODE:'open',DB:db,CACHE:{get:async()=>null,delete:async()=>{}},
  RATE_LIMITER:{idFromName:name=>name,get:()=>({fetch:async()=>Response.json({allowed:true,remaining:9,resetTime:Math.floor(Date.now()/60000)*60000+60000})})}};
 const send=async(path,body,token,method='POST',custom=env)=>{
  const r=await authRoutes.request('https://fixture.invalid'+path,{method,headers:{'Content-Type':'application/json',
   ...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})},custom);
  const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={}}
  return{status:r.status,data};
 };
 const login=await send('/login',{email:initial.email,password}),admin=await send('/login',{email:'admin@example.invalid',password});
 assert(login.status===200&&admin.status===200,'route-login');
 const sourceSid=jose.decodeJwt(login.data.accessToken).sid;
 let expected=await store.getById(initial.id),before=await state();
 assert(!await store.create({...initial,email:'other@example.invalid'})&&!await store.create({...initial,id:'other-id'}),'create-conflicts');
 assert(await state()===before,'create-conflicts-zero-effect');
 const collisionEnv={...env,CACHE:{get:async key=>key==='user:legacy@example.invalid'?{
  ...initial,email:'legacy@example.invalid',password_hash:undefined,password}:null,delete:async()=>{throw new Error('unexpected legacy cleanup')}}};
 const migration=await send('/login',{email:'legacy@example.invalid',password},undefined,'POST',collisionEnv);
 assert(migration.status===409&&!migration.data.accessToken&&await state()===before,'legacy-id-conflict-zero-effect');
 assert(await store.completeSignIn(expected,s(),Date.now())&&await store.completeSignIn(expected,s(),Date.now()),'independent-logins');
 assert((await store.getById(initial.id)).updatedAt===expected.updatedAt,'login-preserves-security-revision');
 for(const [column,value,original] of [['disabled',1,0],['roles','["operator"]','["admin"]'],['permissions','[]','["*"]'],['password_hash','synthetic-other-hash',hash]]){
  await db.prepare('UPDATE operator_accounts SET '+column+' = ? WHERE id = ?').bind(value,initial.id).run();
  before=await state();
  assert(!await store.completeSignIn(expected,s(),Date.now())&&!await store.replacePassword(expected,sourceSid,'synthetic-loser',s(),Date.now())
   &&!await store.patchAccount(expected,{name:'Stale Name'},Date.now())&&!await store.resetPassword(expected,'synthetic-reset',Date.now())
   &&!await store.removeAccount(expected,{at:now,actorId:'native-admin'}),'same-revision-refusal-'+column);
  assert(await state()===before,'same-revision-zero-effect-'+column);
  await db.prepare('UPDATE operator_accounts SET '+column+' = ? WHERE id = ?').bind(original,initial.id).run();
 }
 before=await state();
 assert(!await store.replacePassword(expected,'missing-source','synthetic-loser',s(),Date.now()),'missing-source');
 assert(!await store.replacePassword(expected,sourceSid,'synthetic-loser',{...s(),accountId:'native-admin'},Date.now()),'wrong-account');
 const source=await store.getSession(sourceSid);
 await db.prepare('UPDATE operator_sessions SET expires_at = 0 WHERE jti = ?').bind(sourceSid).run();
 const expired=await state();
 assert(!await store.replacePassword(expected,sourceSid,'synthetic-loser',s(),Date.now())&&await state()===expired,'expired-source-zero-effect');
 await db.prepare('UPDATE operator_sessions SET expires_at = ? WHERE jti = ?').bind(source.expiresAt,sourceSid).run();
 assert(await state()===before,'source-fixture-restored');
 const faultDb=after=>({prepare:sql=>db.prepare(sql),batch:stmts=>{
  const next=[...stmts];next.splice(after,0,db.prepare("INSERT INTO operator_sessions (jti,account_id,token_hash,created_at,expires_at) VALUES ('synthetic-fault',NULL,'synthetic',0,0)"));
  return db.batch(next);
 }});
 const failures=[['login',1,t=>t.completeSignIn(expected,s(),Date.now())],
  ...[1,2,3].map(after=>['password-'+after,after,t=>t.replacePassword(expected,sourceSid,'synthetic-new-hash',s(),Date.now())]),
  ['patch',1,t=>t.patchAccount(expected,{disabled:true},Date.now())],['reset',1,t=>t.resetPassword(expected,'synthetic-new-hash',Date.now())],
  ['delete',1,t=>t.removeAccount(expected,{at:now,actorId:'native-admin'})],['logout',1,t=>t.revokeSessions(initial.id)]];
 for(const [label,after,operation] of failures){
  before=await state();let failed=false;try{await operation(d1Store(faultDb(after)))}catch{failed=true}
  assert(failed&&await state()===before,'rollback-'+label);
 }
 for(const [path,body,token] of [['/login',{email:initial.email,password}],['/password',{currentPassword:password,newPassword:'native losing password'},login.data.accessToken]]){
  before=await state();const result=await send(path,body,token,'POST',{...env,DB:faultDb(1)});
  assert(result.status>=400&&!result.data.accessToken&&!result.data.refreshToken&&await state()===before,'route-rollback'+path);
 }
 const current=await store.getById(initial.id),fresh=s();
 assert(await store.completeSignIn(current,fresh,Date.now()),'retry-after-rollback');
 before=await state();let duplicate=false;try{await store.completeSignIn(current,fresh,Date.now())}catch{duplicate=true}
 assert(duplicate&&await state()===before,'duplicate-jti-zero-effect');
 const winning=await send('/password',{currentPassword:password,newPassword:'native winning password'},login.data.accessToken);
 assert(winning.status===200,'route-password');
 const replacement=await store.getSession(jose.decodeJwt(winning.data.accessToken).sid);
 assert((await db.prepare('SELECT COUNT(*) n FROM operator_sessions WHERE account_id = ?').bind(initial.id).first()).n===1,'one-replacement');
 expected=await store.getById(initial.id);
 assert(await store.completeSignIn(expected,s(),Date.now()),'post-password-independent-login');
 before=await state();
 assert(!await store.replacePassword(current,sourceSid,'synthetic-losing-hash',s(),Date.now()),'password-loser');
 duplicate=false;try{await store.replacePassword(current,sourceSid,'synthetic-losing-hash',replacement,Date.now())}catch{duplicate=true}
 assert(duplicate&&await state()===before,'stale-duplicate-jti-zero-effect');
 assert((await send('/me',undefined,login.data.accessToken,'GET')).status===401,'old-access-refused');
 assert((await send('/refresh',{refreshToken:winning.data.refreshToken})).status===200,'winner-renewable');
 assert((await send('/login',{email:initial.email,password:'native winning password'})).status===200,'winner-password-relogin');
 const reset=await send('/users/'+initial.id+'/reset',{},admin.data.accessToken);
 assert(reset.status===200,'route-reset');
 const restricted=await send('/login',{email:initial.email,password:reset.data.temporaryPassword});
 assert(restricted.status===200&&restricted.data.mustChangePassword,'restricted-onboarding');
 assert((await send('/users',undefined,restricted.data.accessToken,'GET')).status===403,'onboarding-admin-refused');
 const recovered=await send('/password',{currentPassword:reset.data.temporaryPassword,newPassword:'native recovered password'},restricted.data.accessToken);
 assert(recovered.status===200&&(await send('/refresh',{refreshToken:recovered.data.refreshToken})).status===200,'onboarding-recovery');
 const demote=await send('/users/'+initial.id,{roles:['operator']},admin.data.accessToken,'PATCH');
 assert(demote.status===200&&(await send('/me',undefined,recovered.data.accessToken,'GET')).status===401,'demotion-revokes');
 const again=await send('/login',{email:initial.email,password:'native recovered password'});
 assert(again.status===200&&again.data.user.roles.join(',')==='operator','demotion-relogin');
 expected=await store.getById(initial.id);
 assert((await send('/logout',{},again.data.accessToken)).status===200,'route-logout');
 before=await state();
 assert(!await store.completeSignIn(expected,s(),Date.now())&&!await store.replacePassword(expected,jose.decodeJwt(again.data.accessToken).sid,'synthetic-loser',s(),Date.now())
  &&await state()===before,'logout-stale-zero-effect');
 assert((await store.getById(initial.id)).updatedAt>expected.updatedAt,'logout-monotonic-revision');
 expected=await store.getById(initial.id);
 assert((await send('/users/'+initial.id,undefined,admin.data.accessToken,'DELETE')).status===200,'route-delete');
 before=await state();
 assert(!await store.completeSignIn(expected,s(),Date.now())&&!await store.patchAccount(expected,{name:'Resurrected'},Date.now())
  &&await state()===before,'deleted-account-not-recreated');
 // W02.07: the existing native database also proves durable import exclusion,
 // atomic removal audit and explicit fresh-identity recovery with retained KV.
 const barrierStarted=Date.now(),barrierStart=checks.length;
 const removalActor={at:now,actorId:'native-admin',actorEmail:'admin@example.invalid'};
 before=await state();
 for(const retired of [expected,{...expected,id:'different-retired-id',email:expected.email.toUpperCase()},
  {...expected,email:'different-retired@example.invalid'}]){
  assert(await store.hasRemoval(retired)&&!await store.importLegacy(retired),'retired-id-or-email-blocked');
 }
 assert(await state()===before,'retired-imports-zero-effect');
 const recorded=(await db.prepare("SELECT * FROM operator_audit WHERE action = 'account_removed' AND target_id = ?").bind(initial.id).all()).results;
 assert(recorded.length===1&&recorded[0].actor_id==='native-admin'&&recorded[0].actor_email==='admin@example.invalid'
  &&recorded[0].target_email===initial.email&&Number.isFinite(recorded[0].at),'one-atomic-actor-removal');
 await store.audit({at:now-10000,action:'account_removed',targetId:'historic-retired',targetEmail:'historic@example.invalid'});
 before=await state();
 assert(!await store.importLegacy({...initial,id:'historic-retired',email:'different-historic@example.invalid'})
  &&!await store.importLegacy({...initial,id:'different-historic',email:'HISTORIC@EXAMPLE.INVALID'})
  &&await state()===before,'retained-historical-removal-blocks');
 const legacy={...initial,id:'native-legacy',email:'legacy-first@example.invalid'};
 let cleanupFailures=0;
 const legacyEnv={...env,CACHE:{get:async key=>key==='user:'+legacy.email?legacy:null,
  delete:async()=>{cleanupFailures++;throw new Error('synthetic retained KV')}}};
 before=await state();
 const unmigrated=await send('/users',{email:legacy.email,name:'Duplicate Legacy'},admin.data.accessToken,'POST',legacyEnv);
 assert(unmigrated.status===409&&await state()===before,'unmigrated-admin-conflict');
 await store.audit({at:now-5000,action:'sign_in_failed',targetId:legacy.id,targetEmail:legacy.email});
 assert(!await store.hasRemoval(legacy),'non-removal-history-allows-import');
 const firstImport=await send('/login',{email:legacy.email,password},undefined,'POST',legacyEnv);
 assert(firstImport.status===200&&cleanupFailures===2,'first-legacy-import-with-failed-cleanup');
 let legacyExpected=await store.getById(legacy.id);
 assert(await store.patchAccount(legacyExpected,{name:'Current Legacy'},Date.now()),'legacy-current-revision');
 before=await state();
 assert(!await store.removeAccount(legacyExpected,removalActor)&&await state()===before
  &&!await store.hasRemoval(legacyExpected),'stale-delete-no-false-barrier');
 legacyExpected=await store.getById(legacy.id);
 const removalFailures=[0,1,2,3];
 for(const after of removalFailures){
  before=await state();let failed=false;
  try{await d1Store(faultDb(after)).removeAccount(legacyExpected,removalActor)}catch{failed=true}
  assert(failed&&await state()===before&&!await store.hasRemoval(legacyExpected),'removal-rollback-stage-'+after);
 }
 assert(await store.removeAccount(legacyExpected,removalActor),'removal-retry-commits');
 before=await state();
 assert(!await store.removeAccount(legacyExpected,removalActor)&&await state()===before,'repeated-delete-no-extra-barrier');
 const blocked=await send('/login',{email:legacy.email,password},undefined,'POST',legacyEnv);
 assert(blocked.status===409&&!blocked.data.accessToken&&!blocked.data.refreshToken&&await state()===before,'native-retained-kv-zero-effect');
 assert((await send('/me',undefined,firstImport.data.accessToken,'GET')).status===401
  &&(await send('/refresh',{refreshToken:firstImport.data.refreshToken})).status===401,'retired-session-refused');
 const recreated=await send('/users',{email:legacy.email.toUpperCase(),name:'Recovered Legacy'},admin.data.accessToken,'POST',legacyEnv);
 assert(recreated.status===201&&recreated.data.user.id!==legacy.id&&await store.hasRemoval(legacy),'explicit-new-identity-preserves-barrier');
 assert((await send('/login',{email:legacy.email,password},undefined,'POST',legacyEnv)).status===401,'old-legacy-password-refused');
 const onboarding=await send('/login',{email:legacy.email,password:recreated.data.temporaryPassword},undefined,'POST',legacyEnv);
 assert(onboarding.status===200&&onboarding.data.mustChangePassword
  &&(await send('/users',undefined,onboarding.data.accessToken,'GET')).status===403,'recreated-restricted-onboarding');
 const completed=await send('/password',{currentPassword:recreated.data.temporaryPassword,newPassword:'native recreated password'},onboarding.data.accessToken);
 assert(completed.status===200&&(await send('/refresh',{refreshToken:completed.data.refreshToken})).status===200,'recreated-password-refresh-recovery');
 assert(await store.removeAccount(await store.getById(recreated.data.user.id),removalActor)
  &&!await store.importLegacy(legacy),'recreated-removal-keeps-original-barrier');
 return{checks,rollbackCases:failures.length,accountCount:(await store.list()).length,elapsedMs:Date.now()-now,
  legacyBarrier:{checks:checks.slice(barrierStart),rollbackCases:removalFailures.length,elapsedMs:Date.now()-barrierStarted}};
}
export async function subjectAuditProbe(bindings, stage) {
 const db=bindings.DB, store=d1Store(db), checks=[];
 const assert=(condition,label)=>{if(!condition)throw new Error(label);checks.push(label);};
 const refuses=async(fn,label)=>{let failed=false;try{await fn();}catch{failed=true;}assert(failed,label);};
 const entry=(tenant,operation='recent')=>({at:Date.now(),action:'subject_read',tenant,actorId:'audit-operator',
  detail:JSON.stringify({v:1,requestId:crypto.randomUUID(),operation,route:'/v1/:tenant/visitors/:visitorId/recent',phase:'admitted',selector:{kind:'visitor',ref:'a'.repeat(64)}})});
 if(stage==='before'){
  await store.audit({at:1,action:'sign_in_failed',actorId:'unscoped-legacy'});
  assert((await store.recentAudit(1000)).some(row=>row.actorId==='unscoped-legacy'),'old-schema-global-insert');
  await refuses(()=>store.audit(entry('acme')),'missing-migration-refused');
  return{checks};
 }
 const legacy=await db.prepare("SELECT tenant FROM operator_audit WHERE actor_id='unscoped-legacy'").first();
 assert(legacy.tenant===null,'no-inferred-legacy-tenant');
 for(const tenant of ['acme','globex','acme','acme'])await store.audit(entry(tenant));
 const page=await store.subjectAudit('acme',undefined,2);
 assert(page.length===3&&page.every(row=>row.tenant==='acme')&&page[0].id>page[1].id&&page[1].id>page[2].id,'native-scoped-keyset-lookahead');
 const next=await store.subjectAudit('acme',page[1].id,2);
 assert(next.length===1&&next[0].id===page[2].id,'native-next-page');
 assert(!(await store.recentAudit(1000)).some(row=>row.action==='subject_read'),'legacy-reader-exclusion');
 const indexes=await db.prepare("PRAGMA index_info('idx_operator_audit_tenant_id')").all();
 assert(indexes.results.map(row=>row.name).join(',')==='tenant,id','native-tenant-id-index');
 const proxy=(run,all)=>({prepare(sql){const statement=db.prepare(sql);return{bind(...values){const bound=statement.bind(...values);return{
  run:run?async()=>run:()=>bound.run(),all:all?async()=>all:()=>bound.all(),first:()=>bound.first()};}};}});
 for(const ack of [{success:false,meta:{changes:1}},{success:true},{success:true,meta:{changes:0}},{success:true,meta:{changes:2}}]){
  await refuses(()=>d1Store(proxy(ack)).audit(entry('acme')),'write-ack-'+JSON.stringify(ack));
 }
 for(const result of [{success:false,results:[]},{success:true,results:null}]){
  await refuses(()=>d1Store(proxy(undefined,result)).subjectAudit('acme',undefined,2),'read-ack-'+JSON.stringify(result));
 }
 const raw=await db.prepare("SELECT * FROM operator_audit WHERE tenant='acme' ORDER BY id DESC LIMIT 1").first();
 for(const results of [[{...raw,tenant:'globex'}],[raw,raw],[{...raw,detail:'{}'}],[{...raw,actor_id:'a'.repeat(201)}]]){
  await refuses(()=>d1Store(proxy(undefined,{success:true,results})).subjectAudit('acme',undefined,2),'stored-scope-order-shape-refused');
 }
 assert((await store.subjectAudit('acme',undefined,100)).length===3,'faults-no-extra-inserts');
 const at=Date.now(),requestId=crypto.randomUUID(),total=21;
 const phase=name=>Array.from({length:3},(_,chunk)=>({at,action:'subject_operation',tenant:'acme',actorId:'audit-operator',detail:JSON.stringify({
  v:2,requestId,operation:'identity_resolve',route:'/v1/:tenant/identity/resolve',method:'POST',phase:name,
  selector:{kind:'accounts',total,chunk,members:Array.from({length:Math.min(10,total-chunk*10)},(_,i)=>({ordinal:chunk*10+i,accountRef:'a'.repeat(64),
   ...(name==='result'?{shopperRef:'b'.repeat(64)}:{})}))},...(name==='result'?{status:200,result:{outcome:'resolved'}}:{})})}));
 let phaseQueries=0;
 const phaseStore=d1Store({prepare(sql){assert(sql.includes('json_each(?)')&&sql.includes('ORDER BY CAST(key AS INTEGER)'),'phase-sql-shape');phaseQueries++;return db.prepare(sql);}});
 await phaseStore.auditOperations(phase('admitted'));await phaseStore.auditOperations(phase('result'));
 assert(phaseQueries===2,'two-native-phase-statements');
 const mixed=await store.subjectAudit('acme',undefined,100);
 assert(mixed.length===9&&mixed.slice(0,3).map(row=>row.detail.selector.chunk).join(',')==='2,1,0'
  &&mixed.slice(6).every(row=>row.detail.v===1),'mixed-version-ordered-readback');
 assert(!(await store.recentAudit(1000)).some(row=>row.action==='subject_operation'),'operation-global-exclusion');
 for(const corrupt of [phase('admitted').slice(0,2),phase('admitted').reverse(),phase('admitted').map((row,i)=>i===1?{...row,actorId:'other'}:row)]){
  await refuses(()=>phaseStore.auditOperations(corrupt),'whole-phase-before-sql');
 }
 assert(phaseQueries===2,'invalid-phases-zero-sql');
 for(const ack of [{success:false,meta:{changes:3}},{success:true},{success:true,meta:{changes:1}},{success:true,meta:{changes:4}}]){
  await refuses(()=>d1Store(proxy(ack)).auditOperations(phase('admitted')),'multirow-ack-refused');
 }
 const mutable=phase('admitted');
 const frozen=d1Store({prepare(){return{bind(){return{async run(){mutable.length=0;return{success:true,meta:{changes:3}};}};}};}});
 await frozen.auditOperations(mutable);assert(mutable.length===0,'ack-count-frozen-before-await');
 const rawOperation=await db.prepare("SELECT * FROM operator_audit WHERE action='subject_operation' ORDER BY id DESC LIMIT 1").first();
 const contradictory={v:2,requestId,operation:'identity_shopper',route:'/v1/:tenant/identity/shopper/:shopperId',method:'GET',phase:'result',
  selector:{kind:'shopper',ref:'a'.repeat(64)},status:200,result:{outcome:'read',found:false}};
 for(const row of [{...rawOperation,tenant:'globex'},{...rawOperation,detail:JSON.stringify(contradictory)},
  {...rawOperation,detail:JSON.stringify({...contradictory,status:404,result:{outcome:'read',found:true}})}]){
  await refuses(()=>d1Store(proxy(undefined,{success:true,results:[row]})).subjectAudit('acme',undefined,2),'strict-operation-readback');
 }
 assert((await store.subjectAudit('acme',undefined,100)).length===9,'native-operation-faults-no-extra-inserts');
 const historyStart=checks.length,historyId=crypto.randomUUID(),historyActor='\u0001'.repeat(199)+'a';
 const historyPhase=name=>Array.from({length:name==='admitted'?200:100},(_,chunk)=>({at,action:'subject_operation',tenant:'acme',actorId:historyActor,
  detail:JSON.stringify({v:2,requestId:historyId,operation:'identity_import',route:'/v1/:tenant/identity/events',method:'POST',phase:name,
   selector:{kind:name==='admitted'?'history_inputs':'history_results',format:'json',total:1000,chunk,
    members:Array.from({length:name==='admitted'?5:10},(_,i)=>name==='admitted'
     ?{ordinal:chunk*5+i,rowKind:'profile',accountRef:'a'.repeat(64),shopperRef:'b'.repeat(64),visitorRef:'c'.repeat(64)}
     :{kind:'skipped',ordinal:chunk*10+i,reason:'invalid_shopper'})},
   ...(name==='result'?{status:200,result:{outcome:'identity_import',received:1000,applied:0,skipped:1000,shoppers:0}}:{})})}));
 const admission=historyPhase('admitted'),terminal=historyPhase('result');let historyQueries=0;
 const imports=d1Store({prepare(sql){historyQueries++;return db.prepare(sql);}});
 assert(new TextEncoder().encode(JSON.stringify(admission)).byteLength>512*1024&&new TextEncoder().encode(JSON.stringify(admission)).byteLength<=1024*1024,'import-only-larger-phase');
 await imports.auditOperations(admission);await imports.auditOperations(terminal);
 assert(historyQueries===2,'native-1000-input-two-queries');
 const importPage=await store.subjectAudit('acme',undefined,100);
 assert(importPage.length===101&&importPage.slice(0,100).every(r=>r.detail.selector.kind==='history_results')
  &&importPage[0].detail.selector.chunk===99&&importPage[99].detail.selector.chunk===0,'native-import-minimized-keyset');
 const alter=(rows,index,change)=>rows.map((row,i)=>i===index?{...row,detail:JSON.stringify(change(JSON.parse(row.detail)))}:row);
 for(const corrupt of [admission.slice(0,199),[...admission,admission[199]],
  alter(admission,1,d=>({...d,selector:{...d.selector,members:d.selector.members.map((m,i)=>i===0?{...m,ordinal:0}:m)}})),
  alter(terminal,1,d=>({...d,selector:{...d.selector,members:d.selector.members.map((m,i)=>i===0?{...m,ordinal:0}:m)}})),
  alter(admission,0,d=>({...d,rawRows:[]})),Array.from({length:101},()=>phase('admitted')[0])]){
  await refuses(()=>imports.auditOperations(corrupt),'import-complete-shape-and-old-phase-bound');
 }
 assert(historyQueries===2,'invalid-imports-no-sql');
 for(const ack of [{success:false,meta:{changes:200}},{success:true},{success:true,meta:{changes:199}}]){
  await refuses(()=>d1Store(proxy(ack)).auditOperations(admission),'native-import-exact-ack');
 }
 const rawImport=await db.prepare("SELECT * FROM operator_audit WHERE actor_id=? ORDER BY id DESC LIMIT 1").bind(historyActor).first();
 await refuses(()=>d1Store(proxy(undefined,{success:true,results:[{...rawImport,detail:JSON.stringify({...JSON.parse(rawImport.detail),selector:{kind:'history_unknown',format:'json',total:1000}})}]})).subjectAudit('acme',undefined,100),'import-corrupt-readback-refused');
 assert(!(await store.recentAudit(1000)).some(r=>r.action==='subject_operation'),'import-global-exclusion');
 return{checks,historyChecks:checks.slice(historyStart)};
}
`;


type Operation = { path: string; method?: string; body?: unknown; credential?: string; headers?: Record<string, string>; mode?: string; state?: Record<string, unknown> };
type Input = { payload?: Record<string, unknown>; ops: Operation[]; prepare?: boolean; credential?: string;
  policy?: { roles?: string[]; permissions?: string[] }; sign?: Record<string, unknown>; env?: Record<string, unknown>;
  mode?: string; throwBindings?: boolean; grantedSubjects?: string[]; secondSession?: boolean; accessPatch?: Record<string, unknown>; legacy?: boolean };
type Observation = { path: string; method: string; status: number; error?: string; emptyBody: boolean; cacheControl: string | null;
  calls: string[]; bindingReads: string[]; bodyReads: number; auth: { isAuthenticated: boolean; user?: Record<string, unknown> } | null;
  stateUnchanged: boolean; accountId?: string; userCount?: number; hasAccessToken: boolean; revision?: number; K?: number };
type Result = { setup: number[]; results: Observation[]; calls: string[]; bindingReads: string[]; bodyReads: number;
  stateUnchanged: boolean; accountCount: number; sessionCount: number; audit: Array<{ action: string; actorId: unknown }>;
  config: { revision: number; K: number; actor: unknown; index: Array<{ revision: number; actor: unknown }> } | null;
  accessShape: Record<string, unknown> | null };
type Runner = (input: Input) => Promise<Result>;
type GraphFile = { path: string; sha256: string; virtual: boolean };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const graphs: Array<{ phase: string; files: GraphFile[] }> = [];
const instances: Miniflare[] = [];
let nodeCurrent: Runner, nodeBefore: Runner, workerdCurrent: Runner, workerdBefore: Runner;
let nativeBudget: () => Promise<Record<string, unknown>>;
let nativeLifecycle: () => Promise<Record<string, unknown>>;
let nativeAudit: () => Promise<Record<string, unknown>>;
let nativeAuthority: () => Promise<Record<string, unknown>>;
let outbound = 0;
let hostFetch: typeof globalThis.fetch;
const normal = { sub: 'fixture-account', roles: ['admin'], permissions: ['read', 'write'] };
const malformed: Array<[string, Record<string, unknown>]> = [
  ['sub absent', { roles: ['admin'], permissions: ['read', 'write'] }],
  ...[['empty', ''], ['blank', ' \t\n'], ['null', null], ['number', 7], ['boolean', true], ['object', {}], ['array', ['actor']]]
    .map(([name, sub]): [string, Record<string, unknown>] => ['sub ' + name, { ...normal, sub }]),
  ...['roles', 'permissions'].flatMap((claim) => [
    ['substring', claim === 'roles' ? 'not-admin' : 'not-read/not-write'], ['empty', ''], ['null', null],
    ['number', 7], ['boolean', true], ['object', {}], ['mixed', [claim === 'roles' ? 'admin' : 'write', 7]],
    ['null entry', [claim === 'roles' ? 'admin' : 'write', null]], ['nested', [[claim === 'roles' ? 'admin' : 'write']]],
  ].map(([name, value]): [string, Record<string, unknown>] => [claim + ' ' + name, { ...normal, [claim]: value }])),
];
const configPath = '/config/reflex?scope=w0203-focused';
const protectedOps: Operation[] = [
  { path: '/auth/me' }, { path: '/auth/me', method: 'HEAD' }, { path: '/auth/users' },
  { path: '/auth/users', method: 'POST', body: { email: 'new@example.invalid', name: 'Synthetic New' } },
  { path: configPath, method: 'PATCH', body: { patch: { K: 17 } } },
  { path: configPath, method: 'PUT', body: 'full' },
  { path: '/config/reflex/rollback/1?scope=w0203-focused', method: 'POST', body: {} },
  { path: '/auth/password', method: 'POST', body: { currentPassword: 'wrong', newPassword: 'synthetic new password' } },
  { path: '/auth/users', method: 'POST', body: '{malformed' },
  { path: configPath, method: 'PATCH', body: '{malformed' },
  { path: '/optional' }, { path: '/policy' }, { path: '/v1/acme/probe' },
  { path: '/realtime/probe', method: 'POST', body: {} }, { path: '/operator/probe', method: 'POST', body: {} },
];
const mutationOps = protectedOps.slice(0, 7);
const gateOps: Operation[] = [{ path: '/optional' }, { path: '/policy' }, { path: '/v1/acme/probe' },
  { path: '/realtime/probe', method: 'POST' }, { path: '/operator/probe', method: 'POST' }];

async function compile(original: boolean, runtime: 'node' | 'workerd'): Promise<Runner> {
  const baseline = JSON.parse(readFileSync('docs/remediation/evidence/W02.03/baseline.json', 'utf8'));
  const retained = baseline.before_source;
  expect(retained.path).toBe('src/middleware/auth.ts');
  expect(retained.sha256).toBe('71b8bff20c06df6fdcbddd37678a73fcdfe7b0b3dcafbfba49d16b70587c1316');
  expect(sha(retained.content)).toBe(retained.sha256);
  const source = HARNESS_SOURCE + (runtime === 'workerd'
    ? '\nexport default { async fetch(request,env) { try { const url=new URL(request.url),path=url.pathname; return Response.json(path==="/authority"?await authorityProbe(env):path==="/subject-audit"?await subjectAuditProbe(env,url.searchParams.get("phase")):path==="/lifecycle"?await d1LifecycleProbe(env):path==="/budget"?await budgetProbe(env):await run(await request.json())); } catch(error) { return Response.json({harnessError:String(error.message)}, {status:500}); } } };' : '');
  const bundled = await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: 'w0203-harness.ts', loader: 'ts' },
    bundle: true, write: false, metafile: true, platform: runtime === 'node' ? 'node' : 'browser',
    external: runtime === 'node' ? [] : ['node:async_hooks'],
    format: runtime === 'node' ? 'cjs' : 'esm', conditions: runtime === 'node' ? undefined : ['workerd', 'worker', 'browser'],
    logLevel: 'silent', plugins: original ? [{ name: 'retained-original-verifier', setup(builder) {
      builder.onLoad({ filter: /[/\\]src[/\\]middleware[/\\]auth\.ts$/ }, (args) => ({
        contents: retained.content, loader: 'ts', resolveDir: dirname(args.path),
      }));
    } }] : [] });
  const phase = runtime + '-' + (original ? 'before' : 'current');
  const files = Object.keys(bundled.metafile!.inputs).sort().map((path) => {
    const virtual = path === 'w0203-harness.ts';
    const content = virtual ? source : original && path === retained.path ? retained.content : readFileSync(path);
    return { path, virtual, sha256: sha(content) };
  });
  graphs.push({ phase, files });
  if (runtime === 'node') {
    const filename = resolve('w0203-' + phase + '.cjs');
    const mod = new Module(filename);
    mod.filename = filename;
    mod.paths = (Module as unknown as { _nodeModulePaths(path: string): string[] })._nodeModulePaths(process.cwd());
    (mod as unknown as { _compile(source: string, filename: string): void })._compile(bundled.outputFiles[0]!.text, filename);
    return mod.exports.run as Runner;
  }
  const mf = new Miniflare({ modules: [{ type: 'ESModule', path: phase + '.mjs', contents: bundled.outputFiles[0]!.text }],
    durableObjects: { RATE_LIMITER: 'LoginBudgetFixture' },
    d1Databases: { DB: 'w0206-synthetic-d1' },
    compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'], outboundService() { outbound++; throw new Error('W02.03 forbids outbound network'); } });
  instances.push(mf);
  if (!original) {
    const authorityRuntime = new Miniflare({ modules: [{ type: 'ESModule', path: 'w0208-authority.mjs', contents: bundled.outputFiles[0]!.text }],
      durableObjects: { RATE_LIMITER: 'LoginBudgetFixture' }, d1Databases: { DB: 'w0208-synthetic-authority' },
      compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'], outboundService() { outbound++; throw new Error('W02.08 forbids outbound network'); } });
    instances.push(authorityRuntime);
    const authorityDb = await authorityRuntime.getD1Database('DB');
    for (const path of ['migrations/0010_operator_accounts.sql', 'migrations/0011_operator_audit_tenant.sql', 'migrations/0012_operator_authority.sql', 'migrations/0013_operator_oidc.sql']) {
      const schema = readFileSync(path, 'utf8'), trigger = schema.indexOf('CREATE TRIGGER');
      graphs.push({ phase: 'workerd-authority-schema', files: [{ path, sha256: sha(schema), virtual: false }] });
      if (path.endsWith('0013_operator_oidc.sql')) { await authorityDb.exec(schema.replace(/--[^\n]*/g, '').replace(/\n/g, ' ')); continue; }
      const plain = trigger < 0 ? schema : schema.slice(0, trigger);
      await authorityDb.batch(plain.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => authorityDb.prepare(sql)));
      if (trigger >= 0) await authorityDb.prepare(schema.slice(trigger)).run();
    }
    nativeAuthority = async () => {
      const response = await authorityRuntime.dispatchFetch('https://w0208-runtime.example.invalid/authority');
      const result = await response.json() as Record<string, unknown>;
      expect(response.status, String(result.harnessError)).toBe(200); return result;
    };
    const schemaPath = 'migrations/0010_operator_accounts.sql', schema = readFileSync(schemaPath, 'utf8');
    graphs.push({ phase: 'workerd-d1-schema', files: [{ path: schemaPath, sha256: sha(schema), virtual: false }] });
    const db = await mf.getD1Database('DB');
    await db.batch(schema.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
    for (const upgrade of ['0011_operator_audit_tenant.sql', '0012_operator_authority.sql', '0013_operator_oidc.sql']) {
      const path = 'migrations/' + upgrade, body = readFileSync(path, 'utf8');
      graphs.push({ phase: 'workerd-lifecycle-schema', files: [{ path, sha256: sha(body), virtual: false }] });
      await db.exec(body.replace(/--[^\n]*/g, '').replace(/\n/g, ' '));
    }
    nativeLifecycle = async () => {
      const response = await mf.dispatchFetch('https://w0206-runtime.example.invalid/lifecycle');
      const result = await response.json() as Record<string, unknown>;
      expect(response.status, String(result.harnessError)).toBe(200); return result;
    };
    nativeAudit = async () => {
      // The historical missing-0011 control owns a separate database; current
      // lifecycle mutations must execute the complete forward schema.
      const auditRuntime = new Miniflare({ modules: [{ type: 'ESModule', path: 'w0304-audit.mjs', contents: bundled.outputFiles[0]!.text }],
        durableObjects: { RATE_LIMITER: 'LoginBudgetFixture' }, d1Databases: { DB: 'w0304-synthetic-audit' },
        compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'], outboundService() { outbound++; throw new Error('W03.04 forbids outbound network'); } });
      instances.push(auditRuntime);
      const db = await auditRuntime.getD1Database('DB');
      await db.batch(schema.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
      const call = async (phase: string) => {
        const response = await auditRuntime.dispatchFetch('https://w0304-runtime.example.invalid/subject-audit?phase=' + phase);
        const result = await response.json() as Record<string, unknown>;
        expect(response.status, String(result.harnessError)).toBe(200); return result;
      };
      const before = await call('before'), path = 'migrations/0011_operator_audit_tenant.sql', migration = readFileSync(path, 'utf8');
      graphs.push({ phase: 'workerd-subject-audit-schema', files: [{ path, sha256: sha(migration), virtual: false }] });
      await db.batch(migration.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
      for (const upgrade of ['0012_operator_authority.sql', '0013_operator_oidc.sql']) {
        const schema = readFileSync('migrations/' + upgrade, 'utf8'); graphs.push({ phase: 'workerd-subject-audit-schema', files: [{ path: 'migrations/' + upgrade, sha256: sha(schema), virtual: false }] });
        await db.exec(schema.replace(/--[^\n]*/g, '').replace(/\n/g, ' '));
      }
      return { before, after: await call('after') };
    };
  }
  if (!original) nativeBudget = async () => {
    const response = await mf.dispatchFetch('https://w0205-runtime.example.invalid/budget');
    const result = await response.json() as Record<string, unknown>;
    expect(response.status, String(result.harnessError)).toBe(200); return result;
  };
  return async (input) => {
    const response = await mf.dispatchFetch('https://w0203-runtime.example.invalid', { method: 'POST', body: JSON.stringify(input) });
    const result = await response.json() as Result & { harnessError?: string };
    expect(response.status, result.harnessError).toBe(200);
    return result;
  };
}

beforeAll(async () => {
  hostFetch = globalThis.fetch;
  globalThis.fetch = (async () => { outbound++; throw new Error('W02.03 forbids host fetch'); }) as typeof globalThis.fetch;
  nodeCurrent = await compile(false, 'node'); nodeBefore = await compile(true, 'node');
  workerdCurrent = await compile(false, 'workerd'); workerdBefore = await compile(true, 'workerd');
}, 60_000);

afterAll(async () => {
  await Promise.all(instances.map((mf) => mf.dispose()));
  globalThis.fetch = hostFetch;
  const unique = [...new Map(graphs.flatMap((g) => g.files).map((f) => [JSON.stringify(f), f])).values()];
  const index = new Map(unique.map((f, i) => [JSON.stringify(f), i]));
  // Exact per-phase inputs without repeating every path/hash four times.
  console.log('W02.03 runtime-inputs ' + JSON.stringify({ files: unique,
    graphs: graphs.map((g) => ({ phase: g.phase, inputs: g.files.map((f) => index.get(JSON.stringify(f))) })),
    baselineOnly: graphs.filter((g) => g.phase.endsWith('before')).map((g) => ({ phase: g.phase,
      paths: g.files.filter((f) => !graphs.find((x) => x.phase === g.phase.replace('before', 'current'))!.files.some((c) => c.path === f.path)).map((f) => f.path) })),
    outbound, disposed: instances.length }));
  expect(outbound).toBe(0);
}, 60_000);

function denied(result: Result, count: number) {
  expect(result.setup).toEqual([200, 200, 200]);
  expect(result.results).toHaveLength(count);
  for (const r of result.results) {
    expect(r.status, r.path).toBe(401);
    if (r.method !== 'HEAD') expect(r.error, r.path).toBe('Invalid token');
    expect(r.calls, r.path).toEqual([]); expect(r.bindingReads, r.path).toEqual([]);
    expect(r.bodyReads, r.path).toBe(0); expect(r.auth, r.path).toBeNull();
    expect(r.stateUnchanged, r.path).toBe(true);
  }
  expect(result.calls).toEqual([]); expect(result.bindingReads).toEqual([]); expect(result.bodyReads).toBe(0);
  expect(result.stateUnchanged).toBe(true);
  expect(result.config).toMatchObject({ revision: 1, K: 3, index: [{ revision: 1 }] });
  expect(result.accountCount).toBe(1); expect(result.sessionCount).toBe(1);
}

describe('JWT identity/authority shapes on actual Node account and config routes', () => {
  it.each(malformed)('%s is refused before all protected effects', async (_name, payload) => {
    denied(await nodeCurrent({ payload, ops: protectedOps }), protectedOps.length);
  });

  it.each(malformed.filter(([name]) => ['sub absent', 'sub blank', 'roles substring', 'permissions mixed'].includes(name)))(
    'composed original verifier reproduces %s account/config effects', async (label, payload) => {
      // Historical composed verifier reproduction; current enforced global admin is withdrawn.
      const result = await nodeBefore({ payload, mode: 'open', ops: mutationOps });
      const configAllowed = !['sub absent', 'sub blank'].includes(label);
      expect(result.results.map((r) => r.status)).toEqual([200, 200, 200, 201, ...Array(3).fill(configAllowed ? 200 : 403)]);
      expect(result.results[0]!.calls).toEqual(['ACCOUNTS.getById']);
      expect(result.results[2]!.calls).toEqual(['ACCOUNTS.list']);
      expect(result.accountCount).toBe(2); expect(result.audit.at(-1)?.action).toBe('account_created');
      expect(result.calls.filter((c) => c === 'ACCOUNTS.create')).toHaveLength(1);
      expect(result.calls.filter((c) => c === 'ACCOUNTS.audit')).toHaveLength(1);
      expect(result.calls.filter((c) => c === 'CACHE.put')).toHaveLength(0); expect(result.calls.filter(c => c === 'STORAGE.commit')).toHaveLength(configAllowed ? 3 : 0);
      expect(result.config).toMatchObject({ revision: configAllowed ? 4 : 1, K: 3 });
      expect(result.config!.index.map((r) => r.revision)).toEqual(configAllowed ? [4, 3, 2, 1] : [1]);
      if (!configAllowed) result.results.slice(4).forEach(r => expect(r.stateUnchanged).toBe(true));
      expect(result.stateUnchanged).toBe(false);
      console.log('W02.03 original Node ' + JSON.stringify({ label, statuses: result.results.map((r) => r.status),
        accountPut: 1, audit: 1, publicationCommits: configAllowed ? 3 : 0, revision: result.config!.revision, actor: result.audit.at(-1)?.actorId }));
    });

  it('preserves real login access, JSON renewal, logout and refresh-purpose denial', async () => {
    const result = await nodeCurrent({ credential: 'access', ops: [
      { path: '/auth/refresh', method: 'POST', credential: 'none', body: 'renew' },
      { path: '/auth/me', credential: 'renewed' },
      { path: configPath, method: 'PATCH', credential: 'renewed', body: { patch: { K: 7 } } },
      { path: '/auth/me', credential: 'refresh' },
      { path: '/auth/logout', method: 'POST', body: {} },
      { path: '/auth/refresh', method: 'POST', credential: 'none', body: 'renew' },
    ] });
    expect(result.results.map((r) => r.status)).toEqual([200, 200, 200, 401, 200, 401]);
    expect(result.results[0]!.hasAccessToken).toBe(true); expect(result.results[1]!.accountId).toBe('fixture-account');
    expect(result.results[3]!.calls).toEqual([]); expect(result.results[3]!.auth).toBeNull();
    expect(result.accessShape).toMatchObject({ sub: 'fixture-account', type: 'access', sid: expect.any(String) });
    expect(result.config).toMatchObject({ revision: 2, K: 7 }); expect(result.sessionCount).toBe(0);
  });

  it.each([
    { sub: 'operator', roles: ['operator'] }, { sub: 'acceptance-run', roles: ['operator'] },
    { sub: 'import-content', roles: ['operator'] }, { sub: 'seed-coach-content', roles: ['operator'] },
    { sub: 'console-preview-admin', email: 'admin@local.test', name: 'Preview Admin', roles: ['admin'], permissions: ['*'] },
    { sub: 'holdout-proof', roles: ['operator'] }, { sub: 'identity-proof' }, { sub: 'rehearsal' },
  ])('keeps explicitly granted standard tool shape $sub without store I/O at shared gates', async (payload) => {
    const result = await nodeCurrent({ payload, grantedSubjects: [payload.sub], ops: gateOps });
    expect(result.results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(result.bindingReads).toEqual([]);
    expect(result.calls).toEqual(['optional.dispatch', 'policy.dispatch', 'sdk.dispatch', 'realtime.dispatch', 'operator.dispatch']);
    for (const r of result.results) expect(r.auth?.user).toMatchObject(payload);
  });

  it.each([
    { sub: ' \t客户 exact identity ', roles: ['admin', '', 'unknown', 'admin'], permissions: ['*', '', 'write'] },
    { sub: 'subject-only' }, { sub: 'empty-arrays', roles: [], permissions: [] },
    { sub: 'service-shape', type: 'service' },
  ])('preserves exact accepted claims for $sub', async (payload) => {
    const result = await nodeCurrent({ payload, grantedSubjects: [payload.sub], ops: [{ path: '/policy' }, { path: configPath, method: 'PATCH', body: { patch: { K: 9 } } }] });
    const canonicalActor = payload.sub === payload.sub.trim();
    expect(result.results.map((r) => r.status)).toEqual([200, canonicalActor ? 200 : 422]);
    expect(result.results[0]!.auth?.user).toMatchObject(payload); expect(result.results[0]!.bindingReads).toEqual([]);
    if (canonicalActor) {
      expect(result.config).toMatchObject({ revision: 2, K: 9, actor: payload.sub });
      expect(result.config!.index[0]!.actor).toBe(payload.sub);
    } else { expect(result.config).toMatchObject({ revision: 1, K: 3 }); expect(result.results[1]!.stateUnchanged).toBe(true); }
    expect(result.calls.filter((c) => c === 'CACHE.put')).toHaveLength(0); expect(result.calls.filter(c => c === 'STORAGE.commit')).toHaveLength(canonicalActor ? 1 : 0);
  });

  it.each([
    [{ roles: ['operator', 'admin'], permissions: ['read', 'write'] }, { roles: ['admin'], permissions: ['read', 'write'] }, 200],
    [{ roles: ['admin'] }, { roles: ['not-admin'] }, 403], [{ roles: ['admin'] }, { roles: [] }, 403],
    [{ permissions: ['read', 'write'] }, { permissions: ['write'] }, 403],
    [{ permissions: ['write'] }, { permissions: ['*'] }, 403], [{ permissions: ['*'] }, { permissions: ['*'] }, 200],
    [{ permissions: [''] }, { permissions: [''] }, 200], [{ roles: ['unknown'] }, { roles: ['unknown'] }, 200],
  ] as Array<[Input['policy'], Record<string, unknown>, number]>)('retains exact role-any/permission-all membership %#', async (policy, claims, status) => {
    const result = await nodeCurrent({ payload: { sub: 'policy-subject', ...claims }, policy, ops: [{ path: '/policy' }] });
    expect(result.results[0]!.status).toBe(status); expect(result.bindingReads).toEqual([]);
    expect(result.results[0]!.auth === null).toBe(status !== 200);
  });

  it('rejects permission strings at the middleware-only option, including optional use', async () => {
    const payload = { sub: 'permission-subject', permissions: 'not-write' };
    const before = await nodeBefore({ payload, policy: { permissions: ['write'] }, ops: [{ path: '/policy' }] });
    expect(before.results[0]!.status).toBe(200); expect(before.calls).toEqual(['policy.dispatch']);
    denied(await nodeCurrent({ payload, policy: { permissions: ['write'] }, ops: [{ path: '/policy' }, { path: '/optional' }] }), 2);
  });

  it.each([
    [{ expired: true }, 'Token expired'], [{ wrongKey: true }, 'Authentication failed'],
    [{ issuer: 'other' }, 'Authentication failed'], [{ audience: 'other' }, 'Authentication failed'],
    [{ future: true }, 'Authentication failed'],
  ] as Array<[Record<string, unknown>, string]>)('keeps crypto/time checks ahead of shape checks %#', async (sign, error) => {
    const result = await nodeCurrent({ payload: { roles: 'not-admin' }, sign, ops: [{ path: '/auth/users' }] });
    expect(result.results[0]!.status).toBe(401); expect(result.results[0]!.error).toBe(error);
    expect(result.calls).toEqual([]); expect(result.results[0]!.auth).toBeNull();
  });

  it('preserves header/configuration ordering and independent SDK credentials', async () => {
    const ops: Operation[] = [];
    for (const Authorization of ['', 'Basic synthetic', 'Bearer', 'Bearer ']) {
      ops.push({ path: '/auth/me', credential: 'none', headers: { Authorization } },
        { path: '/optional', credential: 'none', headers: { Authorization } });
    }
    ops.push({ path: '/auth/me' }, { path: '/optional' },
      { path: '/v1/acme/probe', headers: { 'X-SDK-Key': 'synthetic-sdk', Authorization: 'Bearer bad' } },
      { path: '/v1/acme/probe', credential: 'none', headers: { 'X-SDK-Key': 'wrong-sdk' } });
    const result = await nodeCurrent({ prepare: false, env: { JWT_SECRET: '' }, payload: { roles: 'not-admin' }, ops });
    expect(result.results.map((r) => r.status)).toEqual([401, 200, 401, 200, 401, 200, 401, 200, 503, 503, 200, 401]);
    for (const r of result.results.filter((r) => r.status === 503)) {
      expect(r.error).toBe('Authentication configuration unavailable'); expect(r.cacheControl).toBe('no-store');
    }
    expect(result.bindingReads).toEqual([]); expect(result.bodyReads).toBe(0);
    expect(result.calls).toEqual(['optional.dispatch', 'optional.dispatch', 'optional.dispatch', 'optional.dispatch', 'sdk.dispatch']);
  });

  it('cannot touch throwing protected bindings and preserves open-mode actual route protection', async () => {
    const result = await nodeCurrent({ prepare: false, throwBindings: true, payload: { sub: null, roles: ['admin'] },
      mode: 'open', ops: mutationOps.filter((op) => op.body !== 'full') });
    expect(result.results.every((r) => r.status === 401 && r.auth === null && r.bodyReads === 0)).toBe(true);
    expect(result.calls).toEqual([]); expect(result.bindingReads).toEqual([]); expect(result.stateUnchanged).toBe(true);
  });
});

describe.each(['node', 'workerd'] as const)('W02.04 %s account/session enforcement', (runtime) => {
  const run = (input: Input) => (runtime === 'node' ? nodeCurrent : workerdCurrent)(input);
  const mutation = { path: configPath, method: 'PATCH', body: { patch: { K: 99 } } };
  const noEffects = (r: Observation) => {
    expect(r.stateUnchanged).toBe(true); expect(r.bodyReads).toBe(0); expect(r.auth).toBeNull();
    expect(r.calls.every(call => ['ACCOUNTS.getSession', 'ACCOUNTS.getById'].includes(call))).toBe(true);
  };

  it('uses current lifecycle state and restores restricted onboarding through real routes', async () => {
    const transitions: Array<[string, Operation]> = [
      ['logout', { path: '/auth/logout', method: 'POST', credential: 'access', body: {} }],
      ['reset', { path: '/auth/users/fixture-account/reset', method: 'POST', mode: 'open', body: {} }],
      ['disable', { path: '/auth/users/fixture-account', method: 'PATCH', mode: 'open', body: { disabled: true } }],
      ['delete', { path: '/auth/users/fixture-account', method: 'DELETE', mode: 'open' }],
      ['demote', { path: '/auth/users/fixture-account', method: 'PATCH', mode: 'open', body: { roles: ['operator'] } }],
      ['password', { path: '/auth/password', method: 'POST', credential: 'access', body: 'changePassword' }],
    ];
    for (const [label, transition] of transitions) {
      const ops: Operation[] = [
        { ...mutation, credential: 'access', body: { patch: { K: 5 } } }, transition,
        ...(label === 'demote' ? [{ path: '/policy', credential: 'access' }, { path: '/write-policy', credential: 'access' }]
          : [{ ...mutation, credential: 'access' }, { path: '/auth/refresh', method: 'POST', credential: 'none', body: 'renew' }]),
      ];
      if (label === 'reset') ops.push(
        { path: '/auth/login', method: 'POST', credential: 'none', body: 'resetLogin' },
        { path: '/auth/me', credential: 'recovered' }, { ...mutation, credential: 'recovered' },
        { path: '/auth/password', method: 'POST', credential: 'recovered', body: 'changeResetPassword' },
        { ...mutation, credential: 'replacement', body: { patch: { K: 7 } } });
      if (label === 'password') ops.push(
        { path: '/auth/me', credential: 'second' }, { path: '/auth/refresh', method: 'POST', credential: 'none', body: 'secondRenew' },
        { ...mutation, credential: 'replacement', body: { patch: { K: 7 } } },
        { path: '/auth/refresh', method: 'POST', credential: 'none', body: 'replacementRenew' });
      const result = await run({ payload: { sub: 'fixture-admin', roles: ['admin'] }, policy: { roles: ['admin'] },
        secondSession: label === 'password', ops });
      expect(result.results.map(r => r.status), label).toEqual([200, 200, 401, 401,
        ...(label === 'reset' ? [200, 200, 403, 200, 200] : []), ...(label === 'password' ? [401, 401, 200, 200] : [])]);
      noEffects(result.results[2]!);
      if (label === 'demote') noEffects(result.results[3]!);
      if (label === 'reset') noEffects(result.results[6]!);
      expect(result.config).toMatchObject({ K: ['reset', 'password'].includes(label) ? 7 : 5,
        revision: ['reset', 'password'].includes(label) ? 3 : 2 });
      expect(result.calls.filter(call => call === 'CACHE.put')).toHaveLength(0); expect(result.calls.filter(call => call === 'STORAGE.commit')).toHaveLength(['reset', 'password'].includes(label) ? 2 : 1);
      expect(result.audit.at(-1)?.action).toBe(label === 'reset' || label === 'password' ? 'password_changed'
        : label === 'logout' ? 'sign_out' : label === 'disable' ? 'account_disabled' : label === 'delete' ? 'account_removed' : 'account_changed');
      for (const r of result.results.filter(r => r.path.startsWith('/auth/'))) expect(r.cacheControl).toBe('no-store');
      console.info('W02.04 lifecycle', JSON.stringify({ runtime, label, statuses: result.results.map(r => r.status), config: result.config,
        sessions: result.sessionCount, audit: result.audit.map(a => a.action) }));
    }
  }, 30_000);

  it('fails malformed or unavailable authority before protected effects and preserves deliberate credential modes', async () => {
    const cases: Input[] = [
      { accessPatch: {}, sign: { omitExpiry: true }, ops: [mutation] },
      ...[{}, { type: 'access' }, { type: 'unknown' }, { type: null }, { type: 'service' }].map(payload => ({
        payload: { sub: 'fixture-account', ...payload }, sign: { omitExpiry: true }, ops: [mutation] })),
      ...['', ' ', 'other-session'].map(sid => ({ accessPatch: { sid }, ops: [mutation] })),
      ...[{ dropSession: true }, { dropAccount: true }, { session: { accountId: 'other' } }, { session: { jti: 'other' } },
        { session: { expiresAt: 0 } }, { session: { expiresAt: null } }, { account: { id: 'other' } },
        { account: { disabled: true } }, { account: { roles: [] } }, { account: { roles: [''] } },
        { account: { roles: 'admin' } }, { account: { permissions: null } }, { fail: 'getSession' }, { fail: 'getById' }]
        .map(state => ({ credential: 'access', ops: [{ ...mutation, state }] })),
    ];
    for (const input of cases) {
      const result = await run(input); expect(result.results[0]!.status).toBe(401); noEffects(result.results[0]!);
      expect(result.config).toMatchObject({ revision: 1, K: 3 }); expect(result.calls.some(call => call.endsWith('.put') || call.endsWith('.audit'))).toBe(false);
    }
    for (const mode of ['enforced', 'open', 'ENFORCED']) {
      const result = await run({ mode, legacy: true, payload: { sub: 'fixture-account' }, ops: [mutation] });
      // Current publication authority requires a typed credential independently of demo auth mode.
      expect(result.results[0]!.status).toBe(401);
      const refused = result.results[0]!;
      expect(refused.stateUnchanged).toBe(true); expect(refused.bodyReads).toBe(0); expect(refused.calls).toEqual([]);
      if (mode === 'enforced') expect(refused.auth).toBeNull();
      else expect(refused.auth?.user).toMatchObject({ sub: 'fixture-account' });
      const access = await run({ mode, accessPatch: { sid: '' }, ops: [mutation] });
      expect(access.results[0]!.status).toBe(401); noEffects(access.results[0]!);
      const unknown = await run({ mode, payload: { sub: 'fixture-account', type: 'unknown' }, ops: [mutation] });
      expect(unknown.results[0]!.status).toBe(401); noEffects(unknown.results[0]!);
      const service = await run({ mode, payload: { sub: 'fixture-account', type: 'service' }, ops: [
        { path: '/auth/me' }, { path: '/auth/logout', method: 'POST', body: {} }, { path: '/auth/password', method: 'POST', body: 'changePassword' },
        { path: '/v1/acme/probe', credential: 'none', headers: { 'X-SDK-Key': 'synthetic-sdk' } },
      ] });
      expect(service.results.map(r => r.status)).toEqual([401, 401, 401, 200]);
      service.results.slice(0, 3).forEach(noEffects); expect(service.bindingReads).toEqual([]);
    }
  }, 30_000);
});

describe('actual-module workerd claim boundaries', () => {
  it('W02.08 native current membership/service authority, atomic stale-writer refusals and last-owner recovery', async () => {
    const result = await nativeAuthority() as { checks: string[]; effects: number };
    expect(result.checks).toEqual(expect.arrayContaining(['owner-bootstrap-membership', 'shared-two-memberships',
      'native-current-tenant-role-not-global-admin', 'static-grant-cannot-bypass-current-membership', 'owner-config-is-not-product-grant',
      'global-refusals-zero-effects', 'remove-one-tenant-only', 'membership-does-not-change-global-account-or-session',
      'removed-generation-blocks-delayed-create', 'explicit-current-generation-regrant', 'stale-tenant-admin-cannot-commit',
      'native-base64url-registry-positive', 'service-exact-tenant-before-effects', 'service-independent-of-human-logout',
      'atomic-service-replacement', 'retired-service-not-revivable', 'individual-service-revocation', 'sibling-service-retained',
      'registered-token-hash-binds-claims', 'unsafe-key-no-effects', 'new-key-rejects-old-human-and-service',
      'existing-owner-password-recovers-after-key-change', 'registered-tool-recovers-under-new-key',
      'membership-native-rollback-0', 'membership-native-rollback-1', 'membership-native-rollback-2',
      'replacement-native-rollback-0', 'replacement-native-rollback-1', 'replacement-native-rollback-2', 'replacement-native-rollback-3',
      'stale-owner-create-refused', 'stale-owner-native-transaction-refused', 'recovery-trigger-rollback-account',
      'recovery-trigger-rollback-session', 'recovery-trigger-rollback-audit', 'recovery-exact-target-revision',
      'native-owner-recovery-restricted-login', 'recovered-owner-must-change-password', 'native-owner-recovery-completes',
      'duplicate-insert-never-replays-trigger']));
    expect(result.effects).toBeGreaterThan(0);
    console.info('W02.08 native authority', JSON.stringify(result));
  }, 30_000);

  it('W02.06 native D1 commits conditional lifecycle changes, rolls back SQL faults and preserves recovery', async () => {
    const result = await nativeLifecycle() as { checks: string[]; rollbackCases: number; accountCount: number; elapsedMs: number;
      legacyBarrier: { checks: string[]; rollbackCases: number; elapsedMs: number } };
    expect(result.rollbackCases).toBe(8); expect(result.accountCount).toBe(1);
    expect(result.checks).toEqual(expect.arrayContaining(['legacy-id-conflict-zero-effect', 'independent-logins',
      'same-revision-zero-effect-disabled', 'same-revision-zero-effect-roles', 'same-revision-zero-effect-permissions',
      'same-revision-zero-effect-password_hash', 'route-rollback/login', 'route-rollback/password', 'stale-duplicate-jti-zero-effect',
      'one-replacement', 'password-loser', 'winner-renewable', 'onboarding-recovery', 'demotion-revokes',
      'logout-stale-zero-effect', 'logout-monotonic-revision', 'deleted-account-not-recreated']));
    expect(result.legacyBarrier.rollbackCases).toBe(4);
    expect(result.legacyBarrier.checks).toEqual(expect.arrayContaining(['retired-id-or-email-blocked', 'retired-imports-zero-effect',
      'one-atomic-actor-removal', 'retained-historical-removal-blocks', 'unmigrated-admin-conflict',
      'non-removal-history-allows-import', 'first-legacy-import-with-failed-cleanup', 'stale-delete-no-false-barrier', 'removal-rollback-stage-0',
      'removal-rollback-stage-1', 'removal-rollback-stage-2', 'removal-rollback-stage-3', 'removal-retry-commits',
      'repeated-delete-no-extra-barrier', 'native-retained-kv-zero-effect', 'retired-session-refused',
      'explicit-new-identity-preserves-barrier', 'old-legacy-password-refused', 'recreated-restricted-onboarding',
      'recreated-password-refresh-recovery', 'recreated-removal-keeps-original-barrier']));
    console.info('W02.06 native D1 lifecycle', JSON.stringify(result));
  }, 30_000);

  it('W03.04 native D1 preserves unassigned history and acknowledges indexed scoped audit writes and pages', async () => {
    const result = await nativeAudit() as { before: { checks: string[] }; after: { checks: string[]; historyChecks: string[] } };
    expect(result.before.checks).toEqual(['old-schema-global-insert', 'missing-migration-refused']);
    expect(result.after.checks).toEqual(expect.arrayContaining(['no-inferred-legacy-tenant', 'native-scoped-keyset-lookahead',
      'native-next-page', 'legacy-reader-exclusion', 'native-tenant-id-index', 'faults-no-extra-inserts']));
    expect(result.after.checks.slice(0, -result.after.historyChecks.length)).toHaveLength(34);
    expect(result.after.historyChecks).toHaveLength(15);
    console.info('W03.04 native D1 audit', JSON.stringify(result));
  });

  it('W02.05 bounds concurrent native login state, rolls back faults and recovers across expiry without email lockout', async () => {
    type Admission = { status: number; allowed?: boolean; remaining?: number; resetTime?: number };
    type Snapshot = { entries: Array<[string, unknown]>; alarm: number | null; metrics: Record<string, number> };
    const r = await nativeBudget() as unknown as {
      same: Admission[]; sameState: Snapshot; denial: Admission; afterDenial: Snapshot; malformed: Admission; wrongMethod: Admission;
      many: Admission[]; manyState: Snapshot; globalDenial: Admission; afterGlobalDenial: Snapshot; stale: Snapshot;
      resetAdmission: Admission; resetState: Snapshot; genericStatus: number; expired: Snapshot;
      malformedStates: Array<{ response: Admission; state: Snapshot }>; fault: Admission; faultState: Snapshot;
      attempts: number[]; blocked: number; beforeGood: { audit: number; sessions: number }; good: number; fill: number;
      deniedEffects: { status: number; bodyReads: number; calls: string[]; audit: string[] };
      recovery: number[]; recoveryBefore: Snapshot; recoveryAfter: Snapshot; recovered: number;
      unavailableEffects: { status: number; bodyReads: number; calls: string[] }; elapsedMs: number;
    };
    const state = (s: Snapshot) => s.entries.find(([key]) => key === 'operator-login:v1')?.[1] as
      { windowStart: number; count: number; sources: Record<string, number> } | undefined;
    const noWrites = (s: Snapshot) => expect(Object.values(s.metrics).every(value => value === 0)).toBe(true);
    expect(r.same.every(x => x.status === 200)).toBe(true); expect(r.same.filter(x => x.allowed)).toHaveLength(10);
    expect(r.same.filter(x => !x.allowed)).toHaveLength(15);
    expect(state(r.sameState)?.count).toBe(10); expect(Object.keys(state(r.sameState)!.sources)).toHaveLength(1);
    expect(r.denial).toMatchObject({ status: 200, allowed: false, remaining: 0 });
    expect(r.afterDenial.entries).toEqual(r.sameState.entries); expect(r.afterDenial.alarm).toBe(r.sameState.alarm); noWrites(r.afterDenial);
    expect(r.malformed.status).toBe(400); expect(r.wrongMethod.status).toBe(405);
    expect(r.many.every(x => x.status === 200)).toBe(true); expect(r.many.filter(x => x.allowed)).toHaveLength(100);
    expect(r.many.filter(x => !x.allowed)).toHaveLength(25); expect(r.manyState.entries).toHaveLength(1);
    expect(state(r.manyState)?.count).toBe(100); expect(Object.keys(state(r.manyState)!.sources)).toHaveLength(100);
    expect(Object.keys(state(r.manyState)!.sources).every(key => /^[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(r.manyState.entries)).byteLength).toBeLessThan(8000);
    expect(r.globalDenial).toMatchObject({ status: 200, allowed: false, remaining: 0 });
    expect(r.afterGlobalDenial.entries).toEqual(r.manyState.entries); expect(r.afterGlobalDenial.alarm).toBe(r.manyState.alarm); noWrites(r.afterGlobalDenial);
    expect(r.stale.entries).toEqual(r.manyState.entries); expect(r.stale.alarm).toBe(r.manyState.alarm);
    expect(r.resetAdmission).toMatchObject({ status: 200, allowed: true, remaining: 9 }); expect(state(r.resetState)?.count).toBe(1);
    expect(r.resetState.alarm).toBe(r.resetAdmission.resetTime);
    expect(r.genericStatus).toBe(200); expect(state(r.expired)).toBeUndefined(); expect(r.expired.alarm).toBeNull();
    expect(r.expired.entries).toHaveLength(1); expect(r.expired.entries[0]![0]).toMatch(/^window:/);
    for (const invalid of r.malformedStates) { expect(invalid.response.status).toBe(500); noWrites(invalid.state); }
    expect(r.fault.status).toBe(500); expect(state(r.faultState)).toBeUndefined(); expect(r.faultState.alarm).toBeNull();
    expect(r.attempts).toEqual(Array(10).fill(401)); expect(r.blocked).toBe(429); expect(r.beforeGood).toEqual({ audit: 0, sessions: 0 });
    expect(r.good).toBe(200); expect(r.fill).toBe(89);
    expect(r.deniedEffects).toEqual({ status: 429, bodyReads: 0, calls: [], audit: ['sign_in'] });
    expect(r.recovery).toEqual([200, 200, 200]); expect(r.recoveryAfter).toEqual(r.recoveryBefore);
    expect(r.recovered).toBe(200); expect(r.unavailableEffects).toEqual({ status: 503, bodyReads: 0, calls: [] });
    console.info('W02.05 native login budget', JSON.stringify({ sameSource: [10, 15], distinctSources: [100, 25],
      stateKeys: r.manyState.entries.length, counters: Object.keys(state(r.manyState)!.sources).length,
      deniedWrites: r.afterGlobalDenial.metrics, rollback: r.fault.status, recovery: r.recovery, elapsedMs: r.elapsedMs }));
  }, 30_000);

  it.each(malformed.filter(([name]) => ['sub absent', 'sub blank', 'sub number', 'roles substring', 'permissions mixed'].includes(name)))(
    '%s has zero protected effects in workerd', async (_name, payload) => {
      denied(await workerdCurrent({ payload, ops: protectedOps }), protectedOps.length);
    }, 30_000);

  it.each(malformed.filter(([name]) => ['sub absent', 'roles substring', 'permissions mixed'].includes(name)))(
    'composed original verifier reproduces %s in workerd', async (label, payload) => {
      const result = await workerdBefore({ payload, mode: 'open', ops: mutationOps });
      const configAllowed = label !== 'sub absent';
      expect(result.results.map((r) => r.status)).toEqual([200, 200, 200, 201, ...Array(3).fill(configAllowed ? 200 : 403)]);
      expect(result.results[0]!.calls).toEqual(['ACCOUNTS.getById']);
      expect(result.results[2]!.calls).toEqual(['ACCOUNTS.list']);
      expect(result.accountCount).toBe(2); expect(result.config).toMatchObject({ revision: configAllowed ? 4 : 1, K: 3 });
      expect(result.calls.filter((c) => c === 'CACHE.put')).toHaveLength(0); expect(result.calls.filter(c => c === 'STORAGE.commit')).toHaveLength(configAllowed ? 3 : 0);
      if (!configAllowed) result.results.slice(4).forEach(r => expect(r.stateUnchanged).toBe(true));
      expect(result.audit.at(-1)?.action).toBe('account_created');
      console.log('W02.03 original workerd ' + JSON.stringify({ label, statuses: result.results.map((r) => r.status), publicationCommits: configAllowed ? 3 : 0, accountCount: result.accountCount }));
    }, 30_000);

  it('retains actual issued selfservice/config/renewal while enforced global account administration is withdrawn', async () => {
    const result = await workerdCurrent({ credential: 'access', ops: [...mutationOps,
      { path: '/auth/refresh', method: 'POST', credential: 'none', body: 'renew' },
      { path: '/auth/me', credential: 'renewed' }, { path: '/auth/me', credential: 'refresh' }] });
    expect(result.results.map((r) => r.status)).toEqual([200, 200, 403, 403, 200, 200, 200, 200, 200, 401]);
    expect(result.results[0]!.accountId).toBe('fixture-account'); expect(result.results[8]!.accountId).toBe('fixture-account');
    expect(result.results[9]!.calls).toEqual([]); expect(result.results[9]!.auth).toBeNull();
    expect(result.accountCount).toBe(1); expect(result.config).toMatchObject({ revision: 4, K: 3 });
    for (const r of result.results.slice(2, 4)) {
      expect(r.calls).toEqual(['ACCOUNTS.getSession', 'ACCOUNTS.getById']); expect(r.bodyReads).toBe(0); expect(r.stateUnchanged).toBe(true);
    }
    expect(result.calls.filter((c) => c === 'CACHE.put')).toHaveLength(0); expect(result.calls.filter(c => c === 'STORAGE.commit')).toHaveLength(3);
  }, 30_000);

  it('preserves raw subjects/typed no-role tools and independent SDK without account I/O', async () => {
    const payload = { sub: ' \t客户 runtime ', roles: [], permissions: ['*', '', 'unknown'] };
    const result = await workerdCurrent({ payload, grantedSubjects: [payload.sub], ops: [...gateOps,
      { path: configPath, method: 'PATCH', body: { patch: { K: 11 } } },
      { path: '/v1/acme/probe', credential: 'none', headers: { 'X-SDK-Key': 'synthetic-sdk' } },
      { path: '/v1/acme/probe', credential: 'none', headers: { 'X-SDK-Key': 'wrong-sdk' } }] });
    expect(result.results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 422, 200, 401]);
    for (const r of result.results.slice(0, 5)) {
      expect(r.auth?.user).toMatchObject(payload); expect(r.bindingReads).toEqual([]);
    }
    expect(result.config).toMatchObject({ revision: 1, K: 3 }); expect(result.results[5]!.stateUnchanged).toBe(true);
    expect(result.calls.filter(c => c === 'STORAGE.commit')).toEqual([]);
    expect(result.results[6]!.bindingReads).toEqual([]); expect(result.results[6]!.auth).toBeNull();
  }, 30_000);
});
