import { Hono } from 'hono';
import { requireConsentPurpose } from '@/identity/sessionAuthority';
import { z } from 'zod';
import type { Env } from '@/types/env';
import { OptimizelyService } from '@/services/OptimizelyService';
import { listBannerRules } from '@/services/optimizelyFx';
import { jwt } from '@/middleware/auth';
import type { TenantVariables } from '@/tenancy/tenant';
import { requireShopper, shopperPrincipal, assertSessionTarget, capabilityToken, SessionAccessError, type SessionCapability } from '@/identity/sessionCapability';
import { ownedConsent, establishRefusal } from '@/identity/consentContinuity';
import { consentFromCookies, refusalHints, intersectConsent } from '@/content/consent';

const optimizely = new Hono<{ Bindings: Env; Variables: TenantVariables }>();
const consentSchema = z.object({ tracking: z.boolean().optional(), personalization: z.boolean().optional() });

const DecisionRequestSchema = z.object({
  userId: z.string(),
  userAttributes: z.record(z.string(), z.any()).optional(),
  experiments: z.array(z.string()).optional(),
  features: z.array(z.string()).optional(),
  consent: consentSchema.optional(),
});

const TrackEventSchema = z.object({
  userId: z.string(),
  eventKey: z.string(),
  userAttributes: z.record(z.string(), z.any()).optional(),
  eventTags: z.record(z.string(), z.any()).optional(),
  consent: consentSchema.optional(),
});

/** Reuse the exact owned source; caller hints can withdraw, never grant consent. */
async function resolveConsent(env: Env, principal: SessionCapability, token: string, cookie: string | undefined, hint: unknown) {
  try {
    const consent = intersectConsent(await ownedConsent(env, principal, token), consentFromCookies(cookie), refusalHints(hint));
    return await establishRefusal(env, principal, token, consent);
  } catch { throw new SessionAccessError(); }
}

optimizely.use('/decisions', jwt({ required: false }));
optimizely.use('/track', jwt({ required: false }));

optimizely.post('/decisions', requireShopper(), async (c) => {
  try {
    const body = await c.req.json();
    const { userId, userAttributes = {}, experiments = [], features = [], consent: hint } =
      DecisionRequestSchema.parse(body);
    const principal = shopperPrincipal(c.req.raw);
    assertSessionTarget(principal, userId);
    const consent = await resolveConsent(c.env, principal, capabilityToken(c.req.raw)!, c.req.header('Cookie'), hint);
    assertSessionTarget(principal);

    const results: any = {
      userId,
      experiments: Object.create(null),
      features: Object.create(null),
      segments: [],
    };
    if (!consent.tracking || !consent.personalization) {
      for (const key of experiments) results.experiments[key] = null;
      for (const key of features) results.features[key] = { enabled: false, variables: {} };
      return c.json({ ...results, status: 'default', personalized: false,
        reason: !consent.tracking ? 'tracking_refused' : 'personalization_refused', consent });
    }

    requireConsentPurpose(consent, 'personalization');
    const optimizelyService = new OptimizelyService(c.env);
    await optimizelyService.initialize();

    if (experiments.length > 0) {
      for (const experimentKey of experiments) {
        assertSessionTarget(principal);
        const variation = await optimizelyService.getVariation(
          experimentKey,
          userId,
          userAttributes
        );
        results.experiments[experimentKey] = variation;
      }
    }

    if (features.length > 0) {
      for (const featureKey of features) {
        assertSessionTarget(principal);
        const isEnabled = await optimizelyService.isFeatureEnabled(
          featureKey,
          userId,
          userAttributes
        );
        assertSessionTarget(principal);
        const variables = await optimizelyService.getAllFeatureVariables(
          featureKey,
          userId,
          userAttributes
        );
        
        results.features[featureKey] = {
          enabled: isEnabled,
          variables,
        };
      }
    }

    assertSessionTarget(principal);
    const segments = await optimizelyService.getSegments(userId, userAttributes);
    results.segments = segments;

    return c.json(results);
  } catch (error) {
    if (error instanceof SessionAccessError) throw error;
    console.error('Optimizely decision error');
    return c.json({ error: 'Failed to get decisions' }, 500);
  }
});

// FRESH, no-store decision for "preview as this audience" — reads the LIVE datafile each call
// (bypasses the cached initialize path), so a rule Opal just created is reflected within seconds.
optimizely.post('/preview', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const userId = typeof body.userId === 'string' ? body.userId : 'preview';
    const userAttributes = body.userAttributes && typeof body.userAttributes === 'object' ? body.userAttributes : {};
    const flag = typeof body.flag === 'string' ? body.flag : 'personalized_banner';
    const variationKey = typeof body.variationKey === 'string' ? body.variationKey : null;
    const svc = new OptimizelyService(c.env);
    const { client, revision } = await svc.createFreshClient();
    if (!client || typeof (client as any).createUserContext !== 'function') {
      return c.json({ flag, enabled: false, variables: {}, error: 'SDK client unavailable' });
    }
    const ctx = (client as any).createUserContext(userId, userAttributes);
    // Force a specific variation on demand (presenter "show this arm" / Opal auto-preview).
    if (variationKey && typeof ctx.setForcedDecision === 'function') {
      try { ctx.setForcedDecision({ flagKey: flag }, { variationKey }); } catch { /* fall through to natural decide */ }
    }
    const decision = ctx.decide(flag);
    return c.json({
      flag,
      enabled: !!decision?.enabled,
      variables: decision?.variables || {},
      variationKey: decision?.variationKey || variationKey || null,
      ruleKey: decision?.ruleKey || null,
      revision,
    });
  } catch (error) {
    console.error('Optimizely preview error');
    return c.json({ error: 'Failed to preview decision' }, 500);
  }
});

// List the live personalized_banner rules (audiences/experiences we created) so the command palette
// can let you force the session into any of them. Read-only; returns [] if FX isn't configured.
optimizely.get('/banner-rules', async (c) => {
  try {
    const token = c.env.OPTIMIZELY_API_TOKEN;
    const projectId = c.env.OPTIMIZELY_PROJECT_ID;
    if (!token || !projectId) return c.json({ ok: true, rules: [], note: 'FX token/project not configured' });
    const out = await listBannerRules({ token, projectId, environment: c.env.OPTIMIZELY_ENVIRONMENT || 'development', sdkKey: c.env.OPTIMIZELY_SDK_KEY });
    return c.json({ ok: true, ...out });
  } catch (e) {
    console.error('banner-rules error');
    return c.json({ ok: false, rules: [], error: e instanceof Error ? e.message : String(e) });
  }
});

optimizely.post('/track', requireShopper(), async (c) => {
  try {
    const body = await c.req.json();
    const { userId, eventKey, userAttributes = {}, eventTags = {}, consent: hint } =
      TrackEventSchema.parse(body);
    const principal = shopperPrincipal(c.req.raw);
    assertSessionTarget(principal, userId);
    const consent = await resolveConsent(c.env, principal, capabilityToken(c.req.raw)!, c.req.header('Cookie'), hint);
    assertSessionTarget(principal);
    if (!consent.tracking) return c.json({ success: true, userId, eventKey, status: 'skipped', tracked: false, reason: 'tracking_refused', consent });
    requireConsentPurpose(consent, 'tracking');

    const optimizelyService = new OptimizelyService(c.env);
    await optimizelyService.initialize();

    assertSessionTarget(principal);
    await optimizelyService.track(eventKey, userId, userAttributes, eventTags);

    return c.json({
      success: true,
      userId,
      eventKey,
      timestamp: Date.now(),
    });
  } catch (error) {
    if (error instanceof SessionAccessError) throw error;
    console.error('Optimizely track error');
    return c.json({ error: 'Failed to track event' }, 500);
  }
});

optimizely.get('/experiments', jwt(), async (c) => {
  try {
    const optimizelyService = new OptimizelyService(c.env);
    await optimizelyService.initialize();

    const experiments = optimizelyService.getExperiments();
    
    return c.json({
      experiments: experiments.map(experiment => ({
        id: experiment.id,
        key: experiment.key,
        status: experiment.status,
        audienceIds: experiment.audienceIds,
        variations: experiment.variations.map((variation: any) => ({
          id: variation.id,
          key: variation.key,
        })),
      })),
    });
  } catch (error) {
    console.error('Optimizely experiments error');
    return c.json({ error: 'Failed to get experiments' }, 500);
  }
});

optimizely.get('/features', jwt(), async (c) => {
  try {
    const optimizelyService = new OptimizelyService(c.env);
    await optimizelyService.initialize();

    const features = optimizelyService.getFeatureFlags();
    
    return c.json({
      features: features.map(feature => ({
        id: feature.id,
        key: feature.key,
        experiments: feature.experimentIds,
        variables: feature.variables.map((variable: any) => ({
          id: variable.id,
          key: variable.key,
          type: variable.type,
          defaultValue: variable.defaultValue,
        })),
      })),
    });
  } catch (error) {
    console.error('Optimizely features error');
    return c.json({ error: 'Failed to get features' }, 500);
  }
});

optimizely.get('/datafile', async (c) => {
  try {
    const optimizelyService = new OptimizelyService(c.env);
    const datafile = await optimizelyService.getDatafile();
    
    return c.json(datafile);
  } catch (error) {
    console.error('Optimizely datafile error');
    return c.json({ error: 'Failed to get datafile' }, 500);
  }
});

optimizely.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'optimizely' });
});

export { optimizely as optimizelyRoutes };
