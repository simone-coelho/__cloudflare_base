// Full run of show, one visitor, one session. Every beat asserted.
const B=process.env.MERIDIAN_BASE || 'http://127.0.0.1:8799', API=`${B}/meridian/api`;
const VID='mrd-rehearsal-'+Date.now();
let pass=0, fail=0;
const ok=(n,c,d='')=>{ (c?pass++:fail++); console.log(`  ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
const post=(p,b)=>fetch(API+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visitorId:VID,...b})}).then(r=>r.json());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const frames=[];
const ws=new WebSocket(`${B.replace(/^http/,'ws')}/meridian/api/ws?visitorId=${VID}&vertical=retail`);
ws.onmessage=e=>frames.push(JSON.parse(e.data));
await new Promise(r=>{ws.onopen=r;});

console.log('\n── BEAT 1  cold start ───────────────────────────────');
const cs=await fetch(`${API}/coldstart?vertical=retail&region=CA`).then(r=>r.json());
ok('census is real + citable', cs.census?.source?.includes('ACS'), cs.census?.source);
ok('prior derived, not invented', cs.prior?.dim==='priceBand' && cs.honesty.prior==='derived-from-census');
await post('/action',{vertical:'retail',events:[{action:'prior',touches:[{dim:cs.prior.dim,value:cs.prior.value}]}]});

console.log('\n── BEAT 2-3  signal → threshold ─────────────────────');
let r=await post('/action',{vertical:'retail',events:[{action:'row_click',itemId:'MRD-R010'}]});
ok('one click moves a dimension', Object.keys(r.affinity.dims).length>0);
for(let i=0;i<3;i++) r=await post('/action',{vertical:'retail',events:[{action:'view',touches:[{dim:'category',value:'Outerwear'}]}]});
ok('category crossed θin', r.affinity.audiences.includes('category_outerwear_affinity'), `a=${r.affinity.dims.category.Outerwear.toFixed(3)}`);
ok('frame pushed on entry', frames.some(f=>f.changes.entered.length));
ok('explain record carries thresholds', frames.some(f=>f.explain?.some(e=>e.thetaIn&&e.thetaOut)));
ok('raw state shipped for adoption', Boolean(r.state?.dims), 'client can keep decaying');

console.log('\n── BEAT 7  search ──────────────────────────────────');
const s1=await fetch(`${API}/search`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vertical:'retail',query:'the weather turned cold this week'})}).then(x=>x.json());
ok('routed inside the closed set', ['cold-snap'].includes(s1.scene?.id), `${s1.source} ${s1.ms}ms`);
const scenes=await fetch(`${API}/scenes?vertical=retail`).then(x=>x.json());
ok('scene is from the served set', scenes.scenes.some(x=>x.id===s1.scene.id), `${scenes.scenes.length} approved`);

console.log('\n── BEAT 8  experiment ──────────────────────────────');
const ex=await post('/experiment/dispatch',{vertical:'retail',source:'tiktok'});
ok('real experiment, not simulated', ex.ok && !ex.simulated, ex.reason);
ok('reports created-vs-reused honestly', typeof ex.created==='boolean', `created=${ex.created}`);

console.log('\n── BEAT 9  the swap ────────────────────────────────');
const beforeSwap=r.affinity.audiences.slice();
const sw=await post('/vertical',{vertical:'financial'});
ok('vector reset on swap', Object.keys(sw.affinity.dims).length===0);
ok('registry is the financial one', sw.configVersion.includes('financial'), sw.configVersion);
const fc=await fetch(`${API}/catalog?vertical=financial`).then(x=>x.json());
const keys=fc.registry.dimensions.map(d=>d.key);
ok('eight bars, relabelled not reordered', keys.length===8 && keys[0]==='productFamily' && keys[3]==='lifeStage' && keys[4]==='tier', keys.join(','));
let f=null;
for(let i=0;i<3;i++) f=await post('/action',{vertical:'financial',events:[{action:'view',touches:[{dim:'productFamily',value:'Savings'}]}]});
ok('financial audience minted', f.affinity.audiences.some(a=>a.startsWith('productfamily_')), f.affinity.audiences.join(','));
ok('NO retail audience leaked through', !f.affinity.audiences.some(a=>beforeSwap.includes(a)), `retail had: ${beforeSwap.join(',')}`);
const fs=await fetch(`${API}/search`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vertical:'financial',query:'buying our first house'})}).then(x=>x.json());
ok('search uses the financial scene set', fs.scene?.id==='first-home', fs.scene?.id);

console.log('\n── BEAT 10  reset ──────────────────────────────────');
await post('/reset',{});
const snap=await fetch(`${API}/snapshot?visitorId=${VID}`).then(x=>x.json());
ok('reset leaves nothing behind', snap.empty===true || !snap.affinity?.audiences?.length);

console.log(`\n  ${pass} passed, ${fail} failed`);
ws.close(); process.exit(fail?1:0);
