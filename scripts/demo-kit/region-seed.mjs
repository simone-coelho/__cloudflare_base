#!/usr/bin/env node
// scripts/demo-kit/region-seed.mjs — a demo's regional lean, seeded for every region its census holds.
//
// Driven by the config's region section: the rehearsed regions verbatim, every other region from the
// income-tilt model (scripts/demo-kit/lib/region.mjs), each one REPLACED through the demo's seed route and
// read back through its panel, labelled synthetic → warehouse. Seeding writes no file under public/, so no
// redeploy follows it. A demo's own region seed is a thin wrapper over this one (Vantage:
// scripts/seed-vantage-region.mjs).
//
//   node scripts/demo-kit/region-seed.mjs --config scripts/demo-kit/configs/vantage.json [--base http://localhost:9110]
//        [--token <jwt>] [--regions US-NC,US-TX | here] [--dry-run [--rows]] [--check]
//
// --regions here  the region the edge places this machine in (one read-only GET, even on a dry run)
// --dry-run       print the model and every region's shares (--rows: its rows too), sending nothing
// --check         read the panels back without seeding (no token needed)
// Use --token or OPERATOR_TOKEN with a grant on the tenant. Local minting (a loopback --base only) needs
// DEPLOYMENT_PROFILE=demo and explicit JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE, and TENANTS must grant the
// config's region.operator the tenant.
import { isEntry } from './lib/cli.mjs';
import { argOf, configArg, configFileFor, loadValidConfig } from './lib/config.mjs';
import { buildRegions, hereRegion, modelLine, regionLine, rowsLine, rowsProblems, runRegionSeed } from './lib/region.mjs';
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from '../lib/tool-token.mjs';

export const USAGE = 'usage: node scripts/demo-kit/region-seed.mjs --config <file> [--base <url>] [--token <jwt>] [--regions <keys> | here] [--dry-run [--rows]] [--check]';

/** The region seed, from a command line. Returns the exit code: 0 every chosen region reads right, 1 one does not, 2 a usage or config error. */
export async function main(argv = process.argv.slice(2)) {
  const file = configArg(argv, ['--config', '--base', '--token', '--regions']);
  if (!file) { console.error(USAGE); return 2; }
  // A demo's slug names scripts/demo-kit/configs/<slug>.json, as check-demo.mjs and rehearse.mjs read it (lane K4).
  const { config, path } = loadValidConfig(configFileFor(file) ?? file, { sections: ['region'] });
  const region = config.region;
  const tenant = config.tenant;
  const base = argOf(argv, '--base', `http://localhost:${config.worker.devPort}`).replace(/\/+$/, '');
  const dryRun = argv.includes('--dry-run');
  const checkOnly = argv.includes('--check');

  let built;
  try { built = buildRegions(region, { path }); } catch (error) { console.error(error.message); return 2; }
  const { all } = built;
  for (const [key, r] of Object.entries(all)) {
    const problems = rowsProblems(r.rows, region.vocabulary, region.limits);
    if (problems.length) { console.error(`${key}: the seed route would refuse these rows: ${problems.join('; ')}`); return 2; }
  }

  const chosen = argOf(argv, '--regions', Object.keys(all).join(',')).split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);
  if (chosen.includes('HERE')) {
    const key = await hereRegion({ base, panel: region.panel, tenant });
    if (!key || !all[key]) { console.error(`--regions here: the edge put ${key ? `${key}, not a region this config seeds,` : 'no region'} on this request; name the region instead`); return 2; }
    console.log(`here: the edge places this machine in ${key}`);
    chosen.splice(chosen.indexOf('HERE'), 1, key);
  }
  for (const key of chosen) if (!all[key]) { console.error(`unknown region ${key}; this config seeds ${Object.keys(all).length} regions as US-XX keys, or here`); return 2; }

  if (dryRun) {
    console.log(modelLine(region, built));
    for (const key of chosen) {
      console.log(regionLine(region, key, all[key]));
      if (argv.includes('--rows')) console.log(rowsLine(all[key]));
    }
    return 0;
  }

  let headers = null;
  if (!checkOnly) {
    try {
      const token = await resolveToolToken({ token: tokenFromArgs(argv), payload: { sub: region.operator, roles: ['operator'] },
        expiresIn: '30m', allowMint: isLoopbackTarget(base) });
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant': tenant };
    } catch (error) { console.error(`✗ ${error.message}`); return 1; }
  }
  const result = await runRegionSeed({ region, tenant, base, all, chosen, headers, checkOnly });
  return result.wrong.length ? 1 : 0;
}

if (isEntry(import.meta.url)) process.exit(await main());
