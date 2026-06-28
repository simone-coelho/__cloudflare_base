/* ============================================================================
 * Coach Storefront — GUIDED SALES DEMO
 *
 * The default view is a clean luxury store (coach.com-shaped). A presenter runs
 * the "Demo Director" (fixed bottom bar): each step auto-drives the store (with a
 * spotlight + simulated cursor), the store personalizes from the REAL edge
 * backend, and a plain-language callout explains the business value.
 *
 * REAL SEAMS — every personalization comes from the real endpoints:
 *   POST /realtime/action  {type, userId, data:{product_id,line}, source}
 *        -> { update: { data: { segments, decisions, recommendations,
 *                               sortOrder, journeyStage, sessionId } } }
 *   WS   /realtime/ws?userId=<anonId>           (operator-published pushes)
 *   POST /operator/audiences/suggest {nlPrompt} -> { drafts:[AudienceDef] }
 *   POST /operator/audiences/publish {audience} -> { audienceId }
 *
 * Decisions are keyed: hero_module, plp_sort, complete_the_look, promo_banner,
 * journey_message — each a {enabled, variationKey, reason, variables}. When
 * reason==='experiment' we badge it "A/B" in the engine overlay. recommendations
 * + sortOrder reshape the grids; journeyStage drives messaging.
 * ========================================================================== */

class CoachStorefront {
    constructor() {
        this.mintIds();
        this.ws = null;

        this.products = [];
        this.byId = new Map();
        this.byLine = new Map();
        this._reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

        // Bulletproof image fallback — a self-contained, on-brand placeholder (data URI: no network,
        // can NEVER 404) shown whenever a product image is absent or fails to load. Guarantees no
        // broken tile / hero / card can ever appear on stage, regardless of catalog data.
        this.PH_IMG = 'data:image/svg+xml,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500">' +
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#F0EBE2"/><stop offset="1" stop-color="#E2D8C8"/></linearGradient></defs>' +
            '<rect width="400" height="500" fill="url(#g)"/>' +
            '<text x="200" y="236" font-family="Georgia,serif" font-size="150" fill="#B8915A" fill-opacity="0.42" text-anchor="middle" dominant-baseline="central">C</text>' +
            '<text x="200" y="356" font-family="Georgia,serif" font-size="22" letter-spacing="7" fill="#8A6A38" fill-opacity="0.6" text-anchor="middle">COACH</text>' +
            '</svg>'
        );

        // personalization state (mirrors the engine response)
        this.segments = [];
        this.decisions = {};
        this._baseline = {};      // baseline (pre-personalization) zone captures for the [Compare] "before"
        this._cards = {};         // [Compare] card registry: id → { zone, beforeImg, afterImg, title }
        this._h2cP = null;        // lazy html2canvas loader promise
        this.journeyStage = 'early';
        this.recommendations = null;   // Product[] from engine
        this.sortOrder = null;         // string[] product ids from engine
        this.personalized = false;

        // Opal (chat island) → governed "preview as this audience" trigger for the live banner.
        window.addEventListener('opal:experience', (e) => { try { this.previewAudience(e.detail || {}); } catch (err) { console.error('previewAudience', err); } });
        // Opal launched an experiment → render its first variation live on the experiment surface.
        window.addEventListener('opal:experiment', (e) => { try { this.previewExperiment(e.detail || {}); } catch (err) { console.error('previewExperiment', err); } });

        // local browsing signals (drive copy + derivations between engine fields)
        this.eventCount = 0;
        this.productViews = 0;
        this.viewedLineCounts = {};
        this.dominantLine = null;
        this.currentPdpId = null;
        this.cart = [];
        this.wishlist = new Set();
        this.currentLook = null;
        this.eventLog = [];

        // demo director state
        this.demoActive = false;
        this.stepIndex = -1;
        this.autoplay = false;
        this.autoplayTimer = null;
        this.busy = false;             // guards against double-advance during an action
        this.opalAudience = null;      // the draft AudienceDef the operator will publish

        // requirements checklist + new-panel state
        this.ticked = new Set();       // feature indices already demonstrated (persist across session)
        this._mabTimer = null;

        // Signal-Led Moment encore (doc 12) — a 3-scene arc behind a button AFTER beat 15.
        // The core demo stays EXACTLY 15 beats; the arc has its own index + chrome, never touches featureList.
        this.MOMENT_KEY = 'xsurf_tiktok_tabby_moment';
        this._armed = false;   // experiment surfaces render ONLY after a real user gesture — nothing shows #xsurf on a fresh load (kills any replayed-launch flash, even with stale cached island code)
        this.encoreActive = false; this.arcIndex = -1; this.signalArc = null;
        this._signal = null; this._momentImageUrl = null;
        this._momentPending = false;   // GENERATE in flight → we own the reveal (image must be ready first)
        this._momentRevealed = false;  // takeover shown → ignore late launches re-rendering it
        this._momentLaunched = false;  // a real launch (Opal or deterministic fallback) fired
        this._momentClockTimer = null; this._genTimer = null;

        // sidebar / tabs / persistent markers / session changelog
        this.activeTab = 'opal';       // Opal · Capabilities · Engine
        this.markers = new Map();      // selector -> { label, inside } persistent personalization markers
        this.changeLog = [];           // [{ idx, text }] "what changed this session"
        this.changeIdx = new Set();    // dedupe changelog by beat index
        this._ba = null;               // pending Before→Now narration for the current beat

        this.init();
    }

    mintIds() {
        this.anonId = 'v-' + Math.random().toString(36).slice(2, 11).toUpperCase();
        this.sessionId = 's-' + Date.now().toString(36).toUpperCase();
    }

    async init() {
        await this.loadCatalog();
        this.renderHomeCold({ skipHero: true });   // hero painted ONCE by applyGeoColdStart below — no "Tabby Shop → Season Edit" cold-start flash
        this.renderPLP(this.bagsCatalog().slice(0, 16), { flip: false });
        this.renderCategoryRail();
        this.openDefaultPdp();
        this.updateEngine();
        this.connectWebSocket();
        this.buildSteps();
        this.buildChecklist();
        this.previewStep(0);   // step-progress visible on load — never gated behind clicking Next
        this.initSidebarResize();
        this.initPzDrag();
        this.applyGeoColdStart();   // edge-geo cold-start: adapt the first paint to where they are
        this.initCompareDrag();
        // Deep link: /storefront?experiment=<key> renders that experiment's surface (readoutUrl target).
        // (B) The Signal-Led Moment is an ENCORE, not a default homepage surface — a stale
        // ?experiment=<moment> must never hijack the store on load: strip it from the URL and skip the
        // takeover. Other experiments still deep-link to their readout as before.
        try {
            const _ek = new URLSearchParams(location.search).get('experiment');
            if (_ek === this.MOMENT_KEY) { this._clearExperimentQuery(); }
            else if (_ek) { setTimeout(() => this.previewExperiment({ experimentKey: _ek }), 500); }
        } catch (e) {}
        // Arm experiment surfaces on the FIRST real user gesture. On a fresh page load there is no gesture,
        // so renderExperimentSurface() is a no-op — a replayed Opal launch can never flash the takeover
        // before the user acts. Every legitimate render (beats, encore, ⌘K, buy-signal) is preceded by a
        // click/keypress, so this never blocks an intended surface.
        ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { this._armed = true; }, { once: true }));
        window.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); this.openCmdk(); }
        });
        // Photograph the virgin baseline ("before" for [Compare]) once the cold start has settled.
        setTimeout(() => { try { this.snapshotBaselines(); } catch (e) {} }, 2600);
    }

    /* ── Catalog ─────────────────────────────────────────────────────────── */
    async loadCatalog() {
        try {
            const res = await fetch('/data/coach-catalog.json');
            const json = await res.json();
            this.products = Array.isArray(json) ? json : (json.products || []);
        } catch (e) {
            console.error('Catalog load failed', e);
            this.products = [];
        }
        this.byId = new Map(this.products.map((p) => [p.id, p]));
        for (const p of this.products) {
            if (!this.byLine.has(p.line)) this.byLine.set(p.line, []);
            this.byLine.get(p.line).push(p);
        }
        // Pre-generated styled-scene manifest (instant heroes for the headline queries).
        // Non-fatal: novel queries fall back to live /ai/scene, then to the ranked grid.
        try {
            const r = await fetch('/images/generated/manifest.json');
            this.sceneManifest = r.ok ? await r.json() : {};
        } catch { this.sceneManifest = {}; }
        // Occasion × SKU scene grid — instant, PRODUCT-ACCURATE heroes across many occasions
        // (so the Edit/look can match the shopper's personalized #1, and far more queries skip live gen).
        this.gridByOcc = { search: {}, concierge: {} };
        try {
            const rg = await fetch('/images/generated/scene-grid.json');
            const grid = rg.ok ? await rg.json() : {};
            for (const k in grid) {
                const e = grid[k]; const t = e.type === 'concierge' ? 'concierge' : 'search';
                (this.gridByOcc[t][e.occ] = this.gridByOcc[t][e.occ] || []).push({ productId: e.productId, asset: e.asset, productName: e.productName });
            }
        } catch { /* grid optional */ }
    }
    lineItems(line) { return this.byLine.get(line) || []; }
    isBag(p) { return p.category === 'Handbags'; }
    bagsCatalog() { return this.products.filter((p) => this.isBag(p)); }
    topCatalog(n) { return this.bagsCatalog().slice(0, n); }

    /* ════════════════════════════════════════════════════════════════════════
     * TRANSPORT
     * ════════════════════════════════════════════════════════════════════════ */
    connectWebSocket() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${location.host}/realtime/ws?userId=${this.anonId}`;
        try { this.ws = new WebSocket(url); } catch (e) { return; }

        this.ws.onopen = () => this.setWs('connected');
        this.ws.onclose = () => { this.setWs('reconnecting'); setTimeout(() => this.connectWebSocket(), 3000); };
        this.ws.onerror = () => this.setWs('error');
        this.ws.onmessage = (ev) => {
            try { this.handleWsMessage(JSON.parse(ev.data)); } catch (e) { /* ignore */ }
        };
    }
    setWs(s) { const el = document.getElementById('eng-ws'); if (el) el.textContent = s; }

    handleWsMessage(msg) {
        const data = msg.data || {};
        if (msg.type === 'audience_published' || data.audienceWentLive) {
            const a = data.audienceWentLive || msg.audienceWentLive;
            this.logEvent('push', 'audience_published', a ? (a.name || a.key) : 'new audience live');
        }
        if (msg.type === 'personalization_update' || msg.type === 'segment_update' || data.segments) {
            const ms = data.decisionMs != null ? data.decisionMs : null;
            this.applyUpdate(data, ms, true);
        }
    }

    /* POST a shopper action; the response carries the personalization update. */
    async sendAction(type, payload, meta) {
        this.eventCount++;
        const t0 = performance.now();
        let result = null;
        try {
            const res = await fetch('/realtime/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    type,
                    userId: this.anonId,
                    anonymousId: this.anonId,
                    sessionId: this.sessionId,
                    data: payload,
                    source: 'coach-storefront',
                    timestamp: Date.now(),
                }),
            });
            result = await res.json();
        } catch (e) { console.error('action POST failed', e); }
        const rtt = Math.round(performance.now() - t0);

        const update = (result && result.update && result.update.data) ? result.update.data : null;
        this.logEvent('post', type, (meta && meta.label) || (payload && (payload.productId || payload.path)) || '', rtt, update);
        this.applyUpdate(update || {}, rtt, false);
        return result;
    }

    /* ════════════════════════════════════════════════════════════════════════
     * APPLY ENGINE UPDATE → every store zone
     * ════════════════════════════════════════════════════════════════════════ */
    applyUpdate(data, decisionMs, fromPush) {
        if (Array.isArray(data.segments) && data.segments.length) this.segments = data.segments;
        if (data.decisions && typeof data.decisions === 'object') this.decisions = data.decisions;
        this.renderBanner();
        if (data.journeyStage) this.journeyStage = data.journeyStage; else this.journeyStage = this.deriveStage();
        if (Array.isArray(data.recommendations) && data.recommendations.length) this.recommendations = data.recommendations;
        if (Array.isArray(data.sortOrder) && data.sortOrder.length) this.sortOrder = data.sortOrder;

        const hasAffinity = this.dominantLine || this.segments.some((s) => !/new_visitor|new_user|cold_start/.test(s));
        if (hasAffinity) this.personalized = true;

        // Resolve each module from the engine decision (or a sensible local view).
        const hero = this.resolveHero();
        const sort = this.resolveSort();
        const ctl = this.resolveCompleteLook();

        // Render in a short luxury cascade (one zone at a time).
        this.renderHero(hero);
        setTimeout(() => this.renderCurated(), 130);
        setTimeout(() => this.applySort(sort), 260);
        setTimeout(() => this.applyCompleteLook(ctl), 340);
        this.applyStageCopy(this.journeyStage);
        this.renderStory(this.storyForStage(this.journeyStage));
        this.refreshPdpRecs();
        this.refreshCartRec();
        this.updateEngine(decisionMs);
    }

    deriveStage() {
        if (this.cart.length > 0) return 'late';
        if (this.productViews >= 2 || this.wishlist.size > 0) return 'mid';
        return 'early';
    }
    recomputeDominantLine() {
        let best = null, n = -1;
        for (const [line, c] of Object.entries(this.viewedLineCounts)) if (c > n) { n = c; best = line; }
        this.dominantLine = best;
    }

    decVars(flag) { const d = this.decisions[flag]; return d && d.enabled ? (d.variables || {}) : null; }
    decReason(flag) { const d = this.decisions[flag]; return d ? d.reason : null; }
    /* Opal-personalized banner (Mode-B): render personalized_banner.message as a top ribbon. */
    renderBanner() {
        const el = document.getElementById('pz-banner');
        const msgEl = document.getElementById('pz-banner-msg');
        if (!el || !msgEl) return;
        const v = this.decVars('personalized_banner');
        const msg = v && typeof v.message === 'string' ? v.message.trim() : '';
        if (msg) { msgEl.textContent = msg; el.classList.add('show'); el.classList.remove('publishing'); }
        else if (!el.classList.contains('publishing')) { el.classList.remove('show'); }
    }
    /* Governed trigger: after Opal creates a banner rule, "preview as that audience" — poll the live
     * Optimizely decision (handles datafile propagation) with the audience's attributes, then render the
     * real flag's message. Falls back to Opal's message if the CDN is still catching up. */
    async previewAudience(detail) {
        const el = document.getElementById('pz-banner');
        const msgEl = document.getElementById('pz-banner-msg');
        const tagEl = document.getElementById('pz-banner-tag');
        const attrs = (detail && detail.previewAttributes) || {};
        // Remember every audience we create this session so the ⌘K palette can force any of them.
        if (detail && detail.audienceName) {
            this.bannerExperiences = this.bannerExperiences || [];
            const k = detail.audienceName.toLowerCase();
            if (!this.bannerExperiences.some((x) => (x.audienceName || '').toLowerCase() === k))
                this.bannerExperiences.push({ audienceName: detail.audienceName, attributes: attrs, message: detail.message || '' });
        }
        if (el && msgEl) {
            msgEl.textContent = 'Publishing your personalized message to the edge…';
            if (tagEl) tagEl.textContent = 'Opal · publishing';
            el.classList.add('show', 'publishing');
        }
        let got = null;
        for (let i = 0; i < 12; i++) {
            try {
                const res = await fetch('/optimizely/preview', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: this.anonId, userAttributes: attrs, flag: 'personalized_banner' }),
                });
                const json = await res.json();
                if (json && json.enabled && json.variables && json.variables.message) { got = json; break; }
            } catch (e) { /* retry through propagation */ }
            await this.sleep(2500);
        }
        if (tagEl) tagEl.textContent = 'Personalized live by Opal';
        if (el) el.classList.remove('publishing');
        if (got) {
            this.decisions['personalized_banner'] = { enabled: true, variables: got.variables, reason: 'Optimizely flag (created by Opal)' };
        } else if (detail && detail.message) {
            this.decisions['personalized_banner'] = { enabled: true, variables: { message: detail.message }, reason: 'Optimizely flag (created by Opal)' };
        }
        this.renderBanner();
    }

    /* ════ Experiment Surface — decide → render → force (clones previewAudience, for experiment flags) ════ */
    /* Poll the live Optimizely decision for an experiment flag (optionally FORCED to a variation), then
     * render the self-contained #xsurf component from that variation's `payload` creative. */
    async previewExperiment(detail) {
        detail = detail || {};
        const expKey = detail.experimentKey || detail.flagKey;
        if (!expKey) return;
        const variationKey = detail.variationKey || null;
        if (detail.variations) {   // remember launched experiments so ⌘K can force any variation
            this.experiments = this.experiments || [];
            const found = this.experiments.find((e) => e.experimentKey === expKey);
            if (found) found.variations = detail.variations;
            else this.experiments.push({ experimentKey: expKey, variations: detail.variations, metricEventKey: detail.metricEventKey });
        }
        this._activeExperiment = { experimentKey: expKey, metricEventKey: detail.metricEventKey || (this._activeExperiment && this._activeExperiment.experimentKey === expKey ? this._activeExperiment.metricEventKey : null) };
        // Signal-Led Moment — ANTI-FLASH GUARD. The takeover renders ONLY when genuinely driven: either the
        // encore is running (this.encoreActive) or the call carries an explicit `creative` (⌘K force /
        // runMomentServe reveal). A BARE opal:experiment for the moment — e.g. the Opal island replaying a
        // persisted launch on page load (ANY hydration-timing race), or any auto re-fire — carries no
        // `creative` and isn't in the encore, so it must NEVER paint the takeover. We still record the launch
        // (so ⌘K can force it later); we just don't render. THIS is the definitive kill for the on-load flash.
        if (this._isMomentKey(expKey)) {
            if (!detail.creative && !this.encoreActive) { this._momentLaunched = true; return; }
            // During GENERATE the encore owns the reveal (wait for the real image); after reveal, block a late
            // no-creative re-render from swapping the winner.
            if (this._momentPending || (this._momentRevealed && !detail.creative)) { this._momentLaunched = true; return; }
        }
        // 1) Render INSTANTLY from the scenario creative (never blank while the datafile propagates).
        const creative = detail.creative || await this._xsurfCreative(expKey, variationKey);
        if (creative) {
            this.decisions[expKey] = { enabled: true, variables: { payload: JSON.stringify(creative), variant: creative.key }, variationKey: creative.key, reason: 'experiment' };
            if (!detail.noNav) { try { this.go('home', { silent: true }); } catch (e) {} }
            this.renderExperimentSurface(expKey);
        }
        // 2) Confirm via the REAL Optimizely decision in the background (proves the decide once propagated).
        this._confirmExperimentDecision(expKey, variationKey, detail.attributes || {});
    }

    /* Look up a variation's creative from the preset scenarios (cached) for instant render. */
    async _xsurfCreative(expKey, variationKey) {
        try {
            if (!this._xsurfScenarios) { const r = await fetch('/experiment/scenarios'); const j = await r.json(); this._xsurfScenarios = j.scenarios || []; }
            const sc = (this._xsurfScenarios || []).find((s) => s.key === expKey);
            if (!sc) return null;
            const list = sc.creatives || [];
            return (variationKey && list.find((c) => c.key === variationKey)) || list[0] || null;
        } catch (e) { return null; }
    }

    /* Poll the live Optimizely decision (optionally forced) and re-render once the datafile has the flag. */
    async _confirmExperimentDecision(expKey, variationKey, attrs) {
        for (let i = 0; i < 8; i++) {
            try {
                const res = await fetch('/optimizely/preview', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: this.anonId, userAttributes: attrs || {}, flag: expKey, variationKey }),
                });
                const json = await res.json();
                if (json && json.enabled && json.variables && json.variables.payload) {
                    this.decisions[expKey] = { enabled: true, variables: json.variables, variationKey: json.variationKey, reason: 'experiment' };
                    this.renderExperimentSurface(expKey);
                    return;
                }
            } catch (e) { /* retry through propagation */ }
            await this.sleep(2500);
        }
    }

    /* Render #xsurf from the decided experiment's `payload` creative (pure data, no DOM rebuild). */
    renderExperimentSurface(expKey) {
        const root = document.getElementById('xsurf'); if (!root) return;
        // HARD GATE: never show an experiment surface before the first real user gesture. A launch replayed
        // by the Opal island on page (re)load would otherwise flash the takeover, then swap to the normal
        // store. This is the SINGLE chokepoint for showing #xsurf, so gating here kills the flash for good.
        if (!this._armed) { root.hidden = true; root.removeAttribute('data-moment'); const _vh = document.getElementById('view-home'); if (_vh) _vh.classList.remove('xsurf-hero', 'moment-active'); return; }
        const v = expKey ? this.decVars(expKey) : null;
        let creative = null;
        if (v && v.payload) { try { creative = JSON.parse(v.payload); } catch (e) { creative = null; } }
        const vh = document.getElementById('view-home');
        if (!creative) { root.hidden = true; root.removeAttribute('data-moment'); if (vh) vh.classList.remove('xsurf-hero'); return; }
        // Signal-Led Moment (doc 12 §6 C2): render the DISTINCT full-bleed takeover, preferring the discrete
        // §4.3 feature variables over `payload` when the confirmed decision provides them.
        if (this._isMomentKey(expKey)) { this.renderMomentTakeover(this._discreteToCreative(v, creative)); return; }
        root.removeAttribute('data-moment');   // any non-moment surface must never carry takeover styling
        this._xsurfActive = { experimentKey: expKey, creative };
        root.dataset.layout = creative.layout || 'hero';
        root.dataset.theme = creative.theme || 'noir';
        const p = creative.productId && this.byId.get(creative.productId);
        const img = creative.image || (p && p.image_url) || '';
        document.getElementById('xsurf-art').style.backgroundImage = img ? `url("${img}")` : '';
        document.getElementById('xsurf-eyebrow').textContent = creative.eyebrow || '';
        document.getElementById('xsurf-headline').textContent = creative.headline || '';
        document.getElementById('xsurf-subcopy').textContent = creative.subcopy || '';
        document.getElementById('xsurf-offer').textContent = creative.offer || '';
        const form = document.getElementById('xsurf-capture');
        const cap = creative.captureType || 'none';
        form.dataset.capture = cap;
        const input = document.getElementById('xsurf-input');
        input.type = cap === 'phone' ? 'tel' : cap === 'email' ? 'email' : 'text';
        input.placeholder = creative.capturePlaceholder || (cap === 'email' ? 'Email address' : cap === 'phone' ? 'Mobile number' : '');
        input.value = '';
        document.getElementById('xsurf-cta').textContent = creative.ctaLabel || 'Shop';
        const tag = document.getElementById('xsurf-flag');
        if (tag) tag.textContent = creative.badge || ('Experiment · ' + (v.variant || creative.key || 'live'));
        root.hidden = false;
        if (vh) vh.classList.toggle('xsurf-hero', (creative.layout || 'hero') === 'hero');
        this.trackXsurf('xsurf_impression');
    }

    /* ════════════════════════════════════════════════════════════════════════
     * SIGNAL-LED MOMENT — takeover hero render (doc 12 §6 C2, Decision #8)
     * ════════════════════════════════════════════════════════════════════════ */
    _isMomentKey(k) { return k === this.MOMENT_KEY; }

    /* Build a creative from the discrete §4.3 feature variables, preferring them over the payload base
     * (doc 12 §4.3: "the moment render prefers the discrete variables when present"). undefined/'' → base. */
    _discreteToCreative(v, base) {
        v = v || {}; base = base || {};
        const pick = (k, d) => (typeof v[k] === 'string' && v[k] !== '') ? v[k] : d;
        return {
            key: v.variant || base.key || 'as_seen_tiktok',
            layout: pick('layout', base.layout || 'hero'),
            theme: pick('theme', base.theme || 'tan'),
            image: pick('hero_image', base.image || ''),
            eyebrow: pick('eyebrow', base.eyebrow || ''),
            headline: pick('headline', base.headline || ''),
            subcopy: pick('subcopy', base.subcopy || ''),
            offer: pick('offer', base.offer || ''),
            ctaLabel: pick('cta_label', base.ctaLabel || 'Shop the Tabby'),
            ctaAction: pick('cta_action', base.ctaAction || 'navigate'),
            badge: pick('badge', base.badge || 'Signal-led · trending'),
            productId: base.productId || 'COA-CH857',
        };
    }

    /* Render the DISTINCT full-bleed takeover hero into #xsurf (the SERVE climax).
     * CRITICAL (prior "two heroes" bug): we keep data-layout="hero" and set root.hidden=false, so the
     * frozen CSS rule `#view-home #xsurf[data-layout="hero"]:not([hidden]) ~ #hero { display:none !important }`
     * forces the default #hero to a COMPUTED display:none — guaranteed by an !important rule keyed on #xsurf's
     * OWN rendered state, NOT by the [hidden] attribute on #hero and NOT by a specificity-fragile class. The
     * extra xsurf-hero class + moment-active class are belt-and-suspenders; the sibling rule is load-bearing. */
    renderMomentTakeover(creative) {
        const root = document.getElementById('xsurf'); if (!root || !creative) return;
        this._xsurfActive = { experimentKey: this.MOMENT_KEY, creative };
        root.dataset.layout = 'hero';            // keep hero-layout → the hard hero-hide rule stays active
        root.dataset.theme = creative.theme || 'tan';
        root.dataset.moment = 'takeover';        // distinct full-bleed styling (does not affect the hide rule)
        const p = creative.productId && this.byId.get(creative.productId);
        const img = creative.image || (p && p.image_url) || '';
        document.getElementById('xsurf-art').style.backgroundImage = img ? `url("${img}")` : '';
        document.getElementById('xsurf-eyebrow').textContent = creative.eyebrow || '';
        document.getElementById('xsurf-headline').textContent = creative.headline || '';
        document.getElementById('xsurf-subcopy').textContent = creative.subcopy || '';
        document.getElementById('xsurf-offer').textContent = creative.offer || '';
        const form = document.getElementById('xsurf-capture'); form.dataset.capture = 'none';
        const input = document.getElementById('xsurf-input'); input.type = 'text'; input.value = ''; input.placeholder = '';
        document.getElementById('xsurf-cta').textContent = creative.ctaLabel || 'Shop the Tabby';
        const tag = document.getElementById('xsurf-flag'); if (tag) tag.textContent = creative.badge || 'Signal-led · trending';
        root.hidden = false;                     // not hidden → :not([hidden]) matches → #hero computed display:none
        const vh = document.getElementById('view-home'); if (vh) vh.classList.add('xsurf-hero');
        this.trackXsurf('xsurf_impression');
    }

    /* The winner creative for the moment: prefer the discrete §4.3 variables off a confirmed decision,
     * else the scenario's canned on-brand fields (deterministic fallback — identical downstream). */
    async momentCreative() {
        const base = await this._xsurfCreative(this.MOMENT_KEY, 'as_seen_tiktok');
        const v = this.decVars(this.MOMENT_KEY);
        if (v && (v.headline || v.hero_image || v.eyebrow)) return this._discreteToCreative(v, base);
        return base || this._discreteToCreative(null, {
            key: 'as_seen_tiktok', eyebrow: 'As seen on TikTok', headline: "The Tabby everyone's talking about",
            subcopy: 'Trending in NY right now', offer: 'Trending now', badge: 'Signal-led · trending',
        });
    }

    /* CTA / capture submit on the experiment surface → fire the event (our stream + Optimizely metric). */
    xsurfSubmit(event) {
        if (event) event.preventDefault();
        const cr = this._xsurfActive && this._xsurfActive.creative; if (!cr) return false;
        const cap = cr.captureType || 'none';
        if (cap === 'email' || cap === 'phone') {
            this.trackXsurf(cap === 'email' ? 'email_capture' : 'phone_capture'); this.trackXsurf('lead_capture');
            const head = document.getElementById('xsurf-headline'); if (head) head.textContent = 'Thank you — your code is on its way.';
            const form = document.getElementById('xsurf-capture'); if (form) form.style.display = 'none';
        } else if ((cr.ctaAction || 'navigate') === 'addToCart' && cr.productId) {
            this.trackXsurf('xsurf_click'); this.addToCart(cr.productId);
        } else if (cr.productId) {
            this.trackXsurf('xsurf_click'); this.openPdp(cr.productId);
        } else {
            this.trackXsurf('xsurf_click');
        }
        return false;
    }

    /* Fire an experiment event to BOTH our demo stream (Engine) and Optimizely's metric collector. */
    trackXsurf(eventKey) {
        const exp = this._activeExperiment || {};
        const tags = { experiment: exp.experimentKey || (this._xsurfActive && this._xsurfActive.experimentKey) || '', variant: (this._xsurfActive && this._xsurfActive.creative && this._xsurfActive.creative.key) || '' };
        try { this.sendAction(eventKey, tags); } catch (e) {}
        try { fetch('/optimizely/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: this.anonId, eventKey, userAttributes: {}, eventTags: tags }) }); } catch (e) {}
    }

    clearForcedExperiment() {
        const root = document.getElementById('xsurf'); if (root) { root.hidden = true; root.removeAttribute('data-moment'); }
        const vh = document.getElementById('view-home'); if (vh) vh.classList.remove('xsurf-hero');
        this._xsurfActive = null;
    }

    /* (A) Strip ?experiment=<key> (and the #engine readout hash) from the URL so a reload/reset never
     * re-fires the on-load deep-link. No-op if absent. */
    _clearExperimentQuery() {
        try {
            const u = new URL(location.href);
            if (!u.searchParams.has('experiment')) return;
            u.searchParams.delete('experiment');
            const hash = u.hash === '#engine' ? '' : u.hash;
            history.replaceState(null, '', u.pathname + u.search + hash);
        } catch (e) {}
    }

    /* Beat helper: render the experiment surface for a scenario AND create the real Optimizely flag. */
    async runExperimentScenario(scenarioId, variationKey, opts) {
        opts = opts || {};
        const expKey = 'xsurf_' + scenarioId;
        // 1) Render the surface instantly (the "comes to life" moment); opts.noNav keeps the current view.
        await this.previewExperiment({ experimentKey: expKey, variationKey, noNav: opts.noNav });
        // 2) Create the REAL flag in the background (so the Optimizely artifact exists for "not a mockup").
        try {
            const res = await fetch('/experiment/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: scenarioId }) });
            const exp = await res.json();
            this._lastExperiment = exp;
            if (exp && exp.variations) {
                this.experiments = this.experiments || [];
                if (!this.experiments.some((e) => e.experimentKey === exp.experimentKey)) this.experiments.push({ experimentKey: exp.experimentKey, variations: exp.variations, metricEventKey: exp.metricEventKey });
            }
        } catch (e) { /* surface already rendered from the scenario; the real flag is best-effort */ }
        return expKey;
    }

    /* Buy-signal handler: ready-to-buy detected → log it + launch a pay-over-time experiment surface. */
    async onReadyToBuy() {
        try {
            this.logActivity({
                usecase: 'Buy signal · ready-to-buy',
                headline: 'She added to cart — acting on the intent',
                signal: 'Cart add → journey stage <strong>ready-to-buy</strong>.',
                decision: 'Launch a <strong>pay-over-time</strong> experiment to convert the basket.',
                segment: this.activitySegment(),
                evidence: this.activityEvidence(),
            });
        } catch (e) {}
        try { await this.runExperimentScenario('bnpl_rogue', 'pay_in_4', { noNav: true }); } catch (e) {}
    }

    resolveHero() {
        const v = this.decVars('hero_module');
        const line = (v && v.anchorLine) || this.dominantLine;
        if (v && v.module === 'premium_hero') return this.heroPremium(line);
        if (line) return this.heroForLine(line);
        return this.heroFallback();
    }
    resolveSort() {
        const v = this.decVars('plp_sort');
        if (v && v.sort) return { sort: v.sort, anchorLine: v.anchorLine || this.dominantLine };
        if (this.dominantLine) return { sort: 'line_first', anchorLine: this.dominantLine };
        if (this.personalized) return { sort: 'recommended' };
        return { sort: 'featured' };
    }
    resolveCompleteLook() {
        const v = this.decVars('complete_the_look');
        const line = (v && v.anchorLine) || this.dominantLine ||
            (this.currentPdpId && this.byId.get(this.currentPdpId)?.line);
        const midFunnel = this.journeyStage !== 'early' && !!this.currentPdpId;
        return {
            on: !!v || midFunnel,
            line: line || 'Tabby',
            productIds: (v && Array.isArray(v.productIds)) ? v.productIds : null,
            reason: this.decReason('complete_the_look'),
        };
    }

    /* ════════════════════════════════════════════════════════════════════════
     * HERO
     * ════════════════════════════════════════════════════════════════════════ */
    heroFallback() {
        return { eyebrow: 'Coach Originals', title: 'The Tabby Shop',
            sub: 'Our most-loved shoulder bag, reimagined in heritage leathers for the new season.',
            cta: 'Shop New Arrivals', line: 'Tabby', art: this.lineImage('Tabby') };
    }
    heroForLine(line) {
        return { eyebrow: `${line} · Curated for you`, title: `Your ${line}, your way`,
            sub: `Hand-picked ${line} silhouettes and the pieces that complete them.`,
            cta: `Shop ${line}`, line, art: this.lineImage(line) };
    }
    heroPremium(line) {
        return { eyebrow: 'The Elevated Edit', title: 'Considered, not ordinary',
            sub: 'An elevated selection in our finest leathers — chosen for the discerning eye.',
            cta: 'Explore the Edit', line: line || 'Tabby', art: this.lineImage(line || 'Tabby') };
    }
    lineImage(line) {
        const p = this.lineItems(line).find((x) => this.isBag(x) && x.image_url) || this.bagsCatalog().find((x) => x.image_url);
        return p ? p.image_url : null;
    }

    renderHero(content) {
        const el = document.getElementById('hero-content');
        const art = document.getElementById('hero-art');
        const fill = () => {
            el.innerHTML = `
                <div class="hero-eyebrow">${content.eyebrow}</div>
                <h1 class="hero-title">${content.title}</h1>
                <p class="hero-sub">${content.sub}</p>
                <button class="hero-cta" onclick="store.go('plp')">${content.cta}</button>`;
            if (art) art.style.backgroundImage = content.art ? `url("${content.art}")` : 'none';
            this.renderMarkers();   // re-assert hero marker after content swap
        };
        if (el.dataset.title === content.title) return;
        const first = !el.innerHTML.trim();
        el.dataset.title = content.title;
        if (first) { fill(); return; }
        // Morph the reshape via the View Transitions API (Keynote "Magic Move"); the
        // view-transition-name on .hero-content scopes it to the hero. Falls back to the cross-fade.
        if (document.startViewTransition && !this._reduceMotion) {
            try { document.startViewTransition(() => fill()); return; } catch (e) { /* fall through to fade */ }
        }
        el.classList.add('fading');
        setTimeout(() => { fill(); el.classList.remove('fading'); }, 320);
    }

    /* ════════════════════════════════════════════════════════════════════════
     * CURATED GRID (home)
     * ════════════════════════════════════════════════════════════════════════ */
    renderHomeCold(opts) {
        // Paint the hero ONCE, geo-correct, to kill the cold-start "Tabby Shop → Season Edit" flash.
        // First load: geo isn't known yet, so init passes {skipHero:true} and applyGeoColdStart paints the
        // hero as the FIRST render (renderHero fills directly — no View-Transition cross-fade/ghost). On
        // reset, geo is already known → _coldHero() returns the season hero, and the same title
        // short-circuits renderHero (no swap).
        if (opts && opts.skipHero) {
            // Never blank: show the hero ART immediately (the SAME bag in every cold-start hero); the season
            // TITLE is painted once by applyGeoColdStart (no "Tabby Shop" first, no swap/ghost).
            const _art = document.getElementById('hero-art'); const _a = (this.heroFallback() || {}).art;
            if (_art && _a) _art.style.backgroundImage = `url("${_a}")`;
        } else {
            this.renderHero(this._coldHero());
        }
        this.renderCurated();
        this.renderStory(this.storyForStage('early'));
    }
    /* The cold-start hero: the geo/season edit if we already know where the visitor is, else the default. */
    _coldHero() {
        if (this.geo && this.geo.season && !this.personalized) {
            const season = this.geo.season;
            const cap = season.charAt(0).toUpperCase() + season.slice(1);
            const palette = this._seasonPalette(season);
            return { eyebrow: `Your ${season} edit`, title: `The ${cap} Edit`, sub: `No history yet — so we're leading with ${palette}, right for the season where you are.`, cta: 'Shop the edit', art: (this.heroFallback() || {}).art };
        }
        return this.heroFallback();
    }
    curatedItems() {
        if (this.recommendations) return this.recommendations.filter((p) => this.isBag(p)).slice(0, 8);
        if (this.dominantLine) {
            const same = this.lineItems(this.dominantLine).filter((p) => this.isBag(p));
            const rest = this.bagsCatalog().filter((p) => p.line !== this.dominantLine);
            return [...same, ...rest].slice(0, 8);
        }
        return this.topCatalog(8);
    }
    renderCurated() {
        const grid = document.getElementById('curated-grid');
        const title = document.getElementById('curated-title');
        const eyebrow = document.getElementById('curated-eyebrow');
        if (this.personalized) {
            title.textContent = this.dominantLine ? `The ${this.dominantLine} Edit` : 'Curated for you';
            eyebrow.textContent = 'Selected for you · updated live';
        } else {
            title.textContent = 'New Arrivals';
            eyebrow.textContent = 'Coach Originals';
        }
        this.paintGrid(grid, this.curatedItems(), { stagger: this.personalized, recommended: this.personalized });
    }

    /* ════════════════════════════════════════════════════════════════════════
     * PLP + sort
     * ════════════════════════════════════════════════════════════════════════ */
    renderPLP(items, opts) {
        const grid = document.getElementById('plp-grid');
        this.plpItems = items.slice();
        this.paintGrid(grid, this.plpItems, { recommended: this.personalized, flip: !!(opts && opts.flip) });
    }
    applySort(sort) {
        const select = document.getElementById('plp-sort');
        if (this.personalized && sort.sort !== 'featured') {
            select.value = 'recommended';
            document.getElementById('sort-caption').classList.add('show');
        }
        this.updateWhy(sort);
        const ordered = this.orderForSort(sort);
        this.flipReorder(document.getElementById('plp-grid'), ordered, { boost: this.personalized });
        this.plpItems = ordered;
        this.expandFacet(sort.anchorLine);
    }
    orderForSort(sort) {
        const bags = this.bagsCatalog();
        if (this.sortOrder && this.sortOrder.length && (sort.sort === 'recommended' || sort.sort === 'line_first' || sort.sort === 'tabby_first' || sort.sort === 'premium_first')) {
            const rank = new Map(this.sortOrder.map((id, i) => [id, i]));
            return bags.slice().sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e9) - (rank.has(b.id) ? rank.get(b.id) : 1e9));
        }
        const anchor = sort.anchorLine || this.dominantLine;
        switch (sort.sort) {
            case 'price_low': return bags.slice().sort((a, b) => a.price_usd - b.price_usd);
            case 'price_high':
            case 'premium_first': return bags.slice().sort((a, b) => b.price_usd - a.price_usd);
            case 'tabby_first':
            case 'line_first':
            case 'recommended':
                if (!anchor) return bags;
                return bags.slice().sort((a, b) => (b.line === anchor) - (a.line === anchor) || b.price_usd - a.price_usd);
            default: return bags;
        }
    }
    onSortChange(val) {
        const ordered = this.orderForSort({ sort: val, anchorLine: this.dominantLine });
        this.flipReorder(document.getElementById('plp-grid'), ordered, { boost: false });
        this.plpItems = ordered;
        this.updateWhy({ sort: val, anchorLine: this.dominantLine });
    }
    updateWhy(sort) {
        const body = document.getElementById('why-body');
        const anchor = sort.anchorLine || this.dominantLine;
        if (sort.sort === 'recommended' || sort.sort === 'line_first' || sort.sort === 'tabby_first') {
            const lines = Object.keys(this.viewedLineCounts);
            const viewed = lines.length ? lines.join(' and ') : (anchor || 'shoulder');
            body.innerHTML = `Sorted <strong>for you</strong>. You viewed <strong>${viewed}</strong> bags, so we surfaced those — and pieces that pair with them — first.`;
        } else if (sort.sort === 'premium_first') {
            body.innerHTML = `Sorted <strong>for you</strong>. Your browsing leans elevated, so our finest leathers lead.`;
        } else {
            body.innerHTML = `Sorted by <strong>${this.sortLabel(sort.sort)}</strong>. Browse a few bags and the order personalizes to your taste.`;
        }
    }
    sortLabel(s) { return { featured: 'Featured', newest: 'Newest', price_low: 'Price: Low to High', price_high: 'Price: High to Low', recommended: 'Recommended for you' }[s] || 'Featured'; }
    expandFacet(line) {
        if (!line) return;
        const sub = this.lineItems(line)[0]?.subcategory;
        document.querySelectorAll('#plp-facets .facet-opt').forEach((el) => el.classList.toggle('expanded', el.dataset.facet === sub));
    }
    toggleWhy() { document.getElementById('why-body').classList.toggle('open'); }

    /* FLIP re-rank animation. */
    flipReorder(grid, ordered, opts) {
        const first = new Map();
        grid.querySelectorAll('.tile').forEach((n) => first.set(n.dataset.id, n.getBoundingClientRect()));
        this.paintGrid(grid, ordered, { recommended: opts && opts.boost });
        grid.querySelectorAll('.tile').forEach((n) => {
            const prev = first.get(n.dataset.id);
            if (!prev) return;
            const next = n.getBoundingClientRect();
            const dx = prev.left - next.left, dy = prev.top - next.top;
            if (!dx && !dy) return;
            n.style.transition = 'none';
            n.style.transform = `translate(${dx}px, ${dy}px)`;
            requestAnimationFrame(() => { n.style.transition = 'transform .5s var(--ease)'; n.style.transform = ''; });
        });
    }

    /* ════════════════════════════════════════════════════════════════════════
     * COMPLETE THE LOOK
     * ════════════════════════════════════════════════════════════════════════ */
    applyCompleteLook(ctl) {
        const wrap = document.getElementById('ctl');
        if (!ctl.on) { wrap.classList.remove('revealed'); this.currentLook = null; return; }
        const focal = this.currentPdpId ? this.byId.get(this.currentPdpId) : this.lineItems(ctl.line)[0];
        let items = [];
        if (ctl.productIds && ctl.productIds.length) items = ctl.productIds.map((id) => this.byId.get(id)).filter(Boolean);
        if (items.length < 3) items = this.companions(ctl.line, focal, 3);
        this.currentLook = { focalId: focal ? focal.id : null, companionIds: items.map((p) => p.id) };
        document.getElementById('ctl-title').textContent = focal ? `Style the ${focal.name}` : `Style your ${ctl.line}`;
        document.getElementById('ctl-sub').textContent = `${items.length} pieces to complete the look`;
        document.getElementById('ctl-add-all').textContent = `Add the look — ${items.length} items`;
        this.paintGrid(document.getElementById('ctl-grid'), items, { recommended: false });
        wrap.classList.add('revealed');
    }
    companions(line, focal, limit) {
        const isAcc = (p) => p.category === 'Accessories' || p.category === 'Small Leather Goods';
        const sameLine = this.products.filter((p) => p.line === line && isAcc(p));
        const seen = new Set(sameLine.map((p) => p.id));
        const rank = (p) => { const s = (p.subcategory || '').toLowerCase(); if (/charm|strap|key/.test(s)) return 0; if (/card|wristlet|wallet/.test(s)) return 1; return 2; };
        const others = this.products.filter((p) => isAcc(p) && !seen.has(p.id)).sort((a, b) => rank(a) - rank(b) || a.price_usd - b.price_usd);
        const out = [];
        for (const p of [...sameLine, ...others]) { if (out.length >= limit) break; if (focal && p.id === focal.id) continue; out.push(p); }
        return out;
    }
    addTheLook() {
        if (!this.currentLook) return;
        const ids = [];
        if (this.currentLook.focalId) ids.push(this.currentLook.focalId);
        ids.push(...this.currentLook.companionIds);
        ids.forEach((id) => this.addToCart(id, { silent: true }));
        this.renderCart(); this.openCart();
        this.sendAction('add_to_cart', { eventName: 'add_look', productId: this.currentLook.focalId, line: 'Tabby' });
    }

    /* ════════════════════════════════════════════════════════════════════════
     * PDP
     * ════════════════════════════════════════════════════════════════════════ */
    openDefaultPdp() {
        const tabby = this.lineItems('Tabby').find((p) => this.isBag(p)) || this.bagsCatalog()[0];
        if (tabby) this.renderPdp(tabby, { silent: true });
    }
    async openPdp(id, opts) {
        const p = this.byId.get(id);
        if (!p) return;
        this.renderPdp(p, { silent: !!(opts && opts.silent) });
        this.go('pdp', { silent: true });
    }
    renderPdp(p, opts) {
        this.currentPdpId = p.id;
        document.getElementById('pdp-gallery').innerHTML = `<div class="pdp-hero-img">${this.img(p)}</div>`;
        document.getElementById('pdp-buybox').innerHTML = `
            <div class="pdp-crumb">Coach / ${p.category} / ${p.line}</div>
            <h1 class="pdp-name">${p.name}</h1>
            <div class="pdp-price">${this.price(p)}</div>
            <div class="pdp-swatches">${(p.colors || []).slice(0, 6).map((c, i) =>
                `<span class="swatch ${i === 0 ? 'sel' : ''}" title="${c}" style="background:${this.swatch(c)}"></span>`).join('')}</div>
            <div class="pdp-meta">${p.material || ''}${p.size ? ' · ' + p.size : ''}</div>
            <div id="pdp-urgency"></div>
            <button class="add-bag" id="pdp-add" onclick="store.addAnchorToCart()">Add to Bag</button>
            <div id="pdp-details">
                <h5>Craftsmanship</h5>
                <p>Made from ${(p.material || 'fine leather').toLowerCase()}, finished by hand. A ${p.line} signature, built to be carried for years.</p>
            </div>`;
        this.applyStageCopy(this.journeyStage);
        this.renderMarkers();   // re-assert PDP markers after buybox/gallery rebuild
        if (!opts || !opts.silent) {
            this.productViews++;
            this.viewedLineCounts[p.line] = (this.viewedLineCounts[p.line] || 0) + 1;
            this.recomputeDominantLine();
            this.sendAction('product_view', { product_id: p.id, productId: p.id, line: p.line, priceBand: this.priceBand(p) }, { label: p.name });
        }
    }
    refreshPdpRecs() {
        const grid = document.getElementById('pdp-recs');
        if (!grid) return;
        const focal = this.currentPdpId ? this.byId.get(this.currentPdpId) : null;
        const items = this.recommendations ? this.recommendations.slice(0, 4) : this.recommendFor(focal, 4);
        this.paintGrid(grid, items, { stagger: this.personalized, recommended: this.personalized });
    }
    recommendFor(focal, limit) {
        if (!focal) return this.topCatalog(limit);
        const sameLine = this.products.filter((p) => p.id !== focal.id && p.line === focal.line);
        const sameCat = this.products.filter((p) => p.id !== focal.id && p.line !== focal.line && p.category === focal.category);
        const rest = this.products.filter((p) => p.id !== focal.id);
        const out = [], seen = new Set([focal.id]);
        for (const p of [...sameLine, ...sameCat, ...rest]) { if (out.length >= limit) break; if (!seen.has(p.id)) { out.push(p); seen.add(p.id); } }
        return out;
    }

    /* ════════════════════════════════════════════════════════════════════════
     * JOURNEY-STAGE COPY + STORY
     * ════════════════════════════════════════════════════════════════════════ */
    applyStageCopy(stage) {
        const urgency = document.getElementById('pdp-urgency');
        const nudge = document.getElementById('cart-nudge');
        const copy = {
            early: { urgency: '', nudge: '' },
            mid: { urgency: 'A signature, loved across our community.', nudge: 'Pairs beautifully — complete your look.' },
            late: { urgency: 'Few remaining in this color.', nudge: 'Complimentary monogramming on orders over $400.' },
        }[stage] || { urgency: '', nudge: '' };
        if (urgency) this.crossFade(urgency, copy.urgency);
        if (nudge) this.crossFade(nudge, copy.nudge);
    }
    crossFade(el, text) {
        if (el.textContent === text) return;
        el.classList.add('fading');
        setTimeout(() => { el.textContent = text; el.classList.remove('fading'); }, 260);
    }
    storyForStage(stage) {
        if (stage === 'late') return { eyebrow: 'Service', title: 'Made personal', text: 'Complimentary monogramming and lifetime craftsmanship care on every Coach piece.', art: this.lineImage('Rogue') };
        if (stage === 'mid') return { eyebrow: 'Coachtopia', title: 'Crafted to last, designed to circle back', text: 'Our circular sub-brand, made with recycled and repurposed materials.', art: this.lineImage('Brooklyn') };
        return { eyebrow: 'Heritage', title: 'Since 1941', text: 'Six generations of leather craft, from a Manhattan loft to your shoulder.', art: this.lineImage('Tabby') };
    }
    renderStory(s) {
        const card = document.getElementById('story-card');
        const fill = () => {
            card.innerHTML = `
                <div class="story-art" style="${s.art ? `background-image:url('${s.art}')` : ''}"></div>
                <div class="story-body">
                    <div class="story-eyebrow">${s.eyebrow}</div>
                    <h3 class="story-title">${s.title}</h3>
                    <p class="story-text">${s.text}</p>
                </div>`;
        };
        if (card.dataset.title === s.title) return;
        card.dataset.title = s.title;
        if (!card.innerHTML.trim()) { fill(); return; }
        card.classList.add('fading');
        setTimeout(() => { fill(); card.classList.remove('fading'); }, 280);
    }
    renderCategoryRail() {
        const rail = document.getElementById('category-rail');
        const cats = [
            { name: 'Handbags', match: (p) => p.category === 'Handbags' },
            { name: 'Wallets & Cases', match: (p) => p.category === 'Small Leather Goods' },
            { name: 'Accessories', match: (p) => p.category === 'Accessories' },
            { name: 'Coachtopia', match: (p) => /coachtopia/i.test(p.line) || /coachtopia/i.test(p.material || '') },
        ];
        rail.innerHTML = cats.map((c) => {
            const n = this.products.filter(c.match).length;
            return `<div class="cat-tile" onclick="store.go('plp')"><div class="cat-name">${c.name}</div><div class="cat-count">${n || '—'} styles</div></div>`;
        }).join('');
    }

    /* ════════════════════════════════════════════════════════════════════════
     * MINI-CART
     * ════════════════════════════════════════════════════════════════════════ */
    addToCart(id, opts) {
        const p = this.byId.get(id);
        if (!p) return;
        this.cart.push({ id, color: (p.colors && p.colors[0]) || '' });
        const badge = document.getElementById('cart-count');
        badge.textContent = this.cart.length;
        badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
        if (!opts || !opts.silent) {
            this.renderCart(); this.openCart();
            this.sendAction('add_to_cart', { product_id: id, productId: id, line: p.line, value: p.price_usd }, { label: p.name });
        }
        // Buy signal: first add-to-cart = ready-to-buy → act on it (launch a pay-over-time experiment).
        if (!this._buySignalFired && this.cart.length >= 1) { this._buySignalFired = true; this.onReadyToBuy(); }
    }
    addAnchorToCart() {
        const id = this.currentPdpId || this.lineItems('Tabby')[0]?.id || this.bagsCatalog()[0]?.id;
        if (id) this.addToCart(id);
    }
    renderCart() {
        const wrap = document.getElementById('cart-items');
        if (this.cart.length === 0) wrap.innerHTML = '<div class="cart-empty">Your bag is empty.</div>';
        else wrap.innerHTML = this.cart.map((ci) => {
            const p = this.byId.get(ci.id); if (!p) return '';
            return `<div class="cart-item">
                <div class="ci-img">${this.img(p)}</div>
                <div><div class="ci-name">${p.name}</div><div class="ci-line">${p.line}${ci.color ? ' · ' + ci.color : ''}</div><div class="ci-price">${this.price(p)}</div></div>
            </div>`;
        }).join('');
        const subtotal = this.cart.reduce((s, ci) => s + (this.byId.get(ci.id)?.price_usd || 0), 0);
        document.getElementById('cart-subtotal').textContent = '$' + subtotal.toLocaleString();
        document.getElementById('cart-count').textContent = this.cart.length;
        this.journeyStage = this.deriveStage();
        this.applyStageCopy(this.journeyStage);
        this.refreshCartRec();
        this.updateEngine();
    }
    refreshCartRec() {
        const box = document.getElementById('cart-rec');
        const item = document.getElementById('cart-rec-item');
        if (this.cart.length === 0) { box.style.display = 'none'; return; }
        const focal = this.byId.get(this.cart[this.cart.length - 1].id);
        const pick = (this.recommendations && this.recommendations.find((p) => p.id !== focal?.id)) || this.recommendFor(focal, 1)[0];
        if (!pick) { box.style.display = 'none'; return; }
        box.style.display = 'block';
        item.innerHTML = `<div class="cr-img">${this.img(pick)}</div><div><div class="cr-name">${pick.name}</div><div class="cr-price">${this.price(pick)}</div></div>`;
        item.onclick = () => { this.closeCart(); this.openPdp(pick.id); };
    }
    openCart() { document.getElementById('mini-cart').classList.add('open'); document.getElementById('cart-overlay').classList.add('open'); }
    closeCart() { document.getElementById('mini-cart').classList.remove('open'); document.getElementById('cart-overlay').classList.remove('open'); }
    beginCheckout() {
        const v = this.cart.reduce((s, ci) => s + (this.byId.get(ci.id)?.price_usd || 0), 0);
        this.sendAction('add_to_cart', { eventName: 'begin_checkout', cartValue: v, line: 'Tabby' });
    }
    toggleWish(id, ev) {
        if (ev) ev.stopPropagation();
        const p = this.byId.get(id); if (!p) return;
        if (this.wishlist.has(id)) this.wishlist.delete(id); else this.wishlist.add(id);
        document.getElementById('wishlist-count').textContent = this.wishlist.size;
        document.querySelectorAll(`.tile-wish[data-id="${id}"]`).forEach((b) => b.classList.toggle('on', this.wishlist.has(id)));
        this.sendAction('wishlist_add', { product_id: id, productId: id, line: p.line }, { label: p.name });
    }

    /* ════════════════════════════════════════════════════════════════════════
     * SHARED TILE PAINTER
     * ════════════════════════════════════════════════════════════════════════ */
    paintGrid(grid, items, opts) {
        if (!grid) return;
        const recommended = opts && opts.recommended, stagger = opts && opts.stagger;
        grid.innerHTML = items.map((p) => this.tileHtml(p, recommended)).join('');
        if (stagger) grid.querySelectorAll('.tile').forEach((t, i) => { t.classList.add('enter'); setTimeout(() => t.classList.remove('enter'), 40 + i * 45); });
        this.renderMarkers();   // re-assert persistent markers after a grid re-render
    }
    tileHtml(p, recommended) {
        const boost = recommended && this.dominantLine && p.line === this.dominantLine;
        return `<div class="tile" data-id="${p.id}" onclick="store.openPdp('${p.id}')">
            <div class="tile-imgwrap${p.image_url ? '' : ' noimg'}" data-name="${p.name}">
                <span class="ribbon ${boost ? 'show' : ''}">&#9733; Recommended</span>
                <button class="tile-wish ${this.wishlist.has(p.id) ? 'on' : ''}" data-id="${p.id}" onclick="store.toggleWish('${p.id}', event)">&#9825;</button>
                ${this.img(p)}
            </div>
            <div class="tile-name">${p.name}</div>
            <div class="tile-line">${p.line}</div>
            <div class="tile-price">${this.price(p)}</div>
        </div>`;
    }
    img(p) {
        const src = (p && p.image_url) ? p.image_url : this.PH_IMG;
        const alt = this.escapeHtml((p && p.name) || '');
        return `<img src="${src}" alt="${alt}" loading="lazy" onerror="store._imgFail(this)">`;
    }
    /* Guaranteed image fallback — swap any failed product image to the branded placeholder (idempotent). */
    _imgFail(el) { if (el) { el.onerror = null; el.src = this.PH_IMG; el.classList.add('img-ph'); } }
    price(p) { return '$' + (p.price_usd || 0).toLocaleString(); }
    priceBand(p) { return p.price_usd < 150 ? 'entry' : p.price_usd < 400 ? 'core' : 'elevated'; }
    swatch(c) {
        const t = (c || '').toLowerCase();
        if (/black|graphite/.test(t)) return '#1A1A1A';
        if (/chalk|ivory|cream|white|pearl|natural/.test(t)) return '#F1ECE4';
        if (/saddle|tan|walnut|khaki|brown/.test(t)) return '#9c7a4f';
        if (/red|cherry|1941/.test(t)) return '#7A2E2E';
        if (/berry/.test(t)) return '#5e2238';
        if (/pink|electric/.test(t)) return '#d98aa3';
        if (/blue|denim|faded|bluebell/.test(t)) return '#5d7392';
        if (/moss|green/.test(t)) return '#5b6347';
        return '#cabfaf';
    }

    /* ════════════════════════════════════════════════════════════════════════
     * NAVIGATION
     * ════════════════════════════════════════════════════════════════════════ */
    go(view, opts) {
        document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
        document.getElementById('view-' + view)?.classList.add('active');
        document.querySelectorAll('.nav a[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        this.renderMarkers();   // markers on the now-visible view
        if (view === 'plp' && !(opts && opts.silent)) this.sendAction('page_view', { path: '/plp/handbags', category: 'handbags' }, { label: 'PLP' });
    }

    /* ════════════════════════════════════════════════════════════════════════
     * ENGINE TELEMETRY OVERLAY (on demand)
     * ════════════════════════════════════════════════════════════════════════ */
    toggleEngine(force) { if (force === false) return; this.setTab('engine'); }
    logEvent(kind, type, label, rtt, update) {
        const segs = update && update.segments ? update.segments : null;
        this.eventLog.unshift({ kind, type, label, rtt, segs, t: Date.now() });
        this.eventLog = this.eventLog.slice(0, 12);
        this.renderEventStream();
    }
    renderEventStream() {
        const wrap = document.getElementById('event-stream');
        if (!wrap) return;
        if (this.eventLog.length === 0) { wrap.innerHTML = `<div class="eng-row"><span class="eng-key">no events yet</span></div>`; return; }
        wrap.innerHTML = this.eventLog.map((e) => {
            const arrow = e.kind === 'push' ? '&#8682; push' : (e.rtt != null ? `&#8594; ${e.rtt}ms` : '&#8594;');
            const meta = e.kind === 'push' ? (e.label || '') : `${e.label || ''}${e.segs ? ' · ' + e.segs.length + ' seg' : ''}`;
            return `<div class="ev-row"><span class="ev-type">${e.type}</span> <span class="ev-arrow">${arrow}</span><div class="ev-meta">${meta}</div></div>`;
        }).join('');
    }
    updateEngine(decisionMs) {
        const segWrap = document.getElementById('eng-segments');
        const segs = this.segments.length ? this.segments : ['new_visitor'];
        if (segWrap) segWrap.innerHTML = segs.map((s) => `<span class="seg-chip ${/new_visitor|new_user|cold_start/.test(s) ? 'cold' : ''}">${s}</span>`).join('');
        const stageEl = document.getElementById('eng-stage'); if (stageEl) stageEl.textContent = this.journeyStage;
        const anonEl = document.getElementById('eng-anon'); if (anonEl) anonEl.textContent = this.anonId;

        const list = document.getElementById('eng-decisions');
        if (list) {
            const flags = ['hero_module', 'plp_sort', 'complete_the_look', 'promo_banner', 'journey_message'];
            list.innerHTML = flags.map((f) => {
                const d = this.decisions[f];
                const on = d ? d.enabled : false;
                const variation = d ? (d.variationKey || '—') : '—';
                const exp = d && d.reason === 'experiment';
                return `<div class="decision-row"><span>${f}</span><span><span class="${on ? 'on' : 'off'}">${on ? variation : 'off'}</span>${exp ? ' <span class="tag-exp">A/B</span>' : ''}</span></div>`;
            }).join('');
        }
        if (decisionMs != null && !Number.isNaN(decisionMs)) {
            const ms = document.getElementById('latency-ms'); if (ms) ms.textContent = decisionMs;
            const badge = document.getElementById('latency-badge');
            if (badge) { badge.classList.remove('flash'); void badge.offsetWidth; badge.classList.add('flash'); }
        }
    }

    /* ════════════════════════════════════════════════════════════════════════
     * SPOTLIGHT + SIMULATED CURSOR + CALLOUT
     * ════════════════════════════════════════════════════════════════════════ */
    /* ════════════════════════════════════════════════════════════════════════
     * SIDEBAR · TABS · PUSH-LEFT LAYOUT
     * ════════════════════════════════════════════════════════════════════════ */
    toggleSidebar(force) {
        const open = force === undefined ? !document.body.classList.contains('sb-open') : force;
        document.body.classList.toggle('sb-open', open);
        const caret = document.getElementById('sbh-caret');
        if (caret) caret.innerHTML = open ? '&#9656;' : '&#9666;';   // ▸ collapse · ◂ open
    }
    setTab(name) {
        this.activeTab = name;
        document.querySelectorAll('.sb-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
        document.querySelectorAll('.sb-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
        if (!document.body.classList.contains('sb-open')) this.toggleSidebar(true);
    }
    /* Collapse / expand the SIGNAL·DECISION·WHY callout (step label + progress + caption stay). */
    toggleCallout() { const s = document.getElementById('sb-step'); if (s) s.classList.toggle('co-collapsed'); }
    /* Maximize the Opal panel (hide the step block → chat gets ~75% of the height). */
    toggleMaximize() {
        const sb = document.getElementById('sidebar'); if (!sb) return;
        const on = sb.classList.toggle('maximized');
        if (on) { sb.style.removeProperty('--director-max'); this.setTab('opal'); }   // focus the chat
        const btn = document.getElementById('sb-maximize');
        if (btn) btn.title = on ? 'Restore panel' : 'Maximize Opal — more chat room';
    }
    /* Drag the handle to resize the director vs the tab panels; the director then scrolls. */
    initSidebarResize() {
        const handle = document.getElementById('sb-resize');
        const sb = document.getElementById('sidebar');
        const dir = document.getElementById('sb-director');
        if (!handle || !sb || !dir) return;
        let dragging = false;
        const onMove = (e) => {
            if (!dragging) return;
            const top = dir.getBoundingClientRect().top;
            const h = Math.max(70, Math.min(window.innerHeight * 0.7, e.clientY - top));
            sb.style.setProperty('--director-max', h + 'px');
        };
        handle.addEventListener('pointerdown', (e) => { if (sb.classList.contains('maximized')) return; dragging = true; sb.classList.add('sb-resizing'); e.preventDefault(); });
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', () => { if (!dragging) return; dragging = false; sb.classList.remove('sb-resizing'); });
    }

    /* ════════════════════════════════════════════════════════════════════════
     * COMMAND PALETTE (⌘K) — force experiences. Built on a modes registry so new
     * "force behaviors" (flag variation, persona, device/context…) plug in as tabs.
     * ════════════════════════════════════════════════════════════════════════ */
    cmdkModes() {
        return [{
            id: 'audience',
            label: 'Preview as audience',
            placeholder: 'Force the session into an audience’s banner experience…',
            load: async () => {
                const items = [{ id: '__default', label: 'Default — clear forced audience', sub: 'Show the shopper’s natural banner', tag: 'reset', _clear: true }];
                const seen = new Set();
                const add = (name, attrs, msg) => {
                    const k = (name || '').toLowerCase().trim(); if (!name || seen.has(k)) return; seen.add(k);
                    items.push({ id: k, label: name, sub: msg || '(no message)', tag: 'audience', attributes: attrs || {}, message: msg || '' });
                };
                (this.bannerExperiences || []).forEach((e) => add(e.audienceName, e.attributes, e.message));
                try { const r = await fetch('/optimizely/banner-rules'); const j = await r.json(); (j.rules || []).forEach((rule) => add(rule.audienceName, rule.attributes, rule.message)); } catch (e) { /* offline → session list only */ }
                return items;
            },
            onSelect: (it) => {
                if (it._clear) { this.clearForcedAudience(); return; }
                this.setTab('opal');
                this.previewAudience({ previewAttributes: it.attributes, message: it.message, audienceName: it.label });
            },
        }, {
            id: 'location',
            label: 'Preview as location',
            placeholder: 'Force the shopper’s location (geo cold-start)…',
            load: async () => ([
                { id: 'auto', label: 'Auto — your real location', sub: 'Use the live edge geo for this request', _auto: true },
                { id: 'miami', label: 'Miami, FL · United States', sub: 'Summer · coral & natural straw', geo: { city: 'Miami', region: 'Florida', regionCode: 'FL', country: 'US', timezone: 'America/New_York', hemisphere: 'N', colo: 'MIA', season: 'summer' } },
                { id: 'sydney', label: 'Sydney · Australia', sub: 'Winter (same date!) · burgundy & leather', geo: { city: 'Sydney', region: 'New South Wales', regionCode: 'NSW', country: 'AU', timezone: 'Australia/Sydney', hemisphere: 'S', colo: 'SYD', season: 'winter' } },
                { id: 'chicago', label: 'Chicago, IL · United States', sub: 'Winter · structured leather', geo: { city: 'Chicago', region: 'Illinois', regionCode: 'IL', country: 'US', timezone: 'America/Chicago', hemisphere: 'N', colo: 'ORD', season: 'winter' } },
                { id: 'singapore', label: 'Singapore', sub: 'Tropical · brights & straw', geo: { city: 'Singapore', region: 'Singapore', country: 'SG', timezone: 'Asia/Singapore', hemisphere: 'N', colo: 'SIN', season: 'summer' } },
            ]),
            onSelect: (it) => { if (it._auto) this.applyGeoColdStart(); else this.forceGeo(it.geo); },
        }, {
            id: 'experiment',
            label: 'Show experiment variation',
            placeholder: 'Pick any A/B · MAB · CMAB variation to show on the store…',
            load: async () => {
                const items = [{ id: '__clearx', label: 'Default — clear the experiment surface', sub: 'Hide the experiment banner', tag: 'reset', _clear: true }];
                try {
                    const r = await fetch('/experiment/scenarios'); const j = await r.json();
                    (j.scenarios || []).forEach((s) => {
                        const group = `${(s.type || '').toUpperCase()} · ${s.name || s.label} · ${s.key}`;
                        (s.creatives || []).forEach((c) => items.push({
                            id: s.key + ':' + c.key, group,
                            label: c.name || c.key, sub: c.headline || c.subcopy || '', tag: c.key,
                            experimentKey: s.key, variationKey: c.key, creative: c,
                        }));
                    });
                } catch (e) { /* offline → none */ }
                return items;
            },
            onSelect: (it) => { if (it._clear) { this.clearForcedExperiment(); return; } this.previewExperiment({ experimentKey: it.experimentKey, variationKey: it.variationKey, creative: it.creative }); },
        }];
        // ↑ add more force-behavior modes here (each: { id, label, placeholder, load(), onSelect(item) })
    }
    openCmdk() {
        this._cmdkModes = this.cmdkModes(); this._cmdkMode = 0;
        document.getElementById('cmdk-overlay').classList.add('open');
        document.getElementById('cmdk').classList.add('open');
        this._cmdkRenderTabs();
        const input = document.getElementById('cmdk-input'); if (input) input.value = '';
        this.cmdkLoad();
        setTimeout(() => { const i = document.getElementById('cmdk-input'); if (i) i.focus(); }, 40);
    }
    closeCmdk() {
        document.getElementById('cmdk-overlay').classList.remove('open');
        document.getElementById('cmdk').classList.remove('open');
    }
    _cmdkRenderTabs() {
        const wrap = document.getElementById('cmdk-tabs');
        if (wrap) wrap.innerHTML = this._cmdkModes.map((m, i) => `<button class="cmdk-tab ${i === this._cmdkMode ? 'active' : ''}" onclick="store.cmdkSetMode(${i})">${this.escapeHtml(m.label)}</button>`).join('');
        const input = document.getElementById('cmdk-input'); if (input) input.placeholder = this._cmdkModes[this._cmdkMode].placeholder || 'Search…';
    }
    cmdkSetMode(i) { this._cmdkMode = i; this._cmdkRenderTabs(); const inp = document.getElementById('cmdk-input'); if (inp) inp.value = ''; this.cmdkLoad(); }
    async cmdkLoad() {
        const mode = this._cmdkMode;
        const list = document.getElementById('cmdk-list'); if (list) list.innerHTML = '<div class="cmdk-empty"><span class="cmdk-spin"></span> Loading…</div>';
        let items = [];
        try { items = await this._cmdkModes[mode].load(); } catch (e) { items = []; }
        if (this._cmdkMode !== mode) return;   // a newer tab switch superseded this load
        this._cmdkItems = items;
        this.cmdkFilter('');
    }
    cmdkFilter(q) {
        const query = (q || '').toLowerCase().trim();
        this._cmdkView = (this._cmdkItems || []).filter((it) => !query || (it.label + ' ' + (it.sub || '')).toLowerCase().includes(query));
        this._cmdkSel = 0; this._cmdkRenderList();
    }
    _cmdkRenderList() {
        const list = document.getElementById('cmdk-list'); if (!list) return;
        const items = this._cmdkView || [];
        if (!items.length) { list.innerHTML = '<div class="cmdk-empty">No audiences yet — create one in the Opal chat (e.g. “create an audience for Tabby viewers and set their banner to …”), then it appears here.</div>'; return; }
        let lastGroup = null; let html = '';
        items.forEach((it, i) => {
            if (it.group && it.group !== lastGroup) { lastGroup = it.group; html += `<div class="cmdk-group">${this.escapeHtml(it.group)}</div>`; }
            html += `<div class="cmdk-item${it.group ? ' ci-indent' : ''}${i === this._cmdkSel ? ' sel' : ''}" onclick="store.cmdkSelect(${i})" onmousemove="store.cmdkHover(${i})"><div class="ci-label">${this.escapeHtml(it.label)}${it.tag ? `<span class="ci-tag">${this.escapeHtml(it.tag)}</span>` : ''}</div><div class="ci-sub">${this.escapeHtml(it.sub || '')}</div></div>`;
        });
        list.innerHTML = html;
    }
    cmdkHover(i) { if (this._cmdkSel !== i) { this._cmdkSel = i; this._cmdkRenderList(); } }
    cmdkKey(e) {
        const n = (this._cmdkView || []).length;
        if (e.key === 'Escape') { this.closeCmdk(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); this._cmdkSel = Math.min(n - 1, (this._cmdkSel || 0) + 1); this._cmdkRenderList(); this._cmdkScrollSel(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this._cmdkSel = Math.max(0, (this._cmdkSel || 0) - 1); this._cmdkRenderList(); this._cmdkScrollSel(); }
        else if (e.key === 'Enter') { e.preventDefault(); this.cmdkSelect(this._cmdkSel || 0); }
    }
    _cmdkScrollSel() { const el = document.querySelector('.cmdk-item.sel'); if (el) el.scrollIntoView({ block: 'nearest' }); }
    cmdkSelect(i) {
        const it = (this._cmdkView || [])[i]; if (!it) return;
        this.closeCmdk();
        try { this._cmdkModes[this._cmdkMode].onSelect(it); } catch (e) { console.error('cmdk select', e); }
    }
    clearForcedAudience() { this.decisions['personalized_banner'] = { enabled: false, variables: {} }; this.renderBanner(); }

    /* ════════════════════════════════════════════════════════════════════════
     * PERSONALIZATION ACTIVITY PANEL — a movable, minimize-not-close provenance log.
     * Every change posts a card: signal → segment → decision, the evidence used, and
     * the literal Before → Now. This is the "how did I get here, and what was before?"
     * surface (replaces the old toast).
     * ════════════════════════════════════════════════════════════════════════ */
    showPzPanel() { if (this._pzMin) return; const p = document.getElementById('pz-panel'); if (p) p.classList.add('show'); }
    minimizePzPanel() {
        this._pzMin = true;
        const p = document.getElementById('pz-panel'); if (p) p.classList.remove('show');
        const pill = document.getElementById('pz-pill'); if (pill) pill.classList.add('show');
    }
    restorePzPanel() {
        this._pzMin = false;
        const p = document.getElementById('pz-panel'); if (p) p.classList.add('show');
        const pill = document.getElementById('pz-pill'); if (pill) pill.classList.remove('show');
    }
    activitySegment() {
        if (this.segments && this.segments.length) return this.segments[0];
        if (this.dominantLine) return `${this.dominantLine} affinity`;
        return null;
    }
    activityEvidence() {
        const ev = [];
        if (this.productViews) ev.push(`viewed ${this.productViews} product${this.productViews === 1 ? '' : 's'}`);
        if (this.dominantLine) { const n = this.viewedLineCounts && this.viewedLineCounts[this.dominantLine]; ev.push(n ? `${this.dominantLine} ×${n}` : `${this.dominantLine} affinity`); }
        if (this.segments && this.segments.length) this.segments.slice(0, 2).forEach((s) => ev.push(s));
        if (this.eventCount) ev.push(`${this.eventCount} events`);
        return [...new Set(ev)].slice(0, 4);
    }
    /* card.headline/signal/decision are trusted callout strings (carry <strong>/<code>) → inserted raw;
       usecase/segment/evidence/before/after are plain → escaped. */
    logActivity(card) {
        const feed = document.getElementById('pzp-feed'); if (!feed) return;
        const empty = feed.querySelector('.pzp-empty'); if (empty) empty.remove();
        this._pzCount = (this._pzCount || 0) + 1;
        const id = 'pzc' + this._pzCount;
        // Register the [Compare] payload (data URLs are too big to inline in onclick) — id-addressed.
        if (card.beforeImg && card.afterImg) {
            this._cards[id] = { zone: card.zone || null, beforeImg: card.beforeImg, afterImg: card.afterImg, title: (card.usecase || 'Before → Now') };
        }
        const chips = (card.evidence || []).map((t) => `<span class="pzc-chip">${this.escapeHtml(t)}</span>`).join('');
        const seg = card.segment ? `<span class="pzc-arrow">&#8594;</span><div class="pzc-node"><span class="pzc-node-k">Segment</span><span class="pzc-node-v">${this.escapeHtml(card.segment)}</span></div>` : '';
        const el = document.createElement('div');
        el.className = 'pz-card';
        el.innerHTML =
            `<div class="pzc-eyebrow">${this.escapeHtml(card.usecase || 'Personalization')}<span class="pzc-match">live</span></div>` +
            (card.headline ? `<div class="pzc-headline">${card.headline}</div>` : '') +
            `<div class="pzc-chain"><div class="pzc-node"><span class="pzc-node-k">Signal</span><span class="pzc-node-v">${card.signal || '—'}</span></div>${seg}<span class="pzc-arrow">&#8594;</span><div class="pzc-node"><span class="pzc-node-k">Decision</span><span class="pzc-node-v">${card.decision || '—'}</span></div></div>` +
            (chips ? `<div class="pzc-evidence">${chips}</div>` : '') +
            ((card.before || card.after) ? `<div class="pzc-ba"><span class="pzc-ba-k">Before</span> <span class="pzc-ba-v">${this.escapeHtml(card.before || '—')}</span> &nbsp; <span class="pzc-ba-k now">Now</span> <span class="pzc-ba-v">${this.escapeHtml(card.after || '—')}</span></div>` : '') +
            (this._cards[id] ? `<button class="pzc-compare" onclick="store.openCompareCard('${id}')">&#11020; Compare before / now</button>` : '') +
            `<div class="pzc-foot">&#9889; decided live at the edge</div>`;
        feed.insertBefore(el, feed.firstChild);   // newest on top
        // Auto-size the feed to EXACTLY the newest card (card heights vary by type) so only ONE card is ever
        // visible — older entries stay one scroll down. Frees the rest of the screen.
        requestAnimationFrame(() => { const top = feed.firstElementChild; if (top) feed.style.maxHeight = (top.offsetHeight + 20) + 'px'; });
        const cnt = document.getElementById('pz-pill-count'); if (cnt) cnt.textContent = this._pzCount;
        if (this._pzMin) { const pill = document.getElementById('pz-pill'); if (pill) { pill.classList.add('flash'); setTimeout(() => pill.classList.remove('flash'), 500); } }
        else this.showPzPanel();
        return id;
    }
    initPzDrag() {
        const head = document.getElementById('pzp-head'); const panel = document.getElementById('pz-panel');
        if (!head || !panel) return;
        let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
        head.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.pzp-min')) return;
            dragging = true;
            const r = panel.getBoundingClientRect();
            panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
            sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; e.preventDefault();
        });
        window.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            panel.style.left = Math.max(6, Math.min(window.innerWidth - 130, ox + (e.clientX - sx))) + 'px';
            panel.style.top = Math.max(6, Math.min(window.innerHeight - 60, oy + (e.clientY - sy))) + 'px';
        });
        window.addEventListener('pointerup', () => { dragging = false; });
    }

    /* ════════════════════════════════════════════════════════════════════════
     * COLD-START — edge-geo personalization. With zero history we adapt the first
     * paint to WHERE the visitor is and the LOCAL season (Cloudflare request.cf via
     * /geo). The command palette can force a location (Miami ↔ Sydney) for the
     * hemisphere-flip showstopper. Color is anchored on SEASON (robust), not climate.
     * ════════════════════════════════════════════════════════════════════════ */
    _seasonPalette(season) {
        return ({ summer: 'coral & natural straw', winter: 'burgundy & chocolate leather', spring: 'soft pastels & chalk', autumn: 'camel & olive' })[season] || 'signature neutrals';
    }
    async applyGeoColdStart(forced) {
        let geo = forced;
        if (!geo) { try { const r = await fetch('/geo'); geo = await r.json(); } catch (e) { geo = null; } }
        if (!geo) { if (!this.personalized) this.renderHero(this.heroFallback()); return; }   // geo unavailable → paint the default hero ONCE (init skipped it), no later swap
        this.geo = geo;
        const place = geo.city || geo.region || geo.country || 'your area';
        const season = geo.season || 'this season';
        const palette = this._seasonPalette(season);
        // Visible cold-start cue — geo-aware welcome ribbon (replaces the generic "you're new").
        const wr = document.querySelector('#welcome-ribbon .wr-text');
        if (wr) wr.innerHTML = `<b>Welcome${geo.city ? ' from ' + this.escapeHtml(geo.city) : ''}.</b> It's ${this.escapeHtml(season)} where you are — we've opened on the ${this.escapeHtml(palette)} edit. No account, no cookie needed.`;
        this.showWelcome();
        // Swap the hero by SEASON (reliable; hemisphere+month) so the cold-start is visible in-store and
        // MORPHS (View Transitions) when the location is switched. City stays in the ribbon/card (lower-stakes).
        if (!this.personalized) {
            // FIRST paint of the hero on cold load (init skipped it) → renderHero fills directly, no cross-fade.
            this.renderHero(this._coldHero());
        }
        // Provenance — the cold-start decision, as beat-0 of the Activity panel.
        this.logActivity({
            usecase: 'Cold-start · location',
            headline: `Opened on the ${this.escapeHtml(place)} ${this.escapeHtml(season)} edit`,
            signal: `First touch — <strong>${this.escapeHtml(place)}</strong>${geo.regionCode ? ', ' + this.escapeHtml(geo.regionCode) : ''} · local season <strong>${this.escapeHtml(season)}</strong>${geo.colo ? ' · served from edge <strong>' + this.escapeHtml(geo.colo) + '</strong>' : ''}.`,
            segment: `geo · ${this.escapeHtml(geo.country || '—')} · ${this.escapeHtml(season)}`,
            decision: `No history yet → lead with the <strong>${this.escapeHtml(palette)}</strong> ${this.escapeHtml(season)} edit.`,
            evidence: [place, season, geo.timezone].filter(Boolean),
            before: 'Generic “New Arrivals”',
            after: `${place} · ${season} edit`,
        });
    }
    forceGeo(geo) { this.applyGeoColdStart(geo); }

    /* ── Cold-start Act 2: the 30-second style quiz (zero-party → instant re-personalization) ── */
    openQuiz() {
        if (!this._quizDef) this._quizDef = [
            { key: 'occasion', q: "What's it mostly for?", opts: ['Everyday', 'Work', 'Evening', 'Travel'] },
            { key: 'silhouette', q: 'Your shape', opts: ['Tote', 'Shoulder', 'Crossbody', 'Top-handle'] },
            { key: 'color', q: 'Your palette', opts: ['Neutrals', 'Bold', 'Pastel', 'Black'] },
            { key: 'size', q: 'Your size', opts: ['Compact', 'Medium', 'Roomy'] },
        ];
        this._quiz = {};
        const body = document.getElementById('quiz-body');
        if (body) body.innerHTML = this._quizDef.map((g) =>
            `<div class="quiz-q"><div class="quiz-q-label">${g.q}</div><div class="quiz-opts">` +
            g.opts.map((o) => `<button class="quiz-opt" data-k="${g.key}" onclick="store.quizPick('${g.key}','${o.toLowerCase()}',this)">${o}</button>`).join('') +
            `</div></div>`).join('');
        document.getElementById('quiz-overlay').classList.add('open');
        document.getElementById('style-quiz').classList.add('open');
    }
    quizPick(key, val, el) {
        this._quiz = this._quiz || {}; this._quiz[key] = val;
        document.querySelectorAll(`.quiz-opt[data-k="${key}"]`).forEach((o) => o.classList.toggle('sel', o === el));
    }
    closeQuiz() {
        document.getElementById('quiz-overlay').classList.remove('open');
        document.getElementById('style-quiz').classList.remove('open');
    }
    quizApply() {
        const p = this._quiz || {};
        if (!Object.keys(p).length) { this.closeQuiz(); return; }
        const colorMap = { neutrals: ['chalk', 'tan', 'beige', 'natural', 'cream', 'taupe', 'khaki', 'ivory'], bold: ['red', 'berry', 'pink', 'blue', 'green', 'orange', 'electric', 'cherry'], pastel: ['pink', 'blue', 'lilac', 'mint', 'powder', 'pastel', 'bluebell'], black: ['black', 'graphite'] };
        const wantColors = colorMap[p.color] || [];
        const score = (b) => {
            let s = 0;
            if (p.occasion && (b.occasion || []).includes(p.occasion)) s += 2;
            if (p.silhouette && (b.silhouette || '').toLowerCase().includes(p.silhouette)) s += 2;
            if (wantColors.length) { const c = (b.colors || []).join(' ').toLowerCase(); if (wantColors.some((w) => c.includes(w))) s += 1.5; }
            return s;
        };
        const ranked = this.bagsCatalog().map((b) => ({ b, s: score(b) })).sort((a, b) => b.s - a.s);
        let picks = ranked.filter((x) => x.s > 0).map((x) => x.b);
        if (picks.length < 4) picks = ranked.map((x) => x.b);
        this.recommendations = picks.slice(0, 8);
        this.personalized = true;
        const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
        const sel = this._quizDef.map((g) => p[g.key]).filter(Boolean).map(cap);
        this.closeQuiz();
        this.go('home', { silent: true });
        this.renderHero({ eyebrow: 'Your edit', title: 'Your Edit', sub: `Built from your picks — ${sel.join(' · ')}.`, cta: 'Shop your edit', art: (this.heroFallback() || {}).art });
        this.renderCurated();
        this.logActivity({
            usecase: 'Style quiz · zero-party',
            headline: 'Re-personalized from what she told us',
            signal: `She answered the 30-second quiz: <strong>${this.escapeHtml(sel.join(' · '))}</strong>.`,
            segment: 'declared preferences',
            decision: 'Re-rank the edit to her <strong>declared taste</strong> — consented, zero-party data.',
            evidence: sel,
            before: 'Season / geo edit',
            after: 'Your Edit (declared prefs)',
        });
    }

    /* ── Before / Now split-slider (drag the seam) — opened from a provenance card's [Compare] ── */
    /* ── Live capture for the [Compare] slider ──────────────────────────────────
       Photographs the ACTUAL rendered DOM (html2canvas) so the "now" is always exactly
       what the human sees — across every hero / A-B / MAB / CMAB / xsurf / geo / quiz
       variation. No per-beat static PNG to drift. Lazy-loaded; degrades to the static
       fallback if capture isn't available or the zone isn't on screen. */
    _ensureH2C() {
        if (!this._h2cP) {
            this._h2cP = new Promise((res) => {
                if (window.html2canvas) return res(true);
                const s = document.createElement('script');
                s.src = '/html2canvas.min.js';
                s.onload = () => res(true);
                s.onerror = () => res(false);
                document.head.appendChild(s);
            });
        }
        return this._h2cP;
    }
    async captureZone(sel) {
        // Capture the VISIBLE STOREFRONT WINDOW (what the shopper actually sees) — uniformly, NOT per element.
        // Capturing individual elements was the root of every recurring Compare failure: tall ones (#plp-grid-wrap,
        // #curated-section, #view-home) became thin strips; hidden ones came back blank; the takeover swapped them;
        // some included the nav and some didn't. The window is ONE consistent thing — always on screen, same frame
        // and aspect, never a strip, never blank — and it's literally a screenshot. `sel` is kept for call-site
        // compatibility but IGNORED: every before/now is the same storefront shot, capped to one viewport tall,
        // anchored at the current scroll. #store-shell is the shopper's column (the Director sidebar is a separate
        // element, so it's naturally excluded).
        try {
            const ok = await this._ensureH2C(); if (!ok || typeof window.html2canvas !== 'function') return null;
            const shell = document.getElementById('store-shell') || document.body;
            if (!shell || shell.offsetParent === null) return null;
            const r = shell.getBoundingClientRect(); const sw = Math.round(r.width); if (sw < 8) return null;
            const capH = Math.min(Math.round(shell.scrollHeight || r.height), Math.round(window.innerHeight));
            const y = Math.max(0, Math.round(window.scrollY));
            const opts = { useCORS: true, backgroundColor: '#FBF8F2', scale: Math.min(2, window.devicePixelRatio || 1), logging: false, height: capH, y };
            // The Search / Style Concierge pop-ups are .lux-modal elements docked at body level — siblings of
            // #store-shell, so they are NOT in the shell's subtree and a shell capture misses them. When one is
            // open, capture the BODY clipped to the storefront region (width = shell width) so the modal IS in
            // the shot, z-order respected — still right-clipped past the Director sidebar.
            let target = shell;
            if (document.querySelector('.lux-modal.open')) { target = document.body; opts.x = 0; opts.width = sw; }
            const canvas = await window.html2canvas(target, opts);
            return canvas.toDataURL('image/png');
        } catch (e) { return null; }
    }
    /* Capture the virgin baseline ("before") of the key zones, once, while still cold. */
    async snapshotBaselines() {
        for (const z of ['#hero', '#curated-section']) {
            if (!this._baseline[z]) { const img = await this.captureZone(z); if (img) this._baseline[z] = img; }
        }
    }
    /* Open [Compare] for a logged card — RE-CAPTURES the zone LIVE at click-time so "now" is the
       CURRENT on-screen state (the bandit-selected hero, etc.); falls back to the beat-end capture
       (or the static asset) only if the zone isn't currently capturable. */
    // Modal zones (Search / Concierge) can't be re-photographed by html2canvas — object-fit + flex layouts
    // don't survive its DOM clone, so the modal renders as an empty box. Those cards carry a baked
    // real-browser screenshot as their "now"; every other card re-captures the live storefront on click.
    _isModalZone(zone) { const el = zone && document.querySelector(zone); return !!(el && el.classList && el.classList.contains('lux-modal')); }
    openCompareCard(id) {
        const c = this._cards && this._cards[id]; if (!c) return;
        if (c.noLiveRecap) { this.openCompare(c.beforeImg, c.afterImg, c.title); return; }
        Promise.resolve(this.captureZone(c.zone))
            .then((now) => this.openCompare(c.beforeImg, now || c.afterImg, c.title))
            .catch(() => this.openCompare(c.beforeImg, c.afterImg, c.title));
    }
    openCompare(beforeUrl, afterUrl, title) {
        const stage = document.getElementById('cmp-stage'), after = document.getElementById('cmp-after'), before = document.getElementById('cmp-before');
        if (!stage || !after || !before) return;
        after.style.backgroundImage = `url("${afterUrl}")`;
        before.style.backgroundImage = `url("${beforeUrl}")`;
        const t = document.getElementById('cmp-title'); if (t) t.textContent = title || 'Before → Now';
        stage.style.setProperty('--cmp-seam', '50%');
        this._cmpZoom = 0; stage.style.setProperty('--cmp-bgsize', 'cover');
        const zl = document.getElementById('cmp-zlabel'); if (zl) zl.textContent = 'Fit';
        // Size the stage to the image's aspect within the viewport, but CLAMP that aspect into a sane reading
        // band so no image can size the stage to a sliver. SYSTEMIC backstop: even if a tall full-page capture,
        // a portrait static asset, or a stale "before" reaches here, the stage stays a sane box and the images
        // render `cover` from the top (set above) — focused, aligned, never a thin strip — for EVERY card.
        const probe = new Image();
        probe.onload = () => {
            if (!probe.naturalWidth) return;
            const aspect = Math.max(0.62, Math.min(2.4, probe.naturalWidth / probe.naturalHeight));
            const maxH = window.innerHeight * 0.80, maxW = window.innerWidth * 0.92;
            let h = maxH, w = h * aspect;
            if (w > maxW) { w = maxW; h = w / aspect; }
            stage.style.width = Math.round(w) + 'px';
            stage.style.height = Math.round(h) + 'px';
        };
        probe.src = afterUrl;
        document.getElementById('cmp-overlay').classList.add('open');
        document.getElementById('cmp').classList.add('open');
    }
    zoomCompare(dir) {
        const levels = ['cover', '150%', '220%', '320%'], labels = ['Fit', '1.5×', '2.2×', '3.2×'];
        this._cmpZoom = Math.max(0, Math.min(levels.length - 1, (this._cmpZoom || 0) + dir));
        const stage = document.getElementById('cmp-stage'); if (stage) stage.style.setProperty('--cmp-bgsize', levels[this._cmpZoom]);
        const zl = document.getElementById('cmp-zlabel'); if (zl) zl.textContent = labels[this._cmpZoom];
    }
    closeCompare() {
        document.getElementById('cmp-overlay').classList.remove('open');
        document.getElementById('cmp').classList.remove('open');
    }
    initCompareDrag() {
        const stage = document.getElementById('cmp-stage'); if (!stage) return;
        let dragging = false;
        const setSeam = (x) => { const r = stage.getBoundingClientRect(); const pct = Math.max(2, Math.min(98, ((x - r.left) / r.width) * 100)); stage.style.setProperty('--cmp-seam', pct + '%'); };
        stage.addEventListener('pointerdown', (e) => { dragging = true; setSeam(e.clientX); e.preventDefault(); });
        window.addEventListener('pointermove', (e) => { if (dragging) setSeam(e.clientX); });
        window.addEventListener('pointerup', () => { dragging = false; });
    }

    /* ════════════════════════════════════════════════════════════════════════
     * PERSISTENT, SCROLL-SAFE MARKERS  (replaces the full-page dim spotlight)
     * A marker = subtle accent outline + a small corner tag on a STABLE wrapper,
     * so it scrolls with the content, survives grid re-renders, and persists for
     * the whole session. The active beat pulses once.
     * ════════════════════════════════════════════════════════════════════════ */
    markZone(selector, label, opts) {
        this.markers.set(selector, { label, inside: !!(opts && opts.inside) });
        this.renderMarkers();
        if (!(opts && opts.silent)) {
            const el = document.querySelector(selector);
            // Bring the zone on-screen FIRST, then pulse it (never pulse off-screen).
            if (el) this.scrollTargetIntoView(el).then(() => this.pulseMarker(selector));
            else this.pulseMarker(selector);
        }
    }
    /* Build the two fixed overlay layers once. Frames track their zones in VIEWPORT
     * space (recomputed every frame, clamped to the visible area), so each frame's
     * four sides are ALWAYS on-screen regardless of zone height or scroll. Toasts
     * live in a fixed stack, never in page flow, so they cannot hide under the
     * sticky header. This replaces the old in-flow ::after border + absolute pill. */
    ensureOverlays() {
        if (!this._frames) this._frames = new Map();
        if (!this._pzLayer) { const l = document.createElement('div'); l.id = 'pz-layer'; document.body.appendChild(l); this._pzLayer = l; }
        if (!this._pzToasts) {
            const t = document.createElement('div'); t.id = 'pz-toasts'; document.body.appendChild(t); this._pzToasts = t;
            this.positionToastStack();
            window.addEventListener('resize', () => { this.positionToastStack(); this.repositionMarkers(); });
            window.addEventListener('scroll', () => this.repositionMarkers(), { passive: true });
        }
    }
    sidebarWidth() { return document.body.classList.contains('sb-open') ? (document.querySelector('#sidebar')?.getBoundingClientRect().width || 392) : 0; }
    positionToastStack() { if (this._pzToasts) this._pzToasts.style.top = (this.headerHeight() + 12) + 'px'; }

    renderMarkers() {
        this.ensureOverlays();
        // one frame per marker; create missing, refresh labels
        this.markers.forEach((m, sel) => {
            let f = this._frames.get(sel);
            if (!f) {
                f = document.createElement('div'); f.className = 'pz-frame';
                const tag = document.createElement('span'); tag.className = 'pz-frame-tag'; f.appendChild(tag);
                this._pzLayer.appendChild(f); this._frames.set(sel, f);
            }
            f.querySelector('.pz-frame-tag').textContent = m.label;
            f.dataset.inside = m.inside ? '1' : '0';
        });
        // drop frames whose marker no longer exists
        this._frames.forEach((f, sel) => { if (!this.markers.has(sel)) { f.remove(); this._frames.delete(sel); } });
        this.repositionMarkers();
        this.startMarkerLoop();
    }
    /* Recompute every frame's box from its target's rect, clamped to the safe area
     * (below header, above fold, inside the content column). A rectangle clamped
     * into the visible box always shows all four sides. */
    repositionMarkers() {
        if (!this._frames || !this._frames.size) return;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const vh = window.innerHeight || document.documentElement.clientHeight;
        const safeT = this.headerHeight() + 8, safeB = vh - 8, safeL = 8, safeR = vw - this.sidebarWidth() - 8;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        // Pass 1 — clamp each zone's OWN rect to the safe area. No outset: the border
        // hugs the zone edge, which for padded sections (e.g. #curated has 72px top /
        // 80px side padding) sits in the padding, OFF the content. Outset was what made
        // adjacent frames overlap and pushed lines onto neighbours.
        const boxes = [];
        this._frames.forEach((f, sel) => {
            const el = document.querySelector(sel);
            if (!el) { f.style.display = 'none'; return; }
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) { f.style.display = 'none'; return; }
            const t = clamp(r.top, safeT, safeB), b = clamp(r.bottom, safeT, safeB);
            const l = clamp(r.left, safeL, safeR), rt = clamp(r.right, safeL, safeR);
            if (b - t < 8 || rt - l < 8) { f.style.display = 'none'; return; }   // zone effectively off-screen
            boxes.push({ f, t, b, l, r: rt, clipT: r.top < safeT - 0.5, clipB: r.bottom > safeB + 0.5 });
        });
        // Pass 2 — keep vertically-adjacent frames from touching/overlapping: when two
        // frames that share an x-range come within 7px, split the boundary so a ~7px gap
        // sits between them (this is the fix for the two-frame overlap).
        boxes.sort((a, b) => a.t - b.t);
        for (let i = 1; i < boxes.length; i++) {
            const A = boxes[i - 1], B = boxes[i];
            const sharesX = Math.min(A.r, B.r) - Math.max(A.l, B.l) > 0;
            if (sharesX && B.t < A.b + 7) {
                const mid = (A.b + B.t) / 2;
                A.b = Math.min(A.b, Math.round(mid - 3.5));
                B.t = Math.max(B.t, Math.round(mid + 3.5));
            }
        }
        // Pass 3 — apply. Dashed edge only when a side is TRULY clamped at the fold/header.
        boxes.forEach(({ f, t, b, l, r, clipT, clipB }) => {
            if (b - t < 8) { f.style.display = 'none'; return; }
            f.style.display = 'block';
            f.style.top = t + 'px'; f.style.left = l + 'px'; f.style.width = (r - l) + 'px'; f.style.height = (b - t) + 'px';
            f.classList.toggle('clip-top', clipT);
            f.classList.toggle('clip-bottom', clipB);
        });
    }
    startMarkerLoop() {
        if (this._mLoop) return;
        const tick = () => {
            if (!this._frames || !this._frames.size) { this._mLoop = null; return; }
            this.repositionMarkers();
            this._mLoop = requestAnimationFrame(tick);
        };
        this._mLoop = requestAnimationFrame(tick);
    }
    clearMarkers() {
        this.markers.clear();
        if (this._frames) { this._frames.forEach((f) => f.remove()); this._frames.clear(); }
        if (this._mLoop) { cancelAnimationFrame(this._mLoop); this._mLoop = null; }
        document.querySelectorAll('.pz-marked').forEach((el) => el.classList.remove('pz-marked', 'pz-inside', 'pz-pulse'));
        document.querySelectorAll('.pz-tag').forEach((t) => t.remove());
    }
    pulseMarker(selector) {
        const f = this._frames && this._frames.get(selector);
        if (!f) return;
        f.classList.remove('pulse'); void f.offsetWidth; f.classList.add('pulse');
        setTimeout(() => f.classList.remove('pulse'), 1400);
    }
    /* transient "look here" flash for click targets / panels that aren't persistent zones */
    pulse(target) {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) return;
        el.classList.remove('pz-flash'); void el.offsetWidth; el.classList.add('pz-flash');
        setTimeout(() => el.classList.remove('pz-flash'), 1400);
    }
    /* kept name: clears only the transient highlights — never the persistent markers */
    clearSpotlight() {
        document.querySelectorAll('.pz-flash').forEach((e) => e.classList.remove('pz-flash'));
        document.querySelectorAll('.pz-pulse').forEach((e) => e.classList.remove('pz-pulse'));
    }
    /* backward-compatible alias — any stray spotlight() call becomes a transient flash */
    spotlight(target) { this.pulse(target); }

    /* Always bring the target on-screen FIRST (window scroll + any nested scroll
     * container such as a sidebar panel), let the smooth-scroll settle, THEN
     * recompute the rect and glide the cursor + click. The cursor must never land
     * on an off-screen element. */
    async moveCursorTo(target, opts) {
        const cur = document.getElementById('demo-cursor');
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) return;
        await this.scrollTargetIntoView(el);
        const r = el.getBoundingClientRect();           // recompute AFTER the scroll settles
        const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 40);
        cur.classList.add('show');
        cur.style.left = `${x}px`; cur.style.top = `${y}px`;
        await this.sleep(740);                          // glide (matches the 0.7s CSS transition)
        cur.classList.remove('click'); void cur.offsetWidth; cur.classList.add('click');
        if (!(opts && opts.noClick)) {
            this.markClicked(el);                       // lingering "selected" outline on what we clicked
            await this.sleep(360);                      // register the click ripple
            await this.sleep(420);                      // deliberate pause so the audience can see it
        }
    }
    hideCursor() { document.getElementById('demo-cursor').classList.remove('show'); }

    /* Scroll a target into view in EVERY scroll context (window + nested
     * containers). Skips the scroll when it's already comfortably visible (e.g. a
     * nav link pinned in the sticky header) so we never jump needlessly. */
    async scrollTargetIntoView(el) {
        if (!el || this.fullyInView(el)) return;
        const sc = this.scrollParent(el);
        if (sc) {                                       // nested scroll container (e.g. sidebar): native center
            try { el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); } catch (e) {}
            await this.sleep(560); return;
        }
        // Window scroll: land the element's TOP just below the sticky header so it is
        // never tucked under it (keeps a zone's heading/explanation visible).
        const headerH = this.headerHeight();
        const r = el.getBoundingClientRect();
        const top = Math.max(0, window.scrollY + r.top - headerH - 16);
        try { window.scrollTo({ top, behavior: 'smooth' }); }
        catch (e) { try { el.scrollIntoView(); } catch (_) {} }
        await this.sleep(560);                          // let the smooth-scroll settle
    }
    headerHeight() {
        const h = document.querySelector('.chrome');
        return h ? Math.ceil(h.getBoundingClientRect().height) : 64;
    }
    fullyInView(el) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return true;
        if (el.closest('.chrome')) return true;         // pinned header chrome is always visible
        const sc = this.scrollParent(el);
        if (sc) {                                        // visible region inside a nested scroll container
            const cr = sc.getBoundingClientRect();
            if (r.top < cr.top + 8 || r.bottom > cr.bottom - 8) return false;
        }
        const vh = window.innerHeight || document.documentElement.clientHeight;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        return r.top >= this.headerHeight() + 4 && r.bottom <= vh - 12 && r.left >= 0 && r.right <= vw;
    }
    scrollParent(el) {
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
        }
        return null;
    }
    /* Lingering "this is exactly what I clicked" selection outline (~1.2s). */
    markClicked(el) {
        if (!el) return;
        el.classList.remove('pz-clicked'); void el.offsetWidth; el.classList.add('pz-clicked');
        clearTimeout(el._clickedT);
        el._clickedT = setTimeout(() => el.classList.remove('pz-clicked'), 1200);
    }
    /* Scroll a store zone on-screen, then pulse it (non-cursor "look here" beats). */
    async revealZone(sel) {
        const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
        if (!el) return;
        await this.scrollTargetIntoView(el);
        this.pulse(el);
    }

    /* Narration now lives in the sidebar director section (no floating callout). */
    showCallout(c) {
        document.getElementById('co-usecase').textContent = c.usecase || '';
        document.getElementById('co-title').textContent = c.title || '';
        const set = (id, html) => { const el = document.getElementById(id); if (!el) return; el.innerHTML = html || '—'; const row = el.closest('.co-row'); if (row) row.style.display = html ? 'flex' : 'none'; };
        set('co-signal', c.signal);
        set('co-decision', c.decision);
        set('co-impact', c.impact);
        // Explicit Signal→Decision→Why card when provided; otherwise the prose body.
        const structured = !!(c.signal || c.decision || c.impact);
        const reason = document.getElementById('co-reason');
        const body = document.getElementById('co-body');
        if (reason) reason.style.display = structured ? 'block' : 'none';
        if (body) { body.style.display = structured ? 'none' : 'block'; body.innerHTML = structured ? '' : (c.body || ''); }
    }
    hideCallout() { /* sidebar narration is persistent — nothing to hide */ }

    /* ════════════════════════════════════════════════════════════════════════
     * BEFORE → NOW clarity — a transient pill on the changed store zone, plus an
     * explicit "Before … → Now …" line appended to the sidebar narration. The
     * narration line is stashed and injected by applyStepCallout (which renders
     * the callout body AFTER the beat's run()), so it survives the body swap.
     * ════════════════════════════════════════════════════════════════════════ */
    annotateChange(zoneSel, before, after) {
        // Records this beat's Before→Now. The Personalization Activity panel renders it as a rich
        // provenance card (this replaces the old floating toast — see logActivity / applyStepCallout).
        this._ba = { before, after, zone: zoneSel };
    }
    appendBeforeAfter(before, after) {
        const body = document.getElementById('co-body');
        if (!body) return;
        const old = body.querySelector('.co-ba'); if (old) old.remove();
        const line = document.createElement('div');
        line.className = 'co-ba';
        line.innerHTML = `<span class="co-ba-k">Before</span> ${before} <span class="co-ba-arrow">&#8594;</span> <span class="co-ba-k now">Now</span> ${after}`;
        body.appendChild(line);
    }
    clearChangePills() {
        if (this._pzToasts) this._pzToasts.innerHTML = '';
        document.querySelectorAll('.change-pill').forEach((p) => p.remove());
        this._ba = null;
        // Also reset the Personalization Activity panel (clean slate on Restart / reset).
        const feed = document.getElementById('pzp-feed');
        if (feed) { feed.style.maxHeight = ''; feed.innerHTML = '<div class="pzp-empty">As the store personalizes, each decision lands here — the <b>signal</b>, the <b>segment</b>, the <b>decision</b>, and exactly what changed <b>before → now</b>.</div>'; }
        this._pzCount = 0;
        const cnt = document.getElementById('pz-pill-count'); if (cnt) cnt.textContent = '';
    }
    heroTitleNow() { const el = document.querySelector('#hero-content .hero-title'); return el ? el.textContent.trim() : ''; }
    topNames(gridSel, n) {
        return Array.from(document.querySelectorAll(`${gridSel} .tile .tile-name`)).slice(0, n).map((e) => e.textContent.trim()).join(', ');
    }

    /* First-visit welcome treatment on the store itself (dismissible). */
    showWelcome() { const el = document.getElementById('welcome-ribbon'); if (el) el.classList.add('show'); }
    dismissWelcome() { const el = document.getElementById('welcome-ribbon'); if (el) el.classList.remove('show'); }

    /* ════════════════════════════════════════════════════════════════════════
     * "WHAT CHANGED THIS SESSION" — running list in the Capabilities tab
     * ════════════════════════════════════════════════════════════════════════ */
    changeForStep(idx) {
        return [
            'Anonymous profile minted — no sign-in',
            'Cold-start edit curated with zero history',
            'Hero + grid reshaped to Tabby, in real time',
            'Individual product recommendations generated',
            'Baseline rule-based sort shown (the "before")',
            'PLP re-ranked to her taste',
            '"Complete the Look" module assembled for her',
            'Hero copy & imagery tailored to her taste',
            'Journey stage advanced to ready-to-buy',
            'Opal audience drafted & published (real endpoints)',
            'A/B test measuring the personalized experience',
            'MAB auto-shifting traffic to the winner',
            'CMAB picking a winning variation per context',
            'Search results ranked to her live affinity',
            'Style Concierge replied with real catalog picks',
        ][idx] || '';
    }
    pushChange(idx) {
        if (idx == null || idx < 0 || this.changeIdx.has(idx)) return;
        const text = this.changeForStep(idx);
        if (!text) return;
        this.changeIdx.add(idx);
        this.changeLog.push({ idx, text });
        this.renderChanges();
    }
    renderChanges() {
        const list = document.getElementById('change-list');
        const empty = document.getElementById('change-empty');
        if (empty) empty.style.display = this.changeLog.length ? 'none' : 'block';
        if (!list) return;
        list.innerHTML = this.changeLog.map((c) =>
            `<div class="chg-row"><span class="chg-dot"></span><span>${c.text}</span><span class="chg-step">${c.idx + 1}</span></div>`
        ).join('');
    }
    scrollEngineTo(id) {
        const p = document.getElementById('tab-engine');
        const el = document.getElementById(id);
        if (p && el) p.scrollTop = Math.max(0, el.offsetTop - 14);
    }

    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    /* ════════════════════════════════════════════════════════════════════════
     * DEMO DIRECTOR — 15 distinct feature beats (one per Coach requirement).
     * Beats 1–10 + 14 drive real endpoints / real catalog. Beats 11–13 are
     * clearly labeled "Representative" (the Optimizely capability is GA; the
     * demo simulates the RESULT with illustrative figures). Beat 15 is real-
     * feeling (scripted concierge over the real catalog).
     * ════════════════════════════════════════════════════════════════════════ */
    buildSteps() {
        const TABBY1 = 'COA-CH857', TABBY2 = 'COA-CY201';
        // Concise feature names shown in the live "Coach Requirements" checklist.
        this.featureList = [
            'Customer profile (no sign-in)',
            'Cold-start data',
            'Real-time updates',
            'Recommendations',
            'Sort rules (baseline)',
            'Personalized sort',
            'Personalized page structure',
            'Personalized page content',
            'Journey-stage detection',
            'Opal audience creation',
            'A/B testing',
            'Multi-armed bandit (MAB)',
            'Contextual bandit (CMAB)',
            'AI search',
            'AI chat — Style Concierge',
        ];
        this.steps = [
            /* 1 ── Customer profile without sign-in ─────────────────────────── */
            {
                label: 'Customer profile · No sign-in',
                watch: 'a profile form with no login',
                caption: 'A brand-new visitor arrives — no account, no login — yet a profile forms instantly.',
                run: async () => {
                    this.go('home', { silent: true });
                    await this.sleep(300);
                    // Cold start, made tangible — greet the first-time visitor on the store itself…
                    this.showWelcome();
                    await this.sleep(750);
                    // …then visibly MINT the anonymous profile in the Engine tab.
                    this.setTab('engine');
                    await this.sleep(550);
                    await this.mintAnonIdAnimated();   // show the anon id "forming"
                    const chip = document.getElementById('eng-anon-chip');
                    if (chip) {
                        chip.innerHTML = `&#10003; <b>Anonymous visitor created</b><br>vuid: <b>${this.anonId}</b> · 0 prior visits · no PII captured`;
                        chip.classList.add('show');
                    }
                    this.scrollEngineTo('eng-block-profile');
                    this.pulse('#eng-block-profile');
                },
                callout: { anchor: '#eng-anon', usecase: 'Customer profile — no sign-in',
                    title: 'A profile, before a login',
                    signal: 'First visit — <strong>no cookie, no login, no history</strong>. We have never seen this person.',
                    decision: 'Mint an <strong>anonymous profile</strong> + first segment <strong>new_visitor</strong> — no PII.',
                    impact: 'Personalization can start at <strong>hello</strong>, with zero sign-in friction.',
                    compare: { before: '/images/demo/before-welcome.png', after: '/images/demo/after-welcome.png' } },
            },
            /* 2 ── Cold-start data ──────────────────────────────────────────── */
            {
                label: 'Cold-start data',
                watch: 'the curated first impression',
                caption: 'With zero history, the store still leads with a confident, on-brand edit.',
                run: async () => {
                    this.go('home', { silent: true });
                    await this.sleep(500);
                    this.markZone('#curated-section', 'Cold-start edit');
                },
                callout: { anchor: '#curated-section', usecase: 'Cold-start personalization',
                    title: 'Curated from the first second',
                    signal: 'Zero behavioural history (brand-new visitor).',
                    decision: 'Fall back to <strong>catalog affinity + best-sellers</strong> for the opening edit.',
                    impact: 'A confident, on-brand first impression — not a generic grid — while the engine starts learning.',
                    compare: { before: '/images/demo/before-coldstart.png', after: '/images/demo/after-coldstart.png' } },
            },
            /* 3 ── Real-time updates (live reshape, no reload) ──────────────── */
            {
                label: 'Real-time updates · live reshape',
                watch: 'the hero reshape live',
                caption: 'She views a few Tabby bags — the store reshapes live, with no page reload.',
                run: async () => {
                    this.go('home', { silent: true }); await this.sleep(300);
                    const beforeHero = this.heroTitleNow() || 'Generic seasonal hero';   // REAL before-state
                    await this.driveOpenPdp(TABBY1); await this.sleep(800);
                    await this.driveOpenPdp(TABBY2); await this.sleep(700);
                    // a 3rd Tabby view qualifies the real high-intent Tabby segment
                    await this.driveOpenPdp(TABBY1); await this.sleep(700);
                    this.go('home', { silent: true }); await this.sleep(600);
                    this.markZone('#hero', 'Personalized · hero', { inside: true });
                    this.annotateChange('#hero', `“${beforeHero}”`, `“${this.heroTitleNow() || 'Tailored to Tabby'}”`);
                },
                callout: { anchor: '#hero', usecase: 'Real-time updates',
                    title: 'The store adapts to her, instantly',
                    signal: 'Viewed <strong>Tabby ×3</strong> this session, no add-to-cart.',
                    decision: 'Affinity shifts to <strong>Tabby</strong> → reshape hero + grid, in-session.',
                    impact: 'Relevant within seconds at the edge (&lt;50ms) — <strong>no reload, no waiting for a segment build</strong>.',
                    compare: { before: '/images/demo/before-hero.png', after: '/images/demo/after-hero.png' } },
            },
            /* 4 ── Recommendations (which PRODUCTS) ─────────────────────────── */
            {
                label: 'Recommendations',
                watch: 'the recommended products',
                caption: 'A "Selected for you" module fills with individual product recommendations.',
                run: async () => {
                    if (!this.dominantLine) { await this.driveOpenPdp(TABBY1); await this.driveOpenPdp(TABBY1); }
                    this.go('home', { silent: true });
                    this.renderCurated();
                    await this.sleep(600);
                    this.markZone('#curated-section', 'Recommended for her');
                    const topPick = this.topNames('#curated-grid', 1) || 'her Tabby picks';
                    this.annotateChange('#curated-section', 'Catalog best-sellers (same for all)', `Top pick: ${topPick}`);
                },
                callout: { anchor: '#curated-grid', usecase: 'Recommendations (which products)',
                    title: 'Recommended for her, by product',
                    signal: 'Live <strong>Tabby</strong> affinity + item-to-item similarity.',
                    decision: 'Pick the <strong>individual products</strong> she is most likely to love.',
                    impact: 'Recommendations answer <strong>"which products"</strong> — distinct from how the page adapts (next).',
                    compare: { before: '/images/demo/before-curated.png', after: '/images/demo/after-curated.png' } },
            },
            /* 5 ── Sort rules · BASELINE (the "before") ─────────────────────── */
            {
                label: 'Sort rules · Baseline',
                watch: 'the default product order',
                caption: 'On Handbags, here is the standard rule-based merchandising sort — the "before."',
                run: async () => {
                    const link = document.querySelector('.nav a[data-nav="plp"]');
                    if (link) { await this.moveCursorTo(link); }   // scrolls on-screen, clicks (lingering outline)
                    this.go('plp', { silent: true });
                    await this.sleep(450);
                    this.renderBaselinePLP();
                    await this.sleep(300);
                    await this.revealZone('#plp-grid');
                    document.getElementById('why-body').classList.add('open');
                },
                callout: { anchor: '#plp-grid', usecase: 'Merchandising sort rules (baseline)',
                    title: 'The standard sort — same for everyone',
                    signal: 'No personalization applied (this is the control).',
                    decision: 'Order by <strong>rule-based merchandising</strong>: featured, newest, price.',
                    impact: '<strong>Identical for every shopper.</strong> Watch what personalization does to this exact page next.' },
            },
            /* 6 ── Personalized sort (re-rank to her taste) ─────────────────── */
            {
                label: 'Personalized sort',
                watch: 'the grid re-rank',
                caption: 'The same page re-ranks to her taste — her favorites rise to the top.',
                run: async () => {
                    this.go('plp', { silent: true });
                    this.renderBaselinePLP();
                    await this.sleep(550);
                    const beforeTop = this.topNames('#plp-grid', 3) || 'Featured order';   // REAL baseline top-3
                    this.applySort(this.resolveSort());   // real engine sortOrder + FLIP animation
                    document.getElementById('why-body').classList.add('open');
                    await this.sleep(450);
                    const afterTop = this.topNames('#plp-grid', 3) || 'Re-ranked for her';  // REAL re-ranked top-3
                    this.markZone('#plp-grid-wrap', 'Re-ranked for her');
                    this.annotateChange('#plp-grid-wrap', beforeTop, afterTop);
                },
                callout: { anchor: '#plp-grid', usecase: 'Personalized sort',
                    title: 'Her favorites rise to the top',
                    signal: 'Her <strong>Tabby</strong> affinity (from this session).',
                    decision: 'Re-rank the same grid via the engine\'s real <code>sortOrder</code> — Tabby to the top.',
                    impact: 'Same products, <strong>her order</strong> → higher relevance & conversion. Before vs Now is marked on the grid.',
                    compare: { before: '/images/demo/before-grid.png', after: '/images/demo/after-grid.png' } },
            },
            /* 7 ── Personalized page STRUCTURE (layout adapts) ──────────────── */
            {
                label: 'Personalized page structure',
                watch: 'a new module appear',
                caption: 'On the product page the layout itself adapts — a new module assembles for her.',
                run: async () => {
                    await this.driveOpenPdp(TABBY1);
                    await this.sleep(1100);
                    const ctl = document.getElementById('ctl');
                    if (ctl.classList.contains('revealed')) {
                        this.markZone('#ctl', 'Styled module · for her', { inside: true });
                        this.annotateChange('#ctl', 'Gallery + details only', '“Complete the Look” module assembled');
                    } else {
                        this.markZone('#pdp-recs-section', 'Recommended for her');
                        this.annotateChange('#pdp-recs-section', 'Standard “You may also like”', 'Module promoted & re-ordered for her');
                    }
                },
                callout: { anchor: '#ctl', usecase: 'Personalized page structure',
                    title: 'The page rearranges for her',
                    signal: 'Qualified <strong>high-intent Tabby browser</strong>.',
                    decision: 'Insert a <strong>"Complete the Look"</strong> module + promote her Tabby section.',
                    impact: 'The <strong>layout itself</strong> adapts — not just the products — toward bigger baskets.',
                    compare: { before: '/images/demo/before-pdp.png', after: '/images/demo/after-pdp.png' } },
            },
            /* 8 ── Personalized page CONTENT (copy/imagery adapts) ──────────── */
            {
                label: 'Personalized page content',
                watch: 'the hero copy & imagery',
                caption: 'And the content adapts too — hero copy, imagery and messaging tailored to her.',
                run: async () => {
                    this.go('home', { silent: true });
                    await this.sleep(550);
                    this.markZone('#hero', 'Content tailored · hero', { inside: true });
                    this.annotateChange('#hero', 'Generic seasonal copy & image', `“${this.heroTitleNow() || 'Tabby edit'}” · Tabby copy & imagery`);
                },
                callout: { anchor: '#hero-content', usecase: 'Personalized page content',
                    title: 'The words & imagery change too',
                    signal: 'Her dominant taste is <strong>Tabby</strong>.',
                    decision: 'Swap the hero\'s <strong>headline, image & message</strong> to match (same layout).',
                    impact: 'Structure decides the <strong>"where"</strong>; content decides the <strong>"what."</strong>',
                    compare: { before: '/images/demo/before-hero.png', after: '/images/demo/after-hero.png' } },
            },
            /* 9 ── Journey-stage detection ──────────────────────────────────── */
            {
                label: 'Journey-stage detection',
                watch: 'the messaging shift',
                caption: 'She adds a bag — the store recognizes she is ready to buy and shifts its tone.',
                run: async () => {
                    if (this.currentView() !== 'pdp') { await this.driveOpenPdp(TABBY1); await this.sleep(700); }
                    await this.driveAddToCart();
                    await this.sleep(900);
                    this.closeCart(); await this.sleep(300);
                    this.markZone('.pdp', 'Journey: ready-to-buy', { inside: true });
                },
                callout: { anchor: '#pdp-urgency', usecase: 'Journey-stage detection',
                    title: 'Discovery → Consideration → Ready-to-buy',
                    signal: 'She just <strong>added a bag to cart</strong>.',
                    decision: 'Advance journey stage to <strong>ready-to-buy</strong>; shift tone to urgency + service.',
                    impact: 'The right message for <strong>where she is in the funnel</strong> — not a generic promo.',
                    compare: { before: '/images/demo/before-journey.png', after: '/images/demo/after-journey.png' } },
            },
            /* 10 ── Opal · AI audience builder (no developer) ───────────────── */
            {
                label: 'Opal · AI audience builder',
                watch: 'a new audience go live',
                caption: 'A merchandiser describes an audience in plain English and publishes it.',
                run: async () => {
                    this.hideCursor(); this.setTab('opal');
                    await this.runOpalStep();
                },
                callout: { anchor: '#opal', usecase: 'Opal · audience creation',
                    title: 'From a sentence to a live audience',
                    signal: 'A merchandiser types a request in <strong>plain English</strong>.',
                    decision: 'Opal builds a real audience from live behaviour; a human clicks <strong>Publish</strong>.',
                    impact: '<strong>Live in seconds — no developer, no release.</strong> The operator-side wedge vs DY.',
                    compare: { before: '/images/demo/before-banner.png', after: '/images/demo/after-banner.png' } },
            },
            /* 11 ── A/B testing (representative figures) ────────────────────── */
            {
                label: 'A/B testing',
                watch: 'a welcome A/B test go live on the banner',
                caption: 'An A/B test runs on the welcome banner — email-for-15% vs phone-for-10% — live and measured.',
                run: async () => {
                    this.closeOpal(); this.hideCursor();
                    await this.runExperimentScenario('welcome_email_phone', 'email_15');
                    this.setTab('engine');
                    this.showAbReadout();
                    await this.sleep(300);
                    this.scrollEngineTo('ab-readout'); this.pulse('#ab-readout');
                },
                callout: { anchor: '#ab-readout', usecase: 'A/B testing & measurement',
                    title: 'Every change is an experiment',
                    signal: 'The personalized modules are live to shoppers.',
                    decision: 'Run them as <strong>A/B tests</strong> so each earns its place on measured lift.',
                    impact: 'Personalize boldly, <strong>prove the impact</strong>. Figures <strong>illustrative</strong>; the platform is GA.',
                    compare: { before: '/images/demo/before-hero.png', after: '/images/demo/after-hero.png' } },
            },
            /* 12 ── MAB · multi-armed bandit (representative) ───────────────── */
            {
                label: 'Multi-armed bandit (MAB)',
                watch: 'four hero creatives auto-optimize',
                caption: 'A multi-armed bandit runs four hero creatives and auto-shifts traffic to the winner — no manual ramp.',
                run: async () => {
                    this.hideCursor();
                    await this.runExperimentScenario('hero_creative_bandit', 'editorial');
                    this.setTab('engine');
                    this.showMab();
                    await this.sleep(400);
                    this.scrollEngineTo('mab-readout'); this.pulse('#mab-readout');
                },
                callout: { anchor: '#mab-readout', usecase: 'Multi-armed bandit (MAB)',
                    title: 'Traffic finds the winner automatically',
                    signal: 'Live variation performance (no fixed 50/50 split).',
                    decision: 'A <strong>multi-armed bandit</strong> shifts traffic to the best performer as it learns.',
                    impact: 'Capture lift sooner, no manual ramp. <strong>Representative figures; Optimizely MAB is GA.</strong>',
                    compare: { before: '/images/demo/before-grid.png', after: '/images/demo/after-grid.png' } },
            },
            /* 13 ── CMAB · contextual bandit (representative) ───────────────── */
            {
                label: 'Contextual bandit (CMAB)',
                watch: 'a different offer per shopper-context',
                caption: 'A contextual bandit serves a different winning offer per shopper-context — the thing DY structurally cannot do.',
                run: async () => {
                    this.hideMab(); this.hideCursor();
                    await this.runExperimentScenario('context_welcome', 'new_value');
                    this.setTab('engine');
                    this.showCmab();
                    await this.sleep(400);
                    this.scrollEngineTo('cmab-readout'); this.pulse('#cmab-readout');
                },
                callout: { anchor: '#cmab-readout', usecase: 'Contextual bandit (CMAB)',
                    title: 'A different winner per shopper-context',
                    signal: 'Each shopper\'s <strong>context</strong> — device, segment, intent.',
                    decision: 'A <strong>contextual bandit</strong> serves the variation that wins <em>for that context</em>.',
                    impact: 'Mobile Tabby-lovers & desktop gifters each get their own winner. <strong>Representative.</strong>',
                    compare: { before: '/images/demo/before-pdp.png', after: '/images/demo/after-pdp.png' } },
            },
            /* 14 ── AI search (real affinity ranking over real catalog) ────── */
            {
                label: 'AI search',
                watch: 'a styled Edit + affinity-ranked results',
                caption: 'A shopper searches in plain language — AI ranks the real catalog and styles an Edit on her actual bag.',
                run: async () => {
                    this.hideCmab(); this.hideCursor();
                    this.openSearch();
                    await this.sleep(500);
                    await this.typeIntoInput('search-input', 'bags for a winter wedding');
                    await this.runSearch(document.getElementById('search-input').value, { live: true });
                    this.logEvent('search', 'search', 'bags for a winter wedding');
                    await this.sleep(600);
                    this.pulse('#search-edit');
                },
                callout: { anchor: '#search', usecase: 'AI / personalized search',
                    title: 'Search that understands intent — and styles it',
                    signal: 'A natural-language query — <em>"bags for a winter wedding"</em> (intent, not keywords).',
                    decision: 'Rank the real catalog by <strong>occasion, style & her live affinity</strong> — then render an <strong>AI-styled Edit</strong> of the real product.',
                    impact: 'She doesn\'t just see results — <strong>she sees herself there</strong>. Relevance from the first result.',
                    compare: { before: '/images/demo/before-modal.png', after: '/images/demo/after-search.png' } },
            },
            /* 15 ── AI chat · Style Concierge (real-feeling, scripted) ──────── */
            {
                label: 'AI chat · Style Concierge',
                watch: 'a styled look + product picks',
                caption: 'A conversational Style Concierge replies in plain language, styles the look, and pulls the real pieces.',
                run: async () => {
                    this.closeSearch(); this.hideCursor();
                    this.openConcierge();
                    await this.sleep(500);
                    await this.typeIntoInput('cc-input', 'What should I carry to a winter wedding?');
                    await this.sleep(250);
                    await this.conciergeAsk(document.getElementById('cc-input').value);
                    await this.sleep(300);
                    this.pulse('#cc-thread');
                },
                callout: { anchor: '#concierge', usecase: 'AI chat (Style Concierge)',
                    title: 'A stylist in the chat',
                    signal: 'A styling question in <strong>plain language</strong>.',
                    decision: 'The concierge replies with on-brand rationale, an <strong>AI-styled look</strong>, and <strong>real catalog pieces</strong>.',
                    impact: '<strong>Conversational commerce that shows the vision</strong> — taps straight to product.',
                    compare: { before: '/images/demo/before-modal.png', after: '/images/demo/after-concierge.png' } },
            },
        ];
    }

    currentView() {
        if (document.getElementById('view-pdp').classList.contains('active')) return 'pdp';
        if (document.getElementById('view-plp').classList.contains('active')) return 'plp';
        return 'home';
    }

    /* — driven micro-interactions (cursor + spotlight + real action) — */
    async driveOpenPdp(id) {
        // Point at the tile if present (moveCursorTo scrolls it on-screen first); else just navigate.
        const tile = document.querySelector(`#view-${this.currentView()} .tile[data-id="${id}"]`) ||
                     document.querySelector(`.tile[data-id="${id}"]`);
        if (tile) { await this.moveCursorTo(tile); }
        await this.openPdp(id);
        await this.sleep(120);
    }
    async driveGo(view) {
        const link = document.querySelector(`.nav a[data-nav="${view}"]`);
        if (link) { await this.moveCursorTo(link); }
        this.go(view);
    }
    async driveAddToCart() {
        const btn = document.getElementById('pdp-add');
        if (btn) { await this.moveCursorTo(btn); }
        this.addAnchorToCart();
    }

    /* — Director control flow — */
    /* Show the step-progress component immediately (Step 1, ready) WITHOUT running the beat, so the
     * progress bar / label / caption are ALWAYS visible — never gated behind clicking Next. */
    previewStep(idx) {
        const step = this.steps && this.steps[idx]; if (!step) return;
        const sb = document.getElementById('sidebar'); if (sb) sb.dataset.state = 'running';
        const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
        set('dir-step-label', (el) => el.textContent = `Step ${idx + 1} of ${this.steps.length} · ${step.label}`);
        set('dir-bar-fill', (el) => el.style.width = `${((idx + 1) / this.steps.length) * 100}%`);
        set('dir-watch', (el) => el.innerHTML = `Watch: <b>${step.watch}</b>`);
        set('dir-caption', (el) => el.textContent = step.caption);
        const st = document.getElementById('sb-step'); if (st) st.classList.add('preview');  // hides the empty Signal/Decision/Why until the beat runs
        set('dir-back', (el) => el.disabled = true);
        set('dir-next', (el) => { el.disabled = false; el.innerHTML = 'Start &#9658;'; });
        this.showPzPanel();   // the activity panel is visible from load (empty state advertises it)
    }
    startDemo() {
        this.demoActive = true;
        document.getElementById('sidebar').dataset.state = 'running';
        this.toggleSidebar(true);   // ensure the store is pushed left and controls are visible
        this.stepIndex = -1;
        this.nextStep();
    }
    restartDemo() {
        this.stopAutoplay();
        this.hideCallout(); this.clearSpotlight(); this.hideCursor();
        this.hideTransientPanels(); this.closeCart();
        this.clearChangePills(); this.clearMarkers();    // clean slate on restart
        this.resetMomentEncore();   // tear down the Signal-Led Moment encore (button, feed, countdown, takeover)
        try { window.dispatchEvent(new Event('opal:reset')); } catch (e) {}   // fresh Opal chat per demo run
        this.ticked.clear(); this.renderChecklist(-1);   // Restart resets the checklist
        this.resetShopper();
        this.stepIndex = -1;
        this.previewStep(0);   // restart → step 1 ready (click Next/Start to begin); step stays visible
    }
    /* Clear ONLY the demo-captured events in D1 (POST /operator/events/reset).
     * Companion to the client-only Restart (↻) above: Restart resets this browser's
     * demo UI; this clears the SERVER-side events captured during demo runs. The
     * historical Coach dataset (profiles, orders, payment history) is kept, so Opal
     * still builds meaningful audiences over the historical+demo union afterwards. */
    async resetDemoData() {
        const btn = document.getElementById('dir-clear-demo');
        if (btn && btn.disabled) return;
        if (!window.confirm('Clear demo-captured events?\n\nThis deletes only events captured during demo runs. The historical Coach dataset (3,200 profiles, orders, payment history) is kept.')) return;
        if (btn) btn.disabled = true;
        let out = null;
        try {
            const r = await fetch('/operator/events/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scope: 'all' }),
            });
            out = await r.json();
        } catch (e) { console.error('reset demo data failed', e); }
        if (btn) btn.disabled = false;
        const n = (out && typeof out.deletedDemoEvents === 'number') ? out.deletedDemoEvents : 0;
        this.logEvent('post', 'demo:reset', `cleared ${n} demo event${n === 1 ? '' : 's'} · historical kept`, null, null);
    }
    async nextStep() {
        if (this.busy) return;
        if (this.encoreActive) { await this.nextArcStep(); return; }   // Signal-Led Moment arc owns Next while active
        if (this.stepIndex >= this.steps.length - 1) { if (this.autoplay) this.stopAutoplay(); return; }
        await this.gotoStep(this.stepIndex + 1);
    }
    async prevStep() {
        if (this.encoreActive) return;   // the encore arc is forward-only; Restart exits it
        if (this.busy || this.stepIndex <= 0) return;
        // Stepping back re-runs from a clean shopper to keep state honest.
        this.stopAutoplay();
        const target = this.stepIndex - 1;
        this.resetShopper();
        this.hideTransientPanels();
        for (let i = 0; i <= target; i++) {
            // replay silently up to the target-1, then run target with visuals
            await this.gotoStep(i, { fast: i < target });
        }
    }
    /* Capability rows jump straight to a beat: reset to a clean shopper and replay
     * silently up to the target (so cumulative state is honest), then run the
     * target beat with full visuals — same honest-state approach as prevStep. */
    async jumpToStep(idx) {
        if (idx == null || idx < 0 || idx >= this.steps.length || this.busy) return;
        this.stopAutoplay();
        if (!this.demoActive) {
            this.demoActive = true;
            document.getElementById('sidebar').dataset.state = 'running';
        }
        this.toggleSidebar(true);
        this.resetShopper();
        this.hideTransientPanels();
        for (let i = 0; i <= idx; i++) await this.gotoStep(i, { fast: i < idx });
    }
    async gotoStep(idx, opts) {
        const fast = opts && opts.fast;
        this.busy = true;
        this.demoActive = true;
        const st = document.getElementById('sb-step'); if (st) st.classList.remove('preview');  // beat runs → real callout shows
        this.stepIndex = idx;
        const step = this.steps[idx];
        this.stopAutoplayTimerOnly();

        // chrome
        this.hideCallout(); this.clearSpotlight(); this.hideTransientPanels();
        // Before→Now toasts PERSIST across beats now (stored until × or Restart) — not cleared per step.
        if (idx !== 0) this.dismissWelcome();    // first-visit ribbon only belongs on beat 1
        this.tickFeature(idx);   // mark this requirement on the live checklist
        document.getElementById('dir-step-label').textContent = `Step ${idx + 1} of ${this.steps.length} · ${step.label}`;
        document.getElementById('dir-bar-fill').style.width = `${((idx + 1) / this.steps.length) * 100}%`;
        document.getElementById('dir-watch').innerHTML = `Watch: <b>${step.watch}</b>`;
        document.getElementById('dir-caption').textContent = step.caption;
        document.getElementById('dir-back').disabled = idx === 0;
        const nextBtn = document.getElementById('dir-next');
        nextBtn.innerHTML = 'Next &#9658;';   // (preview shows "Start"; once running it's "Next")
        nextBtn.disabled = true;

        try {
            if (fast) { await this.runStepFast(idx); }
            else { await step.run(); await this.applyStepCallout(step); }
        } catch (e) { console.error('step error', e); }
        this.pushChange(idx);   // log "what changed this session" (deduped per beat)

        this.busy = false;
        if (!fast) {
            nextBtn.disabled = false;
            if (idx >= this.steps.length - 1) { nextBtn.disabled = true; this.stopAutoplay(); this.showEncore(); }   // beat 15 done → offer the encore
            if (this.autoplay && idx < this.steps.length - 1) this.scheduleAutoplay();
        }
    }
    async applyStepCallout(step) {
        if (!step.callout) return;
        this.showCallout(step.callout);
        // Patch live values into callout bodies that declare placeholders.
        const stageSpan = document.getElementById('co-stage');
        if (stageSpan) stageSpan.textContent = this.journeyStage;
        const anonSpan = document.getElementById('co-anon');
        if (anonSpan) anonSpan.textContent = this.anonId;
        // Inject the runtime "Before → Now" line + log a rich provenance card to the Activity panel.
        const ba = this._ba;
        if (ba) this.appendBeforeAfter(ba.before, ba.after);
        const zone = (ba && ba.zone) || (step.callout.compare && step.callout.compare.zone) || step.callout.anchor || null;
        const staticBefore = step.callout.compare && step.callout.compare.before;
        const staticAfter = step.callout.compare && step.callout.compare.after;
        // No static "after" asset (e.g. the TikTok takeover — a live, generated hero) but we have a zone:
        // photograph the live "now" up-front so the Compare card can register (it needs before+after to exist).
        const liveAfter = (!staticAfter && zone) ? await this.captureZone(zone) : null;
        const id = this.logActivity({
            usecase: step.callout.usecase,
            headline: step.callout.title,
            signal: step.callout.signal,
            segment: this.activitySegment(),
            decision: step.callout.decision,
            evidence: this.activityEvidence(),
            before: ba && ba.before,
            after: ba && ba.after,
            zone: zone,
            // "before" = the live virgin baseline if we have it (else the static asset);
            // "after" = the static asset as an immediate fallback — overwritten by the live capture below,
            // and RE-captured live the instant the user clicks Compare (openCompareCard).
            beforeImg: (zone && this._baseline[zone]) || staticBefore,
            afterImg: staticAfter || liveAfter,
        });
        // Photograph the live "now" at beat-end so the card always holds a real snapshot of THIS state,
        // not a frozen PNG — UNLESS it's a modal zone (Search/Concierge), which html2canvas can't render;
        // those keep their baked real-browser screenshot and never re-capture.
        if (id && this._cards[id] && zone) {
            if (this._isModalZone(zone)) {
                this._cards[id].noLiveRecap = true;
            } else {
                this.captureZone(zone).then((img) => { if (img && this._cards[id]) this._cards[id].afterImg = img; });
            }
        }
        this._ba = null;
    }

    // Replay a beat's *effects* without animation (used when stepping backward).
    // Only beats that change shopper state need to rebuild it; the panel/modal
    // beats (Opal, A/B, MAB, CMAB, Search, Chat) are reconstructed by the live run.
    async runStepFast(idx) {
        const TABBY1 = 'COA-CH857', TABBY2 = 'COA-CY201';
        if (idx === 0) { this.go('home', { silent: true }); }
        else if (idx === 1) { this.go('home', { silent: true }); this.markZone('#curated-section', 'Cold-start edit', { silent: true }); }
        else if (idx === 2) { await this.openPdp(TABBY1); await this.openPdp(TABBY2); await this.openPdp(TABBY1); this.go('home', { silent: true }); this.markZone('#hero', 'Personalized · hero', { inside: true, silent: true }); }
        else if (idx === 3) { this.go('home', { silent: true }); this.renderCurated(); this.markZone('#curated-section', 'Recommended for her', { silent: true }); }
        else if (idx === 4) { this.go('plp', { silent: true }); this.renderBaselinePLP(); }
        else if (idx === 5) { this.go('plp', { silent: true }); this.applySort(this.resolveSort()); this.markZone('#plp-grid-wrap', 'Re-ranked for her', { silent: true }); }
        else if (idx === 6) { await this.openPdp(TABBY1); const ctl = document.getElementById('ctl'); if (ctl.classList.contains('revealed')) this.markZone('#ctl', 'Styled module · for her', { inside: true, silent: true }); else this.markZone('#pdp-recs-section', 'Recommended for her', { silent: true }); }
        else if (idx === 7) { this.go('home', { silent: true }); this.markZone('#hero', 'Content tailored · hero', { inside: true, silent: true }); }
        else if (idx === 8) { if (this.currentView() !== 'pdp') await this.openPdp(TABBY1); this.addAnchorToCart(); this.closeCart(); this.markZone('.pdp', 'Journey: ready-to-buy', { inside: true, silent: true }); }
        else if (idx === 10) { await this.openPdp(TABBY1); }
        // idx 9 (Opal), 11 (MAB), 12 (CMAB), 13 (Search), 14 (Chat): live-only.
        await this.sleep(80);
    }

    /* — Auto-play — */
    toggleAutoplay() {
        this.autoplay = !this.autoplay;
        document.getElementById('autoplay-switch').classList.toggle('on', this.autoplay);
        if (this.autoplay && this.demoActive && !this.busy && this.stepIndex < this.steps.length - 1) this.scheduleAutoplay();
        if (!this.autoplay) this.stopAutoplayTimerOnly();
    }
    scheduleAutoplay() {
        this.stopAutoplayTimerOnly();
        this.autoplayTimer = setTimeout(() => { if (this.autoplay) this.nextStep(); }, 6200);
    }
    stopAutoplayTimerOnly() { if (this.autoplayTimer) { clearTimeout(this.autoplayTimer); this.autoplayTimer = null; } }
    stopAutoplay() { this.autoplay = false; document.getElementById('autoplay-switch').classList.remove('on'); this.stopAutoplayTimerOnly(); }

    /* ════════════════════════════════════════════════════════════════════════
     * STEP 6 — OPAL inline audience builder (real /operator endpoints)
     * ════════════════════════════════════════════════════════════════════════ */
    async runOpalStep() {
        this.setTab('opal');
        await this.sleep(500);
        // Drive the REAL Opal chat (no scripted prop): plain-English → a real audience + flag, live.
        const prompt = "Create a Luxe Collectors audience for customers whose persona is luxe_collector, then launch a complete-the-look flag live to them.";
        window.dispatchEvent(new CustomEvent('opal:ask', { detail: { text: prompt } }));
        this.logEvent('post', 'opal:ask', 'luxe-collectors', null, null);
    }
    renderOpalResult(draft) {
        this.opalAudience = draft;
        const stats = draft.stats || {};
        document.getElementById('opal-aud-name').textContent = draft.name || draft.key;
        document.getElementById('opal-aud-desc').textContent = draft.description || '';
        document.getElementById('opal-stat-size').textContent = (stats.audience_size != null) ? stats.audience_size.toLocaleString() : '—';
        document.getElementById('opal-stat-aov').textContent = (stats.avg_order_value_usd != null) ? '$' + stats.avg_order_value_usd : '—';
        document.getElementById('opal-stat-pct').textContent = (stats.audience_pct_of_base != null) ? stats.audience_pct_of_base + '%' : '—';
        const moduleLabel = (draft.recommendedModule || '').replace(/_/g, ' ');
        document.getElementById('opal-action').innerHTML = `Recommended experience: <b>${moduleLabel || 'personalized module'}</b>${draft.anchorLine ? ` for <b>${draft.anchorLine}</b>` : ''}.`;
        document.getElementById('opal-conditions').textContent = JSON.stringify(draft.conditions, null, 2);
        const pub = document.getElementById('opal-publish'); pub.disabled = false; pub.textContent = 'Publish audience';
        document.getElementById('opal-published').classList.remove('show');
        document.getElementById('opal-conditions').classList.remove('show');
        document.getElementById('opal-result').classList.add('show');
        setTimeout(() => this.scrollOpalPanelTo(document.getElementById('opal-result')), 580);
    }
    async publishOpalAudience() {
        if (!this.opalAudience) return;
        const pub = document.getElementById('opal-publish');
        pub.disabled = true; pub.textContent = 'Publishing…';
        let res = null;
        try {
            const r = await fetch('/operator/audiences/publish', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audience: this.opalAudience }),
            });
            res = await r.json();
            this.logEvent('post', 'opal:publish', res.audienceId || 'published', null, null);
        } catch (e) { console.error('opal publish failed', e); }
        const note = document.getElementById('opal-published');
        note.innerHTML = `&#10003; <b>Live now.</b> "${this.opalAudience.name}" is qualifying shoppers in real time${res && res.audienceId ? ` · <span style="opacity:.8">${res.audienceId}</span>` : ''}.`;
        note.classList.add('show');
        pub.textContent = 'Published';
        setTimeout(() => this.scrollOpalPanelTo(note, 44), 140);
    }
    openOpal() {
        this.setTab('opal');   // Opal lives in a sidebar tab now (no modal overlay)
        const p = document.getElementById('opal-prompt'); if (p) p.innerHTML = '<span class="caret"></span>';
        const r = document.getElementById('opal-result'); if (r) r.classList.remove('show');
        const pub = document.getElementById('opal-published'); if (pub) pub.classList.remove('show');
    }
    closeOpal() {
        // Tab-resident: just reset the transient result state so the next run is clean.
        const r = document.getElementById('opal-result'); if (r) r.classList.remove('show');
        const pub = document.getElementById('opal-published'); if (pub) pub.classList.remove('show');
    }
    toggleOpalConditions() { document.getElementById('opal-conditions').classList.toggle('show'); }
    /* Scroll the Opal sidebar panel so a freshly-revealed element (the result card / the
     * publish confirmation) lands in view — the panel is short, so new content otherwise
     * appears below the fold. Scrolls ONLY the panel, never the window. */
    scrollOpalPanelTo(el, pad = 16) {
        const panel = document.getElementById('tab-opal');
        if (!panel || !el) return;
        const top = el.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - pad;
        try { panel.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); } catch (e) { panel.scrollTop = Math.max(0, top); }
    }
    async typeInto(id, text) {
        const el = document.getElementById(id);
        el.innerHTML = '';
        for (let i = 0; i < text.length; i++) {
            el.textContent = text.slice(0, i + 1);
            el.innerHTML = el.textContent + '<span class="caret"></span>';
            await this.sleep(22 + Math.random() * 26);
        }
    }

    /* ════════════════════════════════════════════════════════════════════════
     * STEP 7 — A/B results readout (clearly-labeled illustrative figures)
     * ════════════════════════════════════════════════════════════════════════ */
    showAbReadout() {
        const wrap = document.getElementById('ab-arms');
        const baseCvr = 3.1, winCvr = 4.6;
        wrap.innerHTML = `
            <div class="ab-arm win">
                <div class="ab-arm-top"><span class="ab-arm-name"><b>Personalized</b> · Complete the Look</span><span class="ab-arm-cvr">${winCvr}%</span></div>
                <div class="ab-track"><i style="width:0" data-w="100"></i></div>
            </div>
            <div class="ab-arm base">
                <div class="ab-arm-top"><span class="ab-arm-name">Control · Static page</span><span class="ab-arm-cvr">${baseCvr}%</span></div>
                <div class="ab-track"><i style="width:0" data-w="${Math.round((baseCvr / winCvr) * 100)}"></i></div>
            </div>`;
        const lift = Math.round(((winCvr - baseCvr) / baseCvr) * 100);
        document.getElementById('ab-foot').innerHTML = `<b>+${lift}% conversion</b> for the personalized experience · 96% confidence.`;
        document.getElementById('ab-readout').classList.add('show');
        requestAnimationFrame(() => setTimeout(() => {
            wrap.querySelectorAll('.ab-track > i').forEach((i) => { i.style.width = i.dataset.w + '%'; });
        }, 80));
    }
    hideAbReadout() { document.getElementById('ab-readout').classList.remove('show'); }

    /* ════════════════════════════════════════════════════════════════════════
     * STEP 1 — show the anonymous id "forming" (no sign-in)
     * ════════════════════════════════════════════════════════════════════════ */
    async mintAnonIdAnimated() {
        const el = document.getElementById('eng-anon');
        if (!el) return;
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
        for (let f = 0; f < 6; f++) {
            el.textContent = 'v-' + Array.from({ length: 9 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            await this.sleep(70);
        }
        el.textContent = this.anonId;   // settle on the real id we actually send to the edge
    }

    /* ════════════════════════════════════════════════════════════════════════
     * STEPS 5–6 — baseline (rule-based) PLP, then personalized re-rank
     * ════════════════════════════════════════════════════════════════════════ */
    renderBaselinePLP() {
        const baseline = this.orderForSort({ sort: 'featured' });
        this.plpItems = baseline;
        this.paintGrid(document.getElementById('plp-grid'), baseline, { recommended: false });
        const sel = document.getElementById('plp-sort'); if (sel) sel.value = 'featured';
        document.getElementById('sort-caption').classList.remove('show');
        const body = document.getElementById('why-body');
        body.classList.remove('open');
        body.innerHTML = `Sorted by <strong>Featured</strong> — our standard merchandising rules (newness, stock, margin). The same order for every shopper.`;
    }

    /* ════════════════════════════════════════════════════════════════════════
     * COACH REQUIREMENTS — live capability checklist
     * ════════════════════════════════════════════════════════════════════════ */
    buildChecklist() {
        const list = document.getElementById('req-list');
        if (!list || !this.featureList) return;
        list.innerHTML = this.featureList.map((f, i) =>
            `<div class="req-row" data-feat="${i}" role="button" tabindex="0" title="Jump to this demonstration" ` +
            `onclick="store.jumpToStep(${i})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();store.jumpToStep(${i});}">` +
            `<span class="req-num">${i + 1}</span><span class="req-check"></span><span class="req-label">${f}</span><span class="req-go">Go &#8594;</span></div>`
        ).join('');
        this.renderChecklist(-1);
    }
    tickFeature(idx) {
        if (idx == null || idx < 0) return;
        this.ticked.add(idx);
        this.renderChecklist(idx);
        // flash the Capabilities tab badge so progress reads even from another tab
        const tabBtn = document.querySelector('.sb-tab[data-tab="capabilities"]');
        if (tabBtn) { tabBtn.classList.remove('flash'); void tabBtn.offsetWidth; tabBtn.classList.add('flash'); }
        // keep the active row visible — scroll the Capabilities panel only (never the window)
        const panel = document.getElementById('tab-capabilities');
        const row = panel && panel.querySelector(`.req-row[data-feat="${idx}"]`);
        if (row && panel) { const pr = panel.getBoundingClientRect(), rr = row.getBoundingClientRect(); panel.scrollTop += (rr.top - pr.top) - pr.height / 2 + rr.height / 2; }
    }
    renderChecklist(activeIdx) {
        document.querySelectorAll('#req-list .req-row').forEach((row) => {
            const i = +row.dataset.feat;
            row.classList.toggle('done', this.ticked.has(i));
            row.classList.toggle('active', i === activeIdx);
        });
        const count = document.getElementById('req-count');
        if (count) count.textContent = `${this.ticked.size} / ${this.featureList.length}`;
        const tab = document.getElementById('req-count-tab');
        if (tab) tab.textContent = `${this.ticked.size}/${this.featureList.length}`;
    }
    toggleChecklist() { this.setTab('capabilities'); }
    toggleChecklistCollapse() { this.setTab('capabilities'); }

    /* Hide every step-scoped panel/modal so beats never bleed into each other. */
    hideTransientPanels() {
        this.hideAbReadout();
        this.hideMab();
        this.hideCmab();
        this.closeOpal();
        this.closeSearch();
        this.closeConcierge();
    }

    /* ════════════════════════════════════════════════════════════════════════
     * STEP 12 — MAB: traffic auto-allocates to the winner (representative)
     * ════════════════════════════════════════════════════════════════════════ */
    /* arms (optional): three {name, win?} — winner at index 1 (matches the convergence seq). opts.note
     * overrides the "Representative …" honesty chip (the moment carries the verbatim §3 OPTIMIZE label).
     * Default (no args) = beats-12 behavior, unchanged. Reused by the Signal-Led Moment OPTIMIZE (doc 12 §6 E5). */
    showMab(arms, opts) {
        opts = opts || {};
        const def = [
            { name: 'Variation A · Classic hero' },
            { name: 'Variation B · Complete-the-Look', win: true },
            { name: 'Variation C · Premium edit' },
        ];
        arms = (Array.isArray(arms) && arms.length === 3) ? arms : def;
        const winIdx = Math.max(0, arms.findIndex((a) => a.win));
        // Default (beat 12) keeps the exact original "Variation B" promotion text; the moment uses its winner name.
        const winName = (arms === def) ? 'Variation B' : ((arms[winIdx] && arms[winIdx].name) || 'the winner');
        const wrap = document.getElementById('mab-arms');
        wrap.innerHTML = arms.map((a) =>
            `<div class="ab-arm ${a.win ? 'win' : 'base'}">
                <div class="ab-arm-top"><span class="ab-arm-name">${a.win ? '<b>' + a.name + '</b>' : a.name}</span><span class="ab-arm-cvr mab-traffic">33%</span></div>
                <div class="ab-track"><i style="width:33%"></i></div>
            </div>`).join('');
        const bars = wrap.querySelectorAll('.ab-track > i');
        const labels = wrap.querySelectorAll('.mab-traffic');
        document.getElementById('mab-foot').innerHTML = '';
        const note = document.querySelector('#mab-readout .ab-demo-note');
        if (note) note.textContent = opts.note || 'Representative · Optimizely MAB is GA';
        document.getElementById('mab-readout').classList.add('show');
        const seq = [[33, 34, 33], [22, 54, 24], [15, 65, 20], [11, 73, 16]];
        let r = 0;
        const apply = () => {
            const t = seq[r];
            bars.forEach((b, i) => { b.style.width = t[i] + '%'; });
            labels.forEach((l, i) => { l.textContent = t[i] + '%'; });
            document.getElementById('mab-round').innerHTML = `<b>Round ${r + 1} of ${seq.length}</b> · traffic auto-allocating to the winner`;
        };
        apply();
        if (this._mabTimer) clearInterval(this._mabTimer);
        this._mabTimer = setInterval(() => {
            r++;
            if (r >= seq.length) {
                clearInterval(this._mabTimer); this._mabTimer = null;
                document.getElementById('mab-foot').innerHTML = `<b>${this.escapeHtml(winName)}</b> auto-promoted to <b>73%</b> of traffic on live performance — lift captured while still learning.`;
                return;
            }
            apply();
        }, 950);
    }
    hideMab() {
        if (this._mabTimer) { clearInterval(this._mabTimer); this._mabTimer = null; }
        const el = document.getElementById('mab-readout'); if (el) el.classList.remove('show');
    }

    /* ════════════════════════════════════════════════════════════════════════
     * STEP 13 — CMAB: a different winner per context (representative)
     * ════════════════════════════════════════════════════════════════════════ */
    showCmab() {
        const ctx = [
            { name: 'Mobile · Tabby-lover', win: 'Variation B — Complete-the-Look', lift: '+22% add-to-cart vs control' },
            { name: 'Desktop · Gift shopper', win: 'Variation C — Gift edit', lift: '+17% conversion vs control' },
            { name: 'Returning · High-AOV / luxe', win: 'Variation A — Premium edit', lift: '+14% revenue / visitor vs control' },
        ];
        const wrap = document.getElementById('cmab-ctx');
        wrap.innerHTML = '';
        document.getElementById('cmab-readout').classList.add('show');
        ctx.forEach((c, i) => {
            setTimeout(() => {
                if (!document.getElementById('cmab-readout').classList.contains('show')) return;
                const row = document.createElement('div');
                row.className = 'cmab-ctx';
                row.innerHTML = `<div class="cmab-ctx-name">${c.name}</div>
                    <div class="cmab-ctx-win"><span class="cmab-win-name">${c.win}</span><span class="cmab-win-tag">Winner</span></div>
                    <div class="cmab-lift">${c.lift}</div>`;
                wrap.appendChild(row);
            }, 220 + i * 460);
        });
    }
    hideCmab() {
        const el = document.getElementById('cmab-readout'); if (el) el.classList.remove('show');
        const wrap = document.getElementById('cmab-ctx'); if (wrap) wrap.innerHTML = '';
    }

    /* ════════════════════════════════════════════════════════════════════════
     * SIGNAL-LED MOMENT — encore arc (doc 12 §6 D/E). Three micro-beats shaped
     * EXACTLY like this.steps[] (incl. the `callout` object), surfaced behind a
     * button AFTER beat 15. The core demo stays EXACTLY 15 beats: the arc has its
     * own index + chrome and NEVER touches featureList / the "Step X of 15" count.
     * ════════════════════════════════════════════════════════════════════════ */
    showEncore() { const b = document.getElementById('dir-encore'); if (b) b.style.display = ''; }
    hideEncore() { const b = document.getElementById('dir-encore'); if (b) b.style.display = 'none'; }

    /* The 3 scenes (S1 DETECT · S2 GENERATE · S3 SERVE+OPTIMIZE+MEASURE). */
    buildSignalArc() {
        return [
            {
                label: 'Detect · TikTok signal',
                watch: 'a live signal + the ~28-min window open',
                caption: 'A bag is blowing up on TikTok right now — a real-time cultural signal, with a window that closes in ~28 minutes.',
                run: async () => { await this.runMomentDetect(); },
                callout: { anchor: '#signal-feed', usecase: 'Detect · real-time signal',
                    title: 'A cultural moment, detected live',
                    signal: 'Coach <strong>Tabby</strong> spiking on TikTok — <strong>#CoachTabby +480% views/hr</strong>, NY metro · a ~28-min window.',
                    decision: 'Open the loop: detect → generate → serve → optimize before the moment cools.',
                    impact: 'DY reacts to the neighbourhood (a stored postal-code average). We react to what\'s happening <strong>right now</strong>. <em>Detect is a simulated partner social-listening layer — not Optimizely.</em>' },
            },
            {
                label: 'Generate · Opal copy + AI hero',
                watch: 'Opal write the copy + generate the hero from the real Tabby',
                caption: 'Opal writes on-brand copy and generates a hero from the real Tabby — delivered as feature variables, no bespoke HTML. Real generation (~8s), shown honestly.',
                run: async () => { await this.runMomentGenerate(); },
                callout: { anchor: '#signal-feed', usecase: 'Generate · model copy + AI scene',
                    title: 'Opal builds the moment, live',
                    signal: 'The signal (SKU, anchor line, window) flows to Opal.',
                    decision: 'Model-written copy + an AI-generated scene of the <strong>real product</strong>, delivered as <strong>feature variables over our module</strong> — no bespoke HTML.',
                    impact: 'Real generation (~8s, shown honestly). Draft → a human clicks <strong>Launch</strong> (governance). Autonomy is roadmap.' },
            },
            {
                label: 'Serve · Optimize · Measure',
                watch: 'the full-bleed takeover + the bandit find the winner',
                caption: 'The storefront takes over with the real Tabby in the generated scene; a real multi-armed bandit shifts traffic to the winner — before the window closes.',
                run: async () => { await this.runMomentServe(); },
                callout: { anchor: '#xsurf', usecase: 'Serve · optimize · measure',
                    title: 'Served, optimized — before the window shut',
                    signal: 'The variation is live (a real flag + a real multi_armed_bandit rule).',
                    decision: 'Serve the takeover; let the <strong>bandit</strong> shift traffic to the winner — automatically.',
                    impact: 'Loop closed inside the window. Lift figures are representative (narrated, not claimed in UI). <strong>Representative · MAB is GA · real rule creatable.</strong>',
                    compare: { zone: '#hero' } },
            },
        ];
    }

    /* Enter encore mode (after beat 15). Reuses the director chrome + the Next button via nextArcStep(). */
    startSignalArc() {
        if (this.busy) return;
        this.encoreActive = true; this.arcIndex = -1;
        this._momentRevealed = false; this._momentImageUrl = null; this._signal = null;
        if (!this.signalArc) this.signalArc = this.buildSignalArc();
        this.demoActive = true;
        const sb = document.getElementById('sidebar'); if (sb) sb.dataset.state = 'running';
        this.toggleSidebar(true);
        this.hideEncore();
        this.nextArcStep();   // run Scene 1
    }
    async nextArcStep() {
        if (this.busy) return;
        if (!this.signalArc) this.signalArc = this.buildSignalArc();
        if (this.arcIndex >= this.signalArc.length - 1) return;
        await this.runArcStep(this.arcIndex + 1);
    }
    /* Run one arc scene — mirrors gotoStep() with ENCORE labels, but does NOT call tickFeature / pushChange,
     * so featureList and the "Step X of 15" count are untouched (the core demo stays exactly 15). */
    async runArcStep(idx) {
        const scene = this.signalArc && this.signalArc[idx]; if (!scene) return;
        this.busy = true; this.arcIndex = idx;
        const st = document.getElementById('sb-step'); if (st) st.classList.remove('preview');
        this.hideCallout(); this.clearSpotlight();
        document.getElementById('dir-step-label').textContent = `Signal-Led Moment · Scene ${idx + 1} of ${this.signalArc.length} · ${scene.label}`;
        document.getElementById('dir-bar-fill').style.width = `${((idx + 1) / this.signalArc.length) * 100}%`;
        document.getElementById('dir-watch').innerHTML = `Watch: <b>${scene.watch}</b>`;
        document.getElementById('dir-caption').textContent = scene.caption;
        document.getElementById('dir-back').disabled = true;   // the arc is forward-only
        const nextBtn = document.getElementById('dir-next');
        nextBtn.innerHTML = 'Next &#9658;'; nextBtn.disabled = true;
        try { await scene.run(); await this.applyStepCallout(scene); } catch (e) { console.error('arc step error', e); }
        this.busy = false;
        nextBtn.disabled = idx >= this.signalArc.length - 1;   // end of arc → Next stays disabled (Restart to replay)
    }

    /* Tear down the encore (button + feed + countdown + timers + takeover state). Idempotent; safe pre-DOM. */
    resetMomentEncore() {
        this.encoreActive = false; this.arcIndex = -1;
        this._momentPending = false; this._momentRevealed = false; this._momentLaunched = false;
        this._signal = null; this._momentImageUrl = null;
        this.stopWindowCountdown();
        if (this._genTimer) { clearInterval(this._genTimer); this._genTimer = null; }
        const feed = document.getElementById('signal-feed'); if (feed) { feed.hidden = true; feed.classList.remove('show'); }
        const gen = document.getElementById('sig-gen'); if (gen) gen.hidden = true;
        const loop = document.getElementById('sig-loop'); if (loop) { loop.hidden = true; loop.innerHTML = ''; }
        const vh = document.getElementById('view-home'); if (vh) vh.classList.remove('moment-active');
        this.hideEncore();
    }

    /* ── Scene 1 — DETECT: the (mocked, honestly-labeled) signal + the toast + the live window countdown. ── */
    async runMomentDetect() {
        this.go('home', { silent: true });
        const feed = document.getElementById('signal-feed'); if (feed) feed.hidden = false;
        const gen = document.getElementById('sig-gen'); if (gen) gen.hidden = true;
        const loop = document.getElementById('sig-loop'); if (loop) { loop.hidden = true; loop.innerHTML = ''; }
        const signal = await this.fetchSignal();
        this._signal = signal;
        const head = document.getElementById('sig-head'); if (head) head.textContent = `SIGNAL — ${signal.headline || 'Coach Tabby spiking on TikTok'}`;
        const meta = document.getElementById('sig-meta');
        if (meta) {
            const region = signal.region || 'NY metro';
            meta.textContent = `${signal.hashtag || '#CoachTabby'} +${signal.velocityPct || 480}% ${signal.unit || 'views/hr'} · ${region}${signal.regionLive ? ' · live geo' : ''}`;
        }
        const chip = document.getElementById('sig-chip'); if (chip) chip.textContent = 'SIMULATED · partner social-listening layer, not Optimizely · velocity illustrative';
        if (feed) { void feed.offsetWidth; feed.classList.add('show'); }
        this.startWindowCountdown(signal.windowMinutes || 28);   // the live window countdown is the dramatic spine
        this.logEvent('signal', 'detect', `${signal.hashtag || '#CoachTabby'} +${signal.velocityPct || 480}% ${signal.unit || 'views/hr'}`, null, null);
        await this.sleep(700);
    }
    /* The REAL DETECT call (GET /signals/next — mocked partner layer, real /geo region overlaid). */
    fetchSignal() {
        return fetch('/signals/next').then((r) => r.json()).catch(() => ({
            headline: 'Coach Tabby spiking on TikTok', hashtag: '#CoachTabby', velocityPct: 480, unit: 'views/hr',
            windowMinutes: 28, region: 'US-NY', anchorLine: 'Tabby', skus: ['COA-CH857'],
            nlSeed: 'A Coach Tabby (COA-CH857) is going viral on TikTok in NY right now — #CoachTabby is up 480% views/hr and the window closes in about 28 minutes. Write a short, on-brand "as seen on TikTok" moment for the Tabby (eyebrow, headline, subcopy, offer, CTA) and launch the tiktok_tabby_moment experiment so the bandit can find the winner before the moment cools.',
        }));
    }

    /* ── Scene 2 — GENERATE: Opal writes copy (real chat) + we generate the hero (real /ai/scene), with HONEST
     *    progress the WHOLE time (Decision #5). Deterministic fallback launches the moment if Opal hasn't driven
     *    a launch within a few seconds. The takeover reveals ONLY when the image is actually ready. ── */
    async runMomentGenerate() {
        this.go('home', { silent: true });
        const vh = document.getElementById('view-home'); if (vh) vh.classList.add('moment-active');   // hide the default hero while the new one is born
        this._momentPending = true; this._momentLaunched = false; this._momentRevealed = false;
        const signal = this._signal || await this.fetchSignal();
        const gen = document.getElementById('sig-gen'); if (gen) gen.hidden = false;
        this._setGenHero(null);                         // shimmer placeholder
        this.setMomentStatus('Reading signal…');
        await this.sleep(900);
        // (2) Opal writes the copy — drive the REAL Opal chat (mirror runOpalStep); the presenter may also dictate.
        this.setMomentStatus('Opal is writing the moment copy…');
        this.setTab('opal');
        try { window.dispatchEvent(new CustomEvent('opal:ask', { detail: { text: signal.nlSeed } })); } catch (e) {}
        this.logEvent('post', 'opal:ask', 'signal-led moment', null, null);
        const winner = await this._xsurfCreative(this.MOMENT_KEY, 'as_seen_tiktok');
        this._setGenCopy(winner);                       // eyebrow/headline/offer appear (canned; Opal's words land in the variables)
        await this.sleep(900);
        // Deterministic fallback (stage safety): if Opal hasn't launched within a few seconds (chat slow /
        // unavailable), launch it ourselves — identical downstream. Self-guards on _momentLaunched, so it
        // no-ops if Opal already launched; NOT cleared, so a cached/instant image can't cancel it.
        setTimeout(() => {
            if (!this._momentLaunched) { this._momentLaunched = true; this.runExperimentScenario('tiktok_tabby_moment', 'as_seen_tiktok', { noNav: true }); }
        }, 5500);
        // (3) Generate the hero from the REAL Tabby — live elapsed counter + shimmer the WHOLE time (~8s expected).
        const t0 = Date.now();
        this._genTimer = setInterval(() => {
            const s = Math.round((Date.now() - t0) / 1000);
            this.setMomentStatus(`Generating the hero image from the real Tabby… (${s}s)`);
        }, 250);
        const sceneContext = 'spotlit on a glossy after-hours editorial set, bold trending energy, current and Gen-Z, refined Coach palette';
        let url = null;
        try { url = await this._liveScene({ productId: 'COA-CH857', sceneId: 'signal-tabby-tiktok', type: 'search', sceneContext, aspect: '16:9' }); } catch (e) { url = null; }
        if (this._genTimer) { clearInterval(this._genTimer); this._genTimer = null; }
        // Stable URL either way: even if polling timed out, the job finishes + caches; the takeover backdrop fills.
        this._momentImageUrl = url || (winner && winner.image) || '/ai/scene/COA-CH857/signal-tabby-tiktok';
        this._setGenHero(this._momentImageUrl);
        this.setMomentStatus('Hero ready — going live.');
        await this.sleep(700);
    }
    setMomentStatus(msg) { const el = document.getElementById('sig-gen-msg'); if (el) el.textContent = msg; }
    _setGenCopy(c) {
        c = c || {};
        const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t || ''; };
        set('sig-gen-eyebrow', c.eyebrow); set('sig-gen-headline', c.headline); set('sig-gen-offer', c.offer);
    }
    _setGenHero(url) {
        const box = document.getElementById('sig-gen-hero'); if (!box) return;
        if (url) { box.style.backgroundImage = `url("${url}")`; box.classList.add('ready'); }
        else { box.style.backgroundImage = ''; box.classList.remove('ready'); }
    }

    /* ── Scene 3 — SERVE + OPTIMIZE + MEASURE: reveal the takeover (image is ready), close the loop off the
     *    REAL elapsed, then animate the MAB readout with the moment arm labels. ── */
    async runMomentServe() {
        this.go('home', { silent: true });
        this._momentPending = false;
        const creative = await this.momentCreative();
        if (this._momentImageUrl) creative.image = this._momentImageUrl;
        // Reveal via the standard surface path (renderExperimentSurface delegates to renderMomentTakeover for the
        // moment). previewExperiment also forces/confirms the real decision in the background.
        await this.previewExperiment({ experimentKey: this.MOMENT_KEY, variationKey: 'as_seen_tiktok', creative, noNav: true, metricEventKey: 'add_to_cart' });
        this._momentRevealed = true;   // lock out any late Opal launch from re-rendering the takeover
        // Backstop: guarantee the REAL flag + multi_armed_bandit rule exist even if Opal never launched and the
        // fallback timer hadn't fired yet (guarded → no double-launch). The guard above keeps it from re-rendering.
        if (!this._momentLaunched) { this._momentLaunched = true; this.runExperimentScenario('tiktok_tabby_moment', 'as_seen_tiktok', { noNav: true }); }
        const gen = document.getElementById('sig-gen'); if (gen) gen.hidden = true;
        // Close the loop — REAL elapsed since DETECT (the image-ready event), never a blind timer (doc 12 §6 E3).
        this.closeMomentLoop();
        // OPTIMIZE: reuse showMab() with the moment arm labels; carry the verbatim §3 "Representative · MAB is GA" chip.
        this.setTab('engine');
        this.showMab(
            [{ name: 'Control · New arrivals' }, { name: 'As seen on TikTok', win: true }, { name: 'Complete the look' }],
            { note: 'Representative · MAB is GA · real rule creatable' },
        );
        await this.sleep(400);
        this.scrollEngineTo('mab-readout'); this.pulse('#mab-readout');
    }

    /* ── Window countdown (the dramatic spine) + "loop closed" stat driven off the REAL image-ready event ── */
    _fmtMMSS(s) { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60), ss = s % 60; return `${m}:${ss < 10 ? '0' : ''}${ss}`; }
    startWindowCountdown(minutes) {
        this.stopWindowCountdown();
        const total = Math.max(1, Math.round((minutes || 28) * 60));
        this._momentWindowTotal = total; this._momentT0 = Date.now();
        const clock = document.getElementById('sig-clock');
        const render = () => {
            const remain = total - Math.floor((Date.now() - this._momentT0) / 1000);
            if (clock) clock.textContent = this._fmtMMSS(remain);
            if (remain <= 0) this.stopWindowCountdown();
        };
        render();
        this._momentClockTimer = setInterval(render, 1000);
    }
    stopWindowCountdown() { if (this._momentClockTimer) { clearInterval(this._momentClockTimer); this._momentClockTimer = null; } }
    /* Loop-closed stat — REAL elapsed since DETECT, framed against the window. Window keeps ticking behind it. */
    closeMomentLoop() {
        const total = this._momentWindowTotal || 28 * 60;
        const elapsed = Math.floor((Date.now() - (this._momentT0 || Date.now())) / 1000);
        const loop = document.getElementById('sig-loop');
        if (!loop) return;
        loop.hidden = false;
        loop.innerHTML =
            `<div class="sig-loop-main"><span class="sig-loop-dot"></span><b>Loop closed in ${this._fmtMMSS(elapsed)} of ${this._fmtMMSS(total)}</b> — winner promoted automatically.</div>` +
            `<div class="sig-loop-note">Today the loop closes with a human Launch click (governance). Autonomy is roadmap. · Representative figures · Optimizely MAB is GA. Real <code>multi_armed_bandit</code> rule is creatable.</div>`;
    }

    /* ════════════════════════════════════════════════════════════════════════
     * STEP 14 — AI SEARCH (real affinity ranking over the loaded catalog)
     * ════════════════════════════════════════════════════════════════════════ */
    openSearch() {
        document.getElementById('search-overlay').classList.add('open');
        document.getElementById('search').classList.add('open');
        this.runSearch(document.getElementById('search-input').value || '');
    }
    closeSearch() {
        const o = document.getElementById('search-overlay'); if (o) o.classList.remove('open');
        const s = document.getElementById('search'); if (s) s.classList.remove('open');
    }
    searchChip(q) { document.getElementById('search-input').value = q; this.runSearch(q, { live: true }); }
    async runSearch(q, opts) {
        const grid = document.getElementById('search-results');
        const meta = document.getElementById('search-meta');
        const edit = document.getElementById('search-edit');
        const query = (q || '').trim();
        if (!query) { grid.innerHTML = ''; if (edit) edit.innerHTML = ''; meta.textContent = 'Type a request to see AI-ranked, personalized results.'; return; }
        meta.innerHTML = `<span class="live-dot"></span>Reading your request…`;
        // Rotate the status so the wait reads as active, not dead.
        const mmsgs = ['Reading your request…', 'Ranking to your taste…', 'Styling your edit…'];
        let mi = 0;
        const mrot = setInterval(() => { mi = (mi + 1) % mmsgs.length; if (meta) meta.innerHTML = `<span class="live-dot"></span>${mmsgs[mi]}`; }, 1500);
        let results = null, intent = null, hero = null, src = 'fallback';
        try {
            const res = await fetch('/ai/search', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, limit: 9, affinity: { dominantLine: this.dominantLine, segments: this.segments, recommendationIds: (this.recommendations || []).map((p) => p.id) } }),
            });
            const json = await res.json();
            if (json && json.ok && Array.isArray(json.productIds)) {
                results = json.productIds.map((id) => this.byId.get(id)).filter(Boolean);
                intent = json.intent || null; hero = json.hero || null; src = 'gemini';
            }
        } catch (e) { /* fall back to the client heuristic */ }
        clearInterval(mrot);
        if (!results || !results.length) { results = this.searchCatalog(query, 9); src = 'fallback'; }
        // The Edit — a Gemini-styled editorial scene of the REAL hero bag (instant if pre-genned;
        // live-generated for novel queries when committed; else gracefully no hero, just the grid).
        this._renderSearchEdit(query, intent, hero, results, src, !!(opts && opts.live));
        this.paintGrid(grid, results, { recommended: this.personalized });
        const n = results.length;
        const affNote = this.dominantLine ? ` & your ${this.dominantLine} affinity` : ' & your live affinity';
        const summary = intent && intent.summary;
        const understood = src === 'gemini' && summary ? `understood “${summary}” · ` : '';
        meta.innerHTML = `<span class="live-dot"></span>${n} result${n === 1 ? '' : 's'} · ${understood}ranked by occasion, style${affNote}`;
    }
    /* ── Styled-scene matching + rendering (shared by Search "Edit" + Concierge "look") ── */
    _normQ(s) { return (s || '').toLowerCase().trim().replace(/[?!.…]+$/g, '').trim(); }
    _slug(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }
    sceneFor(query, intent, type, heroId) {
        const m = this.sceneManifest || {};
        const nq = this._normQ(query);
        for (const k in m) { if (m[k] && m[k].type === type && this._normQ(m[k].query) === nq) return m[k]; }  // (1) exact chip
        const occ = this._deriveOccasion(query, intent, type);
        if (occ) {
            const list = (this.gridByOcc && this.gridByOcc[type] && this.gridByOcc[type][occ]) || null;
            if (list && list.length) return (heroId && list.find((e) => e.productId === heroId)) || list[0];  // (2) grid: product-accurate, instant
            const ak = this._anchorKey(occ, type);
            if (ak && m[ak] && m[ak].type === type) return m[ak];                                              // (3) original curated anchor
        }
        return null;                                                                                          // (4) → live, then ranked grid
    }
    /* Maps a canonical occasion → the original (non-uniform) curated manifest key. */
    _anchorKey(occ, type) {
        const S = { 'winter-wedding': 'search-winter-wedding', gift: 'search-gift-150', work: 'search-work-tote', travel: 'search-travel-crossbody', investment: 'search-investment', 'date-night': 'search-date-night', festival: 'search-festival', everyday: 'search-everyday' };
        const L = { 'winter-wedding': 'look-winter-wedding', gift: 'look-gift-200', work: 'look-work', travel: 'look-travel', capsule: 'look-capsule-tabby', brooklyn: 'look-brooklyn' };
        return (type === 'concierge' ? L : S)[occ] || null;
    }
    /* Canonical occasion for a query (keyword-first → deterministic for curated queries; Gemini
       occasion tags as a fallback). Returns one occasion name shared by the grid + the anchor map,
       or null → the query is genuinely off-script and should generate a LIVE vibe-matched scene. */
    _deriveOccasion(query, intent, type) {
        const q = (query || '').toLowerCase();
        const occ = new Set((intent && intent.occasions) || []);
        const gift = (intent && intent.giftMode) || /\b(gift|present|for (her|him|mom|dad|a friend))\b/.test(q);
        const band = intent && intent.priceBand;
        const cc = type === 'concierge';
        const has = (re) => re.test(q);
        // (1) literal keywords — deterministic, highest priority
        if (has(/winter wedding/)) return 'winter-wedding';
        if (gift) return 'gift';
        if (cc && has(/\bcapsule\b/)) return 'capsule';
        if (cc && has(/\bbrooklyn\b/)) return 'brooklyn';
        if (has(/\bcocktail\b/)) return 'cocktail';
        if (has(/\b(gala|black.?tie)\b/)) return 'gala';
        if (has(/\b(opera|theat(er|re)|symphony|ballet|philharmonic)\b/)) return 'opera';
        if (has(/\b(gallery|exhibition|art (opening|show|fair)|museum|vernissage)\b/)) return 'gallery';
        if (has(/\b(beach|resort|poolside|tropical|honeymoon|yacht|seaside|cruise)\b/)) return 'beach-resort';
        if (has(/\bbrunch\b/)) return 'brunch';
        if (has(/\b(work|office|commute|desk|laptop|9 ?to ?5)\b/)) return 'work';
        if (has(/\b(travel|trip|vacation|carry.?on|getaway|weekend away)\b/)) return 'travel';
        if (has(/\b(investment|splurge|heirloom|timeless|quiet luxury|high[- ]end)\b/)) return 'investment';
        if (has(/\b(festival|concert)\b/)) return 'festival';
        if (has(/\b(date night|date-night|night out)\b/)) return 'date-night';
        if (has(/\b(everyday|daily|casual)\b/)) return 'everyday';
        // (2) Gemini occasion-tag fallback — only for occasions we have a verified scene for
        if (occ.has('winter') && (occ.has('special-occasion') || occ.has('evening'))) return 'winter-wedding';
        if (occ.has('work')) return 'work';
        if (occ.has('travel')) return 'travel';
        if (occ.has('festival')) return 'festival';
        if (occ.has('date-night')) return 'date-night';
        if (band === 'elevated') return 'investment';
        if (occ.has('everyday')) return 'everyday';
        if (cc && (occ.has('special-occasion') || occ.has('evening'))) return 'winter-wedding';
        return null; // → LIVE, vibe-matched generation (never a mismatched stock scene)
    }
    /* Stable scene id for the LIVE path (so a repeat of the same off-script query hits the R2 cache). */
    _deriveSceneKey(query, intent, type) {
        const occ = this._deriveOccasion(query, intent, type);
        return occ ? `${type === 'concierge' ? 'look' : 'search'}-${occ}` : null;
    }
    _editHeroHtml(asset, headline, subhead, productName, loading) {
        const cap = productName ? `Styled with AI · the ${this.escapeHtml(productName)} shown is the real product` : 'Styled with AI · real product';
        const img = asset ? `<img class="eh-img" src="${asset}" alt="" onload="this.classList.add('in')" onerror="this.closest('.edit-hero-wrap').innerHTML=''">` : '';
        const kicker = loading ? `<span class="eh-spin"></span>Styling your edit…` : `<span class="live-dot"></span>The Edit`;
        return `<div class="edit-hero${loading ? ' loading' : ''}">${img}<div class="eh-scrim"></div>
            <div class="eh-copy"><div class="eh-kicker">${kicker}</div>
            <div class="eh-headline">${this.escapeHtml(headline || '')}</div>
            ${subhead ? `<div class="eh-subhead">${this.escapeHtml(subhead)}</div>` : ''}</div>
            ${asset ? `<div class="eh-caption">${cap}</div>` : ''}</div>`;
    }
    _fallbackHeadline(query, intent) {
        const s = (intent && intent.summary) || query || '';
        return s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Your Edit';
    }
    _renderSearchEdit(query, intent, hero, results, src, allowLive) {
        const wrap = document.getElementById('search-edit');
        if (!wrap) return;
        const headline = (intent && intent.headline) || this._fallbackHeadline(query, intent);
        const subhead = (intent && intent.subhead) || '';
        const heroId = (hero && hero.productId) || (results && results[0] && results[0].id) || null;
        const scene = this.sceneFor(query, intent, 'search', heroId);
        if (scene && scene.asset) {                              // 1) pre-genned → instant
            wrap.innerHTML = this._editHeroHtml(scene.asset, headline, subhead, scene.productName);
            return;
        }
        const anchor = (hero && hero.productId && this.byId.get(hero.productId)) || results[0];
        const ctx = intent && intent.sceneContext;
        if (allowLive && anchor && ctx && src === 'gemini') {     // 2) live-generate for a novel query
            wrap.innerHTML = this._editHeroHtml('', headline, subhead, anchor.name, true);
            const sceneId = this._deriveSceneKey(query, intent, 'search') || ('q-' + this._slug(query));
            this._liveScene({ productId: anchor.id, sceneId, type: 'search', sceneContext: ctx, aspect: '16:9' })
                .then((url) => {
                    if (!url) { wrap.innerHTML = ''; return; }
                    const cur = document.getElementById('search-input');
                    if (cur && this._normQ(cur.value) !== this._normQ(query)) { wrap.innerHTML = ''; return; }  // stale
                    // Fade the finished image INTO the existing loading block — do NOT replace the block.
                    // A full innerHTML swap tears the loading card down and builds a fresh <img> from
                    // opacity:0, which reads as appear → hide → appear. In-place keeps one continuous fade.
                    const heroEl = wrap.querySelector('.edit-hero');
                    if (!heroEl) { wrap.innerHTML = this._editHeroHtml(url, headline, subhead, anchor.name); return; }
                    const im = new Image();
                    im.className = 'eh-img'; im.alt = '';
                    im.onload = () => { heroEl.classList.remove('loading'); im.classList.add('in'); };
                    im.onerror = () => { wrap.innerHTML = ''; };
                    im.src = url;
                    heroEl.insertBefore(im, heroEl.firstChild);
                    const kick = heroEl.querySelector('.eh-kicker');
                    if (kick) kick.innerHTML = '<span class="live-dot"></span>The Edit';
                    if (!heroEl.querySelector('.eh-caption')) {
                        const capEl = document.createElement('div');
                        capEl.className = 'eh-caption';
                        capEl.textContent = anchor.name ? `Styled with AI · the ${anchor.name} shown is the real product` : 'Styled with AI · real product';
                        heroEl.appendChild(capEl);
                    }
                })
                .catch(() => { wrap.innerHTML = ''; });
            return;
        }
        wrap.innerHTML = '';                                      // 3) graceful — grid only
    }
    /** POST /ai/scene (async queue), then poll the GET url until the background job caches it.
        Never blocks the page — resolves to a served scene URL, or null so the ranked grid simply stays. */
    async _liveScene(payload) {
        try {
            const res = await fetch('/ai/scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const j = await res.json();
            if (!j || !j.ok || !j.url) return null;
            if (j.status === 'ready' || j.cached) return j.url;             // already cached → instant
            const deadline = Date.now() + 22000;                            // queued → poll while the shimmer shows
            while (Date.now() < deadline) {
                await this.sleep(1300);
                try {
                    const r = await fetch(j.url, { method: 'GET', cache: 'no-store' });
                    if (r.ok && (r.headers.get('content-type') || '').startsWith('image/')) return j.url;
                } catch { /* keep polling */ }
            }
            return null;        // not ready in the window → grid stays; the job still finishes + caches for next time
        } catch { return null; }
    }
    /** Style Concierge "look" — a 4:5 styled scene of the anchor pick, in the chat thread. */
    _renderConciergeLook(anchorId, query) {
        const thread = document.getElementById('cc-thread');
        if (!thread) return;
        const mk = (asset, productName, loading) => {
            const el = document.createElement('div');
            el.className = 'cc-look' + (loading ? ' loading' : '');
            const cap = productName ? `Styled with AI · the ${this.escapeHtml(productName)} is the real product` : '';
            const body = asset
                ? `<img class="ccl-img" src="${asset}" alt="" onload="this.classList.add('in')" onerror="this.closest('.cc-look').remove()">`
                : (loading ? `<div class="ccl-load"><span class="ccl-spin"></span><span class="ccl-load-txt">Styling your look…</span></div>` : '');
            el.innerHTML = body + (cap ? `<div class="ccl-cap">${cap}</div>` : '');
            thread.appendChild(el); thread.scrollTop = thread.scrollHeight;
            return el;
        };
        const scene = this.sceneFor(query, null, 'concierge', anchorId);
        if (scene && scene.asset) { mk(scene.asset, scene.productName); return; }      // pre-genned → instant
        const anchor = anchorId && this.byId.get(anchorId);
        const visual = /wedding|gala|formal|cocktail|party|date|night|evening|work|office|commute|travel|trip|vacation|festival|gift|present|winter|holiday|brunch|dinner|interview|weekend|capsule|outfit|look|wear|carry|occasion/i.test(query || '');
        if (!anchor || !visual) return;                                                // generic ask → cards only
        const el = mk('', anchor.name, true);                                          // live → shimmer then swap
        const sceneId = this._deriveSceneKey(query, null, 'concierge') || ('cc-' + this._slug(query));
        const ctx = `an aspirational, editorial styled look inspired by: "${(query || '').slice(0, 120)}"`;
        this._liveScene({ productId: anchor.id, sceneId, type: 'concierge', sceneContext: ctx, aspect: '4:5' })
            .then((url) => {
                if (!url) { el.remove(); return; }
                // Keep the shimmer until the image is actually ready, then reveal in one step. Removing
                // the loader before the <img> has loaded leaves a blank gap (the same flash search had).
                const load = el.querySelector('.ccl-load');
                const img = document.createElement('img');
                img.className = 'ccl-img'; img.alt = '';
                img.onload = () => { el.classList.remove('loading'); if (load) load.remove(); img.classList.add('in'); };
                img.onerror = () => el.remove();
                img.src = url;
                el.insertBefore(img, el.firstChild);
            })
            .catch(() => el.remove());
    }
    /* CatalogService-style affinity ranking, client-side over the real catalog. */
    searchCatalog(query, limit = 9) {
        const q = (query || '').toLowerCase();
        const tokens = q.split(/[^a-z0-9$]+/).filter(Boolean);
        const OCC = {
            wedding: ['special-occasion', 'evening', 'date-night'], gala: ['special-occasion', 'evening'],
            formal: ['special-occasion', 'evening'], cocktail: ['evening', 'date-night'],
            party: ['evening', 'date-night', 'festival'], evening: ['evening', 'date-night'],
            date: ['date-night'], night: ['evening', 'date-night'],
            work: ['work'], office: ['work'], professional: ['work'], commute: ['work', 'everyday'],
            travel: ['travel'], trip: ['travel'], vacation: ['travel'],
            everyday: ['everyday'], casual: ['everyday'], daily: ['everyday'],
            festival: ['festival'], concert: ['festival'],
            winter: ['winter'], holiday: ['evening', 'special-occasion', 'winter'],
            gift: ['gift'], present: ['gift'],
        };
        const wantOcc = new Set();
        tokens.forEach((t) => { if (OCC[t]) OCC[t].forEach((o) => wantOcc.add(o)); });
        const wantCat = new Set();
        if (/\bbags?\b|handbag|purse|tote|crossbody|shoulder|hobo|satchel/.test(q)) wantCat.add('Handbags');
        if (/wallet|card ?case|slg|small leather/.test(q)) wantCat.add('Small Leather Goods');
        if (/charm|strap|keychain|accessor/.test(q)) wantCat.add('Accessories');
        const wantSil = new Set();
        ['tote', 'crossbody', 'shoulder', 'hobo', 'satchel'].forEach((s) => { if (q.includes(s)) wantSil.add(s); });
        const wantLines = new Set();
        this.byLine.forEach((_v, line) => { if (line && q.includes(line.toLowerCase())) wantLines.add(line); });
        const COLORS = ['black', 'chalk', 'white', 'ivory', 'cream', 'red', 'berry', 'pink', 'blue', 'denim', 'saddle', 'tan', 'brown', 'khaki', 'green', 'moss', 'graphite'];
        const wantColors = new Set(tokens.filter((t) => COLORS.includes(t)));
        let priceCap = null, priceFloor = null;
        const m = q.match(/under \$?(\d+)/) || q.match(/\$?(\d+)\s*(?:or less|and under)/);
        if (m) priceCap = +m[1];
        if (/luxur|premium|elevated|investment|splurge|high[- ]end/.test(q)) priceFloor = 400;
        if (priceCap == null && /affordable|cheap|budget/.test(q)) priceCap = 250;

        const scoreOf = (p) => {
            let s = 0;
            if (wantOcc.size) { let inter = 0; (p.occasion || []).forEach((o) => { if (wantOcc.has(o)) inter++; }); s += 0.34 * (inter / wantOcc.size); }
            if (wantCat.size && wantCat.has(p.category)) s += 0.22;
            if (wantSil.size && wantSil.has(p.silhouette)) s += 0.12;
            if (wantLines.size && wantLines.has(p.line)) s += 0.18;
            if (wantColors.size) { const pc = (p.colors || []).join(' ').toLowerCase(); let cm = 0; wantColors.forEach((c) => { if (pc.includes(c)) cm++; }); if (cm) s += 0.08; }
            if (priceCap != null) { s += p.price_usd <= priceCap ? 0.14 : -0.25; }
            if (priceFloor != null && p.price_usd >= priceFloor) s += 0.12;
            tokens.forEach((t) => { if (t.length > 2 && (p.name.toLowerCase().includes(t) || (p.subcategory || '').toLowerCase().includes(t) || (p.material || '').toLowerCase().includes(t))) s += 0.05; });
            // PERSONALIZATION — her live in-session affinity reranks the results
            if (this.dominantLine && p.line === this.dominantLine) s += 0.16;
            if (this.recommendations && this.recommendations.some((r) => r.id === p.id)) s += 0.06;
            const idx = this.products.indexOf(p);
            if (idx >= 0) s += 0.04 * ((this.products.length - idx) / this.products.length);
            return s;
        };
        return this.products
            .map((p) => ({ p, s: scoreOf(p) }))
            .filter((x) => x.s > 0.05)
            .sort((a, b) => b.s - a.s)
            .slice(0, limit)
            .map((x) => x.p);
    }
    async typeIntoInput(id, text) {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = '';
        for (let i = 0; i < text.length; i++) { el.value = text.slice(0, i + 1); await this.sleep(20 + Math.random() * 22); }
    }

    /* ════════════════════════════════════════════════════════════════════════
     * STEP 15 — STYLE CONCIERGE (AI chat; scripted over the real catalog)
     * ════════════════════════════════════════════════════════════════════════ */
    openConcierge() {
        document.getElementById('cc-overlay').classList.add('open');
        document.getElementById('concierge').classList.add('open');
        const thread = document.getElementById('cc-thread');
        if (!thread.dataset.init) {
            thread.innerHTML = '';
            this.appendCcMsg('bot', `Hi — I'm your Coach <b>Style Concierge</b>. Tell me the occasion or who you're shopping for, and I'll pull a few pieces from the collection.`);
            thread.dataset.init = '1';
        }
    }
    closeConcierge() {
        const o = document.getElementById('cc-overlay'); if (o) o.classList.remove('open');
        const c = document.getElementById('concierge'); if (c) c.classList.remove('open');
    }
    conciergeChip(q) { document.getElementById('cc-input').value = q; this.sendConcierge(); }
    sendConcierge() { this.conciergeAsk(document.getElementById('cc-input').value); }
    async conciergeAsk(prompt) {
        if (!prompt || !prompt.trim()) return;
        this.appendCcMsg('user', this.escapeHtml(prompt));
        document.getElementById('cc-input').value = '';
        this.ccMessages = (this.ccMessages || []).concat([{ role: 'user', content: prompt }]);
        const thinking = this.appendCcThinking();
        const killThinking = () => { if (thinking) { if (thinking._rotate) { clearInterval(thinking._rotate); thinking._rotate = null; } if (thinking.parentNode) thinking.remove(); } };
        let full = '', bot = null;
        try {
            const res = await fetch('/ai/concierge', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: this.ccMessages, affinity: { dominantLine: this.dominantLine, currentProductId: this.currentPdpId || null } }),
            });
            if (res.ok && res.body) {
                const reader = res.body.getReader(), dec = new TextDecoder();
                for (;;) {
                    const { value, done } = await reader.read(); if (done) break;
                    full += dec.decode(value, { stream: true });
                    // Keep the (rotating) thinking indicator up until the FIRST token — then swap it for the streaming reply.
                    if (!bot && full.trim()) { killThinking(); bot = this.appendCcMsg('bot', ''); }
                    if (bot) { bot.innerHTML = this.escapeHtml(full.replace(/\n?PICKS:.*$/is, '').trim()); const th = document.getElementById('cc-thread'); if (th) th.scrollTop = th.scrollHeight; }
                }
            }
        } catch (e) { /* fall through to the scripted fallback */ }
        killThinking();
        if (!full.trim()) {                                  // no key / timeout / empty → graceful fallback
            if (bot && bot.parentNode) bot.remove();
            const reply = this.conciergeReply(prompt);
            this.appendCcMsg('bot', reply.text);
            this._renderConciergeLook(reply.ids[0], prompt);
            this._renderCcCards(reply.ids);
            this.logEvent('chat', 'concierge', prompt.slice(0, 42));
            return;
        }
        bot.innerHTML = this.escapeHtml(full.replace(/\n?PICKS:.*$/is, '').trim());
        const m = full.match(/PICKS:\s*([A-Za-z0-9\-,\s]+)/i);
        let ids = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
        ids = ids.filter((id) => this.byId.has(id));         // resolve → drop any hallucinated SKU
        if (ids.length < 2) { const recs = (this.recommendations || []).map((p) => p.id); ids = (recs.length ? recs : this.products.slice(0, 3).map((p) => p.id)).slice(0, 3); }
        this.ccMessages.push({ role: 'assistant', content: full });
        this._renderConciergeLook(ids[0], prompt);
        this._renderCcCards(ids);
        this.logEvent('chat', 'concierge', prompt.slice(0, 42));
    }
    _renderCcCards(ids) {
        const cards = (ids || []).map((id) => this.byId.get(id)).filter(Boolean);
        if (!cards.length) return;
        const thread = document.getElementById('cc-thread');
        const row = document.createElement('div');
        row.className = 'cc-recs';
        row.innerHTML = cards.map((p) =>
            `<div class="cc-rec" onclick="store.fromConcierge('${p.id}')"><div class="ccr-img">${this.img(p)}</div><div class="ccr-name">${p.name}</div><div class="ccr-price">${this.price(p)}</div></div>`
        ).join('');
        thread.appendChild(row);
        thread.scrollTop = thread.scrollHeight;
    }
    conciergeReply(prompt) {
        const q = (prompt || '').toLowerCase();
        const bySub = (re) => this.products.filter((p) => re.test((p.subcategory || '').toLowerCase()));
        const charm = bySub(/charm/)[0], cardcase = bySub(/card/)[0], wristlet = bySub(/wristlet/)[0], wallet = bySub(/wallet/)[0];
        const tote = this.products.find((p) => /tote|carryall/i.test(p.subcategory || ''));
        if (/wedding|evening|gala|formal|cocktail|party|date|night out/.test(q)) {
            const bag = this.byId.get('COA-CY201') || this.lineItems('Tabby').find((p) => this.isBag(p)) || this.bagsCatalog()[0];
            const ids = [bag && bag.id, charm && charm.id, cardcase && cardcase.id].filter(Boolean);
            return { text: `For an evening event I'd keep it polished but light: anchor with the <b>${bag ? bag.name : 'Tabby'}</b> — compact and easy to dress up — then add a <b>${charm ? charm.name : 'signature charm'}</b> for a little shine and a slim <b>${cardcase ? cardcase.name : 'card case'}</b> so you can skip the bulky wallet.`, ids };
        }
        if (/gift|present|for (her|him|mom|a friend)|under ?\$?\d/.test(q)) {
            const cap = (q.match(/\$?(\d{2,4})/) || [])[1];
            const max = cap ? +cap : 200;
            let picks = this.products.filter((p) => (p.category === 'Accessories' || p.category === 'Small Leather Goods') && p.price_usd <= max);
            picks = picks.sort((a, b) => b.price_usd - a.price_usd).slice(0, 3);
            const ids = picks.map((p) => p.id);
            return { text: `Gift-worthy and unmistakably Coach, all under $${max} — easy to wrap, hard to get wrong. A charm, a card case and a wristlet are always safe bets.`, ids: ids.length ? ids : [charm && charm.id, cardcase && cardcase.id, wristlet && wristlet.id].filter(Boolean) };
        }
        if (/work|office|commute|laptop|professional|everyday carry|tote/.test(q)) {
            const ids = [tote && tote.id, wallet && wallet.id, cardcase && cardcase.id].filter(Boolean);
            return { text: `For the workday, start with a structured <b>${tote ? tote.name : 'tote'}</b> that swallows the essentials, then keep things tidy with a <b>${wallet ? wallet.name : 'wallet'}</b> and a <b>${cardcase ? cardcase.name : 'card case'}</b> for transit and ID.`, ids };
        }
        const base = (this.recommendations || this.topCatalog(3)).slice(0, 3);
        return { text: `Here are three pieces our stylists are loving right now — versatile, on-brand, and easy to mix into what you already own.`, ids: base.map((p) => p.id) };
    }
    appendCcMsg(role, html) {
        const thread = document.getElementById('cc-thread');
        const div = document.createElement('div');
        div.className = 'cc-msg ' + role;
        div.innerHTML = html;
        thread.appendChild(div);
        thread.scrollTop = thread.scrollHeight;
        return div;
    }
    appendCcThinking() {
        const thread = document.getElementById('cc-thread');
        const div = document.createElement('div');
        div.className = 'cc-msg bot cc-thinking';
        div.innerHTML = `<span class="cc-think-msg">Reading your request</span><span class="opal-dots"><span></span><span></span><span></span></span>`;
        thread.appendChild(div);
        thread.scrollTop = thread.scrollHeight;
        // Rotate the status so the wait always feels active (the styled reply can take a few seconds).
        const msgs = ['Reading your request', 'Pulling the right pieces', 'Styling your look'];
        let i = 0; const lbl = div.querySelector('.cc-think-msg');
        div._rotate = setInterval(() => { i = (i + 1) % msgs.length; if (lbl) lbl.textContent = msgs[i]; }, 2200);
        return div;
    }
    fromConcierge(id) { this.closeConcierge(); this.openPdp(id); }
    escapeHtml(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    /* ════════════════════════════════════════════════════════════════════════
     * RESET — mint a fresh anon id for a clean cold start
     * ════════════════════════════════════════════════════════════════════════ */
    resetShopper() {
        this.mintIds();
        this.segments = []; this.decisions = {}; this.journeyStage = 'early';
        this.recommendations = null; this.sortOrder = null; this.personalized = false;
        this.eventCount = 0; this.productViews = 0; this.viewedLineCounts = {}; this.dominantLine = null;
        this.cart = []; this.wishlist = new Set(); this.currentLook = null;
        this.opalAudience = null; this.eventLog = [];
        // reset the new panels/modals so a fresh run starts clean
        this.hideTransientPanels();
        this.clearMarkers();                       // drop all persistent personalization markers
        this.clearChangePills(); this.dismissWelcome();   // and the Before→Now pills + first-visit ribbon
        this._buySignalFired = false; if (this.clearForcedExperiment) this.clearForcedExperiment();   // reset buy-signal + experiment surface
        this.resetMomentEncore();   // tear down the Signal-Led Moment encore on any fresh-shopper reset
        this._clearExperimentQuery();   // (A) drop any ?experiment= deep-link so a later reload lands clean
        const anonChip = document.getElementById('eng-anon-chip'); if (anonChip) anonChip.classList.remove('show');
        this.changeLog = []; this.changeIdx.clear(); this.renderChanges();   // and the session changelog
        const si = document.getElementById('search-input'); if (si) si.value = '';
        const sr = document.getElementById('search-results'); if (sr) sr.innerHTML = '';
        const sm = document.getElementById('search-meta'); if (sm) sm.textContent = 'Type a request to see AI-ranked, personalized results.';
        const ccThread = document.getElementById('cc-thread'); if (ccThread) { ccThread.innerHTML = ''; delete ccThread.dataset.init; }
        const ccInput = document.getElementById('cc-input'); if (ccInput) ccInput.value = '';
        document.getElementById('cart-count').textContent = '0';
        document.getElementById('wishlist-count').textContent = '0';
        document.getElementById('sort-caption').classList.remove('show');
        document.getElementById('plp-sort').value = 'featured';
        document.getElementById('ctl').classList.remove('revealed');
        document.getElementById('why-body').classList.remove('open');
        this.renderCart();
        this.renderHomeCold();
        this.renderPLP(this.topCatalog(16), { flip: false });
        this.openDefaultPdp();
        this.renderEventStream();
        this.updateEngine();
        if (this.ws) { try { this.ws.close(); } catch (e) {} }
        this.connectWebSocket();
        this.go('home', { silent: true });
    }
}

let store;
document.addEventListener('DOMContentLoaded', () => {
    store = new CoachStorefront();
    window.store = store;
    // Markers are in-flow children of the personalized zones, so they scroll with
    // the content automatically — no spotlight/callout repositioning needed.
});
