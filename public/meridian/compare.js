// compare.js — Before / Now compare (decision D8; mechanic per decision 7 = the
// Coach demo's split-slider, ported from public/storefront.html/.js): capture the
// page now, compare it with the page later behind a draggable seam. The Now frame
// sits underneath (#cmp-after); the Before frame sits on top (#cmp-before),
// clipped to the left of the seam; a divider with a ↔ handle rides the seam and
// the seam follows the pointer anywhere on the stage.
//
// Contract
//   - No imports from meridian.js. No DOM or window access at import time: the
//     overlay (ids cmp-back, cmp-stage, cmp-before, cmp-after, cmp-divider,
//     cmp-close) is injected into <body> on first use.
//   - html2canvas is served at /html2canvas.min.js (public/html2canvas.min.js,
//     1.4.1) and loaded lazily. If it cannot load, the overlay says so — the
//     stage is never blank and no call here rejects for that reason.
//   - Pair with compare.css (linked after meridian.css; it reads its tokens).
//
// What it is, honestly: a PIXEL tool, not a state tool. html2canvas paints what
// the DOM looks like at that instant, so any "this just changed" marker on the
// page at capture time — a .card.moved outline, a .zone pulse, a moved-card
// delta chip — is part of the frame, exactly as the room saw it. There is no
// "clean" capture: take the baseline BEFORE triggering the change if a clean
// Before is wanted.
//
// Exports: captureBaseline(rootEl), hasBaseline(), openCompare(rootEl),
//          clearBaseline(), closeCompare()

const LIB_URL = '/html2canvas.min.js';

/** Stage envelope: min(86vw, 1180px) × min(72vh, 760px). The frame is fitted
    inside it at its own aspect ratio, so the seam is always over pixels and the
    tags always sit on the frame rather than on a mat. */
const ENVELOPE = { vw: 0.86, maxW: 1180, vh: 0.72, maxH: 760 };
const SEAM_STEP = 2;      // ← / → nudge, in % of the stage width
const SEAM_DEFAULT = 50;  // the seam opens at the middle

let baseline = null;   // { url, at, scrollTop, w, h } — the Before frame
let h2c = null;        // html2canvas, once loaded
let ui = null;         // overlay element refs, once injected
const view = { seam: SEAM_DEFAULT, open: false, disabled: false, lastFocus: null, frameW: 0, frameH: 0, note: '' };

// ── html2canvas ─────────────────────────────────────────────────────────────

async function html2canvasLib() {
  if (h2c) return h2c;
  const g = globalThis;
  if (typeof g.html2canvas !== 'function') {
    // The file is a UMD bundle: imported as a module it installs the global.
    const url = LIB_URL;
    await import(url).catch(() => {});
  }
  if (typeof g.html2canvas !== 'function' && typeof document !== 'undefined') {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = LIB_URL; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error('script failed'));
      document.head.appendChild(s);
    }).catch(() => {});
  }
  if (typeof g.html2canvas !== 'function') {
    throw new Error(`html2canvas did not load from ${LIB_URL}`);
  }
  return (h2c = g.html2canvas);
}

/** The scroll position is pinned WITH the shot. Two captures taken at different
    offsets do not register: the frames would compare two different regions of
    the page and the seam would show a shift, not a change. openCompare()
    scrolls the root back to the baseline's offset before taking the Now frame.

    html2canvas 1.4.1 restores every scrolled element's offset inside its clone
    (DocumentCloner.scrolledElements), so the visible window is captured as-is;
    width/height = clientWidth/clientHeight crop the scrollbar gutter. v1 also
    passed y:scrollTop / scrollY:-scrollTop — with the clone already scrolled that
    double-compensates and shifts the frame up by scrollTop at any non-zero
    offset (it was a no-op at 0, which is where it was rehearsed), so it is gone. */
async function capture(rootEl) {
  const lib = await html2canvasLib();
  if (document.fonts && document.fonts.ready) await document.fonts.ready.catch(() => {});
  const scrollTop = rootEl.scrollTop;
  const w = rootEl.clientWidth, h = rootEl.clientHeight;
  const canvas = await lib(rootEl, {
    useCORS: true, logging: false,
    backgroundColor: getComputedStyle(rootEl).backgroundColor,
    scale: Math.min(2, window.devicePixelRatio || 1),
    width: w, height: h,
    // html2canvas RESTARTS every CSS animation inside its clone, so anything
    // that animates in from opacity 0 is captured at 0 — the hero came out
    // blank in the Now frame after an email. Freeze the clone at its final,
    // settled state instead.
    onclone: (doc) => {
      const st = doc.createElement('style');
      // Box-shadows too: html2canvas paints a large blurred shadow as a solid
      // fill over the element's interior (the hero came out as a red block).
      // Borders still paint, so highlighted cards keep their coloured edge.
      st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;box-shadow:none!important}';
      doc.head.appendChild(st);
    },
  });
  return { url: canvas.toDataURL('image/png'), at: Date.now(), scrollTop, w, h };
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
async function settle() { await nextFrame(); await nextFrame(); }

function assertRoot(el, fn) {
  if (!el || typeof el !== 'object' || typeof el.scrollTop !== 'number') {
    throw new TypeError(`${fn}(rootEl): pass the scrolling page element, e.g. document.getElementById('page')`);
  }
}
const reason = (err) => (err && err.message) ? err.message : String(err);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const two = (n) => String(n).padStart(2, '0');
const fmtTime = (ms) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };
function fmtDelta(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 1) return 'same instant';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}h ${two(m)}m` : m ? `${m}m ${two(r)}s` : `${r}s`) + ' later';
}

// ── Overlay ─────────────────────────────────────────────────────────────────
// One stage, Coach-style (storefront.html #cmp-stage): the Now frame underneath,
// the Before frame on top clipped by --cmp-seam, the divider + ↔ handle at the
// seam, and the tags pinned to their side of the stage.

const MARKUP = `
<div class="cmp-box">
  <div class="cmp-bar">
    <h2 class="cmp-title" id="cmp-title">Before and now</h2>
    <button type="button" class="cmp-btn" id="cmp-close">Close <kbd>Esc</kbd></button>
  </div>
  <div class="cmp-stage" id="cmp-stage" style="--cmp-seam:50%" tabindex="0" role="slider"
       aria-label="Before / Now seam" aria-orientation="horizontal"
       aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
    <div class="cmp-frame cmp-after" id="cmp-after"></div>
    <div class="cmp-frame cmp-before" id="cmp-before"></div>
    <div class="cmp-divider" id="cmp-divider" aria-hidden="true"><span class="cmp-handle">↔</span></div>
    <span class="cmp-tag cmp-tag-before" id="cmp-tag-before">Before</span>
    <span class="cmp-tag cmp-tag-now" id="cmp-tag-now">Now</span>
    <div class="cmp-msg" id="cmp-msg" hidden></div>
  </div>
  <div class="cmp-hint" id="cmp-hint" aria-live="polite"></div>
</div>`;

function ensureOverlay() {
  if (ui) return ui;
  const back = document.createElement('div');
  back.id = 'cmp-back'; back.className = 'cmp-back';
  back.setAttribute('role', 'dialog');
  back.setAttribute('aria-modal', 'true');
  back.setAttribute('aria-labelledby', 'cmp-title');
  back.setAttribute('tabindex', '-1');   // a click on the scrim keeps focus inside the dialog
  back.innerHTML = MARKUP;
  (document.body || document.documentElement).appendChild(back);
  const $ = (id) => document.getElementById(id);
  ui = {
    back, stage: $('cmp-stage'), before: $('cmp-before'), after: $('cmp-after'),
    divider: $('cmp-divider'), close: $('cmp-close'), msg: $('cmp-msg'), hint: $('cmp-hint'),
    tagBefore: $('cmp-tag-before'), tagNow: $('cmp-tag-now'),
  };
  wire();
  return ui;
}

function wire() {
  const u = ui;
  u.close.addEventListener('click', closeCompare);

  // The whole stage is a drag surface — the Coach mechanic: on pointerdown the
  // seam jumps to the pointer's x as a % of the stage width and follows it while
  // dragging. Pointer capture keeps a drag alive past the frame's edge instead
  // of dropping it — or, worse, closing.
  let dragging = false;
  const seamAt = (e) => {
    const r = u.stage.getBoundingClientRect();
    return r.width ? ((e.clientX - r.left) / r.width) * 100 : SEAM_DEFAULT;
  };
  u.stage.addEventListener('pointerdown', (e) => {
    if (view.disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    if (u.stage.setPointerCapture) { try { u.stage.setPointerCapture(e.pointerId); } catch {} }
    setSeam(seamAt(e)); e.preventDefault();
  });
  u.stage.addEventListener('pointermove', (e) => { if (dragging) setSeam(seamAt(e)); });
  const end = () => { dragging = false; };
  u.stage.addEventListener('pointerup', end);
  u.stage.addEventListener('pointercancel', end);

  // Keys from inside the dialog stop here: the page's own shortcuts (director
  // beats on the arrows, 'd', space) must not fire underneath a modal.
  u.back.addEventListener('keydown', onDialogKey);
}

/** The seam position, in % of the stage width, clamped 0–100: Before to its
    left, Now to its right. Drives the clip on #cmp-before
    (inset(0 calc(100% - seam) 0 0)) and the divider's left edge. */
function setSeam(pct) {
  pct = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : SEAM_DEFAULT));
  view.seam = pct;
  ui.stage.style.setProperty('--cmp-seam', `${pct.toFixed(3)}%`);
  ui.stage.setAttribute('aria-valuenow', String(Math.round(pct)));
  ui.stage.setAttribute('aria-valuetext', `Before ${Math.round(pct)}%, now ${Math.round(100 - pct)}%`);
}

const HINT = 'Drag the seam · Before to its left, Now to its right · ← → nudge · Home / End to the edges';

function fit() {
  if (!ui) return;
  const maxW = Math.min(window.innerWidth * ENVELOPE.vw, ENVELOPE.maxW);
  const maxH = Math.min(window.innerHeight * ENVELOPE.vh, ENVELOPE.maxH);
  let w = maxW, h = maxH;
  if (view.frameW > 0 && view.frameH > 0) {
    const s = Math.min(maxW / view.frameW, maxH / view.frameH);
    w = view.frameW * s; h = view.frameH * s;
  }
  ui.stage.style.width = `${Math.round(w)}px`;
  ui.stage.style.height = `${Math.round(h)}px`;
}

function onDialogKey(e) {
  if (!view.open) return;
  const u = ui;
  e.stopPropagation();
  if (e.key === 'Tab') {
    // DOM order: Close (in the bar), then the stage. Native Tab walks the middle;
    // the trap only catches the ends so focus cycles inside the dialog.
    const f = view.disabled ? [u.close] : [u.close, u.stage];
    const i = f.indexOf(document.activeElement);
    let next = null;
    if (i === -1) next = f[0];
    else if (!e.shiftKey && i === f.length - 1) next = f[0];
    else if (e.shiftKey && i === 0) next = f[f.length - 1];
    if (next) { e.preventDefault(); next.focus({ preventScroll: true }); }
    return;
  }
  if (view.disabled) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    setSeam(view.seam + (e.key === 'ArrowLeft' ? -SEAM_STEP : SEAM_STEP));
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    setSeam(e.key === 'Home' ? 0 : 100);
  }
}

// Escape closes from anywhere, even if focus has wandered out of the dialog.
function onDocKey(e) {
  if (!view.open || e.key !== 'Escape') return;
  e.preventDefault(); e.stopPropagation();
  closeCompare();
}

function open(focusEl) {
  if (!view.open) {
    view.lastFocus = document.activeElement;
    document.addEventListener('keydown', onDocKey, true);
    window.addEventListener('resize', fit);
  }
  view.open = true;
  ui.back.classList.add('open');
  fit();
  if (focusEl) focusEl.focus({ preventScroll: true });
}

function showFrames(before, now, note) {
  const u = ensureOverlay();
  view.note = note || '';
  view.frameW = now.w; view.frameH = now.h;
  view.disabled = false;
  u.msg.hidden = true;
  u.before.hidden = false; u.after.hidden = false; u.divider.hidden = false;
  u.tagBefore.hidden = false; u.tagNow.hidden = false;
  u.before.style.backgroundImage = `url("${before.url}")`;
  u.after.style.backgroundImage = `url("${now.url}")`;
  u.tagBefore.innerHTML = `Before<span>· ${fmtTime(before.at)}</span>`;
  u.tagNow.innerHTML = `Now<span>· ${fmtTime(now.at)} · ${fmtDelta(now.at - before.at)}</span>`;
  u.stage.tabIndex = 0;
  u.hint.textContent = view.note || HINT;
  setSeam(SEAM_DEFAULT);   // the seam opens at the middle — Before left, Now right
  open(u.stage);
}

/** Never a blank stage: when html2canvas is missing or a render fails, the
    overlay opens on a message that says exactly that. */
function showFailure(title, detail) {
  const u = ensureOverlay();
  view.note = '';
  view.frameW = 0; view.frameH = 0;
  view.disabled = true;
  u.before.hidden = true; u.after.hidden = true; u.divider.hidden = true;
  u.tagBefore.hidden = true; u.tagNow.hidden = true;
  u.before.style.backgroundImage = ''; u.after.style.backgroundImage = '';
  u.msg.innerHTML = `<b>${esc(title)}</b>${esc(detail)}`;
  u.msg.hidden = false;
  u.stage.tabIndex = -1;
  u.hint.textContent = 'Nothing to drag — see the message above.';
  open(u.close);
}

// ── API ─────────────────────────────────────────────────────────────────────

/** Capture rootEl as the Before frame, pinned to its current scrollTop.
    Resolves { at, ok, scrollTop } — or { at, ok:false, error } after opening the
    overlay on the failure message. Never rejects for a capture failure. */
export async function captureBaseline(rootEl) {
  assertRoot(rootEl, 'captureBaseline');
  try {
    baseline = await capture(rootEl);
    return { at: baseline.at, ok: true, scrollTop: baseline.scrollTop };
  } catch (err) {
    baseline = null;
    showFailure('Nothing was captured', `Compare could not take a baseline: ${reason(err)}`);
    return { at: Date.now(), ok: false, error: reason(err) };
  }
}

export function hasBaseline() { return baseline !== null; }

/** Re-capture rootEl at the baseline's scrollTop and open the overlay, Before vs
    Now behind the seam (at 50%). Without a baseline it captures one first and
    says so (the page against itself). Resolves { before, now, beforeAt, nowAt,
    scrollTop } with the two data URLs — or { …, now:null, error } after opening
    the overlay on the failure message. */
export async function openCompare(rootEl) {
  assertRoot(rootEl, 'openCompare');
  let note = '';
  try {
    if (!baseline) {
      baseline = await capture(rootEl);
      note = 'No baseline had been captured, so this is the page against itself. Capture, change something, then compare.';
    }
    // Register the two frames: same offset, and let layout settle before the shot.
    rootEl.scrollTop = baseline.scrollTop;
    await settle();
    const now = await capture(rootEl);
    if (!note && now.scrollTop !== baseline.scrollTop) {
      note = `The page could not return to the baseline offset (${baseline.scrollTop}px, now ${now.scrollTop}px); the frames may not register.`;
    }
    if (!note && (now.w !== baseline.w || now.h !== baseline.h)) {
      note = 'The window was resized since the baseline; the frames may not register.';
    }
    showFrames(baseline, now, note);
    return { before: baseline.url, now: now.url, beforeAt: baseline.at, nowAt: now.at, scrollTop: baseline.scrollTop };
  } catch (err) {
    showFailure('Nothing to compare', `Compare could not capture the page: ${reason(err)}`);
    return {
      before: baseline ? baseline.url : null, now: null,
      beforeAt: baseline ? baseline.at : null, nowAt: null, error: reason(err),
    };
  }
}

/** Drop the Before frame (and close the overlay if it is up). */
export function clearBaseline() {
  baseline = null;
  if (ui) { ui.before.style.backgroundImage = ''; ui.after.style.backgroundImage = ''; }
  closeCompare();
}

export function closeCompare() {
  if (!ui || !view.open) return;
  view.open = false;
  ui.back.classList.remove('open');
  document.removeEventListener('keydown', onDocKey, true);
  window.removeEventListener('resize', fit);
  const lf = view.lastFocus; view.lastFocus = null;
  if (lf && lf !== document.body && lf.isConnected !== false && typeof lf.focus === 'function') {
    lf.focus({ preventScroll: true });
  }
}
