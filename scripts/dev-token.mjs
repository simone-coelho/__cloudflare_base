#!/usr/bin/env node
// scripts/dev-token.mjs — an operator token for the local dev worker.
//
// The tuning page and the learning console ask for an "operator token": a signed
// token the worker's /config, /content and /v1 write routes verify. This mints one
// from explicit JWT_SECRET, JWT_ISSUER and JWT_AUDIENCE environment settings,
// valid for a day. OPERATOR_TOKEN passes an existing token through. Paste it into the
// token box in the page's top bar; the page keeps it for the browser session.
//
//   node scripts/dev-token.mjs            prints a token good for 24 hours
//   node scripts/dev-token.mjs --hours 4  shorter
import { resolveToolToken } from './lib/tool-token.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const hours = Number(arg('--hours', '24')) || 24;
const token = await resolveToolToken({ payload: { sub: arg('--sub', 'operator'), roles: ['operator'] }, expiresIn: `${hours}h` });
console.log(token);
