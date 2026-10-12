#!/usr/bin/env node
// scripts/seed-vantage.mjs — "Vantage": the carrier demo for Verizon, seeded.
//
// Vantage is a fictional carrier. The phones are real (public/vantage/phones.json), the plan and promotion
// SHAPES are real (seen on verizon.com 2026-09-30, docs/verizon/lanes/L3.md), the names and prices of our
// plans are ours.
//
// A THIN WRAPPER since the demo kit's part b (2026-10-01): it runs scripts/demo-kit/seed.mjs with
// scripts/demo-kit/configs/vantage.json and passes every flag through unchanged, so each command in
// docs/verizon/RESUME-vantage.md and docs/demos/BOOTSTRAP.md works as written. The demo's world is data now
// (docs/demo-kit/Demo-Kit-Design.md, decisions log), edited where it lives:
//
//   public/vantage/beats/*.json      the opening documents (open-catalog, open-slots), the fifteen beat
//                                    documents and anchor.json: THE EDITED DATA. Every run slides each window
//                                    by (now − the recorded anchor), checks the documents, writes them back
//                                    and publishes the opening ones
//   public/vantage/catalog.json      the display catalog the page paints cards from; it carries no instant,
//                                    so a seed leaves it alone
//   scripts/demo-kit/configs/vantage/reflex.json, learn.json   the registry and the learn document
//   scripts/demo-kit/configs/vantage.json   the closed list and the reset, the vocabulary, the publish notes
//
// It publishes, to the `vantage` scope, after the demo bootstrap has created its publication set once:
//
//   • the dimension registry   (PUT /config/reflex)   — eight dimensions
//   • the catalog              (PUT /content/catalog) — promotions, heroes, phone-page modules, plans
//   • the slots                (PUT /content/slots)   — hero, deals, pdp-modules, plan-pairing
//   • what the slots learn     (PUT /content/learn)   — holdout 0, γ 0, the regional prior ON, on four
//                                                       dimensions
//
// Every merchandiser beat is a real versioned publish through the real API, applied BY NAME by
// src/routes/vantage.ts from the worker's own copy of these files. That is why A RESEED MUST BE FOLLOWED BY
// A DEPLOY on a hosted worker: the seed re-anchors every window to now and rewrites the beat documents, and
// the worker reads them from its own ASSETS binding.
//
//   node scripts/seed-vantage.mjs [--base http://localhost:9110] [--token <jwt>] [--files-only] [--out <dir>]
//
// --files-only  re-anchor and write the beat documents, publish nothing (the files exist before wrangler
//               lists public/)
// --out <dir>   write them there instead of public/vantage/beats/ (a rehearsal or a proof)
// Local minting needs JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE and DEPLOYMENT_PROFILE=demo in the environment;
// a remote target needs --token (or OPERATOR_TOKEN). TENANTS must grant `seed-vantage` the `vantage` tenant.
//
// The reasoning behind the documents' numbers (the room memory, the slot weights, the arrival seeds,
// holdout 0, the regional dimensions) is in docs/verizon/Vantage-Demo-Design.md and the lane reports in
// docs/verizon/lanes/; the generator that wrote the documents until part b is this file at commit c720907.
import { fileURLToPath } from 'node:url';
import { isEntry, wrappedArgv } from './demo-kit/lib/cli.mjs';
import { main } from './demo-kit/seed.mjs';

const CONFIG = fileURLToPath(new URL('./demo-kit/configs/vantage.json', import.meta.url));

if (isEntry(import.meta.url)) process.exit(await main(wrappedArgv(CONFIG, process.argv.slice(2))));
