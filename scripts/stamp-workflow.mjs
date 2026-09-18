#!/usr/bin/env node
// Explicit local packaging and separately authorized stamp maintenance. Importing
// this file performs no I/O. Provider calls are bounded, never automatically retried.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { createRequire, builtinModules } from 'node:module';
import { open, lstat, realpath, readFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { dirname, resolve, extname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { safeIdentitySecret, parseIdentitySecrets } from '../src/identity/material.mjs';
import { readSigningConfig } from '../src/auth/signingConfig.mjs';
import { bootstrapExactOwner, validateExactOwner } from './operator-seed.mjs';
import { verifySDK, sdkBuildOptions, sdkOptionsForVersion } from './build-sdk.mjs';
import { verifyMeridian, meridianBuildOptions } from './build-meridian.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const API = 'https://api.cloudflare.com/client/v4';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{32}$/;
const SHA = /^[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const fail = () => { throw new Error('Stamp workflow unavailable'); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const canonical = v => JSON.stringify(v, (_, x) => object(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
export const sha256 = v => createHash('sha256').update(v).digest('hex');
const digest = v => sha256(canonical(v));
const same = (a, b) => canonical(a) === canonical(b);
const exact = (v, keys) => object(v) && same(Object.keys(v).sort(), [...keys].sort());
const LEGACY_MIGRATIONS = ['0010_operator_accounts.sql', '0011_operator_audit_tenant.sql', '0012_operator_authority.sql'];
export const MIGRATIONS = [...LEGACY_MIGRATIONS, '0013_operator_oidc.sql'];
const LEGACY_MIGRATION_HASHES = ['7ae6cd7d5d84f70533b3501ec93a9b4d40e360229ec95577f8ed1e92fc858d55','d279d332fbc0fdbdcfe5ad1dad2cb8347a056ee85ea9b975127dd3cf40e2074c','63143e1690f1be2bb331b547cf8d48716d6583fcefacf3353c9274075fd187b7'];
const MIGRATION_HASHES = [...LEGACY_MIGRATION_HASHES, 'e1552f65360331264bbb49c2ae896356a349fa75416c797a430a637ef19b5067'];
const LEGACY_SECURITY_TABLES = ['operator_accounts', 'operator_sessions', 'operator_audit', 'operator_memberships', 'operator_service_credentials', 'operator_recovery_requests'];
export const SECURITY_TABLES = [...LEGACY_SECURITY_TABLES, 'operator_oidc_links', 'operator_oidc_epoch', 'operator_oidc_transactions', 'operator_oidc_sessions', 'operator_oidc_completions'];
const oidcSchema = artifact => artifact.schemaContract === 'operator-oidc-v2';
const migrationsFor = artifact => oidcSchema(artifact) ? MIGRATIONS : LEGACY_MIGRATIONS;
const securityTablesFor = artifact => oidcSchema(artifact) ? SECURITY_TABLES : LEGACY_SECURITY_TABLES;
const LEGACY_ASSETS = ['console/index.html', 'console/shell.js', 'console/views.js', 'console/views-config.js',
  'console/views-measure.js', 'console/views-accounts.js', 'console/views-explore.js', 'operator-session.js',
  'sdk/edge-personalization.js', 'sdk/edge-personalization.esm.js', 'tuning.html', 'learning.html'].sort();
export const ASSETS = [...LEGACY_ASSETS, 'sdk/debug.js'].sort();
const SECRETS = ['JWT_SECRET', 'SDK_KEYS', 'IDENTITY_SALT', 'IDENTITY_SECRETS', 'ALERT_WEBHOOK_URL'];
const connectorRef = v => typeof v === 'string' && /^CONNECTOR_SECRET_[A-Z0-9_]{1,80}$/.test(v);
const integer = (v,min,max) => Number.isSafeInteger(v) && v>=min && v<=max;
function oidcReferences(d) {
  if(d.vars.OPERATOR_OIDC===undefined)return [];
  let registry;try{registry=JSON.parse(d.vars.OPERATOR_OIDC);}catch{fail();}
  if(!exact(registry,['version','tenants'])||registry.version!==1||!object(registry.tenants)
    ||Object.keys(registry.tenants).some(t=>!d.tenants.provisioned.includes(t)))fail();
  const refs=new Set(),https=(v,canonicalEndpoint=false)=>{if(typeof v!=='string'||!v||v.length>1024||v.trim()!==v)return false;
    try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&(!canonicalEndpoint||u.href===v);}catch{return false;}};
  for(const c of Object.values(registry.tenants)){
    if(exact(c,['enabled'])&&c.enabled===false)continue;
    if(!exact(c,['enabled','issuer','authorizationEndpoint','tokenEndpoint','jwksUri','origin','clientId','clientSecretRef','algorithms','transactionMs','sessionMs','reauthMs','timeoutMs'])
      ||c.enabled!==true||!https(c.issuer)||!['authorizationEndpoint','tokenEndpoint','jwksUri','origin'].every(k=>https(c[k],true))
      ||new URL(c.origin).origin+'/'!==c.origin||!d.origins.includes(new URL(c.origin).origin)
      ||typeof c.clientId!=='string'||!c.clientId||c.clientId.length>200||typeof c.clientSecretRef!=='string'||!/^OPERATOR_OIDC_SECRET_[A-Z0-9_]{1,80}$/.test(c.clientSecretRef)
      ||!Array.isArray(c.algorithms)||!integer(c.algorithms.length,1,2)||new Set(c.algorithms).size!==c.algorithms.length||c.algorithms.some(a=>!['RS256','ES256'].includes(a))
      ||!integer(c.transactionMs,30000,300000)||!integer(c.sessionMs,60000,86400000)||!integer(c.reauthMs,60000,86400000)||!integer(c.timeoutMs,100,10000))fail();
    const material=d.secrets[c.clientSecretRef];if(typeof material!=='string'||material.trim()!==material||material.length<32||material.length>4096)fail();
    refs.add(c.clientSecretRef);
  }
  return [...refs].sort();
}
function connectorReferences(d) {
  let registry;try{registry=JSON.parse(d.vars.TENANT_CONNECTORS);}catch{fail();}
  const refs=new Set();
  for(const entry of Object.values(registry.tenants??{}))for(const purpose of ['enrichment','search','catalogSearch','warehouse']){
    const c=entry[purpose];if(c===undefined)continue;
    const ref=c[purpose==='warehouse'?'keyPairRef':purpose==='catalogSearch'?'tokenRef':'apiKeyRef'];
    if(!connectorRef(ref))fail();refs.add(ref);
  }
  return [...refs].sort();
}
function validateConfiguredPurpose(c,purpose) {
  const label=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(v),meaning=v=>typeof v==='string'&&v.length>=1&&v.length<=500;
  const name=v=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
  const https=v=>{if(typeof v!=='string')return false;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search&&v.length<=1024;}catch{return false;}};
  if(!object(c)||c.version!==1||c.enabled!==true||!exact(c.approval,['egress','metering','providerRetention'])
    ||!Object.values(c.approval).every(label)||!integer(c.timeoutMs,100,30000)||!integer(c.responseBytes,1024,2*1024*1024))fail();
  if(purpose==='catalogSearch'){
    if(!exact(c,['version','enabled','url','tokenRef','approval','mappingRevision','timeoutMs','responseBytes','maxPages','maxCandidates','maxAgeMs'])
      ||!https(c.url)||!connectorRef(c.tokenRef)||!label(c.mappingRevision)||!integer(c.maxPages,1,10)||!integer(c.maxCandidates,1,500)||!integer(c.maxAgeMs,1,300000))fail();
  }else if(purpose==='warehouse'){
    if(!exact(c,['version','enabled','provider','account','origin','user','keyPairRef','database','schema','warehouse','role','procedure','identityNamespace','mappingRevision','approval','cadenceMs','startAt','timeoutMs','responseBytes','maxObjects','maxRows','maxBytes'])
      ||c.provider!=='snowflake-sql-api'||typeof c.account!=='string'||!/^[A-Z0-9][A-Z0-9_-]{0,100}$/.test(c.account)||!https(c.origin)||new URL(c.origin).pathname!=='/'
      ||!/^[a-z0-9][a-z0-9.-]*\.snowflakecomputing\.com$/.test(new URL(c.origin).hostname)
      ||!['user','database','schema','warehouse','role'].every(k=>typeof c[k]==='string'&&/^[A-Z][A-Z0-9_]{0,127}$/.test(c[k]))||!connectorRef(c.keyPairRef)
      ||c.procedure!=='APPLY_DELIVERY_V1'||!label(c.identityNamespace)||!label(c.mappingRevision)||!integer(c.cadenceMs,60000,86400000)
      ||!integer(c.startAt,0,Number.MAX_SAFE_INTEGER)||!integer(c.maxObjects,1,100)||!integer(c.maxRows,1,1000)||!integer(c.maxBytes,2*1024*1024,4*1024*1024))fail();
  }else{
    const extra=purpose==='search'?['currency','priceMinorUnits','priceSource','giftMeaning']:['fields',...(Object.hasOwn(c,'images')?['images']:[])];
    if(!exact(c,['version','enabled','provider','baseURL','apiKeyRef','model','approval','timeoutMs','requestBytes','responseBytes','maxOutputTokens','taxonomy',...extra])
      ||c.provider!=='google'||c.baseURL!=='https://generativelanguage.googleapis.com/v1beta'||!connectorRef(c.apiKeyRef)
      ||typeof c.model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(c.model)||!integer(c.requestBytes,1024,2*1024*1024)||!integer(c.maxOutputTokens,64,32768)
      ||!Array.isArray(c.taxonomy)||!integer(c.taxonomy.length,1,32)||new Set(c.taxonomy.map(t=>t.dimension)).size!==c.taxonomy.length)fail();
    for(const t of c.taxonomy)if(!exact(t,['dimension','meaning','values'])||!name(t.dimension)||!meaning(t.meaning)||!Array.isArray(t.values)
      ||!integer(t.values.length,1,200)||new Set(t.values.map(v=>v.value)).size!==t.values.length||t.values.some(v=>!exact(v,['value','meaning'])||!label(v.value)||!meaning(v.meaning)))fail();
    if(purpose==='search'){if(typeof c.currency!=='string'||!/^[A-Z]{3}$/.test(c.currency)||!integer(c.priceMinorUnits,0,4)||!name(c.priceSource)||!meaning(c.giftMeaning))fail();}
    else{
      if(!Array.isArray(c.fields)||!integer(c.fields.length,1,5)||new Set(c.fields).size!==c.fields.length||c.fields.some(f=>!['title','excerpt','subtitle','type','tags'].includes(f)))fail();
      if(Object.hasOwn(c,'images')&&(!exact(c.images,['field','origins','maxBytes','maxImages'])||!name(c.images.field)||!Array.isArray(c.images.origins)
        ||!integer(c.images.origins.length,1,8)||c.images.origins.some(v=>!https(v)||new URL(v).pathname!=='/')||!integer(c.images.maxBytes,1,512*1024)||!integer(c.images.maxImages,1,16)))fail();
    }
  }
}
function validateWarehouseMaterial(value) {
  try {
    const v=JSON.parse(value);
    if(!exact(v,['privateKey','publicKeyFingerprint'])||typeof v.privateKey!=='string'||typeof v.publicKeyFingerprint!=='string'
      ||!/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----$/.test(v.privateKey))fail();
    const key=createPrivateKey({key:v.privateKey,format:'pem',type:'pkcs8'});
    if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<2048)fail();
    const fingerprint='SHA256:'+createHash('sha256').update(createPublicKey(key).export({format:'der',type:'spki'})).digest('base64');
    if(v.publicKeyFingerprint!==fingerprint)fail();
  } catch { fail(); }
}
const DO_BINDINGS = { RATE_LIMITER: 'RateLimiter', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket',
  SHOPPER_REFLEX: 'ShopperReflex', REGION_TREND: 'RegionTrend', DECISION_RING: 'DecisionRing', LEARN_STATS: 'LearnStats' };
// Runtime namespace calls have no static import edge to their bound class. Pin
// every customer binding, ingress and background entry, then its real imports.
// The dispatcher remains pinned, without making omitted demo code a barrier.
export const SECURITY_ROOTS = ['src/index.ts', 'src/customerBoundary.ts', 'src/middleware/auth.ts', 'src/middleware/edgeAccess.ts',
  'src/middleware/error.ts', 'src/middleware/request-id.ts', 'src/tenancy/middleware.ts',
  ...['auth','realtime','identity','operator','config','sort','content','decisions','health','geo'].map(x=>'src/routes/'+x+'.ts'),
  'src/auth/store.ts', 'src/auth/authority.ts', 'src/auth/loginBudget.ts', 'src/identity/sessionAuthority.ts',
  'src/identity/erase.ts', 'src/identity/consentContinuity.ts', 'src/ledger/erasure.ts', 'src/ledger/consume.ts',
  'src/ledger/recovery.ts', 'src/ledger/quarantine.ts', 'src/routes/ledgerRecovery.ts',
  'src/ops/monitor.ts', 'src/learn/hourly.ts', 'src/reflex/regionTrend.ts', 'src/content/consent.ts', 'src/services/SessionManager.ts',
  ...Object.values(DO_BINDINGS).map(x=>'src/durable-objects/'+x+'.ts')];
const CRONS = ['*/5 * * * *', '0 * * * *', '0 3 * * *'];
const recoveryWired = d => Object.hasOwn(d.vars, 'LEDGER_RECOVERY_CONFIG');
const recoveryQueues = d => recoveryWired(d) ? ['queue', 'deadLetter'] : ['queue'];
function requireIntakePolicies(d) {
  if (!recoveryWired(d)) return;
  const recovery = JSON.parse(d.vars.LEDGER_RECOVERY_CONFIG), retention = JSON.parse(d.vars.RETENTION);
  // Intake remains a reader while producers are off. Attaching/resuming it
  // without capture authority would knowingly exhaust retries and lose cases.
  if (!recovery.unknown || d.tenants.provisioned.some(tenant =>
    ['ledger', 'online', 'recovery', 'quarantine'].some(category => !retention.tenants[tenant]?.[category]))) fail();
}
const MAX = 64 * 1024 * 1024;
const pin = (path, bytes) => ({ path, bytes: bytes.length, sha256: sha256(bytes) });
const blob = (name, bytes, type) => ({ name, type, bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') });
function bytesOf(part) {
  if (!object(part) || typeof part.base64 !== 'string' || !SHA.test(part.sha256) || !Number.isSafeInteger(part.bytes)
    || part.bytes < 0 || part.bytes > MAX) fail();
  const bytes = Buffer.from(part.base64, 'base64');
  if (bytes.toString('base64') !== part.base64 || bytes.length !== part.bytes || sha256(bytes) !== part.sha256) fail();
  return bytes;
}
function host(value) {
  try { const u = new URL('https://' + value);
    return u.hostname === value && !u.port && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password
      && value.length <= 253 && value.split('.').every(x => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x));
  } catch { return false; }
}
function keys(raw, tenants) {
  const table = parseIdentitySecrets(raw, true);
  if (!same([...table.keys()].sort(), [...tenants].sort())) fail();
  return Object.fromEntries(table);
}
export function validateDesired(d) {
  if (!exact(d, ['version', 'customer', 'account', 'environment', 'script', 'resources', 'tenants', 'origins', 'owners', 'vars', 'secrets', 'routes', 'ownership'])
    || d.version !== 1 || !SLUG.test(d.customer) || !HEX.test(d.account) || !['staging', 'production'].includes(d.environment)
    || d.script !== `${d.customer}-${d.environment}` || !SHA.test(d.ownership)) fail();
  if (!exact(d.tenants, ['provisioned', 'hosts']) || !Array.isArray(d.tenants.provisioned) || !d.tenants.provisioned.length
    || d.tenants.provisioned.length > 100 || d.tenants.provisioned.some(x => !SLUG.test(x))
    || new Set(d.tenants.provisioned).size !== d.tenants.provisioned.length || !object(d.tenants.hosts)
    || Object.entries(d.tenants.hosts).some(([h, t]) => !host(h) || !d.tenants.provisioned.includes(t))) fail();
  if (!Array.isArray(d.origins) || !d.origins.length || new Set(d.origins).size !== d.origins.length
    || d.origins.some(x => { try { const u = new URL(x); return u.origin !== x || u.protocol !== 'https:' || !Object.hasOwn(d.tenants.hosts, u.hostname); } catch { return true; } })) fail();
  if (!Array.isArray(d.owners) || !d.owners.length || d.owners.length > 100
    || new Set(d.owners).size !== d.owners.length || d.owners.some(x => typeof x !== 'string' || !/^ops-/.test(x) || !UUID.test(x.slice(4)))) fail();
  const r = d.resources;
  if (!exact(r, ['cache', 'sessions', 'database', 'storage', 'queue', 'deadLetter', 'analytics'])) fail();
  for (const [kind, v] of Object.entries(r)) {
    if (kind === 'analytics') { if (v !== d.script.replaceAll('-', '_') + '_ops_v1') fail(); continue; }
    if (!exact(v, ['name', 'id']) || v.name !== `${d.script}-${kind.toLowerCase()}`
      || (kind === 'storage' ? v.id !== v.name : v.id !== null && !(kind === 'database' ? UUID : HEX).test(v.id))) fail();
  }
  const ids = ['cache', 'sessions', 'database', 'queue', 'deadLetter'].map(k => r[k].id).filter(Boolean);
  const refs = [...connectorReferences(d),...oidcReferences(d)];
  if (new Set(ids).size !== ids.length || !exact(d.secrets, [...SECRETS,...refs]) || refs.some(ref=>typeof d.secrets[ref]!=='string' || !d.secrets[ref] || d.secrets[ref]!==d.secrets[ref].trim() || d.secrets[ref].length>4096)) fail();
  keys(d.secrets.SDK_KEYS, d.tenants.provisioned); keys(d.secrets.IDENTITY_SECRETS, d.tenants.provisioned);
  if (!safeIdentitySecret(d.secrets.IDENTITY_SALT) || !readSigningConfig({ ...d.secrets, ...d.vars })) fail();
  try { const u = new URL(d.secrets.ALERT_WEBHOOK_URL); if (u.protocol !== 'https:' || !host(u.hostname) || u.username || u.password || u.hash) fail(); } catch { fail(); }
  const recoveryVars = ['LEDGER_RECOVERY_ENABLED', 'LEDGER_RECOVERY_CONFIG'];
  if (!exact(d.vars, ['JWT_ISSUER', 'JWT_AUDIENCE', 'REFLEX_HOST', 'RETENTION', 'TENANT_CONNECTORS',
    ...(Object.hasOwn(d.vars,'OPERATOR_OIDC')?['OPERATOR_OIDC']:[]),
    ...(recoveryVars.some(key => Object.hasOwn(d.vars, key)) ? recoveryVars : [])]) || d.vars.JWT_ISSUER !== d.script
    || typeof d.vars.JWT_AUDIENCE !== 'string' || !d.vars.JWT_AUDIENCE.trim() || !['session', 'do'].includes(d.vars.REFLEX_HOST)) fail();
  if (recoveryWired(d)) {
    if (!['false', 'true'].includes(d.vars.LEDGER_RECOVERY_ENABLED)) fail();
    let recovery; try { recovery = JSON.parse(d.vars.LEDGER_RECOVERY_CONFIG); } catch { fail(); }
    if (!exact(recovery, ['version', 'sourceQueue', 'deadLetterQueue', ...(Object.hasOwn(recovery, 'unknown') ? ['unknown'] : [])])
      || recovery.version !== 1 || recovery.sourceQueue !== r.queue.name || recovery.deadLetterQueue !== r.deadLetter.name) fail();
    const p = recovery.unknown;
    if (p !== undefined && (!exact(p, ['id', 'revision', 'durationMs', 'basis', 'renewal', 'disposal'])
      || !/^[A-Za-z0-9_.-]{1,80}$/.test(p.id) || !Number.isSafeInteger(p.revision) || p.revision < 1
      || !Number.isSafeInteger(p.durationMs) || p.durationMs < 1 || p.basis !== 'admitted'
      || p.renewal !== 'new-record-only' || p.disposal !== 'delete-on-expiry')) fail();
    if (d.vars.LEDGER_RECOVERY_ENABLED === 'true' && !p) fail();
  }
  let retention; try { retention = JSON.parse(d.vars.RETENTION); } catch { fail(); }
  if (!exact(retention, ['version', 'tenants']) || retention.version !== 1 || !object(retention.tenants)
    || !same(Object.keys(retention.tenants).sort(), [...d.tenants.provisioned].sort())) fail();
  for (const policies of Object.values(retention.tenants)) {
    if (!object(policies) || ['profile', 'identity', 'ledger', 'online', 'hourly'].some(k => !policies[k])) fail();
    for (const [category, p] of Object.entries(policies)) {
      if (!/^(profile|identity|ledger|online|hourly|recovery|quarantine|external\.(odp|fx|tracking|model|catalog|warehouse)\.[a-f0-9]{64}|telemetry\.(analytics|monitor|alert)\.[a-f0-9]{64})$/.test(category)
        || !exact(p, ['id', 'revision', 'durationMs', 'basis', 'renewal']) || !/^[A-Za-z0-9_.-]{1,80}$/.test(p.id)
        || !Number.isSafeInteger(p.revision) || p.revision < 1 || !Number.isSafeInteger(p.durationMs) || p.durationMs < 1
        || !['occurred', 'admitted'].includes(p.basis) || p.renewal !== 'new-record-only') fail();
    }
    if (d.vars.LEDGER_RECOVERY_ENABLED === 'true' && (!policies.recovery || !policies.quarantine)) fail();
  }
  let connectors;try{connectors=JSON.parse(d.vars.TENANT_CONNECTORS);}catch{fail();}
  if(!exact(connectors,['version','tenants'])||connectors.version!==1||!object(connectors.tenants)
    ||!same(Object.keys(connectors.tenants).sort(),[...d.tenants.provisioned].sort()))fail();
  const key=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(v);
  for(const tenant of d.tenants.provisioned){
    const entry=connectors.tenants[tenant],t=entry?.telemetry;
    if(!exact(entry,['telemetry',...['enrichment','search','catalogSearch','warehouse'].filter(k=>Object.hasOwn(entry,k))])||!exact(t,['environment','schema','analytics','monitor','alert',...(Object.hasOwn(t ?? {},'synthetic')?['synthetic']:[])])||t.environment!==d.environment||t.schema!=='ops-v1'
      ||!exact(t.analytics,['binding','dataset','accessPolicy'])||t.analytics.binding!=='ANALYTICS'||t.analytics.dataset!==r.analytics||!key(t.analytics.accessPolicy)
      ||!exact(t.monitor,['binding','namespace','accessPolicy'])||t.monitor.binding!=='CACHE'||t.monitor.namespace!=='monitor'||!key(t.monitor.accessPolicy)
      ||!exact(t.alert,['binding','destination','urlSha256','accessPolicy'])||t.alert.binding!=='ALERT_WEBHOOK_URL'||!key(t.alert.destination)||!key(t.alert.accessPolicy)
      ||t.alert.urlSha256!==sha256(d.secrets.ALERT_WEBHOOK_URL))fail();
    for(const purpose of ['enrichment','search','catalogSearch','warehouse'])if(entry[purpose]!==undefined){
      validateConfiguredPurpose(entry[purpose],purpose);const kind=purpose==='warehouse'?'warehouse':purpose==='catalogSearch'?'catalog':'model';
      if(purpose==='warehouse')validateWarehouseMaterial(d.secrets[entry[purpose].keyPairRef]);
      if(!retention.tenants[tenant]['external.'+kind+'.'+digest({purpose,tenant,...entry[purpose]})])fail();
    }
    for(const kind of ['analytics','monitor','alert']){
      const category='telemetry.'+kind+'.'+digest({tenant,environment:t.environment,schema:t.schema,...t[kind]});
      if(!retention.tenants[tenant][category])fail();
    }
    if(t.synthetic !== undefined){
      const s=t.synthetic, bindings=['CACHE','SESSIONS','STORAGE','EVENT_QUEUE','SHOPPER_REFLEX','DECISION_RING','LEARN_STATS','REGION_TREND','PERSONALIZATION_WEBSOCKET'];
      if(!exact(s,['version','enabled','lifetimeMs','stageMs','decisionMs','eventMs','thresholdSource','destinations'])||s.version!==1||s.enabled!==true
        ||!Number.isSafeInteger(s.lifetimeMs)||s.lifetimeMs<1000||s.lifetimeMs>300000
        ||!Number.isSafeInteger(s.stageMs)||s.stageMs<1||s.stageMs>30000||s.stageMs>s.lifetimeMs
        ||!Number.isSafeInteger(s.decisionMs)||s.decisionMs<1||s.decisionMs>200
        ||!Number.isSafeInteger(s.eventMs)||s.eventMs<1||s.eventMs>300
        ||s.thresholdSource!=='document-32-server-diagnostics'||!Array.isArray(s.destinations)||s.destinations.length!==bindings.length
        ||new Set(s.destinations.map(x=>x.binding)).size!==bindings.length)fail();
      for(const destination of s.destinations){
        if(!exact(destination,['binding','purpose','namespace','accessPolicy'])||!bindings.includes(destination.binding)
          ||destination.purpose!=='isolated-synthetic-monitor'||destination.namespace!=='ops-synthetic-v1'||!key(destination.accessPolicy))fail();
        const category='telemetry.monitor.'+digest({tenant,environment:t.environment,schema:t.schema,...destination});
        if(!retention.tenants[tenant][category])fail();
      }
    }
  }
  if (!Array.isArray(d.routes) || d.routes.length > 100 || new Set(d.routes.map(x => x.pattern)).size !== d.routes.length
    || d.routes.some(x => !exact(x, ['zone', 'pattern']) || !HEX.test(x.zone) || !x.pattern.endsWith('/*') || !Object.hasOwn(d.tenants.hosts, x.pattern.slice(0, -2)))) fail();
  return structuredClone(d);
}
export function validateTransition(mode, desired, previous, rotate = []) {
  validateDesired(desired);
  if (mode === 'create') { if (previous) fail(); return; }
  if (!previous) fail(); validateDesired(previous);
  for (const k of ['customer', 'account', 'environment', 'script', 'resources', 'owners', 'ownership']) if (!same(desired[k], previous[k])) fail();
  if (desired.secrets.IDENTITY_SALT !== previous.secrets.IDENTITY_SALT) fail(); // Separate identity migration, never credential rotation.
  if (mode === 'add-brand') {
    if (desired.tenants.provisioned.length <= previous.tenants.provisioned.length
      || previous.tenants.provisioned.some(t => !desired.tenants.provisioned.includes(t))
      || Object.entries(previous.tenants.hosts).some(([h,t]) => desired.tenants.hosts[h] !== t)
      || previous.origins.some(x => !desired.origins.includes(x)) || previous.routes.some(x => !desired.routes.some(y => same(x,y)))) fail();
    for (const key of ['SDK_KEYS', 'IDENTITY_SECRETS']) {
      const a = keys(previous.secrets[key], previous.tenants.provisioned), b = keys(desired.secrets[key], desired.tenants.provisioned);
      if (Object.keys(a).some(t => !same(a[t], b[t]))) fail();
    }
    for (const key of Object.keys(previous.secrets).filter(k => !['SDK_KEYS', 'IDENTITY_SECRETS'].includes(k))) if (desired.secrets[key] !== previous.secrets[key]) fail();
    const a = JSON.parse(previous.vars.RETENTION), b = JSON.parse(desired.vars.RETENTION);
    if (Object.keys(a.tenants).some(t => !same(a.tenants[t], b.tenants[t]))) fail();
    const ac=JSON.parse(previous.vars.TENANT_CONNECTORS),bc=JSON.parse(desired.vars.TENANT_CONNECTORS);
    if(Object.keys(ac.tenants).some(t=>!same(ac.tenants[t],bc.tenants[t])))fail();
    const ao=JSON.parse(previous.vars.OPERATOR_OIDC??'{"version":1,"tenants":{}}'),bo=JSON.parse(desired.vars.OPERATOR_OIDC??'{"version":1,"tenants":{}}');
    if(previous.tenants.provisioned.some(t=>!same(ao.tenants[t],bo.tenants[t])))fail();
    for (const key of ['JWT_ISSUER', 'JWT_AUDIENCE', 'REFLEX_HOST', 'LEDGER_RECOVERY_ENABLED', 'LEDGER_RECOVERY_CONFIG']) if (desired.vars[key] !== previous.vars[key]) fail();
  } else if (mode === 'rotate') {
    if (!rotate.length || new Set(rotate).size !== rotate.length || !same(Object.keys(desired.secrets).sort(),Object.keys(previous.secrets).sort()) || rotate.some(k => !Object.hasOwn(desired.secrets,k) || k === 'IDENTITY_SALT')) fail();
    for (const k of Object.keys(desired).filter(k => !['secrets','vars'].includes(k))) if (!same(desired[k], previous[k])) fail();
    const expectedVars=structuredClone(previous.vars);
    if(rotate.includes('ALERT_WEBHOOK_URL')){
      const connectors=JSON.parse(expectedVars.TENANT_CONNECTORS),retention=JSON.parse(expectedVars.RETENTION),next=JSON.parse(desired.vars.RETENTION);
      for(const tenant of desired.tenants.provisioned){const t=connectors.tenants[tenant].telemetry;t.alert.urlSha256=sha256(desired.secrets.ALERT_WEBHOOK_URL);
        const category='telemetry.alert.'+digest({tenant,environment:t.environment,schema:t.schema,...t.alert});
        if(!next.tenants[tenant][category])fail();retention.tenants[tenant][category]=next.tenants[tenant][category];}
      expectedVars.TENANT_CONNECTORS=canonical(connectors);expectedVars.RETENTION=canonical(retention);
    }
    if(!same(Object.keys(expectedVars).sort(),Object.keys(desired.vars).sort()))fail();
    for(const key of Object.keys(expectedVars))if(['TENANT_CONNECTORS','RETENTION'].includes(key)
      ? !same(JSON.parse(desired.vars[key]),JSON.parse(expectedVars[key])) : desired.vars[key]!==expectedVars[key])fail();
    for (const key of Object.keys(desired.secrets)) if (rotate.includes(key) ? desired.secrets[key] === previous.secrets[key] : desired.secrets[key] !== previous.secrets[key]) fail();
  } else if (mode === 'reconcile' && !same(desired, previous)) {
    // This existing desired-state operation may explicitly activate/deactivate
    // recovery, but cannot retire its consumer or unrelated retained material.
    const before = structuredClone(previous), after = structuredClone(desired);
    // Provider descriptor/material changes are explicit desired-state changes.
    // Existing ref rotation still uses rotate; other credentials stay immutable.
    const oldRefs=oidcReferences(before),newRefs=oidcReferences(after);
    for(const ref of oldRefs.filter(r=>newRefs.includes(r)))if(before.secrets[ref]!==after.secrets[ref])fail();
    for(const ref of new Set([...oldRefs,...newRefs])){delete before.secrets[ref];delete after.secrets[ref];}
    delete before.vars.OPERATOR_OIDC;delete after.vars.OPERATOR_OIDC;
    const recoveryChanged=before.vars.LEDGER_RECOVERY_ENABLED!==after.vars.LEDGER_RECOVERY_ENABLED||before.vars.LEDGER_RECOVERY_CONFIG!==after.vars.LEDGER_RECOVERY_CONFIG;
    if (recoveryChanged&&(!recoveryWired(after) || (recoveryWired(before) && !JSON.parse(after.vars.LEDGER_RECOVERY_CONFIG).unknown
      && JSON.parse(before.vars.LEDGER_RECOVERY_CONFIG).unknown))) fail();
    for (const d of [before, after]) { delete d.vars.LEDGER_RECOVERY_ENABLED; delete d.vars.LEDGER_RECOVERY_CONFIG; }
    const a = JSON.parse(before.vars.RETENTION), b = JSON.parse(after.vars.RETENTION);
    for (const tenant of Object.keys(a.tenants)) {
      for (const category of ['recovery', 'quarantine']) {
        if (a.tenants[tenant][category] && !same(a.tenants[tenant][category], b.tenants[tenant][category])) fail();
        delete a.tenants[tenant][category]; delete b.tenants[tenant][category];
      }
    }
    before.vars.RETENTION = canonical(a); after.vars.RETENTION = canonical(b);
    if (!same(before, after)) fail();
  } else if (!same(desired, previous)) fail();
}

/** Protected caller-held files; reject symlinked parents, ambient paths and sharing. */
async function protectedDirectory(path) {
  if (resolve(path) !== path) fail();
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) || s.uid !== process.getuid?.() || await realpath(path) !== path) fail();
}
export async function readProtected(path, limit = MAX) {
  return JSON.parse(await readProtectedBytes(path,limit));
}
async function readProtectedBytes(path, limit = MAX) {
  if (resolve(path) !== path) fail(); await protectedDirectory(dirname(path));
  const f = await open(path, 'r');
  try { const s = await f.stat(), l = await lstat(path);
    if (!s.isFile() || l.isSymbolicLink() || l.ino !== s.ino || s.uid !== process.getuid?.() || (s.mode & 0o077) || s.size > limit) fail();
    return await f.readFile();
  } finally { await f.close(); }
}
async function createProtected(path, value) {
  await protectedDirectory(dirname(path));
  const f = await open(path, 'wx', 0o600);
  try { await f.writeFile(canonical(value)); await f.sync(); } finally { await f.close(); }
  const d = await open(dirname(path), 'r'); try { await d.sync(); } finally { await d.close(); }
}
export async function protectedOperation(directory, operation) {
  await protectedDirectory(directory); if (!UUID.test(operation)) fail();
  const path = resolve(directory, operation);
  try { await mkdir(path, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  await protectedDirectory(path);
  const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}
  let lock; try { lock = await open(resolve(path, 'lock'), 'wx', 0o600); } catch { fail(); }
  return { async read(key) {
    if (!/^[a-z0-9.-]{1,160}$/.test(key)) fail();
    try { return await readProtected(resolve(path, key + '.json')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }, async write(key, value) {
    if (!/^[a-z0-9.-]{1,160}$/.test(key)) fail(); await createProtected(resolve(path, key + '.json'), value);
  }, async close() { await lock.close(); await unlink(resolve(path, 'lock')); } };
}

/** Real REST boundary. Read-only D1 SQL uses POST but never writes database state. */
export function provider(apiToken, { fetch: transport = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (typeof apiToken !== 'string' || !/^[A-Za-z0-9_-]{20,512}$/.test(apiToken)) fail();
  return async (path, { method = 'GET', body, token = apiToken, raw = false, absent = false } = {}) => {
    if ((!path.startsWith('/accounts/') && !path.startsWith('/zones/')) || path.includes('..') || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fail();
    const controller = new AbortController(); let timer;
    try {
      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Stamp workflow unavailable'));},timeoutMs);});
      const response = await Promise.race([transport(API + path, { method, redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, ...(body instanceof FormData || body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) }),
      deadline]);
      if (absent && response.status === 404) return null;
      if (!response.ok || !response.body) fail();
      const bytes=await Promise.race([(async()=>{const reader = response.body.getReader(), chunks = []; let size = 0;
        while (true) { const row = await reader.read(); if (row.done) break; size += row.value.length; if (size > MAX) { await reader.cancel(); fail(); } chunks.push(row.value); }
        return Buffer.concat(chunks);})(),deadline]);
      if (raw) return new Response(bytes, { headers: response.headers });
      const value = JSON.parse(bytes);
      if (value?.success !== true || value.result === undefined) fail();
      return value.result;
    } catch { fail(); } finally { clearTimeout(timer); controller.abort(); }
  };
}

/** One immutable prewrite intent per step. Pending/ambiguous steps NEVER repost. */
export async function effect(store, key, intent, write, inspect) {
  const previous = await store.read(key + '.intent'), commitment = digest(intent);
  if (previous) {
    if (previous.commitment !== commitment) fail();
    const done = await store.read(key + '.done');
    if (done) return done.result;
    const observed = inspect ? await inspect() : null;
    return { unconfirmed: true, observed, reposted: false };
  }
  await store.write(key + '.intent', { commitment, intent, at: new Date().toISOString() });
  try {
    const result = await write();
    await store.write(key + '.done', { result, at: new Date().toISOString() });
    return result;
  } catch { return { unconfirmed: true, reposted: false }; }
}
function confirmed(value) { if (value?.unconfirmed) fail(); return value; }

// Versioned local evidence is minted here from actual execution, never from a
// caller's claimed label, status or hash. Protected-file custody is its trust
// boundary; this is not a remote signature, trusted CI observation or release approval.
export const LOCAL_CHECK_COMMANDS = [
  'npm run lint',
  'node --max-old-space-size=1536 node_modules/typescript/bin/tsc --noEmit --incremental false --composite false && node --max-old-space-size=1536 node_modules/typescript/bin/tsc -p src/sdk --noEmit --incremental false --composite false',
  "node node_modules/vitest/vitest.mjs run src/console/console.render.test.ts -t 'W13|W11[.]02 Meridian' --maxWorkers=1 --minWorkers=1",
];
export const NODE_CHECK_COMMAND = 'node --test scripts/stamp-workflow.test.mjs scripts/seed-d1.test.mjs scripts/identity-material.test.mjs scripts/operator-seed.test.mjs scripts/lib/tool-token.test.mjs scripts/remediation/board.test.mjs';
const PROOF_FILES = ['.eslintrc.json', 'package.json', 'package-lock.json', '.github/workflows/ci.yml',
  'tsconfig.json', 'src/sdk/tsconfig.json', 'vitest.config.ts', 'wrangler.toml',
  'scripts/stamp-workflow.mjs', 'scripts/stamp-workflow.test.mjs', 'scripts/build-sdk.mjs', 'scripts/build-meridian.mjs',
  'scripts/operator-seed.mjs', ...['meridian','surfaces','beats','compare','layout','moments'].map(n=>'public/meridian/'+n+'.js'),
  ...['esbuild','wrangler','typescript','eslint','@typescript-eslint/parser','@typescript-eslint/eslint-plugin','vitest','miniflare','workerd','unenv','@cloudflare/unenv-preset','jsdom'].map(n=>'node_modules/'+n+'/package.json')];
const proofPath = path => PROOF_FILES.includes(path)||/^src\/.*\.(?:ts|tsx|mjs|json)$/.test(path)
  ||/^public\/.*\.(?:js|html|css|json)$/.test(path)||/^scripts\/.*\.(?:mjs|sh|sql)$/.test(path)||/^migrations\/.*\.sql$/.test(path);
async function verificationBasis(root) {
  const paths = new Set(PROOF_FILES);
  const visit = async directory => { for (const entry of await readdir(resolve(root,directory),{withFileTypes:true})) {
    const path=directory+'/'+entry.name;
    if(entry.isSymbolicLink())fail();
    if(entry.isDirectory())await visit(path);else if(proofPath(path))paths.add(path);
  }};
  for(const directory of ['src','public','scripts','migrations'])await visit(directory);
  return Promise.all([...paths].sort().map(async path=>pin(path,await readFile(resolve(root,path)))));
}
async function executedChecks(root, profile) {
  if(!['local-v1','ci-v1'].includes(profile))fail();
  const before=await verificationBasis(root),runtime={node:process.version,executable:pin('node-runtime',await readFile(process.execPath))};
  const commands=profile==='ci-v1'?[...LOCAL_CHECK_COMMANDS.slice(0,2),'npm test']:LOCAL_CHECK_COMMANDS;
  const checks=[];
  for(const command of commands){
    const startedAt=new Date().toISOString(),start=Date.now();
    const result=spawnSync('bash',['-c',command],{cwd:root,encoding:'buffer',timeout:300000,maxBuffer:32*1024*1024,
      env:{...process.env,CI:'true'}});
    const completedAt=new Date().toISOString(),after=await verificationBasis(root);
    const row={command,startedAt,completedAt,elapsedMs:Date.now()-start,exitCode:result.status,signal:result.signal,
      before,after,stdout:blob('stdout',result.stdout??Buffer.alloc(0),'text/plain'),stderr:blob('stderr',result.stderr??Buffer.alloc(0),'text/plain')};
    checks.push(row);
    console.log('Executed artifact check '+canonical(row));
    if(result.error||result.status!==0||result.signal||!same(before,after)){
      const error=new Error('Actual package check failed: '+command);error.checks=checks;throw error;
    }
  }
  return {version:1,profile,runtime,basis:before,basisDigest:digest(before),checks};
}
function workerBuildOptions(root) {
  return { absWorkingDir:root,entryPoints:['src/index.ts'],outfile:'worker.mjs',bundle:true,
    format:'esm',platform:'browser',target:'es2022',conditions:['workerd','worker','browser'],
    external:['cloudflare:*'],inject:['stamp-globals'],write:false,metafile:true,logLevel:'silent',sourcemap:false,
    define:{'process.env.NODE_ENV':'"production"'} };
}
const payloadBody = artifact => {const {digest:ignored,verification:proof,...payload}=artifact;return payload;};
export const payloadDigest = artifact => digest(payloadBody(artifact));
// Re-observing retained bytes does not compile or adopt today's sources. This
// same bounded probe permits a genuinely checked older compatible payload.
export async function inspectArtifactPayload(payload) {
  const {Miniflare}=await import('miniflare'),assets=new Map(payload.assets.map(p=>[p.name,p]));
  let outbound=0;const observed=[];
  const native=new Miniflare({cf:false,modules:payload.modules.map(p=>({type:'ESModule',path:p.name,contents:bytesOf(p).toString()})),
    compatibilityDate:payload.compatibility_date,compatibilityFlags:payload.compatibility_flags,
    bindings:{DEPLOYMENT_PROFILE:'customer',AUTH_MODE:'enforced'},
    serviceBindings:{ASSETS(request){const p=assets.get(new URL(request.url).pathname);return p?new Response(bytesOf(p),{headers:{'Content-Type':p.type}}):new Response(null,{status:404});}},
    outboundService(){outbound++;throw Error('Offline package denies outbound');}});
  try {
    for(const part of payload.assets){const response=await native.dispatchFetch('https://artifact.invalid'+part.name),bytes=Buffer.from(await response.arrayBuffer());
      if(response.status!==200||sha256(bytes)!==part.sha256||bytes.length!==part.bytes)fail();
      observed.push({name:part.name,status:response.status,bytes:bytes.length,sha256:sha256(bytes)});
    }
    const omitted=await native.dispatchFetch('https://artifact.invalid/storefront.html');if(omitted.status!==404)fail();
    const esm=await import('data:text/javascript;base64,'+assets.get('/sdk/edge-personalization.esm.js').base64);
    const browser={};runInNewContext(bytesOf(assets.get('/sdk/edge-personalization.js')).toString(),browser,{timeout:5000});
    if(typeof esm.createClient!=='function'||typeof browser.EdgePersonalization?.createClient!=='function'
      ||esm.VERSION!==browser.EdgePersonalization.VERSION||outbound!==0)fail();
    return {payloadDigest:payloadDigest(payload),assets:observed,omittedStatus:omitted.status,outbound,
      sdk:{esm:'createClient:function',iife:'createClient:function',version:esm.VERSION}};
  }finally{await native.dispose();}
}
export async function packageArtifact({ root = ROOT, verification, build, profile = 'local-v1' } = {}) {
  if(verification!==undefined||build!==undefined)fail();
  const checks=await executedChecks(root,profile);
  const esbuild = build ?? (await import('esbuild')).build;
  const configBytes = await readFile(resolve(root, 'wrangler.toml')), config = parseToml(configBytes.toString());
  const loaded=new Map();
  const virtual=new Map(),builtins=new Set(builtinModules.map(x=>x.replace(/^node:/,'')));
  const {defineEnv}=await import('unenv'),{getCloudflarePreset}=await import('@cloudflare/unenv-preset');
  const compat=defineEnv({presets:[getCloudflarePreset({compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags}),{alias:{debug:'debug'}}],npmShims:true}).env;
  const aliases=new Map();for(const [name,target]of Object.entries(compat.alias)){try{aliases.set(name,{target,path:require.resolve(target),external:compat.external.includes(target)});}catch{/* Not installed, never invent a replacement. */}}
  const globals=Object.entries(compat.inject).map(([name,entry],i)=>Array.isArray(entry)
    ? `import {${entry[1]} as v${i}} from '${entry[0]}';globalThis.${name}=v${i};`
    : `import v${i} from '${entry}';globalThis.${name}=v${i};`).join('\n')+'\n'+compat.polyfill.map(p=>`import '${p}';`).join('\n');
  // Installed Wrangler's hybrid nodejs_compat contract: CJS builtin shims,
  // date/flag-selected unenv aliases, globals and compatibility polyfills.
  const nodePlugin={name:'worker-node-builtins',setup(b){
    b.onResolve({filter:/.*/},a=>{
      if(a.path==='stamp-globals')return{path:'globals',namespace:'stamp-virtual'};
      const name=a.path.replace(/^node:/,'');
      if(builtins.has(name)&&a.kind==='require-call')return{path:a.path,namespace:'stamp-node-builtins'};
      const alias=aliases.get(a.path);if(alias){
        if(a.kind==='require-call'&&/^unenv\/(npm|mock)\//.test(alias.target))return{path:a.path,namespace:'stamp-unenv-require'};
        return{path:alias.path,external:alias.external};}
      if(builtins.has(name))return{path:'node:'+name,external:true};
    });
    b.onLoad({filter:/.*/,namespace:'stamp-node-builtins'},a=>{const code=`import value from '${a.path}'; module.exports=value;`;
      virtual.set('stamp-node-builtins:'+a.path,Buffer.from(code));return{contents:code,loader:'js'};});
    b.onLoad({filter:/.*/,namespace:'stamp-unenv-require'},a=>{const code=`import * as esm from '${a.path}'; module.exports=Object.entries(esm).filter(([k])=>k!=='default').reduce((c,[k,v])=>Object.defineProperty(c,k,{value:v,enumerable:true}),'default' in esm?esm.default:{});`;
      virtual.set('stamp-unenv-require:'+a.path,Buffer.from(code));return{contents:code,loader:'js'};});
    b.onLoad({filter:/.*/,namespace:'stamp-virtual'},()=>{virtual.set('stamp-virtual:globals',Buffer.from(globals));return{contents:globals,loader:'js',resolveDir:root};});
  }};
  const plugins=[{name:'held-source-bytes',setup(b){b.onLoad({filter:/\.[cm]?[jt]sx?$|\.json$/},async a=>{
    const bytes=await readFile(a.path),path=relative(root,a.path).replaceAll('\\','/');
    if(loaded.has(path)&&loaded.get(path)!==sha256(bytes))fail();loaded.set(path,sha256(bytes));
    const extension=extname(a.path).slice(1);return{contents:bytes,loader:['ts','tsx','jsx','json'].includes(extension)?extension:'js'};
  });}}];
  const heldFiles=[...new Set([...checks.basis.map(p=>p.path),'src/customerBoundary.ts'])];
  const held=new Map(await Promise.all(heldFiles.map(async p=>[p,sha256(await readFile(resolve(root,p)))])));
  const workerOptions=workerBuildOptions(root);
  const result = await esbuild({...workerOptions,plugins:[nodePlugin,...plugins]});
  if (result.outputFiles.length !== 1) fail();
  const modules = [blob('worker.mjs', Buffer.from(result.outputFiles[0].contents), 'application/javascript+module')];
  const assets = [];
  for (const path of ASSETS) assets.push(blob('/' + path, await readFile(resolve(root, 'public', path)), path.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript'));
  // Verify the held SDK against its actual source/options without editing public/.
  const sdkResults=await verifySDK({root,build:esbuild,plugins});
  for (const sdk of sdkResults) {
    Object.assign(result.metafile.inputs, sdk.metafile.inputs);
  }
  const meridian=await verifyMeridian({root,build:esbuild,plugins});
  Object.assign(result.metafile.inputs,meridian.metafile.inputs);
  const sourcePins = [];
  for (const path of [...new Set([...Object.keys(result.metafile.inputs),...heldFiles])].sort()) {
    if(virtual.has(path)){sourcePins.push({...pin(path,virtual.get(path)),imports:(result.metafile.inputs[path]?.imports??[]).filter(x=>!x.external).map(x=>x.path)});continue;}
    if (path.startsWith('<') || relative(root, resolve(root, path)).startsWith('..')) fail();
    const bytes=await readFile(resolve(root,path));
    if(loaded.has(path)&&loaded.get(path)!==sha256(bytes)||held.has(path)&&held.get(path)!==sha256(bytes))fail();
    sourcePins.push({...pin(path,bytes),imports:(result.metafile.inputs[path]?.imports??[]).filter(x=>!x.external).map(x=>x.path)});
  }
  const migrations = [];
  for (const name of MIGRATIONS) migrations.push(blob(name, await readFile(resolve(root, 'migrations/product', name)), 'application/sql'));
  const barriers=securityClosure(sourcePins,'customer-assets-v2');
  for(const [path,hash]of loaded)if(sha256(await readFile(resolve(root,path)))!==hash)fail();
  for(const [path,hash]of held)if(sha256(await readFile(resolve(root,path)))!==hash)fail();
  for(const asset of assets)if(sha256(await readFile(resolve(root,'public',asset.name.slice(1))))!==asset.sha256)fail();
  if(sha256(await readFile(resolve(root,'wrangler.toml')))!==sha256(configBytes))fail();
  if(!same(checks.basis,await verificationBasis(root)))fail();
  const artifact = { version: 2, assetContract: 'customer-assets-v2', schemaContract: 'operator-oidc-v2', main: 'worker.mjs', modules, assets, migrations, sourcePins, barriers,
    compatibility_date: config.compatibility_date, compatibility_flags: config.compatibility_flags, doMigrations: config.migrations,
    config: pin('wrangler.toml', configBytes),configuration:blob('wrangler.toml',configBytes,'application/toml'),
    basisInventory:blob('verification-basis.json',Buffer.from(canonical(checks.basis.map(p=>p.path))),'application/json'),
    buildOptions:{worker:workerOptions,sdk:await sdkBuildOptions(root),meridian:meridianBuildOptions(root)},
    tools: checks.basis.filter(p=>p.path.startsWith('node_modules/')) };
  const native=await inspectArtifactPayload(artifact);
  if(!same(checks.basis,await verificationBasis(root)))fail();
  for(const asset of assets)if(sha256(await readFile(resolve(root,'public',asset.name.slice(1))))!==asset.sha256)fail();
  const proof={...checks,payloadDigest:payloadDigest(artifact),native,qualification:'local-only; live acceptance open'};
  const attested={...artifact,verification:proof};
  return validateArtifact({...attested,digest:digest(attested)});
}
export function validateArtifact(artifact) {
  if (!object(artifact) || artifact.version !== 2 || !SHA.test(artifact.digest)) fail();
  const { digest: hash, ...body } = artifact;
  if (digest(body) !== hash || body.main !== 'worker.mjs' || !Array.isArray(body.modules) || body.modules.length !== 1
    || body.modules[0].name !== body.main || body.modules[0].type !== 'application/javascript+module'
    || body.assetContract !== undefined && body.assetContract !== 'customer-assets-v2'
    || body.schemaContract !== undefined && body.schemaContract !== 'operator-oidc-v2'
    || !Array.isArray(body.assets) || !same(body.assets.map(x => x.name).sort(), (body.assetContract === 'customer-assets-v2' ? ASSETS : LEGACY_ASSETS).map(x => '/' + x))
    || body.assets.some(p=>p.type!==(p.name.endsWith('.html')?'text/html; charset=utf-8':'application/javascript'))
    || !same(body.migrations.map(x => x.name), migrationsFor(body)) || !same(body.migrations.map(x=>x.sha256),oidcSchema(body)?MIGRATION_HASHES:LEGACY_MIGRATION_HASHES) || !Array.isArray(body.doMigrations)
    || !same(body.doMigrations.map(x => x.tag), ['v1','v2','v3','v4','v5','v6','v7'])
    || !Array.isArray(body.barriers) || !same(body.barriers,securityClosure(body.sourcePins,body.assetContract))) fail();
  for (const part of [...body.modules, ...body.assets, ...body.migrations]) bytesOf(part);
  const proof=body.verification,source=new Map(body.sourcePins.map(p=>[p.path,p]));
  if(oidcSchema(body))for(const m of body.migrations){const p=source.get('migrations/product/'+m.name);if(!p||p.sha256!==m.sha256||p.bytes!==m.bytes)fail();}
  if(source.size!==body.sourcePins.length||body.sourcePins.some(p=>typeof p.path!=='string'||!SHA.test(p.sha256)||!Number.isSafeInteger(p.bytes)||p.bytes<0))fail();
  const declared=body.sourcePins.filter(p=>proofPath(p.path)).map(p=>({path:p.path,bytes:p.bytes,sha256:p.sha256}));
  const inventory=JSON.parse(bytesOf(body.basisInventory));
  if(!same(inventory,declared.map(p=>p.path))||!same(proof?.basis,declared))fail();
  if(!object(proof)||proof.version!==1||!['local-v1','ci-v1'].includes(proof.profile)||proof.payloadDigest!==payloadDigest(artifact)
    ||proof.basisDigest!==digest(proof.basis)||!Array.isArray(proof.basis)||!proof.basis.length
    ||proof.basis.some(p=>!SHA.test(p.sha256)||!same(p,{path:source.get(p.path)?.path,bytes:source.get(p.path)?.bytes,sha256:source.get(p.path)?.sha256}))
    ||new Set(proof.basis.map(p=>p.path)).size!==proof.basis.length||PROOF_FILES.some(path=>!proof.basis.some(p=>p.path===path))
    ||!/^v22\./.test(proof.runtime?.node)||!SHA.test(proof.runtime?.executable?.sha256))fail();
  const commands=proof.profile==='ci-v1'?[...LOCAL_CHECK_COMMANDS.slice(0,2),'npm test']:LOCAL_CHECK_COMMANDS;
  if(!Array.isArray(proof.checks)||!same(proof.checks.map(c=>c.command),commands))fail();
  const checkedBasis=validateAssetReuse(body,proof);
  let previousEnd=0;
  for(const check of proof.checks){
    const started=Date.parse(check.startedAt),completed=Date.parse(check.completedAt);
    if(check.exitCode!==0||check.signal!==null||!Number.isSafeInteger(check.elapsedMs)||check.elapsedMs<0
      ||!Number.isFinite(started)||!Number.isFinite(completed)||completed<started||started<previousEnd
      ||!same(check.before,checkedBasis)||!same(check.after,checkedBasis))fail();
    previousEnd=completed;
    bytesOf(check.stdout);bytesOf(check.stderr);
  }
  const native=proof.native;
  if(!native||native.payloadDigest!==proof.payloadDigest||native.omittedStatus!==404||native.outbound!==0
    ||!same(native.assets,body.assets.map(p=>({name:p.name,status:200,bytes:p.bytes,sha256:p.sha256})))
    ||native.sdk?.esm!=='createClient:function'||native.sdk?.iife!=='createClient:function'||typeof native.sdk?.version!=='string')fail();
  const configBytes=bytesOf(body.configuration),config=parseToml(configBytes.toString()),configPin=proof.basis.find(p=>p.path==='wrangler.toml');
  if(!same(body.config,configPin)||sha256(configBytes)!==configPin.sha256||configBytes.length!==configPin.bytes
    ||body.configuration.name!=='wrangler.toml'||config.compatibility_date!==body.compatibility_date
    ||!same(config.compatibility_flags,body.compatibility_flags)||!same(config.migrations,body.doMigrations)
    ||!same(body.tools,proof.basis.filter(p=>p.path.startsWith('node_modules/'))))fail();
  const root=body.buildOptions?.worker?.absWorkingDir;
  if(typeof root!=='string'||!root.startsWith('/')||!same(body.buildOptions,{worker:workerBuildOptions(root),
    sdk:sdkOptionsForVersion(root,native.sdk.version),meridian:meridianBuildOptions(root)}))fail();
  for(const asset of body.assets){const p=proof.basis.find(p=>p.path==='public'+asset.name);if(!p||p.sha256!==asset.sha256||p.bytes!==asset.bytes)fail();}
  return artifact;
}
function validateAssetReuse(body,proof) {
  if(proof.reuse===undefined)return proof.basis;
  const reuse=proof.reuse;
  if(!exact(reuse,['kind','checkedBasis','assets'])||reuse.kind!=='ascii-comment-suffix-v1'||!Array.isArray(reuse.assets)||!reuse.assets.length
    ||new Set(reuse.assets.map(a=>a.name)).size!==reuse.assets.length||!Array.isArray(reuse.checkedBasis))fail();
  const expected=structuredClone(proof.basis);
  for(const old of reuse.assets){
    if(!old.name.startsWith('/console/')||!old.name.endsWith('.js'))fail();
    const current=body.assets.find(a=>a.name===old.name),before=bytesOf(old),after=current&&bytesOf(current);
    if(!after||!after.subarray(0,before.length).equals(before)||!/^\n\/\/ [\x20-\x7e]{1,120}\n$/.test(after.subarray(before.length).toString('utf8')))fail();
    const p=expected.find(p=>p.path==='public'+old.name);if(!p)fail();p.sha256=old.sha256;p.bytes=old.bytes;
  }
  if(!same(expected,reuse.checkedBasis))fail();
  return reuse.checkedBasis;
}
export async function verifyCommentOnlyAssetRevision(artifact,assets) {
  validateArtifact(artifact);if(artifact.verification.reuse)fail();
  const next=structuredClone(artifact),before=[];
  // Fresh in-memory packages share basis with the executed before/after pins.
  // A derived asset basis must not rewrite those immutable check observations.
  next.verification.basis=structuredClone(artifact.verification.basis);
  for(const asset of assets){const i=next.assets.findIndex(p=>p.name===asset.name);if(i<0)fail();before.push(next.assets[i]);next.assets[i]=asset;
    for(const list of [next.sourcePins,next.verification.basis]){const p=list.find(p=>p.path==='public'+asset.name);if(!p)fail();p.sha256=asset.sha256;p.bytes=asset.bytes;}}
  next.verification.reuse={kind:'ascii-comment-suffix-v1',checkedBasis:artifact.verification.basis,assets:before};
  validateAssetReuse(next,next.verification);
  next.verification.basisDigest=digest(next.verification.basis);next.verification.payloadDigest=payloadDigest(next);
  next.verification.native=await inspectArtifactPayload(next);delete next.digest;next.digest=digest(next);
  return validateArtifact(next);
}
// CI's separate Node runner consumes the same completed package. Its retained
// proof is supplemental, keyed to that immutable digest, not a package rebuild.
async function heldArtifact(path) {
  const bytes=await readProtectedBytes(path),artifact=validateArtifact(JSON.parse(bytes));
  return {artifact,identity:{digest:artifact.digest,sha256:sha256(bytes),bytes:bytes.length}};
}
export async function readPinnedArtifact(path,expected) {
  if(!exact(expected,['digest','sha256','bytes'])||!SHA.test(expected.digest)||!SHA.test(expected.sha256)
    ||!Number.isSafeInteger(expected.bytes)||expected.bytes<1)fail();
  const held=await heldArtifact(path);if(!same(held.identity,expected))fail();return held.artifact;
}
export async function verifyPackagedNodeTests(path,{root=ROOT}={}) {
  const {artifact,identity}=await heldArtifact(path),before=await verificationBasis(root);
  if(!same(before,artifact.verification.basis))fail();
  const startedAt=new Date().toISOString(),start=Date.now();
  const result=spawnSync('bash',['-c',NODE_CHECK_COMMAND],{cwd:root,timeout:600000,maxBuffer:32*1024*1024,
    env:{...process.env,CI:'true',STAMP_TEST_ARTIFACT_PATH:path,STAMP_TEST_ARTIFACT_DIGEST:identity.digest,
      STAMP_TEST_ARTIFACT_SHA256:identity.sha256,STAMP_TEST_ARTIFACT_BYTES:String(identity.bytes)}});
  const after=await verificationBasis(root);
  let artifactUnchanged=false;try{await readPinnedArtifact(path,identity);artifactUnchanged=true;}catch{/* Preserve full failed diagnostic, never a verified upload. */}
  return {version:1,artifact:artifact.digest,identity,command:NODE_CHECK_COMMAND,startedAt,completedAt:new Date().toISOString(),
    elapsedMs:Date.now()-start,exitCode:result.status,signal:result.signal,artifactUnchanged,unchanged:same(before,after),before,after,
    stdout:blob('stdout',result.stdout??Buffer.alloc(0),'text/plain'),stderr:blob('stderr',result.stderr??Buffer.alloc(0),'text/plain')};
}
export async function verifyPackagedUpload(path,proofPath) {
  const proof=await readProtected(proofPath);
  if(proof.version!==1||proof.exitCode!==0||proof.signal!==null||proof.unchanged!==true||proof.artifactUnchanged!==true
    ||proof.command!==NODE_CHECK_COMMAND||proof.artifact!==proof.identity?.digest)fail();
  const artifact=await readPinnedArtifact(path,proof.identity);
  if(!same(proof.before,artifact.verification.basis)||!same(proof.after,artifact.verification.basis))fail();
  bytesOf(proof.stdout);bytesOf(proof.stderr);
  return proof.identity;
}
function securityClosure(pins,assetContract){
  if(!Array.isArray(pins))fail();const map=new Map(pins.map(p=>[p.path,p])),seen=new Set();
  // Pin the ingress dispatcher itself; traverse actual transitive enforcement
  // dependencies, not every unrelated feature imported by the dispatcher.
  const visit=path=>{if(seen.has(path))return;const p=map.get(path);if(!p||!SHA.test(p.sha256)||!Array.isArray(p.imports))fail();seen.add(path);if(path!=='src/index.ts')for(const next of p.imports)visit(next);};
  for(const path of SECURITY_ROOTS)visit(path);
  if(assetContract==='customer-assets-v2')visit('src/routes/search.ts');
  return [...seen].sort().map(path=>{const p=map.get(path);return{path,sha256:p.sha256,bytes:p.bytes}});
}

const resourceAPI = (account, kind, value) => {
  const base = `/accounts/${account}`;
  if (kind === 'cache' || kind === 'sessions') return { collection: base + '/storage/kv/namespaces',
    item: base + '/storage/kv/namespaces/' + value.id, create: { title: value.name }, id: 'id', name: 'title' };
  if (kind === 'database') return { collection: base + '/d1/database', item: base + '/d1/database/' + value.id,
    create: { name: value.name }, id: 'uuid', name: 'name' };
  if (kind === 'storage') return { collection: base + '/r2/buckets', item: base + '/r2/buckets/' + value.name,
    create: { name: value.name }, id: 'name', name: 'name' };
  return { collection: base + '/queues', item: base + '/queues/' + value.id,
    create: { queue_name: value.name }, id: 'queue_id', name: 'queue_name' };
};
async function accountCheck(api, desired) {
  const account = await api(`/accounts/${desired.account}`);
  if (account?.id !== desired.account) fail();
}
async function inspectResource(api, d, kind, value) {
  const p = resourceAPI(d.account, kind, value), row = await api(p.item, { absent: true });
  if (!row || row[p.id] !== value.id || row[p.name] !== value.name) fail();
  if (kind === 'queue' || kind === 'deadLetter') {
    if (!Array.isArray(row.consumers) || row.consumers.some(c => c.type !== 'worker' || (c.script ?? c.service) !== d.script)
      || row.consumers.length > 1 || (kind === 'deadLetter' && !recoveryWired(d) && row.consumers.length)) fail();
  }
  return row;
}
async function ensureResources(api, store, desired, create) {
  await accountCheck(api, desired); const d = structuredClone(desired);
  const ownedStorage = async value => {
    const expected={account:d.account,kind:'storage',name:value.name},intent=await store.read('resource-storage.intent'),done=await store.read('resource-storage.done');
    if(!intent||intent.commitment!==digest(expected)||!same(intent.intent,expected)||done?.result?.unconfirmed
      ||done?.result?.name!==value.name)fail();
  };
  // Inspect every detectable existing target before the first create. A late
  // foreign database/queue must not leave early newly-created namespaces behind.
  for (const kind of ['cache','sessions','database','storage','queue','deadLetter']) {
    const v=d.resources[kind],p=resourceAPI(d.account,kind,v);
    if (kind==='storage') {
      const row=await api(p.item,{absent:true});
      if(row){if(row.name!==v.name)fail();if(create)await ownedStorage(v);}
      if(!row&&!create)fail();
    } else if(v.id) await inspectResource(api,d,kind,v);
    else {
      if(!create)fail();const result=await api(p.collection+'?per_page=100');
      if(!Array.isArray(result)||result.length>=100)fail();
      if(result.some(x=>x[p.name]===v.name)&&!await store.read('resource-'+kind+'.done'))fail();
    }
  }
  for (const kind of ['cache', 'sessions', 'database', 'storage', 'queue', 'deadLetter']) {
    const value = d.resources[kind], p = resourceAPI(d.account, kind, value);
    if (kind === 'storage') {
      const existing = await api(p.item, { absent: true });
      if (existing) { if (existing.name !== value.name) fail(); if(create)await ownedStorage(value); continue; }
      if (!create) fail();
    } else if (value.id) { await inspectResource(api, d, kind, value); continue; }
    if (!create) fail();
    const inspect = async () => {
      const result = await api(p.collection + '?per_page=100');
      const rows = Array.isArray(result) ? result : result?.buckets;
      if (!Array.isArray(rows) || rows.length >= 100) fail();
      return rows.filter(x => x[p.name] === value.name).map(x => ({ id: x[p.id], name: x[p.name] }));
    };
    if (!await store.read('resource-' + kind + '.intent') && (await inspect()).length) fail(); // No name-based adoption.
    const result = confirmed(await effect(store, 'resource-' + kind, { account: d.account, kind, name: value.name },
      () => api(p.collection, { method: 'POST', body: p.create }), inspect));
    if (result?.[p.name] !== value.name || typeof result[p.id] !== 'string') fail();
    value.id = result[p.id];
    if (kind !== 'storage' && !(kind === 'database' ? UUID : HEX).test(value.id)) fail();
    await inspectResource(api, d, kind, value);
  }
  validateDesired(d); return d;
}
export function d1Queries(api, account, database, store) {
  const path = `/accounts/${account}/d1/database/${database}/query`;
  const request = async (sql, params = []) => {
    if (typeof sql !== 'string' || Buffer.byteLength(sql) > 90000 || !Array.isArray(params)) fail();
    const result = await api(path, { method: 'POST', body: { sql, params } });
    if (!Array.isArray(result) || !result.length || result.some(x => x.success !== true || !Array.isArray(x.results))) fail();
    return result;
  };
  return { all: request, async read(sql, params = []) { return (await request(sql, params)).at(-1).results; },
    async write(key, sql, params = []) {
      const result = confirmed(await effect(store, key, { account, database, sql, params }, () => request(sql, params)));
      return result.at(-1).results;
    } };
}
const normalizedSQL = value => value.replace(/\s+/g, ' ').trim();
export async function expectedSchema(artifact, count = migrationsFor(artifact).length) {
  validateArtifact(artifact);
  const { DatabaseSync } = await import('node:sqlite'), db = new DatabaseSync(':memory:');
  try {
    for (const migration of artifact.migrations.slice(0,count)) db.exec(bytesOf(migration).toString());
    const objects = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    return { objects: objects.map(x => ({ ...x, sql: normalizedSQL(x.sql) })),
      columns: Object.fromEntries(securityTablesFor(artifact).map(t => [t, db.prepare('PRAGMA table_info(' + t + ')').all().map(x => x.name)])) };
  } finally { db.close(); }
}
async function schemaReadback(db, artifact) {
  const expected = await expectedSchema(artifact), names = expected.objects.map(x => x.name);
  const actual = await db.read("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name");
  if (!same(actual.filter(x => names.includes(x.name)).map(x => ({ ...x, sql: normalizedSQL(x.sql) })), expected.objects)) fail();
  return { expected, actual };
}
const LEGACY = ['0001_d1_init.sql','0002_demo_events.sql','0003_funnel_seed.sql','0004_geo_census.sql','0005_dimension_enrichment.sql',
  '0006_brighthour_decisions.sql','0007_meridian_decisions.sql','0008_meridian_geo_cohort.sql','0009_tenant_columns.sql'];
export async function migrateProduct(db, artifact, prefix = 'migration') {
  validateArtifact(artifact);
  const migrations=migrationsFor(artifact),securityTables=securityTablesFor(artifact);
  const tables = await db.read("SELECT name FROM sqlite_master WHERE type='table'");
  let history = [];
  if (tables.some(x => x.name === 'd1_migrations')) history = await db.read('SELECT name FROM d1_migrations ORDER BY id');
  else {
    if (tables.some(x => securityTables.includes(x.name))) fail(); // Never guess unrecorded migration provenance.
  }
  const names = history.map(x => x.name);
  if (new Set(names).size !== names.length || names.some(x => ![...LEGACY, ...migrations].includes(x))) fail();
  const product = names.filter(x => migrations.includes(x));
  if (!same(product, migrations.slice(0, product.length))) fail();
  const before=await db.read("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name");
  const supported=(await expectedSchema(artifact,product.length)).objects;
  if(!same(before.filter(x=>!(x.type==='table'&&['d1_migrations','_cf_KV'].includes(x.name))).map(x=>({...x,sql:normalizedSQL(x.sql)})),supported))fail();
  if(!tables.some(x=>x.name==='d1_migrations'))await db.write(prefix+'-ledger',"CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
  for (const migration of artifact.migrations.slice(product.length)) {
    const sql = bytesOf(migration).toString() + '\nINSERT INTO d1_migrations (name) VALUES (' + quote(migration.name) + ');';
    await db.write(prefix + '-' + migration.name.replaceAll('_', '-'), sql);
  }
  const final = await db.read('SELECT name FROM d1_migrations ORDER BY id');
  if (!same(final.map(x => x.name), [...names, ...migrations.slice(product.length)])) fail();
  await schemaReadback(db, artifact);
  return { migrations, legacyHistoryPreserved: names.filter(x => LEGACY.includes(x)) };
}
function quote(v) {
  if (v === null) return 'NULL';
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
  if (typeof v !== 'string' || v.includes('\0')) fail();
  return "'" + v.replaceAll("'", "''") + "'";
}
export async function captureSecurity(db, artifact) {
  const { expected, actual } = await schemaReadback(db, artifact);
  const tables=securityTablesFor(artifact);
  // Restoring legacy/demo tables could resurrect erased demo records. They need
  // their own approved data reconciliation and cannot ride this product restore.
  if (actual.some(x => x.type === 'table' && ![...tables, 'd1_migrations', '_cf_KV'].includes(x.name))) fail();
  const results = await db.all(tables.map(t => 'SELECT * FROM ' + t + ' ORDER BY rowid').join(';')
    + ";SELECT seq FROM sqlite_sequence WHERE name='operator_audit'");
  if (results.length !== tables.length + 1) fail();
  const snapshot = { version: oidcSchema(artifact)?2:1, tables: Object.fromEntries(tables.map((t,i) => [t, results[i].results])),
    auditSequence: results.at(-1).results[0]?.seq ?? 0, schema: digest(expected) };
  await securityRestoreSQL(snapshot, artifact); // Validate bounds before any restore.
  return snapshot;
}
export async function securityRestoreSQL(snapshot, artifact) {
  const expected = await expectedSchema(artifact);
  const tables=securityTablesFor(artifact);
  if (!exact(snapshot, ['version', 'tables', 'auditSequence', 'schema']) || snapshot.version !== (oidcSchema(artifact)?2:1)
    || snapshot.schema !== digest(expected) || !exact(snapshot.tables, tables)
    || !Number.isSafeInteger(snapshot.auditSequence) || snapshot.auditSequence < 0) fail();
  const triggers=expected.objects.filter(x=>x.type==='trigger');
  if (!triggers.some(x=>x.name==='operator_recovery_apply')) fail();
  // Replaying a backup cannot reauthorize browser transactions or renew an old
  // federated grant. Preserve the account/link/audit and consumed barriers.
  const restored=securityRestoration(snapshot,artifact);
  const sql = triggers.map(t=>'DROP TRIGGER '+t.name+';');
  for (const table of [...tables].reverse()) sql.push(`DELETE FROM ${table};`);
  for (const table of tables) {
    const rows = snapshot.tables[table], columns = expected.columns[table];
    if (!Array.isArray(rows) || rows.length > 10000) fail();
    if(rows.some(row=>!exact(row,columns)))fail();
    for (const row of restored.tables[table]) {
      sql.push(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(c => quote(row[c])).join(',')});`);
    }
  }
  sql.push("DELETE FROM sqlite_sequence WHERE name='operator_audit';",
    `INSERT INTO sqlite_sequence(name,seq) VALUES ('operator_audit',${snapshot.auditSequence});`, ...triggers.map(t=>t.sql+';'));
  const result = sql.join('\n'); if (Buffer.byteLength(result) > 85000) fail();
  return result; // D1 executes this one request transactionally; no BEGIN/COMMIT wrapper.
}
export function securityRestoration(snapshot,artifact){
  const next=structuredClone(snapshot);if(!oidcSchema(artifact))return next;
  const epoch=next.tables.operator_oidc_epoch;
  if(!Array.isArray(epoch)||epoch.length!==1||epoch[0].id!==1||!SHA.test(epoch[0].epoch))fail();
  epoch[0].epoch=digest(['oidc-restore-epoch/v1',snapshot]);
  next.tables.operator_sessions=next.tables.operator_sessions.filter(s=>s.auth_method==='password'&&!s.jti.startsWith('oidc.'));
  next.tables.operator_oidc_sessions=[];
  next.tables.operator_oidc_transactions=next.tables.operator_oidc_transactions.map(t=>({...t,nonce:'',verifier:'',expires_at:0,consumed_at:t.consumed_at??0}));
  next.tables.operator_oidc_completions=next.tables.operator_oidc_completions.map(t=>({...t,payload:'',expires_at:0,consumed_at:t.consumed_at??0}));
  return next;
}

function versionBase(d) { return `/accounts/${d.account}/workers/scripts/${d.script}`; }
async function versions(api, d) {
  const result = await api(versionBase(d) + '/versions?per_page=100', { absent: true });
  if (result === null) return [];
  const rows = Array.isArray(result) ? result : result.items;
  if (!Array.isArray(rows) || rows.length >= 100 || rows.some(x => !UUID.test(x.id))) fail();
  return rows;
}
async function state(api, d) {
  const base = versionBase(d), list = await versions(api, d);
  if (!list.length) return { versions: [], settings: null, deployments: null, schedules: null };
  const [settings, deployments, schedules] = await Promise.all([api(base + '/script-settings'), api(base + '/deployments'), api(base + '/schedules')]);
  return { versions: list.map(x => x.id), settings, deployments, schedules };
}
function bindings(d) {
  const r = d.resources;
  return [
    { type: 'kv_namespace', name: 'CACHE', namespace_id: r.cache.id }, { type: 'kv_namespace', name: 'SESSIONS', namespace_id: r.sessions.id },
    { type: 'd1', name: 'DB', id: r.database.id }, { type: 'r2_bucket', name: 'STORAGE', bucket_name: r.storage.name },
    { type: 'queue', name: 'EVENT_QUEUE', queue_name: r.queue.name }, { type: 'analytics_engine', name: 'ANALYTICS', dataset: r.analytics },
    { type: 'assets', name: 'ASSETS' },
    ...Object.entries(DO_BINDINGS).map(([name,class_name]) => ({ type: 'durable_object_namespace', name, class_name })),
    ...Object.entries({ ...d.vars, ENVIRONMENT: d.environment, DEPLOYMENT_PROFILE: 'customer', AUTH_MODE: 'enforced',
      TENANTS: canonical(d.tenants), CORS_ORIGINS: d.origins.join(','), STAMP_OWNER_SUBJECTS: canonical(d.owners),
      TREND_ROLLUP_TENANTS: d.tenants.provisioned.join(','), CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
      DEMO_EVENT_CAPTURE: 'false', LEDGER_RECOVERY_ENABLED: d.vars.LEDGER_RECOVERY_ENABLED ?? 'false' }).map(([name,text]) => ({ type: 'plain_text', name, text })),
    ...Object.keys(d.secrets).sort().map(name => ({ type: 'secret_text', name, text: d.secrets[name] })),
  ];
}
function visibleBindings(rows) {
  if (!Array.isArray(rows) || new Set(rows.map(x => x.name)).size !== rows.length) fail();
  return rows.map(({ text, ...b }) => b.type === 'secret_text' ? { name: b.name, type: b.type } : { ...b, ...(text === undefined ? {} : { text }) })
    .map(b => { if (b.type === 'durable_object_namespace') { const { namespace_id, ...rest } = b; return rest; } return b; })
    .sort((a,b) => a.name.localeCompare(b.name));
}
export function doMigrationPlan(history, tag) {
  if (tag === null) return { new_tag: history.at(-1).tag, steps: history.map(({ tag, ...step }) => step) };
  const index = history.findIndex(x => x.tag === tag); if (index < 0) fail();
  return index === history.length - 1 ? undefined : { old_tag: tag, new_tag: history.at(-1).tag, steps: history.slice(index + 1).map(({ tag, ...step }) => step) };
}
async function assetUpload(api, store, d, artifact, prefix) {
  const blake = require('blake3-wasm');
  const manifest = Object.fromEntries(artifact.assets.map(a => [a.name, { hash: blake.hash(a.base64 + extname(a.name).slice(1)).toString('hex').slice(0,32), size: a.bytes }]));
  const session = confirmed(await effect(store, prefix + '-asset-session', { artifact: artifact.digest, manifest },
    () => api(versionBase(d) + '/assets-upload-session', { method: 'POST', body: { manifest } })));
  if (typeof session?.jwt !== 'string' || !Array.isArray(session.buckets) || session.buckets.length > 100
    || session.buckets.some(b => !Array.isArray(b) || b.length > 1000)) fail();
  let jwt = session.jwt;
  for (let i = 0; i < session.buckets.length; i++) {
    const bucket = session.buckets[i], form = new FormData();
    for (const hash of bucket) {
      const entries = Object.entries(manifest).filter(([,v]) => v.hash === hash);
      if (!entries.length) fail();
      const part = artifact.assets.find(a => a.name === entries[0][0]);
      form.set(hash, new Blob([bytesOf(part).toString('base64')], { type: part.type }), hash);
    }
    const result = confirmed(await effect(store, prefix + '-asset-bucket-' + i, { artifact: artifact.digest, bucket },
      () => api(`/accounts/${d.account}/workers/assets/upload?base64=true`, { method: 'POST', body: form, token: session.jwt })));
    if (result?.jwt) jwt = result.jwt;
  }
  if (!jwt || (session.buckets.flat().length && jwt === session.jwt)) fail();
  return { jwt, manifest };
}
async function verifyVersion(api, d, id, artifact, quarantine = false) {
  const base = versionBase(d), row = await api(base + '/versions/' + id);
  const content = await api(base + '/content/v2?version=' + id, { raw: true });
  if (row?.id !== id || !content.headers.get('content-type')?.startsWith('multipart/form-data')
    || content.headers.get('cf-entrypoint') !== (quarantine ? 'quarantine.mjs' : artifact.main)
    || !same(visibleBindings(row.resources?.bindings), visibleBindings(bindings(d)))) fail();
  const parts = await content.formData(), expected = [...artifact.modules, ...(quarantine ? [quarantineModule()] : [])];
  if ([...parts.keys()].length !== expected.length) fail();
  for (const p of expected) { const value = parts.get(p.name); if (typeof value === 'string' || !value || sha256(Buffer.from(await value.arrayBuffer())) !== p.sha256) fail(); }
  if (row.resources?.script_runtime?.compatibility_date !== artifact.compatibility_date
    || !same(row.resources.script_runtime.compatibility_flags ?? [], artifact.compatibility_flags)) fail();
  return row;
}
function quarantineModule() {
  return blob('quarantine.mjs', Buffer.from('export * from "./worker.mjs";\nexport default {fetch(){return new Response("Maintenance",{status:503,headers:{"Cache-Control":"no-store"}})},scheduled(){throw new Error("Maintenance")},queue(){throw new Error("Maintenance")}};\n'), 'application/javascript+module');
}
function versionProof(d,id,artifact,quarantine) {
  return {version:id,artifact:artifact.digest,barriers:digest(artifact.barriers),desired:digest(d),main:artifact.main,
    modules:artifact.modules.map(({name,sha256})=>({name,sha256})),compatibility_date:artifact.compatibility_date,
    compatibility_flags:artifact.compatibility_flags,quarantine};
}
async function verifyProof(api,d,proof) {
  if(!exact(proof,['version','artifact','barriers','desired','main','modules','compatibility_date','compatibility_flags','quarantine'])
    ||!UUID.test(proof.version)||!SHA.test(proof.artifact)||!SHA.test(proof.barriers)||proof.desired!==digest(d)||proof.main!=='worker.mjs'
    ||!Array.isArray(proof.modules)||proof.modules.length!==1||!exact(proof.modules[0],['name','sha256'])
    ||proof.modules[0].name!==proof.main||!SHA.test(proof.modules[0].sha256)||typeof proof.quarantine!=='boolean'
    ||typeof proof.compatibility_date!=='string'||!Array.isArray(proof.compatibility_flags))fail();
  await verifyVersion(api,d,proof.version,proof,proof.quarantine);
}
async function uploadVersion(api, store, d, artifact, operation, prefix = 'upload', quarantine = false) {
  validateArtifact(artifact);
  const held=await store.read(prefix+'-version.intent');
  if(held&&!await store.read(prefix+'-version.done')) {
    const observed=await versions(api,d);
    if(!await store.read(prefix+'-reconciliation'))await store.write(prefix+'-reconciliation',{observed,reposted:false,unconfirmed:true});
    fail();
  }
  const before = await state(api, d), base = versionBase(d);
  let tag = null;
  if (before.versions.length) {
    const scripts = await api(`/accounts/${d.account}/workers/scripts`);
    if (!Array.isArray(scripts) || scripts.length > 1000) fail();
    const script = scripts.find(x => x.id === d.script);
    tag = script?.migration_tag; if (typeof tag !== 'string') fail();
  }
  const migrations = doMigrationPlan(artifact.doMigrations, tag);
  const assets = await assetUpload(api, store, d, artifact, prefix);
  const metadata = { main_module: quarantine ? 'quarantine.mjs' : artifact.main,
    compatibility_date: artifact.compatibility_date, compatibility_flags: artifact.compatibility_flags,
    bindings: bindings(d), assets: { jwt: assets.jwt, config: { html_handling: 'none', not_found_handling: 'none', run_worker_first: true } },
    ...(migrations ? { migrations } : {}), annotations: { 'workers/tag': operation + '-' + prefix,
      'workers/message': artifact.digest },
    ...(before.settings?.logpush === undefined ? {} : { logpush: before.settings.logpush }),
    ...(before.settings?.tail_consumers === undefined ? {} : { tail_consumers: before.settings.tail_consumers }),
    observability: before.settings?.observability ?? { enabled: false, head_sampling_rate: 0, logs: { enabled: false, invocation_logs: false } } };
  const form = new FormData(); form.set('metadata', canonical(metadata));
  for (const p of [...artifact.modules, ...(quarantine ? [quarantineModule()] : [])]) form.set(p.name, new Blob([bytesOf(p)], { type: p.type }), p.name);
  const result = confirmed(await effect(store, prefix + '-version', { desired: digest(d), artifact: artifact.digest, before, metadata }, async () => {
    if (!same(await state(api,d), before)) fail();
    return api(base + '/versions', { method: 'POST', body: form });
  }, () => versions(api,d)));
  if (!UUID.test(result?.id)) fail();
  await verifyVersion(api, d, result.id, artifact, quarantine);
  const after = await state(api,d);
  if (!same(after.settings, before.settings) && before.settings !== null || !same(after.deployments, before.deployments) && before.deployments !== null
    || !same(after.schedules, before.schedules) && before.schedules !== null) fail();
  const code=versionProof(d,result.id,artifact,quarantine);
  return { version: result.id, artifact: artifact.digest, desired: d, secretCommitment: digest(d.secrets),code,latestUpload:code,
    assets: assets.manifest, sourceState: after, barriers: digest(artifact.barriers), quarantine,
    limitations: ['Secret values opaque; acknowledged explicit material, not readback equality.', 'Asset content-addressed upload acknowledged; live served-byte verification remains required.', 'Analytics dataset binding intent is not verified existence.'] };
}

function authorization(input, mode, operation, now) {
  const a = input.authorization, d = input.desired;
  if (!exact(a, ['operation','mode','account','script','evidence','expiresAt']) || a.operation !== operation || a.mode !== mode
    || a.account !== d.account || a.script !== d.script || !SHA.test(a.evidence) || !Number.isSafeInteger(a.expiresAt)
    || a.expiresAt <= now || a.expiresAt > now + 24 * 3600000) fail();
}
function maintenance(input, operation, now, phase) {
  const m = input.maintenance;
  if (!exact(m, ['operation','account','script','database','evidence','issuedAt','expiresAt','covers','queueEmpty','producersStopped','resume',
    ...(recoveryWired(input.desired) ? ['queues'] : [])])
    || m.operation !== operation || m.account !== input.desired.account || m.script !== input.desired.script
    || m.database !== input.desired.resources.database.id || !SHA.test(m.evidence)
    || !Number.isSafeInteger(m.issuedAt) || !Number.isSafeInteger(m.expiresAt) || m.issuedAt > now
    || m.expiresAt <= now || m.expiresAt - m.issuedAt > 3600000
    || !same([...m.covers].sort(), ['active-and-old-versions','http-inflight','durable-object-work','websockets','scheduled-work','queue-inflight','external-d1-writers'].sort())
    || m.queueEmpty !== true || m.producersStopped !== true || (phase === 'resume' && m.resume !== true)) fail();
  if (recoveryWired(input.desired)) {
    const ids = recoveryQueues(input.desired).map(kind => input.desired.resources[kind].id);
    if (!exact(m.queues, ids) || ids.some(id => !exact(m.queues[id], ['empty','producersStopped'])
      || m.queues[id].empty !== true || m.queues[id].producersStopped !== true)) fail();
  }
  // This validates explicit owner evidence, not the truth of live quiescence.
}
async function pauseQueue(api, store, d, paused, prefix, kind = 'queue') {
  const row = await inspectResource(api,d,kind,d.resources[kind]), path = resourceAPI(d.account,kind,d.resources[kind]).item;
  if (!object(row.settings)) fail();
  const body = { queue_name: row.queue_name, settings: { ...row.settings, delivery_paused: paused } };
  if (row.settings.delivery_paused !== paused) confirmed(await effect(store,prefix,{ path, body, before: row.settings },
    () => api(path,{ method:'PATCH',body }), () => api(path)));
  const after = await inspectResource(api,d,kind,d.resources[kind]);
  if (!same(after.settings,body.settings)) fail();
  return after;
}
async function schedules(api, store, d, crons, prefix) {
  const path = versionBase(d) + '/schedules', before = await api(path);
  const desired = crons.map(cron => ({ cron }));
  if (!Array.isArray(before)) fail();
  if (!same(before.map(x => x.cron).sort(), [...crons].sort())) confirmed(await effect(store,prefix,{ path, desired, before },
    () => api(path,{ method:'PUT',body:desired }), () => api(path)));
  const after = await api(path);
  if (!Array.isArray(after) || !same(after.map(x => x.cron).sort(), [...crons].sort())) fail();
  return after;
}
async function traffic(api,store,d,id,key,guard) {
  const path = versionBase(d) + '/deployments', before = await api(path);
  const body = { strategy:'percentage', versions:[{ version_id:id,percentage:100 }] };
  const deployments = x => Array.isArray(x) ? x : x?.deployments;
  const current = deployments(before)?.[0];
  if(guard){guard.authorize();if(!same(before,guard.state.deployments))fail();}
  if (!same(current?.versions,body.versions)) confirmed(await effect(store,key,{ path, body, before,...(guard?{expected:guard.state}:{}) },
    async () => {
      if(guard){if(!same(await state(api,d),guard.state))fail();guard.authorize();}
      return api(path,{ method:'POST',body });
    }, () => api(path)));
  const after = await api(path);
  if (!same(deployments(after)?.[0]?.versions,body.versions)) fail();
  if(guard){
    const observed=await state(api,d);guard.authorize();
    if(activeVersion(observed)!==id||!same({...observed,deployments:guard.state.deployments},guard.state))fail();
  }
}
async function configureRuntime(api,store,d) {
  requireIntakePolicies(d);
  const base = versionBase(d), current = await api(base + '/script-settings');
  if (current.observability?.enabled === true || current.logpush === true || current.tail_consumers?.length) fail();
  const observability = { enabled:false,head_sampling_rate:0,logs:{ enabled:false,invocation_logs:false } };
  if (!same(current.observability,observability)) {
    confirmed(await effect(store,'script-settings',{ before:current,observability },
      () => api(base + '/script-settings',{ method:'PATCH',body:{ observability } }), () => api(base + '/script-settings')));
    const after = await api(base + '/script-settings');
    if (!same(after,{ ...current,observability })) fail();
  }
  for (let i=0;i<d.routes.length;i++) {
    const route=d.routes[i], path=`/zones/${route.zone}/workers/routes`, before=await api(path);
    if (!Array.isArray(before) || before.length>1000) fail();
    const matches=before.filter(x=>x.pattern===route.pattern);
    if (matches.length>1 || matches.some(x=>x.script!==d.script)) fail();
    if (!matches.length) confirmed(await effect(store,'route-'+i,{ route,script:d.script,before },
      () => api(path,{ method:'POST',body:{ pattern:route.pattern,script:d.script } }),()=>api(path)));
    const after=await api(path);
    if (!Array.isArray(after) || after.filter(x=>x.pattern===route.pattern && x.script===d.script).length!==1
      || before.some(x=>!after.some(y=>same(x,y)))) fail();
  }
  for (const kind of recoveryQueues(d)) {
  const queue=await inspectResource(api,d,kind,d.resources[kind]);
  if (queue.consumers.length>1) fail();
  const body={ type:'worker',script_name:d.script,...(kind === 'queue' ? {dead_letter_queue:d.resources.deadLetter.name} : {}),
    settings:{ batch_size:100,max_retries:2,max_wait_time_ms:3000,max_concurrency:6 } };
  const expected=c=>c?.type==='worker' && (c.script??c.service)===d.script && c.dead_letter_queue===body.dead_letter_queue
    && same(c.settings,body.settings);
  const before=queue.consumers[0], path=resourceAPI(d.account,kind,d.resources[kind]).item+'/consumers';
  if (!expected(before)) confirmed(await effect(store,kind === 'queue' ? 'consumer' : 'consumer-deadletter',{ path,before:before??null,body },
    ()=>api(path+(before?'/'+before.consumer_id:''),{ method:before?'PUT':'POST',body }),
    ()=>api(resourceAPI(d.account,kind,d.resources[kind]).item)));
  const after=await inspectResource(api,d,kind,d.resources[kind]);
  if (after.consumers.length!==1 || !expected(after.consumers[0])) fail();
  }
  await schedules(api,store,d,CRONS,'schedules');
}
async function candidateCheck(api,d,artifact,candidate) {
  if (!object(candidate) || candidate.quarantine || candidate.version === undefined || candidate.artifact!==artifact.digest
    || !same(candidate.desired,d) || candidate.secretCommitment!==digest(d.secrets) || candidate.barriers!==digest(artifact.barriers)) fail();
  if(!candidate.transition)fail();
  validateTransition(candidate.transition.mode,d,candidate.transition.previous,candidate.transition.rotation);
  await verifyVersion(api,d,candidate.version,artifact);
}
async function runtimePreflight(api,d,activating=false) {
  if (activating) requireIntakePolicies(d);
  if((await versions(api,d)).length){const s=await api(versionBase(d)+'/script-settings');
    if(s.observability?.enabled===true||s.logpush===true||s.tail_consumers?.length)fail();}
  for(const route of d.routes){
    const zone=await api('/zones/'+route.zone),h=route.pattern.slice(0,-2);
    if(zone?.id!==route.zone||zone.account?.id!==d.account||!host(zone.name)||(h!==zone.name&&!h.endsWith('.'+zone.name)))fail();
    const rows=await api('/zones/'+route.zone+'/workers/routes');
    if(!Array.isArray(rows)||rows.length>1000||rows.filter(x=>x.pattern===route.pattern).length>1||rows.some(x=>x.pattern===route.pattern&&x.script!==d.script))fail();
  }
}
async function currentPrior(api,d,prior) {
  if(!prior||prior.secretCommitment!==digest(prior.desired?.secrets)||!UUID.test(prior.version)||!prior.sourceState)fail();
  validateDesired(prior.desired);
  if(prior.desired.account!==d.account||prior.desired.script!==d.script)fail();
  const current=await state(api,d);
  if(!same(current,prior.sourceState)||current.versions[0]!==prior.latestUpload?.version
    ||prior.code?.version!==prior.version||prior.code.artifact!==prior.artifact||prior.code.barriers!==prior.barriers
    ||prior.code.quarantine!==prior.quarantine||prior.latestUpload.barriers!==prior.barriers)fail();
  await verifyProof(api,prior.desired,prior.code);
  if(!same(prior.code,prior.latestUpload))await verifyProof(api,prior.desired,prior.latestUpload);
}
async function promote(api,store,d,artifact,candidate) {
  await candidateCheck(api,d,artifact,candidate);
  if (!same(await state(api,d),candidate.sourceState)) fail();
  await runtimePreflight(api,d,true);
  if (!await store.read('promotion-start')) await store.write('promotion-start',{ version:candidate.version,state:candidate.sourceState });
  await ensureResources(api,store,d,false);
  const db=d1Queries(api,d.account,d.resources.database.id,store);
  await schemaReadback(db,artifact);
  // Upload and each nonversioned operation have independent intents/results.
  // A failed step is a partial deployment, not a fabricated all-or-nothing release.
  await traffic(api,store,d,candidate.version,'promotion-traffic');
  await configureRuntime(api,store,d);
  await verifyVersion(api,d,candidate.version,artifact);
  return { ...candidate,status:'promoted',sourceState:await state(api,d),liveAcceptance:'open' };
}
async function verifyQuarantine(api,d,id,artifact) {
  await verifyVersion(api,d,id,artifact,true);
  const current=await state(api,d), list=Array.isArray(current.deployments)?current.deployments:current.deployments?.deployments;
  if (!same(list?.[0]?.versions,[{ version_id:id,percentage:100 }]) || !Array.isArray(current.schedules) || current.schedules.length) fail();
  for (const kind of recoveryQueues(d)) {
    const q=await inspectResource(api,d,kind,d.resources[kind]);
    if (q.settings?.delivery_paused!==true) fail();
  }
  return current;
}
function activeVersion(current) {
  const rows=Array.isArray(current.deployments)?current.deployments:current.deployments?.deployments,active=rows?.[0]?.versions;
  if(!Array.isArray(active)||active.length!==1||active[0].percentage!==100||!UUID.test(active[0].version_id)
    ||!current.versions.includes(active[0].version_id))fail();
  return active[0].version_id;
}
async function resumeRestored(api,store,input,artifact,operation,now,quarantine,candidate) {
  const d=input.desired;
  requireIntakePolicies(d);
  maintenance(input,operation,now(),'resume');
  const quarantined=await verifyQuarantine(api,d,quarantine.version,artifact);
  // Background is prepared only after exact completed-restore/current-topology
  // proof and fresh owner quiescence; HTTP activation is the last mutation.
  const resumedSchedules=await schedules(api,store,d,CRONS,'restore-resume-schedules');
  const expected={...quarantined,schedules:resumedSchedules};
  if(!same(await state(api,d),expected))fail();
  maintenance(input,operation,now(),'resume');
  const queueStates = quarantine.restoration?.queueStates;
  if (!exact(queueStates, recoveryQueues(d)) || Object.values(queueStates).some(value => typeof value !== 'boolean')) fail();
  for (const kind of recoveryQueues(d)) {
    maintenance(input,operation,now(),'resume');
    await pauseQueue(api,store,d,queueStates[kind],kind === 'queue' ? 'restore-resume-queue' : 'restore-resume-deadletter',kind);
  }
  maintenance(input,operation,now(),'resume');
  // This transport provides no cross-operation CAS. Refuse visible drift immediately
  // before activation and verify afterwards; the local receipt lock does not
  // serialize other deployers or make the provider sequence atomic.
  await traffic(api,store,d,candidate.version,'restore-resume-traffic',{state:expected,authorize:()=>maintenance(input,operation,now(),'resume')});
  return {...candidate,latestUpload:quarantine.latestUpload,restoration:quarantine.restoration,
    status:'restored-and-resumed',sourceState:await state(api,d),liveAcceptance:'open'};
}
async function restore(api,store,input,artifact,operation,now) {
  const d=input.desired, prior=input.previous,candidate=input.candidate;
  maintenance(input,operation,now(),'restore');
  await candidateCheck(api,d,artifact,candidate);
  if (prior.barriers!==digest(artifact.barriers)) fail();
  if(exact(input.restore,['resume'])&&input.restore.resume===true){
    const proof=prior.restoration;
    if(prior.status!=='restored-quarantined'||prior.quarantine!==true||!proof||proof.completed!==true
      ||proof.quarantine!==prior.version||proof.candidate!==digest(candidate)||proof.resumeVersion!==candidate.version
      ||!SHA.test(proof.securitySnapshot)||activeVersion(prior.sourceState)!==prior.version)fail();
    maintenance(input,operation,now(),'resume');
    await ensureResources(api,store,d,false);
    await schemaReadback(d1Queries(api,d.account,d.resources.database.id,store),artifact);
    return resumeRestored(api,store,input,artifact,operation,now,prior,candidate);
  }
  if(prior.quarantine||!exact(input.restore,['bookmark'])||!/^[0-9a-f-]{8,128}$/.test(input.restore.bookmark)
    ||activeVersion(prior.sourceState)!==candidate.version)fail();
  await ensureResources(api,store,d,false);
  let queueStates = await store.read('restore-queue-states');
  if (!queueStates) {
    queueStates = {};
    for (const kind of recoveryQueues(d)) {
      const row = await inspectResource(api,d,kind,d.resources[kind]);
      if (row.settings?.delivery_paused !== undefined && typeof row.settings.delivery_paused !== 'boolean') fail();
      queueStates[kind] = row.settings?.delivery_paused === true;
    }
    await store.write('restore-queue-states',queueStates);
  }
  if (!exact(queueStates,recoveryQueues(d)) || Object.values(queueStates).some(value => typeof value !== 'boolean')) fail();
  for (const kind of recoveryQueues(d)) await pauseQueue(api,store,d,true,kind === 'queue' ? 'restore-pause' : 'restore-pause-deadletter',kind);
  await schedules(api,store,d,[],'restore-schedules');
  const quarantine=await uploadVersion(api,store,d,artifact,operation,'quarantine',true);
  await traffic(api,store,d,quarantine.version,'quarantine-traffic');
  await verifyQuarantine(api,d,quarantine.version,artifact);
  maintenance(input,operation,now(),'restore');
  const db=d1Queries(api,d.account,d.resources.database.id,store);
  let snapshot=await store.read('security-snapshot');
  if (!snapshot) { snapshot=await captureSecurity(db,artifact); await store.write('security-snapshot',snapshot); }
  const recoverySQL=await securityRestoreSQL(snapshot,artifact);
  maintenance(input,operation,now(),'restore');
  await verifyQuarantine(api,d,quarantine.version,artifact);
  const path=`/accounts/${d.account}/d1/database/${d.resources.database.id}/time_travel/restore?bookmark=${encodeURIComponent(input.restore.bookmark)}`;
  const result=confirmed(await effect(store,'restore-bookmark',{ path,snapshot:digest(snapshot),quarantine:quarantine.version },
    ()=>api(path,{ method:'POST' }),()=>api(`/accounts/${d.account}/d1/database/${d.resources.database.id}/time_travel/bookmark`)));
  if (!result || typeof result.previous_bookmark!=='string') fail();
  await migrateProduct(db,artifact,'restore-migration');
  maintenance(input,operation,now(),'restore');
  await verifyQuarantine(api,d,quarantine.version,artifact);
  await db.write('restore-security',recoverySQL);
  if (!same(await captureSecurity(db,artifact),securityRestoration(snapshot,artifact))) fail();
  await verifyQuarantine(api,d,quarantine.version,artifact);
  const completed={...quarantine,status:'restored-quarantined',sourceState:await state(api,d),liveAcceptance:'open',
    restoration:{completed:true,bookmark:input.restore.bookmark,securitySnapshot:digest(snapshot),quarantine:quarantine.version,
      candidate:digest(candidate),resumeVersion:candidate.version,queueStates}};
  if (input.maintenance.resume!==true) return completed;
  return resumeRestored(api,store,input,artifact,operation,now,completed,candidate);
}

/** All cloud tests inject only the HTTP boundary; the production flow is identical. */
async function workflow(mode='plan',input,{ api,store,artifact,operation,execute=false,now=Date.now }={}) {
  if (!['plan','create','reconcile','add-brand','rotate','upload','promote','rollback','restore'].includes(mode)
    || !object(input) || Object.keys(input).some(k=>!['desired','previous','bootstrap','rotation','authorization','maintenance','restore','verification','candidate'].includes(k))) fail();
  let d=validateDesired(input.desired); if (!UUID.test(operation)) fail();
  if(input.bootstrap) {
    if(!exact(input.bootstrap,['owner','password'])||!d.owners.includes(input.bootstrap.owner?.id))fail();
    validateExactOwner(input.bootstrap.owner,input.bootstrap.password);
  }
  if(mode==='create'&&(!input.bootstrap||d.owners.length!==1))fail();
  const previous=input.previous?.desired;
  if (['create','reconcile','add-brand','rotate','upload','rollback','restore'].includes(mode)) validateTransition(mode,d,previous,input.rotation??[]);
  if (mode==='plan') return { status:'plan',customer:d.customer,environment:d.environment,
    operations:['inspect exact account/resources','product migrations','exact owner bootstrap if supplied','immutable version upload','separate explicit promotion'],effects:0 };
  if (!execute || typeof api!=='function' || !store) fail(); authorization(input,mode,operation,now()); validateArtifact(artifact);
  const commitment=digest({ mode,input,artifact:artifact.digest });
  const initial=await store.read('operation');
  if (initial && initial.commitment!==commitment) fail();
  if (!initial) await store.write('operation',{ version:1,mode,commitment,desired:d,artifact:artifact.digest,at:now() });
  await accountCheck(api,d);
  const completed=await store.read('result');
  if(completed) {
    if(completed.desired)await ensureResources(api,store,completed.desired,false);
    if(completed.version)await verifyVersion(api,completed.desired,completed.version,artifact,completed.quarantine===true);
    return completed;
  }
  if(!['create','promote'].includes(mode))await currentPrior(api,d,input.previous);
  if(input.previous?.quarantine&&mode!=='restore')fail();
  await runtimePreflight(api,d,['promote','rollback'].includes(mode) || mode==='restore' && (input.restore?.resume===true || input.maintenance?.resume===true));
  if (mode==='restore') return restore(api,store,input,artifact,operation,now);
  if (mode==='promote') return promote(api,store,d,artifact,input.candidate);
  if (mode==='rollback') {
    if (!input.previous || input.previous.barriers!==digest(artifact.barriers) || !same(d,input.previous.desired)) fail();
    await ensureResources(api,store,d,false);
    await schemaReadback(d1Queries(api,d.account,d.resources.database.id,store),artifact);
    const candidate=await uploadVersion(api,store,d,artifact,operation,'rollback');
    candidate.transition={mode:'upload',previous:d,rotation:[]};
    return promote(api,store,d,artifact,candidate);
  }
  if (mode==='create'&&(await versions(api,d)).length&&!await store.read('upload-version.intent')) fail();
  d=await ensureResources(api,store,d,mode==='create');
  const db=d1Queries(api,d.account,d.resources.database.id,store);
  await migrateProduct(db,artifact);
  if (input.bootstrap) {
    if (!exact(input.bootstrap,['owner','password']) || !d.owners.includes(input.bootstrap.owner?.id)) fail();
    await bootstrapExactOwner(input.bootstrap.owner,input.bootstrap.password,{ now,query:(sql,params)=>
      /^SELECT/.test(sql)?db.read(sql,params):db.write('owner-bootstrap',sql,params) });
  } else {
    for (const id of d.owners) { const rows=await db.read('SELECT id FROM operator_accounts WHERE id=?',[id]); if(rows.length!==1||rows[0].id!==id)fail(); }
  }
  if (mode==='reconcile' && same(d,input.previous.desired)) return { ...input.previous,status:'unchanged',desired:d,sourceState:await state(api,d),liveAcceptance:'open' };
  return { status:'uploaded-not-promoted',...await uploadVersion(api,store,d,artifact,operation),
    transition:{mode,previous:previous??null,rotation:input.rotation??[]} };
}
export async function runStampWorkflow(mode='plan',input,options={}) {
  const result=await workflow(mode,input,options);
  if(mode!=='plan'&&options.store&&!await options.store.read('result'))await options.store.write('result',result);
  return result;
}

async function secretInput(stream) {
  if (stream.isTTY) fail(); let timer;
  try { return await Promise.race([(async()=>{const chunks=[];let size=0;for await(const c of stream){const b=Buffer.from(c);size+=b.length;if(size>2048)fail();chunks.push(b);}
    const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!exact(v,['apiToken']))fail();return v.apiToken;})(),
    new Promise((_,reject)=>{timer=setTimeout(()=>{stream.destroy?.();reject(new Error('Stamp workflow unavailable'));},15000);})]);
  } finally {clearTimeout(timer);}
}
export async function main(argv=process.argv.slice(2),stdin=process.stdin) {
  const args={};
  for(let i=0;i<argv.length;i++) {const key=argv[i]; if(!['--mode','--input','--state','--operation','--artifact','--output','--environment','--execute'].includes(key)||Object.hasOwn(args,key))fail();
    args[key]=key==='--execute'?true:argv[++i];if(args[key]===undefined||typeof args[key]==='string'&&args[key].startsWith('--'))fail();}
  const mode=args['--mode']??'plan',input=await readProtected(args['--input'],1024*1024);
  if(args['--environment']&&args['--environment']!==input.desired?.environment)fail();
  if(mode==='package') {
    if(args['--execute']||!args['--output']||!exact(input,['profile'])||!['local-v1','ci-v1'].includes(input.profile))fail();
    const artifact=await packageArtifact({profile:input.profile});
    await createProtected(args['--output'],artifact);return {status:'packaged',artifact:artifact.digest};
  }
  if(mode==='plan')return runStampWorkflow(mode,input,{operation:args['--operation']});
  if(!args['--execute'])fail();
  const artifact=validateArtifact(await readProtected(args['--artifact']));
  const api=provider(await secretInput(stdin)),store=await protectedOperation(args['--state'],args['--operation']);
  try {const result=await runStampWorkflow(mode,input,{api,store,artifact,operation:args['--operation'],execute:true});
    if(!await store.read('result'))await store.write('result',result);
    return {status:result.status,operation:args['--operation'],liveAcceptance:'open'};
  } finally {await store.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  main().then(result=>process.stdout.write(canonical(result)+'\n'),()=>{process.stderr.write('Stamp workflow unavailable; inspect the protected operation receipt. Partial effects may remain.\n');process.exitCode=1;});
}
