<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- The site key. Not a secret: it names the SITE, the way an SDK key does. -->
<meta name="edge-sdk-key" content="demo-site" />
<link rel="icon" href="data:," />
<title>@@TITLE@@</title>
@@FONTS@@
<!-- The demo kit (public/demo-kit/): the token sheet, then the chrome drawn from it (the machine, the director bar,
     the before/now rows, the sheets, predict-then-prove), then @@NAME@@'s own sheet (its token overrides and its
     site), then the kit's Compare. Scaffolded by scripts/demo-kit/new-demo.mjs from public/@@SLUG@@/demo.config.json. -->
<link rel="stylesheet" href="/demo-kit/tokens.css" />
<link rel="stylesheet" href="/demo-kit/kit.css" />
<link rel="stylesheet" href="/@@SLUG@@/@@SLUG@@.css" />
<link rel="stylesheet" href="/demo-kit/compare.css" />
</head>
<!-- index.html, product.html and m.html carry the same shell; each boots into its own view (data-entry).
     Change all three together, or rerun the scaffold into a fresh directory and compare. The director docks as
     demo.config.json's director says (@@DOCK@@; the kit's director.js and kit.css draw the dock). -->
<body data-entry="@@ENTRY@@" class="@@BODY_CLASS@@">
<a class="skip" href="#stage">Skip to the page</a>

<!-- The director's hand. It glides to a real control and runs that control's own handler: never a shortcut around it. -->
<div id="demo-cursor" aria-hidden="true">
  <svg viewBox="0 0 24 24" fill="none"><path d="M3 2l6.5 18 2.7-7.3L19.5 10 3 2z" fill="#FFFFFF" stroke="#000000" stroke-width="1.4" stroke-linejoin="round"/></svg>
</div>

<div class="fixture-flag" id="fixtureFlag" hidden>Fixture mode: canned answers for layout work, not the engine</div>

<div class="shell">
<!-- ═══════════════════════════════ THE SITE ═══════════════════════════════ -->
<!-- A working store before anything is decided: the header, the published template on the homepage, the grids, the
     product page, search, the cart and where to buy all work by hand (public/demo-kit/store.js). The first visitor is
     minted on the first click on the site, or the director's first press, never on load. -->
<div class="site" id="site">
  @@PENCIL@@
  <header class="site-header static">
    <div class="mast">
      <a class="wordmark" href="/@@SLUG@@/" data-nav="home" data-ctl="home"><span class="wm" id="wordmark">@@WORDMARK@@</span><span class="wm-tag" id="tagline">@@TAGLINE@@</span></a>
      <nav class="mainnav" id="mainnav" aria-label="Shop">
          @@NAV@@
      </nav>
      <form class="search" id="searchForm" role="search" action="/@@SLUG@@/" data-store-search>
        <input id="searchInput" name="q" type="search" placeholder="@@L_SEARCH_PLACEHOLDER@@" aria-label="@@L_SEARCH@@" autocomplete="off" />
        <button type="submit" data-act="store-search" data-ctl="search" aria-label="@@L_SEARCH@@"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </form>
      <div class="mast-tools">
        <span class="region-chip" id="regionChip" hidden></span>
        <button type="button" class="u-sign" id="signIn" data-act="store-signin" data-ctl="sign-in">@@L_SIGN_IN@@</button>
        <button type="button" class="cart-btn" id="cartBtn" data-act="store-cart-open" data-ctl="cart" aria-label="@@L_CART@@">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 4h2.2l2.1 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L20.6 8H6.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.5" cy="19.5" r="1.4" fill="currentColor"/><circle cx="17" cy="19.5" r="1.4" fill="currentColor"/></svg>
          <span class="cart-count" id="cartCount" data-cart-count data-hide-empty hidden>0</span>
        </button>
      </div>
    </div>
  </header>

  <main class="stage" id="stage">
@@VIEWS@@
  </main>

  <footer class="site-footer static">
    @@FOOTER@@
    <p class="foot-legal" id="footLegal">@@LEGAL@@</p>
    <span class="nper">the header, the service strip and the footer are not personalised</span>
  </footer>
</div>

<!-- ═══════════════════════════════ THE ENGINE ═════════════════════════════ -->
<aside class="machine" id="machine" aria-label="The engine">
  <header class="m-head">
    <p class="m-k">The engine</p>
    <div class="m-who">
      <span class="who" id="whoChip">No visitor yet</span>
      <span class="arm" id="armChip" hidden></span>
    </div>
    <div class="m-ctx" id="ctxChips"></div>
  </header>

  <section class="signalcard">
    <h2>What has been signalled</h2>
    <p class="m-note">Read from the visitor&rsquo;s own profile, the moment each signal is sent. The hollow mark is the region&rsquo;s lean.</p>
    <div class="vectors" id="vectors"><p class="m-empty">No dimension has evidence yet.</p></div>
    <p class="m-note m-prior" id="priorLine"></p>
  </section>

  <div class="mtabs" role="tablist">
    <button type="button" role="tab" id="tab-arrival" aria-controls="panel-arrival" aria-selected="true">Arrival</button>
    <button type="button" role="tab" id="tab-session" aria-controls="panel-session" aria-selected="false">Session</button>
    <button type="button" role="tab" id="tab-why" aria-controls="panel-why" aria-selected="false">Why these</button>
    <button type="button" role="tab" id="tab-report" aria-controls="panel-report" aria-selected="false">Learned</button>
    <button type="button" role="tab" id="tab-next" aria-controls="panel-next" aria-selected="false">Roadmap</button>
  </div>
  <div class="mpanels">
    <section class="mpanel" id="panel-arrival" role="tabpanel" aria-labelledby="tab-arrival">
      <div id="coldStart"><p class="m-empty">The arrival is read when a visitor lands.</p></div>
    </section>
    <section class="mpanel" id="panel-session" role="tabpanel" aria-labelledby="tab-session" hidden>
      <ol class="journey" id="journey"><li class="journey-empty">Nobody has arrived yet.</li></ol>
    </section>
    <section class="mpanel" id="panel-why" role="tabpanel" aria-labelledby="tab-why" hidden>
      <div id="whyBody"><p class="m-empty">Press a beat to begin.</p></div>
    </section>
    <section class="mpanel" id="panel-report" role="tabpanel" aria-labelledby="tab-report" hidden>
      <div id="reportBody"><p class="m-empty">Press <b>Build today&rsquo;s report</b> to read what the modules have learned. It is built from the ledger, not from anything this page holds.</p></div>
      <button type="button" class="m-btn" id="buildReport" data-ctl="build-report">Build today&rsquo;s report</button>
    </section>
    <section class="mpanel" id="panel-next" role="tabpanel" aria-labelledby="tab-next" hidden>
      <ul class="dials" id="roadmap"></ul>
    </section>
  </div>

  <div class="m-tools">
    <button type="button" class="m-tool" id="captureBtn" data-ctl="capture">Capture</button>
    <button type="button" class="m-tool" id="compareBtn" data-ctl="compare" title="Before: none yet. Act, then Compare.">Compare</button>
    <span class="m-tool-note" id="captureNote">Capture this page, then compare it with another moment or another shopper.</span>
  </div>
</aside>
</div>

<!-- ── Sheets: one at a time ─────────────────────────────────────────────── -->
<div class="sheet-back" id="sheetBack" hidden>
  <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <button type="button" class="sheet-x" id="sheetClose" data-ctl="sheet-close" aria-label="Close">&times;</button>
    <div id="sheetBody"></div>
  </div>
</div>

<!-- ── Predict, then prove ──────────────────────────────────────────────── -->
<div class="pd-back" id="pdBack" hidden role="dialog" aria-modal="true" aria-labelledby="pdKicker">
  <div class="pd-box">
    <div class="pd-head">
      <span class="pd-k" id="pdKicker">Predict, then prove</span>
      <span class="pd-mode" id="pdMode">before the next act</span>
    </div>
    <div class="pd-grid">
      <section class="pd-card pd-done"><h3 class="pd-h">What the visitor has done</h3><div class="pd-body"><ol id="pdDone"></ol></div></section>
      <section class="pd-card pd-watch">
        <h3 class="pd-h">What we are watching for</h3>
        <div class="pd-body"><ol id="pdAct"></ol></div>
        <div class="pd-arith"><p class="pd-arith-k" id="pdArithK">The arithmetic &middot; score before &rarr; after &middot; entry threshold</p><div id="pdArith"></div></div>
      </section>
      <section class="pd-card pd-will">
        <h3 class="pd-h">What will change if they do it</h3>
        <div class="pd-body"><ul id="pdWill"></ul><p class="pd-arith-k" style="margin:12px 0 7px" id="pdNowK">On screen right now</p><div id="pdNow"></div></div>
      </section>
    </div>
    <section class="pd-why" id="pdWhyWrap" hidden>
      <p class="pd-why-head" id="pdWhyHead">Why: every decision the last press made</p>
      <div class="pd-why-grid">
        <div class="pd-why-table"><table><thead><tr><th>What</th><th>Why, in numbers</th><th>Against</th><th>Authority</th></tr></thead><tbody id="pdWhy"></tbody></table></div>
        <div class="pd-map"><div class="pd-map-cols">
          <div><p class="pd-map-k">Before</p><div id="pdMapNow"></div></div>
          <div class="pd-arrow">&rarr;</div>
          <div><p class="pd-map-k">After</p><div id="pdMapAfter"></div></div>
        </div></div>
      </div>
    </section>
    <div class="pd-foot">
      <p class="pd-note" id="pdNote">Computed from the visitor&rsquo;s real profile on the published constants. Nothing has happened yet.</p>
      <button type="button" class="pd-go" id="pdGo">Close</button>
    </div>
  </div>
</div>

<!-- ── The store's toast (public/demo-kit/store.js): the cart, where to buy, checkout, search and sign-in open in the sheet above. ── -->
<div class="st-toast" id="storeToast" role="status" aria-live="polite" hidden></div>

<!-- ── Compare: the demo kit's overlay (public/demo-kit/compare.js) is injected into <body> on first use. ── -->

<button type="button" class="pd-pill" id="pdPill">Explain &mdash; predict &amp; prove</button>

<div class="director" role="group" aria-label="Director">
  <div class="director-in">
    <div class="beatline">
      <span class="beatno" id="beatNo">Ready</span>
      <p class="engineline" id="engineLine">@@FIRST_LINE@@</p>
      <div class="beatnav">
        <button type="button" class="nextbeat" id="nextBeat">Next &rarr;<span id="nextLabel">@@FIRST_LABEL@@</span></button>
        <button type="button" class="director-handle" id="explainBtn" title="Press E anywhere">Explain</button>
        <button type="button" class="director-handle" id="directorHandle" aria-expanded="false" aria-controls="directorMore">All beats</button>
      </div>
    </div>
    <div class="director-more" id="directorMore">
      <div class="presses" id="presses"></div>
      <div class="dtools">
        <div class="assert" id="assertRegion"></div>
        <div class="assert" id="assertIntent"></div>
        <div class="assert" id="compareTools"></div>
      </div>
      <div class="director-foot">
        <span class="status" id="status">idle</span>
        <span class="legend"><i class="legend-dot legend-dot--shopper"></i>the visitor
          <i class="legend-dot legend-dot--merch"></i>the merchandiser
          <i class="legend-dot legend-dot--engine"></i>the engine, on its own</span>
      </div>
    </div>
  </div>
</div>

<!-- The page calls the engine routes directly through the kit's transport (X-Tenant on every call, no credential),
     so every call can be driven and asserted headlessly. @@SLUG@@.js builds the page on the kit (public/demo-kit/kit.js). -->
<script type="module" src="/@@SLUG@@/@@SLUG@@.js"></script>
</body>
</html>
