# Before / Now compare

A browser component that shows a page before a change and after it: behind a draggable seam (drag
left and right to reveal one page under the other), or side by side with both pages scrolling
together. Full page, not the viewport. Zoom to point at a detail. A locator that scrolls the view to
the first row of pixels that changed. Honest messages when nothing changed, when the page was still
moving, or when a capture failed.

It was built for a live demo, where a presenter freezes the page, performs a change, and shows the
room exactly what moved. It is the same mechanic an experimentation product needs to show a control
next to a variant.

**Three files, no server, no framework.**

| File | What it is |
|---|---|
| `compare.js` | The component, an ES module. About 40 KB unminified, no imports |
| `compare.css` | Its stylesheet. Reads the host page's colour and font tokens when present, carries its own defaults |
| `vendor/html2canvas.min.js` | html2canvas 1.4.1, MIT, the one dependency. Paints the DOM into a canvas |
| `example/index.html` | A working page: capture, change, compare. Open it from any static server |

---

## 1 · How it captures, and how it makes sure Before is before

**Capture is a photograph of the DOM, taken in the browser.** html2canvas clones the document into a
hidden iframe the size of the real window, lays the clone out, and paints it onto a canvas. The
component calls it on one element, the page's scrolling root, expanded in the clone to its full content
height, so the frame is the whole page from the top at the page's own width. The canvas becomes a PNG
data URL held in memory. Nothing is uploaded; nothing touches a server; no screenshot service, no
headless browser, no Playwright.

**What makes the photograph faithful**, each of these learned from a wrong frame:

- The clone's iframe is the real window's size, so the page's media queries match inside the clone
  exactly as on screen. Only the root element is expanded to content height.
- Animations, transitions and box shadows are switched off inside the clone. html2canvas restarts
  animations in its clone (a fade-in would be captured at zero) and paints every shadow as a solid fill.
  Hosts that need a shadow's meaning re-express it as a background band through `freezeCss`.
- The capture waits, bounded, for the page to come to rest: while a configured element carries an
  inline transform (a FLIP animation in flight) or a configured "swapping" class (content fading out
  before it is replaced), the capture waits up to `settleMaxMs`, then one more frame so the last
  class change has painted. A page still moving when the wait gives up is captured anyway and the
  overlay says so.
- Fonts are awaited (`document.fonts.ready`) before the clone.
- If the clone lays out taller than the page (a rule the module does not know about), the frame is
  retaken at the clone's height rather than clipped. A frame is whole or it is not a frame.
- A frame is taken at scale 1. It is a comparison, not a print, and fast is what keeps Before honest.

**Before is before because the press is the capture.** The trap, measured before it was closed: a
page's click handler waits for the page to settle before it asks for a baseline; during that wait the
next change runs; the baseline lands after the change, byte-identical to Now. So the module listens
for clicks on the capture button in the event's capture phase and starts the baseline capture in the
same task as the press. From that instant `captureInFlight()` is true, and anything on the page that
gates a change on it (the example's change button does not, a real page should) holds until the
baseline lands. The page's own later `captureBaseline()` call receives that same capture rather than
taking a second one. A press keeps answering for 25 seconds, longer than any settle wait.

**Now is now.** `openCompare()` waits for any capture in flight, takes a fresh frame after the page
settles, and opens the overlay. Both tags carry their capture time and the delta between them.

**Same page, said plainly.** Each frame carries a signature, the canvas at one eighth scale. If fewer
than 0.05% of samples differ, the overlay says nothing has changed since the baseline and shows the
page against itself rather than pretending. If the window was resized between captures, it says the
frames may not register. The signature also drives the locator: the first signature row where at
least 8% of samples differ is where the stage scrolls to, so a change below the fold is in view when
the overlay opens (a caller that knows where the change is can pass `focusY` instead).

---

## 2 · Integration, in five steps

1. Serve the three files from your CDN. Keep `vendor/html2canvas.min.js` on the same origin as the
   page or on an origin your script-src allows.
2. Link the stylesheet after your own: `<link rel="stylesheet" href="/compare.css">`. It reads
   `--paper`, `--p-bg`, `--p-text`, `--p-dim`, `--p-line`, `--p-blue`, `--serif`, `--sans` from the
   page when they exist; otherwise its own light palette.
3. Give the page a scrolling root element with an id, holding everything that should be in the frame:
   `<div id="page" style="height:100vh;overflow:auto">…</div>`. The frame is this element's content.
   It must be the element that scrolls, not `body`, so the module can read its scroll offset and
   content height.
4. Two buttons, and one call:

```html
<button id="btn-capture" class="cmp-capture">Capture baseline</button>
<button id="btn-compare">Compare</button>
<script type="module">
  import { configure, attach } from '/compare.js';
  configure({ libUrl: '/vendor/html2canvas.min.js', rootId: 'page', flipTargets: '.card' });
  attach({ root: '#page', captureButton: '#btn-capture', compareButton: '#btn-compare' });
</script>
```

5. Gate your own changes on `captureInFlight()` if a change can fire within a second of a capture
   press (a keyboard shortcut, an automatic step): `while (captureInFlight()) await sleep(50)`.

The example does exactly this and nothing else.

### The API

| Call | What it does |
|---|---|
| `configure(options)` | Sets `libUrl`, `captureButton`, `rootId`, `flipTargets`, `swappingClass`, `freezeCss`, `settleMaxMs`. Returns the effective configuration |
| `attach({ root, captureButton, compareButton, onCaptured, onCompared })` | Wires the two buttons to the root. Returns a detach function |
| `captureBaseline(rootEl)` | Takes the Before frame. Resolves `{ at, ok, scrollTop }`, or `{ at, ok:false, error }` after opening the overlay on the failure. Never rejects for a capture failure |
| `captureInFlight()` | True while a baseline is being taken |
| `hasBaseline()` | Whether a Before frame is held |
| `openCompare(rootEl, { focusY? })` | Takes the Now frame and opens the overlay. Resolves `{ before, now, beforeAt, nowAt, scrollTop }` with the two data URLs, or `{ …, now:null, error }` |
| `clearBaseline()` | Drops the Before frame and closes the overlay. A capture in flight is discarded when it lands |
| `closeCompare()` | Closes the overlay, returns focus to where it was |

### Inside the overlay

Drag anywhere on the stage to move the seam; the seam jumps to the pointer and follows it, with
pointer capture so a drag past the edge does not drop. Left and right arrow nudge by 2%; Home and End
go to the edges; Escape closes from anywhere. "Side by side" shows both whole pages in two panes that
scroll together. Plus and minus walk zoom presets from 35% to 200%; "Fit" returns to fitting the
window. Tab cycles inside the dialog. The stage is a `role="slider"` with `aria-valuenow`; the dialog
is `aria-modal` and returns focus on close.

---

## 3 · What it cannot do, so nobody plans around it

- **Cross-origin images** paint only if the image server sends CORS headers (`useCORS: true` is set).
  Otherwise the box is blank in the frame. Serve images from your own origin, or through a same-origin
  proxy, or with `Access-Control-Allow-Origin`.
- **Canvas, WebGL, video and iframes** are not painted. A map, a chart on canvas, an embedded video
  or a third-party iframe comes out empty.
- **Box shadows are off** in the frame by design; **CSS animations are frozen at their end state**;
  `::before` and `::after` are resolved from the live page's computed styles, so `freezeCss` cannot
  restyle pseudo-elements.
- **Very tall pages** cost memory: a frame is width times full content height at one times device
  pixels. Ten thousand pixels tall is fine; a hundred thousand is not.
- **It is one page, one browser.** It compares two states of the page it runs in. It cannot capture a
  different URL, another user's session, or a server-rendered variant it did not load. Section 5 covers
  those.
- **Content Security Policy.** The page needs `script-src` for the module and the library (same origin
  suffices), `img-src data:` for the frames (they are data URLs on `background-image`), and
  `style-src 'unsafe-inline'` or a nonce, because the module injects one style element into the clone
  and sets inline styles on the stage. If your CSP forbids inline styles, the seam and fit logic needs
  a nonce hook; ask before adopting.

---

## 4 · What infrastructure it needs

None beyond static hosting. The three files are served by the CDN like any asset; the component runs
entirely in the visitor's browser; nothing is stored anywhere unless the host page decides to keep the
data URLs `openCompare()` returns. For a product that wants to keep comparisons, the host page posts
those two PNGs to its own storage; the component does not.

A note on what it is not: this repository also has a server-side screenshot route used for headless
testing, running on a Workers browser-rendering binding with Puppeteer. That is a different tool for
a different job (asserting a rendered page in a test) and the compare component does not use it or
depend on it.

---

## 5 · Using it in an experimentation product

Three patterns, in order of effort. The component covers the first; the others use it as the viewer.

1. **One page, applied in place.** Render the control. Capture. Apply the variant in the same DOM
   (your experimentation runtime already does this for client-side variations). Compare. This is the
   component's native use and needs nothing else. For an editor, "Preview variant" is the change and
   the compare button is free.
2. **Two loads of the same URL.** When the variant is decided server-side or at the CDN, the page
   cannot be both control and variant at once. Load the page twice in two same-origin iframes with a
   forcing parameter or cookie for each arm, capture each iframe's document root (pass the iframe's
   `contentDocument` element as the root; same origin is required), and hand the two frames to the
   overlay. The overlay's `showFrames` path is internal today; exposing a `showFrames(before, now)`
   entry point is a small change if you want this pattern, and the frames can come from anywhere as long
   as they are PNG data URLs with width and height.
3. **Two server-side screenshots.** For arms rendered on different origins, for a logged-out
   auditor, or for a stored comparison per experiment, take the two frames with a headless browser at
   the edge or in a job (a browser-rendering binding with Puppeteer, or Playwright in a container) and
   use the overlay purely as the viewer through the same entry point. The seam, the split, the zoom
   and the locator all work on any two frames of the same width.

If you tell us which pattern you need first, the entry point in pattern 2 is the only code change,
and it is small.

---

## 6 · For the engineering agents picking this up

- Start from `example/index.html`. Serve the package directory with any static server and open the
  example; press Capture, Apply the variant, Compare. That is the whole contract.
- Do not change `compare.js`'s capture logic without reading the comments at each guard; each one
  records a wrong frame that was measured before it was fixed.
- Keep the library vendored and pinned at 1.4.1; newer html2canvas builds change clone behaviour.
- Acceptance for an integration: the Before frame is taken on the press, not after your settle wait;
  the Now frame is the page after your change has finished animating; the overlay opens scrolled to the
  first change; "nothing has changed" appears when you compare twice; a cross-origin image on your page
  paints (or you have moved it same-origin).
- Sizes for planning: pattern 1, a day including your buttons and CSP; pattern 2, two to three days
  including the entry point; pattern 3, the screenshot pipeline is the work, the viewer is a day.
