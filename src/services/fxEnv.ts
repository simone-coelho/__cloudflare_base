/**
 * fxEnv.ts — small Optimizely-FX env helpers for the A/B + CMAB workstream (owner: ab-cmab).
 * Mirrors the private helpers in agents/tools.ts so my route + Opal tool can build an FxConfig
 * and check the write-gate without editing that shared file.
 */
import type { Env } from '@/types/env';
import type { FxConfig } from '@/services/optimizelyFx';

export function fxConfig(env: Env): FxConfig {
  return {
    token: String(env.OPTIMIZELY_API_TOKEN ?? ''),
    projectId: String(env.OPTIMIZELY_PROJECT_ID ?? ''),
    environment: env.OPTIMIZELY_ENVIRONMENT || 'development',
    sdkKey: env.OPTIMIZELY_SDK_KEY,
  };
}

/** Gate for write actions: require an explicit flag + an API token (matches tools.ts). */
export function gateWrite(env: Env): { enabled: boolean; reason: string } {
  if (env.OPTIMIZELY_WRITE_ENABLED !== 'true') {
    return { enabled: false, reason: 'OPTIMIZELY_WRITE_ENABLED is not "true" — simulating the experiment (writes disabled).' };
  }
  if (!env.OPTIMIZELY_API_TOKEN) {
    return { enabled: false, reason: 'OPTIMIZELY_API_TOKEN is not configured — simulating the experiment.' };
  }
  return { enabled: true, reason: 'enabled' };
}
