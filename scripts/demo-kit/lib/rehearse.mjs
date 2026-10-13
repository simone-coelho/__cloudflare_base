// scripts/demo-kit/lib/rehearse.mjs — a demo's request-level rehearsal: the requests a page makes, and the checks' vocabulary.
//
// Lifted from scripts/rehearse-vantage-page.mjs (lane K3, part c; docs/demo-kit/Demo-Kit-Design.md §2.3), so
// that a demo's suites hold only its outcomes. Two halves:
//
//   • The checks' vocabulary, which both of a demo's suites print in (createChecks): `✓ label  (detail)` for a
//     pass, `✗ label — detail` for a failure, an indented line of information, a `!` line for a known defect in
//     another lane's file (printed on every run, named on the last line, a failure only under --strict), and
//     the last line, `✓ N checks: …` or `✗ F of N check(s) failed: …`, whose count check-demo.mjs reads back
//     (suiteSummary). The exit code is 1 when any check failed and 0 otherwise; a `!` line alone is 0.
//   • The requests a demo's page makes, exactly as its transport sends them (createClient): a browser's
//     navigation and the static documents; the API with X-Tenant and the site key on every call; the demo's
//     own routes by name, carrying no document and no credential; a visitor minted with her consent; events
//     with the landing entry, retried once and every refusal listed; content clicks for the decided
//     containers around a press; the snapshot with its asserted context; the meters, /sort, the receipts the
//     ledger writes a few seconds after a decision (202 while it writes), and the cold-start panel.
//
// Nothing here holds a credential or takes one: if a suite needs a token, the page is broken.
import http from 'node:http';
import https from 'node:https';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The decisions' content ids, in order. */
export const ids = (list) => (list || []).map((d) => d.customerContentId);

/**
 * A suite's flags, read as the suites have always read them: the word after the flag, or the fallback when the
 * flag is absent. `argv` is the whole process.argv (index 0 is node itself, so a flag is always past it).
 */
export const flagReader = (argv = process.argv) => (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };

// ── The checks' vocabulary ──────────────────────────────────────────────────

/**
 * The checks a suite prints, and its exit code.
 *
 *   infoIndent   the indentation of an information line (the request-level suite 6, the DOM suite 8)
 *   strict       --strict: a known defect is an ordinary failure
 *   defectsDoc   where a known defect is recorded with its fix (named on its `!` line)
 *   out          where a line goes (console.log; a test passes its own)
 */
export function createChecks({ infoIndent = 6, strict = false, defectsDoc = null, out = (line) => console.log(line) } = {}) {
  let failures = 0, passes = 0;
  const defects = [];
  const ok = (label, condition, detail = '') => {
    if (condition) { passes += 1; out(`   ✓ ${label}${detail ? `  (${detail})` : ''}`); }
    else { failures += 1; out(`   ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
    return Boolean(condition);
  };
  /**
   * A defect in another lane's file that the suite cannot repair: printed with "!" on every run and named on the
   * last line; it turns into an ordinary pass the day the fix lands. Under --strict it fails.
   */
  const known = (label, condition, detail, owner) => {
    if (condition) return ok(label, true, detail);
    if (strict) return ok(label, false, detail);
    defects.push(`${label} (${owner})`);
    out(`   ! ${label} — ${detail}\n     known page defect, recorded for ${owner}${defectsDoc ? ` in ${defectsDoc}` : ''}`);
    return false;
  };
  const info = (line) => out(`${' '.repeat(infoIndent)}${line}`);
  /** A failure that is not a check: the walk threw, the reset failed. Counted, and printed as one. */
  const fail = (line) => { failures += 1; out(`   ✗ ${line}`); };
  const tail = () => (defects.length ? ` · ${defects.length} known page defect${defects.length === 1 ? '' : 's'} printed above (${defects.map((d) => d.replace(/^↳ /, '')).join('; ')})` : '');
  /** The last line, in the suite's own words for each outcome; printed after a blank line, and returned. */
  const summary = ({ failed, passed }) => {
    const line = failures ? `✗ ${failures} of ${failures + passes} check(s) failed: ${failed}${tail()}` : `✓ ${passes} checks: ${passed}${tail()}`;
    out(`\n${line}`);
    return line;
  };
  const exitCode = () => (failures ? 1 : 0);
  return {
    ok, known, info, fail, summary, exitCode,
    get failures() { return failures; },
    get passes() { return passes; },
    get defects() { return [...defects]; },
  };
}

/** The count a suite's last line states: "✓ 111 checks: …" or "✗ 3 of 111 check(s) failed: …"; null when it has none. */
export function suiteSummary(text) {
  const lines = String(text).trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const pass = /✓ (\d+) checks?\b/.exec(line);
    if (pass) return { ok: true, passed: Number(pass[1]), total: Number(pass[1]), line: line.trim() };
    const fail = /✗ (\d+) of (\d+) check\(s\) failed/.exec(line);
    if (fail) return { ok: false, passed: Number(fail[2]) - Number(fail[1]), total: Number(fail[2]), line: line.trim() };
  }
  return null;
}

// ── A page's source, read as code ──────────────────────────────────────────

/**
 * A file's code without its comments, line for line (the kit-boundary guard): each comment becomes spaces and
 * keeps its newlines. Strings, template literals (with their ${} nesting) and regular expressions stay as code: a
 * literal in any of them is a literal. A "/" starts a regular expression where an operand is expected.
 */
export function codeOnly(src, kind) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  if (kind === 'css') return src.replace(/\/\*[\s\S]*?\*\//g, blank);
  const KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
  const n = src.length;
  const stack = [];             // inside template literals: '`', and '{' for each brace opened within a ${ }
  let out = '', i = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (stack[stack.length - 1] === '`') {
      if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { stack.pop(); out += c; i += 1; continue; }
      if (c === '$' && d === '{') { stack.push('{'); out += '${'; i += 2; continue; }
      out += c; i += 1; continue;
    }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; out += blank(src.slice(i, end)); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out += blank(src.slice(i, end)); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '`') { stack.push('`'); out += c; i += 1; continue; }
    if (c === '{' && stack.length) { stack.push('{'); out += c; i += 1; continue; }
    if (c === '}' && stack[stack.length - 1] === '{') { stack.pop(); out += c; i += 1; continue; }
    if (c === '/') {
      const before = out.replace(/\s+$/, '');
      const last = before.slice(-1), w = (/[A-Za-z_$][\w$]*$/.exec(before) || [''])[0];
      if (!last || '(,=:[!&|?{};+-*%<>~^'.includes(last) || KEYWORDS.has(w)) {
        let j = i + 1, cls = false;
        while (j < n && src[j] !== '\n') {
          const ch = src[j];
          if (ch === '\\') { j += 2; continue; }
          if (ch === '[') cls = true; else if (ch === ']') cls = false; else if (ch === '/' && !cls) break;
          j += 1;
        }
        out += src.slice(i, j + 1); i = j + 1; continue;
      }
    }
    out += c; i += 1;
  }
  return out;
}

// ── The requests a demo's page makes ────────────────────────────────────────

/**
 * A demo's page, at request level.
 *
 *   base     the worker, without a trailing slash
 *   tenant   the demo's tenant: X-Tenant on every API call, and the /v1/<tenant>/ routes
 *   source   the source its events carry
 *   sdkKey   the site key the page sends (public by design: SDK_KEYS)
 *   assets   where its static files are served, with both slashes (/vantage/)
 *   api      its own routes (/vantage/api): beats by name, reset, receipt, report, the cold-start panel
 */
export function createClient({ base, tenant, source, sdkKey = 'demo-site', assets, api }) {
  const asset = (path) => fetch(`${base}${assets}${path}`, { cache: 'no-store' });
  /**
   * A page as a browser navigates to it: the assets layer answers a navigation differently from a plain
   * fetch. Node's fetch drops Sec-Fetch-* (forbidden request headers), so this goes through node:http.
   */
  function navigate(path, hops = 0) {
    const url = new URL(path.startsWith('/') ? `${base}${path}` : `${base}${assets}${path}`);
    const lib = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request(url, { method: 'GET', headers: { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Site': 'none', Accept: 'text/html,application/xhtml+xml', 'Cache-Control': 'no-store' } }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 3) {
            resolve(navigate(new URL(res.headers.location, url).pathname + new URL(res.headers.location, url).search, hops + 1));
            return;
          }
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text: async () => body });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
  const assetJson = async (path) => {
    const res = await asset(path);
    if (!res.ok) throw new Error(`${assets}${path} answered ${res.status}`);
    return res.json();
  };

  const H = { 'X-SDK-Key': sdkKey, 'Content-Type': 'application/json', 'X-Tenant': tenant };
  /** One API call as the page's api() makes it; a header set to null is not sent. Never throws. */
  async function call(path, { method, body, visitor, headers } = {}) {
    const h = { ...H, ...(headers || {}) };
    if (visitor) h['X-Shopper-Session'] = visitor.session.capability;
    for (const [k, v] of Object.entries(h)) if (v === null) delete h[k];
    const t0 = Date.now();
    try {
      const res = await fetch(base + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: h,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: res.status, ok: res.ok, ms: Date.now() - t0, body: await res.json().catch(() => ({})) };
    } catch (error) {
      return { status: 0, ok: false, ms: Date.now() - t0, body: { error: String(error.message || error) } };
    }
  }
  /** The demo route, by name: the page's own merchandiser door. No document crosses from here. */
  async function demoRoute(path, body) {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': tenant }, body: JSON.stringify(body || {}) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.ok !== true) throw new Error(`${path} ${JSON.stringify(body)} → ${res.status} ${out.error || ''}`);
    return out;
  }

  /** Session first, then her explicit consent, exactly as the page does (mintVisitor). `state` is the vertical's own. */
  async function mintVisitor(entry, label, state = {}) {
    const minted = await call(`/v1/${tenant}/identity/session`, { body: {} });
    if (!minted.body.session) throw new Error(`no shopper session (${minted.status} ${minted.body.error || ''})`);
    const v = { label, session: minted.body.session, entry: entry || {}, ...state };
    const s = v.session;
    const pref = await call('/realtime/session/preferences', { visitor: v, body: { userId: s.subject, trackingConsent: true, personalizationEnabled: true,
      choice: { id: crypto.randomUUID().replace(/-/g, ''), expectedRevision: null, grantId: s.grantId, iat: s.iat, exp: s.exp } } });
    if (!pref.body.consent || !pref.body.consent.personalization) throw new Error('the visitor did not grant consent');
    return v;
  }

  const transient = [];
  /**
   * One event, as send() posts it. The page does not retry; this does, once, so a
   * transient engine refusal cannot impersonate a ranking fault downstream. Every
   * refusal is listed at the end by name (`transient`), never absorbed silently.
   */
  async function send(v, type, data) {
    const body = { userId: v.session.subject, sessionId: v.session.sessionId, source, type, data,
      ...(v.entry && Object.keys(v.entry).length ? { entry: v.entry } : {}) };
    let r = await call('/realtime/action', { visitor: v, body });
    if (!r.ok) {
      const why = r.body && r.body.error ? ` (${String(r.body.error).slice(0, 80)})` : '';
      await sleep(600);
      r = await call('/realtime/action', { visitor: v, body });
      transient.push(`${type} → ${why ? `${why.trim()} ` : ''}refused once; asked again → ${r.status}`);
    }
    return r;
  }
  const sendCustom = (v, event, data) => send(v, 'custom', { event, ...data });
  /**
   * creditDecided(): a click on any control inside a decided container (a module,
   * a card) is also that container's reward, one content_click per nesting
   * level, sent together before the control's own event.
   */
  const credit = (v, ...decisions) => Promise.all(decisions.filter(Boolean).map((d) =>
    send(v, 'content_click', { contentId: d.contentId, slot: d.slot, decisionId: d.decisionId, customerContentId: d.customerContentId })));

  /**
   * One snapshot, as ask() builds it: the landing entry on every one, then each piece of asserted context as
   * ctx.<name> when it has a value, in the order given. `asked` is what was asserted (null where nothing was);
   * `slot(name)` the decisions of one slot in their order.
   */
  async function snapshot(v, pageKey, context = {}) {
    const q = new URLSearchParams({ page: pageKey });
    if (v.entry && Object.keys(v.entry).length) q.set('entry', JSON.stringify(v.entry));
    for (const [k, value] of Object.entries(context)) if (value !== null && value !== undefined && value !== '') q.set(`ctx.${k}`, value);
    const r = await call(`/v1/${tenant}/decisions/snapshot?${q}`, { visitor: v });
    if (!r.ok || !Array.isArray(r.body.decisions)) throw new Error(`the decision service answered ${r.status} ${r.body.error || ''}`);
    const slot = (name) => r.body.decisions.filter((d) => d.slot === name).sort((a, b) => a.order - b.order);
    return { ms: r.ms, arm: r.body.arm, asked: Object.fromEntries(Object.keys(context).map((k) => [k, q.get(`ctx.${k}`)])), all: r.body.decisions, slot };
  }
  /** Her meters, as the signals panel reads them. */
  async function meters(v) {
    const r = await call('/realtime/reflex', { visitor: v });
    return { dims: (r.body.affinity && r.body.affinity.dims) || {}, audiences: (r.body.affinity && r.body.affinity.audiences) || [], stage: r.body.journeyStage };
  }
  /** A rail sorted on her vector (POST /sort): the order, or null. */
  async function sort(v, candidates, weights) {
    const r = await call('/sort', { visitor: v, body: { userId: v.session.subject, sessionId: v.session.sessionId, candidates, weights } });
    return r.ok && Array.isArray(r.body.order) ? r.body.order : null;
  }
  /**
   * The full records behind decisions, as prefetchReceipts() asks: 202 while the ledger consumer writes, every 2 s,
   * ten times; at most twelve ids. `context` is the asserted context the page sends with them, if any.
   */
  async function receipts(v, decisions, context) {
    const want = [...new Set(decisions.map((d) => d.decisionId).filter(Boolean))].slice(0, 12);
    const got = new Map();
    for (let attempt = 0; attempt < 10 && got.size < want.length; attempt += 1) {
      const r = await call(`${api}/receipt`, { visitor: v, body: { decisionIds: want.filter((id) => !got.has(id)), ...(context ? { context } : {}) } });
      for (const rec of r.body.records || []) got.set(rec.decision_id, rec);
      if (got.size >= want.length || !(r.status === 200 || r.status === 202)) break;
      await sleep(2000);
    }
    return got;
  }
  /** The cold-start panel's read, for an asserted region or (none) the request's own. */
  async function coldstart(region) {
    const r = await call(`${api}/coldstart${region ? `?region=${encodeURIComponent(region)}` : ''}`);
    return r.ok ? r.body : null;
  }

  return { base, tenant, asset, assetJson, navigate, call, demoRoute, mintVisitor, send, sendCustom, credit, snapshot, meters, sort, receipts, coldstart, transient };
}
