// scripts/demo-kit/lib/cli.mjs — the kit's command lines, and a demo's own scripts as thin wrappers over them.
//
// Each kit command line (seed.mjs, region-seed.mjs, fetch-imagery.mjs) exports `main(argv)` and runs it only
// when it is the script node was started with. A demo keeps the script names its documents give (Vantage:
// scripts/seed-vantage.mjs, seed-vantage-region.mjs, fetch-vantage-devices.mjs) as wrappers that call that
// `main` with the demo's config first and the caller's flags after it, unchanged, so every command a resume
// or a runbook writes keeps working.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when the module at `metaUrl` is the script node was started with, not one imported by another. */
export const isEntry = (metaUrl, argv = process.argv) => Boolean(argv[1]) && resolve(argv[1]) === fileURLToPath(metaUrl);

/**
 * The kit command line a demo's own script stands for: `--config <file>`, then any flag an environment
 * variable implies (`envFlags`: name → flag, only when the caller did not pass that flag), then the caller's
 * own arguments in their order. Nothing is dropped, renamed or reordered.
 */
export function wrappedArgv(configFile, argv, { env = process.env, envFlags = {} } = {}) {
  const implied = Object.entries(envFlags).flatMap(([name, flag]) => (env[name] && !argv.includes(flag) ? [flag, env[name]] : []));
  return ['--config', configFile, ...implied, ...argv];
}
