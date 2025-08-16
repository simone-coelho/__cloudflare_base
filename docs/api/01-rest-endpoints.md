# REST API Endpoints

## Base URL

- **Development**: `http://localhost:9100`
- **Production**: `https://your-domain.com`

## Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```http
Authorization: Bearer <jwt-token>
```

## Endpoints

### Health Check

#### `GET /health`

Check platform health status.

**Response:**
```json
{
  "timestamp": 1234567890,
  "environment": "development",
  "status": "healthy",
  "services": {
    "cache": "healthy",
    "storage": "healthy",
    "queue": "healthy",
    "durable_objects": "healthy",
    "analytics": "healthy"
  }
}
```

---

### Real-Time Personalization

#### `POST /realtime/action`

Process a user action event and trigger personalization updates.

**Request:**
```json
{
  "type": "email_open",
  "userId": "user-123",
  "data": {
    "campaignId": "summer-sale",
    "emailId": "email-456"
  },
  "source": "email",
  "timestamp": 1234567890
}
```

**Response:**
```json
{
  "success": true,
  "message": "Action processed and personalization updated",
  "update": {
    "userId": "user-123",
    "segments": ["email_engaged", "high_value"],
    "featureVariables": {...},
    "cookiesUpdated": true
  },
  "sessionId": "session-abc-123"
}
```

#### `GET /realtime/personalization/:userId`

Get current personalization configuration for a user.

**Response:**
```json
{
  "userId": "user-123",
  "sessionId": "session-abc",
  "isNewSession": false,
  "config": {
    "segments": ["email_engaged", "high_value"],
    "featureFlags": {
      "premium_content": true,
      "beta_features": false
    },
    "featureVariables": {
      "hero_content": {
        "title": "Welcome Back!",
        "cta_text": "Explore Premium"
      }
    },
    "experiments": {
      "pricing_test": "variant_b"
    }
  }
}
```

#### `GET /realtime/segments/:userId`

Get user's current segments.

**Response:**
```json
{
  "userId": "user-123",
  "segments": ["new_user", "email_engaged"],
  "timestamp": 1234567890
}
```

#### `POST /realtime/segments/:userId`

Manually assign a segment to a user.

**Request:**
```json
{
  "segment": "vip_customer",
  "source": "manual"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Segment 'vip_customer' assigned to user user-123",
  "userId": "user-123",
  "segment": "vip_customer",
  "timestamp": 1234567890
}
```

#### `GET /realtime/ws`

WebSocket endpoint for real-time updates.

**Query Parameters:**
- `userId` (required): User identifier

**WebSocket URL:**
```
ws://localhost:9100/realtime/ws?userId=user-123
```

---

### Event Tracking

#### `POST /track/event`

Track a custom event.

**Request:**
```json
{
  "eventId": "evt-123",
  "eventType": "track",
  "event": "button_click",
  "user": {
    "userId": "user-123",
    "anonymousId": "anon-456"
  },
  "properties": {
    "button": "signup",
    "page": "/home"
  }
}
```

**Response:**
```json
{
  "success": true,
  "eventId": "evt-123",
  "processed": true,
  "queued": false
}
```

#### `POST /track/page`

Track a page view.

**Request:**
```json
{
  "user": {
    "userId": "user-123"
  },
  "page": {
    "url": "https://example.com/products",
    "path": "/products",
    "title": "Products Page"
  }
}
```

---

### Pixel Tracking

#### `POST /pixel/generate`

Generate a tracking pixel for emails.

**Request:**
```json
{
  "campaignId": "campaign-123",
  "emailId": "email-456",
  "recipientId": "user-789"
}
```

**Response:**
```json
{
  "pixelId": "encoded-pixel-id",
  "pixelUrl": "https://your-domain.com/pixel/track/encoded-pixel-id",
  "pixelHTML": "<img src=\"https://your-domain.com/pixel/track/encoded-pixel-id\" width=\"1\" height=\"1\" />"
}
```

#### `GET /pixel/track/:pixelId`

Track pixel view (returns 1x1 transparent GIF).

**Headers:**
```http
Content-Type: image/gif
Cache-Control: no-cache, no-store, must-revalidate
```

---

### Authentication

#### `POST /auth/login`

Authenticate user and receive JWT token.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "secure-password"
}
```

**Response:**
```json
{
  "token": "jwt-token-here",
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "roles": ["user"]
  },
  "expiresIn": 3600
}
```

#### `POST /auth/register`

Register a new user.

**Request:**
```json
{
  "email": "newuser@example.com",
  "password": "secure-password",
  "name": "John Doe"
}
```

#### `POST /auth/refresh`

Refresh JWT token.

**Request:**
```json
{
  "refreshToken": "refresh-token-here"
}
```

#### `GET /auth/me`

Get current authenticated user.

**Headers:**
```http
Authorization: Bearer <jwt-token>
```

---

### Session Management

#### `POST /realtime/session/:sessionId/preferences`

Update session preferences.

**Request:**
```json
{
  "trackingConsent": true,
  "personalizationEnabled": true,
  "cookieConsent": true
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "session-123",
  "preferences": {
    "trackingConsent": true,
    "personalizationEnabled": true,
    "cookieConsent": true
  }
}
```

#### `GET /realtime/session/:sessionId/analytics`

Get session analytics data.

**Response:**
```json
{
  "sessionId": "session-123",
  "analytics": {
    "sessionDuration": 300000,
    "pageViews": 5,
    "engagementScore": 75,
    "segmentHistory": ["new_user", "email_engaged", "high_value"]
  }
}
```

---

### Feature Variables

#### `GET /api/features/:userId`

Get feature variables for a user.

**Response:**
```json
{
  "userId": "user-123",
  "features": {
    "hero_content": {
      "enabled": true,
      "variables": {
        "title": "Welcome Back!",
        "subtitle": "Check out what's new",
        "cta_text": "Get Started"
      },
      "source": "optimizely"
    },
    "pricing_config": {
      "enabled": true,
      "variables": {
        "discount_percentage": 20,
        "show_enterprise": true
      },
      "source": "override"
    }
  }
}
```

#### `POST /api/features/:userId/override`

Set feature variable override for testing.

**Request:**
```json
{
  "featureKey": "hero_content",
  "variableKey": "title",
  "value": "Special VIP Welcome!",
  "expiresAt": 1234567890,
  "reason": "VIP customer treatment"
}
```

---

## Error Responses

All endpoints may return error responses in this format:

```json
{
  "error": "Error message",
  "details": "Detailed error information",
  "code": "ERROR_CODE",
  "timestamp": 1234567890
}
```

### Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `BAD_REQUEST` | 400 | Invalid request format |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

## Rate Limiting

- **Per IP**: 100 requests per minute
- **Per User**: 1000 requests per hour
- **WebSocket Connections**: 10 per user

Rate limit headers:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1234567890
```

---

🔗 **Next**: [WebSocket Protocol](./02-websocket-protocol.md)  
🔗 **Related**: [Event Types](./03-event-types.md) | [Quick Start](../guides/01-quick-start.md)