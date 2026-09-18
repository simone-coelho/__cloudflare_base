#!/usr/bin/env node
// Deliberate initial operator creation; existing accounts are never reset or reconciled.
// Requires an authorized, configured target with migration 0010 already applied.
// --local|--remote --env default|<named-env> --db <binding-or-name>
// --database-id <expected-UUID> --email <ASCII-email> --password-stdin
// Remote also requires --account-id <32-hex>; optional --name <name> and --admin.
// Feed an already-held temporary password through protected non-TTY stdin, never argv.
// Hash-bearing SQL still crosses the privileged child argv; host/query retention and
// external credential handoff remain operational responsibilities.
// Last-owner recovery is a distinct, explicit mode: --recover --operator-id <id>
// --expected-revision <integer> --operation-id <UUID>. The selected configured
// STAMP_OWNER_SUBJECTS must name that identity. Migration 0012 is required.
// Reconcile uncertain results with the SAME operation and password; never
// automatically choose a fresh operation. This is privileged stamp maintenance.
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG = resolve(ROOT, 'wrangler.toml');
const WRANGLER = resolve(ROOT, 'node_modules/wrangler/wrangler-dist/cli.js');
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ACCOUNT = /^[0-9a-f]{32}$/i;
const LABEL = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const invalid = () => { throw new Error('Invalid bootstrap input'); };

// The stamp workflow supplies an already validated exact target and a protected
// query transport. No account details or password are emitted by this interface.
// An existing email must resolve to the intended ID; roles never confer ownership.
export function validateExactOwner(owner, password) {
  if (!owner || typeof owner.id !== 'string' || !/^ops-[0-9a-f-]{36}$/.test(owner.id)
    || !UUID.test(owner.id.slice(4)) || typeof owner.email !== 'string'
    || owner.email !== owner.email.trim().toLowerCase() || !/^[\x21-\x7e]+@[\x21-\x7e]+$/.test(owner.email)
    || owner.email.split('@').length !== 2 || owner.email.length > 254
    || typeof owner.name !== 'string' || !owner.name.trim() || owner.name.length > 200
    || /[\x00-\x1f\x7f]/.test(owner.name) || typeof password !== 'string'
    || password.length < 10 || password.length > 200 || /[\x00-\x1f\x7f]/.test(password)
    || password.toLowerCase().includes(owner.email.split('@')[0]) || /^(.)\1+$/.test(password)) invalid();
}
export async function bootstrapExactOwner(owner, password, { query, crypto = webcrypto, now = Date.now } = {}) {
  validateExactOwner(owner, password); if (typeof query !== 'function') invalid();
  const lookup = async () => query("SELECT id,email FROM operator_accounts WHERE id=? OR lower(trim(email,char(9,10,11,12,13,32)))=?", [owner.id, owner.email]);
  const existing = await lookup();
  const matches = rows => rows.length === 1 && rows[0].id === owner.id
    && rows[0].email.trim().toLowerCase() === owner.email;
  if (existing.length) { if (!matches(existing)) invalid(); return { status: 'preserved', ownerVerified: true }; }
  const removed = await query("SELECT id FROM operator_audit WHERE action='account_removed' AND (target_id=? OR lower(trim(target_email))=?) LIMIT 1", [owner.id, owner.email]);
  if (removed.length) invalid();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
  const hash = 'pbkdf2$100000$' + Buffer.from(salt).toString('base64url') + '$' + Buffer.from(bits).toString('base64url');
  const at = now();
  const rows = await query(`INSERT INTO operator_accounts
    (id,email,name,roles,permissions,password_hash,must_change_password,disabled,created_at,updated_at)
    SELECT ?,?,?,'["operator"]','["read"]',?,1,0,?,?
    WHERE NOT EXISTS (SELECT 1 FROM operator_accounts WHERE id=? OR lower(trim(email,char(9,10,11,12,13,32)))=?)
      AND NOT EXISTS (SELECT 1 FROM operator_audit WHERE action='account_removed' AND (target_id=? OR lower(trim(target_email))=?))
    ON CONFLICT DO NOTHING RETURNING id`, [owner.id, owner.email, owner.name, hash, at, at, owner.id, owner.email, owner.id, owner.email]);
  if (rows.length > 1 || (rows.length && rows[0].id !== owner.id) || !matches(await lookup())) invalid();
  return { status: rows.length ? 'created' : 'preserved', ownerVerified: true };
}

function argumentsFor(argv) {
  const flags = new Set(['--local', '--remote', '--admin', '--password-stdin', '--recover']);
  const values = new Set(['--env', '--db', '--database-id', '--account-id', '--email', '--name', '--operator-id', '--expected-revision', '--operation-id']);
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if ((!flags.has(key) && !values.has(key)) || Object.hasOwn(options, key)) invalid();
    if (flags.has(key)) options[key] = true;
    else {
      const value = argv[++i];
      if (typeof value !== 'string' || !value || value.startsWith('--')) invalid();
      options[key] = value;
    }
  }
  const email = (options['--email'] || '').trim().toLowerCase();
  const name = (options['--name'] ?? 'Operator').trim();
  if (Boolean(options['--local']) === Boolean(options['--remote']) || !options['--password-stdin'] ||
      !LABEL.test(options['--env'] || '') || !LABEL.test(options['--db'] || '') ||
      !UUID.test(options['--database-id'] || '') || email.length > 254 ||
      !/^[\x00-\x7f]*$/.test(options['--email'] || '') ||
      !/^[\x21-\x7e]+@[\x21-\x7e]+$/.test(email) || email.split('@').length !== 2 ||
      !name || name.length > 200 || /[\x00-\x1f\x7f]/.test(name) ||
      (options['--remote'] && !ACCOUNT.test(options['--account-id'] || '')) ||
      (options['--local'] && options['--account-id'])) invalid();
  const recoveryFields = ['--operator-id', '--expected-revision', '--operation-id'];
  if (options['--recover']) {
    if (options['--admin'] || options['--name'] || !UUID.test(options['--operation-id'] || '')
      || !/^(0|[1-9][0-9]*)$/.test(options['--expected-revision'] || '')
      || !Number.isSafeInteger(Number(options['--expected-revision']))
      || typeof options['--operator-id'] !== 'string' || !options['--operator-id']
      || options['--operator-id'].length > 200 || /[\s\x00-\x1f\x7f]/.test(options['--operator-id']) || options['--operator-id'] === '*') invalid();
  } else if (recoveryFields.some(key => options[key] !== undefined)) invalid();
  return { ...options, email, name };
}

function validateTarget(options, config) {
  const selected = options['--env'] === 'default' ? config : config.env?.[options['--env']];
  if (!selected || !Array.isArray(selected.d1_databases)) invalid();
  const matches = selected.d1_databases.filter((db) => db &&
    (db.binding === options['--db'] || db.database_name === options['--db']));
  if (matches.length !== 1 || typeof matches[0].database_id !== 'string' ||
      matches[0].database_id.toLowerCase() !== options['--database-id'].toLowerCase() ||
      (options['--local'] && matches[0].preview_database_id != null)) invalid();
  const account = selected.account_id ?? config.account_id;
  const compliance = selected.compliance_region ?? config.compliance_region;
  if (compliance !== undefined && compliance !== 'public') invalid();
  if (options['--remote'] && account !== undefined &&
      (typeof account !== 'string' || !ACCOUNT.test(account) ||
      account.toLowerCase() !== options['--account-id'].toLowerCase())) invalid();
  if (options['--recover']) {
    const owners = JSON.parse(selected.vars?.STAMP_OWNER_SUBJECTS ?? '[]');
    if (!Array.isArray(owners) || !owners.length || owners.length > 100 || new Set(owners).size !== owners.length
      || !owners.every(id => typeof id === 'string' && id.trim() === id && id && id.length <= 200 && id !== '*')
      || !owners.includes(options['--operator-id'])) invalid();
  }
}

function passwordFromStdin(input, timeoutMs) {
  if (input.isTTY) invalid();
  return new Promise((accept, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off('data', data).off('end', end).off('error', fail).off('close', fail);
      input.pause();
      if (error) { input.destroy(); reject(error); return; }
      try {
        let password = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
        if (password.endsWith('\r\n')) password = password.slice(0, -2);
        else if (password.endsWith('\n')) password = password.slice(0, -1);
        if (password.length < 10 || password.length > 200 || /[\x00-\x1f\x7f]/.test(password)) invalid();
        accept(password);
      } catch { reject(new Error('Invalid password input')); }
    };
    const fail = () => finish(new Error('Incomplete password input'));
    const end = () => finish();
    const data = (chunk) => {
      try {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 1024) { fail(); return; }
        chunks.push(buffer);
      } catch { fail(); }
    };
    const timer = setTimeout(fail, timeoutMs);
    input.on('data', data).once('end', end).once('error', fail).once('close', fail);
  });
}

function childEnvironment(environment, options) {
  const env = { ...environment };
  for (const key of ['NODE_OPTIONS', 'CLOUDFLARE_ENV', 'CF_ACCOUNT_ID', 'CF_API_BASE_URL']) delete env[key];
  Object.assign(env, {
    CLOUDFLARE_API_BASE_URL: 'https://api.cloudflare.com/client/v4',
    CLOUDFLARE_COMPLIANCE_REGION: 'public', WRANGLER_API_ENVIRONMENT: 'production',
    WRANGLER_LOG: 'log', WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false', WRANGLER_LOG_SANITIZE: 'true',
  });
  if (options['--remote']) env.CLOUDFLARE_ACCOUNT_ID = options['--account-id'].toLowerCase();
  return env;
}

// Dependencies keep the complete flow testable without starting Wrangler or touching a database.
// Importing this module does not read configuration, credentials or stdin and does not seed.
export async function runOperatorSeed(argv, dependencies = {}) {
  const output = dependencies.stdout ?? console.log;
  const errorOutput = dependencies.stderr ?? console.error;
  let phase = 'arguments';
  try {
    const options = argumentsFor(argv);
    phase = 'target';
    validateTarget(options, parseToml((dependencies.readConfig ?? readFileSync)(CONFIG, 'utf8')));
    phase = 'password';
    const password = await passwordFromStdin(dependencies.stdin ?? process.stdin, dependencies.inputTimeoutMs ?? 10_000);
    if (password.toLowerCase().includes(options.email.split('@')[0]) || /^(.)\1+$/.test(password)) invalid();
    phase = 'hash';
    const crypto = dependencies.crypto ?? webcrypto;
    const recovery = Boolean(options['--recover']);
    const scope = JSON.stringify([options['--local'] ? 'local' : 'remote', options['--env'],
      options['--database-id'].toLowerCase(), options['--account-id']?.toLowerCase() ?? null]);
    const operationId = options['--operation-id']?.toLowerCase();
    // Stable, purpose-separated, per-operation salt permits a retry to commit
    // to the same password without storing a cheap unsalted password digest.
    const salt = recovery ? new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([
      'operator-owner-recovery-pbkdf2-salt', 1, scope, operationId, options['--operator-id'], options.email,
      Number(options['--expected-revision']), 'temporary-password+enable',
    ])))).slice(0, 16) : crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
    const hash = 'pbkdf2$100000$' + Buffer.from(salt).toString('base64url') + '$' + Buffer.from(bits).toString('base64url');
    const id = 'ops-' + crypto.randomUUID();
    const admin = Boolean(options['--admin']);
    const now = (dependencies.now ?? Date.now)();
    const q = (value) => "'" + String(value).replace(/'/g, "''") + "'";
    const attempt = crypto.randomUUID();
    const sql = recovery ? 'INSERT INTO operator_recovery_requests (operation_id,attempt_id,target_scope,account_id,email,expected_revision,password_hash,flags,at) VALUES ('
      + [operationId, attempt, scope, options['--operator-id'], options.email, Number(options['--expected-revision']), hash, 'temporary-password+enable', now].map(q).join(',') + ')\n'
      + 'ON CONFLICT(operation_id) DO UPDATE SET flags = CASE WHEN '
      + ['target_scope', 'account_id', 'email', 'expected_revision', 'password_hash', 'flags'].map(column => 'operator_recovery_requests.' + column + '=excluded.' + column).join(' AND ')
      + " THEN operator_recovery_requests.flags ELSE 'conflicting-recovery-request' END RETURNING operation_id,attempt_id;"
      : 'INSERT INTO operator_accounts (id, email, name, roles, permissions, password_hash, must_change_password, disabled, created_at, updated_at)\n' +
      'SELECT ' + [id, options.email, options.name, JSON.stringify(admin ? ['operator', 'admin'] : ['operator']),
        JSON.stringify(admin ? ['*'] : ['read']), hash].map(q).join(', ') + ', 1, 0, ' + now + ', ' + now + '\n' +
      'WHERE NOT EXISTS (SELECT 1 FROM operator_accounts WHERE lower(trim(email, char(9,10,11,12,13,32))) = ' + q(options.email) + ')\n' +
      'ON CONFLICT(email) DO NOTHING RETURNING id;';
    phase = 'execution';
    const result = (dependencies.execute ?? spawnSync)(process.execPath, [
      WRANGLER, 'd1', 'execute', options['--db'], '--command', sql,
      options['--local'] ? '--local' : '--remote', '--env', options['--env'] === 'default' ? '' : options['--env'],
      '--config', CONFIG, '--json', '--no-temporary',
    ], {
      cwd: ROOT, env: childEnvironment(dependencies.environment ?? process.env, options),
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: false,
      timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
    });
    if (!result || result.error || result.signal || result.status !== 0) invalid();
    const statements = JSON.parse(result.stdout);
    if (!Array.isArray(statements) || statements.length !== 1 || statements[0]?.success !== true ||
        !Array.isArray(statements[0].results)) invalid();
    const rows = statements[0].results;
    if (recovery) {
      if (rows.length !== 1 || !rows[0] || Object.keys(rows[0]).sort().join(',') !== 'attempt_id,operation_id'
        || rows[0].operation_id !== operationId || !UUID.test(rows[0].attempt_id)) invalid();
      output(rows[0].attempt_id === attempt
        ? 'Owner recovery committed with a temporary password and prior sessions revoked. Follow normal password-change sign-in; later account changes may affect usability.'
        : 'This exact recovery operation was previously committed; no recovery effects were repeated. This historical result does not assert that the supplied password is currently usable.');
      return 0;
    }
    if (rows.length > 1 || (rows.length === 1 &&
        (!rows[0] || Object.keys(rows[0]).length !== 1 || rows[0].id !== id)) ||
        (statements[0].meta?.changes !== undefined && statements[0].meta.changes !== rows.length)) invalid();
    output(rows.length ? 'Operator created with a temporary password; password change is required at first sign-in.' :
      'Operator already exists; unchanged. The supplied password was not installed.');
    return 0;
  } catch {
    const messages = {
      arguments: 'Invalid bootstrap arguments. Require explicit target flags, ASCII email and --password-stdin; remote also requires --account-id.',
      target: 'Bootstrap target does not match repository configuration.',
      password: 'Supply a valid temporary password through bounded non-TTY stdin.',
      hash: 'Bootstrap failed before database execution.',
      execution: argv.includes('--recover')
        ? 'Recovery outcome unconfirmed or conflicting. A write may have committed; reconcile the same operation, exact target and password. Do not automatically retry with a new operation.'
        : 'Bootstrap outcome unconfirmed. A write may have committed; rerun preserves existing accounts.',
    };
    errorOutput(messages[phase]);
    return ['arguments', 'target', 'password'].includes(phase) ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runOperatorSeed(process.argv.slice(2));
}
