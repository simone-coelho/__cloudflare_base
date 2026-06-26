/* ============================================================================
 * revenue-radar.js — Revenue Radar client (owner: revenue-radar workstream)
 *
 * Self-contained: attaches to window.store, injects its own CSS, owns the
 * #tab-radar sidebar panel. storefront.js only provides 3 hook-points (the tab
 * button, the empty #tab-radar panel, this <script>). Nothing here touches the
 * Engine-tab / A/B+CMAB zone.
 *
 * Phase 3: live funnel viz (GET /funnel) + diagnosis cards (GET /funnel/diagnose)
 *          + one-click Launch (POST /experiment/launch — the cross-team seam).
 * Live motion: ambient stream + amplify-on-action (POST /funnel/sim/*), with
 *          in-place animated bar updates, and auto-recover after a Launch.
 * ========================================================================== */
(function () {
  'use strict';

  const BRANDS = ['Coach', 'Kate Spade', 'Stuart Weitzman'];
  const COHORTS = [['all', 'All'], ['gen_z', 'Gen-Z'], ['millennial', 'Millennial'], ['gen_x', 'Gen-X'], ['boomer', 'Boomer']];
  const KIND_LABEL = { bnpl: 'BNPL', cart_recovery: 'Cart recovery', shipping_estimator: 'Shipping', reassurance: 'Reassurance' };
  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();
  const num = (n) => (Number(n) || 0).toLocaleString();
  const enc = encodeURIComponent;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const effCohort = (c) => (c === 'all' ? 'gen_z' : c); // recos need a concrete cohort to target
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const viewOf = (s) => ({ brand: s._rrBrand || 'Coach', cohort: s._rrCohort || 'all' });
  const isStale = (s, brand, cohort) => (s._rrBrand || 'Coach') !== brand || (s._rrCohort || 'all') !== cohort;

  const CSS = `
    .rr { color: #E8E0D2; font-size: 13px; }
    .rr-top { margin-bottom: 12px; }
    .rr-ttl { font-size: 15px; letter-spacing: .04em; color: #F4EEE2; font-weight: 600; }
    .rr-sub { font-size: 11px; color: #9A8F7C; margin-top: 2px; }
    .rr-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .rr-pill { border: 1px solid #3A332A; background: transparent; color: #C9BFAC; padding: 5px 11px; border-radius: 14px; font-size: 11.5px; cursor: pointer; transition: all .15s var(--ease, ease); }
    .rr-pill.sm { padding: 3px 9px; font-size: 10.5px; }
    .rr-pill:hover { border-color: var(--tan, #C9A86B); color: #fff; }
    .rr-pill.on { background: var(--tan, #C9A86B); border-color: var(--tan, #C9A86B); color: #1A1610; font-weight: 600; }
    .rr-ctrls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 10px 0 2px; }
    .rr-ctrl { border: 1px solid #3A332A; background: #1A1610; color: #C9BFAC; padding: 5px 10px; border-radius: 6px; font-size: 10.5px; cursor: pointer; transition: all .15s; }
    .rr-ctrl:hover { border-color: var(--tan, #C9A86B); color: #fff; }
    .rr-ctrl.warn:hover { border-color: #E8795C; color: #E8795C; }
    .rr-ctrl.live.on { background: rgba(120,190,110,.14); border-color: rgba(120,190,110,.5); color: #9FCF8E; }
    .rr-ctrl.live .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #6B6258; margin-right: 5px; vertical-align: middle; }
    .rr-ctrl.live.on .dot { background: #7FD06A; box-shadow: 0 0 6px #7FD06A; animation: rrpulse 1.2s infinite; }
    @keyframes rrpulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
    .rr-narrate { font-size: 12px; color: #E8C98A; background: rgba(214,178,110,.1); border: 1px solid rgba(214,178,110,.25); border-radius: 6px; padding: 8px 11px; margin: 8px 0 2px; opacity: 0; max-height: 0; overflow: hidden; transition: opacity .3s, max-height .3s; line-height: 1.45; }
    .rr-narrate.show { opacity: 1; max-height: 90px; }
    .rr-hl { display: flex; gap: 20px; margin: 12px 0; padding: 13px 15px; background: #1A1610; border: 1px solid #2C2620; border-radius: 8px; }
    .rr-hl-val { font-size: 23px; color: #F4EEE2; font-weight: 600; letter-spacing: .01em; transition: color .3s; }
    .rr-hl-lbl { font-size: 9.5px; color: #9A8F7C; text-transform: uppercase; letter-spacing: .08em; margin-top: 3px; }
    .rr-funnel { margin-top: 6px; }
    .rr-stg { margin-bottom: 9px; }
    .rr-stg-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 11px; margin-bottom: 3px; }
    .rr-stg-name { color: #C9BFAC; text-transform: uppercase; letter-spacing: .06em; }
    .rr-stg-num { color: #F4EEE2; font-weight: 600; font-size: 12px; transition: color .3s; }
    .rr-bar { height: 14px; background: linear-gradient(90deg, #8A744E, #D6B26E); border-radius: 4px; min-width: 5%; transition: width .7s var(--ease, ease); }
    .rr-leak { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 5px; padding-left: 2px; font-size: 11px; min-height: 4px; }
    .rr-leak-d { font-weight: 600; }
    .rr-leak.sev-low { color: #6B6258; }
    .rr-leak.sev-med { color: #D9A441; }
    .rr-leak.sev-high { color: #E8795C; }
    .rr-leak.sev-high .rr-leak-d { background: rgba(224,106,78,.13); padding: 1px 7px; border-radius: 10px; }
    .rr-skew { color: #9A8F7C; font-style: italic; }
    .rr-empty { color: #6B6258; padding: 22px; text-align: center; }
    .rr-recos { margin-top: 18px; }
    .rr-recos-h { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: #9A8F7C; margin-bottom: 9px; }
    .rr-reco { background: #1A1610; border: 1px solid #2C2620; border-radius: 8px; padding: 12px 13px; margin-bottom: 10px; }
    .rr-reco.top { border-color: var(--tan, #C9A86B); box-shadow: 0 0 0 1px rgba(201,168,107,.22); }
    .rr-reco-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px; }
    .rr-kind { font-size: 9.5px; text-transform: uppercase; letter-spacing: .07em; padding: 2px 8px; border-radius: 10px; background: #2C2620; color: #D6B26E; }
    .rr-kind.k-bnpl { background: rgba(214,178,110,.18); color: #E8C98A; }
    .rr-reco-rec { font-size: 13px; color: #F4EEE2; font-weight: 600; }
    .rr-reco-t { font-size: 13.5px; color: #F4EEE2; font-weight: 600; margin-bottom: 4px; }
    .rr-reco-a { font-size: 11.5px; color: #C9BFAC; margin-bottom: 5px; }
    .rr-reco-w { font-size: 11px; color: #9A8F7C; line-height: 1.5; margin-bottom: 10px; }
    .rr-launch { width: 100%; background: var(--tan, #C9A86B); color: #1A1610; border: none; padding: 9px; border-radius: 6px; font-size: 12px; font-weight: 600; letter-spacing: .04em; cursor: pointer; transition: opacity .15s; }
    .rr-launch:hover { opacity: .9; }
    .rr-launch:disabled { opacity: .6; cursor: default; }
    .rr-launch-out:not(:empty) { margin-top: 8px; }
    .rr-live-box { font-size: 11px; color: #9FCF8E; background: rgba(120,190,110,.1); border: 1px solid rgba(120,190,110,.25); border-radius: 6px; padding: 7px 9px; line-height: 1.5; }
    .rr-live-box.err { color: #E8795C; background: rgba(224,106,78,.1); border-color: rgba(224,106,78,.25); }
    .rr-lift { font-weight: 600; color: #B6E0A6; }
    /* Neighborhood-vs-Shopper contrast modal (appended to <body>, full-viewport) */
    .rrx-overlay { position: fixed; inset: 0; background: rgba(12,10,8,.72); z-index: 96; opacity: 0; pointer-events: none; transition: opacity .25s; }
    .rrx-overlay.open { opacity: 1; pointer-events: auto; }
    .rrx { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-46%) scale(.98); width: 92vw; max-width: 760px; z-index: 97; background: #16130F; border: 1px solid #2C2620; border-radius: 12px; box-shadow: 0 30px 90px rgba(0,0,0,.55); opacity: 0; pointer-events: none; transition: opacity .25s, transform .25s; overflow: hidden; }
    .rrx.open { opacity: 1; pointer-events: auto; transform: translate(-50%,-50%) scale(1); }
    .rrx-head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 14px; border-bottom: 1px solid #2C2620; }
    .rrx-ttl { font-size: 17px; line-height: 1.35; color: #F4EEE2; font-weight: 600; flex: 1; }
    .rrx-ttl em { color: var(--tan, #C9A86B); font-style: normal; }
    .rrx-x { background: none; border: none; color: #9A8F7C; font-size: 24px; line-height: 1; cursor: pointer; }
    .rrx-x:hover { color: #F4EEE2; }
    .rrx-cols { display: flex; }
    .rrx-col { flex: 1; padding: 18px 20px 20px; }
    .rrx-col.dy { background: #131210; border-right: 1px solid #2C2620; }
    .rrx-col.opti { background: #181410; }
    .rrx-col-h { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #C9BFAC; font-weight: 600; }
    .rrx-col.opti .rrx-col-h { color: var(--tan, #C9A86B); }
    .rrx-col-h span { display: block; font-size: 9.5px; letter-spacing: .04em; color: #6B6258; text-transform: none; font-weight: 400; margin-top: 2px; }
    .rrx-pin { font-size: 12.5px; color: #E8E0D2; margin: 12px 0 10px; }
    .rrx-quote { font-size: 14px; color: #B9AE9A; font-style: italic; line-height: 1.5; margin-bottom: 12px; }
    .rrx-quote b { color: #E8E0D2; font-style: normal; }
    .rrx-list { list-style: none; padding: 0; margin: 0; }
    .rrx-list li { font-size: 12px; color: #D6CDBC; padding: 4px 0 4px 16px; position: relative; line-height: 1.4; }
    .rrx-list li:before { content: '·'; position: absolute; left: 4px; color: var(--tan, #C9A86B); }
    .rrx-list li b { color: #F4EEE2; }
    .rrx-list.dim li { color: #8A8175; }
    .rrx-list.dim li:before { color: #6B6258; }
    .rrx-foot { margin-top: 14px; font-size: 12px; color: #E8E0D2; }
    .rrx-foot b { color: var(--tan, #C9A86B); }
    .rrx-foot.dim { color: #8A8175; }
    .rrx-foot.dim b { color: #B9AE9A; }
    .rrx-cta { padding: 15px 20px; background: #1A1610; border-top: 1px solid #2C2620; font-size: 13.5px; color: #E8E0D2; line-height: 1.5; }
    .rrx-cta b { color: var(--tan, #C9A86B); }
    /* Checkout overlay — shopper-facing, LIGHT luxe theme (appended to <body>) */
    .rrco-overlay { position: fixed; inset: 0; background: rgba(20,16,12,.5); z-index: 96; opacity: 0; pointer-events: none; transition: opacity .25s; }
    .rrco-overlay.open { opacity: 1; pointer-events: auto; }
    .rrco { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-46%) scale(.98); width: 94vw; max-width: 560px; max-height: 90vh; overflow-y: auto; z-index: 97; background: #FBF8F2; color: #1A1610; border-radius: 12px; box-shadow: 0 30px 90px rgba(0,0,0,.4); opacity: 0; pointer-events: none; transition: opacity .25s, transform .25s; }
    .rrco.open { opacity: 1; pointer-events: auto; transform: translate(-50%,-50%) scale(1); }
    .rrco-head { display: flex; align-items: center; gap: 10px; padding: 16px 20px; border-bottom: 1px solid #E8E0D2; }
    .rrco-head-t { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #1A1610; flex: 1; font-weight: 600; }
    .rrco-head-s { font-size: 10px; color: #9A8F7C; letter-spacing: .16em; }
    .rrco-x { background: none; border: none; color: #9A8F7C; font-size: 22px; cursor: pointer; line-height: 1; }
    .rrco-x:hover { color: #1A1610; }
    .rrco-steps { display: flex; align-items: center; gap: 7px; padding: 12px 20px 0; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #C2B9A8; }
    .rrco-st.on { color: var(--tan, #B8860B); font-weight: 600; }
    .rrco-body { padding: 15px 20px 20px; }
    .rrco-sec { display: none; }
    .rrco-sec.on { display: block; }
    .rrco-field { margin-bottom: 10px; }
    .rrco-field label { display: block; font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: #9A8F7C; margin-bottom: 4px; }
    .rrco-field input { width: 100%; padding: 9px 11px; border: 1px solid #D8CFC0; border-radius: 6px; background: #fff; font-size: 13px; color: #1A1610; box-sizing: border-box; }
    .rrco-row2 { display: flex; gap: 10px; }
    .rrco-row2 .rrco-field { flex: 1; }
    .rrco-btn { width: 100%; background: #1A1610; color: #FBF8F2; border: none; padding: 13px; border-radius: 7px; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; cursor: pointer; margin-top: 8px; transition: background .15s; }
    .rrco-btn:hover { background: #2C2620; }
    .rrco-summary { background: #F3EEE3; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }
    .rrco-sum-name { font-size: 13px; color: #1A1610; }
    .rrco-sum-total { font-size: 17px; font-weight: 600; color: #1A1610; }
    .rrco-bnpl { border: 1.5px solid var(--tan, #B8860B); background: linear-gradient(180deg, #FBF6EA, #F6EEDB); border-radius: 9px; padding: 14px 15px 13px; margin-bottom: 12px; position: relative; animation: rrcoPop .4s var(--ease, ease); }
    @keyframes rrcoPop { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
    .rrco-bnpl-tag { position: absolute; top: -9px; left: 14px; background: var(--tan, #B8860B); color: #fff; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; padding: 2px 9px; border-radius: 8px; }
    .rrco-bnpl-t { font-size: 14.5px; font-weight: 600; color: #1A1610; margin-bottom: 3px; }
    .rrco-bnpl-sub { font-size: 12px; color: #6E6557; margin-bottom: 8px; }
    .rrco-bnpl-proof { font-size: 11px; color: #8A7A52; }
    .rrco-bnpl-proof .stars { color: var(--tan, #B8860B); letter-spacing: 1px; }
    .rrco-alt { font-size: 12px; color: #9A8F7C; margin-bottom: 8px; }
    .rrco-done { text-align: center; padding: 22px 0 10px; }
    .rrco-done-i { font-size: 38px; color: #6FB36A; }
    .rrco-done-t { font-size: 17px; font-weight: 600; color: #1A1610; margin: 8px 0 4px; }
    .rrco-done-s { font-size: 12px; color: #6E6557; }
  `;

  function buildContrast() {
    if (document.getElementById('rrx')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="rrx-overlay" id="rrx-overlay"></div>
      <div class="rrx" id="rrx" role="dialog" aria-label="Optimizely vs geo-targeting">
        <div class="rrx-head">
          <div class="rrx-ttl">Dynamic Yield knows the <em>neighborhood</em>.<br>Optimizely knows the <em>shopper</em>.</div>
          <button class="rrx-x" id="rrx-x" aria-label="Close">&times;</button>
        </div>
        <div class="rrx-cols">
          <div class="rrx-col dy">
            <div class="rrx-col-h">Dynamic Yield<span>Mastercard geo data</span></div>
            <div class="rrx-pin">📍 ZIP 33139 · Miami Beach, FL</div>
            <div class="rrx-quote">“Shoppers in this area spend <b>~$420</b> on average.”</div>
            <ul class="rrx-list dim">
              <li>Third-party (purchased data)</li>
              <li>Aggregate — a postal-code average</li>
              <li>Static — yesterday’s cohort</li>
              <li>No idea what <i>this</i> person just did</li>
            </ul>
            <div class="rrx-foot dim">Personalizes a <b>postal code</b></div>
          </div>
          <div class="rrx-col opti">
            <div class="rrx-col-h">Optimizely<span>first-party · live at the edge</span></div>
            <div class="rrx-pin">👤 Anonymous shopper · live this session</div>
            <ul class="rrx-list">
              <li>Viewed <b>Tabby ×3</b></li>
              <li>Added the <b>$575</b> quilted Tabby</li>
              <li>Stalled <b>40s</b> at the payment step</li>
              <li>Matches the <b>Gen-Z BNPL</b> cohort</li>
              <li>Abandoned on shipping <b>twice</b> before</li>
            </ul>
            <div class="rrx-foot">Personalizes a <b>person</b>, in-session (&lt;50ms)</div>
          </div>
        </div>
        <div class="rrx-cta">→ So we recover <b>her</b> — with the installments she’ll actually use — not a zip-code average.</div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => { if (window.store && window.store.rrCloseContrast) window.store.rrCloseContrast(); };
    document.getElementById('rrx-overlay').addEventListener('click', close);
    document.getElementById('rrx-x').addEventListener('click', close);
  }

  // ── checkout overlay (Full #4) — real multi-step checkout that emits every funnel event ───────
  function rrcoTotal(store) {
    try {
      const t = (store.cart || []).reduce((s, ci) => { const p = store.byId && store.byId.get(ci.id); return s + ((p && p.price_usd) || 0); }, 0);
      return t > 0 ? t : 575;
    } catch (e) { return 575; }
  }
  function rrcoShowStep(step) {
    document.querySelectorAll('#rrco .rrco-sec').forEach((s) => s.classList.toggle('on', s.dataset.step === step));
    const order = { shipping: 0, payment: 1, done: 2 };
    const idx = order[step] == null ? 0 : order[step];
    document.querySelectorAll('#rrco .rrco-st').forEach((s, i) => s.classList.toggle('on', i <= idx));
  }
  function rrcoRenderPayment(store) {
    const sec = document.querySelector('#rrco .rrco-sec[data-step="payment"]');
    if (!sec) return;
    const total = rrcoTotal(store);
    const live = !!store._rrBnplLive;
    const inst = (total / 4).toFixed(2);
    const bnpl = live
      ? `<div class="rrco-bnpl">
           <span class="rrco-bnpl-tag">New · for you</span>
           <div class="rrco-bnpl-t">Pay in 4 — interest-free with Tabby</div>
           <div class="rrco-bnpl-sub">4 payments of $${inst} · 0% APR · nothing extra</div>
           <div class="rrco-bnpl-proof"><span class="stars">★★★★★</span> 4,200 Gen-Z shoppers chose installments this month</div>
         </div>
         <div class="rrco-alt">○ Pay $${total.toLocaleString()} in full</div>`
      : `<div class="rrco-field"><label>Card number</label><input value="•••• •••• •••• 4242" readonly></div>
         <div class="rrco-row2"><div class="rrco-field"><label>Expiry</label><input value="04/28" readonly></div><div class="rrco-field"><label>CVC</label><input value="•••" readonly></div></div>`;
    sec.innerHTML = `
      <div class="rrco-summary"><span class="rrco-sum-name">Your bag · Tabby Shoulder Bag</span><span class="rrco-sum-total">$${total.toLocaleString()}</span></div>
      ${bnpl}
      <button class="rrco-btn" onclick="store.rrcoPlace()">${live ? 'Pay in 4 — place order' : 'Place order'}</button>`;
  }
  function buildCheckout() {
    if (document.getElementById('rrco')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="rrco-overlay" id="rrco-overlay"></div>
      <div class="rrco" id="rrco" role="dialog" aria-label="Checkout">
        <div class="rrco-head"><span class="rrco-head-t">Secure checkout</span><span class="rrco-head-s">COACH</span><button class="rrco-x" id="rrco-x" aria-label="Close">&times;</button></div>
        <div class="rrco-steps"><span class="rrco-st on">Shipping</span> › <span class="rrco-st">Payment</span> › <span class="rrco-st">Done</span></div>
        <div class="rrco-body">
          <section class="rrco-sec on" data-step="shipping">
            <div class="rrco-field"><label>Email</label><input value="shopper@example.com"></div>
            <div class="rrco-field"><label>Address</label><input value="1100 Lincoln Rd"></div>
            <div class="rrco-row2"><div class="rrco-field"><label>City</label><input value="Miami Beach"></div><div class="rrco-field"><label>State</label><input value="FL"></div><div class="rrco-field"><label>ZIP</label><input value="33139"></div></div>
            <button class="rrco-btn" onclick="store.rrcoToPayment()">Continue to payment</button>
          </section>
          <section class="rrco-sec" data-step="payment"></section>
          <section class="rrco-sec" data-step="done">
            <div class="rrco-done"><div class="rrco-done-i">✓</div><div class="rrco-done-t">Order confirmed</div><div class="rrco-done-s">Thank you — your Tabby is on its way.</div></div>
          </section>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => { if (window.store && window.store.rrcoClose) window.store.rrcoClose(); };
    document.getElementById('rrco-x').addEventListener('click', close);
    document.getElementById('rrco-overlay').addEventListener('click', close);
  }

  function leakContent(leak) {
    if (!leak) return { cls: 'rr-leak', html: '' };
    const sev = leak.severity || 'low';
    const dollars = sev !== 'low' ? `<span>${money(leak.lostRevenueUsd)} recoverable</span>` : '';
    const skew = leak.cohortSkew ? `<span class="rr-skew">${esc(leak.cohortSkew)}</span>` : '';
    return { cls: `rr-leak sev-${sev}`, html: `<span class="rr-leak-d">▼ ${leak.dropPct}%</span>${dollars}${skew}` };
  }

  function funnelHtml(stages, leaks) {
    const top = stages[0].sessions || 1;
    const leakFrom = {};
    (leaks || []).forEach((l) => { leakFrom[l.fromStage] = l; });
    return stages.map((s) => {
      const w = Math.max(5, Math.round((s.sessions / top) * 100));
      const lc = leakContent(leakFrom[s.stage]);
      return `<div class="rr-stg">
        <div class="rr-stg-head"><span class="rr-stg-name">${esc(s.label)}</span><span class="rr-stg-num" id="rrnum-${s.stage}">${num(s.sessions)}</span></div>
        <div class="rr-bar" id="rrbar-${s.stage}" style="width:${w}%"></div>
        <div class="${lc.cls}" id="rrleak-${s.stage}">${lc.html}</div>
      </div>`;
    }).join('');
  }

  /** In-place animated update of the funnel bars + headline (keeps the CSS width transition). */
  function updateFunnel(brand, cohort) {
    const store = window.store;
    fetch(`/funnel?brand=${enc(brand)}&cohort=${enc(cohort)}`)
      .then((r) => r.json())
      .then((data) => {
        if (isStale(store, brand, cohort) || !data || !Array.isArray(data.stages) || !data.stages.length) return;
        const rec = document.getElementById('rr-rec'); if (rec) rec.textContent = money(data.recoverableRevenueUsd);
        const conv = document.getElementById('rr-conv'); if (conv) conv.textContent = data.overallConvPct + '%';
        const top = data.stages[0].sessions || 1;
        const leakFrom = {};
        (data.leaks || []).forEach((l) => { leakFrom[l.fromStage] = l; });
        let missing = false;
        data.stages.forEach((s) => {
          const bar = document.getElementById('rrbar-' + s.stage);
          const n = document.getElementById('rrnum-' + s.stage);
          const lk = document.getElementById('rrleak-' + s.stage);
          if (!bar || !n) { missing = true; return; }
          bar.style.width = Math.max(5, Math.round((s.sessions / top) * 100)) + '%';
          n.textContent = num(s.sessions);
          if (lk) { const lc = leakContent(leakFrom[s.stage]); lk.className = lc.cls; lk.innerHTML = lc.html; }
        });
        if (missing) renderRadar();
      })
      .catch(() => {});
  }

  function recoHtml(rec, i) {
    const kind = rec.remedy && rec.remedy.kind;
    return `
      <div class="rr-reco ${i === 0 ? 'top' : ''}">
        <div class="rr-reco-h"><span class="rr-kind k-${esc(kind)}">${esc(KIND_LABEL[kind] || kind)}</span><span class="rr-reco-rec">${money(rec.projectedRecoveryUsd)} recoverable</span></div>
        <div class="rr-reco-t">${esc(rec.remedy.title)}</div>
        <div class="rr-reco-a">→ <b>${esc(rec.audience.name)}</b> · ~${num(rec.audience.estimatedSize)} shoppers</div>
        <div class="rr-reco-w">${esc(rec.rationale)}</div>
        <button class="rr-launch" id="rr-launch-btn-${i}" onclick="store.rrLaunch(${i})">⚡ Launch experiment</button>
        <div class="rr-launch-out" id="rr-launch-${i}"></div>
      </div>`;
  }

  function renderRecos(brand, cohort) {
    const host = document.getElementById('rr-recos');
    if (!host) return;
    const store = window.store;
    store._rrRecos = [];
    fetch(`/funnel/diagnose?brand=${enc(brand)}&cohort=${enc(effCohort(cohort))}`)
      .then((r) => r.json())
      .then((d) => {
        if (isStale(store, brand, cohort)) return;
        const recos = (d && d.recommendations) || [];
        store._rrRecos = recos;
        host.innerHTML = recos.length ? `<div class="rr-recos-h">Recommended fixes · ${recos.length}</div>` + recos.map(recoHtml).join('') : '';
      })
      .catch(() => { host.innerHTML = ''; });
  }

  function renderRadar() {
    const store = window.store;
    const panel = document.getElementById('tab-radar');
    if (!store || !panel) return;
    const { brand, cohort } = viewOf(store);

    const brandPills = BRANDS.map((b) => `<button class="rr-pill ${b === brand ? 'on' : ''}" onclick="store.rrSetBrand('${esc(b)}')">${esc(b)}</button>`).join('');
    const cohortPills = COHORTS.map(([k, l]) => `<button class="rr-pill sm ${k === cohort ? 'on' : ''}" onclick="store.rrSetCohort('${k}')">${l}</button>`).join('');
    const ctrls = `
      <div class="rr-ctrls">
        <button class="rr-ctrl live ${store._rrLive ? 'on' : ''}" id="rr-live-btn" onclick="store.rrToggleLive()"><span class="dot"></span>Live traffic</button>
        <button class="rr-ctrl warn" onclick="store.rrBurst(false)">Simulate drop-off</button>
        <button class="rr-ctrl" onclick="store.rrBurst(true)">Recover</button>
        <button class="rr-ctrl" id="rr-reset-btn" onclick="store.rrReset()">↺ Reset demo</button>
        <button class="rr-ctrl" onclick="store.rrPlay()">▶ Play story</button>
        <button class="rr-ctrl" onclick="store.rrContrast()">◑ DY vs us</button>
      </div>
      <div class="rr-narrate" id="rr-narrate"></div>`;
    const shell = (inner) => `
      <div class="rr">
        <div class="rr-top"><div class="rr-ttl">Revenue Radar</div><div class="rr-sub">Where checkout revenue leaks — diagnosed live at the edge</div></div>
        <div class="rr-row">${brandPills}</div>
        <div class="rr-row rr-row-sm">${cohortPills}</div>
        ${ctrls}
        <div id="rr-body">${inner}</div>
      </div>`;
    panel.innerHTML = shell('<div class="rr-empty">Reading the funnel…</div>');

    fetch(`/funnel?brand=${enc(brand)}&cohort=${enc(cohort)}`)
      .then((r) => r.json())
      .then((data) => {
        if (isStale(store, brand, cohort)) return;
        const body = document.getElementById('rr-body');
        if (!body) return;
        if (!data || !Array.isArray(data.stages) || !data.stages.length) {
          body.innerHTML = '<div class="rr-empty">No funnel data for this view.</div>';
          return;
        }
        const headline = `
          <div class="rr-hl">
            <div><div class="rr-hl-val" id="rr-rec">${money(data.recoverableRevenueUsd)}</div><div class="rr-hl-lbl">recoverable checkout revenue</div></div>
            <div><div class="rr-hl-val" id="rr-conv">${data.overallConvPct}%</div><div class="rr-hl-lbl">overall conversion</div></div>
          </div>`;
        body.innerHTML = headline + `<div class="rr-funnel">${funnelHtml(data.stages, data.leaks)}</div><div class="rr-recos" id="rr-recos"></div>`;
        renderRecos(brand, cohort);
      })
      .catch(() => {
        const body = document.getElementById('rr-body');
        if (body) body.innerHTML = '<div class="rr-empty">Couldn’t reach the funnel service.</div>';
      });
  }

  function rrLaunch(idx) {
    const store = window.store;
    const rec = (store._rrRecos || [])[idx];
    if (!rec) return;
    const btn = document.getElementById('rr-launch-btn-' + idx);
    const out = document.getElementById('rr-launch-' + idx);
    if (btn) { btn.disabled = true; btn.textContent = 'Launching…'; }
    post('/experiment/launch', {
      name: rec.audience.name,
      audienceName: rec.audience.name,
      conditions: rec.audience.conditions,
      variations: rec.experiment.variations,
      metric: rec.experiment.metric,
      remedy: rec.remedy.kind,
    })
      .then((r) => r.json())
      .then((exp) => {
        if (btn) btn.textContent = '✓ Launched';
        const ro = exp.readout || exp;
        const liftRel = ro.liftRel != null ? ro.liftRel : exp.liftRel;
        const conf = ro.confidence != null ? ro.confidence : exp.confidence;
        const id = exp.experimentId || exp.experimentKey || exp.key || exp.id || rec.audience.name;
        const liftTxt = liftRel != null ? `<span class="rr-lift">+${liftRel}% lift</span>${conf != null ? ` · ${conf}% conf` : ''}` : 'measuring…';
        if (out) out.innerHTML = `<div class="rr-live-box">⚡ <b>Experiment live</b> — ${esc(String(id))}<br>control vs ${esc(rec.remedy.kind)} on purchase · ${liftTxt}</div>`;
        try { window.dispatchEvent(new CustomEvent('rr:launched', { detail: { rec, exp } })); } catch (e) {}
      })
      .catch(() => {
        if (out) out.innerHTML = '<div class="rr-live-box err">Launch failed — retry.</div>';
        if (btn) { btn.disabled = false; btn.textContent = '⚡ Launch experiment'; }
      });
  }

  function attach(store) {
    if (!document.getElementById('rr-css')) {
      const st = document.createElement('style');
      st.id = 'rr-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    store._rrBrand = store._rrBrand || 'Coach';
    store._rrCohort = store._rrCohort || 'all';
    store._rrRecos = store._rrRecos || [];
    store.renderRadar = renderRadar;
    store.rrLaunch = rrLaunch;
    store.rrSetBrand = function (b) { this._rrBrand = b; renderRadar(); };
    store.rrSetCohort = function (c) { this._rrCohort = c; renderRadar(); };

    // ── live motion ──────────────────────────────────────────────────────────
    store.rrToggleLive = function () {
      this._rrLive = !this._rrLive;
      const btn = document.getElementById('rr-live-btn');
      if (btn) btn.classList.toggle('on', this._rrLive);
      if (this._rrLive && !this._rrTimer) {
        this._rrTimer = setInterval(() => {
          if (this.activeTab !== 'radar' || !this._rrLive) return;
          const { brand, cohort } = viewOf(this);
          post('/funnel/sim/tick', { brand, sessions: 10 }).then(() => updateFunnel(brand, cohort)).catch(() => {});
        }, 1500);
      } else if (!this._rrLive && this._rrTimer) {
        clearInterval(this._rrTimer);
        this._rrTimer = null;
      }
    };
    // amplify-on-action: a presenter burst at the payment stage (the hero leak). convert=false swells, true recovers.
    store.rrBurst = function (convert) {
      const { brand, cohort } = viewOf(this);
      post('/funnel/sim/burst', { brand, cohort: effCohort(cohort), throughStage: 'add_payment_info', count: 600, convert: !!convert })
        .then(() => updateFunnel(brand, cohort)).catch(() => {});
    };
    store.rrReset = function () {
      const { brand, cohort } = viewOf(this);
      const btn = document.getElementById('rr-reset-btn');
      if (btn) btn.textContent = 'Resetting…';
      // FULL one-click reset to the clean seed baseline: wipe captured events AND the sim
      // overlay, and revert the in-session BNPL save to its "before" state. No curl needed.
      Promise.all([
        post('/operator/events/reset', { scope: 'all' }).catch(() => {}),
        post('/funnel/sim/reset', {}).catch(() => {}),
      ]).then(() => {
        this._rrBnplLive = false;
        if (btn) btn.textContent = '↺ Reset demo';
        updateFunnel(brand, cohort);
      });
    };

    // ▶ Play story — a self-driving narrated walk of the loop (diagnose → simulate → launch → recover).
    store.rrPlay = async function () {
      if (this._rrPlaying) return;
      this._rrPlaying = true;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const say = (t) => { const n = document.getElementById('rr-narrate'); if (n) { n.textContent = t; n.classList.add('show'); } };
      try {
        await post('/funnel/sim/reset', {}).catch(() => {});
        this._rrBrand = 'Coach'; this._rrCohort = 'all'; renderRadar(); await sleep(2000);
        say('Across all of Coach, checkout looks healthy — nothing jumps out.'); await sleep(2600);
        this._rrCohort = 'gen_z'; renderRadar(); await sleep(1900);
        say('But filter to Gen-Z and the truth appears: a 44% collapse at the payment step — $7,623 leaking.'); await sleep(3200);
        say('And it is happening at scale right now…'); this.rrBurst(false); await sleep(3000);
        say('Opal’s fix: installments (BNPL) + social proof for Gen-Z BNPL Hesitators.'); await sleep(3000);
        say('Launching a real Optimizely experiment — no developer, no analyst…'); this.rrLaunch(0); await sleep(3200);
        say('Live. Control vs BNPL on purchase, +48% projected lift — and the funnel recovers.');
      } finally {
        this._rrPlaying = false;
      }
    };

    store.rrContrast = function () {
      buildContrast();
      const o = document.getElementById('rrx-overlay'), m = document.getElementById('rrx');
      if (o) o.classList.add('open');
      if (m) m.classList.add('open');
    };
    store.rrCloseContrast = function () {
      const o = document.getElementById('rrx-overlay'), m = document.getElementById('rrx');
      if (o) o.classList.remove('open');
      if (m) m.classList.remove('open');
    };

    // ── checkout flow ────────────────────────────────────────────────────────
    store.rrcoEmit = function (et) {
      post('/funnel/event', { event_type: et, vuid: this.anonId, sessionId: this.sessionId, line: 'Tabby', price_usd: rrcoTotal(this) }).catch(() => {});
    };
    store.rrCheckout = function () {
      buildCheckout();
      if (this.closeCart) { try { this.closeCart(); } catch (e) {} }
      rrcoShowStep('shipping');
      document.getElementById('rrco-overlay').classList.add('open');
      document.getElementById('rrco').classList.add('open');
      this.rrcoEmit('begin_checkout');
    };
    store.rrcoToPayment = function () {
      this.rrcoEmit('add_shipping_info');
      rrcoRenderPayment(this);
      rrcoShowStep('payment');
      this.rrcoEmit('add_payment_info');
    };
    store.rrcoPlace = function () {
      this.rrcoEmit('purchase');
      rrcoShowStep('done');
    };
    store.rrcoClose = function () {
      const o = document.getElementById('rrco-overlay'), m = document.getElementById('rrco');
      if (o) o.classList.remove('open');
      if (m) m.classList.remove('open');
    };
    // Replace the storefront's fire-and-forget beginCheckout with the real multi-step flow.
    store.beginCheckout = function () { this.rrCheckout(); };

    // After a Launch the BNPL fix goes live for the segment → the checkout reshapes (BNPL save
    // appears at payment) AND the treatment cohort converts → the funnel leak recovers (loop closes).
    if (!store._rrLaunchHook) {
      store._rrLaunchHook = true;
      window.addEventListener('rr:launched', () => {
        if (window.store) window.store._rrBnplLive = true;
        setTimeout(() => { if (window.store && window.store.rrBurst) window.store.rrBurst(true); }, 1200);
      });
    }
    // The storefront's ↻ Restart (fires opal:reset) ALSO cleans the funnel back to baseline,
    // so kicking off a fresh demo run resets everything automatically — no curl, no manual step.
    if (!store._rrResetHook) {
      store._rrResetHook = true;
      window.addEventListener('opal:reset', () => {
        post('/operator/events/reset', { scope: 'all' }).catch(() => {});
        post('/funnel/sim/reset', {}).catch(() => {});
        if (window.store) window.store._rrBnplLive = false;
      });
    }
  }

  function boot() {
    if (window.store) attach(window.store);
    else setTimeout(boot, 60);
  }
  boot();
})();
