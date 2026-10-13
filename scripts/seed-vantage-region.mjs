#!/usr/bin/env node
// scripts/seed-vantage-region.mjs — the Vantage demo's regional lean, seeded for every state.
//
// A THIN WRAPPER since the demo kit's part b (2026-10-01): it runs scripts/demo-kit/region-seed.mjs with
// scripts/demo-kit/configs/vantage.json and passes every flag through unchanged, so each command in
// docs/verizon/RESUME-vantage.md and docs/demos/BOOTSTRAP.md works as written. The model below is the one
// this header has always described; its numbers live in scripts/demo-kit/configs/vantage/region.json and
// its code in scripts/demo-kit/lib/region.mjs.
//
// docs/verizon/Vantage-Demo-Design.md §5: there is no public regional OS or
// brand data (StatCounter publishes none by state), so the regional lean on the
// first paint is the carrier's OWN sales from that region. We do not have the
// carrier's sales, so this script writes SYNTHETIC ones, labelled
// `dataSource: synthetic → warehouse` everywhere they are shown: the same
// operation a warehouse import would perform, with the data swapped.
//
// The arrival opens on the visitor's real region (lane F2, 2026-10-01): the edge
// locates the request and the page asserts nothing on beat 1. So all 50 states
// and DC carry a seeded lean; otherwise a visitor from an unseeded state opens on
// whatever this worker's own traffic left there.
//
// THE MODEL (docs/verizon/lanes/F2.md §2)
//
//   US-TX and US-NY are lane L4's rehearsed regions, unchanged byte for byte
//   (region.json's `rehearsed`; the measured beats depend on them). The other 49
//   come from one small model, built on those two:
//
//     x = clamp((state median household income − national median) / $25,000, −1, 1)
//     t = 0.5 + 0.3 · x                                        so t runs 0.2 … 0.8
//     phones, per brand · ecosystem · price band row:
//            TX(row) · (1 − t) + NY(row) · t                   400 a state, whole sales
//                                                              by largest remainder
//     home internet: 58 sales where Verizon offers home internet (the list
//            below), none elsewhere
//
//   Income: the state's own row in the shared geo_census table (U.S. Census ACS
//   2024 1-year, table B19013), read from migrations/seed/seed_011_geo.sql, the
//   file that loaded those rows; the national median is that file's US row,
//   $81,604. Only DC reaches the cap (x = 1); Mississippi is lowest (x = −0.90).
//   t = 0.5 is the national mix: the two rehearsed regions pooled (iPhone 48.75 %,
//   Samsung 33 %, Google 11 %, Motorola 7.5 %; premium 49 %, core 40 %, entry 11 %).
//   Higher income moves a state toward New York's sales (iPhone, premium), lower
//   income toward Texas's (Android, core), but never more than 0.3 of the way
//   from the middle, so every state's mix sits strictly between the two rehearsed
//   regions and no state leans harder than New York or Texas.
//
//   Home internet, a short demo list, not a coverage map: fiber, the Fios
//   footprint (NY NJ PA MA RI DE MD VA DC), and fixed wireless, the demo's own
//   5G Home list (the catalog's promo-5g-home eligibleWhen.regions: TX NY NJ PA
//   MA IL FL GA NC CA AZ CO WA MI OH VA MN TN). 58 sales, the rehearsed regions'
//   average of 90 and 25, in the 20 listed states other than NY and TX, which
//   keep their own.
//
//   Never used or derived: any protected class, household or family tables, line
//   counts, intent, a ZIP. The census income shapes only this synthetic stand-in;
//   the engine reads no census figure at decision time (the panel's
//   scored.census stays false), and in production the lean is the carrier's real
//   warehouse sales, not a model of them.
//
// For each region it calls POST /vantage/api/coldstart/prior
// (src/routes/vantageColdStart.ts), which REPLACES that region's synthetic sales
// in the tenant's regional prior: it resets the region object, ingests one
// frame per synthetic sale (brand, ecosystem, price band, category) through the
// object's own door, publishes, records the seed marker and rolls the tenant's
// regions up into the country and everyone. A rerun leaves exactly this data.
// Then it reads every seeded region back through the panel's own read and checks
// it answered at region level, labelled synthetic, with the census the model used.
//
// The region object decays with a 24-hour horizon (REGION_TAU_MS), and every
// event a visitor sends fans into the region the edge places her in, on every
// dimension, intent, lines and perk included, which this seed never writes. So a
// walkthrough leaves its own touches in the presenter's state, and one intent or
// lines touch is enough to take beat 1 off the ad for the next visitor from there
// (shares are relative to each dimension's leader). Reseed that state (--regions
// here) before showing beat 1 from it again, after any suite run, and every region
// on the morning of a rehearsal. Seeding writes no file under public/, so no
// redeploy follows it (unlike scripts/seed-vantage.mjs).
//
//   node scripts/seed-vantage-region.mjs [--base http://localhost:9110] [--token <jwt>]
//                                        [--regions US-NC,US-TX | here] [--dry-run [--rows]] [--check]
//
// --regions here is the state the edge places this machine in.
//
// --dry-run prints the model and every region's shares (--rows: its rows too), sending nothing.
// --check reads the panels back without seeding (no token needed).
// Use --token or OPERATOR_TOKEN with a grant on `vantage`. Local minting (a
// loopback --base only) needs DEPLOYMENT_PROFILE=demo and explicit JWT_SECRET,
// JWT_ISSUER, JWT_AUDIENCE, and TENANTS must grant the subject
// `seed-vantage-region` the `vantage` tenant.
import { fileURLToPath } from 'node:url';
import { isEntry, wrappedArgv } from './demo-kit/lib/cli.mjs';
import { main } from './demo-kit/region-seed.mjs';

const CONFIG = fileURLToPath(new URL('./demo-kit/configs/vantage.json', import.meta.url));

if (isEntry(import.meta.url)) process.exit(await main(wrappedArgv(CONFIG, process.argv.slice(2))));
