# 📚 Real-Time Personalization Platform Documentation

Welcome to the comprehensive documentation for the Real-Time Personalization Platform built on Cloudflare Workers with Optimizely integration.

## 🗂️ Documentation Structure

### 🏗️ [Architecture](./architecture/)
- [System Overview](./architecture/01-system-overview.md) - High-level architecture and design principles
- [Component Architecture](./architecture/02-components.md) - Detailed component breakdown and relationships
- [Data Flow](./architecture/03-data-flow.md) - How data moves through the system
- [Real-Time Processing](./architecture/04-realtime-processing.md) - Event processing and WebSocket architecture
- [Security Architecture](./architecture/05-security.md) - Authentication, authorization, and security measures

### 🛠️ [Developer Guides](./guides/)
- [Quick Start](./guides/01-quick-start.md) - Get up and running in 5 minutes
- [Development Setup](./guides/02-development-setup.md) - Local development environment
- [Common Tasks](./guides/03-common-tasks.md) - How to implement common features
- [Testing Guide](./guides/04-testing.md) - Testing strategies and examples
- [Debugging Guide](./guides/05-debugging.md) - Troubleshooting and debugging techniques

### 📡 [API Reference](./api/)
- [REST Endpoints](./api/01-rest-endpoints.md) - Complete REST API documentation
- [WebSocket Protocol](./api/02-websocket-protocol.md) - Real-time WebSocket communication
- [Event Types](./api/03-event-types.md) - Supported event types and schemas
- [Response Formats](./api/04-response-formats.md) - API response structures

### 🧩 [Components](./components/)
- [Segment Engine](./components/01-segment-engine.md) - Real-time segmentation logic
- [Session Manager](./components/02-session-manager.md) - Session and cookie management
- [Feature Variables](./components/03-feature-variables.md) - Feature flag and variable system
- [Event Dispatcher](./components/04-event-dispatcher.md) - Event routing and processing
- [Durable Objects](./components/05-durable-objects.md) - Stateful edge components

### 🔌 [Integration Guides](./integration/)
- [Web Integration](./integration/01-web-integration.md) - Browser/JavaScript integration
- [Mobile Integration](./integration/02-mobile-integration.md) - iOS and Android SDKs
- [React Native](./integration/03-react-native.md) - React Native implementation
- [Email Tracking](./integration/04-email-tracking.md) - Email pixel and tracking setup
- [External Services](./integration/05-external-services.md) - CDP, Analytics, and webhook integrations

### 🚀 [Deployment](./deployment/)
- [Environment Setup](./deployment/01-environments.md) - Dev, staging, and production environments
- [Cloudflare Configuration](./deployment/02-cloudflare-config.md) - Workers, KV, and Durable Objects setup
- [CI/CD Pipeline](./deployment/03-cicd.md) - Automated deployment pipeline
- [Monitoring](./deployment/04-monitoring.md) - Observability and monitoring setup
- [Scaling Guide](./deployment/05-scaling.md) - Performance optimization and scaling strategies

## 🚀 Quick Navigation

### For Developers
1. Start with [Quick Start](./guides/01-quick-start.md)
2. Review [System Overview](./architecture/01-system-overview.md)
3. Check [Common Tasks](./guides/03-common-tasks.md)
4. Reference [REST API](./api/01-rest-endpoints.md)

### For Architects
1. Read [System Overview](./architecture/01-system-overview.md)
2. Study [Component Architecture](./architecture/02-components.md)
3. Understand [Data Flow](./architecture/03-data-flow.md)
4. Review [Security Architecture](./architecture/05-security.md)

### For DevOps
1. Check [Environment Setup](./deployment/01-environments.md)
2. Configure [Cloudflare](./deployment/02-cloudflare-config.md)
3. Set up [CI/CD](./deployment/03-cicd.md)
4. Implement [Monitoring](./deployment/04-monitoring.md)

### For Mobile Developers
1. Read [Mobile Integration](./integration/02-mobile-integration.md)
2. Check platform-specific guides for [iOS/Android](./integration/02-mobile-integration.md)
3. Or use [React Native](./integration/03-react-native.md)

## 📖 How to Use This Documentation

Each section is self-contained but references related topics when needed. Use the navigation links at the bottom of each page to move between related topics.

### Documentation Conventions

- 📝 **Note**: Important information
- ⚠️ **Warning**: Critical information that could cause issues
- 💡 **Tip**: Helpful suggestions
- 🔗 **Related**: Links to related documentation
- 📊 **Example**: Code examples and implementations

## 🔍 Search Documentation

Use your IDE's search functionality to find specific topics across all documentation files:
- **VS Code**: `Ctrl+Shift+F` (Windows/Linux) or `Cmd+Shift+F` (Mac)
- **Search pattern**: Search in `docs/` folder

## 📞 Need Help?

- **GitHub Issues**: [Report bugs or request features](https://github.com/your-org/edge-platform/issues)
- **Discussions**: [Ask questions and share ideas](https://github.com/your-org/edge-platform/discussions)
- **Support**: Contact the platform team

---

Last Updated: January 2025 | Version: 1.0.0