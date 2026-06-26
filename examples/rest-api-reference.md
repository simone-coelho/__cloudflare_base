# Comprehensive Matrix of Optimizely REST API Endpoints

## Overview

This document provides a complete and accurate matrix of all REST API endpoints available for Optimizely Web Experimentation and Feature Experimentation. This serves as a source of truth for AI agents to interact effectively with these APIs.

## Critical Distinctions

### Web Experimentation vs Feature Experimentation
- **Web Experimentation**: Variations are managed as part of experiments - there are NO standalone variation endpoints
- **Feature Experimentation**: Has dedicated endpoints for flags, variations, rules, and rulesets
- Both products share the v2 API but not all endpoints are available for both

## Authentication and Rate Limits Summary

### Authentication Methods
- **Bearer Token**: Personal Access Token or OAuth 2.0 token
- **Header Format**: `Authorization: Bearer {token}`
- **SDK Key**: `X-Optimizely-SDK-Key: {SDK_KEY}` (Agent API only)

### Rate Limits by API
| API | Rate Limit | Special Endpoints |
|-----|------------|-------------------|
| Feature Experimentation API | 2 requests/second, 120 requests/minute | - |
| Optimizely API (v2) | 100 requests/minute | Get Campaign/Experiment results: 20 requests/minute |
| Web Experimentation | 100 requests/minute (global) | e3-auth-service: 100 requests/hour |
| Agent API | No inherent limits | Depends on infrastructure |

## 1. Feature Experimentation API Endpoints

**Base URL**: `https://api.optimizely.com/flags/v1`

### Flags Management

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|----------------|-------|
| GET | `/projects/{project_id}/flags` | project_id (integer) | page, per_page, archived, enabled | Array of flag objects | Bearer token | Lists all flags |
| GET | `/projects/{project_id}/flags/{flag_key}` | project_id, flag_key | - | Single flag object | Bearer token | Get specific flag |
| POST | `/projects/{project_id}/flags` | project_id, Body: flag definition | - | Created flag object | Bearer token | Create new flag |
| PATCH | `/projects/{project_id}/flags` | project_id, Body: JSON patch | - | Updated flag objects | Bearer token | Update multiple flags |
| DELETE | `/projects/{project_id}/flags/{flag_key}` | project_id, flag_key | - | Success response | Bearer token | Delete flag |
| POST | `/projects/{project_id}/flags/archived` | project_id, Body: flag keys array | - | Success response | Bearer token | Archive flags |

### Variations Management (Feature Experimentation Only)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|----------------|-------|
| GET | `/projects/{project_id}/flags/{flag_key}/variations` | project_id, flag_key | page, per_page | Array of variations | Bearer token | List variations |
| GET | `/projects/{project_id}/flags/{flag_key}/variations/{variation_key}` | project_id, flag_key, variation_key | - | Single variation | Bearer token | Get specific variation |
| POST | `/projects/{project_id}/flags/{flag_key}/variations` | project_id, flag_key, Body: variation | - | Created variation | Bearer token | Create variation |
| PATCH | `/projects/{project_id}/flags/{flag_key}/variations` | project_id, flag_key, Body: JSON patch | - | Updated variations | Bearer token | Update variations |
| DELETE | `/projects/{project_id}/flags/{flag_key}/variations/{variation_key}` | project_id, flag_key, variation_key | - | Success response | Bearer token | Delete variation |
| POST | `/projects/{project_id}/flags/{flag_key}/variations/archived` | project_id, flag_key, Body: variation keys | - | Success response | Bearer token | Archive variations |

### Rules and Rulesets

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|----------------|-------|
| GET | `/projects/{project_id}/flags/{flag_key}/environments/{environment_key}/ruleset` | project_id, flag_key, environment_key | - | Ruleset object | Bearer token | Get ruleset |
| PATCH | `/projects/{project_id}/flags/{flag_key}/environments/{environment_key}/ruleset` | project_id, flag_key, environment_key, Body: updates | - | Updated ruleset | Bearer token | Update ruleset |
| POST | `/projects/{project_id}/flags/{flag_key}/environments/{environment_key}/ruleset/enabled` | project_id, flag_key, environment_key | - | Success response | Bearer token | Enable ruleset |
| POST | `/projects/{project_id}/flags/{flag_key}/environments/{environment_key}/ruleset/disabled` | project_id, flag_key, environment_key | - | Success response | Bearer token | Disable ruleset |
| GET | `/projects/{project_id}/flags/{flag_key}/environments/{environment_key}/rules/{rule_key}` | project_id, flag_key, environment_key, rule_key | - | Rule object | Bearer token | Get specific rule |
| POST | `/projects/{project_id}/flags/{flag_key}/environments/{environment_key}/rules` | project_id, flag_key, environment_key, Body: rule | - | Created rule | Bearer token | Create rule |
| PATCH | `/projects/{project_id}/flags/{flag_key}/environments/{environment_key}/rules/{rule_key}` | project_id, flag_key, environment_key, rule_key, Body: updates | - | Updated rule | Bearer token | Update rule |
| DELETE | `/projects/{project_id}/flags/{flag_key}/environments/{environment_key}/rules/{rule_key}` | project_id, flag_key, environment_key, rule_key | - | Success response | Bearer token | Delete rule |

### Change History

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|----------------|-------|
| GET | `/projects/{project_id}/flags/{flag_key}/history` | project_id, flag_key | page, per_page, type, environment, from, to | Array of changes | Bearer token | Flag history |
| GET | `/projects/{project_id}/history` | project_id | page, per_page, type, from, to | Array of changes | Bearer token | Project history |

## 2. Optimizely API v2 (Shared Endpoints)

**Base URL**: `https://api.optimizely.com/v2`

### Projects (Available for Both Web and Feature Experimentation)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Pagination | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|------------|----------------|-------|
| GET | `/projects` | - | page, per_page | Array of projects | Yes (25/page default) | Bearer token | List all projects |
| GET | `/projects/{project_id}` | project_id | - | Project object | - | Bearer token | Get specific project |
| POST | `/projects` | Body: name, account_id | platform, description, status | Created project | - | Bearer token | Create project |
| PATCH | `/projects/{project_id}` | project_id, Body: updates | - | Updated project | - | Bearer token | Update project |

### Experiments (Available for Both)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Pagination | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|------------|----------------|-------|
| GET | `/experiments` | - | page, per_page, project_id, campaign_id | Array of experiments | Yes | Bearer token | List experiments |
| GET | `/experiments/{experiment_id}` | experiment_id | - | Experiment object with variations | - | Bearer token | **Includes variations** |
| POST | `/experiments` | Body: project_id, name, key | type, status, metrics, variations | Created experiment | - | Bearer token | **Variations included in body** |
| PATCH | `/experiments/{experiment_id}` | experiment_id, Body: updates | - | Updated experiment | - | Bearer token | **Can update variations** |
| DELETE | `/experiments/{experiment_id}` | experiment_id | - | Success response | - | Bearer token | Deletes experiment |
| GET | `/experiments/{experiment_id}/results` | experiment_id | - | Results data | - | Bearer token | 20 req/min limit |

### Campaigns (Available for Both)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Pagination | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|------------|----------------|-------|
| GET | `/campaigns` | - | page, per_page, project_id | Array of campaigns | Yes | Bearer token | List campaigns |
| GET | `/campaigns/{campaign_id}` | campaign_id | - | Campaign object | - | Bearer token | Get specific campaign |
| POST | `/campaigns` | Body: project_id, name | type, status | Created campaign | - | Bearer token | Create campaign |
| PATCH | `/campaigns/{campaign_id}` | campaign_id, Body: updates | - | Updated campaign | - | Bearer token | Update campaign |
| DELETE | `/campaigns/{campaign_id}` | campaign_id | - | Success response | - | Bearer token | Delete campaign |
| GET | `/campaigns/{campaign_id}/results` | campaign_id | - | Results data | - | Bearer token | 20 req/min limit |

### Pages (Web Experimentation Only)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Pagination | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|------------|----------------|-------|
| GET | `/pages` | - | page, per_page, project_id | Array of pages | Yes | Bearer token | List pages |
| GET | `/pages/{page_id}` | page_id | - | Page object | - | Bearer token | Get specific page |
| POST | `/pages` | Body: project_id, name, edit_url | category, activation_type | Created page | - | Bearer token | Create page |
| PATCH | `/pages/{page_id}` | page_id, Body: updates | - | Updated page | - | Bearer token | Update page |
| DELETE | `/pages/{page_id}` | page_id | - | Success response | - | Bearer token | Delete page |

### Events (Available for Both)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Pagination | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|------------|----------------|-------|
| GET | `/events` | - | page, per_page, project_id, include_classic | Array of events | Yes | Bearer token | List events |
| GET | `/events/{event_id}` | event_id | - | Event object | - | Bearer token | Get specific event |
| POST | `/events` | Body: project_id, name, key | category, event_type | Created event | - | Bearer token | Create event |
| PATCH | `/events/{event_id}` | event_id, Body: updates | - | Updated event | - | Bearer token | Update event |
| DELETE | `/events/{event_id}` | event_id | - | Success response | - | Bearer token | Delete event |

### Audiences (Available for Both)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Pagination | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|------------|----------------|-------|
| GET | `/audiences` | - | page, per_page, project_id | Array of audiences | Yes | Bearer token | List audiences |
| GET | `/audiences/{audience_id}` | audience_id | - | Audience object | - | Bearer token | Get specific audience |
| POST | `/audiences` | Body: project_id, name, conditions | description, segmentation | Created audience | - | Bearer token | Create audience |
| PATCH | `/audiences/{audience_id}` | audience_id, Body: updates | - | Updated audience | - | Bearer token | Update audience |
| DELETE | `/audiences/{audience_id}` | audience_id | - | Success response | - | Bearer token | Archive audience |

### Attributes (Available for Both)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Pagination | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|------------|----------------|-------|
| GET | `/attributes` | - | page, per_page, project_id | Array of attributes | Yes | Bearer token | List attributes |
| GET | `/attributes/{attribute_id}` | attribute_id | - | Attribute object | - | Bearer token | Get specific attribute |
| POST | `/attributes` | Body: project_id, key, name | description | Created attribute | - | Bearer token | Create attribute |
| PATCH | `/attributes/{attribute_id}` | attribute_id, Body: updates | - | Updated attribute | - | Bearer token | Update attribute |
| DELETE | `/attributes/{attribute_id}` | attribute_id | - | Success response | - | Bearer token | Archive attribute |

### List Attributes (Web Experimentation Only)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Pagination | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|------------|----------------|-------|
| GET | `/list_attributes` | - | page, per_page, project_id | Array of list attributes | Yes | Bearer token | List all |
| GET | `/list_attributes/{list_attribute_id}` | list_attribute_id | - | List attribute object | - | Bearer token | Get specific |
| POST | `/list_attributes` | Body: project_id, name, list_type, key_field | description, list_content | Created list attribute | - | Bearer token | Create new |
| PATCH | `/list_attributes/{list_attribute_id}` | list_attribute_id, Body: complete replacement | - | Updated list attribute | - | Bearer token | Full replacement |
| DELETE | `/list_attributes/{list_attribute_id}` | list_attribute_id | - | Success response | - | Bearer token | Delete list |

### Extensions (Web Experimentation Only)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Pagination | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|------------|----------------|-------|
| GET | `/extensions` | - | page, per_page, project_id | Array of extensions | Yes | Bearer token | List extensions |
| GET | `/extensions/{extension_id}` | extension_id | - | Extension object | - | Bearer token | Get specific |
| POST | `/extensions` | Body: project_id, name, implementation | description | Created extension | - | Bearer token | Create extension |
| PATCH | `/extensions/{extension_id}` | extension_id, Body: updates | - | Updated extension | - | Bearer token | Update extension |
| DELETE | `/extensions/{extension_id}` | extension_id | - | Success response | - | Bearer token | Delete extension |

### Environments (Feature Experimentation Only)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Pagination | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|------------|----------------|-------|
| GET | `/environments` | - | page, per_page, project_id | Array of environments | Yes | Bearer token | List environments |
| GET | `/environments/{environment_id}` | environment_id | - | Environment object | - | Bearer token | Get specific |
| POST | `/environments` | Body: project_id, key, name | is_primary | Created environment | - | Bearer token | Create environment |
| PATCH | `/environments/{environment_id}` | environment_id, Body: updates | - | Updated environment | - | Bearer token | **NOT for Web Exp** |
| DELETE | `/environments/{environment_id}` | environment_id | - | Success response | - | Bearer token | Archive environment |

### Features (Feature Experimentation Only - NOT Available for Web Experimentation)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Pagination | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|------------|----------------|-------|
| GET | `/features` | - | page, per_page, project_id | Array of features | Yes | Bearer token | **NOT for Web Exp** |
| GET | `/features/{feature_id}` | feature_id | - | Feature object | - | Bearer token | **NOT for Web Exp** |
| POST | `/features` | Body: project_id, key, name | description, variables | Created feature | - | Bearer token | **NOT for Web Exp** |
| PATCH | `/features/{feature_id}` | feature_id, Body: updates | - | Updated feature | - | Bearer token | **NOT for Web Exp** |
| DELETE | `/features/{feature_id}` | feature_id | - | Success response | - | Bearer token | **NOT for Web Exp** |

### Export and Credentials

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|----------------|-------|
| GET | `/export/credentials` | - | duration (default: 3600) | S3 credentials object | Bearer token | Get export credentials |

### Other Endpoints NOT Available for Web Experimentation

| Endpoint | Description |
|----------|-------------|
| GET `/me` | Get current user info - NOT available for Web Experimentation |
| GET `/collaborators` | List collaborators - NOT available for Web Experimentation |

## 3. Optimizely Agent API Endpoints

**Base URL**: `http://localhost:8080` (configurable)

### Decision Endpoints

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|----------------|-------|
| POST | `/v1/decide` | Body: userId | keys (array), userAttributes, decideOptions | Array of OptimizelyDecision | X-Optimizely-SDK-Key | Primary decision endpoint |
| POST | `/v1/activate` | Body: userId, featureKey OR experimentKey | type (feature/experiment), userAttributes | Variation assignment | X-Optimizely-SDK-Key | Legacy activation |
| GET | `/v1/config` | - | keys (array) | Optimizely configuration | X-Optimizely-SDK-Key | Get SDK configuration |

### Event Tracking

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|----------------|-------|
| POST | `/v1/track` | Body: userId, eventKey | userAttributes, eventTags, revenue, value | No response body (204) | X-Optimizely-SDK-Key | Track conversions |

### Datafile Access

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|----------------|-------|
| GET | `/v1/datafile` | - | - | JSON datafile | X-Optimizely-SDK-Key | Get raw datafile |

### Notification Stream

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|----------------|-------|
| GET | `/v1/notifications/event-stream` | - | - | Server-sent events stream | X-Optimizely-SDK-Key | Real-time notifications |

### Admin Endpoints (Default Port 8088)

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Authentication | Notes |
|--------|----------|-------------------|-------------------|---------------|----------------|-------|
| GET | `/info` | - | - | Agent version and info | None by default | Instance information |
| GET | `/health` | - | - | Health status (200/503) | None by default | Health check |
| GET | `/metrics` | - | format (json/prometheus) | Runtime metrics | None by default | Telemetry data |
| POST | `/webhooks/datafile` | Body: webhook payload | - | Success response | Configurable | Datafile update webhook |
| GET | `/debug/pprof/*` | - | Various profiling options | Profiling data | None by default | Debug profiling |

## 4. OAuth 2.0 / Authentication Endpoints

### Optimizely OAuth

| Method | Endpoint | Required Parameters | Optional Parameters | Return Values | Notes |
|--------|----------|-------------------|-------------------|---------------|-------|
| GET | `https://app.optimizely.com/oauth2/authorize` | client_id, redirect_uri, response_type=code | state, scope | Authorization code | OAuth authorization |
| POST | `https://app.optimizely.com/oauth2/token` | grant_type, code/refresh_token, client_id, client_secret | - | Access & refresh tokens | Token exchange |

## Pagination Standards

For all paginated endpoints:
- **Default**: 25 items per page
- **Maximum**: 100 items per page (some endpoints may have lower limits)
- **Parameters**: `?page={number}&per_page={count}`
- **Response Headers**: 
  - `Link`: Contains URLs for first, last, next, prev pages
  - `X-Total-Count`: Total number of items

## Error Response Format

All APIs return standardized error responses:
```json
{
  "error": "Descriptive error message",
  "uuid": "unique-error-id",
  "code": "ERROR_CODE",
  "details": {} // Optional additional error details
}
```

## Common HTTP Status Codes

| Code | Meaning | Action Required |
|------|---------|-----------------|
| 200 | Success | None |
| 201 | Created | Resource created successfully |
| 204 | No Content | Success with no response body |
| 400 | Bad Request | Check request format and parameters |
| 401 | Unauthorized | Check authentication token |
| 403 | Forbidden | Check permissions for resource |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Resource already exists or state conflict |
| 429 | Too Many Requests | Rate limit exceeded, check headers |
| 500 | Internal Server Error | Contact support with UUID |

## Implementation Guidelines for AI Agents

1. **API Selection**
   - Use Feature Experimentation API for flag management
   - Use v2 API for experiments, campaigns, and shared resources
   - Understand which endpoints are available for your product

2. **Variations Handling**
   - For Web Experimentation: Variations are part of experiment objects, not separate endpoints
   - For Feature Experimentation: Use dedicated variation endpoints under flags

3. **Authentication Setup**
   - Store tokens securely
   - Include proper headers in all requests
   - Handle token refresh for OAuth flows

4. **Rate Limit Management**
   - Implement exponential backoff for 429 responses
   - Monitor rate limit headers: X-RateLimit-Limit, X-RateLimit-Remaining
   - Distribute requests over time

5. **Error Handling**
   - Always check for error responses before processing
   - Log UUID for support tickets
   - Implement appropriate retry logic

6. **Best Practices**
   - Use pagination for list endpoints
   - Include only required fields in requests
   - Test in development environments first
   - Monitor webhook endpoints for real-time updates

This document serves as the authoritative source for Optimizely REST API endpoints. Always verify endpoint availability for your specific product (Web Experimentation vs Feature Experimentation) before implementation.