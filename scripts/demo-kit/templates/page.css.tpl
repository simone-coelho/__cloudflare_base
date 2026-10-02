/* public/@@SLUG@@/@@SLUG@@.css
 * @@NAME@@: the site, on the demo kit. Scaffolded by scripts/demo-kit/new-demo.mjs from public/@@SLUG@@/demo.config.json.
 *
 *   THE SITE (light)   this file: the token overrides (the palette), then a working store in a neutral look that the
 *                      page lanes restyle: the header, the homepage's sections, the grids, the product page, and the
 *                      store's chrome (public/demo-kit/store.js: the cart drawer, the modal, the toast).
 *   THE ENGINE (dark)  the machine panel, the director bar, the before/now strips, the sheets and predict-then-prove:
 *                      the demo kit's chrome (public/demo-kit/kit.css), drawn from the tokens, never edited here.
 *
 * Two kinds of region on the site, and the difference is the point:
 *   .decided  a slot the engine answers per visitor (on boot, the published template); a rule in the brand colour.
 *   .static   everything else, the same for everyone.
 * The buy box is a third kind: off limits, never decided, every control in it working, and it says so.
 *
 * Loaded after public/demo-kit/tokens.css and kit.css, before compare.css. Every colour is a token.
 */

/* ══ Token overrides: the palette from demo.config.json ═══════════════════ */
:root {
@@TOKENS@@
}

body { background: var(--paper); color: var(--text); font-family: var(--font); }
/* The site's width is its column's, not the window's: the docked director takes the right of the window when open, so
   the store's narrower layouts answer the site's own width (container queries), never the viewport's. */
.site { container: site / inline-size; }
.skip { position: absolute; left: -9999px; top: 0; background: var(--black); color: var(--on-dark); padding: 10px 16px; z-index: 1000; }
.skip:focus { left: 0; }
.site a { color: inherit; text-decoration: none; }
.site img { display: block; max-width: 100%; }

/* ══ Buttons ═════════════════════════════════════════════════════════════ */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid transparent; border-radius: 4px; font: inherit; font-weight: 600; font-size: 14.5px; padding: 11px 20px; cursor: pointer; line-height: 1.2; white-space: nowrap; }
.btn--brand { background: var(--brand); color: var(--on-dark); }
.btn--brand:hover { background: var(--brand-deep); }
.btn--line { background: var(--paper); color: var(--ink); border-color: var(--ink); }
.btn--line:hover { background: var(--soft); }
.btn--sm { padding: 8px 14px; font-size: 13px; }
.btn[disabled] { opacity: .45; cursor: default; }

/* ══ The header: wordmark, nav, search, sign in, cart ═══════════════════ */
.pencil { background: var(--ink); color: var(--on-dark); text-align: center; font-size: 13px; padding: 7px 16px; }
.site-header { position: sticky; top: 0; z-index: 40; background: var(--paper); border-bottom: 1px solid var(--line); }
.mast { display: flex; align-items: center; gap: 24px; padding: 0 28px; height: 64px; }
.wordmark { display: flex; align-items: baseline; gap: 10px; cursor: pointer; flex: none; }
.wm { font-size: 28px; font-weight: 800; letter-spacing: -0.04em; color: var(--brand); }
.wm-tag { font-size: 12.5px; color: var(--muted); }
.mainnav { display: flex; gap: 2px; align-items: center; flex-wrap: nowrap; min-width: 0; overflow: hidden; }
.mainnav a { font-size: 15px; font-weight: 600; color: var(--ink); padding: 8px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.mainnav a:hover { background: var(--soft); }
.search { display: flex; align-items: center; margin-left: auto; border: 1px solid var(--line-2); border-radius: 999px; padding: 0 4px 0 14px; height: 40px; flex: 0 1 300px; min-width: 140px; background: var(--paper); }
.search input { flex: 1; min-width: 0; border: 0; outline: 0; font: inherit; font-size: 14px; background: transparent; color: var(--ink); }
.search button { border: 0; background: none; color: var(--ink); width: 34px; height: 34px; border-radius: 50%; cursor: pointer; display: grid; place-items: center; }
.search button:hover { background: var(--soft); }
.mast-tools { display: flex; align-items: center; gap: 14px; flex: none; }
.region-chip { font-size: 12.5px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; white-space: nowrap; }
.u-sign { border: 0; background: none; font: inherit; font-size: 14px; font-weight: 600; color: var(--ink); cursor: pointer; padding: 6px 4px; }
.cart-btn { position: relative; border: 0; background: none; color: var(--ink); cursor: pointer; padding: 6px; display: grid; place-items: center; }
.cart-count { position: absolute; top: -2px; right: -4px; min-width: 18px; height: 18px; border-radius: 9px; background: var(--brand); color: var(--on-dark); font-size: 11px; font-weight: 700; display: grid; place-items: center; padding: 0 5px; }
.cart-count[hidden] { display: none; }

/* ══ The stage, the modules, decided and static ═════════════════════════ */
.nper { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.nper::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--line-2); }
.stage { padding: 0 28px 48px; }
.view { display: flex; flex-direction: column; gap: 36px; padding-top: 24px; }
.module { min-width: 0; }
.module.decided { border-left: 3px solid var(--brand); padding-left: 14px; }
.module-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.module-head h2 { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: var(--ink); }
.module-where { font-family: var(--mono); font-size: 10px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); margin-top: 3px; }
.module-where b { color: var(--brand-deep); font-weight: 600; }
.offlimits-note, .offlimits { font-size: 12px; color: var(--muted); background: var(--soft); border-radius: 4px; padding: 6px 10px; }
.offlimits-note b, .offlimits b { color: var(--ink); text-transform: uppercase; font-family: var(--mono); font-size: 10px; letter-spacing: .08em; margin-right: 6px; }
.engine-down { margin-top: 10px; font-size: 13px; color: var(--brand-deep); background: var(--brand-wash); border-radius: 4px; padding: 8px 12px; }
.slot-wait, .slot-empty { font-size: 13.5px; color: var(--muted); font-style: italic; }
.noimg { display: block; width: 100%; height: 100%; min-height: 80px; background: var(--soft-2); }

/* While the director is docked and collapsed (body.kit-dock--collapsed, the kit's director.js), the demo's frame gives
   way to the plain store: the slot lines, the off-limits notes, the order chips and the receipts on the cards. The
   presenter opens the director (D, or ?present=1) and sees them again. */
body.kit-dock--collapsed .module-where, body.kit-dock--collapsed .offlimits-note, body.kit-dock--collapsed .offlimits,
body.kit-dock--collapsed .rail-chip, body.kit-dock--collapsed .card .receipt, body.kit-dock--collapsed .card .pos,
body.kit-dock--collapsed .site-footer .nper, body.kit-dock--collapsed .grid-bar .how { display: none; }
body.kit-dock--collapsed .module.decided { border-left-color: transparent; }

/* ══ Pieces: heroes, tiles, deals, modules ══════════════════════════════ */
.cards { display: grid; gap: 16px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.cards--one { grid-template-columns: minmax(0, 1fr); }
.cards--tiles { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
.card { position: relative; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); display: flex; flex-direction: column; cursor: pointer; overflow: hidden; min-width: 0; }
.card:hover { border-color: var(--line-2); }
.card .cimg { display: block; aspect-ratio: 4 / 3; background: var(--soft); }
.card .cimg img { width: 100%; height: 100%; object-fit: contain; }
.card .ctext { display: flex; flex-direction: column; gap: 6px; padding: 14px 16px 16px; align-items: flex-start; }
.card h3 { font-size: 16px; font-weight: 700; color: var(--ink); padding-right: 20px; }
.card p { font-size: 13.5px; color: var(--muted); }
.card .pos { position: absolute; top: 8px; right: 10px; font-family: var(--mono); font-size: 10.5px; color: var(--muted); }
.card .receipt { font-family: var(--mono); font-size: 10px; color: var(--muted); border-top: 1px dashed var(--line); padding-top: 6px; margin-top: 2px; align-self: stretch; }
.card.clicked, .pcard.clicked, .tile.clicked { box-shadow: 0 0 0 3px var(--brand-glow-2); }
/* A hero: the image beside the words, full width. */
.cards--one .card { flex-direction: row; height: 340px; background: var(--soft); border: 0; }
.cards--one .card .cimg { flex: 1.2; aspect-ratio: auto; height: 100%; background: transparent; padding: 18px; }
.cards--one .card .ctext { flex: 1; justify-content: center; padding: 32px 40px; gap: 12px; }
.cards--one .card h3 { font-size: 34px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
.cards--one .card p { font-size: 16px; color: var(--text); }
.card--tile .cimg { aspect-ratio: 1; }
.card--tile .ctext { padding: 10px 12px 12px; }

/* ══ The service strip and the category tiles (static) ═════════════════ */
.service { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1px; background: var(--line); border-radius: 8px; overflow: hidden; }
.svc { background: var(--soft); padding: 16px 18px; display: flex; flex-direction: column; gap: 3px; }
.svc b { font-size: 14px; color: var(--ink); }
.svc span { font-size: 12.5px; color: var(--muted); }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
.tile { display: flex; flex-direction: column; gap: 6px; align-items: center; text-align: center; padding: 14px 10px; border-radius: 8px; background: var(--soft); cursor: pointer; }
.tile:hover { background: var(--soft-2); }
.tile-img { display: block; width: 100%; aspect-ratio: 1; }
.tile-img img { width: 100%; height: 100%; object-fit: contain; }
.tile b { font-size: 14.5px; color: var(--ink); }
.tile span:not(.tile-img) { font-size: 12px; color: var(--muted); }

/* ══ Product cards, rails and grids ═════════════════════════════════════ */
.rail { display: grid; gap: 16px; grid-auto-flow: column; grid-auto-columns: calc((100% - 48px) / 4); overflow-x: auto; padding-bottom: 6px; }
.rail-chip { font-family: var(--mono); font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
.rail-chip.chip-live { color: var(--brand-deep); border-color: var(--brand); }
.lean { font-size: 12.5px; color: var(--gated); background: var(--gated-bg); border-radius: 4px; padding: 5px 10px; align-self: flex-start; }
.pcard { border: 1px solid var(--line); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 6px; cursor: pointer; background: var(--paper); min-width: 0; align-items: flex-start; }
.pcard:hover { border-color: var(--line-2); }
.pimg { position: relative; display: block; width: 100%; aspect-ratio: 1; background: var(--paper); margin-bottom: 4px; }
.pimg img { width: 100%; height: 100%; object-fit: contain; }
.pbadges { position: absolute; top: 0; left: 0; display: flex; gap: 4px; }
.pbadges i, .bb-badges i { font-style: normal; font-size: 11px; font-weight: 700; background: var(--soft-2); color: var(--ink); border-radius: 3px; padding: 2px 6px; }
.pname { font-size: 14px; font-weight: 600; color: var(--ink); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.rating { font-size: 12.5px; color: var(--muted); }
.rating .stars, .rbig .stars { color: var(--ink); letter-spacing: 1px; }
.pprices { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin: 2px 0 6px; }
.pprice { font-size: 18px; font-weight: 800; color: var(--ink); }
.poff { font-size: 13px; font-weight: 700; color: var(--brand); }
.plist { font-size: 13px; color: var(--muted); }
.pout { font-size: 13px; color: var(--muted); }
.pcard .btn { margin-top: auto; }
.grid-wrap { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 28px; align-items: start; }
.filters { display: flex; flex-direction: column; gap: 18px; position: sticky; top: 80px; }
.fhead { display: flex; justify-content: space-between; align-items: center; font-weight: 700; color: var(--ink); }
.fclear { border: 0; background: none; color: var(--brand-deep); font: inherit; font-size: 13px; cursor: pointer; text-decoration: underline; }
.fgroup { border: 0; border-top: 1px solid var(--line); padding: 12px 0 0; display: flex; flex-direction: column; gap: 4px; }
.fgroup legend { font-size: 13px; font-weight: 700; color: var(--ink); padding: 0 0 6px; }
.fval { display: flex; justify-content: space-between; gap: 8px; border: 0; background: none; font: inherit; font-size: 13.5px; color: var(--text); text-align: left; padding: 5px 6px; border-radius: 4px; cursor: pointer; }
.fval::before { content: ''; flex: none; width: 14px; height: 14px; border: 1.5px solid var(--line-2); border-radius: 3px; margin-top: 2px; }
.fval span { flex: 1; }
.fval i { font-style: normal; color: var(--muted); font-size: 12px; }
.fval[aria-pressed="true"]::before { background: var(--brand); border-color: var(--brand); }
.fval:hover { background: var(--soft); }
.grid-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.grid-bar { display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; }
.count { font-size: 13.5px; color: var(--muted); }
.count b { color: var(--ink); }
.sort { display: flex; gap: 6px; flex-wrap: wrap; }
.sort button { border: 1px solid var(--line-2); background: var(--paper); color: var(--ink); font: inherit; font-size: 13px; border-radius: 999px; padding: 6px 12px; cursor: pointer; }
.sort button[aria-pressed="true"] { background: var(--ink); color: var(--on-dark); border-color: var(--ink); }
.pgrid { display: grid; gap: 16px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.view--search .grid-wrap, .view--grid .grid-wrap { margin-top: 4px; }

/* ══ The grid page and the product page ═════════════════════════════════ */
.crumbs { display: flex; gap: 8px; font-size: 13px; color: var(--muted); flex-wrap: wrap; }
.crumbs a { cursor: pointer; text-decoration: underline; }
.view-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.view-title { font-size: 32px; font-weight: 800; letter-spacing: -0.03em; color: var(--ink); }
.buybox { display: flex; flex-direction: column; gap: 14px; }
.bb-grid { display: grid; gap: 36px; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); align-items: start; }
.bb-gallery { display: flex; flex-direction: column; gap: 10px; position: sticky; top: 80px; }
.bb-image { aspect-ratio: 1; background: var(--paper); border: 1px solid var(--line); border-radius: 8px; display: grid; place-items: center; overflow: hidden; }
.bb-image img { width: 88%; height: 88%; object-fit: contain; }
.bb-thumbs { display: flex; gap: 8px; flex-wrap: wrap; }
.bb-thumbs button { border: 1px solid var(--line); background: var(--paper); border-radius: 4px; padding: 2px; cursor: pointer; }
.bb-config { display: flex; flex-direction: column; gap: 12px; }
.bb-badges { display: flex; gap: 6px; }
.bb-title { font-size: 26px; font-weight: 700; color: var(--ink); line-height: 1.25; }
.bb-meta { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
.bb-price { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
.bb-price .pprice { font-size: 28px; }
.bb-line { font-size: 13.5px; color: var(--text); }
.bb-opts { display: flex; flex-direction: column; gap: 12px; }
.bb-label { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 6px; }
.bb-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.bb-chips button { border: 1px solid var(--line-2); background: var(--paper); color: var(--ink); font: inherit; font-size: 13.5px; border-radius: 4px; padding: 8px 12px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.bb-chips button i { font-style: normal; font-size: 11.5px; color: var(--muted); }
.bb-chips button[aria-pressed="true"] { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
.bb-addons { display: flex; flex-direction: column; gap: 6px; }
.bb-addon { display: flex; justify-content: space-between; gap: 10px; border: 1px solid var(--line-2); background: var(--paper); font: inherit; font-size: 13.5px; color: var(--text); border-radius: 4px; padding: 9px 12px; cursor: pointer; text-align: left; }
.bb-addon[aria-pressed="true"] { border-color: var(--brand); background: var(--brand-wash); }
.bb-review ul { list-style: none; border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px; font-size: 13.5px; }
.bb-review li { display: flex; justify-content: space-between; gap: 10px; }
.bb-review li.tot { border-top: 1px solid var(--line); padding-top: 6px; font-weight: 700; color: var(--ink); }
.bb-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.bb-actions .btn { flex: 1; min-width: 160px; padding: 14px 20px; }
.pdp-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); position: sticky; top: 64px; background: var(--paper); z-index: 5; }
.pdp-tabs button { border: 0; background: none; font: inherit; font-weight: 600; font-size: 14px; color: var(--ink); padding: 12px 14px; cursor: pointer; border-bottom: 2px solid transparent; }
.pdp-tabs button:hover { border-bottom-color: var(--brand); }
.pdp-specs h2, .pdp-reviews h2 { font-size: 22px; font-weight: 700; color: var(--ink); margin-bottom: 12px; }
.pdesc { font-size: 14.5px; color: var(--text); max-width: 760px; margin-bottom: 14px; }
.specs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 32px; max-width: 900px; }
.specs div { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--line); padding: 9px 0; font-size: 13.5px; }
.specs dt { color: var(--muted); }
.specs dd { color: var(--ink); font-weight: 600; text-align: right; }
.rbig { font-size: 15px; color: var(--text); }
.rbig b { font-size: 30px; color: var(--ink); margin-right: 4px; }
.rnote { font-size: 13px; color: var(--muted); margin-top: 6px; }

/* ══ The store's pieces (public/demo-kit/store.js): in the kit's sheet (the cart, checkout, where to buy, search
 * results, sign-in), the toast, and the header controls it adds to a page whose header lacks them. ═════════ */
.sheet .st-lines { display: grid; gap: 12px; margin: 12px 0 6px; }
.sheet .st-line { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 12px; align-items: start; border-top: 1px solid var(--line); padding-top: 12px; }
.sheet .st-line-main { display: grid; gap: 3px; min-width: 0; }
.sheet .st-line-name { font-size: 14px; color: var(--ink); }
.sheet .st-line-sku, .sheet .st-line-add { font-size: 12.5px; color: var(--muted); }
.sheet .st-line-add em { font-style: normal; color: var(--ink); }
.sheet .st-line-price { font-weight: 700; color: var(--ink); text-align: right; display: grid; }
.sheet .st-line-price s { font-weight: 400; color: var(--muted); font-size: 12.5px; }
.sheet .st-qty { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.sheet .st-qbtn { width: 28px; height: 28px; border: 1px solid var(--line-2); background: var(--paper); border-radius: 4px; cursor: pointer; font-size: 16px; line-height: 1; color: var(--ink); }
.sheet .st-link { border: 0; background: none; color: var(--brand-deep); font: inherit; font-size: 13px; cursor: pointer; text-decoration: underline; padding: 0 0 0 6px; }
.st-art { display: block; aspect-ratio: 1 / 1; background: var(--soft); border-radius: 4px; overflow: hidden; }
.st-art img { width: 100%; height: 100%; object-fit: contain; display: block; }
.st-noimg { display: flex; align-items: center; justify-content: center; height: 100%; min-height: 48px; padding: 6px; font-size: 10.5px; color: var(--muted); text-align: center; background: var(--soft); }
.sheet .st-saving b { color: var(--brand); }
.sheet .st-total { font-size: 16px; }
.sheet .st-fine { font-size: 12.5px; color: var(--muted); margin-top: 10px; }
.sheet .nper { font-family: var(--font); font-size: 12.5px; letter-spacing: 0; text-transform: none; color: var(--muted); }
.sheet .nper::before { display: none; }
.sheet .st-h { font-family: var(--mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--brand-deep); margin: 16px 0 2px; }
.st-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 12px; }
.st-result { display: grid; gap: 5px; text-align: left; border: 1px solid var(--line); background: var(--paper); border-radius: 6px; padding: 8px; cursor: pointer; font: inherit; }
.st-result-name { font-size: 13px; color: var(--ink); line-height: 1.3; }
.st-result-price { font-size: 13px; font-weight: 700; }
.st-result-price s { font-weight: 400; color: var(--muted); }
.st-lean { color: var(--brand-deep); }
.st-toast { position: fixed; left: 18px; bottom: calc(var(--bar-h) + 16px); z-index: 960; max-width: min(460px, 80vw); background: var(--ink); color: var(--on-dark); font-size: 14px; line-height: 1.4; padding: 10px 14px; border-radius: 6px; box-shadow: 0 6px 22px rgba(0,0,0,.25); }
.st-toast[hidden] { display: none; }
.st-toast[data-tone="bad"] { background: var(--brand-deep); }
.st-search { display: flex; align-items: center; gap: 6px; margin-left: auto; min-width: 0; flex: 0 1 260px; }
.st-search input { width: 100%; min-width: 60px; font: inherit; font-size: 14px; border: 1px solid var(--line-2); border-radius: 4px; padding: 7px 10px; background: var(--paper); color: var(--ink); }
.st-search-go, .st-cart, .st-sign { font: inherit; font-size: 13.5px; font-weight: 600; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); border-radius: 4px; padding: 7px 11px; cursor: pointer; }
.st-cart-n { display: inline-block; min-width: 20px; text-align: center; background: var(--brand); color: var(--on-dark); border-radius: 10px; font-size: 12px; padding: 1px 6px; }

/* ══ Footer ═══════════════════════════════════════════════════════════════ */
.site-footer { background: var(--soft); border-top: 1px solid var(--line); padding: 32px 28px calc(var(--bar-h) + 24px); display: grid; gap: 16px; }
.foot-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 20px; }
.foot-cols div { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
.foot-cols b { color: var(--ink); font-size: 13.5px; margin-bottom: 2px; }
.foot-legal { font-size: 12px; color: var(--muted); max-width: 900px; }

/* ══ Narrower screens ═════════════════════════════════════════════════════ */
@container site (max-width: 1180px) {
  .wm-tag, .region-chip { display: none; }
}
@container site (max-width: 1100px) {
  .cards, .pgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .rail { grid-auto-columns: calc((100% - 32px) / 3); }
  .mast { gap: 16px; padding: 0 20px; }
  .stage { padding: 0 20px 40px; }
}
@container site (max-width: 820px) {
  .mast { flex-wrap: wrap; height: auto; padding: 10px 16px; row-gap: 8px; }
  .mainnav { order: 6; width: 100%; overflow-x: auto; }
  .search { order: 5; flex: 1 1 100%; margin-left: 0; }
  .mast-tools { margin-left: auto; }
  .grid-wrap { grid-template-columns: minmax(0, 1fr); }
  .filters { position: static; flex-direction: row; flex-wrap: wrap; }
  .bb-grid { grid-template-columns: minmax(0, 1fr); }
  .bb-gallery { position: static; }
  .cards, .pgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rail { grid-auto-columns: calc((100% - 16px) / 2); }
  .cards--one .card { flex-direction: column; height: auto; }
  .cards--one .card .cimg { height: 240px; flex: none; }
  .specs { grid-template-columns: minmax(0, 1fr); }
}

/* ══ The phone (m.html): the homepage's slots at phone width ════════════ */
/* An explicit width: the site is a size container (above), so centred by auto margins it would shrink to nothing. */
body.shell--phone .site { width: min(400px, 100%); max-width: 400px; margin: 18px auto; border: 10px solid var(--black); border-radius: 34px; overflow: hidden; }
body.shell--phone .stage { padding: 0 14px 28px; }
body.shell--phone .mast { flex-wrap: wrap; height: auto; padding: 10px 14px; gap: 10px; }
body.shell--phone .mainnav { order: 6; width: 100%; overflow-x: auto; flex-wrap: nowrap; }
body.shell--phone .search { order: 5; flex: 1 1 100%; margin-left: 0; }
body.shell--phone .mast-tools { margin-left: auto; }
body.shell--phone .region-chip { display: none; }
body.shell--phone .cards, body.shell--phone .pgrid { grid-template-columns: minmax(0, 1fr); }
body.shell--phone .rail { grid-auto-columns: 70%; }
body.shell--phone .cards--one .card { flex-direction: column; height: auto; }
body.shell--phone .cards--one .card .cimg { height: 200px; flex: none; }
body.shell--phone .cards--one .card .ctext { padding: 18px; }
body.shell--phone .cards--one .card h3 { font-size: 24px; }
body.shell--phone .grid-wrap, body.shell--phone .bb-grid { grid-template-columns: minmax(0, 1fr); }
body.shell--phone .site-footer { padding-bottom: 28px; }
