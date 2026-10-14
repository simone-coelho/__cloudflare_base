// public/demo-kit/compare.js: the demo kit's Before / Now compare, its first shared module.
//
// Ported from public/meridian/compare.js (Meridian decision D8; the mechanic is
// the Coach storefront's split-slider, Meridian decision 7). Capture the page
// now, compare it with the page later, in three views of one comparison:
//
//   Seam          the draggable reveal, and the default: the Now frame
//                 underneath (#cmp-after), the Before frame on top
//                 (#cmp-before) clipped to the left of the seam, a divider with
//                 a ↔ handle riding it; the seam follows the pointer anywhere on
//                 the stage, and ← → Home End move it from the keyboard.
//   Side by side  both pages whole, scrolling together.
//   What changed  HTML the host supplies: openCompare(rootEl, { details }),
//                 where details returns HTML. The pixel views answer what the
//                 room saw; this one answers why.
//
// Contract
//   - No DOM or window access at import time. The overlay (ids cmp-back,
//     cmp-stage, cmp-before, cmp-after, cmp-divider, cmp-close, cmp-msg,
//     cmp-mode-seam, cmp-mode-split, cmp-mode-details, cmp-details, cmp-hint)
//     is injected into <body> on first use.
//   - html2canvas is loaded lazily from /html2canvas.min.js (public/, 1.4.1).
//     If it cannot load, the overlay says so: the stage is never blank and no
//     call here rejects for that reason.
//   - Pair with compare.css. Every --cmp-* token has its default there, on the
//     overlay root; a host overrides any of them with one rule on .cmp-back.
//   - THE PRESS IS THE CAPTURE, as an option: armPress(button) starts the Before
//     in the capture phase of the press itself (see armPress below).
//
// What it is, honestly: a PIXEL tool, not a state tool. html2canvas paints what
// the DOM looks like at that instant, so any "this just changed" marker on the
// page is part of the frame, exactly as the room saw it. What a frame IS: the
// WHOLE of rootEl, top to bottom at its own width, never the viewport: a
// rearrangement moves things below the fold, and that has to be in the
// comparison. Both frames are taken from the top, so they register whatever the
// scroll offset was; the live page is never scrolled by this module.
//
// THE CLONE IS THE MOMENT. html2canvas clones the DOM synchronously inside the
// call that starts a render, then renders the clone asynchronously. So a frame
// is the page at its clone, and the page may change the instant after: every
// capture here resolves a `.cloned` promise at that instant (a host can start a
// beat, or put a second shopper's page on screen, without waiting for the
// render), and the frame itself lands when the render and its encoding finish.
//
// Exports
//   configure({ motion, flip, freezeCss, ignore, libUrl, keepFrames })
//   preload()
//   captureBaseline(rootEl, { label, meta, quiet, fresh, renderAfter })  → Promise<{ at, ok, label, meta }>, with .cloned
//   captureFrame(rootEl, { label, meta })            → Promise<frame | null>, with .cloned
//   captureInFlight(), hasBaseline(), baselineInfo()
//   openCompare(rootEl, { title, details, foot, tags, nowLabel, nowMeta, now, sameNote, nearNote, noFrame, waiting, focusY, owner })
//   showWaiting({ title, heading, text, owner }), showMessage({ title, heading, text, hint, owner })   → the request they opened
//   notice(text)
//   armPress(target, { root, label, meta, when })
//   isOpen(owner?), closeCompare(), clearBaseline(), timings()
//
// Who holds the screen. Every call that opens the overlay may name its owner (any string; a host's own Compare
// press, say). isOpen(owner) is true only while the overlay shows that owner's request, so a host can tell its own
// comparison from one another part of the page is taking, and leave that one alone: notice(text) says why on the
// hint line without taking the screen.

const LIB_URL = '/html2canvas.min.js';

/** Stage envelope: min(86vw, 1180px) × min(72vh, 760px). The frame is fitted
    inside it at its own width, so the seam is always over pixels and the tags
    always sit on the frame rather than on a mat. */
const ENVELOPE = { vw: 0.86, maxW: 1180, vh: 0.72, maxH: 760 };
const SEAM_STEP = 2;      // ← / → nudge, in % of the page's width
const SEAM_DEFAULT = 50;  // the seam opens at the middle
/** How long a capture waits for the page to come to rest before it clones the
    DOM (only what configure({ motion, flip }) names is waited for). */
const SETTLE_MAX_MS = 2000;
/** Two frames whose 1/8-scale signatures differ in fewer than this fraction of
    samples differ only in small print: a changed digit in 11px type can vanish
    at that scale. "The same page" is decided byte for byte instead (sameBytes),
    since two renders of an identical DOM encode to identical PNGs. */
const SAME_FRAME_MAX = 0.0005;
const SAMPLE_STEP = 8;    // the signature is the frame at 1/8 scale
/** A signature row counts as a CHANGE when at least this fraction of its
    samples differ: a strip, a hero or a row of cards, not a 1px underline. */
const CHANGE_ROW_MIN = 0.08;
// Past 100% on purpose: magnifying a badge or a price to point at it from the
// front of a room is the whole reason a presenter reaches for zoom.
const ZOOMS = [0.35, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];
/** How long a press keeps answering captureBaseline() calls (armPress). */
const PRESS_TTL_MS = 25000;
/** The longest a cloned frame waits for its host's renderAfter before it renders anyway. */
const RENDER_AFTER_MAX_MS = 90000;
/** Compare with no earlier frame: it says so, and does nothing else. */
const NO_FRAME = { heading: 'No earlier frame yet:', text: 'the first page is still being captured. Act, then Compare.' };
const CLEAR_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The host's settings (configure). */
const cfg = {
  motion: '',       // selector: an element mid-flight (a swap fading out); a capture waits for none to match
  flip: '',         // selector: FLIP targets; one with an inline transform sits at its old place, so a capture waits
  freezeCss: '',    // CSS added to the clone after the freeze below (re-express what the freeze removes)
  ignore: '',       // selector: elements left out of every clone (html2canvas ignoreElements: no box, no layout).
                    // Name the chrome outside rootEl that does not shape its layout (a side panel in a fixed grid
                    // column, fixed bars, closed dialogs): the clone of the whole document is the press's only wait.
  libUrl: LIB_URL,
  keepFrames: 8,    // object URLs kept alive; older ones are revoked unless a view still shows them
};

let baseline = null;   // the Before frame: { url, at, w, h, sig, settled, label, meta, ms }
let pending = null;    // the newest captureBaseline() in flight; a call before its clone joins it
let seq = 0;           // every baseline capture's number; the newest to land is the Before
let landedSeq = 0;
let gen = 0;           // bumped by clearBaseline(): a capture that started before it is discarded
let req = 0;           // bumped by every open and every close: a late result lands only on its own request
let h2c = null;        // html2canvas, once loaded
let ui = null;         // overlay element refs, once injected
let lastRoot = null;   // the rootEl the page last passed in
const urls = [];       // object URLs this module made, oldest first
const log = [];        // the last captures' timings, newest last
const view = {
  seam: SEAM_DEFAULT, open: false, disabled: false, lastFocus: null,
  frameW: 0, frameH: 0, scale: 1, note: '', zoom: null,   // zoom null = fit the envelope
  mode: 'seam',        // 'seam' · 'split' (side by side) · 'details' (what changed)
  tags: { before: 'Before', now: 'Now' }, shown: null, compact: false,
  owner: null,         // who opened what the overlay shows (the owner its call named), or null
  notice: '',          // notice(): a refused press's sentence, on the hint line until the overlay closes
};

// ── Settings ────────────────────────────────────────────────────────────────

/** Host-wide settings. Unknown keys are ignored; returns the settings in force. */
export function configure(opts = {}) {
  for (const k of Object.keys(cfg)) if (opts[k] !== undefined) cfg[k] = opts[k];
  return { ...cfg };
}

// ── html2canvas ─────────────────────────────────────────────────────────────

async function html2canvasLib() {
  if (h2c) return h2c;
  const g = globalThis;
  if (typeof g.html2canvas !== 'function') {
    // The file is a UMD bundle: imported as a module it installs the global.
    await import(cfg.libUrl).catch(() => {});
  }
  if (typeof g.html2canvas !== 'function' && typeof document !== 'undefined') {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = cfg.libUrl; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error('script failed'));
      document.head.appendChild(s);
    }).catch(() => {});
  }
  if (typeof g.html2canvas !== 'function') throw new Error(`html2canvas did not load from ${cfg.libUrl}`);
  return (h2c = g.html2canvas);
}

/** Load html2canvas ahead of the first capture. Resolves true or false; never rejects. */
export function preload() { return html2canvasLib().then(() => true, () => false); }

/** One frame, or a moment if the tab runs no frames (hidden): a capture never hangs on a frame. */
const nextFrame = () => new Promise((r) => {
  let done = false;
  const fin = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(fin); setTimeout(fin, 120);
});

/** Is anything the host named mid-flight? */
function inMotion(rootEl) {
  try {
    if (cfg.motion && rootEl.querySelector(cfg.motion)) return true;
    if (cfg.flip) for (const el of rootEl.querySelectorAll(cfg.flip)) if (el.style.transform) return true;
  } catch { /* a bad selector waits for nothing */ }
  return false;
}

/** Wait, bounded, for the page to come to rest, then one more frame so the last
    class change has painted. Resolves true when it settled, false when it gave up.
    With nothing named to wait for, there is nothing to wait for: the clone reads
    the DOM and its computed styles, not the screen, so a beat that captures its
    Before as it starts is held for the clone alone. */
async function settled(rootEl) {
  if (!cfg.motion && !cfg.flip) return true;
  const t0 = performance.now();
  await nextFrame();
  while (inMotion(rootEl)) {
    if (performance.now() - t0 > SETTLE_MAX_MS) return false;
    await nextFrame();
  }
  await nextFrame();
  return true;
}

/** The clone is frozen at its FINAL, settled state:
      - html2canvas RESTARTS every CSS animation inside its clone, so anything
        that animates in from opacity 0 would be captured at 0. Animations and
        transitions are off, so every element sits at the end of its motion.
      - html2canvas paints EVERY box-shadow as a solid fill over the element
        (Meridian measured both blurred and flat ones flooding a card). Shadows
        are off; a host re-expresses one it needs through configure({ freezeCss }).
    Pseudo-elements cannot be changed here: html2canvas resolves ::before and
    ::after from the ORIGINAL document's computed styles before onclone runs. */
const FREEZE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;box-shadow:none!important;caret-color:transparent!important}';

/** html2canvas 1.4.1 has no object-fit: it stretches every image to its box, so
    a cover crop or a contained phone came out distorted. In the clone, each such
    image keeps its exact box and draws its picture as a background of the same
    fit (html2canvas paints background-size cover and contain faithfully), with a
    clear pixel as the image itself. */
function fitImages(doc, root) {
  const win = doc.defaultView;
  if (!win) return;
  for (const img of root.querySelectorAll('img')) {
    const st = win.getComputedStyle(img);
    const fit = st.objectFit;
    if (!fit || fit === 'fill' || st.display === 'none') continue;
    const src = img.currentSrc || img.src;
    if (!src || src === CLEAR_PIXEL) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const pic = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement : null;
    if (pic) for (const s of [...pic.querySelectorAll('source')]) s.remove();
    img.removeAttribute('srcset'); img.removeAttribute('sizes');
    Object.assign(img.style, {
      width: `${r.width}px`, height: `${r.height}px`, boxSizing: 'border-box', objectFit: 'fill',
      backgroundImage: `url("${src.replace(/["\\]/g, (c) => `\\${c}`)}")`, backgroundRepeat: 'no-repeat',
      backgroundSize: fit === 'cover' ? 'cover' : fit === 'none' ? 'auto' : 'contain',
      backgroundPosition: st.objectPosition || '50% 50%', backgroundOrigin: 'content-box', backgroundClip: 'content-box',
    });
    img.src = CLEAR_PIXEL;
  }
}

/** A cheap signature of a frame: the canvas at 1/SAMPLE_STEP scale. */
function signature(canvas) {
  const sw = Math.max(1, Math.ceil(canvas.width / SAMPLE_STEP));
  const sh = Math.max(1, Math.ceil(canvas.height / SAMPLE_STEP));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(canvas, 0, 0, sw, sh);
  return { w: sw, h: sh, data: g.getImageData(0, 0, sw, sh).data };
}

/** The fraction of signature samples that differ (any channel by more than 16).
    Frames of different sizes are different pages. */
function differing(a, b) {
  if (!a || !b) return 1;
  if (a.w !== b.w || a.h !== b.h) return 1;
  const A = a.data, B = b.data;
  let n = 0;
  for (let i = 0; i < A.length; i += 4) {
    if (Math.abs(A[i] - B[i]) > 16 || Math.abs(A[i + 1] - B[i + 1]) > 16 || Math.abs(A[i + 2] - B[i + 2]) > 16) n += 1;
  }
  return n / (A.length / 4);
}

/** The topmost signature row where two frames visibly differ, in frame pixels:
    where the room should look first. null when nothing differs. */
function firstChangeY(a, b) {
  if (!a || !b) return null;
  if (a.w !== b.w) return 0;
  const A = a.data, B = b.data, rows = Math.min(a.h, b.h);
  let hairline = null;
  for (let y = 0; y < rows; y++) {
    let n = 0;
    for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * 4;
      if (Math.abs(A[i] - B[i]) > 16 || Math.abs(A[i + 1] - B[i + 1]) > 16 || Math.abs(A[i + 2] - B[i + 2]) > 16) n += 1;
    }
    if (n >= a.w * CHANGE_ROW_MIN) return y * SAMPLE_STEP;
    if (n && hairline === null) hairline = y * SAMPLE_STEP;
  }
  if (a.h !== b.h) return hairline === null ? rows * SAMPLE_STEP : Math.min(hairline, rows * SAMPLE_STEP);
  return hairline;
}

/** The frame as a URL (and its PNG). canvas.toBlob encodes asynchronously, so a
    capture taken while a beat runs does not hold the beat's own motion; a data
    URL is the fallback where toBlob is missing. */
function encode(canvas) {
  return new Promise((resolve) => {
    const fallback = () => { try { resolve({ url: canvas.toDataURL('image/png'), blob: null }); } catch { resolve({ url: '', blob: null }); } };
    if (typeof canvas.toBlob !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') { fallback(); return; }
    try {
      canvas.toBlob((blob) => {
        if (!blob) { fallback(); return; }
        const u = URL.createObjectURL(blob);
        keepUrl(u);
        resolve({ url: u, blob });
      }, 'image/png');
    } catch { fallback(); }
  });
}
/** Are two frames the same page, pixel for pixel? PNG encoding is deterministic,
    so two renders of an identical page are identical bytes; a changed digit in a
    receipt is not, even where the 1/8 signature cannot see it. */
async function sameBytes(a, b) {
  if (a.blob && b.blob) {
    if (a.blob.size !== b.blob.size) return false;
    const [x, y] = await Promise.all([a.blob.arrayBuffer(), b.blob.arrayBuffer()]);
    const X = new Uint8Array(x), Y = new Uint8Array(y);
    for (let i = 0; i < X.length; i += 1) if (X[i] !== Y[i]) return false;
    return true;
  }
  return Boolean(a.url) && a.url === b.url;
}
/** Keep the newest object URLs alive; revoke older ones unless the Before or an open view still shows them. */
function keepUrl(u) {
  urls.push(u);
  const live = new Set([baseline && baseline.url, view.shown && view.shown.before, view.shown && view.shown.now].filter(Boolean));
  let excess = urls.length - Math.max(4, Number(cfg.keepFrames) || 8);
  for (let i = 0; i < urls.length && excess > 0;) {
    if (urls[i] !== u && !live.has(urls[i])) { URL.revokeObjectURL(urls[i]); urls.splice(i, 1); excess -= 1; } else i += 1;
  }
}

const opaque = (bg) => (!bg || bg === 'transparent' || /^rgba\((?:\s*0\s*,){3}\s*0\s*\)$/.test(bg)
  ? (getComputedStyle(document.body).backgroundColor || '#ffffff') : bg);

/** Take the WHOLE of rootEl: its content from the top, at its width, as tall as
    its content, never its viewport. Measured causes this guards against (Meridian):
      1. The clone must lay out EXACTLY like the page: the clone's window is the
         real window's size, so every media query matches as it does on screen;
         only a scrolling root is opened up to its content height, inside the clone.
      2. The page must be at rest: what configure({ motion, flip }) names is
         waited for, bounded, before the clone.
      3. The frame is the page at its clone (synchronous, inside the call that
         starts the render); opts.onCloned is told that instant.
    html2canvas measures the clone's own root after onclone, so the frame is as
    tall as the page laid out: whole, never clipped. */
async function capture(rootEl, opts = {}) {
  const t0 = performance.now();
  const lib = await html2canvasLib();
  if (document.fonts && document.fonts.ready) await document.fonts.ready.catch(() => {});
  const rested = await settled(rootEl);
  const cs = getComputedStyle(rootEl);
  const scrolls = /^(auto|scroll|hidden)$/.test(cs.overflowY) && rootEl.scrollHeight > rootEl.clientHeight + 1;
  const scrollTop = rootEl.scrollTop;
  const ignore = cfg.ignore;
  let held = 0;   // how long the clone waited for opts.renderAfter
  const options = {
    useCORS: true, logging: false,
    backgroundColor: opaque(cs.backgroundColor),
    scale: 1,   // a comparison, not a print: 1x is fast on every display, and fast is what keeps a Before honest
    scrollX: 0, scrollY: 0,
    windowWidth: window.innerWidth, windowHeight: window.innerHeight,
    ignoreElements: ignore ? (el) => { try { return el.matches(ignore); } catch { return false; } } : undefined,
    onclone: async (doc, ref) => {
      // opts.renderAfter: the clone is taken; its render (the heavy part, on the main thread) waits until the
      // host says the page is free, bounded. html2canvas waits for onclone before it lays out and draws.
      if (opts.renderAfter) {
        const frame = doc.defaultView && doc.defaultView.frameElement;
        if (frame) frame.style.display = 'none';   // no layout of the waiting clone while the page is busy
        const h0 = performance.now();
        await Promise.race([Promise.resolve().then(opts.renderAfter).catch(() => {}), new Promise((r) => setTimeout(r, RENDER_AFTER_MAX_MS))]);
        held = performance.now() - h0;
        if (frame) frame.style.display = '';
      }
      const st = doc.createElement('style');
      st.textContent = FREEZE_CSS + (cfg.freezeCss || '');
      doc.head.appendChild(st);
      const r = ref || (rootEl.id ? doc.getElementById(rootEl.id) : null);
      if (!r) return;
      if (scrolls) { r.style.height = 'auto'; r.style.maxHeight = 'none'; r.style.overflow = 'visible'; r.scrollTop = 0; }
      // The root's bottom padding is clearance for fixed bars, not page.
      r.style.paddingBottom = '0';
      if (cfg.flip) { try { for (const el of r.querySelectorAll(cfg.flip)) if (el.style.transform) el.style.transform = ''; } catch { /* a bad selector */ } }
      fitImages(doc, r);
      mark('cmp:render:start');   // a profiler can tell the render's main-thread time from the page's own
    },
  };
  const meta = typeof opts.meta === 'function' ? opts.meta() : (opts.meta || null);
  const label = typeof opts.label === 'function' ? opts.label(meta) : (opts.label || '');
  const rendering = lib(rootEl, options);   // the DOM is cloned here, synchronously
  const at = Date.now();
  const t1 = performance.now();
  if (typeof opts.onCloned === 'function') { try { opts.onCloned({ at, label, meta }); } catch { /* the host's own */ } }
  const canvas = await rendering;
  mark('cmp:render:end');
  const t2 = performance.now();
  const sig = signature(canvas);
  const { url, blob } = await encode(canvas);
  if (!url) throw new Error('the frame could not be encoded');
  const t3 = performance.now();
  // wait: from the call to the clone (what a beat waits for) · held: the render waiting for renderAfter ·
  // render and encode: the work itself · total: from the call to the frame ready.
  const ms = { wait: Math.round(t1 - t0), held: Math.round(held), render: Math.round(t2 - t1 - held), encode: Math.round(t3 - t2), total: Math.round(t3 - t0) };
  const frame = { url, blob, at, w: canvas.width, h: canvas.height, sig, settled: rested, label, meta, scrollTop, ms };
  log.push({ kind: opts.kind || 'frame', label, at, w: frame.w, h: frame.h, ...ms });
  if (log.length > 60) log.shift();
  return frame;
}

function assertRoot(el, fn) {
  if (!el || typeof el !== 'object' || typeof el.scrollTop !== 'number') {
    throw new TypeError(`${fn}(rootEl): pass the page element to capture, e.g. document.getElementById('page')`);
  }
}
const mark = (name) => { try { performance.mark(name); } catch { /* no User Timing */ } };
const reason = (err) => (err && err.message) ? err.message : String(err);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const two = (n) => String(n).padStart(2, '0');
/** hh:mm, 24-hour: the time a tag names. */
const clock = (ms) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
function fmtDelta(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 1) return 'the same instant';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}h ${two(m)}m` : m ? `${m}m ${two(r)}s` : `${r}s`) + ' later';
}

// ── Overlay ─────────────────────────────────────────────────────────────────
// One stage, Coach-style: the Now frame underneath, the Before frame on top
// clipped by --cmp-seam, the divider and its ↔ handle at the seam, the tags on
// their side. Frames, divider and tags share one canvas the size of the page as
// displayed, so the seam is the same point of the page at every zoom.

const MARKUP = `
<div class="cmp-box">
  <div class="cmp-bar">
    <h2 class="cmp-title" id="cmp-title">Before and now</h2>
    <div class="cmp-tools">
      <div class="cmp-seg" role="group" aria-label="How to compare">
        <button type="button" class="cmp-btn seg on" id="cmp-mode-seam" aria-pressed="true">Seam</button>
        <button type="button" class="cmp-btn seg" id="cmp-mode-split" aria-pressed="false">Side by side</button>
        <button type="button" class="cmp-btn seg" id="cmp-mode-details" aria-pressed="false" hidden>What changed</button>
      </div>
      <div class="cmp-seg" role="group" aria-label="Zoom">
        <button type="button" class="cmp-btn seg" id="cmp-zoom-out" aria-label="Zoom out">&minus;</button>
        <button type="button" class="cmp-btn seg zoomv" id="cmp-zoom-fit">Fit</button>
        <button type="button" class="cmp-btn seg" id="cmp-zoom-in" aria-label="Zoom in">+</button>
      </div>
      <button type="button" class="cmp-btn" id="cmp-close">Close <kbd>Esc</kbd></button>
    </div>
  </div>
  <div class="cmp-stage" id="cmp-stage" style="--cmp-seam:50%" tabindex="0" role="slider"
       aria-label="Before / Now seam" aria-orientation="horizontal"
       aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
    <div class="cmp-canvas" id="cmp-canvas">
      <div class="cmp-frame cmp-after" id="cmp-after"></div>
      <div class="cmp-frame cmp-before" id="cmp-before"></div>
      <div class="cmp-divider" id="cmp-divider" aria-hidden="true"><span class="cmp-handle">↔</span></div>
      <div class="cmp-tags"><span class="cmp-tag cmp-tag-before" id="cmp-tag-before">Before</span><span class="cmp-tag cmp-tag-now" id="cmp-tag-now">Now</span></div>
    </div>
    <div class="cmp-msg" id="cmp-msg" hidden></div>
  </div>
  <!-- SIDE BY SIDE: the same two frames, whole, scrolling together. The seam is
       the better instrument for "what moved"; this is the better one for "read
       them both". -->
  <div class="cmp-split" id="cmp-split" hidden>
    <div class="cmp-pane" id="cmp-pane-before" tabindex="0"><div class="cmp-pane-tag" id="cmp-pane-tag-before">Before</div><div class="cmp-shot" id="cmp-shot-before"></div></div>
    <div class="cmp-pane" id="cmp-pane-now" tabindex="0"><div class="cmp-pane-tag now" id="cmp-pane-tag-now">Now</div><div class="cmp-shot" id="cmp-shot-now"></div></div>
  </div>
  <!-- WHAT CHANGED: the host's HTML, the decided state behind the two frames. -->
  <div class="cmp-details" id="cmp-details" tabindex="0" hidden></div>
  <p class="cmp-caption" id="cmp-caption" hidden></p>
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
  back.setAttribute('data-html2canvas-ignore', 'true');   // never part of a frame, even when open over the page
  back.innerHTML = MARKUP;
  (document.body || document.documentElement).appendChild(back);
  const $ = (id) => document.getElementById(id);
  ui = {
    back, box: back.querySelector('.cmp-box'), title: $('cmp-title'),
    stage: $('cmp-stage'), canvas: $('cmp-canvas'), before: $('cmp-before'), after: $('cmp-after'),
    divider: $('cmp-divider'), close: $('cmp-close'), msg: $('cmp-msg'), hint: $('cmp-hint'), caption: $('cmp-caption'),
    tagBefore: $('cmp-tag-before'), tagNow: $('cmp-tag-now'),
    split: $('cmp-split'), paneBefore: $('cmp-pane-before'), paneNow: $('cmp-pane-now'),
    paneTagBefore: $('cmp-pane-tag-before'), paneTagNow: $('cmp-pane-tag-now'),
    shotBefore: $('cmp-shot-before'), shotNow: $('cmp-shot-now'), details: $('cmp-details'),
    modeSeam: $('cmp-mode-seam'), modeSplit: $('cmp-mode-split'), modeDetails: $('cmp-mode-details'),
    zoomIn: $('cmp-zoom-in'), zoomOut: $('cmp-zoom-out'), zoomFit: $('cmp-zoom-fit'),
  };
  wire();
  return ui;
}

function wire() {
  const u = ui;
  u.close.addEventListener('click', closeCompare);

  // The whole stage is a drag surface, the Coach mechanic: on pointerdown the
  // seam jumps to the pointer and follows it while dragging. Pointer capture
  // keeps a drag alive past the frame's edge instead of dropping it.
  let dragging = false;
  const seamAt = (e) => {
    const r = u.canvas.getBoundingClientRect();
    return r.width ? ((e.clientX - r.left) / r.width) * 100 : SEAM_DEFAULT;
  };
  u.stage.addEventListener('pointerdown', (e) => {
    if (view.disabled || view.mode !== 'seam') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    if (u.stage.setPointerCapture) { try { u.stage.setPointerCapture(e.pointerId); } catch { /* optional: the drag still works inside the stage */ } }
    setSeam(seamAt(e)); e.preventDefault();
    u.stage.focus({ preventScroll: true });
  });
  u.stage.addEventListener('pointermove', (e) => { if (dragging) setSeam(seamAt(e)); });
  const end = () => { dragging = false; };
  u.stage.addEventListener('pointerup', end);
  u.stage.addEventListener('pointercancel', end);

  u.modeSeam.addEventListener('click', () => setMode('seam'));
  u.modeSplit.addEventListener('click', () => setMode('split'));
  u.modeDetails.addEventListener('click', () => setMode('details'));
  u.zoomIn.addEventListener('click', () => stepZoom(1));
  u.zoomOut.addEventListener('click', () => stepZoom(-1));
  u.zoomFit.addEventListener('click', () => setZoom(view.zoom == null ? 1 : null));

  // THEY SCROLL TOGETHER, or the comparison is worthless: the same band of the
  // page has to be under both eyes at once.
  let syncing = false;
  const tie = (from, to) => from.addEventListener('scroll', () => {
    if (syncing) return; syncing = true;
    to.scrollTop = from.scrollTop; to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => { syncing = false; });
  });
  tie(u.paneBefore, u.paneNow); tie(u.paneNow, u.paneBefore);

  // Keys from inside the dialog stop here: the page's own shortcuts must not fire underneath a modal.
  u.back.addEventListener('keydown', onDialogKey);
}

/** The seam position, in % of the page's width, clamped 0–100: Before to its
    left, Now to its right. Drives the clip on #cmp-before and the divider. */
function setSeam(pct) {
  pct = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : SEAM_DEFAULT));
  view.seam = pct;
  ui.stage.style.setProperty('--cmp-seam', `${pct.toFixed(3)}%`);
  ui.stage.setAttribute('aria-valuenow', String(Math.round(pct)));
  ui.stage.setAttribute('aria-valuetext', `${view.tags.before} ${Math.round(pct)}%, ${view.tags.now} ${Math.round(100 - pct)}%`);
}

const seamHint = () => `Drag the seam · ${view.tags.before} to its left, ${view.tags.now} to its right · scroll for the rest of the page · ← → nudge · Home / End to the edges`;
const SPLIT_HINT = 'Both pages, whole · they scroll together · ± to zoom · Seam goes back to the draggable reveal';
const DETAILS_HINT = 'What changed: the decided state behind the two frames · Seam and Side by side are one press away';
const hintFor = (mode) => (mode === 'split' ? SPLIT_HINT : mode === 'details' ? DETAILS_HINT : seamHint());
/** The hint line: a diagnostic about the frames first (it is why the two sides look alike), then a notice (a press
    that was refused, and why), then the instructions `text`. */
function paintHint(text) {
  const t = view.note || view.notice || text || '';
  ui.hint.textContent = t;
  ui.hint.classList.toggle('warn', !!view.note);
  ui.hint.classList.toggle('notice', !view.note && !!view.notice);
  ui.hint.hidden = !t;
}

/** The height the views may take: the window, less the box's margin, its bar, its sentence and its hint. */
function availH() {
  const bar = ui.box.querySelector('.cmp-bar');
  const chrome = (bar ? bar.offsetHeight : 0) + (ui.caption.hidden ? 0 : ui.caption.offsetHeight) + (ui.hint.hidden ? 0 : ui.hint.offsetHeight);
  return Math.max(160, window.innerHeight - 56 - chrome - 2);
}

function fit() {
  if (!ui) return;
  if (view.mode === 'details') { fitDetails(); syncTools(); return; }
  const split = view.mode === 'split';
  // Two pages need the width of two pages. The box grows for this mode only.
  const maxW = split ? Math.min(window.innerWidth * 0.96, 1960) : Math.min(window.innerWidth * ENVELOPE.vw, ENVELOPE.maxW);
  const maxH = Math.min(split ? Math.min(window.innerHeight * 0.82, 900) : Math.min(window.innerHeight * ENVELOPE.vh, ENVELOPE.maxH), availH());
  if (split) { fitSplit(maxW, maxH); return; }
  if (!(view.frameW > 0 && view.frameH > 0)) {
    // A message, not a frame: a calm box, not a full envelope of mat.
    const w = view.compact ? Math.min(maxW, 820) : maxW, h = view.compact ? Math.min(maxH, 380) : maxH;
    ui.stage.style.width = `${Math.round(w)}px`; ui.stage.style.height = `${Math.round(h)}px`;
    ui.stage.style.overflowX = 'hidden';
    syncTools(); return;
  }
  // Fit the WIDTH; the frames are full-page tall and scroll inside the stage,
  // so what changed below the fold is in the comparison, not cropped out.
  const s = view.zoom != null ? view.zoom : Math.min(1, maxW / view.frameW);
  view.scale = s;
  const w = view.frameW * s, contentH = view.frameH * s;
  const stageW = Math.min(w, maxW);
  ui.stage.style.width = `${Math.round(stageW)}px`;
  ui.stage.style.height = `${Math.round(Math.min(maxH, contentH))}px`;
  // Zoomed past the stage, the page pans instead of being cropped.
  ui.stage.style.overflowX = w > stageW + 1 ? 'auto' : 'hidden';
  ui.canvas.style.width = `${Math.round(w)}px`;
  ui.canvas.style.height = `${Math.round(contentH)}px`;
  for (const el of [ui.before, ui.after]) el.style.backgroundSize = `${Math.round(w)}px auto`;
  syncTools();
}

/** Side by side: two panes of equal width, each holding a whole page. */
function fitSplit(maxW, maxH) {
  const gap = 18;
  const paneW = Math.floor((maxW - gap) / 2);
  const s = view.zoom != null ? view.zoom : Math.min(1, paneW / (view.frameW || 1));
  view.scale = s;
  ui.split.style.width = `${Math.round(maxW)}px`;
  ui.split.style.height = `${Math.round(maxH)}px`;
  for (const el of [ui.paneBefore, ui.paneNow]) { el.style.width = `${paneW}px`; el.style.height = `${Math.round(maxH)}px`; }
  for (const el of [ui.shotBefore, ui.shotNow]) {
    el.style.width = `${Math.round(view.frameW * s)}px`;
    el.style.height = `${Math.round(view.frameH * s)}px`;
    el.style.backgroundSize = `${Math.round(view.frameW * s)}px auto`;
  }
  syncTools();
}

/** What changed: the host's HTML in a box the size of the envelope, scrolling inside. */
function fitDetails() {
  ui.details.style.width = `${Math.round(Math.min(window.innerWidth * 0.94, 1320))}px`;
  ui.details.style.maxHeight = `${Math.round(Math.min(window.innerHeight * 0.74, 860, availH()))}px`;
}

/** The tools show the state they are in: no guessing which view is live. */
function syncTools() {
  if (!ui) return;
  const m = view.mode;
  for (const [btn, on] of [[ui.modeSeam, m === 'seam'], [ui.modeSplit, m === 'split'], [ui.modeDetails, m === 'details']]) {
    btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on));
    btn.disabled = view.disabled;
  }
  const zoomable = !view.disabled && m !== 'details';
  for (const b of [ui.zoomIn, ui.zoomOut, ui.zoomFit]) b.disabled = !zoomable;
  ui.zoomFit.textContent = view.zoom == null ? 'Fit' : `${Math.round(view.scale * 100)}%`;
  ui.zoomFit.classList.toggle('on', view.zoom != null);
  ui.stage.classList.toggle('still', view.disabled);
}

/** Switch how the comparison is shown. The captures do not change. */
function setMode(mode) {
  if (!ui || view.disabled) return;
  if (mode === 'details' && ui.modeDetails.hidden) mode = 'seam';
  view.mode = mode === 'split' || mode === 'details' ? mode : 'seam';
  ui.stage.hidden = view.mode !== 'seam';
  ui.split.hidden = view.mode !== 'split';
  ui.details.hidden = view.mode !== 'details';
  paintHint(hintFor(view.mode));
  fit();
  ({ seam: ui.stage, split: ui.paneNow, details: ui.details })[view.mode].focus?.({ preventScroll: true });
}

/** Zoom, the way the composer does it: presets, and ± walks them. */
function setZoom(z) { if (!ui) return; view.zoom = z; fit(); }
function stepZoom(dir) {
  const cur = view.zoom != null ? view.zoom : view.scale;
  const i = ZOOMS.findIndex((z) => z > cur + 0.001);
  const next = dir > 0
    ? (i === -1 ? ZOOMS[ZOOMS.length - 1] : ZOOMS[i])
    : ([...ZOOMS].reverse().find((z) => z < cur - 0.001) ?? ZOOMS[0]);
  setZoom(next);
}

/** Every control a keyboard can reach inside the box, in order. */
function focusables() {
  return [...ui.box.querySelectorAll('button, [tabindex="0"]')].filter((el) => !el.disabled && !el.hidden && !el.closest('[hidden]')
    && el.getClientRects().length > 0);
}

function onDialogKey(e) {
  if (!view.open) return;
  e.stopPropagation();
  if (e.key === 'Tab') {
    const f = focusables();
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    let next = null;
    if (i === -1) next = f[0];
    else if (!e.shiftKey && i === f.length - 1) next = f[0];
    else if (e.shiftKey && i === 0) next = f[f.length - 1];
    if (next) { e.preventDefault(); next.focus({ preventScroll: true }); }
    return;
  }
  if (view.disabled || view.mode !== 'seam') return;
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
    const a = document.activeElement;
    view.lastFocus = a && ui.back.contains(a) ? view.lastFocus : a;
    document.addEventListener('keydown', onDocKey, true);
    window.addEventListener('resize', fit);
  }
  view.open = true;
  ui.back.classList.add('open');
  fit();
  if (focusEl) focusEl.focus({ preventScroll: true });
}

function setTitle(title) { ensureOverlay().title.textContent = title || 'Before and now'; }

const tagHtml = (word, f) => `${esc(word)}<span>· ${esc(clock(f.at))}${f.label ? ` · ${esc(f.label)}` : ''}</span>`;

function showFrames(before, now, o) {
  const u = ensureOverlay();
  view.zoom = null;                    // every comparison opens fitted
  view.note = o.note || '';
  view.owner = o.owner || null;
  view.compact = false;
  view.tags = { before: (o.tags && o.tags.before) || 'Before', now: (o.tags && o.tags.now) || 'Now' };
  // Full-page frames legitimately differ in height (a rearrangement makes the
  // page taller). Both are anchored at the top; nothing is stretched to fit.
  view.frameW = now.w; view.frameH = Math.max(now.h, before.h);
  view.disabled = false;
  view.shown = { before: before.url, now: now.url };
  u.msg.hidden = true; u.msg.className = 'cmp-msg';
  u.canvas.hidden = false;
  u.before.style.backgroundImage = `url("${before.url}")`;
  u.after.style.backgroundImage = `url("${now.url}")`;
  u.shotBefore.style.backgroundImage = `url("${before.url}")`;
  u.shotNow.style.backgroundImage = `url("${now.url}")`;
  u.tagBefore.innerHTML = tagHtml(view.tags.before, before);
  u.tagNow.innerHTML = tagHtml(view.tags.now, now);
  u.paneTagBefore.innerHTML = tagHtml(view.tags.before, before);
  u.paneTagNow.innerHTML = tagHtml(view.tags.now, now);
  u.stage.setAttribute('aria-label', `${view.tags.before} / ${view.tags.now} seam`);
  const hasDetails = typeof o.details === 'string';
  u.details.innerHTML = hasDetails ? o.details : '';
  u.modeDetails.hidden = !hasDetails;
  u.caption.textContent = o.foot || '';
  u.caption.hidden = !o.foot;
  // The foot is laid out before the views are sized: they take the height that is left.
  paintHint(seamHint());
  u.stage.tabIndex = 0;
  view.mode = 'seam';                  // and on the seam, the mode the comparison is built around
  u.stage.hidden = false; u.split.hidden = true; u.details.hidden = true;
  setSeam(SEAM_DEFAULT);
  open(u.stage);
  // THE CHANGE MUST BE IN VIEW. The stage opens on the top of a full-page
  // frame; when the first pixel that differs sits below its fold, the room
  // reads two identical tops and calls it the same image. So the stage is
  // scrolled to put the first change a third of the way down, and the hint says so.
  let scrolled = 0;
  u.stage.scrollTop = 0;
  if ((!view.note || o.near) && o.changeY != null) {
    const y = o.changeY * view.scale, h = u.stage.clientHeight;
    if (h > 0 && y > h * 0.6) { scrolled = Math.round(Math.max(0, y - h * 0.3)); u.stage.scrollTop = scrolled; }
  }
  if (scrolled && !view.note && !view.notice) {
    u.hint.textContent = `Scrolled to the first change, ${Math.round(o.changeY)}px down the page · ${seamHint()}`;
    fit();                             // a longer hint takes height from the stage, not from the box's margin
  }
}

/** The overlay on a message instead of frames: nothing to drag, nothing else. */
function showNote({ title, heading, text, hint, wait, owner }) {
  const u = ensureOverlay();
  if (title) setTitle(title);
  view.note = ''; view.frameW = 0; view.frameH = 0; view.zoom = null;
  view.disabled = true; view.compact = true; view.shown = null;
  view.mode = 'seam';
  view.owner = owner || null;
  u.stage.hidden = false; u.split.hidden = true; u.details.hidden = true;
  u.canvas.hidden = true;
  u.before.style.backgroundImage = ''; u.after.style.backgroundImage = '';
  u.shotBefore.style.backgroundImage = ''; u.shotNow.style.backgroundImage = '';
  u.modeDetails.hidden = true; u.caption.hidden = true;
  u.msg.className = wait ? 'cmp-msg wait' : 'cmp-msg';
  u.msg.innerHTML = `<b>${esc(heading || '')}</b>${text ? ` ${esc(text)}` : ''}`;
  u.msg.hidden = false;
  u.stage.tabIndex = -1;
  paintHint(hint);
  open(u.close);
}

/** Never a blank stage: when html2canvas is missing or a render fails, the
    overlay opens on a message that says exactly that. */
function showFailure(title, detail, owner) {
  showNote({ heading: title, text: detail, hint: 'Nothing to drag: see the message above.', owner });
}

/** Open the overlay on a message while something is being prepared (a second
    shopper's page, a press still landing). openCompare replaces it. Returns the
    request it opened; owner names who holds the screen (isOpen(owner)). */
export function showWaiting({ title, heading, text, owner } = {}) {
  req += 1;
  showNote({ title, heading: heading || 'One moment', text: text || '', hint: 'One moment.', wait: true, owner });
  return req;
}

/** Open the overlay on a message, and nothing else. Returns the request it opened. */
export function showMessage({ title, heading, text, hint, owner } = {}) {
  req += 1;
  showNote({ title, heading, text, hint, owner });
  return req;
}

/** One sentence on the hint line of whatever the overlay shows, without taking the screen: a press that was refused
    says why there (Compare pressed while another comparison is being taken). It stays until the overlay closes; a
    diagnostic about the frames still comes first. Returns false when the overlay is not open. */
export function notice(text) {
  if (!ui || !view.open) return false;
  view.notice = String(text || '');
  paintHint(ui.hint.textContent);
  fit();                               // the line may be taller: the views take the height that is left
  return true;
}

// ── The press is the capture (armPress) ─────────────────────────────────────
// A Before is the page as it was WHEN THE BUTTON WAS PRESSED. A host whose click
// handler waits for anything before it calls captureBaseline() lets a gated act
// run first, and the Before is then taken AFTER the change: the same image
// twice (Meridian measured it, its fourth report). armPress closes that: the
// click starts the capture itself, in the capture phase of the event, before the
// host's handler runs, so captureInFlight() is true from that instant, and the
// handler's later captureBaseline() receives this capture rather than a second one.
const armed = [];
let pressListening = false;
let pressed = null;      // { root, at, gen, promise }: the capture the press itself started

function onPress(e) {
  const t = e.target;
  for (const { target, opts } of armed) {
    let btn = null;
    if (typeof target === 'string') btn = t && typeof t.closest === 'function' ? t.closest(target) : null;
    else if (target && typeof target.contains === 'function' && target.contains(t)) btn = target;
    if (!btn || btn.disabled || btn.classList.contains('cmp-busy')) continue;
    if (typeof opts.when === 'function' && !opts.when()) continue;
    const root = typeof opts.root === 'function' ? opts.root() : (opts.root || lastRoot);
    if (!root || typeof root.scrollTop !== 'number') continue;
    lastRoot = root;
    btn.classList.add('cmp-busy');
    const promise = startCapture(root, { label: opts.label, meta: opts.meta, quiet: false });
    pressed = { root, at: Date.now(), gen, promise };
    promise.finally(() => btn.classList.remove('cmp-busy'));
    return;
  }
}

/** Arm a Capture button (an element, or a selector matched on every press):
    its click starts the Before in the capture phase, before the host's handler.
    opts: root (element or function), label and meta (as captureBaseline), when
    (a function: false lets the press through untouched). Returns a disarm function. */
export function armPress(target, opts = {}) {
  if (typeof document === 'undefined' || !target) return () => {};
  const entry = { target, opts };
  armed.push(entry);
  if (!pressListening) { pressListening = true; document.addEventListener('click', onPress, true); }
  return () => { const i = armed.indexOf(entry); if (i >= 0) armed.splice(i, 1); };
}

/** One Before at a time: a call before the newest capture has cloned joins it
    (it will be the page as it is now); a call after starts a new one, and the
    newest to land is the Before. A capture that started before clearBaseline()
    is discarded when it lands. */
function startCapture(rootEl, opts = {}) {
  if (pending && !pending.isCloned && pending.root === rootEl) return pending;
  const mySeq = ++seq, myGen = gen;
  let markCloned = () => {};
  const cloned = new Promise((r) => { markCloned = r; });
  const p = (async () => {
    try {
      const frame = await capture(rootEl, { ...opts, kind: 'baseline', onCloned: (c) => { p.isCloned = true; markCloned(c); } });
      if (myGen !== gen) return { at: frame.at, ok: false, error: 'cleared while capturing' };
      if (mySeq > landedSeq) { landedSeq = mySeq; baseline = frame; }
      return { at: frame.at, ok: true, label: frame.label, meta: frame.meta };
    } catch (err) {
      if (myGen === gen && !opts.quiet) showFailure('Nothing was captured', `Compare could not take a Before: ${reason(err)}`);
      return { at: Date.now(), ok: false, error: reason(err) };
    } finally {
      markCloned(null);   // a no-op once the clone was reported
      if (pending === p) pending = null;
    }
  })();
  p.cloned = cloned; p.root = rootEl; p.isCloned = false;
  pending = p;
  return p;
}

// ── API ─────────────────────────────────────────────────────────────────────

/** True while a Before capture is in flight. */
export function captureInFlight() { return !!pending; }

/** Capture rootEl, the whole page from the top, as the Before frame.
    opts.label: text for the tag ("homepage · Shopper A"), or a function of meta;
    opts.meta: anything the host keeps with the frame (or a function, called at
    the clone); opts.quiet: no overlay on a failure (an automatic capture);
    opts.fresh: the page as it is now, even if an armed Capture was just pressed;
    opts.renderAfter: a function returning a promise; the clone is taken now and
    its render waits for that promise (bounded), so a capture taken as a beat
    starts costs the beat only its clone. Compare waits for a Before still rendering.
    Resolves { at, ok, label, meta } or { at, ok:false, error }; never rejects.
    The promise carries .cloned, which resolves at the clone. Without fresh, if an
    armed Capture button was just pressed, this resolves to THAT capture. */
export function captureBaseline(rootEl, opts = {}) {
  assertRoot(rootEl, 'captureBaseline');
  lastRoot = rootEl;
  const p = pressed;
  if (!opts.fresh && p && p.root === rootEl && p.gen === gen && Date.now() - p.at < PRESS_TTL_MS) return p.promise;
  if (p) pressed = null;   // stale, wrong root, cleared-over or overtaken: a fresh capture, and the press stops answering
  return startCapture(rootEl, opts);
}

/** Capture rootEl as a frame that is NOT the Before: a second shopper's page,
    for openCompare(rootEl, { now }). Resolves the frame, or null when it could
    not be taken; never rejects. The promise carries .cloned. */
export function captureFrame(rootEl, opts = {}) {
  assertRoot(rootEl, 'captureFrame');
  let markCloned = () => {};
  const cloned = new Promise((r) => { markCloned = r; });
  const p = capture(rootEl, { ...opts, kind: opts.kind || 'frame', onCloned: (c) => markCloned(c) })
    .catch(() => null)
    .then((f) => { markCloned(null); return f; });
  p.cloned = cloned;
  return p;
}

export function hasBaseline() { return baseline !== null; }

/** What the Before is: { at, label, meta, w, h }, or null. */
export function baselineInfo() {
  return baseline ? { at: baseline.at, label: baseline.label, meta: baseline.meta, w: baseline.w, h: baseline.h } : null;
}

/** Open the comparison of the Before with Now, on the Seam (at 50%).
    A Before still being taken is waited for, on screen, even when it is the
    first: a capture that has cloned but not yet rendered is a Before. Only when
    no Before is captured AND none is being captured does it open on
    opts.noFrame (default: "No earlier frame yet: the first page is still being
    captured. Act, then Compare.") and nothing else. Now is captured from rootEl
    unless opts.now supplies it (a frame from captureFrame, or a promise of one).
      opts.title     the bar's title
      opts.tags      { before, now }: the words on the two tags ("Before", "Now")
      opts.nowLabel  the Now tag's label (or a function of opts.nowMeta)
      opts.nowMeta   what to keep with the Now frame (or a function, called at its clone)
      opts.details   HTML, or a function (before, now) returning HTML, each
                     { at, label, meta } of its frame: the What changed view
      opts.foot      a sentence under the views, or a function (before, now) returning
                     one, each { at, label, meta } of its frame (so the sentence can be
                     true of the two frames it sits under: one page, or two)
      opts.sameNote  what to say when the two frames are the same page, pixel for pixel
      opts.nearNote  what to say when they differ only in small print (a score, a time)
      opts.waiting   what the box says while Now is being taken
      opts.owner     who holds the screen while this comparison is up (isOpen(owner))
    Resolves { before, now, beforeAt, nowAt } with the two frame URLs, or
    { ..., error } after opening the overlay on the message; never rejects. */
export async function openCompare(rootEl, opts = {}) {
  assertRoot(rootEl, 'openCompare');
  lastRoot = rootEl;
  ensureOverlay();
  const title = opts.title || 'Before and now';
  const owner = opts.owner;
  if (!baseline && pending) {
    // The first Before has cloned and is still rendering (a tool that took it an instant ago, or the first
    // decided paint's): join it, on screen, rather than say there is no earlier frame.
    showWaiting({ title, heading: 'Taking the Before frame', text: '', owner });
    const w = req;
    let landed = null;
    while (!baseline && pending) landed = await pending;   // a newer capture may have started meanwhile
    if (w !== req) return { stale: true };
    if (!baseline && landed && !landed.ok && landed.error !== 'cleared while capturing') {
      showFailure('Nothing to compare', `Compare could not take the Before: ${landed.error}`, owner);
      return { before: null, now: null, beforeAt: null, nowAt: null, error: landed.error };
    }
  }
  if (!baseline) {
    const nf = opts.noFrame || NO_FRAME;
    showMessage({ title, heading: nf.heading, text: nf.text, owner });
    return { before: null, now: null, beforeAt: null, nowAt: null, error: 'no earlier frame' };
  }
  showWaiting({ title, heading: opts.waiting || 'Taking the Now frame', text: '', owner });
  const my = req;
  try {
    if (pending) await pending;
    if (my !== req) return { stale: true };
    const before = baseline;
    const now = opts.now !== undefined
      ? await opts.now
      : await capture(rootEl, { kind: 'now', label: opts.nowLabel, meta: opts.nowMeta });
    if (my !== req) return { stale: true };
    if (!now) throw new Error('the second frame could not be taken');
    const changeY = opts.focusY != null ? opts.focusY : firstChangeY(before.sig, now.sig);
    let note = '', near = false;
    if (now.w !== before.w) note = 'The window was resized since the Before; the frames may not register.';
    else if (await sameBytes(before, now)) {
      note = opts.sameNote || `Nothing on the page has changed since the Before (${fmtDelta(now.at - before.at)}): this is the page against itself.`;
    } else if (differing(before.sig, now.sig) < SAME_FRAME_MAX) {
      near = true;
      note = opts.nearNote || `Only small print has changed since the Before (${fmtDelta(now.at - before.at)}): zoom in to read it.`;
    } else if (!now.settled) note = 'The page was still moving when the Now frame was taken; compare again once it has settled.';
    if (my !== req) return { stale: true };
    let details = null;
    const info = (f) => ({ at: f.at, label: f.label, meta: f.meta });
    if (typeof opts.details === 'function') {
      try { details = String(opts.details(info(before), info(now)) ?? ''); } catch (err) { details = `<p>${esc(`What changed could not be read: ${reason(err)}`)}</p>`; }
    } else if (typeof opts.details === 'string') details = opts.details;
    let foot = opts.foot;
    if (typeof foot === 'function') { try { foot = String(foot(info(before), info(now)) ?? ''); } catch { foot = ''; } }
    showFrames(before, now, { note, near, changeY, details, foot, tags: opts.tags, owner });
    return { before: before.url, now: now.url, beforeAt: before.at, nowAt: now.at };
  } catch (err) {
    if (my === req) showFailure('Nothing to compare', `Compare could not capture the page: ${reason(err)}`, owner);
    return { before: baseline ? baseline.url : null, now: null, beforeAt: baseline ? baseline.at : null, nowAt: null, error: reason(err) };
  }
}

/** Is the overlay up? With an owner: is it up on that owner's request (nobody else has taken the screen since)? */
export function isOpen(owner) { return owner === undefined ? view.open : view.open && view.owner === owner; }

/** Drop the Before frame (and close the overlay if it is up). A capture still in
    flight lands on the floor, not on the next visitor. */
export function clearBaseline() {
  gen += 1;
  baseline = null; pressed = null;
  closeCompare();
  if (ui) { ui.before.style.backgroundImage = ''; ui.after.style.backgroundImage = ''; }
}

export function closeCompare() {
  req += 1;
  if (!ui || !view.open) return;
  view.open = false;
  view.shown = null;
  view.owner = null; view.notice = '';
  ui.back.classList.remove('open');
  document.removeEventListener('keydown', onDocKey, true);
  window.removeEventListener('resize', fit);
  const lf = view.lastFocus; view.lastFocus = null;
  if (lf && lf !== document.body && lf.isConnected !== false && typeof lf.focus === 'function') lf.focus({ preventScroll: true });
}

/** The last captures, newest last: { kind, label, at, w, h, wait, held, render, encode, total } in ms. */
export function timings() { return log.map((x) => ({ ...x })); }
