#!/usr/bin/env bash
# Explicit connectivity probe only; signed session and explicit refusal.
set -eu
node --input-type=module - "${1:?platform base}" "${2:?page origin}" "${3:?site key}" "${4:-coach}" <<'JS'
import http from 'node:http';
import https from 'node:https';
const [input,origin,key,tenant]=process.argv.slice(2),base=input.replace(/\/+$/,''),url=new URL(base);
if((url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))||url.username||url.password||url.search||url.hash||new URL(origin).origin!==origin||!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(tenant))throw Error('Invalid probe target');
let failures=0;
const check=(name,ok)=>{console.log((ok?'PASS ':'FAIL ')+name);if(!ok)failures++;};
const site={'Content-Type':'application/json','X-SDK-Key':key,'X-Tenant':tenant,Origin:origin};
async function call(path,options={}){
 const response=await fetch(base+path,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});
 let bytes=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true}),reader=response.body?.getReader();
 if(reader)try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>262144)throw Error('Probe response bound');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{void reader.cancel().catch(()=>{});}
 let json;try{json=JSON.parse(text);}catch{/* safe shape refusal */}return {response,json};
}
try{
 const ready=await call('/health/ready');check('signing readiness only',ready.response.status===200);
 const pre=await call('/realtime/action',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-sdk-key,x-tenant,x-shopper-session'}});
 const allowed=(pre.response.headers.get('Access-Control-Allow-Headers')??'').toLowerCase().split(',').map(x=>x.trim());
 check('credentialed browser preflight',pre.response.headers.get('Access-Control-Allow-Origin')===origin&&pre.response.headers.get('Access-Control-Allow-Credentials')==='true'&&['content-type','x-sdk-key','x-tenant','x-shopper-session'].every(x=>allowed.includes(x)));
 const boot=await call('/v1/'+tenant+'/identity/session',{method:'POST',headers:site,body:'{}'}),s=boot.json?.session;
 check('signed anonymous session',boot.response.status===200&&typeof s?.capability==='string'&&typeof s?.subject==='string'&&typeof s?.sessionId==='string');if(!s?.capability)throw Error('Session unavailable');
 const headers={...site,'X-Shopper-Session':s.capability};
 const consent=await call('/realtime/session/preferences',{method:'POST',headers,body:JSON.stringify({trackingConsent:false,personalizationEnabled:false,choice:{id:crypto.randomUUID(),expectedRevision:s.consent?.instruction?.revision??null,grantId:s.grantId,iat:s.iat,exp:s.exp}})});
 check('explicit refusal preserved',consent.response.status===200&&consent.json?.consent?.tracking===false&&consent.json?.consent?.personalization===false);
 const path='/v1/'+tenant+'/decisions/snapshot',snapshotBody=JSON.stringify({page:'home'});
 const snapshot=await call(path,{method:'POST',body:snapshotBody,headers});check('signed default decisions',snapshot.response.status===200&&Array.isArray(snapshot.json?.decisions)&&snapshot.json?.write===false);
 const noKey=await call(path,{method:'POST',body:snapshotBody,headers:{Origin:origin,'Content-Type':'application/json','X-Tenant':tenant,'X-Shopper-Session':s.capability}});check('site key required',noKey.response.status===401||noKey.response.status===403);
 const wrong=await call(path,{method:'POST',body:snapshotBody,headers:{...headers,'X-SDK-Key':'not-a-site-key'}});check('wrong site key refused',wrong.response.status===401||wrong.response.status===403);
 const event=await call('/realtime/action',{method:'POST',headers,body:JSON.stringify({type:'page_view',source:'verify-origin',userId:s.subject,sessionId:s.sessionId,eventId:crypto.randomUUID(),timestamp:Date.now(),data:{pageType:'home'}})});
 check('signed event under refusal',event.response.status===200&&event.json?.success===true);
 const socket=new URL(base+'/realtime/ws');socket.searchParams.set('tenant',tenant);
 const protocols=['shopper-session-v1',s.capability,'sdk-key-v1.'+Buffer.from(key,'utf8').toString('base64url')];
 const upgraded=await new Promise(resolve=>{
  let settled=false;const finish=value=>{if(settled)return;settled=true;clearTimeout(deadline);resolve(value);};
  const request=(socket.protocol==='https:'?https:http).request(socket,{headers:{Origin:origin,Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ==','Sec-WebSocket-Protocol':protocols.join(', ')}});
  const deadline=setTimeout(()=>{request.destroy();finish(false);},10000);
  request.on('error',()=>finish(false));request.on('upgrade',(response,connection)=>{connection.destroy();finish(response.statusCode===101);});request.on('response',response=>{response.resume();finish(false);});request.end();
 });check('signed live-channel handshake',upgraded);
}catch{check('bounded probe completed',false);}
console.log(failures?'CONNECTIVITY INCOMPLETE':'CONNECTIVITY PASS — not customer, provider or business acceptance');process.exitCode=failures?1:0;
JS
