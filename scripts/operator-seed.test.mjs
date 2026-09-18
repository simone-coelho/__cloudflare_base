import assert from 'node:assert/strict';
import { pbkdf2Sync, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runOperatorSeed, bootstrapExactOwner } from './operator-seed.mjs';

// Synthetic input only. Every child is intercepted; no seed/Wrangler CLI is executed.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DB_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = 'a'.repeat(32);
const SECRET = '  Synthetic-\u212a-Secret9  ';
const CONFIG = `account_id = "${ACCOUNT}"
[[d1_databases]]
binding = "DB"
database_name = "fixture-db"
database_id = "${DB_ID}"
[env.staging]
[[env.staging.d1_databases]]
binding = "DB"
database_name = "fixture-stage"
database_id = "${OTHER_ID}"
`;
const BASE = ['--local', '--env', 'default', '--db', 'DB', '--database-id', DB_ID,
  '--email', 'operator@example.test', '--password-stdin'];
const replace = (args, key, value) => args.map((item, index) => args[index - 1] === key ? value : item);
const remote = (args = BASE) => [...args.map((item) => item === '--local' ? '--remote' : item), '--account-id', ACCOUNT];
const success = (rows = [], changes = rows.length) => ({ status: 0, stderr: '',
  stdout: JSON.stringify([{ success: true, results: rows, meta: { changes } }]) });

test('W08.05 exact initial owner binding preserves existing identity and refuses conflicts/removal resurrection',async()=>{
  const {db,snapshot}=databaseFixture();try{
    const owner={id:'ops-11111111-1111-4111-8111-111111111111',email:'person@example.test',name:'Person'};
    const query=async(sql,params)=>db.prepare(sql).all(...params);
    const input={query,now:()=>100};
    assert.equal((await bootstrapExactOwner(owner,SECRET,input)).status,'created');
    db.prepare('UPDATE operator_accounts SET disabled=1,updated_at=101').run();
    db.prepare('INSERT INTO operator_sessions VALUES (?,?,?,?,?)').run('held',owner.id,'hash',1,200);
    const before=snapshot();
    assert.equal((await bootstrapExactOwner(owner,'Other-Synthetic9',input)).status,'preserved');assert.equal(snapshot(),before);
    await assert.rejects(bootstrapExactOwner({...owner,id:'ops-22222222-2222-4222-8222-222222222222'},SECRET,input));assert.equal(snapshot(),before);
    db.prepare("INSERT INTO operator_audit(at,action,target_id,target_email) VALUES (102,'account_removed',?,?)").run(owner.id,owner.email);
    db.prepare('DELETE FROM operator_accounts').run();const removed=snapshot();
    await assert.rejects(bootstrapExactOwner(owner,SECRET,input));assert.equal(snapshot(),removed);
  }finally{db.close();}
});

function fixture(settings = {}) {
  const counts = { config: 0, input: 0, crypto: 0 };
  const calls = [];
  const stdout = [];
  const stderr = [];
  const dependencies = {
    readConfig(path, encoding) {
      counts.config++;
      assert.ok(path === resolve(ROOT, 'wrangler.toml') && encoding === 'utf8', 'config is anchored');
      return settings.config ?? CONFIG;
    },
    get stdin() { counts.input++; return settings.input ?? Readable.from([Buffer.from(SECRET)]); },
    get crypto() { counts.crypto++; return settings.crypto ?? webcrypto; },
    execute(...args) { calls.push(args); return settings.execute ? settings.execute(...args) : success(); },
    environment: settings.environment ?? {}, now: () => 123456789,
    inputTimeoutMs: settings.inputTimeoutMs ?? 100,
    stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line),
  };
  return { counts, calls, stdout, stderr, async run(args = BASE) { return runOperatorSeed(args, dependencies); } };
}

function confidential(f, extra = []) {
  const emitted = [...f.stdout, ...f.stderr].join('\n');
  assert.ok(![SECRET, 'pbkdf2$', 'INSERT INTO', 'raw-child-canary', ...extra].some((value) => emitted.includes(value)),
    'output contains no password, hash, SQL or raw child diagnostic; values withheld');
}

test('strict target and secret admission precedes effects; installed child target and logging are pinned', async () => {
  assert.equal(typeof runOperatorSeed, 'function');
  const missing = (flag, takesValue = false) => {
    const args = [...BASE];
    args.splice(args.indexOf(flag), takesValue ? 2 : 1);
    return args;
  };
  const badArgs = [missing('--local'), [...BASE, '--remote'], missing('--env', true), missing('--db', true),
    missing('--database-id', true), missing('--password-stdin'), [...BASE, '--local'], [...BASE, '--unknown'],
    [...BASE, '--password', SECRET], [...BASE, '--name'], replace(BASE, '--env', '--admin'),
    replace(BASE, '--database-id', 'not-an-id'), replace(BASE, '--email', 'op\u212a@example.test'),
    BASE.map((value) => value === '--local' ? '--remote' : value),
    replace(remote(), '--account-id', 'not-an-account'), [...BASE, '--account-id', ACCOUNT]];
  for (const args of badArgs) {
    const f = fixture();
    assert.equal(await f.run(args), 2);
    assert.ok(Object.values(f.counts).every((count) => count === 0) && f.calls.length === 0,
      'invalid arguments cause no config, input, crypto or child effects');
    confidential(f);
  }
  const badTargets = [
    { config: 'not valid TOML' },
    { config: 'compliance_region = "fedramp_high"\n' + CONFIG },
    { args: replace(BASE, '--db', 'absent') },
    { args: replace(BASE, '--database-id', OTHER_ID) },
    { args: replace(BASE, '--env', 'missing') },
    { config: CONFIG + '[env.empty]\nname = "empty"\n', args: replace(BASE, '--env', 'empty') },
    { config: CONFIG.replace('[env.staging]', `[[d1_databases]]\nbinding = "DB"\ndatabase_id = "${DB_ID}"\n[env.staging]`) },
    { config: CONFIG.replace('[env.staging]', `preview_database_id = "${OTHER_ID}"\n[env.staging]`) },
    { config: CONFIG.replace(ACCOUNT, 'b'.repeat(32)), args: remote() },
    { config: CONFIG.replace('[env.staging]', '[env.staging]\naccount_id = "' + 'b'.repeat(32) + '"'),
      args: replace(replace(remote(), '--env', 'staging'), '--database-id', OTHER_ID) },
  ];
  for (const { config, args } of badTargets) {
    const f = fixture({ config });
    assert.equal(await f.run(args ?? BASE), 2);
    assert.ok(f.counts.config === 1 && f.counts.input === 0 && f.counts.crypto === 0 && f.calls.length === 0,
      'invalid target causes no input, crypto or child effects');
    confidential(f);
  }
  const tty = Readable.from([SECRET]); tty.isTTY = true;
  const badInputs = [tty, Readable.from([]), Readable.from(['too-short']), Readable.from(['a'.repeat(201)]),
    Readable.from(['a'.repeat(10)]), Readable.from(['operator-password']), Readable.from([SECRET + '\nextra']),
    Readable.from([SECRET + '\n\n']), Readable.from([SECRET + '\0']), Readable.from([Buffer.from([0xc3, 0x28])]),
    Readable.from([Buffer.alloc(1025, 0x61)]), new Readable({ read() {} }),
    new Readable({ read() { this.destroy(new Error('raw-child-canary')); } })];
  for (const input of badInputs) {
    const f = fixture({ input, inputTimeoutMs: 5 });
    assert.equal(await f.run(), 2);
    assert.ok(f.counts.crypto === 0 && f.calls.length === 0, 'invalid secret causes no crypto or child effects');
    confidential(f);
  }
  const inherited = { NODE_OPTIONS: 'raw-child-canary', CLOUDFLARE_ENV: 'wrong',
    CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32), CF_ACCOUNT_ID: 'c'.repeat(32), CF_API_BASE_URL: 'https://invalid.test',
    CLOUDFLARE_API_BASE_URL: 'https://invalid.test', CLOUDFLARE_COMPLIANCE_REGION: 'fedramp_high',
    WRANGLER_API_ENVIRONMENT: 'staging', WRANGLER_LOG: 'error', WRANGLER_WRITE_LOGS: 'true',
    WRANGLER_SEND_METRICS: 'true', WRANGLER_SEND_ERROR_REPORTS: 'true', WRANGLER_LOG_SANITIZE: 'false' };
  for (const args of [BASE, replace(BASE, '--db', 'fixture-db'), remote(),
    replace(replace(remote(), '--env', 'staging'), '--database-id', OTHER_ID)]) {
    const f = fixture({ environment: inherited });
    assert.equal(await f.run(args), 0);
    assert.equal(f.calls.length, 1);
    const [command, childArgs, options] = f.calls[0];
    const childEnv = options.env;
    assert.ok(command === process.execPath && childArgs[0] === resolve(ROOT, 'node_modules/wrangler/wrangler-dist/cli.js'),
      'direct installed Wrangler Node entry, no npx');
    assert.ok(childArgs[3] === args[args.indexOf('--db') + 1] &&
      childArgs[childArgs.indexOf('--config') + 1] === resolve(ROOT, 'wrangler.toml') && options.cwd === ROOT,
      'exact configured database and repository cwd/config');
    assert.ok(childArgs[childArgs.indexOf('--env') + 1] === (args.includes('staging') ? 'staging' : '') &&
      childArgs.includes(args.includes('--remote') ? '--remote' : '--local') &&
      !childArgs.includes(args.includes('--remote') ? '--local' : '--remote') &&
      childArgs.includes('--json') && childArgs.includes('--no-temporary'), 'explicit mode/environment, JSON and no temporary account');
    assert.ok(!childArgs.some((value) => value.includes(SECRET)) && !childArgs.includes('--password'), 'no plaintext argv');
    assert.ok(!['NODE_OPTIONS', 'CLOUDFLARE_ENV', 'CF_ACCOUNT_ID', 'CF_API_BASE_URL'].some((key) => key in childEnv) &&
      childEnv.CLOUDFLARE_API_BASE_URL === 'https://api.cloudflare.com/client/v4' && childEnv.WRANGLER_LOG === 'log' &&
      childEnv.CLOUDFLARE_COMPLIANCE_REGION === 'public' && childEnv.WRANGLER_API_ENVIRONMENT === 'production' &&
      childEnv.WRANGLER_WRITE_LOGS === 'false' && childEnv.WRANGLER_SEND_METRICS === 'false' &&
      childEnv.WRANGLER_SEND_ERROR_REPORTS === 'false' && childEnv.WRANGLER_LOG_SANITIZE === 'true', 'target/log controls pinned');
    if (args.includes('--remote')) assert.ok(childEnv.CLOUDFLARE_ACCOUNT_ID === ACCOUNT, 'explicit remote account overrides ambient account');
    assert.ok(options.timeout === 30_000 && options.maxBuffer === 65536 && options.killSignal === 'SIGKILL' &&
      options.shell === false && JSON.stringify(options.stdio) === '["ignore","pipe","pipe"]', 'bounded captured child without shell');
    assert.ok(f.stdout.length === 1 && f.stdout[0].includes('already exists') && f.stderr.length === 0, 'truthful no-op output');
    confidential(f);
  }
  assert.ok(inherited.WRANGLER_WRITE_LOGS === 'true' && inherited.NODE_OPTIONS === 'raw-child-canary', 'caller environment not mutated');
});

function databaseFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0010_operator_accounts.sql', import.meta.url), 'utf8'));
  const execute = (_command, args) => {
    const rows = db.prepare(args[args.indexOf('--command') + 1]).all();
    return success(rows, db.prepare('SELECT changes() AS count').get().count);
  };
  const snapshot = () => JSON.stringify(['operator_accounts', 'operator_sessions', 'operator_audit']
    .map((table) => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()));
  return { db, execute, snapshot };
}

test('W02.08 explicit owner recovery binds target and password, commits atomically and reconciles only the same historical operation', async () => {
  const { db, execute } = databaseFixture();
  try {
    db.exec(readFileSync(new URL('../migrations/0011_operator_audit_tenant.sql', import.meta.url), 'utf8'));
    db.exec(readFileSync(new URL('../migrations/0012_operator_authority.sql', import.meta.url), 'utf8'));
    const first = fixture({ execute }); assert.equal(await first.run(), 0);
    const original = db.prepare('SELECT * FROM operator_accounts').get(), id = original.id;
    const config = CONFIG.replace('[[d1_databases]]', `[vars]\nSTAMP_OWNER_SUBJECTS = '["${id}"]'\n[[d1_databases]]`);
    const operation = '33333333-3333-4333-8333-333333333333';
    const args = [...BASE, '--recover', '--operator-id', id, '--expected-revision', String(original.updated_at), '--operation-id', operation];
    const snap = () => JSON.stringify(['operator_accounts', 'operator_sessions', 'operator_audit', 'operator_memberships', 'operator_recovery_requests']
      .map(table => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()));
    const session = () => db.prepare('INSERT INTO operator_sessions VALUES (?,?,?,?,?)').run('recover-session', id, 'synthetic', 1, 9999999999999);
    session();
    db.prepare('INSERT INTO operator_memberships VALUES (?,?,?,?,?,?,?)').run(id, 'acme', 'admin', 0, 0, 'kept-revision', 1);
    const before = snap();
    for (const attempt of [replace(args, '--operator-id', 'wrong-id'), replace(args, '--operation-id', 'invalid'),
      replace(args, '--expected-revision', '-1'), [...args, '--admin']]) {
      const f = fixture({ execute, config }); expectRecovery(await f.run(attempt), 2); assert.equal(snap(), before); confidential(f);
    }
    const stale = fixture({ execute, config }); assert.equal(await stale.run(replace(args, '--expected-revision', '0')), 1); assert.equal(snap(), before); confidential(stale);
    const recovered = fixture({ execute, config }); assert.equal(await recovered.run(args), 0);
    assert.ok(recovered.stdout[0].includes('committed'));
    const changed = db.prepare('SELECT * FROM operator_accounts').get();
    assert.equal(changed.id, original.id); assert.equal(changed.roles, original.roles); assert.equal(changed.permissions, original.permissions);
    assert.equal(changed.updated_at, original.updated_at + 1); assert.equal(changed.must_change_password, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM operator_sessions').get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM operator_audit WHERE action='account_reset'").get().n, 1);
    assert.equal(db.prepare('SELECT revision FROM operator_memberships').get().revision, 'kept-revision');
    confidential(recovered, [changed.password_hash]);
    session(); db.prepare('UPDATE operator_accounts SET disabled=1,updated_at=updated_at+1').run();
    const later = snap();
    const repeat = fixture({ execute, config }); assert.equal(await repeat.run(args), 0); assert.equal(snap(), later);
    assert.ok(repeat.stdout[0].includes('previously committed') && repeat.stdout[0].includes('does not assert')); confidential(repeat);
    const changedPassword = fixture({ execute, config, input: Readable.from(['Different-Synthetic9']) });
    assert.equal(await changedPassword.run(args), 1); assert.equal(snap(), later); confidential(changedPassword);
    const differentTarget = fixture({ execute, config }); assert.equal(await differentTarget.run(replace(args, '--email', 'different@example.test')), 1); assert.equal(snap(), later);
    db.prepare('DELETE FROM operator_accounts WHERE id=?').run(id);
    const removed = snap(), replay = fixture({ execute, config }); assert.equal(await replay.run(args), 0); assert.equal(snap(), removed);
    const fresh = fixture({ execute, config }); assert.equal(await fresh.run(replace(args, '--operation-id', '44444444-4444-4444-8444-444444444444')), 1); assert.equal(snap(), removed);
  } finally { db.close(); }
});
function expectRecovery(actual, expected) { assert.equal(actual, expected); }

test('W15 forward 0013 preserves original security and explicit owner recovery alone restores an OIDC-only password mode', async () => {
  const { db, execute } = databaseFixture();
  try {
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of ['0011_operator_audit_tenant.sql','0012_operator_authority.sql']) db.exec(readFileSync(new URL('../migrations/'+name, import.meta.url),'utf8'));
    assert.equal(await fixture({execute}).run(),0);
    const original=db.prepare('SELECT * FROM operator_accounts').get(),id=original.id;
    db.prepare('INSERT INTO operator_sessions VALUES (?,?,?,?,?)').run('password-before',id,'hash',1,9999999999999);
    db.prepare('INSERT INTO operator_memberships VALUES (?,?,?,?,?,?,?)').run(id,'acme','admin',0,0,'unchanged-membership',1);
    const priorAudit=db.prepare('SELECT * FROM operator_audit').all();
    const migration=readFileSync(new URL('../migrations/product/0013_operator_oidc.sql',import.meta.url),'utf8');
    assert.equal(migration,readFileSync(new URL('../migrations/0013_operator_oidc.sql',import.meta.url),'utf8'));
    db.exec('BEGIN');db.exec(migration);db.exec('COMMIT');
    assert.equal(JSON.stringify({...db.prepare('SELECT * FROM operator_accounts').get()})===JSON.stringify({...original,auth_mode:'password'}),true,'every original account value is preserved');
    assert.equal(db.prepare('SELECT auth_method FROM operator_sessions').get().auth_method,'password');
    assert.equal(db.prepare('SELECT revision FROM operator_memberships').get().revision,'unchanged-membership');
    assert.deepEqual(db.prepare('SELECT * FROM operator_audit').all(),priorAudit);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    db.prepare("UPDATE operator_accounts SET auth_mode='oidc',password_hash=NULL,must_change_password=0 WHERE id=?").run(id);
    db.prepare('INSERT INTO operator_oidc_links VALUES (?,?,?,?,?,?)').run(id,'https://issuer.example','exact-subject','link-before',0,2);
    assert.equal(db.prepare('SELECT count(*) n FROM operator_sessions').get().n,0);
    const oidc=db.prepare('SELECT * FROM operator_accounts').get();assert.equal(oidc.password_hash,null);
    assert.throws(()=>db.prepare("UPDATE operator_accounts SET auth_mode='password' WHERE id=?").run(id));
    db.prepare('INSERT INTO operator_sessions VALUES (?,?,?,?,?,?)').run('oidc.synthetic',id,'hash',1,9999999999999,'oidc');
    assert.throws(()=>db.prepare("UPDATE operator_sessions SET auth_method='password' WHERE jti='oidc.synthetic'").run());
    const config=CONFIG.replace('[[d1_databases]]',`[vars]\nSTAMP_OWNER_SUBJECTS = '["${id}"]'\n[[d1_databases]]`);
    const operation='15151515-1515-4515-8515-151515151515',args=[...BASE,'--recover','--operator-id',id,'--expected-revision',String(oidc.updated_at),'--operation-id',operation];
    const recovery=fixture({execute,config});assert.equal(await recovery.run(args),0);confidential(recovery);
    const restored=db.prepare('SELECT * FROM operator_accounts').get();assert.equal(restored.auth_mode,'password');assert.ok(restored.password_hash);assert.equal(restored.must_change_password,1);
    assert.equal(restored.id,id);assert.equal(restored.roles,original.roles);assert.equal(restored.permissions,original.permissions);
    assert.equal(db.prepare('SELECT count(*) n FROM operator_sessions').get().n,0);assert.equal(db.prepare('SELECT revision FROM operator_memberships').get().revision,'unchanged-membership');
    assert.equal(db.prepare('SELECT count(*) n FROM operator_recovery_requests').get().n,1);
    const snapshot=JSON.stringify(['operator_accounts','operator_audit','operator_recovery_requests','operator_oidc_links'].map(t=>db.prepare('SELECT * FROM '+t).all()));
    assert.equal(await fixture({execute,config}).run(args),0);
    assert.equal(JSON.stringify(['operator_accounts','operator_audit','operator_recovery_requests','operator_oidc_links'].map(t=>db.prepare('SELECT * FROM '+t).all())),snapshot);
    db.exec('BEGIN');db.prepare('DELETE FROM operator_accounts WHERE id=?').run(id);assert.equal(db.prepare('SELECT count(*) n FROM operator_memberships').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM operator_oidc_links').get().n,0);db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT count(*) n FROM operator_memberships').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM operator_oidc_links').get().n,1);
  } finally {db.close();}
});

test('real schema create and canonical reruns preserve credentials, authority, sessions and audit; hash stays compatible', async () => {
  const { db, execute, snapshot } = databaseFixture();
  try {
    const name = "O'Brien; -- synthetic";
    const f = fixture({ execute, input: Readable.from([Buffer.from(SECRET.slice(0, 5)), Buffer.from(SECRET.slice(5) + '\r\n')]) });
    assert.equal(await f.run([...BASE, '--name', name, '--admin']), 0);
    const row = db.prepare('SELECT * FROM operator_accounts').get();
    assert.ok(/^ops-[0-9a-f-]{36}$/.test(row.id) && row.email === 'operator@example.test' && row.name === name &&
      row.roles === '["operator","admin"]' && row.permissions === '["*"]' && row.must_change_password === 1 &&
      row.disabled === 0 && row.created_at === 123456789 && row.updated_at === 123456789 && row.last_sign_in_at === null,
      'fresh identity, escaped name, authority and required password change retained; row withheld');
    const [scheme, iterations, salt, hash] = row.password_hash.split('$');
    const expected = pbkdf2Sync(SECRET.normalize('NFKC'), Buffer.from(salt, 'base64url'), 100000, 32, 'sha256');
    assert.ok(scheme === 'pbkdf2' && iterations === '100000' && Buffer.from(salt, 'base64url').length === 16 &&
      expected.equals(Buffer.from(hash, 'base64url')) && !SECRET.includes(SECRET.normalize('NFKC')),
      'PBKDF2 SHA256/100k/16-byte salt and NFKC match accounts.ts; secret/hash withheld');
    assert.ok(f.stdout.length === 1 && f.stdout[0].includes('created') && f.stdout[0].includes('password change'), 'created outcome');
    confidential(f, [row.password_hash]);
    db.prepare('UPDATE operator_accounts SET email = ?, roles = ?, permissions = ?, must_change_password = 0, disabled = 1, updated_at = 999, last_sign_in_at = 888 WHERE id = ?')
      .run('\t OPERATOR@EXAMPLE.TEST \r', '["operator"]', '["read"]', row.id);
    db.prepare('INSERT INTO operator_sessions VALUES (?, ?, ?, ?, ?)').run('synthetic-session', row.id, 'synthetic-token-hash', 1, 2);
    db.prepare('INSERT INTO operator_audit (at, action, target_id, target_email, detail) VALUES (?, ?, ?, ?, ?)')
      .run(1, 'account_removed', row.id, 'operator@example.test', 'synthetic retained barrier');
    const before = snapshot();
    for (const args of [[...BASE, '--admin'], replace(BASE, '--email', ' OPERATOR@EXAMPLE.TEST ')]) {
      const repeat = fixture({ execute, input: Readable.from(['Different-Synthetic9\n']) });
      assert.equal(await repeat.run(args), 0);
      assert.ok(before === snapshot(), 'all account/session/audit columns unchanged on canonical repeat; rows withheld');
      assert.ok(repeat.stdout[0].includes('not installed'), 'rerun does not claim supplied password usable');
      confidential(repeat);
    }
    const concurrentArgs = replace(BASE, '--email', 'parallel@example.test');
    const concurrent = [fixture({ execute }), fixture({ execute })];
    assert.ok((await Promise.all(concurrent.map((run) => run.run(concurrentArgs)))).every((status) => status === 0), 'overlapping bootstrap calls succeed');
    assert.equal(concurrent.filter((run) => run.stdout[0].includes('created')).length, 1);
    const added = db.prepare('SELECT * FROM operator_accounts WHERE email = ?').get('parallel@example.test');
    assert.ok(added.roles === '["operator"]' && added.permissions === '["read"]' && added.must_change_password === 1, 'default operator role retained');
    assert.ok(JSON.parse(snapshot()).every((rows, index) => rows.slice(0, JSON.parse(before)[index].length)
      .every((value, rowIndex) => JSON.stringify(value) === JSON.stringify(JSON.parse(before)[index][rowIndex]))),
      'new identity does not alter retained accounts, sessions or removal history; rows withheld');
  } finally { db.close(); }
});

test('SQL collisions and child/result failures keep output confidential and acknowledge uncertain commits', async () => {
  const { db, execute, snapshot } = databaseFixture();
  try {
    const initial = fixture({ execute });
    assert.equal(await initial.run(), 0);
    const existing = db.prepare('SELECT id FROM operator_accounts').get().id.slice(4);
    const before = snapshot();
    const collision = fixture({ execute, crypto: { subtle: webcrypto.subtle,
      getRandomValues: (value) => webcrypto.getRandomValues(value), randomUUID: () => existing } });
    assert.equal(await collision.run(replace(BASE, '--email', 'collision@example.test')), 1);
    assert.ok(before === snapshot(), 'non-email uniqueness failure preserves all rows');
    confidential(collision);
    const cases = [
      () => { throw new Error('raw-child-canary ' + SECRET); },
      () => ({ status: 1, stderr: 'raw-child-canary ' + SECRET }),
      () => ({ status: null, signal: 'SIGKILL', stdout: 'raw-child-canary' }),
      () => ({ status: 0, error: new Error('raw-child-canary'), stdout: 'raw-child-canary' }),
      () => null,
      () => ({ status: 0, stdout: 'raw-child-canary' }),
      () => ({ status: 0, stdout: JSON.stringify([]) }),
      () => ({ status: 0, stdout: JSON.stringify([{ success: false, results: [] }]) }),
      () => ({ status: 0, stdout: JSON.stringify([{ success: true }]) }),
      () => ({ status: 0, stdout: JSON.stringify([{ success: true, results: [] }, { success: true, results: [] }]) }),
      () => success([{ id: 'wrong-id' }]),
      () => success([{ id: 'wrong-id' }, { id: 'wrong-id' }]),
      () => success([], 1),
      (_command, args) => { const result = execute(_command, args); return { ...result, stdout: 'raw-child-canary' }; },
    ];
    for (const child of cases) {
      const f = fixture({ execute: child });
      assert.equal(await f.run(replace(BASE, '--email', 'uncertain@example.test')), 1);
      assert.ok(f.stdout.length === 0 && f.stderr.length === 1 && f.stderr[0].includes('may have committed') &&
        f.stderr[0].includes('rerun preserves'), 'no success or fabricated rollback for failure/ambiguous result');
      confidential(f);
    }
    assert.equal(db.prepare('SELECT count(*) AS count FROM operator_accounts WHERE email = ?').get('uncertain@example.test').count, 1);
    const afterUncertain = snapshot();
    const retry = fixture({ execute });
    assert.equal(await retry.run(replace(BASE, '--email', 'uncertain@example.test')), 0);
    assert.ok(afterUncertain === snapshot() && retry.stdout[0].includes('already exists'), 'retry after lost result preserves committed account');
    confidential(retry);
  } finally { db.close(); }
});
