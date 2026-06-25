# Optimizely Feature Experimentation Setup Guide

## Current Setup

This platform uses **@optimizely/optimizely-sdk** v5.3.4 for Feature Experimentation. In development mode, it automatically uses a mock client when no SDK key is configured.

## What You Need for Production

### 1. Optimizely SDK Key
- Sign up for an Optimizely Feature Experimentation account
- Create a new project
- Get your SDK Key from Project Settings
- The SDK key will look like: `ABC123xyz789...`

### 2. Configuration

Update your `wrangler.toml` or set environment variables:

```toml
[vars]
OPTIMIZELY_SDK_KEY = "your-actual-sdk-key-here"
# Optional: specify a custom datafile URL
# OPTIMIZELY_DATAFILE_URL = "https://cdn.optimizely.com/datafiles/YOUR_DATAFILE.json"
```

For production deployment:
```bash
wrangler secret put OPTIMIZELY_SDK_KEY
# Enter your SDK key when prompted
```

## How It Works

### Development Mode (No SDK Key)
When `OPTIMIZELY_SDK_KEY` is not set or equals `"your-sdk-key-here"`:
- Uses a mock Optimizely client
- Returns default values for all feature flags
- Segments still process based on rules
- Perfect for testing personalization logic without Optimizely account

### Production Mode (With SDK Key)
When a valid SDK key is configured:
- Fetches real datafile from Optimizely CDN
- Caches datafile in Cloudflare KV for 5 minutes
- Evaluates real feature flags and experiments
- Tracks events to Optimizely

## SDK Package Information

### Current Package
```json
"@optimizely/optimizely-sdk": "^5.3.4"
```

This is the standard JavaScript SDK that works with Cloudflare Workers when using `node_compat` mode.

### Alternative: Edge-Optimized SDK
For better performance at the edge, Optimizely recommends using their "Lite" version which excludes:
- Datafile manager (you manage datafile fetching)
- Event processor (you handle event batching)

To use the lite version, you would need to:
1. Clone the [Optimizely Cloudflare Worker Template](https://github.com/optimizely/cloudflare-worker-template)
2. Extract their optimized SDK implementation
3. Manually manage datafile updates and event dispatching

## Feature Flags Configuration

### Creating Feature Flags in Optimizely

1. In Optimizely dashboard, go to Features
2. Create new feature flags:
   ```
   - hero_content (JSON variable)
   - pricing_config (JSON variable)
   - personalization_settings (JSON variable)
   ```

3. Set up audiences based on segments:
   ```
   - email_engaged: Users who opened emails
   - high_value: Users with high engagement
   - price_interested: Users who viewed pricing
   ```

### Example Feature Variable Configuration

```json
{
  "hero_content": {
    "title": "Welcome Back!",
    "subtitle": "Check out our latest features",
    "cta_text": "Get Started",
    "cta_color": "#4f46e5"
  },
  "pricing_config": {
    "show_discount": true,
    "discount_percentage": 20,
    "highlight_plan": "professional"
  },
  "personalization_settings": {
    "show_chat": true,
    "recommendation_engine": "collaborative",
    "content_priority": ["tutorials", "case-studies", "blog"]
  }
}
```

## Testing Your Setup

### 1. Verify SDK Key is Working
```bash
curl http://localhost:9100/optimizely/datafile
```

Should return your project's datafile if configured correctly.

### 2. Test Feature Flags
```bash
curl http://localhost:9100/optimizely/features/hero_content \
  -H "X-User-Id: test-user"
```

### 3. Check Segments Integration
```bash
curl -X POST http://localhost:9100/realtime/action \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email_open",
    "userId": "test-user",
    "data": {"email": "welcome"}
  }'
```

## Troubleshooting

### "Failed to fetch datafile: 403 Forbidden"
- SDK key is invalid or placeholder
- Check your Optimizely account status
- Verify the SDK key in Project Settings

### Feature flags return null/default values
- Ensure feature flags are created in Optimizely
- Check that experiments are running
- Verify audience conditions match your segments

### Segments not affecting feature flags
- Map segments to Optimizely audiences
- Pass segments as user attributes:
  ```javascript
  const userAttributes = {
    segments: ['email_engaged', 'high_value'],
    engagement_score: 85
  };
  ```

## Production Checklist

- [ ] Obtain Optimizely SDK Key
- [ ] Configure SDK key in environment variables
- [ ] Create feature flags in Optimizely dashboard
- [ ] Set up audiences and targeting rules
- [ ] Configure datafile caching strategy
- [ ] Set up event tracking for conversions
- [ ] Test with real SDK key locally
- [ ] Deploy to Cloudflare Workers
- [ ] Monitor Optimizely dashboard for results

## Resources

- [Optimizely Feature Experimentation Docs](https://docs.developers.optimizely.com/feature-experimentation/docs)
- [Cloudflare Workers Starter Kit](https://github.com/optimizely/cloudflare-worker-template)
- [JavaScript SDK Reference](https://docs.developers.optimizely.com/feature-experimentation/docs/javascript-node-sdk)
- [Edge Deployment Guide](https://docs.developers.optimizely.com/feature-experimentation/docs/cloudflare-workers)