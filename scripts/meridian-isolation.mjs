// Both demos alive in one worker, at the same time. Isolation proven, not assumed.
// The Coach surface (/realtime) is behind the SDK-key gate when AUTH_MODE=enforced. The
// demo pages carry this same site key in a <meta>; the script carries it here. Harmless in open mode.
const SDK_KEY=process.env.SDK_KEY || 'demo-site';
const B=process.env.MERIDIAN_BASE || 'http://127.0.0.1:8799';
let pass=0, fail=0;
const ok=(n,c,d='')=>{ (c?pass++:fail++); console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
const j=(u,o)=>fetch(u,o).then(r=>r.json());
const MRD='mrd-iso-'+Date.now(), COA='coach-iso-'+Date.now();

console.log('\n── both surfaces serve ─────────────────────────────');
for (const [name,path] of [['Coach storefront','/storefront'],['Meridian','/meridian/'],['Bank demo','/visual-demo']]) {
  const r = await fetch(B+path); ok(`${name} still serves`, r.status===200, `${r.status}`);
}

console.log('\n── drive BOTH engines, interleaved ─────────────────');
// Meridian visitor
for (let i=0;i<4;i++) await j(`${B}/meridian/api/action`,{method:'POST',headers:{'Content-Type':'application/json','X-SDK-Key':SDK_KEY},
  body:JSON.stringify({visitorId:MRD,vertical:'retail',events:[{action:'view',touches:[{dim:'category',value:'Outerwear'}]}]})});
// Coach visitor through the SHARED pipeline, at the same time
const coach = await j(`${B}/realtime/action`,{method:'POST',headers:{'Content-Type':'application/json','X-SDK-Key':SDK_KEY},
  body:JSON.stringify({type:'product_view',userId:COA,data:{productId:'COA-CH857'},source:'storefront'})});

const mrd = await j(`${B}/meridian/api/snapshot?visitorId=${MRD}`);
ok('Meridian learned', mrd.affinity?.audiences?.length>0, mrd.affinity?.audiences?.join(','));
ok('Coach pipeline still answers', Boolean(coach?.success ?? coach?.update ?? coach?.sessionId), Object.keys(coach||{}).slice(0,4).join(','));

const mAud = new Set(mrd.affinity?.audiences ?? []);
const cAud = new Set(coach?.update?.segments ?? coach?.segments ?? []);
ok('no Meridian audience in Coach', ![...mAud].some(a=>cAud.has(a)), `coach: ${[...cAud].slice(0,3).join(',')||'(none)'}`);
ok('no Coach audience in Meridian', ![...cAud].some(a=>mAud.has(a)));

console.log('\n── the audience stores are separate ────────────────');
const ops = await j(`${B}/operator/audiences`).catch(()=>null);
const names = (ops?.audiences ?? ops ?? []).map?.(a=>a.key||a.id||a.name) ?? [];
ok('Coach operator store has no mrd_ keys', !names.some(n=>String(n).startsWith('mrd_')), `${names.length} audiences listed`);

console.log('\n── Coach reset must not touch Meridian ─────────────');
await fetch(`${B}/realtime/session/reset`,{method:'POST',headers:{'Content-Type':'application/json','X-SDK-Key':SDK_KEY},body:JSON.stringify({userId:COA})});
const after = await j(`${B}/meridian/api/snapshot?visitorId=${MRD}`);
ok('Meridian survives Coach "new shopper"', after.affinity?.audiences?.length>0, after.affinity?.audiences?.join(','));

console.log('\n── Meridian reset must not touch Coach ─────────────');
await j(`${B}/meridian/api/reset`,{method:'POST',headers:{'Content-Type':'application/json','X-SDK-Key':SDK_KEY},body:JSON.stringify({visitorId:MRD})});
const coach2 = await j(`${B}/realtime/action`,{method:'POST',headers:{'Content-Type':'application/json','X-SDK-Key':SDK_KEY},
  body:JSON.stringify({type:'product_view',userId:COA,data:{productId:'COA-CH857'},source:'storefront'})});
ok('Coach unaffected by Meridian reset', Boolean(coach2?.success ?? coach2?.sessionId));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
