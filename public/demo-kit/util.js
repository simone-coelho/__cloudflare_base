// public/demo-kit/util.js: the demo kit's small shared helpers.
//
// Pure functions, plus two that move the page when they are called (focusOn,
// scrollTop) and one that waits for idle time. Nothing here touches the DOM or
// the window at import time. Every kit module imports from here, and a demo's
// own script may too (Vantage does), so a price or a score is formatted one way
// on every surface.

/** HTML-escape a value for an attribute or a text position. */
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (n) => (typeof n === 'number' ? n : Number(n));
export const money = (n) => (n == null || !Number.isFinite(num(n)) ? '' : `$${num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const money0 = (n) => (n == null || !Number.isFinite(num(n)) ? '' : (num(n) % 1 ? money(n) : `$${num(n).toLocaleString('en-US')}`));
export const trunc2 = (n) => Math.floor(n * 100 + 1e-6) / 100;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmt3 = (n) => (Number.isFinite(num(n)) ? num(n).toFixed(3) : '—');
export const fmt2 = (n) => (Number.isFinite(num(n)) ? num(n).toFixed(2) : '—');
/** The clock as the machine panel shows it: 12-hour, with seconds. */
export const hhmm = (t) => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
/** The clock as Compare's tags show it: hh:mm, 24-hour. */
export const clock = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + Math.random().toString(16).slice(2));
export const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
export const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');
/** Run fn in idle time (bounded at 1.5 s), or shortly where the browser has no idle callback. */
export const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
export const scrollTop = () => { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* optional */ } };
/** Bring a region of the page into view for the room. */
export function focusOn(node, block) {
  if (!node) return;
  try { node.scrollIntoView({ behavior: 'smooth', block: block || 'start' }); } catch { /* optional */ }
}
