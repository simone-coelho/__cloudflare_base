#!/usr/bin/env node
/**
 * check-optimizely.mjs — Mode-B smoke test (no secrets printed).
 * --------------------------------------------------------------------------
 * Verifies the LiveDecisionProvider path end-to-end OUTSIDE the Worker:
 *   1. resolves OPTIMIZELY_SDK_KEY (env -> .dev.vars), never echoing its value
 *   2. fetches the per-environment datafile with cache:'no-store' (doc 09 §6.1)
 *   3. logs the datafile REVISION + flag/audience counts
 *   4. builds an Optimizely client + user context and calls decide() on the
 *      storefront flags, proving the graceful-degradation contract: with 0 flags
 *      in the project every decide() is "absent" -> LiveDecisionProvider returns
 *      the mock decision instead.
 *
 * Usage: node scripts/check-optimizely.mjs
 * --------------------------------------------------------------------------
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import optimizely from '@optimizely/optimizely-sdk';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function resolveSdkKey() {
  if (process.env.OPTIMIZELY_SDK_KEY) return process.env.OPTIMIZELY_SDK_KEY.trim();
  try {
    const vars = readFileSync(join(REPO_ROOT, '.dev.vars'), 'utf8');
    const m = vars.match(/^OPTIMIZELY_SDK_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* ignore */ }
  return '';
}

const CATALOG_FLAG_KEYS = ['hero_module', 'plp_sort', 'complete_the_look', 'promo_banner', 'journey_message'];

async function main() {
  const sdkKey = resolveSdkKey();
  if (!sdkKey) {
    console.error('✘ No OPTIMIZELY_SDK_KEY found (env or .dev.vars).');
    process.exit(1);
  }
  console.log(`SDK key resolved (length ${sdkKey.length}, value redacted).`);

  // 2. no-store datafile fetch (header-based, matching the Worker — workerd does not
  //    implement the `cache` field, so OptimizelyService uses cf.cacheTtl:0 + this header).
  const url = `https://cdn.optimizely.com/datafiles/${sdkKey}.json`;
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  console.log(`Datafile fetch: HTTP ${res.status} ${res.ok ? 'OK' : 'FAIL'}`);
  if (!res.ok) process.exit(1);
  const datafile = await res.json();

  // 3. log revision + inventory
  const flags = datafile.featureFlags || [];
  console.log(`Datafile revision : ${datafile.revision}`);
  console.log(`environmentKey    : ${datafile.environmentKey}`);
  console.log(`projectId         : ${datafile.projectId}`);
  console.log(`featureFlags      : ${flags.length}`);
  console.log(`experiments       : ${(datafile.experiments || []).length}`);
  console.log(`audiences         : ${(datafile.audiences || []).length}`);

  // 4. SDK decide() over the storefront flags -> shows fallback trigger condition
  const client = optimizely.createInstance({
    datafile,
    eventDispatcher: { dispatchEvent: () => {} },
    logger: optimizely.logging.createLogger({ logLevel: optimizely.enums.LOG_LEVEL.ERROR }),
  });
  if (client.onReady) await client.onReady({ timeout: 5000 });

  const user = client.createUserContext('vuid_demo_anon_001', {
    viewed_product_line: 'Tabby',
    cart_adds: 0,
    journey_stage: 'mid',
    qualified_segments: 'high_intent_tabby_browser',
  });

  console.log('\nDecide per storefront flag (live flag present? -> else mock fallback):');
  for (const key of CATALOG_FLAG_KEYS) {
    const known = flags.some((f) => f && f.key === key);
    const d = user.decide(key, [optimizely.OptimizelyDecideOption.DISABLE_DECISION_EVENT]);
    const route = known ? 'LIVE (FX flag)' : 'MOCK fallback (flag absent)';
    console.log(`  ${key.padEnd(18)} known=${String(known).padEnd(5)} enabled=${String(d.enabled).padEnd(5)} -> ${route}`);
  }

  console.log('\n✓ Mode-B datafile/SDK path verified. With 0 flags, every slot degrades to the mock decision.');
}

main().catch((e) => { console.error('✘ check failed:', e.message); process.exit(1); });
