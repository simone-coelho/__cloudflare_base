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
        this.journeyStage = 'early';
        this.recommendations = null;   // Product[] from engine
        this.sortOrder = null;         // string[] product ids from engine
        this.personalized = false;

        // Opal (chat island) → governed "preview as this audience" trigger for the live banner.
        window.addEventListener('opal:experience', (e) => { try { this.previewAudience(e.detail || {}); } catch (err) { console.error('previewAudience', err); } });

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
        this.renderHomeCold();
        this.renderPLP(this.bagsCatalog().slice(0, 16), { flip: false });
        this.renderCategoryRail();
        this.openDefaultPdp();
        this.updateEngine();
        this.connectWebSocket();
        this.buildSteps();
        this.buildChecklist();
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
        el.dataset.title = content.title;
        if (!el.innerHTML.trim()) { fill(); return; }
        el.classList.add('fading');
        setTimeout(() => { fill(); el.classList.remove('fading'); }, 320);
    }

    /* ════════════════════════════════════════════════════════════════════════
     * CURATED GRID (home)
     * ════════════════════════════════════════════════════════════════════════ */
    renderHomeCold() {
        this.renderHero(this.heroFallback());
        this.renderCurated();
        this.renderStory(this.storyForStage('early'));
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
        this._ba = { before, after };
        this.ensureOverlays();
        this.positionToastStack();
        const key = `${before}|${after}`;
        if ([...this._pzToasts.children].some((c) => c.dataset.key === key)) return;  // de-dupe on beat re-run
        const toast = document.createElement('div');
        toast.className = 'change-pill'; toast.dataset.key = key;
        toast.innerHTML = `<span class="cp-k">Before</span><span class="cp-v">${before}</span>` +
                          `<span class="cp-arrow">&#8594;</span>` +
                          `<span class="cp-k now">Now</span><span class="cp-v">${after}</span>` +
                          `<button class="cp-x" title="Dismiss" aria-label="Dismiss">&times;</button>`;
        this._pzToasts.appendChild(toast);
        toast.querySelector('.cp-x').addEventListener('click', () => {
            toast.classList.add('out'); setTimeout(() => { if (toast.parentNode) toast.remove(); }, 450);
        });
        requestAnimationFrame(() => toast.classList.add('show'));
        // Fixed stack below the header — fully visible, no auto-dismiss; stays until × (or Restart).
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
    clearChangePills() { if (this._pzToasts) this._pzToasts.innerHTML = ''; document.querySelectorAll('.change-pill').forEach((p) => p.remove()); this._ba = null; }
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
                    impact: 'Personalization can start at <strong>hello</strong>, with zero sign-in friction.' },
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
                    impact: 'A confident, on-brand first impression — not a generic grid — while the engine starts learning.' },
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
                    impact: 'Relevant within seconds at the edge (&lt;50ms) — <strong>no reload, no waiting for a segment build</strong>.' },
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
                    impact: 'Recommendations answer <strong>"which products"</strong> — distinct from how the page adapts (next).' },
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
                    impact: 'Same products, <strong>her order</strong> → higher relevance & conversion. Before vs Now is marked on the grid.' },
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
                    impact: 'The <strong>layout itself</strong> adapts — not just the products — toward bigger baskets.' },
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
                    impact: 'Structure decides the <strong>"where"</strong>; content decides the <strong>"what."</strong>' },
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
                    impact: 'The right message for <strong>where she is in the funnel</strong> — not a generic promo.' },
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
                    impact: '<strong>Live in seconds — no developer, no release.</strong> The operator-side wedge vs DY.' },
            },
            /* 11 ── A/B testing (representative figures) ────────────────────── */
            {
                label: 'A/B testing',
                watch: 'the measured A/B result',
                caption: 'The experience she saw is a running A/B test — and it is measured.',
                run: async () => {
                    this.closeOpal(); this.hideCursor(); this.setTab('engine');
                    await this.driveOpenPdp(TABBY1);
                    await this.sleep(800);
                    this.showAbReadout();
                    await this.sleep(300);
                    this.scrollEngineTo('ab-readout'); this.pulse('#ab-readout');
                },
                callout: { anchor: '#ab-readout', usecase: 'A/B testing & measurement',
                    title: 'Every change is an experiment',
                    signal: 'The personalized modules are live to shoppers.',
                    decision: 'Run them as <strong>A/B tests</strong> so each earns its place on measured lift.',
                    impact: 'Personalize boldly, <strong>prove the impact</strong>. Figures <strong>illustrative</strong>; the platform is GA.' },
            },
            /* 12 ── MAB · multi-armed bandit (representative) ───────────────── */
            {
                label: 'Multi-armed bandit (MAB)',
                watch: 'traffic shift to the winner',
                caption: 'A multi-armed bandit auto-shifts traffic to the winning variation — no manual ramp.',
                run: async () => {
                    this.hideCursor(); this.setTab('engine');
                    this.showMab();
                    await this.sleep(400);
                    this.scrollEngineTo('mab-readout'); this.pulse('#mab-readout');
                },
                callout: { anchor: '#mab-readout', usecase: 'Multi-armed bandit (MAB)',
                    title: 'Traffic finds the winner automatically',
                    signal: 'Live variation performance (no fixed 50/50 split).',
                    decision: 'A <strong>multi-armed bandit</strong> shifts traffic to the best performer as it learns.',
                    impact: 'Capture lift sooner, no manual ramp. <strong>Representative figures; Optimizely MAB is GA.</strong>' },
            },
            /* 13 ── CMAB · contextual bandit (representative) ───────────────── */
            {
                label: 'Contextual bandit (CMAB)',
                watch: 'a different winner per context',
                caption: 'A contextual bandit picks a different winning variation for each context or segment.',
                run: async () => {
                    this.hideMab(); this.hideCursor(); this.setTab('engine');
                    this.showCmab();
                    await this.sleep(400);
                    this.scrollEngineTo('cmab-readout'); this.pulse('#cmab-readout');
                },
                callout: { anchor: '#cmab-readout', usecase: 'Contextual bandit (CMAB)',
                    title: 'A different winner per shopper-context',
                    signal: 'Each shopper\'s <strong>context</strong> — device, segment, intent.',
                    decision: 'A <strong>contextual bandit</strong> serves the variation that wins <em>for that context</em>.',
                    impact: 'Mobile Tabby-lovers & desktop gifters each get their own winner. <strong>Representative.</strong>' },
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
                    impact: 'She doesn\'t just see results — <strong>she sees herself there</strong>. Relevance from the first result.' },
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
                    impact: '<strong>Conversational commerce that shows the vision</strong> — taps straight to product.' },
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
        try { window.dispatchEvent(new Event('opal:reset')); } catch (e) {}   // fresh Opal chat per demo run
        this.ticked.clear(); this.renderChecklist(-1);   // Restart resets the checklist
        this.resetShopper();
        this.stepIndex = -1;
        this.nextStep();
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
        if (this.stepIndex >= this.steps.length - 1) { if (this.autoplay) this.stopAutoplay(); return; }
        await this.gotoStep(this.stepIndex + 1);
    }
    async prevStep() {
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
        this.stepIndex = idx;
        const step = this.steps[idx];
        this.stopAutoplayTimerOnly();

        // chrome
        this.hideCallout(); this.clearSpotlight(); this.hideTransientPanels();
        this.clearChangePills();                 // drop the previous beat's Before→Now pill
        if (idx !== 0) this.dismissWelcome();    // first-visit ribbon only belongs on beat 1
        this.tickFeature(idx);   // mark this requirement on the live checklist
        document.getElementById('dir-step-label').textContent = `Step ${idx + 1} of ${this.steps.length} · ${step.label}`;
        document.getElementById('dir-bar-fill').style.width = `${((idx + 1) / this.steps.length) * 100}%`;
        document.getElementById('dir-watch').innerHTML = `Watch: <b>${step.watch}</b>`;
        document.getElementById('dir-caption').textContent = step.caption;
        document.getElementById('dir-back').disabled = idx === 0;
        const nextBtn = document.getElementById('dir-next');
        nextBtn.disabled = true;

        try {
            if (fast) { await this.runStepFast(idx); }
            else { await step.run(); this.applyStepCallout(step); }
        } catch (e) { console.error('step error', e); }
        this.pushChange(idx);   // log "what changed this session" (deduped per beat)

        this.busy = false;
        if (!fast) {
            nextBtn.disabled = false;
            if (idx >= this.steps.length - 1) { nextBtn.disabled = true; this.stopAutoplay(); }
            if (this.autoplay && idx < this.steps.length - 1) this.scheduleAutoplay();
        }
    }
    applyStepCallout(step) {
        if (!step.callout) return;
        this.showCallout(step.callout);
        // Patch live values into callout bodies that declare placeholders.
        const stageSpan = document.getElementById('co-stage');
        if (stageSpan) stageSpan.textContent = this.journeyStage;
        const anonSpan = document.getElementById('co-anon');
        if (anonSpan) anonSpan.textContent = this.anonId;
        // Inject the runtime "Before → Now" line captured by this beat's annotateChange.
        if (this._ba) { this.appendBeforeAfter(this._ba.before, this._ba.after); this._ba = null; }
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
        this.openOpal();
        await this.sleep(500);
        const prompt = "high-intent Tabby browsers who haven't added to cart — show them complete-the-look";
        await this.typeInto('opal-prompt', prompt);
        await this.sleep(400);
        document.getElementById('opal-thinking').classList.add('show');
        // REAL CALL: Opal NL -> audience drafts.
        let draft = null;
        try {
            const res = await fetch('/operator/audiences/suggest', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nlPrompt: prompt }),
            });
            const json = await res.json();
            draft = (json.drafts && json.drafts[0]) || null;
            this.logEvent('post', 'opal:suggest', draft ? draft.key : 'no match', null, null);
        } catch (e) { console.error('opal suggest failed', e); }
        await this.sleep(900);
        document.getElementById('opal-thinking').classList.remove('show');
        if (draft) this.renderOpalResult(draft);
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
        document.getElementById('opal-prompt').innerHTML = '<span class="caret"></span>';
        document.getElementById('opal-result').classList.remove('show');
        document.getElementById('opal-published').classList.remove('show');
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
    showMab() {
        const arms = [
            { name: 'Variation A · Classic hero' },
            { name: 'Variation B · Complete-the-Look', win: true },
            { name: 'Variation C · Premium edit' },
        ];
        const wrap = document.getElementById('mab-arms');
        wrap.innerHTML = arms.map((a) =>
            `<div class="ab-arm ${a.win ? 'win' : 'base'}">
                <div class="ab-arm-top"><span class="ab-arm-name">${a.win ? '<b>' + a.name + '</b>' : a.name}</span><span class="ab-arm-cvr mab-traffic">33%</span></div>
                <div class="ab-track"><i style="width:33%"></i></div>
            </div>`).join('');
        const bars = wrap.querySelectorAll('.ab-track > i');
        const labels = wrap.querySelectorAll('.mab-traffic');
        document.getElementById('mab-foot').innerHTML = '';
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
                document.getElementById('mab-foot').innerHTML = `<b>Variation B</b> auto-promoted to <b>73%</b> of traffic on live performance — lift captured while still learning.`;
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
        const kicker = loading ? `<span class="live-dot"></span>Styling your edit…` : `<span class="live-dot"></span>The Edit`;
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
                    wrap.innerHTML = this._editHeroHtml(url, headline, subhead, anchor.name);
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
            el.innerHTML = (asset ? `<img class="ccl-img" src="${asset}" alt="" onload="this.classList.add('in')" onerror="this.closest('.cc-look').remove()">` : '')
                + (cap ? `<div class="ccl-cap">${cap}</div>` : '');
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
                el.classList.remove('loading');
                const img = document.createElement('img');
                img.className = 'ccl-img'; img.src = url;
                img.onload = () => img.classList.add('in'); img.onerror = () => el.remove();
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
        let full = '', bot = null;
        try {
            const res = await fetch('/ai/concierge', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: this.ccMessages, affinity: { dominantLine: this.dominantLine, currentProductId: this.currentPdpId || null } }),
            });
            if (res.ok && res.body) {
                thinking.remove();
                bot = this.appendCcMsg('bot', '');
                const reader = res.body.getReader(), dec = new TextDecoder();
                for (;;) {
                    const { value, done } = await reader.read(); if (done) break;
                    full += dec.decode(value, { stream: true });
                    bot.innerHTML = this.escapeHtml(full.replace(/\n?PICKS:.*$/is, '').trim());
                    const th = document.getElementById('cc-thread'); if (th) th.scrollTop = th.scrollHeight;
                }
            }
        } catch (e) { /* fall through to the scripted fallback */ }
        if (thinking && thinking.parentNode) thinking.remove();
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
        div.innerHTML = `<span class="opal-dots"><span></span><span></span><span></span></span>`;
        thread.appendChild(div);
        thread.scrollTop = thread.scrollHeight;
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
