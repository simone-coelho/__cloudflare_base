# Quick Start Guide

Get the Real-Time Personalization Platform running in 5 minutes!

## Prerequisites

- Node.js 18+ installed
- Cloudflare account (free tier works)
- Git installed
- Basic command line knowledge

## 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/your-org/cloudflare-edge-platform
cd cloudflare-edge-platform

# Install dependencies
npm install
```

## 2. Configure Environment

```bash
# Copy the example configuration
cp wrangler.toml.example wrangler.toml
cp .env.example .env.local

# Edit wrangler.toml with your Cloudflare account details
# The development environment uses local settings by default
```

## 3. Start Development Server

```bash
# Start the local development server on port 9100
npm run dev
```

Your server is now running at `http://localhost:9100`

## 4. Test the Platform

### Check Health Status
```bash
curl http://localhost:9100/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": 1234567890,
  "environment": "development"
}
```

### Track an Event
```bash
curl -X POST http://localhost:9100/track/event \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "test-001",
    "eventType": "page_view",
    "userId": "demo-user",
    "properties": {
      "path": "/home"
    }
  }'
```

## 5. Open the Demo UI

Open your browser and navigate to:
```
http://localhost:9100/
```

You'll see the interactive demo with:
- Real-time WebSocket connections
- Demo scenarios to trigger events
- Live segment updates
- Session metrics

## 6. Try Demo Scenarios

Click any of the demo buttons:
- **📧 Email Open** - Simulates email tracking
- **📝 Form Submit** - Simulates lead capture
- **💰 View Pricing** - Simulates pricing page visit
- **🎯 Demo Request** - Simulates high-intent action

Watch as segments update in real-time!

## Common Issues

### Port Already in Use
```bash
# Kill the process using port 9100
lsof -ti:9100 | xargs kill -9

# Or change the port in wrangler.toml
[dev]
port = 9200  # Use a different port
```

### Missing Dependencies
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Optimizely Errors
The demo works without Optimizely credentials. To use full features:
1. Get an Optimizely SDK key
2. Add to `wrangler.toml`:
```toml
OPTIMIZELY_SDK_KEY = "your-key-here"
```

## Next Steps

✅ **Development Setup**: [Configure your development environment](./02-development-setup.md)  
✅ **Add Features**: [Learn common development tasks](./03-common-tasks.md)  
✅ **Deploy**: [Deploy to Cloudflare Workers](../deployment/01-environments.md)  
✅ **Integrate**: [Add to your application](../integration/01-web-integration.md)  

## Useful Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run test` | Run tests |
| `npm run lint` | Lint code |
| `npm run format` | Format code |

---

🔗 **Next**: [Development Setup](./02-development-setup.md)  
🔗 **Related**: [System Overview](../architecture/01-system-overview.md)