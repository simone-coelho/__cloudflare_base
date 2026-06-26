# 🔗 Optimizely REST API Integration Guide

## Overview

This guide bridges the gap between the comprehensive API documentation and practical implementation. It provides real-world examples, debugging strategies, and integration patterns for working with Optimizely's REST APIs.

> **📋 AUDIT VERIFIED (2024)**: This guide has been audited against the actual Optimizely MCP Server codebase and official Optimizely API documentation to ensure accuracy. All rate limits, method names, and response patterns have been verified.

## 📚 Required Reading

**Before using this guide, familiarize yourself with:**
- **[REST API Reference](OPTIMIZELY-REST-API-REFERENCE.MD)** - Complete endpoint matrix
- **[REST API Response Payloads](OPTIMIZELY-REST-API-REFERENCE-RESPONSES.MD)** - Full response examples

---

## 🎯 Platform Detection & Routing

### **Step 1: Always Check Project Type First**

```javascript
// GET /v2/projects/{project_id}
const project = await fetch(`https://api.optimizely.com/v2/projects/${projectId}`, {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());

// Critical field for API routing
const isFeatureExperimentation = project.is_flags_enabled;

console.log(`Project Platform: ${isFeatureExperimentation ? 'Feature Experimentation' : 'Web Experimentation'}`);
```

**Response Analysis:**
```json
{
  "id": 20224828075,
  "name": "Akamai Edge Workers",
  "is_flags_enabled": true,  // 🎯 THIS DETERMINES AVAILABLE APIS
  "environments": [
    {"id": 1, "key": "development"},
    {"id": 2, "key": "production"}
  ]
}
```

### **Step 2: Route API Calls Based on Platform**

```javascript
// Feature Experimentation Project (is_flags_enabled: true)
if (isFeatureExperimentation) {
  // ✅ Available APIs
  const flags = await fetch(`https://api.optimizely.com/flags/v1/projects/${projectId}/flags`);
  const experiments = await fetch(`https://api.optimizely.com/v2/experiments?project_id=${projectId}`);
  
  // ❌ NOT Available
  // const campaigns = await fetch(`/v2/campaigns?project_id=${projectId}`); // Returns empty
  // const pages = await fetch(`/v2/pages?project_id=${projectId}`); // Returns empty
}

// Web Experimentation Project (is_flags_enabled: false)
else {
  // ✅ Available APIs
  const campaigns = await fetch(`https://api.optimizely.com/v2/campaigns?project_id=${projectId}`);
  const pages = await fetch(`https://api.optimizely.com/v2/pages?project_id=${projectId}`);
  const experiments = await fetch(`https://api.optimizely.com/v2/experiments?project_id=${projectId}`);
  
  // ❌ NOT Available
  // const flags = await fetch(`/flags/v1/projects/${projectId}/flags`); // 404 Error
}
```

---

## ⚠️ CRITICAL: Rate Limits & API Quotas

### **Rate Limits by API (VERIFIED 2024)**

| API | Rate Limit | Special Notes |
|-----|------------|---------------|
| **Feature Experimentation API** | **2 requests/second**<br/>**120 requests/minute** | Most restrictive - plan accordingly |
| **Web Experimentation API** | **100 requests/minute** | Standard rate limit |
| **Experiment Results Endpoints** | **20 requests/minute** | Extra restrictive for results data |
| **Agent API** | No inherent limits | Depends on your infrastructure |

### **🚨 CRITICAL WARNINGS**

```javascript
// ❌ WRONG - This will cause rate limit violations
for (const flag of flags) {
  for (const env of environments) {
    // This could be 10+ req/sec easily - exceeds 2 req/sec limit!
    await fetch(`/flags/v1/projects/${projectId}/flags/${flag.key}/environments/${env.key}/ruleset`);
  }
}

// ✅ CORRECT - Implement rate limiting
async function rateLimitedRequests(requests, maxPerSecond = 2) {
  const results = [];
  const delay = 1000 / maxPerSecond; // ms between requests
  
  for (const request of requests) {
    results.push(await request());
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  return results;
}
```

### **Rate Limit Error Handling**

```javascript
class OptimizelyAPIError extends Error {
  constructor(message, status, response) {
    super(message);
    this.name = 'OptimizelyAPIError';
    this.status = status;
    this.response = response;
  }
}

async function makeRateLimitedRequest(url, options = {}) {
  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    const response = await fetch(url, options);
    
    if (response.status === 429) {
      // Rate limited - Feature Experimentation API is very strict
      const retryAfter = response.headers.get('Retry-After') || 30;
      console.warn(`Rate limit hit (${response.status}). Waiting ${retryAfter}s...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      retryCount++;
      continue;
    }
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new OptimizelyAPIError(
        `API Error: ${errorData.error || response.statusText}`,
        response.status,
        errorData
      );
    }
    
    return await response.json();
  }
  
  throw new OptimizelyAPIError('Max retries exceeded due to rate limiting', 429);
}
```

---

## 🛠️ Common Integration Patterns

### **Pattern 1: Comprehensive Data Fetch**

```javascript
async function fetchOptimizelyData(projectId, token) {
  const headers = { 'Authorization': `Bearer ${token}` };
  
  // Step 1: Get project info
  const project = await fetch(`https://api.optimizely.com/v2/projects/${projectId}`, { headers })
    .then(r => r.json());
  
  const results = {
    project,
    platform: project.is_flags_enabled ? 'Feature Experimentation' : 'Web Experimentation'
  };
  
  // Step 2: Platform-specific data
  if (project.is_flags_enabled) {
    // Feature Experimentation
    results.flags = await fetch(`https://api.optimizely.com/flags/v1/projects/${projectId}/flags`, { headers })
      .then(r => r.json());
    
    results.experiments = await fetch(`https://api.optimizely.com/v2/experiments?project_id=${projectId}`, { headers })
      .then(r => r.json());
  } else {
    // Web Experimentation
    results.campaigns = await fetch(`https://api.optimizely.com/v2/campaigns?project_id=${projectId}`, { headers })
      .then(r => r.json());
    
    results.pages = await fetch(`https://api.optimizely.com/v2/pages?project_id=${projectId}`, { headers })
      .then(r => r.json());
    
    results.experiments = await fetch(`https://api.optimizely.com/v2/experiments?project_id=${projectId}`, { headers })
      .then(r => r.json());
  }
  
  // Step 3: Always available entities
  results.audiences = await fetch(`https://api.optimizely.com/v2/audiences?project_id=${projectId}`, { headers })
    .then(r => r.json());
  
  results.events = await fetch(`https://api.optimizely.com/v2/events?project_id=${projectId}`, { headers })
    .then(r => r.json());
  
  results.attributes = await fetch(`https://api.optimizely.com/v2/attributes?project_id=${projectId}`, { headers })
    .then(r => r.json());
  
  return results;
}
```

### **Pattern 2: Ruleset Enumeration (Feature Experimentation)**

```javascript
async function getAllRulesets(projectId, token) {
  const headers = { 'Authorization': `Bearer ${token}` };
  
  // Get all flags
  const flagsResponse = await fetch(`https://api.optimizely.com/flags/v1/projects/${projectId}/flags`, { headers });
  const flags = await flagsResponse.json();
  
  // Get project environments
  const projectResponse = await fetch(`https://api.optimizely.com/v2/projects/${projectId}`, { headers });
  const project = await projectResponse.json();
  
  const rulesets = [];
  
  // For each flag × environment combination
  for (const flag of flags.items || flags) {
    for (const env of project.environments) {
      try {
        const rulesetResponse = await fetch(
          `https://api.optimizely.com/flags/v1/projects/${projectId}/flags/${flag.key}/environments/${env.key}/ruleset`,
          { headers }
        );
        
        if (rulesetResponse.ok) {
          const ruleset = await rulesetResponse.json();
          rulesets.push({
            flagKey: flag.key,
            environmentKey: env.key,
            enabled: ruleset.enabled,
            rules: ruleset.rules || [],
            ruleCount: (ruleset.rules || []).length
          });
        }
      } catch (error) {
        console.log(`Ruleset ${flag.key}/${env.key} not found or disabled`);
      }
    }
  }
  
  return rulesets;
}
```

### **Pattern 3: Pagination Handling**

```javascript
async function fetchAllPages(baseUrl, headers, params = {}) {
  const allItems = [];
  let currentPage = 1;
  let hasMore = true;
  
  while (hasMore) {
    const url = new URL(baseUrl);
    url.searchParams.append('page', currentPage);
    url.searchParams.append('per_page', '100'); // Maximum allowed
    
    // Add additional params
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
    
    const response = await fetch(url, { headers });
    const data = await response.json();
    
    // Handle different response formats
    if (Array.isArray(data)) {
      allItems.push(...data);
      hasMore = data.length === 100; // If we got max, there might be more
    } else if (data.items) {
      allItems.push(...data.items);
      hasMore = data.next != null;
    } else {
      // Handle other formats
      allItems.push(...(data.experiments || data.campaigns || data.pages || []));
      hasMore = false;
    }
    
    currentPage++;
  }
  
  return allItems;
}

// Usage examples
const allCampaigns = await fetchAllPages(
  'https://api.optimizely.com/v2/campaigns',
  headers,
  { project_id: projectId }
);

const allFlags = await fetchAllPages(
  `https://api.optimizely.com/flags/v1/projects/${projectId}/flags`,
  headers
);
```

---

## 🚨 Error Handling & Debugging

### **Common Error Patterns**

#### **1. Platform Mismatch Errors**

```javascript
// ❌ Common mistake: Calling Feature Experimentation API on Web Experimentation project
const response = await fetch(`https://api.optimizely.com/flags/v1/projects/${webProjectId}/flags`);

// Response: 404 Not Found
{
  "error": "Project not found or not enabled for Feature Experimentation",
  "uuid": "req-123456789",
  "code": "404_NOT_FOUND"
}
```

**Debug Strategy:**
```javascript
// Always check project type first
const project = await fetch(`https://api.optimizely.com/v2/projects/${projectId}`);
if (!project.is_flags_enabled) {
  console.log('This is a Web Experimentation project - use /v2/ APIs');
}
```

#### **2. Empty Response Debugging**

```javascript
// ❌ Getting empty arrays when expecting data
const audiences = await fetch(`https://api.optimizely.com/v2/audiences?project_id=${projectId}`);
// Response: { "audiences": [] }

// ✅ Debug steps:
// 1. Check if project_id is correct
// 2. Verify authentication token has correct permissions
// 3. Check if entities exist in the Optimizely UI
// 4. Try without project_id filter (for global entities like pages)
```

#### **3. Rate Limit Handling**

```javascript
async function makeOptimizelyRequest(url, options = {}) {
  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    const response = await fetch(url, options);
    
    if (response.status === 429) {
      // Rate limited
      const retryAfter = response.headers.get('Retry-After') || 60;
      console.log(`Rate limited. Waiting ${retryAfter} seconds...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      retryCount++;
      continue;
    }
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new OptimizelyAPIError(
        `API Error: ${errorData.error || response.statusText}`,
        response.status,
        errorData
      );
    }
    
    return await response.json();
  }
  
  throw new Error('Max retries exceeded');
}
```

---

## 🔍 Response Analysis & Debugging

### **Key Response Fields to Check**

#### **Flag Responses**
```javascript
const flag = await fetch(`/flags/v1/projects/${projectId}/flags/${flagKey}`);
// Key debugging fields:
console.log('Flag Key:', flag.key);
console.log('Enabled:', flag.enabled);
console.log('Environments:', Object.keys(flag.environments || {}));
console.log('Variables:', flag.variable_definitions?.map(v => v.key));
console.log('Variations:', flag.variations?.map(v => v.key));
```

#### **Experiment Responses**
```javascript
const experiment = await fetch(`/v2/experiments/${experimentId}`);
// Key debugging fields:
console.log('Status:', experiment.status);
console.log('Type:', experiment.type);
console.log('Variations:', experiment.variations?.length);
console.log('Metrics:', experiment.metrics?.length);
console.log('Audience Conditions:', experiment.audience_conditions);
```

#### **Campaign Responses**
```javascript
const campaign = await fetch(`/v2/campaigns/${campaignId}`);
// Key debugging fields:
console.log('Status:', campaign.status);
console.log('Project ID:', campaign.project_id);
console.log('Experiment IDs:', campaign.experiment_ids);
console.log('Created:', campaign.created);
```

### **Response Validation Patterns**

```javascript
function validateFlagResponse(flag) {
  const issues = [];
  
  if (!flag.key) issues.push('Missing flag key');
  if (!flag.variations || flag.variations.length === 0) issues.push('No variations defined');
  if (!flag.environments) issues.push('No environments configured');
  
  // Check for common configuration issues
  if (flag.enabled && !flag.environments.production?.enabled) {
    issues.push('Flag enabled globally but not in production');
  }
  
  return issues;
}

function validateExperimentResponse(experiment) {
  const issues = [];
  
  if (!experiment.variations || experiment.variations.length < 2) {
    issues.push('Experiment needs at least 2 variations');
  }
  
  if (!experiment.metrics || experiment.metrics.length === 0) {
    issues.push('No metrics defined');
  }
  
  if (experiment.status === 'running' && !experiment.start_time) {
    issues.push('Running experiment without start time');
  }
  
  return issues;
}
```

---

## 🧪 Testing & Validation

### **API Testing Checklist**

```javascript
// Complete API validation for a project
async function validateProjectAPIs(projectId, token) {
  const headers = { 'Authorization': `Bearer ${token}` };
  const results = {
    project: null,
    platform: null,
    availableEndpoints: [],
    errors: []
  };
  
  try {
    // 1. Test project endpoint
    const projectResponse = await fetch(`https://api.optimizely.com/v2/projects/${projectId}`, { headers });
    results.project = await projectResponse.json();
    results.platform = results.project.is_flags_enabled ? 'Feature Experimentation' : 'Web Experimentation';
    
    // 2. Test platform-specific endpoints
    if (results.project.is_flags_enabled) {
      // Feature Experimentation endpoints
      const endpoints = [
        { name: 'flags', url: `/flags/v1/projects/${projectId}/flags` },
        { name: 'experiments', url: `/v2/experiments?project_id=${projectId}` }
      ];
      
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(`https://api.optimizely.com${endpoint.url}`, { headers });
          if (response.ok) {
            const data = await response.json();
            results.availableEndpoints.push({
              name: endpoint.name,
              status: 'available',
              count: data.items?.length || data.experiments?.length || 0
            });
          }
        } catch (error) {
          results.errors.push(`${endpoint.name}: ${error.message}`);
        }
      }
    } else {
      // Web Experimentation endpoints
      const endpoints = [
        { name: 'campaigns', url: `/v2/campaigns?project_id=${projectId}` },
        { name: 'pages', url: `/v2/pages?project_id=${projectId}` },
        { name: 'experiments', url: `/v2/experiments?project_id=${projectId}` }
      ];
      
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(`https://api.optimizely.com${endpoint.url}`, { headers });
          if (response.ok) {
            const data = await response.json();
            results.availableEndpoints.push({
              name: endpoint.name,
              status: 'available',
              count: data.campaigns?.length || data.pages?.length || data.experiments?.length || 0
            });
          }
        } catch (error) {
          results.errors.push(`${endpoint.name}: ${error.message}`);
        }
      }
    }
    
    // 3. Test universal endpoints
    const universalEndpoints = [
      { name: 'audiences', url: `/v2/audiences?project_id=${projectId}` },
      { name: 'events', url: `/v2/events?project_id=${projectId}` },
      { name: 'attributes', url: `/v2/attributes?project_id=${projectId}` }
    ];
    
    for (const endpoint of universalEndpoints) {
      try {
        const response = await fetch(`https://api.optimizely.com${endpoint.url}`, { headers });
        if (response.ok) {
          const data = await response.json();
          results.availableEndpoints.push({
            name: endpoint.name,
            status: 'available',
            count: data.audiences?.length || data.events?.length || data.attributes?.length || 0
          });
        }
      } catch (error) {
        results.errors.push(`${endpoint.name}: ${error.message}`);
      }
    }
    
  } catch (error) {
    results.errors.push(`Project validation failed: ${error.message}`);
  }
  
  return results;
}
```

### **Real-world Test Examples**

```javascript
// Test with known projects
const testProjects = [
  { id: '20224828075', type: 'Feature Experimentation', name: 'Akamai Edge Workers' },
  { id: '8923080126', type: 'Web Experimentation', name: 'Web Test Project' }
];

for (const project of testProjects) {
  console.log(`Testing ${project.name} (${project.type})`);
  const results = await validateProjectAPIs(project.id, token);
  console.log('Available endpoints:', results.availableEndpoints.map(e => `${e.name} (${e.count} items)`));
  if (results.errors.length > 0) {
    console.log('Errors:', results.errors);
  }
}
```

---

## 🔧 Integration Best Practices

### **1. Authentication Management**

```javascript
class OptimizelyAPIClient {
  constructor(token) {
    this.token = token;
    this.baseHeaders = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }
  
  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `https://api.optimizely.com${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.baseHeaders,
        ...options.headers
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new OptimizelyAPIError(
        `API Error: ${errorData.error || response.statusText}`,
        response.status,
        errorData
      );
    }
    
    return await response.json();
  }
}
```

### **2. Caching Strategy**

```javascript
class OptimizelyCache {
  constructor(ttlMinutes = 15) {
    this.cache = new Map();
    this.ttl = ttlMinutes * 60 * 1000;
  }
  
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }
  
  set(key, data) {
    this.cache.set(key, {
      data,
      expires: Date.now() + this.ttl
    });
  }
}
```

### **3. Complete Integration Example**

```javascript
// NOTE: This example class mirrors the actual OptimizelyAPIHelper structure in the codebase
class OptimizelyIntegration {
  constructor(token) {
    this.client = new OptimizelyAPIClient(token);
    this.cache = new OptimizelyCache(15); // 15 minute cache
  }
  
  // Mirrors OptimizelyAPIHelper.getProject()
  async getProject(projectId) {
    const cacheKey = `project:${projectId}`;
    let project = this.cache.get(cacheKey);
    
    if (!project) {
      project = await this.client.request(`/v2/projects/${projectId}`);
      this.cache.set(cacheKey, project);
    }
    
    return {
      ...project,
      platform: project.is_flags_enabled ? 'Feature Experimentation' : 'Web Experimentation'
    };
  }
  
  // Mirrors OptimizelyAPIHelper.getProjectData()
  async getProjectData(projectId, options = {}) {
    const project = await this.getProject(projectId);
    const entities = { project };
    
    if (project.is_flags_enabled) {
      // Feature Experimentation - using correct method names
      if (options.includeFlags !== false) {
        entities.flags = await this.listFlags(projectId);
      }
      if (options.includeExperiments !== false) {
        entities.experiments = await this.listExperiments(projectId);
      }
    } else {
      // Web Experimentation - using correct method names
      if (options.includeCampaigns !== false) {
        entities.campaigns = await this.listCampaigns(projectId);
      }
      if (options.includePages !== false) {
        entities.pages = await this.listPages(projectId);
      }
      if (options.includeExperiments !== false) {
        entities.experiments = await this.listExperiments(projectId);
      }
    }
    
    // Universal entities - using correct method names
    if (options.includeAudiences !== false) {
      entities.audiences = await this.listAudiences(projectId);
    }
    if (options.includeEvents !== false) {
      entities.events = await this.listEvents(projectId);
    }
    
    return entities;
  }
  
  // Mirror actual OptimizelyAPIHelper methods
  async listFlags(projectId, filters = {}) {
    return await this.client.request(`/flags/v1/projects/${projectId}/flags`, {
      method: 'GET'
    });
  }
  
  async getFlag(projectId, flagKey) {
    return await this.client.request(`/flags/v1/projects/${projectId}/flags/${flagKey}`);
  }
  
  async getFlagEnvironmentRuleset(projectId, flagKey, environmentKey) {
    return await this.client.request(`/flags/v1/projects/${projectId}/flags/${flagKey}/environments/${environmentKey}/ruleset`);
  }
  
  async listExperiments(projectId, filters = {}) {
    const params = new URLSearchParams({ project_id: projectId, ...filters });
    return await this.client.request(`/v2/experiments?${params}`);
  }
  
  async listCampaigns(projectId, params = {}) {
    const searchParams = new URLSearchParams({ project_id: projectId, ...params });
    return await this.client.request(`/v2/campaigns?${searchParams}`);
  }
  
  async listPages(projectId, params = {}) {
    const searchParams = new URLSearchParams({ project_id: projectId, ...params });
    return await this.client.request(`/v2/pages?${searchParams}`);
  }
  
  async listAudiences(projectId, filters = {}) {
    const params = new URLSearchParams({ project_id: projectId, ...filters });
    return await this.client.request(`/v2/audiences?${params}`);
  }
  
  async listEvents(projectId, filters = {}) {
    const params = new URLSearchParams({ project_id: projectId, ...filters });
    return await this.client.request(`/v2/events?${params}`);
  }
  
  // Custom method for finding variables in flags
  async findVariableInFlags(projectId, variableName) {
    const flags = await this.listFlags(projectId);
    const results = [];
    
    for (const flag of flags.items || flags) {
      const hasVariable = flag.variable_definitions?.some(v => 
        v.key.toLowerCase().includes(variableName.toLowerCase())
      );
      
      if (hasVariable) {
        results.push({
          flagKey: flag.key,
          flagName: flag.name,
          variables: flag.variable_definitions,
          variations: flag.variations
        });
      }
    }
    
    return results;
  }
}

// Usage - Updated to match corrected method names
const optimizely = new OptimizelyIntegration(process.env.OPTIMIZELY_TOKEN);

// Get complete project data (mirrors OptimizelyAPIHelper.getProjectData)
const projectData = await optimizely.getProjectData('20224828075', {
  includeFlags: true,
  includeExperiments: true,
  includeAudiences: true
});

// Get specific flag (mirrors OptimizelyAPIHelper.getFlag)
const flag = await optimizely.getFlag('20224828075', 'my-flag-key');

// Get flag ruleset (mirrors OptimizelyAPIHelper.getFlagEnvironmentRuleset)
const ruleset = await optimizely.getFlagEnvironmentRuleset('20224828075', 'my-flag-key', 'production');

// Find specific variables using corrected method
const cdnFlags = await optimizely.findVariableInFlags('20224828075', 'cdnvariationsettings');
```

---

## 📊 Monitoring & Maintenance

### **API Health Monitoring**

```javascript
async function monitorAPIHealth() {
  const checks = [
    { name: 'Projects API', url: 'https://api.optimizely.com/v2/projects' },
    { name: 'Feature Flags API', url: 'https://api.optimizely.com/flags/v1' },
    { name: 'Web Experiments API', url: 'https://api.optimizely.com/v2/experiments' }
  ];
  
  const results = [];
  
  for (const check of checks) {
    const start = Date.now();
    try {
      const response = await fetch(check.url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      results.push({
        name: check.name,
        status: response.status,
        responseTime: Date.now() - start,
        healthy: response.status < 400
      });
    } catch (error) {
      results.push({
        name: check.name,
        status: 'error',
        responseTime: Date.now() - start,
        healthy: false,
        error: error.message
      });
    }
  }
  
  return results;
}
```

---

## 🎯 Key Takeaways

1. **Always check project type first** - `is_flags_enabled` determines available APIs
2. **Handle platform mismatches gracefully** - Empty responses are normal for wrong platform
3. **Implement proper error handling** - Rate limits and authentication issues are common
4. **Use caching** - API responses are relatively stable, cache for 15+ minutes
5. **Validate responses** - Check for expected fields and data consistency
6. **Monitor API health** - Track response times and error rates
7. **Test with real data** - Use known project IDs for validation

This integration guide, combined with the REST API documentation, provides everything needed to successfully work with Optimizely's APIs and debug issues effectively. 