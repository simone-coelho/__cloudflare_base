# 🚀 Cloudflare Edge Platform

A comprehensive Cloudflare Workers foundation that serves as a reusable scaffold for demos and production services with tracking, personalization, and experimentation capabilities.

## 👉 Start here: the demos

This repository hosts **five customer demos** on one edge personalization engine, plus the productised
**content decision service** that the newest demos run on. **Read [`docs/demos/BOOTSTRAP.md`](docs/demos/BOOTSTRAP.md)
before anything else** — what each demo is for, how it was built, how to run, verify and deploy it, and how to
build the next one.

| Demo | For | Live |
|---|---|---|
| Coach / Tapestry storefront | Tapestry (Coach) | [edge-platform…/storefront](https://edge-platform.expedge.workers.dev/storefront) |
| First National Bank | banking lead generation | [edge-platform…/visual-demo](https://edge-platform.expedge.workers.dev/visual-demo) |
| The Bright Hour | QVC — live shopping | [edge-platform…/live/](https://edge-platform.expedge.workers.dev/live/) |
| Meridian (on screen: Calder) | Opticon — retail and banking | [edge-platform…/meridian/](https://edge-platform.expedge.workers.dev/meridian/) |
| Top Offers (Lantern & Lane) | QVC — the four-container module | [edge-platform-top-offers…/top-offers/](https://edge-platform-top-offers.expedge.workers.dev/top-offers/) |

> ⛔ **There are two demo workers. Never run plain `npx wrangler deploy` from the repo root** — it ships today's
> code onto the shared worker and breaks Coach, Bright Hour and Meridian. The commands are in "Deployment" below
> and in `AGENTS.md`. Verify any deploy through the demos' APIs, never their pages.

The sections after "Quick Start" document the shared platform scaffold the demos grew from.

## ✨ Features

- **Real-time Event Tracking**: Track user interactions, page views, and custom events
- **Email Pixel Tracking**: Generate and track email pixels with secure encoding
- **Optimizely Integration**: Feature flags, experiments, and user segmentation
- **Customer Data Platform**: User profiles, segments, and event forwarding
- **JWT Authentication**: Role-based access control for secure API access
- **Cloudflare Services**: Queues, Durable Objects, R2 storage, and Analytics Engine
- **Rate Limiting**: Built-in rate limiting with Durable Objects
- **Error Handling**: Comprehensive error handling and monitoring

## 🏗️ Architecture

### Platform Overview

```mermaid
graph TB
    subgraph "Client Layer"
        WEB[Web Applications]
        MOBILE[Mobile Apps]
        EMAIL[Email Systems]
        API_CLIENT[API Clients]
    end
    
    subgraph "Cloudflare Edge"
        subgraph "API Routes"
            TRACK["/track/*<br/>Event Tracking"]
            PIXEL["/pixel/*<br/>Email Pixels"]
            OPT["/optimizely/*<br/>Feature Flags"]
            CDP["/cdp/*<br/>Customer Data"]
            AUTH["/auth/*<br/>Authentication"]
            WEBHOOK["/webhook/*<br/>Integrations"]
            API["/api/*<br/>Infrastructure"]
            HEALTH["/health<br/>Monitoring"]
        end
        
        subgraph "Middleware"
            CORS[CORS Handler]
            RATE[Rate Limiting]
            JWT_MW[JWT Auth]
            LOGGER[Request Logger]
            ERROR[Error Handler]
        end
        
        subgraph "Services"
            EVENT_DISP[EventDispatcher<br/>3rd Party Routing]
            PIXEL_DEC[PixelDecoder<br/>Secure Encoding]
            OPT_SVC[OptimizelyService<br/>Edge Agent SDK]
            CDP_SVC[CDPService<br/>Profile Management]
        end
        
        subgraph "Cloudflare Infrastructure"
            WORKERS[Workers Runtime]
            KV[KV Storage<br/>Cache & Sessions]
            R2[R2 Storage<br/>File Management]
            QUEUES[Queues<br/>Event Processing]
            DO[Durable Objects<br/>State & Rate Limiting]
            ANALYTICS[Analytics Engine<br/>Metrics Collection]
            PAGES[Pages<br/>Static Hosting]
        end
    end
    
    subgraph "External Integrations"
        OPTIMIZELY[Optimizely<br/>Feature Experimentation]
        SEGMENT[Segment API]
        AMPLITUDE[Amplitude API]
        MIXPANEL[Mixpanel API]
        WEBHOOKS[Custom Webhooks]
    end
    
    %% Client connections
    WEB --> TRACK
    WEB --> PIXEL
    WEB --> OPT
    MOBILE --> OPT
    MOBILE --> TRACK
    EMAIL --> PIXEL
    API_CLIENT --> AUTH
    API_CLIENT --> API
    
    %% Route to middleware
    TRACK --> CORS
    PIXEL --> CORS
    OPT --> JWT_MW
    CDP --> JWT_MW
    AUTH --> CORS
    WEBHOOK --> CORS
    API --> JWT_MW
    HEALTH --> CORS
    
    %% Middleware to services
    CORS --> EVENT_DISP
    CORS --> PIXEL_DEC
    JWT_MW --> OPT_SVC
    JWT_MW --> CDP_SVC
    
    %% Services to infrastructure
    EVENT_DISP --> QUEUES
    EVENT_DISP --> ANALYTICS
    PIXEL_DEC --> KV
    OPT_SVC --> KV
    CDP_SVC --> KV
    RATE --> DO
    
    %% Infrastructure connections
    WORKERS --> KV
    WORKERS --> R2
    WORKERS --> QUEUES
    WORKERS --> DO
    WORKERS --> ANALYTICS
    
    %% External integrations
    OPT_SVC --> OPTIMIZELY
    EVENT_DISP --> SEGMENT
    EVENT_DISP --> AMPLITUDE
    EVENT_DISP --> MIXPANEL
    EVENT_DISP --> WEBHOOKS
    
    %% Styling
    classDef clientLayer fill:#e1f5fe
    classDef apiLayer fill:#f3e5f5
    classDef serviceLayer fill:#e8f5e8
    classDef infraLayer fill:#fff3e0
    classDef externalLayer fill:#fce4ec
    
    class WEB,MOBILE,EMAIL,API_CLIENT clientLayer
    class TRACK,PIXEL,OPT,CDP,AUTH,WEBHOOK,API,HEALTH apiLayer
    class EVENT_DISP,PIXEL_DEC,OPT_SVC,CDP_SVC serviceLayer
    class WORKERS,KV,R2,QUEUES,DO,ANALYTICS,PAGES infraLayer
    class OPTIMIZELY,SEGMENT,AMPLITUDE,MIXPANEL,WEBHOOKS externalLayer
```

### Event Flow Diagram

```mermaid
sequenceDiagram
    participant User as User/System
    participant Edge as Cloudflare Edge
    participant Services as Internal Services
    participant Queue as Event Queue
    participant External as 3rd Party APIs
    participant Optimizely as Optimizely Platform
    
    %% Event Tracking Flow
    Note over User,Optimizely: Event Tracking & Personalization Flow
    
    User->>+Edge: 1. Send Event/Pixel/Form Data
    Edge->>+Services: 2. Validate & Enrich Event
    Services->>+Queue: 3. Queue for Processing
    Services->>+External: 4. Dispatch to Analytics
    Edge->>-User: 5. Return Success/Pixel
    
    %% Background Processing
    Queue->>+Services: 6. Process Queued Events
    Services->>+External: 7. Forward to CDP/Segment
    
    %% Personalization Request
    User->>+Edge: 8. Request Personalization
    Edge->>+Services: 9. Get User Segments
    Services->>+Optimizely: 10. Fetch Feature Flags
    Optimizely->>-Services: 11. Return Decisions
    Services->>-Edge: 12. Enriched User Context
    Edge->>-User: 13. Personalized Response
    
    %% Real-time Updates
    External->>+Edge: 14. Webhook/Segment Update
    Edge->>+Services: 15. Update User Profile
    Services->>Queue: 16. Trigger Personalization
```

### Data Flow Architecture

```mermaid
flowchart LR
    subgraph "Data Sources"
        EMAIL_OPEN[Email Opens]
        FORM_SUB[Form Submissions]
        PAGE_VIEW[Page Views]
        CUSTOM_EVENT[Custom Events]
    end
    
    subgraph "Edge Processing"
        DECODER[Pixel Decoder]
        VALIDATOR[Event Validator]
        ENRICHER[Context Enricher]
        DISPATCHER[Event Dispatcher]
    end
    
    subgraph "Storage Layer"
        KV_CACHE[(KV Cache<br/>Sessions)]
        R2_FILES[(R2 Storage<br/>Assets)]
        DO_STATE[(Durable Objects<br/>State)]
        ANALYTICS_DB[(Analytics Engine<br/>Metrics)]
    end
    
    subgraph "Processing"
        QUEUE_PROC[Queue Processor]
        SEGMENT_ENG[Segmentation Engine]
        DECISION_ENG[Decision Engine]
    end
    
    subgraph "Outputs"
        PERSONALIZATION[Personalized Content]
        SEGMENTS[User Segments]
        REAL_TIME[Real-time Notifications]
        INTEGRATIONS[3rd Party Sync]
    end
    
    %% Data flow
    EMAIL_OPEN --> DECODER
    FORM_SUB --> VALIDATOR
    PAGE_VIEW --> VALIDATOR
    CUSTOM_EVENT --> VALIDATOR
    
    DECODER --> ENRICHER
    VALIDATOR --> ENRICHER
    ENRICHER --> DISPATCHER
    
    DISPATCHER --> KV_CACHE
    DISPATCHER --> ANALYTICS_DB
    DISPATCHER --> QUEUE_PROC
    
    QUEUE_PROC --> SEGMENT_ENG
    SEGMENT_ENG --> DECISION_ENG
    KV_CACHE --> DECISION_ENG
    
    DECISION_ENG --> PERSONALIZATION
    SEGMENT_ENG --> SEGMENTS
    DISPATCHER --> REAL_TIME
    QUEUE_PROC --> INTEGRATIONS
    
    %% Styling
    classDef sourceNode fill:#e3f2fd
    classDef processNode fill:#f1f8e9
    classDef storageNode fill:#fff3e0
    classDef outputNode fill:#fce4ec
    
    class EMAIL_OPEN,FORM_SUB,PAGE_VIEW,CUSTOM_EVENT sourceNode
    class DECODER,VALIDATOR,ENRICHER,DISPATCHER,QUEUE_PROC,SEGMENT_ENG,DECISION_ENG processNode
    class KV_CACHE,R2_FILES,DO_STATE,ANALYTICS_DB storageNode
    class PERSONALIZATION,SEGMENTS,REAL_TIME,INTEGRATIONS outputNode
```

## 🚀 Quick Start

Everything in this section runs on your machine. No Cloudflare account is needed, and nothing here
contacts one: the local worker, its database and its storage run in Miniflare.

### Prerequisites

- Node.js 22 (the version CI uses)
- git

### Installation

```bash
# Clone the repository
git clone <your-repo>
cd cloudflare-edge-platform

# Install dependencies (npm install, never npm ci; see ONBOARDING.md §9)
npm install
```

`wrangler.toml` is tracked and used as it is: there is no example file to copy, and nothing in it
needs editing to run locally. Its top-level declarations are the local worker's; `[env.staging]`
and `[env.production]` are customer declarations that only the customer-stamp workflow uses.

### Local secrets and tenants

`wrangler dev` reads local-only values from `.dev.vars`, which is git-ignored and never committed.
Create it yourself, with a signing secret of your own (at least 32 characters) and the tenant you
will seed, granted to the seed commands' operators:

```text
JWT_SECRET=replace-with-your-own-random-local-secret-of-32-or-more-characters
TENANTS={"provisioned":["coach"],"operatorGrants":{"seed-coach-content":["coach"]}}
```

### Local database and publication

```bash
# Product migrations into the local D1 database, and the tenant's configuration publication
node scripts/init-local.mjs --scope coach
```

The default local database gets the product migrations only (`migrations/product`). Demo data is
applied only when you ask for it, and only locally: `node scripts/init-local.mjs --scope coach --demo-data`
applies the demo chain `migrations/*.sql` and then the demo seeds `migrations/seed/*.sql`, in order
([docs/10-d1-schema.md](docs/10-d1-schema.md)). Run it again at any time: what already ran is not
run twice, and the seeds change nothing that is already there.

### Development

Two ways to run locally, one at a time — both serve on http://localhost:9100:

```bash
npm run dev                                   # today's code: Top Offers (seed it: docs/qvc/RESUME-top-offers.md)
bash scripts/deploy-legacy-demos.sh --dev     # commit 26e2db1: Coach, the bank demo, Bright Hour, Meridian
```

### Seed content (local worker, one named tenant)

```bash
# The seed signs its local operator token with the worker's own settings
export DEPLOYMENT_PROFILE=demo JWT_ISSUER=edge-platform JWT_AUDIENCE=edge-platform-api
export JWT_SECRET='the JWT_SECRET value from your .dev.vars'

# The Coach catalog, its slots and its learning dials, into the tenant you name
node scripts/seed-coach-content.mjs --scope coach
```

#### Demo step: the Meridian catalogue import (not part of the product seed order)

`scripts/import-content.mjs` pulls the Meridian demo catalogue through the worker's own CMS seam.
That catalogue is a demo API, and the tracked `wrangler.toml` keeps `AUTH_MODE = "enforced"`, under
which every demo API answers 404 by design. So this step runs only on a local worker you start with
`AUTH_MODE=open` added to `.dev.vars` (and `"import-content":["<tenant>"]` added to the
`operatorGrants` there), restarted after the change; on the enforced default it refuses, names
`AUTH_MODE` and `.dev.vars`, and writes nothing. Never change `AUTH_MODE` in `wrangler.toml` for it.

```bash
node scripts/import-content.mjs --scope coach
```

Every seed command takes the tenant with `--scope` and refuses to run without one. A second run
publishes nothing new, and a run that failed part-way is finished by running the same command again
([docs/10-d1-schema.md](docs/10-d1-schema.md) gives the seed order and the recovery). A seed reaches a
deployed worker only with an operator token issued for that tenant (`--token`), never one minted
from local settings.

### Deployment

Nothing above deploys anything. There is no default deploy target: `npm run deploy` accepts only
`staging` or `production` and runs the guarded customer-stamp workflow, which is operated only under
its own authority ([docs/deployment/01-deploy.md](docs/deployment/01-deploy.md)). Tracked backup files
and their dispositions are listed there too.

`npm run dev` cannot run the older four demos; today's engine requires a shopper session on every shopper call,
which their pages never create. `wrangler dev` snapshots its asset list at startup, so a file newly added under
`public/` returns 404 until you restart it.

| Worker | Runs | Deploy with |
|---|---|---|
| `edge-platform.expedge.workers.dev` | Coach, bank, Bright Hour, Meridian (commit `26e2db1`) | `bash scripts/deploy-legacy-demos.sh --deploy` |
| `edge-platform-top-offers.expedge.workers.dev` | Top Offers (today's engine) | `node scripts/build-top-offers-config.mjs && npx wrangler deploy --config wrangler.top-offers.toml` |

Run `npm run check:generated` first: `npm run dev` rebuilds the Meridian and SDK bundles, a deploy does not.

`npm run deploy staging` or `npm run deploy production` is the guarded **customer-stamp** workflow for Tapestry's environments
([`docs/deployment/01-deploy.md`](docs/deployment/01-deploy.md)). It is never used for a demo.

## 🔧 Configuration

### Environment Variables

Locally, secrets live in `.dev.vars` (above). A deployed customer stamp receives its secrets
(`JWT_SECRET`, `SDK_KEYS`, `IDENTITY_SALT`, `IDENTITY_SECRETS`, `ALERT_WEBHOOK_URL`) only through the
customer-stamp workflow ([docs/deployment/01-deploy.md](docs/deployment/01-deploy.md)), never by
setting secrets by hand on the top-level worker.

### wrangler.toml

Local development needs no edits. KV, R2, D1, Queues and Durable Objects run locally under
`wrangler dev`, whatever IDs the file names. Customer environments are declared under
`[env.staging]` and `[env.production]` and are changed only through the customer-stamp workflow.

## 📚 API Documentation

### Authentication

Most endpoints require JWT authentication. Get a token from `/auth/login`:

```bash
curl -X POST https://your-worker.workers.dev/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email": "user@example.com", "password": "password"}'
```

### Event Tracking

Track custom events:

```bash
curl -X POST https://your-worker.workers.dev/track/event \\
  -H "Content-Type: application/json" \\
  -d '{
    "eventId": "uuid",
    "eventType": "track",
    "event": "button_click",
    "user": {"anonymousId": "user-123"},
    "properties": {"button": "signup"}
  }'
```

### Pixel Tracking

Generate email pixels:

```bash
curl -X POST https://your-worker.workers.dev/pixel/generate \\
  -H "Content-Type: application/json" \\
  -d '{
    "campaignId": "campaign-123",
    "emailId": "email-456",
    "recipientId": "user-789"
  }'
```

### Optimizely Integration

Get experiment decisions:

```bash
curl -X POST https://your-worker.workers.dev/optimizely/decisions \\
  -H "Content-Type: application/json" \\
  -d '{
    "userId": "user-123",
    "experiments": ["experiment-key"],
    "features": ["feature-key"]
  }'
```

### Customer Data Platform

Get user profile:

```bash
curl -X POST https://your-worker.workers.dev/cdp/profile \\
  -H "Content-Type: application/json" \\
  -d '{"userId": "user-123"}'
```

## 🛠️ Services

### EventDispatcher

Handles event forwarding to multiple destinations:

- Segment
- Amplitude
- Mixpanel
- Custom webhooks

### PixelDecoder

Secure encoding/decoding of email tracking pixels with:

- Base64 encoding
- Hash verification
- Timestamp validation
- Metadata support

### OptimizelyService

Feature experimentation integration:

- Feature flags
- A/B test variations
- User segmentation
- Event tracking

### CDPService

Customer data platform abstraction:

- User profiles
- Segment management
- Event forwarding
- Destination management

## 🔐 Security

- JWT authentication with configurable expiration
- Rate limiting with Durable Objects
- CORS protection
- Secure headers middleware
- Input validation with Zod schemas

## 📊 Monitoring

- Health check endpoints
- Analytics Engine integration
- Error tracking and logging
- Performance monitoring

## 🚦 Health Checks

- `GET /health` - Comprehensive health check
- `GET /health/ready` - Readiness probe
- `GET /health/live` - Liveness probe

## 🔄 Queue Processing

Events are processed asynchronously using Cloudflare Queues:

- Automatic retries
- Batch processing
- Dead letter queues
- Monitoring and alerting

## 💾 State Management

Durable Objects provide persistent state:

- Session management
- Rate limiting
- Cache invalidation
- Real-time collaboration

## 📈 Analytics

Built-in analytics with Cloudflare Analytics Engine:

- Event tracking
- Performance metrics
- Error monitoring
- Custom dashboards

## 🔧 Customization

This platform is designed to be extended:

1. **Add new routes**: Create files in `src/routes/`
2. **Add new services**: Create files in `src/services/`
3. **Add new middleware**: Create files in `src/middleware/`
4. **Add new destinations**: Configure in EventDispatcher

## 📋 Examples

### Email Campaign Tracking

```javascript
// Generate tracking pixel
const pixel = await fetch('/pixel/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    campaignId: 'summer-sale-2024',
    emailId: 'email-123',
    recipientId: 'user-456'
  })
});

// Add to email template
const { pixelHTML } = await pixel.json();
// Insert pixelHTML into email
```

### Feature Flag Personalization

```javascript
// Get user segments and feature flags
const decisions = await fetch('/optimizely/decisions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user-123',
    features: ['new-checkout', 'premium-features'],
    userAttributes: { plan: 'pro', country: 'US' }
  })
});

const { features } = await decisions.json();
// Use features to personalize experience
```

### Custom Event Tracking

```javascript
// Track conversion event
await fetch('/track/event', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    eventId: crypto.randomUUID(),
    eventType: 'track',
    event: 'purchase_completed',
    user: { userId: 'user-123' },
    properties: {
      revenue: 99.99,
      currency: 'USD',
      products: ['product-1', 'product-2']
    }
  })
});
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

---

Built with ❤️ for the Cloudflare Workers ecosystem