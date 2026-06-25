# Web Integration Guide

Learn how to integrate the Real-Time Personalization Platform into your web application.

## Quick Integration

### 1. Basic Setup

```html
<!-- Add to your HTML -->
<script>
  (function() {
    const config = {
      baseUrl: 'https://edge.example.com',
      userId: 'user-123', // Or generate dynamically
      enableWebSocket: true,
      enableCookies: true
    };
    
    // Initialize personalization
    const personalization = new PersonalizationClient(config);
    personalization.initialize();
  })();
</script>
```

### 2. JavaScript Client Library

```javascript
class PersonalizationClient {
  constructor(config) {
    this.baseUrl = config.baseUrl
    this.userId = config.userId || this.generateAnonymousId()
    this.websocket = null
    this.config = config
    this.segments = []
    this.features = {}
  }
  
  async initialize() {
    try {
      // Load initial personalization
      await this.loadPersonalization()
      
      // Connect WebSocket for real-time updates
      if (this.config.enableWebSocket) {
        this.connectWebSocket()
      }
      
      // Set up event tracking
      this.setupEventTracking()
      
      // Apply personalization to UI
      this.applyPersonalization()
      
    } catch (error) {
      console.error('Personalization initialization failed:', error)
    }
  }
  
  async loadPersonalization() {
    const response = await fetch(`${this.baseUrl}/realtime/personalization/${this.userId}`, {
      credentials: 'include' // Send cookies
    })
    
    const data = await response.json()
    this.segments = data.config.segments
    this.features = data.config.featureVariables
    this.sessionId = data.sessionId
  }
  
  connectWebSocket() {
    const wsUrl = `${this.baseUrl.replace('https', 'wss')}/realtime/ws?userId=${this.userId}`
    this.websocket = new WebSocket(wsUrl)
    
    this.websocket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      this.handleRealtimeUpdate(message)
    }
    
    this.websocket.onerror = (error) => {
      console.error('WebSocket error:', error)
      // Implement reconnection logic
    }
  }
  
  handleRealtimeUpdate(message) {
    if (message.type === 'personalization_update') {
      this.segments = message.data.segments
      this.features = message.data.featureVariables
      this.applyPersonalization()
      
      // Trigger custom event
      window.dispatchEvent(new CustomEvent('personalization:updated', {
        detail: message.data
      }))
    }
  }
  
  applyPersonalization() {
    // Apply segments as CSS classes
    document.body.className = this.segments.join(' ')
    
    // Update UI elements based on features
    this.updateContent()
    this.updateCTA()
    this.updatePricing()
  }
  
  async trackEvent(eventType, eventData) {
    const response = await fetch(`${this.baseUrl}/realtime/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        type: eventType,
        userId: this.userId,
        data: eventData,
        source: 'web',
        timestamp: Date.now()
      })
    })
    
    return response.json()
  }
  
  generateAnonymousId() {
    return 'anon-' + Math.random().toString(36).substr(2, 9)
  }
}
```

## React Integration

### React Hook

```jsx
// usePersonalization.js
import { useState, useEffect } from 'react'

export function usePersonalization(config) {
  const [segments, setSegments] = useState([])
  const [features, setFeatures] = useState({})
  const [loading, setLoading] = useState(true)
  const [client, setClient] = useState(null)
  
  useEffect(() => {
    const personalizationClient = new PersonalizationClient(config)
    
    personalizationClient.initialize().then(() => {
      setSegments(personalizationClient.segments)
      setFeatures(personalizationClient.features)
      setClient(personalizationClient)
      setLoading(false)
    })
    
    // Listen for updates
    window.addEventListener('personalization:updated', (event) => {
      setSegments(event.detail.segments)
      setFeatures(event.detail.featureVariables)
    })
    
    return () => {
      if (personalizationClient.websocket) {
        personalizationClient.websocket.close()
      }
    }
  }, [])
  
  const trackEvent = (type, data) => {
    if (client) {
      return client.trackEvent(type, data)
    }
  }
  
  return { segments, features, loading, trackEvent }
}
```

### React Component Example

```jsx
function HomePage() {
  const { segments, features, trackEvent } = usePersonalization({
    baseUrl: 'https://edge.example.com',
    userId: getUserId(),
    enableWebSocket: true
  })
  
  const handleCTAClick = () => {
    trackEvent('button_click', {
      button: 'hero_cta',
      page: 'home'
    })
  }
  
  return (
    <div className={segments.join(' ')}>
      <h1>{features.hero_content?.title || 'Welcome'}</h1>
      <p>{features.hero_content?.subtitle || 'Default subtitle'}</p>
      
      {segments.includes('high_value') && (
        <div className="vip-banner">
          Special offer for our VIP customers!
        </div>
      )}
      
      <button 
        onClick={handleCTAClick}
        style={{ 
          backgroundColor: features.ui_theme?.primary_color || '#4f46e5' 
        }}
      >
        {features.hero_content?.cta_text || 'Get Started'}
      </button>
    </div>
  )
}
```

## Vue.js Integration

```vue
<!-- PersonalizationMixin.vue -->
<script>
export default {
  data() {
    return {
      segments: [],
      features: {},
      personalizationClient: null
    }
  },
  
  async created() {
    this.personalizationClient = new PersonalizationClient({
      baseUrl: process.env.VUE_APP_EDGE_URL,
      userId: this.$store.state.user.id,
      enableWebSocket: true
    })
    
    await this.personalizationClient.initialize()
    
    this.segments = this.personalizationClient.segments
    this.features = this.personalizationClient.features
    
    window.addEventListener('personalization:updated', this.handleUpdate)
  },
  
  methods: {
    handleUpdate(event) {
      this.segments = event.detail.segments
      this.features = event.detail.featureVariables
    },
    
    async trackEvent(type, data) {
      return this.personalizationClient.trackEvent(type, data)
    }
  },
  
  beforeDestroy() {
    if (this.personalizationClient?.websocket) {
      this.personalizationClient.websocket.close()
    }
  }
}
</script>
```

## Event Tracking

### Automatic Page View Tracking

```javascript
// Track page views automatically
document.addEventListener('DOMContentLoaded', () => {
  const client = new PersonalizationClient(config)
  
  // Track initial page view
  client.trackEvent('page_view', {
    path: window.location.pathname,
    title: document.title,
    referrer: document.referrer
  })
  
  // Track navigation (for SPAs)
  const originalPushState = history.pushState
  history.pushState = function() {
    originalPushState.apply(history, arguments)
    client.trackEvent('page_view', {
      path: window.location.pathname,
      title: document.title
    })
  }
})
```

### Form Submission Tracking

```javascript
// Track form submissions
document.querySelectorAll('form').forEach(form => {
  form.addEventListener('submit', (e) => {
    const formData = new FormData(form)
    const data = Object.fromEntries(formData)
    
    client.trackEvent('form_submit', {
      formId: form.id,
      formType: form.dataset.type || 'unknown',
      fields: data
    })
  })
})
```

### Click Tracking

```javascript
// Track button clicks
document.addEventListener('click', (e) => {
  if (e.target.matches('button, a[data-track]')) {
    client.trackEvent('button_click', {
      element: e.target.tagName,
      text: e.target.textContent,
      id: e.target.id,
      classes: e.target.className,
      href: e.target.href
    })
  }
})
```

## Cookie Management

### Reading Personalization Cookies

```javascript
function getPersonalizationCookies() {
  const cookies = document.cookie.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=')
    if (key.startsWith('opt_')) {
      acc[key] = decodeURIComponent(value)
    }
    return acc
  }, {})
  
  return {
    segments: cookies.opt_segments?.split(',') || [],
    userId: cookies.opt_user_id,
    sessionId: cookies.opt_session_id,
    engagementScore: parseInt(cookies.opt_engagement_score || '0')
  }
}
```

### Consent Management

```javascript
class ConsentManager {
  constructor(client) {
    this.client = client
  }
  
  async updateConsent(preferences) {
    const response = await fetch(
      `${this.client.baseUrl}/realtime/session/${this.client.sessionId}/preferences`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(preferences)
      }
    )
    
    return response.json()
  }
  
  enableTracking() {
    return this.updateConsent({
      trackingConsent: true,
      personalizationEnabled: true,
      cookieConsent: true
    })
  }
  
  disableTracking() {
    return this.updateConsent({
      trackingConsent: false,
      personalizationEnabled: false,
      cookieConsent: false
    })
  }
}
```

## Advanced Features

### Segment-Based CSS

```css
/* Style based on segments */
body.high_value .premium-content {
  display: block;
}

body.email_engaged .email-cta {
  background-color: #10b981;
  font-weight: bold;
}

body.price_interested .pricing-banner {
  display: flex;
  animation: pulse 2s infinite;
}
```

### A/B Testing Integration

```javascript
// Use feature variables for A/B tests
function renderHeroSection(features) {
  const variant = features.hero_test?.variant || 'control'
  
  switch(variant) {
    case 'variant_a':
      return renderVariantA(features.hero_content)
    case 'variant_b':
      return renderVariantB(features.hero_content)
    default:
      return renderControl(features.hero_content)
  }
}
```

### Progressive Enhancement

```javascript
// Graceful degradation when personalization fails
class SafePersonalizationClient extends PersonalizationClient {
  async initialize() {
    try {
      await super.initialize()
    } catch (error) {
      console.warn('Personalization unavailable, using defaults')
      this.useDefaults()
    }
  }
  
  useDefaults() {
    this.segments = ['default']
    this.features = {
      hero_content: {
        title: 'Welcome',
        subtitle: 'Default experience',
        cta_text: 'Learn More'
      }
    }
    this.applyPersonalization()
  }
}
```

## Performance Optimization

### Lazy Loading

```javascript
// Load personalization asynchronously
if ('requestIdleCallback' in window) {
  requestIdleCallback(() => {
    const client = new PersonalizationClient(config)
    client.initialize()
  })
} else {
  setTimeout(() => {
    const client = new PersonalizationClient(config)
    client.initialize()
  }, 1)
}
```

### Caching Strategy

```javascript
// Cache personalization data in localStorage
class CachedPersonalizationClient extends PersonalizationClient {
  async loadPersonalization() {
    // Check cache first
    const cached = localStorage.getItem('personalization')
    if (cached) {
      const data = JSON.parse(cached)
      if (Date.now() - data.timestamp < 300000) { // 5 minutes
        this.segments = data.segments
        this.features = data.features
        this.applyPersonalization()
        
        // Update in background
        super.loadPersonalization().then(() => {
          this.cachePersonalization()
        })
        return
      }
    }
    
    // Load fresh data
    await super.loadPersonalization()
    this.cachePersonalization()
  }
  
  cachePersonalization() {
    localStorage.setItem('personalization', JSON.stringify({
      segments: this.segments,
      features: this.features,
      timestamp: Date.now()
    }))
  }
}
```

## Testing

### Unit Testing

```javascript
// Jest test example
describe('PersonalizationClient', () => {
  let client
  
  beforeEach(() => {
    client = new PersonalizationClient({
      baseUrl: 'http://localhost:9100',
      userId: 'test-user'
    })
    
    // Mock fetch
    global.fetch = jest.fn()
  })
  
  test('loads personalization on initialize', async () => {
    fetch.mockResolvedValueOnce({
      json: async () => ({
        config: {
          segments: ['test_segment'],
          featureVariables: { test: true }
        }
      })
    })
    
    await client.initialize()
    
    expect(client.segments).toContain('test_segment')
    expect(client.features.test).toBe(true)
  })
})
```

---

🔗 **Next**: [Mobile Integration](./02-mobile-integration.md)  
🔗 **Related**: [React Native](./03-react-native.md) | [API Reference](../api/01-rest-endpoints.md)