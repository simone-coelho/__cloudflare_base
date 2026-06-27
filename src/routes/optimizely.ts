import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '@/types/env';
import { OptimizelyService } from '@/services/OptimizelyService';
import { listBannerRules } from '@/services/optimizelyFx';
import { jwt } from '@/middleware/auth';

const optimizely = new Hono<{ Bindings: Env }>();

const DecisionRequestSchema = z.object({
  userId: z.string(),
  userAttributes: z.record(z.string(), z.any()).optional(),
  experiments: z.array(z.string()).optional(),
  features: z.array(z.string()).optional(),
});

const TrackEventSchema = z.object({
  userId: z.string(),
  eventKey: z.string(),
  userAttributes: z.record(z.string(), z.any()).optional(),
  eventTags: z.record(z.string(), z.any()).optional(),
});

optimizely.use('/decisions', jwt({ required: false }));
optimizely.use('/track', jwt({ required: false }));

optimizely.post('/decisions', async (c) => {
  try {
    const body = await c.req.json();
    const { userId, userAttributes = {}, experiments = [], features = [] } = 
      DecisionRequestSchema.parse(body);

    const optimizelyService = new OptimizelyService(c.env);
    await optimizelyService.initialize();

    const results: any = {
      userId,
      experiments: {},
      features: {},
      segments: [],
    };

    if (experiments.length > 0) {
      for (const experimentKey of experiments) {
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
        const isEnabled = await optimizelyService.isFeatureEnabled(
          featureKey,
          userId,
          userAttributes
        );
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

    const segments = await optimizelyService.getSegments(userId, userAttributes);
    results.segments = segments;

    await c.env.ANALYTICS.writeDataPoint({
      blobs: [
        JSON.stringify(results),
        'optimizely_decision',
        userId,
      ],
      doubles: [Date.now()],
      indexes: [userId],
    });

    return c.json(results);
  } catch (error) {
    console.error('Optimizely decision error:', error);
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
    console.error('Optimizely preview error:', error);
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
    console.error('banner-rules error:', e);
    return c.json({ ok: false, rules: [], error: e instanceof Error ? e.message : String(e) });
  }
});

optimizely.post('/track', async (c) => {
  try {
    const body = await c.req.json();
    const { userId, eventKey, userAttributes = {}, eventTags = {} } = 
      TrackEventSchema.parse(body);

    const optimizelyService = new OptimizelyService(c.env);
    await optimizelyService.initialize();

    await optimizelyService.track(eventKey, userId, userAttributes, eventTags);

    await c.env.ANALYTICS.writeDataPoint({
      blobs: [
        JSON.stringify({ userId, eventKey, userAttributes, eventTags }),
        'optimizely_track',
        eventKey,
      ],
      doubles: [Date.now()],
      indexes: [userId],
    });

    return c.json({
      success: true,
      userId,
      eventKey,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Optimizely track error:', error);
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
    console.error('Optimizely experiments error:', error);
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
    console.error('Optimizely features error:', error);
    return c.json({ error: 'Failed to get features' }, 500);
  }
});

optimizely.get('/datafile', async (c) => {
  try {
    const optimizelyService = new OptimizelyService(c.env);
    const datafile = await optimizelyService.getDatafile();
    
    return c.json(datafile);
  } catch (error) {
    console.error('Optimizely datafile error:', error);
    return c.json({ error: 'Failed to get datafile' }, 500);
  }
});

optimizely.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'optimizely' });
});

export { optimizely as optimizelyRoutes };