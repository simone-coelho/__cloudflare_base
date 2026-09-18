// Cloudflare Edge Platform Usage Examples
// This file demonstrates how to use the various APIs

const BASE_URL = 'http://localhost:9100'; // For development, use your deployed URL in production

// =============================================================================
// Authentication Examples
// =============================================================================

async function loginExample() {
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'user@example.com',
      password: 'password123'
    })
  });
  
  const { accessToken } = await response.json();
  return accessToken;
}

async function registerExample() {
  const response = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'newuser@example.com',
      password: 'password123',
      name: 'New User',
      roles: ['user']
    })
  });
  
  return await response.json();
}

// =============================================================================
// Event Tracking Examples
// =============================================================================

async function trackPageViewExample() {
  const response = await fetch(`${BASE_URL}/track/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: crypto.randomUUID(),
      eventType: 'page',
      source: 'website',
      name: 'Homepage',
      user: {
        anonymousId: 'anon-123',
        userId: 'user-456'
      },
      page: {
        url: 'https://example.com',
        path: '/',
        title: 'Homepage'
      },
      properties: {
        category: 'marketing',
        campaign: 'summer-sale'
      }
    })
  });
  
  return await response.json();
}

async function trackCustomEventExample() {
  const response = await fetch(`${BASE_URL}/track/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: crypto.randomUUID(),
      eventType: 'track',
      event: 'button_clicked',
      source: 'website',
      user: {
        userId: 'user-123',
        anonymousId: 'anon-456'
      },
      properties: {
        button_text: 'Sign Up',
        button_location: 'header',
        page: 'pricing'
      }
    })
  });
  
  return await response.json();
}

async function trackBatchEventsExample() {
  const response = await fetch(`${BASE_URL}/track/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      events: [
        {
          eventId: crypto.randomUUID(),
          eventType: 'track',
          event: 'product_viewed',
          user: { userId: 'user-123' },
          properties: { product_id: 'prod-1', price: 29.99 }
        },
        {
          eventId: crypto.randomUUID(),
          eventType: 'track',
          event: 'add_to_cart',
          user: { userId: 'user-123' },
          properties: { product_id: 'prod-1', quantity: 2 }
        }
      ],
      context: {
        source: 'ecommerce-app',
        sessionId: 'session-789'
      }
    })
  });
  
  return await response.json();
}

// =============================================================================
// Pixel Tracking Examples
// =============================================================================

async function generateEmailPixelExample() {
  const response = await fetch(`${BASE_URL}/pixel/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      campaignId: 'newsletter-2024-01',
      emailId: 'email-123',
      recipientId: 'user-456',
      metadata: {
        template: 'welcome-email',
        segment: 'new-users',
        ab_test: 'subject-line-a'
      }
    })
  });
  
  const { pixelId, pixelUrl, htmlTag } = await response.json();
  console.log('Pixel HTML to include in email:', htmlTag);
  
  return { pixelId, pixelUrl };
}

// When the pixel is loaded (email opened), it automatically tracks to:
// GET /pixel/track/{pixelId}

// =============================================================================
// Optimizely Integration Examples
// =============================================================================

// Supply the CURRENT owned session from the SDK or /v1/:tenant/identity/session.
// subject is its canonical subject, not an arbitrary account/display ID. Optional
// consent booleans can only withdraw; enabling uses the owned preferences route.
async function getOptimizelyDecisionsExample({ tenant, capability, subject, consent }) {
  const response = await fetch(`${BASE_URL}/optimizely/decisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant': tenant, 'X-Shopper-Session': capability },
    credentials: 'include',
    body: JSON.stringify({
      userId: subject,
      consent,
      userAttributes: {
        plan: 'premium',
        country: 'US',
        age: 25
      },
      experiments: ['checkout-flow-test', 'pricing-page-test'],
      features: ['new-dashboard', 'advanced-analytics']
    })
  });
  
  const decisions = await response.json();
  if (!response.ok) throw new Error('Owned Optimizely decisions unavailable');
  // Refusal returns null experiments and disabled features; keep site defaults.
  if (decisions.status === 'default') return decisions;
  
  // Use decisions to personalize experience
  if (decisions.features?.['new-dashboard']?.enabled) {
    console.log('Show new dashboard');
  }
  
  const checkoutVariation = decisions.experiments['checkout-flow-test'];
  console.log('Checkout variation:', checkoutVariation);
  
  return decisions;
}

async function trackOptimizelyEventExample({ tenant, capability, subject, consent }) {
  const response = await fetch(`${BASE_URL}/optimizely/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant': tenant, 'X-Shopper-Session': capability },
    credentials: 'include',
    body: JSON.stringify({
      userId: subject,
      consent,
      eventKey: 'purchase_completed',
      userAttributes: {
        plan: 'premium',
        country: 'US'
      },
      eventTags: {
        revenue: 99.99,
        currency: 'USD',
        product_count: 3
      }
    })
  });
  
  const result = await response.json();
  if (!response.ok) throw new Error('Owned Optimizely tracking unavailable');
  if (result.tracked === false) return result; // skipped, not a delivered metric
  return result;
}

// =============================================================================
// Customer Data Platform Examples
// =============================================================================

async function getUserProfileExample() {
  const response = await fetch(`${BASE_URL}/cdp/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'user-123'
    })
  });
  
  const profile = await response.json();
  console.log('User segments:', profile.segments);
  
  return profile;
}

async function identifyUserExample() {
  const response = await fetch(`${BASE_URL}/cdp/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'user-123',
      anonymousId: 'anon-456',
      traits: {
        name: 'John Doe',
        email: 'john@example.com',
        plan: 'premium',
        company: 'Acme Corp',
        industry: 'Technology'
      }
    })
  });
  
  return await response.json();
}

async function getUserSegmentsExample() {
  const response = await fetch(`${BASE_URL}/cdp/segments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'user-123',
      traits: {
        plan: 'premium',
        revenue: 5000,
        country: 'US'
      }
    })
  });
  
  const { segments } = await response.json();
  console.log('User segments:', segments);
  
  return segments;
}

// =============================================================================
// Webhook Examples
// =============================================================================

async function handleOptimizelyWebhookExample() {
  // This would be called by Optimizely webhook
  const response = await fetch(`${BASE_URL}/webhook/optimizely`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'optimizely',
      event_type: 'campaign.activated',
      timestamp: Date.now(),
      data: {
        campaign_id: '12345',
        experiment_id: '67890',
        visitor_uuid: 'visitor-123'
      }
    })
  });
  
  return await response.json();
}

// =============================================================================
// Complete User Journey Example
// =============================================================================

async function completeUserJourneyExample(getOwnedSession) {
  if (typeof getOwnedSession !== 'function') throw new Error('Provide getOwnedSession to read the current owned shopper session');
  console.log('🚀 Starting complete user journey example...');
  
  // 1. User lands on page
  await trackPageViewExample();
  console.log('✅ Page view tracked');
  
  // 2. Get personalization decisions
  const decisions = await getOptimizelyDecisionsExample(await getOwnedSession());
  console.log('✅ Got Optimizely decisions:', decisions);
  
  // 3. User performs actions
  await trackCustomEventExample();
  console.log('✅ Custom event tracked');
  
  // 4. Identify user when they sign up
  await identifyUserExample();
  console.log('✅ User identified');
  
  // 5. Get updated user profile with segments
  const profile = await getUserProfileExample();
  console.log('✅ Got user profile:', profile);
  
  // 6. Track conversion event
  const metric = await trackOptimizelyEventExample(await getOwnedSession());
  console.log(metric.tracked === false ? 'Conversion metric skipped: ' + metric.reason : '✅ Conversion event submitted');
  
  // 7. Generate email pixel for follow-up campaign
  const pixel = await generateEmailPixelExample();
  console.log('✅ Email pixel generated:', pixel);
  
  console.log('🎉 Complete user journey example finished!');
}

// =============================================================================
// E-commerce Example
// =============================================================================

async function ecommerceExample() {
  const userId = 'user-123';
  const sessionId = 'session-456';
  
  // Product page view
  await fetch(`${BASE_URL}/track/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: crypto.randomUUID(),
      eventType: 'track',
      event: 'product_viewed',
      user: { userId },
      properties: {
        product_id: 'shoe-123',
        product_name: 'Running Shoes',
        category: 'Footwear',
        price: 99.99,
        currency: 'USD'
      }
    })
  });
  
  // Add to cart
  await fetch(`${BASE_URL}/track/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: crypto.randomUUID(),
      eventType: 'track',
      event: 'add_to_cart',
      user: { userId },
      properties: {
        product_id: 'shoe-123',
        quantity: 1,
        price: 99.99,
        cart_total: 99.99
      }
    })
  });
  
  // Purchase
  await fetch(`${BASE_URL}/track/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: crypto.randomUUID(),
      eventType: 'track',
      event: 'purchase_completed',
      user: { userId },
      properties: {
        order_id: 'order-789',
        total: 99.99,
        currency: 'USD',
        products: [
          { id: 'shoe-123', name: 'Running Shoes', price: 99.99, quantity: 1 }
        ]
      }
    })
  });
  
  console.log('✅ E-commerce tracking completed');
}

// =============================================================================
// Health Check Example
// =============================================================================

async function healthCheckExample() {
  const response = await fetch(`${BASE_URL}/health`);
  const health = await response.json();
  
  console.log('System health:', health);
  
  if (health.status === 'healthy') {
    console.log('✅ All systems operational');
  } else {
    console.log('⚠️ Some systems degraded');
  }
  
  return health;
}

// Export functions for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    loginExample,
    trackPageViewExample,
    generateEmailPixelExample,
    getOptimizelyDecisionsExample,
    getUserProfileExample,
    completeUserJourneyExample,
    ecommerceExample,
    healthCheckExample
  };
}
