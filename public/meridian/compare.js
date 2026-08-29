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
//   - THE PRESS IS THE CAPTURE. On first use this module listens (capture
//     phase) for clicks on #btn-capture and starts the baseline capture in the
//     same task as the press, so captureInFlight() is true from that instant
//     and the page's own captureBaseline() call receives that capture. See
//     armPress() for the failure this closes.
//
// What it is, honestly: a PIXEL tool, not a state tool. html2canvas paints what
// the DOM looks like at that instant, so any "this just changed" marker on the
// page at capture time — a .card.changed outline, a .zone pulse, a moved-card
// delta chip — is part of the frame, exactly as the room saw it. There is no
// "clean" capture: take the baseline BEFORE triggering the change if a clean
// Before is wanted.
//
// What a frame IS: the whole page (rootEl's content, top to bottom, at the
// page's own width), never the viewport — a rearrangement moves things below
// the fold, and that is exactly what has to be in the comparison. Both frames
// are taken from the top, so they register at the top whatever the page's
// scroll offset was when either button was pressed; the live page is never
// scrolled by this module.
//
// Exports: captureBaseline(rootEl), captureInFlight(), hasBaseline(),
//          openCompare(rootEl), clearBaseline(), closeCompare()

const LIB_URL = '/html2canvas.min.js';

/** Stage envelope: min(86vw, 1180px) × min(72vh, 760px). The frame is fitted
    inside it at its own aspect ratio, so the seam is always over pixels and the
    tags always sit on the frame rather than on a mat. */
const ENVELOPE = { vw: 0.86, maxW: 1180, vh: 0.72, maxH: 760 };
const SEAM_STEP = 2;      // ← / → nudge, in % of the stage width
const SEAM_DEFAULT = 50;  // the seam opens at the middle

/** How long a capture will wait for the page to come to rest before it clones
    the DOM. Everything the page does to itself is shorter: the hero fades out
    for 300ms before its content is replaced, a section FLIP holds its inverted
    transform for two frames before it is released, a card FLIP the same. */
const SETTLE_MAX_MS = 2000;
/** Elements the page FLIPs with an inline transform (layout.js paintLayout,
    meridian.js flipRow). While the inline transform is set they are sitting at
    their OLD position; once released (transform '') the transition carries them
    and the clone — transitions off — sees them at their final place. */
const FLIP_TARGETS = '[data-section],[data-follows],.card';
/** Two frames whose downsampled pixels differ in fewer than this fraction of
    samples are the same page. Anti-aliasing noise between two renders of an
    identical DOM is zero (same rasteriser, same input); a single changed word
    is well above this. */
const SAME_FRAME_MAX = 0.0005;
const SAMPLE_STEP = 8;    // the signature is the frame at 1/8 scale

let baseline = null;   // { url, at, scrollTop, w, h, sig, settled, clipped } — the Before frame
let pending = null;    // the captureBaseline() in flight, if any — a second press joins it
let gen = 0;           // bumped by clearBaseline(): a capture that started before it is discarded
let h2c = null;        // html2canvas, once loaded
let ui = null;         // overlay element refs, once injected
const view = { seam: SEAM_DEFAULT, open: false, disabled: false, lastFocus: null, frameW: 0, frameH: 0, scale: 1, note: '' };

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

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** Is anything inside rootEl mid-flight? A .swapping element is fading out and
    its content has NOT been replaced yet (meridian.js swap(): the render runs
    at 300ms) — a clone taken now shows either the old content or, with the
    fade frozen, nothing at all. A FLIP target with an inline transform is
    sitting at its old position. */
function inMotion(rootEl) {
  if (rootEl.querySelector('.swapping')) return true;
  for (const el of rootEl.querySelectorAll(FLIP_TARGETS)) if (el.style.transform) return true;
  return false;
}

/** Wait — bounded — for the page to come to rest, then one more frame so the
    last class change has painted. Resolves true when it settled, false when it
    gave up (the clone still freezes what is there at its final state). */
async function settled(rootEl) {
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
        that animates in from opacity 0 would be captured at 0 (the hero came
        out blank in the Now frame after an email). Animations and transitions
        are off, so every element sits at the end of its motion.
      - html2canvas paints EVERY box-shadow as a solid fill over the element,
        blurred or flat, spread or not (both were tried; both flooded the card).
        Shadows are off. The hero's step-coloured drop shadow is re-expressed as
        a band of the same colour along the bottom of the hero — a background
        gradient, so the hero keeps its exact height and the frame its exact
        length (a border did neither: it made the clone 12px taller than the
        page, which the canvas then clipped off the bottom). A highlighted card
        keeps its coloured 2px edge (the page's own rule); the 3px ring around
        it was a shadow.
      - A .swapping element that is still on the page when the wait gave up is
        shown rather than hidden.
    Pseudo-elements cannot be added here: html2canvas resolves ::before/::after
    from the ORIGINAL document's computed styles before onclone runs. */
const FREEZE_CSS =
  '*,*::before,*::after{animation:none!important;transition:none!important;box-shadow:none!important}'
  + '.swapping{opacity:1!important}'
  + '#hero.landed{background:linear-gradient(to top,var(--hl) 0,var(--hl) 12px,#fff 12px)!important}'
  + '#row .card.changed{border-color:var(--hl)!important}';

/** A cheap signature of a frame: the canvas at 1/SAMPLE_STEP scale. Two frames
    of the same page compare equal on it; any visible change does not. */
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

/** A signature row counts as a CHANGE when at least this fraction of its
    samples differ. The first differing row on the handoff beat was the 1px
    underline under the department that had just been clicked — true, and not
    where the room should be sent; a strip, a hero or a row of cards is. */
const CHANGE_ROW_MIN = 0.08;

/** The topmost signature row where two frames visibly differ, in frame pixels
    — where the room should look first: the first row with a real change, or,
    when every difference is hairline, the first differing row. null when
    nothing differs. Frames of different widths are different pages (0); a
    taller frame differs from the row where the shorter one ends. */
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

/** Take the WHOLE page: rootEl's content from the top, at rootEl's width, as
    tall as its content — NOT its viewport, and NOT its bottom clearance padding
    (the director bar's --dir-h, which changes as the bar re-flows and would make
    two frames of the same page different heights).

    Root causes this guards against, each measured before it was fixed:
      1. The clone must lay out EXACTLY like the page. html2canvas builds its
         clone inside an iframe sized windowWidth × windowHeight; v1 passed
         windowHeight = the page's full scrollHeight, so the clone's viewport was
         1351px tall where the real one was 800, meridian.css's
         @media (max-height:860px) / (max-height:820px) compact rules stopped
         matching inside the clone, and every section laid out taller (hero
         176 → 314px, row 475 → 676px, page 1202 → 1579px). The canvas, sized to
         the REAL scrollHeight, then cut the bottom 230px off — block_a mid-card
         in Before, the moved-down hero partly or wholly gone in Now — and what
         did fit was a layout the room never saw. The iframe is now the real
         window's size; only the clone's root is expanded to the content height.
      2. The page must be at rest. Compare pressed within 300ms of the OK on
         the band found the hero .swapping — opacity 0 on the page, frozen at 0
         in the clone — and the Now frame had a blank white box where the change
         was. capture() waits (bounded) for the swap and any FLIP to finish.
      3. The frame must be the page as it is now, not as it was cloned: the
         DOM is cloned synchronously at the html2canvas call, so everything
         after the wait is one snapshot.
    If the clone still comes out taller than the page (a rule this module does
    not know about), the frame is retaken at the clone's height rather than
    clipped: a frame is whole or it is not a frame. */
async function capture(rootEl) {
  const lib = await html2canvasLib();
  if (document.fonts && document.fonts.ready) await document.fonts.ready.catch(() => {});
  const rested = await settled(rootEl);
  const scrollTop = rootEl.scrollTop;
  const cs = getComputedStyle(rootEl);
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const w = rootEl.clientWidth;
  let h = Math.max(1, Math.ceil(rootEl.scrollHeight - padBottom));
  const rootId = rootEl.id;
  const render = async (height) => {
    let cloneH = 0;
    const canvas = await lib(rootEl, {
      useCORS: true, logging: false,
      backgroundColor: cs.backgroundColor,
      scale: 1,   // a comparison, not a print: 1x is fast on every display, and fast is what keeps Before honest
      width: w, height, scrollX: 0, scrollY: 0,
      windowWidth: window.innerWidth, windowHeight: window.innerHeight,
      onclone: (doc) => {
        const st = doc.createElement('style');
        st.textContent = FREEZE_CSS;
        doc.head.appendChild(st);
        const r = rootId ? doc.getElementById(rootId) : null;
        if (!r) return;
        r.style.height = `${height}px`; r.style.maxHeight = 'none'; r.style.overflow = 'visible';
        r.style.paddingBottom = '0'; r.scrollTop = 0;
        // A FLIP caught inside its two-frame inversion window: the clone shows
        // the element where it is going, not where it was.
        for (const el of r.querySelectorAll(FLIP_TARGETS)) if (el.style.transform) el.style.transform = '';
        cloneH = r.scrollHeight;
      },
    });
    return { canvas, cloneH };
  };
  let { canvas, cloneH } = await render(h);
  let clipped = false;
  if (cloneH > h + 2) {
    // The clone laid out taller than the page after all: retake it whole.
    h = cloneH;
    ({ canvas, cloneH } = await render(h));
    clipped = cloneH > h + 2;
  }
  return { url: canvas.toDataURL('image/png'), at: Date.now(), scrollTop, w, h, sig: signature(canvas), settled: rested, clipped };
}

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

const HINT = 'Drag the seam · Before to its left, Now to its right · scroll for the rest of the page · ← → nudge · Home / End to the edges';

function fit() {
  if (!ui) return;
  const maxW = Math.min(window.innerWidth * ENVELOPE.vw, ENVELOPE.maxW);
  const maxH = Math.min(window.innerHeight * ENVELOPE.vh, ENVELOPE.maxH);
  let w = maxW, h = maxH;
  let contentH = h, s = 1;
  if (view.frameW > 0 && view.frameH > 0) {
    // Fit the WIDTH; the frames are full-page tall and scroll inside the stage,
    // so what changed below the fold is in the comparison, not cropped out.
    s = Math.min(1, maxW / view.frameW);              // never upscale — pixels stay pixels
    w = view.frameW * s; contentH = view.frameH * s; h = Math.min(maxH, contentH);
  }
  view.scale = s;
  ui.stage.style.width = `${Math.round(w)}px`;
  ui.stage.style.height = `${Math.round(h)}px`;
  for (const el of [ui.before, ui.after, ui.divider]) el.style.height = `${Math.round(contentH)}px`;
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

function showFrames(before, now, note, changeY = null) {
  const u = ensureOverlay();
  view.note = note || '';
  // Full-page frames legitimately differ in height (a rearrangement makes the
  // page taller). Both are anchored at the top inside the taller box; nothing
  // is stretched to fit.
  view.frameW = now.w; view.frameH = Math.max(now.h, before.h);
  view.disabled = false;
  u.msg.hidden = true;
  u.before.hidden = false; u.after.hidden = false; u.divider.hidden = false;
  u.tagBefore.hidden = false; u.tagNow.hidden = false;
  u.before.style.backgroundImage = `url("${before.url}")`;
  u.after.style.backgroundImage = `url("${now.url}")`;
  u.tagBefore.innerHTML = `Before<span>· ${fmtTime(before.at)}</span>`;
  u.tagNow.innerHTML = `Now<span>· ${fmtTime(now.at)} · ${fmtDelta(now.at - before.at)}</span>`;
  u.stage.tabIndex = 0;
  setSeam(SEAM_DEFAULT);   // the seam opens at the middle — Before left, Now right
  open(u.stage);
  // THE CHANGE MUST BE IN VIEW. The stage opens on the top of a full-page
  // frame; when the first pixel that differs sits below its fold — the handoff
  // beat: a reflex card and two strips above the row put the changed cards on
  // the bottom edge of a 576px stage at 1440×800 — the room reads two identical
  // tops and calls it the same image. So the stage is scrolled to put the first
  // change a third of the way down, and the hint says so.
  let scrolled = 0;
  u.stage.scrollTop = 0;
  if (!view.note && changeY != null) {
    const y = changeY * view.scale, h = u.stage.clientHeight;
    if (h > 0 && y > h * 0.6) { scrolled = Math.round(Math.max(0, y - h * 0.3)); u.stage.scrollTop = scrolled; }
  }
  u.hint.textContent = view.note
    || (scrolled ? `Scrolled to the first change, ${Math.round(changeY)}px down the page · ${HINT}` : HINT);
  u.hint.classList.toggle('warn', !!view.note);
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
  u.hint.classList.remove('warn');
  open(u.close);
}

// ── The press is the capture ────────────────────────────────────────────────
// A baseline is the page as it was WHEN CAPTURE WAS PRESSED. The page's click
// handler (meridian.js) waits for the page to settle BEFORE it calls
// captureBaseline() — up to 1.6s after the last paint, up to 5s while a beat is
// running. During that wait nothing here was in flight, so every gate that asks
// captureInFlight() — the band's OK, browse(), gateThen() — let the next act run
// first, and the baseline was taken AFTER the change: the same image twice.
// Measured, the fourth report: Capture 300ms after a beat's paint, Next 800ms
// later, OK 1.5s after that → the baseline landed 5.4s after the press on the
// changed page, byte-identical to Now. Capture pressed while the band was open,
// OK 2.5s later → the same.
//
// So the click on the Capture button starts the capture ITSELF, in the capture
// phase of the event, before the page's handler runs: `pending` is set in the
// same task as the press, every gate sees it from that instant, and the page's
// later captureBaseline() call receives this capture instead of taking a second
// one. The listener is installed on the first call into this module (the page
// asks captureInFlight() from its first gated act, long before any press) and
// does nothing on a page without the button.
const CAPTURE_BUTTON = '#btn-capture';   // compare.css already knows this id (.busy)
/** How long a press keeps answering captureBaseline() calls. TWO callers claim
    one press — the button's own handler (after a settle wait of up to ~15s)
    and performBeat's automatic pre-beat capture — so the claim is IDEMPOTENT:
    consuming it on the first claim let the second caller take a fresh frame of
    a page that had changed by then, which is the clobber this whole block
    exists to prevent. While a press is fresh it outranks the automatic
    refresh; the TTL outlives the longest settle wait and no more. */
const PRESS_TTL_MS = 25000;
let pressed = null;       // { root, at, gen, promise } — the capture the press itself started
let lastRoot = null;      // the rootEl the page last passed in
let pressArmed = false;

function armPress() {
  if (pressArmed || typeof document === 'undefined') return;
  pressArmed = true;
  document.addEventListener('click', (e) => {
    const t = e.target;
    const btn = t && typeof t.closest === 'function' ? t.closest(CAPTURE_BUTTON) : null;
    if (!btn || btn.disabled || btn.classList.contains('busy')) return;
    const root = lastRoot && lastRoot.isConnected ? lastRoot : document.getElementById('page');
    if (!root || typeof root.scrollTop !== 'number') return;
    pressed = { root, at: Date.now(), gen, promise: startCapture(root) };
  }, true);
}

/** One capture at a time: a call while one is rendering joins it. A capture
    that started before clearBaseline() is discarded when it lands. */
function startCapture(rootEl) {
  if (pending) return pending;
  const myGen = gen;
  pending = (async () => {
    try {
      const frame = await capture(rootEl);
      if (myGen !== gen) return { at: frame.at, ok: false, error: 'cleared while capturing' };
      baseline = frame;
      return { at: frame.at, ok: true, scrollTop: frame.scrollTop };
    } catch (err) {
      if (myGen === gen) {
        baseline = null;
        showFailure('Nothing was captured', `Compare could not take a baseline: ${reason(err)}`);
      }
      return { at: Date.now(), ok: false, error: reason(err) };
    } finally {
      pending = null;
    }
  })();
  return pending;
}

// ── API ─────────────────────────────────────────────────────────────────────

/** True while a baseline capture is in flight — the page must not change until it is done. */
export function captureInFlight() { armPress(); return !!pending; }

/** Capture rootEl — the whole page, from the top — as the Before frame.
    Resolves { at, ok, scrollTop } — or { at, ok:false, error } after opening the
    overlay on the failure message. Never rejects for a capture failure.
    If the Capture button was just pressed, this resolves to THAT capture — the
    page at the press — rather than taking another one now; otherwise one
    capture at a time: a call while one is still rendering joins it. */
export async function captureBaseline(rootEl) {
  assertRoot(rootEl, 'captureBaseline');
  lastRoot = rootEl; armPress();
  const p = pressed;
  if (p && p.root === rootEl && p.gen === gen && Date.now() - p.at < PRESS_TTL_MS) return p.promise;
  if (p) pressed = null;   // stale, wrong root, or cleared-over: a fresh capture, and the press stops answering
  return startCapture(rootEl);
}

export function hasBaseline() { armPress(); return baseline !== null; }

/** Re-capture rootEl (the whole page, from the top) and open the overlay,
    Before vs Now behind the seam (at 50%). A Capture still in flight is waited
    for — it is the Before. Without a baseline it captures one first and says
    so (the page against itself); with a baseline the page has not moved from,
    it says that too. Resolves { before, now, beforeAt, nowAt, scrollTop } with
    the two data URLs — or { …, now:null, error } after opening the overlay on
    the failure message. */
export async function openCompare(rootEl, opts = {}) {
  assertRoot(rootEl, 'openCompare');
  lastRoot = rootEl; armPress();
  let note = '';
  try {
    if (pending) await pending;
    if (!baseline) {
      baseline = await capture(rootEl);
      note = 'No baseline had been captured, so this is the page against itself. Press Capture, wait for "Baseline captured", change something, then compare.';
    }
    const now = await capture(rootEl);
    // A caller that KNOWS what moved (a rearranged section) names the Y to open
    // at; the pixel heuristic is the fallback.
    const changeY = opts.focusY != null ? opts.focusY : firstChangeY(baseline.sig, now.sig);
    if (!note && now.w !== baseline.w) {
      note = 'The window was resized since the baseline; the frames may not register.';
    }
    if (!note && differing(baseline.sig, now.sig) < SAME_FRAME_MAX) {
      note = `Nothing on the page has changed since the baseline (${fmtDelta(now.at - baseline.at)}) — this is the page against itself.`;
    }
    if (!note && !now.settled) {
      note = 'The page was still moving when the Now frame was taken; compare again once it has settled.';
    }
    if (!note && (baseline.clipped || now.clipped)) {
      note = 'A frame laid out taller than the page and may be cut off at the bottom.';
    }
    showFrames(baseline, now, note, changeY);
    return { before: baseline.url, now: now.url, beforeAt: baseline.at, nowAt: now.at, scrollTop: baseline.scrollTop };
  } catch (err) {
    showFailure('Nothing to compare', `Compare could not capture the page: ${reason(err)}`);
    return {
      before: baseline ? baseline.url : null, now: null,
      beforeAt: baseline ? baseline.at : null, nowAt: null, error: reason(err),
    };
  }
}

/** Drop the Before frame (and close the overlay if it is up). A capture still
    in flight — pressed or called — lands on the floor, not on the next visitor. */
export function clearBaseline() {
  gen += 1;
  baseline = null; pressed = null;
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
