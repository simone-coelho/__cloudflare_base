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

// rec=hero: record the #hero title sequence from document-start, so a DURING-LOAD flash
// (e.g. "The Tabby Shop" → "The Summer Edit") is captured even though the screenshot settles after it.
const REC_SCRIPT = `window.__herolog=[];(function(){var last=null,t0=Date.now();var iv=setInterval(function(){var el=document.querySelector('#hero-content .hero-title');var t=el?(el.textContent||'').trim():'';if(t!==last){window.__herolog.push({ms:Date.now()-t0,title:t||'(empty)'});last=t;}},16);setTimeout(function(){clearInterval(iv);},9000);})();`;

shot.get('/', async (c) => {
  if (!c.env.BROWSER) return c.json({ ok: false, error: 'Browser Rendering not bound' }, 503);
  const q = c.req.query();
  const url = new URL(q.path || '/storefront', c.req.url); // same-origin only
  const w = Math.min(2000, parseInt(q.w || '1440', 10) || 1440);
  const h = Math.min(4000, parseInt(q.h || '1600', 10) || 1600);
  const wait = Math.min(8000, parseInt(q.wait || '1400', 10) || 1400);
  const clicks = (q.clicks || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rec = q.rec || '';
  let browser: any;
  try {
    browser = await puppeteer.launch(c.env.BROWSER as any);
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    if (rec) { try { await page.evaluateOnNewDocument(REC_SCRIPT); } catch (e) { /* recorder optional */ } }
    await page.goto(url.toString(), { waitUntil: 'networkidle0', timeout: 30000 });
    await sleep(wait);
    for (const sel of clicks) {
      try { await page.click(sel); await sleep(wait); } catch { /* selector may be absent in this state */ }
    }
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
    if (browser) try { await browser.close(); } catch { /* ignore */ }
  }
});

export { shot as shotRoutes };
