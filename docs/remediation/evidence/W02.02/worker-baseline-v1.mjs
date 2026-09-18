// Exact read-only preflight run in memory before implementation. The original
// three source inputs are retained in lead-owned before-source.json. Replaying
// that original source after implementation is covered by workerd-boundary.mjs.
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
const wrapper = `
import { Hono } from 'hono';
import { authRoutes } from './src/routes/auth.ts';
import { healthRoutes } from './src/routes/health.ts';
import { memoryStore } from './src/auth/store.ts';
export default { async fetch(request) {
 const input = await request.json();
 const store = memoryStore(), calls = [], access = [];
 const user = {id:'synthetic-ops', email:'operator@example.invalid', name:'Synthetic', password:'synthetic password 123', roles:['admin'], permissions:['*']};
 const cache = new Map([['user:'+user.email, JSON.stringify(user)],['user_id:'+user.id,JSON.stringify(user)]]);
 const accounts = new Proxy(store,{get(t,k) {const v=t[k];return typeof v==='function'?async (...a)=>{calls.push('ACCOUNTS.'+String(k));return v.apply(t,a)}:v;}});
 const env = new Proxy({JWT_SECRET:input.secret, JWT_ISSUER:'synthetic-issuer', JWT_AUDIENCE:'synthetic-audience', ACCOUNTS:accounts, CACHE:{async get(k,type){calls.push('CACHE.get');let v=cache.get(k);return v===undefined?null:type==='json'?JSON.parse(v):v},async delete(k){calls.push('CACHE.delete');cache.delete(k)}}},{get(t,k){access.push(String(k));return t[k]}});
 const app = new Hono(); app.route('/auth',authRoutes);app.route('/health',healthRoutes);app.onError(()=>new Response('Signing failed',{status:500}));
 const ready = await app.request('https://synthetic.invalid/health/ready',{},env);
 const login = await app.request('https://synthetic.invalid/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:user.email,password:user.password})},env);
 const result={case:input.label,ready:ready.status,login:login.status,calls,accountCount:store.users.size,sessionCount:store.sessions.size,legacyKeys:cache.size,audit:store.log.map(x=>x.action),storeBindingReads:access.filter(x=>['ACCOUNTS','CACHE','DB'].includes(x))};
 return Response.json(result);
}};`;
const bundle = await build({stdin:{contents:wrapper,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',conditions:['workerd','worker','browser'],logLevel:'silent'});
let outbound=0;
const runtime=new Miniflare({modules:[{type:'ESModule',path:'baseline.mjs',contents:bundle.outputFiles[0].text}],compatibilityDate:'2025-06-01',outboundService(){outbound++;throw new Error('Forbidden outbound');}});
try {
 await runtime.ready;
 for(const [label,secret] of [['missing',undefined],['empty',''],['published-placeholder','development-secret-key-change-in-production'],['short','s'],['valid','w0202-synthetic-signing-material-32bytes']]){
 const res=await runtime.dispatchFetch('http://local.invalid/probe',{method:'POST',body:JSON.stringify({label,secret})});console.log(await res.text());
 }
 console.log(JSON.stringify({outboundAttempts:outbound}));
}finally{await runtime.dispose();}
