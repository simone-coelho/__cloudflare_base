import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { RealtimeSegmentEngine, type ActionEvent } from '@/services/RealtimeSegmentEngine';
import { z } from 'zod';

const realtimeRoutes = new Hono<{ Bindings: Env }>();

// WebSocket upgrade endpoint
realtimeRoutes.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426);
  }

  const userId = c.req.query('userId');
  if (!userId) {
    return c.text('Missing userId parameter', 400);
  }

  try {
    // Get the Durable Object instance for this user
    const id = c.env.PERSONALIZATION_WEBSOCKET.idFromName(userId);
    const durableObject = c.env.PERSONALIZATION_WEBSOCKET.get(id);
    
    // Forward the WebSocket upgrade request to the Durable Object
    return durableObject.fetch(c.req.raw);
  } catch (error) {
    console.error('Error establishing WebSocket connection:', error);
    return c.text('Failed to establish WebSocket connection', 500);
  }
});

// Real-time action event processing
const actionEventSchema = z.object({
  type: z.enum(['email_open', 'form_submit', 'page_view', 'button_click', 'custom']),
  userId: z.string(),
  anonymousId: z.string().optional(),
  data: z.record(z.any()),
  source: z.string(),
  timestamp: z.number().optional()
});

realtimeRoutes.post('/action', async (c) => {
  try {
    const body = await c.req.json();
    const validatedEvent = actionEventSchema.parse(body);
    
    // Add timestamp if not provided
    const actionEvent: ActionEvent = {
      ...validatedEvent,
      timestamp: validatedEvent.timestamp || Date.now()
    };

    // Get cookie header for session management
    const cookieHeader = c.req.header('Cookie');

    // Process the action event with enhanced session management
    const segmentEngine = new RealtimeSegmentEngine(c.env);
    const result = await segmentEngine.processActionEventWithSession(actionEvent, cookieHeader);

    // Set updated cookies in response
    result.cookieHeaders.forEach(cookieHeader => {
      c.header('Set-Cookie', cookieHeader);
    });

    if (result.update) {
      return c.json({
        success: true,
        message: 'Action processed and personalization updated',
        update: result.update,
        sessionId: result.sessionId,
        cookiesUpdated: result.cookieHeaders.length > 0
      });
    } else {
      return c.json({
        success: true,
        message: 'Action processed, no personalization changes needed',
        sessionId: result.sessionId,
        cookiesUpdated: result.cookieHeaders.length > 0
      });
    }

  } catch (error) {
    console.error('Error processing action event:', error);
    
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Invalid action event format',
        details: error.errors
      }, 400);
    }

    return c.json({
      error: 'Failed to process action event',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get personalization config with session management
realtimeRoutes.get('/personalization/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    
    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    const cookieHeader = c.req.header('Cookie');
    const segmentEngine = new RealtimeSegmentEngine(c.env);
    
    // Get or create session from cookies
    const { sessionId, sessionData, isNewSession } = await segmentEngine.getOrCreateSessionFromCookies(
      cookieHeader,
      userId
    );

    // Get personalization configuration
    const config = await segmentEngine.getSessionPersonalizationConfig(sessionId);
    
    if (!config) {
      return c.json({ error: 'Failed to get personalization configuration' }, 500);
    }

    // Set cookies in response
    config.cookieHeaders.forEach(cookieHeader => {
      c.header('Set-Cookie', cookieHeader);
    });

    return c.json({
      userId,
      sessionId,
      isNewSession,
      config: {
        segments: config.segments,
        featureFlags: config.featureFlags,
        featureVariables: config.featureVariables,
        experiments: config.experiments
      },
      cookiesSet: config.cookieHeaders.length > 0,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error getting personalization config:', error);
    return c.json({
      error: 'Failed to get personalization configuration',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Session preferences management
const preferencesSchema = z.object({
  trackingConsent: z.boolean().optional(),
  personalizationEnabled: z.boolean().optional(),
  cookieConsent: z.boolean().optional()
});

realtimeRoutes.post('/session/:sessionId/preferences', async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const body = await c.req.json();
    const preferences = preferencesSchema.parse(body);

    if (!sessionId) {
      return c.json({ error: 'Session ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env);
    const updatedSession = await segmentEngine.updateSessionPreferences(sessionId, preferences);

    if (!updatedSession) {
      return c.json({ error: 'Session not found' }, 404);
    }

    // Generate updated cookies
    const cookies = await segmentEngine.getSessionPersonalizationConfig(sessionId);
    if (cookies) {
      cookies.cookieHeaders.forEach(cookieHeader => {
        c.header('Set-Cookie', cookieHeader);
      });
    }

    return c.json({
      success: true,
      sessionId,
      preferences: updatedSession.preferences,
      cookiesUpdated: cookies?.cookieHeaders.length || 0 > 0,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error updating session preferences:', error);
    
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Invalid preferences format',
        details: error.errors
      }, 400);
    }

    return c.json({
      error: 'Failed to update session preferences',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get session analytics
realtimeRoutes.get('/session/:sessionId/analytics', async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    
    if (!sessionId) {
      return c.json({ error: 'Session ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env);
    const analytics = await segmentEngine.getSessionAnalytics(sessionId);

    if (!analytics) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json({
      sessionId,
      analytics,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error retrieving session analytics:', error);
    return c.json({
      error: 'Failed to retrieve session analytics',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get user segments endpoint
realtimeRoutes.get('/segments/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    
    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env);
    const segments = await segmentEngine.getUserSegments(userId);

    return c.json({
      userId,
      segments,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error retrieving user segments:', error);
    return c.json({
      error: 'Failed to retrieve user segments',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Manual segment assignment endpoint
const assignSegmentSchema = z.object({
  segment: z.string(),
  source: z.string().optional().default('manual')
});

realtimeRoutes.post('/segments/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const body = await c.req.json();
    const { segment, source } = assignSegmentSchema.parse(body);

    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env);
    await segmentEngine.assignSegment(userId, segment, source);

    return c.json({
      success: true,
      message: `Segment '${segment}' assigned to user ${userId}`,
      userId,
      segment,
      source,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error assigning segment:', error);
    
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Invalid segment assignment format',
        details: error.errors
      }, 400);
    }

    return c.json({
      error: 'Failed to assign segment',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get WebSocket connection info
realtimeRoutes.get('/connections/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    
    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    // Get the Durable Object instance for this user
    const id = c.env.PERSONALIZATION_WEBSOCKET.idFromName(userId);
    const durableObject = c.env.PERSONALIZATION_WEBSOCKET.get(id);
    
    // Request connection info from the Durable Object
    const response = await durableObject.fetch(new Request('http://fake/connections?userId=' + userId));
    const connectionInfo = await response.json();

    return c.json(connectionInfo);

  } catch (error) {
    console.error('Error retrieving connection info:', error);
    return c.json({
      error: 'Failed to retrieve connection info',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get all WebSocket connections (admin endpoint)
realtimeRoutes.get('/connections', async (c) => {
  try {
    // Create a temporary ID to get any instance of the Durable Object
    const id = c.env.PERSONALIZATION_WEBSOCKET.idFromName('admin');
    const durableObject = c.env.PERSONALIZATION_WEBSOCKET.get(id);
    
    // Request all connections info from the Durable Object
    const response = await durableObject.fetch(new Request('http://fake/connections'));
    const connectionsInfo = await response.json();

    return c.json(connectionsInfo);

  } catch (error) {
    console.error('Error retrieving all connections:', error);
    return c.json({
      error: 'Failed to retrieve connections info',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Health check for real-time services
realtimeRoutes.get('/health', async (c) => {
  try {
    // Test WebSocket Durable Object health
    const id = c.env.PERSONALIZATION_WEBSOCKET.idFromName('health-check');
    const durableObject = c.env.PERSONALIZATION_WEBSOCKET.get(id);
    const wsHealth = await durableObject.fetch(new Request('http://fake/health'));
    const wsHealthData = await wsHealth.json();

    // Test segment engine by creating a dummy instance
    const segmentEngine = new RealtimeSegmentEngine(c.env);
    const testProfile = await segmentEngine.getUserProfile('health-check-user');
    
    return c.json({
      status: 'healthy',
      services: {
        websocket: {
          status: wsHealth.ok ? 'healthy' : 'unhealthy',
          data: wsHealthData
        },
        segmentEngine: {
          status: testProfile ? 'healthy' : 'unhealthy'
        },
        timestamp: Date.now()
      }
    });

  } catch (error) {
    console.error('Health check failed:', error);
    return c.json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now()
    }, 500);
  }
});

// Demo endpoint for testing real-time flow
const demoEventSchema = z.object({
  scenario: z.enum(['email_campaign', 'form_submission', 'pricing_page', 'demo_request']),
  userId: z.string(),
  metadata: z.record(z.any()).optional()
});

realtimeRoutes.post('/demo/trigger', async (c) => {
  try {
    const body = await c.req.json();
    const { scenario, userId, metadata = {} } = demoEventSchema.parse(body);

    let actionEvent: ActionEvent;

    // Create demo action events based on scenario
    switch (scenario) {
      case 'email_campaign':
        actionEvent = {
          type: 'email_open',
          userId,
          data: {
            campaignId: metadata.campaignId || 'demo-campaign-001',
            emailId: metadata.emailId || 'demo-email-001',
            timestamp: Date.now()
          },
          source: 'demo',
          timestamp: Date.now()
        };
        break;

      case 'form_submission':
        actionEvent = {
          type: 'form_submit',
          userId,
          data: {
            formType: metadata.formType || 'lead_capture',
            formId: metadata.formId || 'demo-form-001',
            fields: metadata.fields || { email: 'demo@example.com', interest: 'enterprise' }
          },
          source: 'demo',
          timestamp: Date.now()
        };
        break;

      case 'pricing_page':
        actionEvent = {
          type: 'page_view',
          userId,
          data: {
            path: '/pricing',
            duration: metadata.duration || 120000, // 2 minutes
            plan_viewed: metadata.plan || 'enterprise'
          },
          source: 'demo',
          timestamp: Date.now()
        };
        break;

      case 'demo_request':
        actionEvent = {
          type: 'form_submit',
          userId,
          data: {
            formType: 'demo_request',
            formId: 'demo-request-form',
            company: metadata.company || 'Demo Company Inc',
            useCase: metadata.useCase || 'E-commerce personalization'
          },
          source: 'demo',
          timestamp: Date.now()
        };
        break;

      default:
        return c.json({ error: 'Invalid demo scenario' }, 400);
    }

    // Process the demo action event
    const segmentEngine = new RealtimeSegmentEngine(c.env);
    const personalizationUpdate = await segmentEngine.processActionEvent(actionEvent);

    return c.json({
      success: true,
      scenario,
      actionEvent,
      personalizationUpdate,
      message: `Demo scenario '${scenario}' triggered successfully`
    });

  } catch (error) {
    console.error('Error triggering demo scenario:', error);
    
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Invalid demo trigger format',
        details: error.errors
      }, 400);
    }

    return c.json({
      error: 'Failed to trigger demo scenario',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default realtimeRoutes;