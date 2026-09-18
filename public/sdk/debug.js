/* Optional customer-owned debugging view. No network, persistence or auto-start. */
(function (host) {
  'use strict';
  function attach(client, options = {}) {
    if (options.enabled !== true || !client?.core || typeof client.core.on !== 'function') throw new Error('Explicit SDK debug opt-in required');
    const maximum = options.limit === undefined ? 50 : options.limit;
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) throw new Error('Debug limit must be 1–100');
    const rows = [], stops = []; let disposed = false, sequence = 0;
    const node = options.element;
    const repaint = () => { if (node) node.textContent = rows.map(row => JSON.stringify(row)).join('\n'); };
    // Only a fixed projection is ever retained. Never retain callback payloads,
    // IDs, capabilities, URLs, raw events, affinity vectors or provider replies.
    const add = (kind, detail = {}) => {
      if (disposed) return;
      rows.push({ sequence: ++sequence, kind, ...detail }); if (rows.length > maximum) rows.shift(); repaint();
    };
    stops.push(client.core.on('sent', (_event, meta) => add('event-dispatched', { transport: ['fetch', 'beacon', 'socket'].includes(meta?.via) ? meta.via : 'unknown' })));
    stops.push(client.core.on('decisions', value => add('decisions-received', { count: Array.isArray(value?.decisions) ? Math.min(1000, value.decisions.length) : 0 })));
    stops.push(client.core.on('update', (_value, meta) => add('update-received', { push: meta?.fromPush === true,
      rttMs: typeof meta?.rttMs === 'number' && Number.isFinite(meta.rttMs) && meta.rttMs >= 0 ? Math.round(meta.rttMs) : null })));
    stops.push(client.core.on('socket', value => add('socket', { state: ['connected', 'closed', 'connecting', 'reconnecting', 'unavailable', 'error'].includes(value) ? value : 'unknown' })));
    stops.push(client.core.on('generation', () => { rows.length = 0; add('lifecycle-changed'); }));
    stops.push(client.core.on('identity', () => { rows.length = 0; add('identity-changed'); }));
    return Object.freeze({ snapshot: () => rows.map(row => ({ ...row })), clear() { rows.length = 0; repaint(); },
      dispose() { if (disposed) return; disposed = true; for (const stop of stops) stop(); stops.length = 0; rows.length = 0; repaint(); } });
  }
  host.EdgePersonalizationDebug = Object.freeze({ version: 1, attach });
})(globalThis);
