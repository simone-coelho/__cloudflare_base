## New event dispatcher:  `optimizely-event-dispatcher.js`

```js
// optimizely-event-dispatcher.js
import https from 'https';

const DEFAULT_URL = 'https://logx.optimizely.com/v1/events';

export class OptimizelyEventDispatcher {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 3000;               // safer than 1000ms at the edge
    this.batchingEnabled = options.batchingEnabled !== false;
    this.maxRetries = options.maxRetries ?? 2;
    this.batchSize = options.batchSize ?? 10;
    this.flushInterval = options.flushInterval ?? 100;
    this.strictMode = options.strictMode ?? false;         // sends X-Optimizely-Strict: true when enabled
    this.defaultUrl = options.defaultUrl || DEFAULT_URL;

    this.agent = options.agent || new https.Agent({
      keepAlive: true,
      maxSockets: 4,
      keepAliveMsecs: 3000
    });

    this._queue = [];
    this._timer = null;
    this._flushing = false;
  }

  // Queue an event; returns a Promise you may ignore (fire-and-forget) or await.
  dispatchEvent({ url, params }) {
    const targetUrl = url || this.defaultUrl;
    const normalized = this._normalizeParams(params);
    this._queue.push({ url: targetUrl, payload: normalized });

    if (!this._timer) {
      this._timer = setTimeout(() => this._flushQueue(), this.flushInterval);
    }
    if (this._queue.length >= this.batchSize) {
      clearTimeout(this._timer);
      this._timer = null;
      return this._flushQueue();
    }
    return Promise.resolve(true);
  }

  async flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    return this._flushQueue();
  }

  // ---------- internals ----------

  _normalizeParams(params = {}) {
    // Top-level *snake_case* fields
    const account_id      = params.account_id      ?? params.accountId;
    const project_id      = params.project_id      ?? params.projectId;
    const anonymize_ip    = params.anonymize_ip    ?? params.anonymizeIP;
    const client_name     = params.client_name     ?? params.clientName;
    const client_version  = params.client_version  ?? params.clientVersion;
    const enrich_decisions = params.enrich_decisions ?? params.enrichDecisions ?? true;

    const visitors = (params.visitors || []).map(v => this._normalizeVisitor(v));
    return { account_id, project_id, anonymize_ip, client_name, client_version, enrich_decisions, visitors };
  }

  _normalizeVisitor(v = {}) {
    const out = { ...v };

    // Attributes: allow map or array. Convert map -> array-of-objects.
    if (out.attributes && !Array.isArray(out.attributes)) {
      out.attributes = Object.entries(out.attributes).map(([key, value]) => ({
        type: 'custom',
        key,
        value
        // Optional: add entity_id if you know the attribute ID in Optimizely.
      }));
    }

    // Ensure event timestamps are 13-digit ms and every event has a uuid
    if (Array.isArray(out.snapshots)) {
      out.snapshots.forEach(s => {
        if (Array.isArray(s.events)) {
          s.events.forEach(e => {
            if (typeof e.timestamp === 'number') {
              const len = String(e.timestamp).length;
              if (len > 13) e.timestamp = Math.floor(e.timestamp / Math.pow(10, len - 13)); // micro/nano -> ms
              if (len < 13) e.timestamp = e.timestamp * Math.pow(10, 13 - len);            // sec -> ms
            } else if (e.timestamp == null) {
              e.timestamp = Date.now();
            }
            if (!e.uuid) e.uuid = this._uuid4();
          });
        }
      });
    }
    return out;
  }

  _uuid4() {
    const rnd32 = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    return `${rnd32().slice(0,8)}-${rnd32().slice(0,4)}-${rnd32().slice(0,4)}-${rnd32().slice(0,4)}-${rnd32()}`;
  }

  async _flushQueue() {
    if (this._flushing) return;
    if (this._queue.length === 0) return;

    this._flushing = true;
    try {
      const items = this._queue.splice(0, this.batchSize);

      // Group by URL + top-level signature so we don't mix accounts/projects in one payload
      const groups = new Map();
      for (const { url, payload } of items) {
        const sig = [
          url || this.defaultUrl,
          payload.account_id || '',
          payload.project_id || '',
          payload.client_name || '',
          payload.client_version || '',
          payload.anonymize_ip === true ? '1' : payload.anonymize_ip === false ? '0' : ''
        ].join('|');

        if (!groups.has(sig)) {
          groups.set(sig, { url: url || this.defaultUrl, base: { ...payload, visitors: [] } });
        }
        groups.get(sig).base.visitors.push(...payload.visitors);
      }

      const sends = [];
      for (const { url, base } of groups.values()) {
        sends.push(this._sendRequest(url, base));
      }
      await Promise.all(sends);
    } finally {
      this._flushing = false;
      if (this._queue.length > 0 && !this._timer) {
        this._timer = setTimeout(() => this._flushQueue(), this.flushInterval);
      }
    }
  }

  _sendRequest(url, bodyObj, attempt = 0) {
    const target = new URL(url || this.defaultUrl);
    const body = JSON.stringify(bodyObj);

    const options = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method: 'POST',
      agent: this.agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Lambda@Edge-Optimizely/1.0',
        ...(this.strictMode ? { 'X-Optimizely-Strict': 'true' } : {})
      },
      timeout: this.timeout
    };

    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        // Drain response
        res.on('data', () => {});
        res.on('end', () => {
          const ok = res.statusCode === 204 || res.statusCode === 200;
          if (!ok && attempt < this.maxRetries) {
            const backoff = Math.min(1000, 50 * Math.pow(2, attempt));
            setTimeout(() => this._sendRequest(url, bodyObj, attempt + 1).then(resolve), backoff);
          } else {
            resolve(ok);
          }
        });
      });

      req.on('error', () => {
        if (attempt < this.maxRetries) {
          const backoff = Math.min(1000, 50 * Math.pow(2, attempt));
          setTimeout(() => this._sendRequest(url, bodyObj, attempt + 1).then(resolve), backoff);
        } else {
          resolve(false);
        }
      });

      req.on('timeout', () => req.destroy(new Error('timeout')));

      req.write(body);
      req.end();
    });
  }
}

export const optimizelyDispatcher = new OptimizelyEventDispatcher({
  timeout: 3000,         // align with what worked for you
  batchingEnabled: true,
  maxRetries: 2,
  strictMode: false      // set true during troubleshooting to fail fast
});

// Legacy wrapper, if you still call dispatchEvent directly
export function dispatchEvent({ url, params }) {
  return optimizelyDispatcher.dispatchEvent({ url, params });
}
```

---

## Usage in Lambda\@Edge (**do this**)

The handler **must await** the final flush so CloudFront doesn’t freeze the container with unsent requests:

```js
// handler.js (ESM style)
import { optimizelyDispatcher } from './optimizely-event-dispatcher.js';

export const handler = async (event /*, context */) => {
  const request = event.Records[0].cf.request;

  // queue 1+ events
  optimizelyDispatcher.dispatchEvent({
    url: 'https://logx.optimizely.com/v1/events',
    params: {
      account_id: process.env.OPTIMIZELY_ACCOUNT_ID,
      project_id: process.env.OPTIMIZELY_PROJECT_ID,
      client_name: 'lambda-edge',
      client_version: '1.0.0',
      anonymize_ip: true,
      visitors: [{
        visitor_id: `lambda_edge_${Date.now()}`,
        // You may pass attributes as a map; the dispatcher converts it:
        attributes: { source: 'lambda_edge_test', region: process.env.AWS_REGION || 'unknown' },
        snapshots: [{
          decisions: [], // or include campaign/experiment/variation + campaign_activated as needed
          events: [{
            entity_id: 'YOUR_EVENT_ID',
            key: 'edge_test_conversion',
            timestamp: Date.now(), // ensured to be ms
            // uuid auto-generated if omitted
            tags: { iteration: '1' }
          }]
        }]
      }],
      enrich_decisions: true
    }
  });

  // IMPORTANT: wait for network sends before returning
  await optimizelyDispatcher.flush();

  // Continue normal CF flow
  return request;
};
```
