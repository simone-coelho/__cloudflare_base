/**
 * /__shot — internal visual-verification route (headless Chromium via Cloudflare Browser Rendering).
 * Drives our OWN storefront in a real browser and returns a PNG, so changes can be eyeballed before
 * being called "done". Same-origin only (path is resolved against this Worker's origin).
 *
 *   GET /__shot?path=/storefront&w=420&h=1600&wait=1500&clicks=.sb-start,%23dir-next&clip=%23sidebar
 *     path    — same-origin path to load (default /storefront)
 *     w,h     — viewport (default 1440x1600)
 *     wait    — ms to settle after load and after each click (default 1400)
 *     clicks  — comma-separated CSS selectors to click in order (URL-encode # as %23)
 *     clip    — CSS selector to crop the screenshot to (else full viewport; full=1 for full page)
 */
import { Hono } from 'hono';
import puppeteer from '@cloudflare/puppeteer';
import type { Env } from '@/types/env';

const shot = new Hono<{ Bindings: Env }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * THIS ROUTE EVALUATES ARBITRARY JAVASCRIPT IN A REAL BROWSER ON THIS ORIGIN.
 *
 * Ungated on a public host that is a remote-code-execution surface wearing a
 * screenshot tool's clothes: `?js=` runs in our origin's context, so it can call
 * our own API routes and post the answers anywhere, and every call burns
 * account-wide Browser Rendering quota that is rate limited for everyone.
 *
 * So it is CLOSED BY DEFAULT. With no SHOT_TOKEN configured the route does not
 * exist; with one configured, a request must present it. Both failures return
 * 404 rather than 401, because a 401 confirms there is something here to
 * attack. Set SHOT_TOKEN in .dev.vars locally, and simply leave it unset on the
 * conference deployment — nothing on stage needs this route.
 */
function denied(c: { env: Env; req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined } }): boolean {
  const expected = c.env.SHOT_TOKEN;
  if (!expected) return true;
  const given = c.req.query('token') ?? c.req.header('x-shot-token') ?? '';
  // Length-independent compare: never leak the token's length via timing.
  let diff = given.length === expected.length ? 0 : 1;
  for (let i = 0; i < Math.max(given.length, expected.length); i += 1) {
    diff |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff !== 0;
}

// rec=hero: record the #hero title sequence from document-start, so a DURING-LOAD flash
// (e.g. "The Tabby Shop" → "The Summer Edit") is captured even though the screenshot settles after it.
const REC_SCRIPT = `window.__herolog=[];(function(){var last=null,t0=Date.now();var iv=setInterval(function(){var el=document.querySelector('#hero-content .hero-title');var t=el?(el.textContent||'').trim():'';if(t!==last){window.__herolog.push({ms:Date.now()-t0,title:t||'(empty)'});last=t;}},16);setTimeout(function(){clearInterval(iv);},9000);})();`;

/** Reuse a free Browser Rendering session when one exists — ACQUISITIONS are
    rate-limited account-wide (the "Unable to create new browser: 500" failure
    after heavy use); reconnecting to a live session is not. Else launch fresh. */
async function getBrowser(env: Env): Promise<any> {
  try {
    const sessions = await (puppeteer as any).sessions(env.BROWSER);
    const free = (sessions || []).find((s: any) => !s.connectionId);
    if (free) return await (puppeteer as any).connect(env.BROWSER, free.sessionId);
  } catch { /* fall through to a fresh launch */ }
  return await puppeteer.launch(env.BROWSER as any, { keep_alive: 60000 } as any);
}

shot.get('/', async (c) => {
  if (denied(c as any)) return c.notFound();
  if (!c.env.BROWSER) return c.json({ ok: false, error: 'Browser Rendering not bound' }, 503);
  const q = c.req.query();
  // Diagnostics: ?diag=1 → live sessions + account acquisition limits (never guess again).
  if (q.diag) {
    const out: Record<string, unknown> = { ok: true };
    try { out.sessions = await (puppeteer as any).sessions(c.env.BROWSER); } catch (e) { out.sessions = String(e); }
    try { out.limits = await (puppeteer as any).limits(c.env.BROWSER); } catch (e) { out.limits = String(e); }
    return c.json(out);
  }
  const url = new URL(q.path || '/storefront', c.req.url); // same-origin only
  const w = Math.min(2000, parseInt(q.w || '1440', 10) || 1440);
  const h = Math.min(4000, parseInt(q.h || '1600', 10) || 1600);
  const wait = Math.min(8000, parseInt(q.wait || '1400', 10) || 1400);
  const clicks = (q.clicks || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rec = q.rec || '';
  let browser: any;
  try {
    browser = await getBrowser(c.env);
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    if (rec) { try { await page.evaluateOnNewDocument(REC_SCRIPT); } catch (e) { /* recorder optional */ } }
    await page.goto(url.toString(), { waitUntil: 'networkidle0', timeout: 30000 });
    await sleep(wait);
    // A swallowed click is how a screenshot "verifies" something that never
    // happened: the selector misses, the catch eats it, and the PNG shows a page
    // in exactly the state it would be in if the feature were broken. So every
    // click reports, and the outcome rides back on a header the caller can assert.
    const clickLog: string[] = [];
    for (const sel of clicks) {
      try {
        await page.click(sel);
        clickLog.push(`ok:${sel}`);
        await sleep(wait);
      } catch (e) {
        clickLog.push(`FAIL:${sel}`);
      }
    }
    if (clickLog.length) c.header('x-shot-clicks', clickLog.join(' '));
    if (clickLog.some((l) => l.startsWith('FAIL:'))) c.header('x-shot-ok', 'false');
    if (q.js) { try { await page.evaluate(q.js); await sleep(Math.max(900, wait)); } catch (e) { /* eval optional */ } }
    if (rec) { const herolog = await page.evaluate('window.__herolog || []'); return c.json({ ok: true, herolog }); }
    let buf: Uint8Array;
    if (q.clip) {
      const el = await page.$(q.clip);
      buf = el ? await el.screenshot() : await page.screenshot({ fullPage: q.full === '1' });
    } else {
      buf = await page.screenshot({ fullPage: q.full === '1' });
    }
    return new Response(buf, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    // Close our pages, then DISCONNECT (not close): the session stays warm
    // (keep_alive) for the next shot to reuse — successive shots stop burning
    // rate-limited acquisitions. Idle sessions self-expire on Cloudflare's side.
    if (browser) {
      try {
        const pages = await browser.pages();
        for (const p of pages) { try { await p.close(); } catch { /* ignore */ } }
      } catch { /* ignore */ }
      try { await browser.disconnect(); } catch { try { await browser.close(); } catch { /* ignore */ } }
    }
  }
});

export { shot as shotRoutes };
