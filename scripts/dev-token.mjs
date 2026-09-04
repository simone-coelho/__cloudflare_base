#!/usr/bin/env node
// scripts/dev-token.mjs — an operator token for the local dev worker.
//
// The tuning page and the learning console ask for an "operator token": a signed
// token the worker's /config, /content and /v1 write routes verify. This mints one
// from the dev JWT settings in wrangler.toml, valid for a day. Paste it into the
// token box in the page's top bar; the page keeps it for the browser session.
//
//   node scripts/dev-token.mjs            prints a token good for 24 hours
//   node scripts/dev-token.mjs --hours 4  shorter
import { readFileSync } from 'node:fs';
import * as jose from 'jose';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const v = (k) => (toml.match(new RegExp(`^${k} = "([^"]+)"`, 'm')) || [])[1];
const hours = Number(arg('--hours', '24')) || 24;
const token = await new jose.SignJWT({ sub: arg('--sub', 'operator'), roles: ['operator'] })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(v('JWT_ISSUER')).setAudience(v('JWT_AUDIENCE')).setExpirationTime(`${hours}h`)
  .sign(new TextEncoder().encode(v('JWT_SECRET')));
console.log(token);
