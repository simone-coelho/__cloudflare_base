#!/usr/bin/env node
// scripts/operator-seed.mjs — the first operator of a stamp, written straight into D1 as a hash.
//
// Provisioning used to write the operator to KV with the password in the clear, to be moved to D1
// at the first sign-in. This writes the account where it lives (doc 30) with a PBKDF2 hash, prints
// the password once, and stores nothing readable anywhere.
//
//   node scripts/operator-seed.mjs --email ops@brand.test [--name "Operator"] [--admin] [--env staging] [--local]
//
// The password is generated; pass --password to choose one. Needs wrangler logged in for a remote stamp.
import { spawnSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const email = String(arg('--email', '')).trim().toLowerCase();
if (!email.includes('@')) { console.error('pass --email'); process.exit(2); }
const name = arg('--name', 'Operator');
const envName = arg('--env', '');
const local = has('--local');
const admin = has('--admin');
const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const password = arg('--password', '') || Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => alphabet[b % alphabet.length]).join('');

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
const hash = `pbkdf2$100000$${b64u(salt)}$${b64u(new Uint8Array(bits))}`;
const id = `ops-${crypto.randomUUID().slice(0, 8)}`;
const roles = JSON.stringify(admin ? ['operator', 'admin'] : ['operator']);
const perms = JSON.stringify(admin ? ['*'] : ['read']);
const now = Date.now();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = `INSERT INTO operator_accounts (id, email, name, roles, permissions, password_hash, must_change_password, disabled, created_at, updated_at) VALUES (${q(id)}, ${q(email)}, ${q(name)}, ${q(roles)}, ${q(perms)}, ${q(hash)}, 1, 0, ${now}, ${now});`;
const db = envName === 'staging' ? 'coach-demo-db-staging' : 'coach-demo-db';
const args = ['wrangler', 'd1', 'execute', db, '--command', sql, local ? '--local' : '--remote', ...(envName ? ['--env', envName] : [])];
const r = spawnSync('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
if (r.status !== 0) { console.error('the insert failed:', (r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(-3).join(' | ')); process.exit(1); }
console.log(`Operator ${email} (${admin ? 'admin' : 'operator'}) written to ${db}${local ? ' (local)' : ''} as ${id}.`);
console.log(`Password, shown once: ${password}`);
console.log('They will be asked to choose their own at the first sign-in.');
