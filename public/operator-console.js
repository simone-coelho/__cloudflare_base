/* =====================================================================
 * operator-console.js — Coach Merchandising x Optimizely Opal
 * ---------------------------------------------------------------------
 * Second-screen merchandiser console (docs/architecture/07 §5).
 *
 * REAL SEAMS, MOCKED CALLS. This page drives the real operator API:
 *   POST /operator/audiences/suggest   -> AudienceAuthoring.suggestAudiences (Opal mock)
 *   POST /operator/audiences/publish   -> AudienceAuthoring.createAudience   (human-approved)
 *   GET  /operator/audiences           -> AudienceStore.listPublished
 *   GET  /operator/insights            -> insights.json aggregates + views
 *
 * Every shape here matches the Order-0 connector contract
 * (src/connectors/types.ts: AudienceDef / AudienceCondition / AudiencePredicate)
 * and the seeded ODP insight views (src/data/insights.json).
 *
 * If the API routes are not mounted yet (sibling agent owns src/routes/operator.ts),
 * the console transparently falls back to a bundled synthetic corpus so the demo
 * still runs standalone — and says so on screen. Mock<->live is config-only.
 * Vanilla JS, no build step.
 * ===================================================================== */
(function () {
  'use strict';

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const els = {
    prompt: $('prompt'),
    askBtn: $('ask-btn'),
    askLabel: $('ask-label'),
    chips: $('prompt-chips'),
    draftZone: $('draft-zone'),
    draftEmpty: $('draft-empty'),
    statusZone: $('status-zone'),
    audList: $('aud-list'),
    refreshAud: $('refresh-aud'),
    insightsBtn: $('insights-btn'),
    insightsLabel: $('insights-label'),
    insightsWrap: $('insights-wrap'),
    modePill: $('mode-pill'),
    modeText: $('mode-text'),
    connText: $('conn-text'),
  };

  // Whether we are talking to the real /operator API or the bundled fallback.
  const state = { liveApi: false, insights: null, currentDraft: null };

  // ---------------------------------------------------------------
  // Small fetch helper: tolerant of missing routes / HTML 404 bodies.
  // ---------------------------------------------------------------
  async function api(path, opts) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      const detail = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.detail = detail;
      throw err;
    }
    if (!ct.includes('json')) throw new Error('non-json-response');
    return res.json();
  }

  // ===============================================================
  // ESCAPING / FORMAT
  // ===============================================================
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  const fmtInt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : esc(n));
  const fmtUsd = (n) => (typeof n === 'number' ? '$' + n.toLocaleString('en-US') : esc(n));
  const fmtPct = (n) => (typeof n === 'number' ? n.toFixed(1) + '%' : esc(n));
  function titleizeModule(m) {
    return String(m || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ===============================================================
  // CONDITION TREE RENDERER (AudienceCondition from types.ts)
  //   leaf  = { attribute, operator, value }  (AudiencePredicate)
  //   nodes = ['and'|'or'|'not', ...children]
  // ===============================================================
  const OP_LABEL = {
    eq: 'is', neq: 'is not', gte: '≥', lte: '≤', gt: '>', lt: '<',
    contains: 'contains', in: 'in', not_in: 'not in',
  };
  function renderValue(v) {
    if (typeof v === 'boolean') return `<span class="val bool">${v}</span>`;
    if (Array.isArray(v)) return `<span class="val">[${v.map((x) => esc(x)).join(', ')}]</span>`;
    return `<span class="val">${esc(v)}</span>`;
  }
  function renderCondition(cond) {
    if (Array.isArray(cond)) {
      const op = cond[0];
      const kids = cond.slice(1);
      const childHtml = kids.map((c) => `<div>${renderCondition(c)}</div>`).join('');
      return `<div class="cond-op">${esc(op)}</div><div class="cond-children">${childHtml}</div>`;
    }
    // leaf predicate
    const opl = OP_LABEL[cond.operator] || esc(cond.operator);
    return (
      `<div class="pred">` +
      `<span class="attr">${esc(cond.attribute)}</span>` +
      `<span class="op">${opl}</span>` +
      renderValue(cond.value) +
      `</div>`
    );
  }

  // ===============================================================
  // OPAL REVIEW CARD  (section 2)
  // ===============================================================
  function statLabel(key) {
    return ({
      audience_size: 'Est. live audience',
      audience_pct_of_base: '% of base',
      avg_product_views: 'Avg product views',
      avg_order_likelihood: 'Order likelihood',
      avg_order_value_usd: 'Avg order value',
      known_identity_pct: 'Known identity',
    }[key] || titleizeModule(key));
  }
  function statValue(key, v) {
    if (key === 'audience_size') return fmtInt(v);
    if (key.endsWith('_pct') || key === 'known_identity_pct') return fmtPct(v);
    if (key.endsWith('_usd')) return fmtUsd(v);
    if (key === 'avg_order_likelihood') return typeof v === 'number' ? Math.round(v * 100) + '%' : esc(v);
    if (key === 'avg_product_views') return typeof v === 'number' ? v.toFixed(1) : esc(v);
    return fmtInt(v);
  }

  // The four headline stats we always surface (others fall into the list).
  const HEADLINE_STATS = ['audience_size', 'avg_order_likelihood', 'avg_order_value_usd', 'known_identity_pct'];

  function renderEvidence(def) {
    const stats = def.stats || {};
    const headline = HEADLINE_STATS.filter((k) => k in stats);
    const rest = Object.keys(stats).filter((k) => !HEADLINE_STATS.includes(k));

    const statCards = headline
      .map((k) => `<div class="stat"><div class="n">${statValue(k, stats[k])}</div><div class="l">${statLabel(k)}</div></div>`)
      .join('');

    const restList = rest.length
      ? `<ul class="meta-list" style="margin-top:12px;">${rest
          .map((k) => `<li><span class="k">${statLabel(k)}</span><span class="v">${statValue(k, stats[k])}</span></li>`)
          .join('')}</ul>`
      : '';

    const top = Array.isArray(def.top_products) ? def.top_products.slice(0, 5) : [];
    const prodList = top.length
      ? `<div class="panel-title" style="margin-top:16px;">Top products in this cohort</div>
         <ul class="prod-list">${top
           .map(
             (p) => `<li>
               <span class="prod-thumb" aria-hidden="true"></span>
               <span class="prod-name">${esc(p.name)}<span class="prod-line"> &middot; ${esc(p.line || '')}</span></span>
               <span class="prod-price">${fmtUsd(p.price_usd)}</span>
               ${p.viewers != null ? `<span class="prod-views">${fmtInt(p.viewers)} viewers</span>` : ''}
             </li>`,
           )
           .join('')}</ul>`
      : '';

    if (!statCards && !prodList) return '';
    return `<div class="evidence">
      <div class="panel-title">Evidence &middot; synthetic Coach NA, last 90d</div>
      <div class="stat-row">${statCards}</div>
      ${restList}
      ${prodList}
    </div>`;
  }

  function renderDraftCard(def) {
    const moduleKey = def.recommendedModule || def.recommended_module;
    const flagHtml = moduleKey
      ? `<div class="panel-title" style="margin-top:16px;">Recommended action</div>
         <span class="module-flag">flag: ${esc(moduleKey)} = on</span>
         <div style="font-size:12px;color:var(--coach-ink-soft);margin-top:8px;">
           A/B test 50/50 &middot; primary metric: items-per-order &middot; guardrail: AOV
         </div>`
      : '';

    return `<div class="review-card" id="review-card">
      <div class="review-head">
        <div>
          <span class="opal-badge"><span class="spark">&#10024;</span> Opal &middot; AI-suggested</span>
          <h3>${esc(def.name)}</h3>
          <div class="desc">${esc(def.description)}</div>
        </div>
        <span class="seg-key" title="ODP segment key">${esc(def.key)}</span>
      </div>
      <div class="review-body">
        <div class="review-grid">
          <div>
            <div class="panel-title">ODP condition tree</div>
            <div class="cond-tree">${renderCondition(def.conditions)}</div>
            ${flagHtml}
          </div>
          <div>
            <div class="panel-title">At a glance</div>
            <ul class="meta-list">
              <li><span class="k">Evaluation</span><span class="v">${esc(def.evaluation || 'realtime')}</span></li>
              <li><span class="k">Source</span><span class="v">${esc(def.source || 'opal_nl')}</span></li>
              <li><span class="k">Anchor line</span><span class="v">${esc(def.anchorLine || def.anchor_line || '—')}</span></li>
              <li><span class="k">Status</span><span class="v">${esc(def.status || 'suggested')}</span></li>
            </ul>
          </div>
        </div>
        ${renderEvidence(def)}
        <div class="provenance">
          <span class="ic" aria-hidden="true">&#10024;</span>
          <span>
            <strong>This is a mocked Opal call.</strong> The draft and its evidence come from
            synthetic Coach NA data shaped to ODP&rsquo;s schema. In live mode the same prompt is
            authored by Optimizely Opal against Coach&rsquo;s ODP. Publishing is a human governance step.
          </span>
        </div>
        <div class="review-actions">
          <button class="btn btn-ghost" id="discard-btn">Discard</button>
          <button class="btn btn-gold" id="publish-btn">
            <span id="publish-label">Publish to store</span>
            <span aria-hidden="true">&#9654;</span>
          </button>
        </div>
      </div>
    </div>`;
  }

  function showDraft(def) {
    state.currentDraft = def;
    els.draftEmpty.hidden = true;
    els.draftEmpty.style.display = 'none';
    els.draftZone.innerHTML = renderDraftCard(def);
    $('publish-btn').addEventListener('click', onPublish);
    $('discard-btn').addEventListener('click', () => {
      state.currentDraft = null;
      els.draftZone.innerHTML = '';
      els.draftEmpty.style.display = '';
      els.draftEmpty.hidden = false;
    });
    els.draftZone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ===============================================================
  // STATUS BANNER (section 3)
  // ===============================================================
  function showStatus(html, isErr) {
    els.statusZone.innerHTML = `<div class="status-banner ${isErr ? 'err' : ''}">${html}</div>`;
  }
  function clearStatus() { els.statusZone.innerHTML = ''; }

  // ===============================================================
  // ASK OPAL  ->  POST /operator/audiences/suggest
  // ===============================================================
  async function onAsk() {
    const prompt = els.prompt.value.trim();
    if (!prompt) { els.prompt.focus(); return; }
    clearStatus();
    setAsking(true);
    try {
      let drafts;
      try {
        const out = await api('/operator/audiences/suggest', {
          method: 'POST',
          body: JSON.stringify({ nlPrompt: prompt }),
        });
        drafts = normalizeSuggest(out);
        state.liveApi = true;
      } catch (e) {
        if (e.status && e.status >= 500) throw e; // a real server error: surface it
        // route missing / not json -> bundled fallback
        drafts = Fallback.suggest(prompt);
        state.liveApi = false;
        setMode();
      }
      if (!drafts || !drafts.length) {
        showStatus(
          `<span class="tick">&#9888;</span><span>Opal couldn&rsquo;t map that prompt to a Coach audience. Try a chip below, or mention a line (Tabby, Brooklyn) and an intent (no cart, ready to buy).</span>`,
          true,
        );
        return;
      }
      showDraft(drafts[0]);
    } catch (e) {
      showStatus(`<span class="tick">&#9888;</span><span>Couldn&rsquo;t reach Opal: ${esc(e.message)}.</span>`, true);
    } finally {
      setAsking(false);
    }
  }

  // Tolerant of the route's envelope. src/routes/operator.ts returns
  // { success, drafts: AudienceDef[] }; also accept a bare array or other keys.
  function normalizeSuggest(out) {
    if (Array.isArray(out)) return out;
    if (out && Array.isArray(out.drafts)) return out.drafts;
    if (out && Array.isArray(out.suggestions)) return out.suggestions;
    if (out && Array.isArray(out.audiences)) return out.audiences;
    if (out && out.key && out.conditions) return [out];
    return [];
  }

  function setAsking(on) {
    els.askBtn.disabled = on;
    els.askLabel.innerHTML = on ? '<span class="spinner"></span> Asking Opal' : 'Ask Opal';
  }

  // ===============================================================
  // PUBLISH  ->  POST /operator/audiences/publish
  // ===============================================================
  async function onPublish() {
    const def = state.currentDraft;
    if (!def) return;
    const btn = $('publish-btn');
    const label = $('publish-label');
    btn.disabled = true;
    label.innerHTML = '<span class="spinner dark"></span> Publishing';
    try {
      let result;
      try {
        // The route expects { audience: AudienceDef } (publishSchema).
        result = await api('/operator/audiences/publish', {
          method: 'POST',
          body: JSON.stringify({ audience: toAudienceDef(def) }),
        });
        state.liveApi = true;
      } catch (e) {
        if (e.status && e.status >= 500) throw e;
        result = Fallback.publish(def);
        state.liveApi = false;
        setMode();
      }
      const audienceId = result.audienceId || result.audience_id || (result.audience && result.audience.audienceId) || def.key;
      // The route reports reach as `notifiedUsers` (storefront sessions flashed);
      // also accept matchedSessions for forward-compat.
      const matched =
        result.notifiedUsers != null ? result.notifiedUsers
          : result.matchedSessions != null ? result.matchedSessions
          : result.matched_sessions;
      const ts = new Date(result.ts || result.timestamp || result.publishedAt || Date.now());
      const parts = [
        `<span class="tick">&#10003;</span>`,
        `<span><strong>Published</strong> ${esc(def.name)} `,
        `&middot; live for matching shoppers `,
        `<code>${esc(audienceId)}</code>`,
        matched != null ? ` &middot; ${fmtInt(matched)} live session${matched === 1 ? '' : 's'} matched` : '',
        ` &middot; A/B test running`,
        ` &middot; ${ts.toLocaleTimeString('en-US')}</span>`,
      ];
      showStatus(parts.join(''), false);
      // The draft is now published: collapse the card, refresh the live list.
      state.currentDraft = null;
      els.draftZone.innerHTML = '';
      els.draftEmpty.style.display = '';
      els.draftEmpty.hidden = false;
      await loadAudiences(def.key);
    } catch (e) {
      btn.disabled = false;
      label.textContent = 'Publish to store';
      showStatus(`<span class="tick">&#9888;</span><span>Publish failed: ${esc(e.message)}.</span>`, true);
    }
  }

  // Coerce a suggestion (live or fallback) into a clean AudienceDef for publish.
  function toAudienceDef(def) {
    return {
      key: def.key,
      name: def.name,
      description: def.description,
      conditions: def.conditions,
      evaluation: def.evaluation || 'realtime',
      source: def.source || 'opal_nl',
      createdAt: def.createdAt || Date.now(),
      status: 'published',
      recommendedModule: def.recommendedModule || def.recommended_module,
      anchorLine: def.anchorLine || def.anchor_line || undefined,
      stats: def.stats,
    };
  }

  // ===============================================================
  // LIVE AUDIENCES  ->  GET /operator/audiences
  // ===============================================================
  async function loadAudiences(freshKey) {
    try {
      let list;
      try {
        const out = await api('/operator/audiences');
        list = Array.isArray(out) ? out : out.audiences || out.published || [];
        state.liveApi = true;
      } catch (e) {
        if (e.status && e.status >= 500) throw e;
        list = Fallback.audiences();
        state.liveApi = false;
        setMode();
      }
      renderAudiences(list, freshKey);
    } catch (e) {
      els.audList.innerHTML = `<li class="empty">Couldn&rsquo;t load audiences: ${esc(e.message)}</li>`;
    }
  }

  function renderAudiences(list, freshKey) {
    if (!list || !list.length) {
      els.audList.innerHTML = `<li class="empty">No published audiences yet.</li>`;
      return;
    }
    // Freshly published first, then newest createdAt.
    const sorted = list.slice().sort((a, b) => {
      if (a.key === freshKey) return -1;
      if (b.key === freshKey) return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    els.audList.innerHTML = sorted
      .map((a) => {
        const size = a.stats && (a.stats.audience_size != null ? a.stats.audience_size : a.stats.size);
        const src = a.source || 'seed';
        return `<li class="aud-item ${a.key === freshKey ? 'fresh' : ''}">
          <div class="top">
            <span class="name">${esc(a.name)}</span>
          </div>
          <div class="key">${esc(a.key)}</div>
          <div class="row2">
            <span class="tag tag-pub">published</span>
            <span class="tag tag-src-${esc(src)}">${esc(src === 'opal_nl' ? 'opal' : src)}</span>
            ${size != null ? `<span class="tag tag-size">~${fmtInt(size)} shoppers</span>` : ''}
          </div>
        </li>`;
      })
      .join('');
  }

  // ===============================================================
  // INSIGHTS  ->  GET /operator/insights
  // ===============================================================
  async function loadInsights() {
    if (state.insights) return state.insights;
    let data;
    try {
      data = await api('/operator/insights');
      state.liveApi = true;
    } catch (e) {
      if (e.status && e.status >= 500) throw e;
      data = Fallback.insights();
      state.liveApi = false;
      setMode();
    }
    // Accept either { aggregates, insights } (insights.json) or a flattened body.
    state.insights = data.aggregates ? data : { aggregates: data, insights: data.insights || [] };
    return state.insights;
  }

  function renderInsights(data) {
    const agg = data.aggregates || {};
    const funnel = agg.funnel || {};
    const views = agg.views_by_line || {};
    const top = agg.top_products || [];

    // headline aggregates
    const cards = [
      ['Customers', fmtInt(agg.total_customers)],
      ['Events', fmtInt(agg.total_events)],
      ['Revenue', fmtUsd(agg.total_revenue_usd)],
      ['View→Cart', funnel.view_to_cart_rate != null ? fmtPct(funnel.view_to_cart_rate) : '—'],
    ];
    const aggGrid = `<div class="agg-grid">${cards
      .map(([l, n]) => `<div class="agg"><div class="n">${n}</div><div class="l">${l}</div></div>`)
      .join('')}</div>`;

    // funnel bars
    const steps = ['page_view', 'product_view', 'add_to_cart', 'purchase'].filter((k) => k in funnel);
    const fmax = Math.max(...steps.map((k) => funnel[k] || 0), 1);
    const funnelHtml = steps.length
      ? `<div class="panel-title" style="margin-top:18px;">Funnel</div>
         <div class="funnel">${steps
           .map(
             (k) => `<div class="funnel-row">
               <div class="flabel"><span class="fk">${k.replace(/_/g, ' ')}</span><span class="fv">${fmtInt(funnel[k])}</span></div>
               <div class="bar"><span style="width:${((funnel[k] || 0) / fmax) * 100}%"></span></div>
             </div>`,
           )
           .join('')}
           <div class="rate-note">
             ${funnel.view_to_cart_rate != null ? `view→cart ${fmtPct(funnel.view_to_cart_rate)}` : ''}
             ${funnel.cart_to_purchase_rate != null ? ` &middot; cart→purchase ${fmtPct(funnel.cart_to_purchase_rate)}` : ''}
           </div>
         </div>`
      : '';

    // views by line (top 8)
    const lineEntries = Object.entries(views).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const lmax = lineEntries.length ? lineEntries[0][1] : 1;
    const linesHtml = lineEntries.length
      ? `<div class="panel-title" style="margin-top:18px;">Views by line</div>
         <div class="line-bars">${lineEntries
           .map(
             ([k, v]) => `<div class="line-row">
               <span class="lk" title="${esc(k)}">${esc(k)}</span>
               <span class="mini-bar"><span style="width:${(v / lmax) * 100}%"></span></span>
               <span class="lv">${fmtInt(v)}</span>
             </div>`,
           )
           .join('')}</div>`
      : '';

    // top products overall
    const topHtml = top.length
      ? `<div class="panel-title" style="margin-top:18px;">Top products</div>
         <ul class="prod-list">${top
           .slice(0, 5)
           .map(
             (p) => `<li>
               <span class="prod-thumb" aria-hidden="true"></span>
               <span class="prod-name">${esc(p.name)}<span class="prod-line"> &middot; ${esc(p.line || '')}</span></span>
               <span class="prod-price">${fmtUsd(p.price_usd)}</span>
               ${p.views != null ? `<span class="prod-views">${fmtInt(p.views)} views</span>` : ''}
             </li>`,
           )
           .join('')}</ul>`
      : '';

    els.insightsWrap.innerHTML =
      aggGrid +
      funnelHtml +
      linesHtml +
      topHtml +
      `<div class="provenance" style="margin-top:16px;">
        <span class="ic" aria-hidden="true">&#9432;</span>
        <span><strong>Synthetic Coach NA data, shaped to ODP schema.</strong> This is the aggregate
        evidence Opal reasons over &mdash; aggregate-first, never raw rows. Live mode reads Coach&rsquo;s ODP.</span>
      </div>`;
    // animate funnel bars in
    requestAnimationFrame(() => {
      els.insightsWrap.querySelectorAll('.bar > span, .mini-bar > span').forEach((b) => {
        const w = b.style.width; b.style.width = '0'; requestAnimationFrame(() => (b.style.width = w));
      });
    });
  }

  async function toggleInsights() {
    const open = !els.insightsWrap.hidden;
    if (open) {
      els.insightsWrap.hidden = true;
      els.insightsLabel.textContent = 'View synthetic-data insights';
      return;
    }
    els.insightsBtn.disabled = true;
    els.insightsLabel.innerHTML = '<span class="spinner dark"></span> Loading';
    try {
      const data = await loadInsights();
      renderInsights(data);
      els.insightsWrap.hidden = false;
      els.insightsLabel.textContent = 'Hide insights';
    } catch (e) {
      els.insightsWrap.innerHTML = `<div class="empty">Couldn&rsquo;t load insights: ${esc(e.message)}</div>`;
      els.insightsWrap.hidden = false;
      els.insightsLabel.textContent = 'Hide insights';
    } finally {
      els.insightsBtn.disabled = false;
    }
  }

  // ===============================================================
  // MODE / CONNECTION INDICATOR
  // ===============================================================
  function setMode() {
    const live = state.liveApi;
    els.modePill.dataset.mode = live ? 'live' : 'mock';
    els.modeText.textContent = live ? 'connected' : 'mock';
    els.connText.textContent = live ? 'live API' : 'standalone (bundled)';
  }

  // ===============================================================
  // PROMPT CHIPS — seeded from the real insight nl_prompts
  // ===============================================================
  function buildChips() {
    const prompts = Fallback.prompts();
    els.chips.innerHTML = prompts
      .map((p) => `<button type="button" class="chip" data-p="${esc(p)}">${esc(p)}</button>`)
      .join('');
    els.chips.querySelectorAll('.chip').forEach((c) =>
      c.addEventListener('click', () => {
        els.prompt.value = c.dataset.p;
        els.prompt.focus();
      }),
    );
  }

  // ===============================================================
  // BUNDLED FALLBACK CORPUS
  //   Mirrors src/data/insights.json (ODP insight views) + a small
  //   intent-matcher so the page demos standalone if /operator/* is
  //   not mounted. Same shapes the live mock adapters return.
  // ===============================================================
  const Fallback = (function () {
    // 10 seeded ODP insight views (subset of fields the console renders),
    // lifted from data/synthetic/insights.json.
    const INSIGHTS = [
      {
        key: 'high_intent_tabby_browser',
        name: 'High-Intent Tabby Browsers (no add-to-cart)',
        description: 'Shoppers viewing Tabby 3+ times this session who have not added to cart — the hero "complete the look" target.',
        nl_prompt: "high-intent Tabby browsers who haven't added to cart",
        recommended_module: 'complete_the_look',
        anchor_line: 'Tabby',
        conditions: ['and',
          { attribute: 'viewed_product_line', operator: 'eq', value: 'Tabby' },
          { attribute: 'product_views', operator: 'gte', value: 3 },
          { attribute: 'cart_adds', operator: 'eq', value: 0 }],
        stats: { audience_size: 114, audience_pct_of_base: 3.6, avg_product_views: 4.5, avg_order_likelihood: 0.259, avg_order_value_usd: 320, known_identity_pct: 60.5 },
        top_products: [
          { product_id: 'COA-CY201', name: 'Tabby Shoulder Bag 20', line: 'Tabby', price_usd: 375, viewers: 33 },
          { product_id: 'COA-CBH23', name: 'Tabby Chain Crossbody Bag 19 With Quilting', line: 'Tabby', price_usd: 350, viewers: 28 },
          { product_id: 'COA-76197', name: 'Tabby Crossbody Bag', line: 'Tabby', price_usd: 350, viewers: 26 },
          { product_id: 'COA-CB925', name: 'Tabby Wallet With Chain', line: 'Tabby', price_usd: 250, viewers: 25 },
          { product_id: 'COA-CY919', name: 'Chain Tabby Shoulder Bag', line: 'Tabby', price_usd: 495, viewers: 25 },
        ],
      },
      {
        key: 'early_journey_cold_start',
        name: 'Early-Journey Cold-Start Shoppers',
        description: 'Anonymous or shallow sessions (few views, no cart) — bootstrap with curated/trending merchandising.',
        nl_prompt: 'brand-new anonymous shoppers just landing',
        recommended_module: 'curated_grid',
        anchor_line: null,
        conditions: ['and',
          { attribute: 'journey_stage', operator: 'eq', value: 'early' },
          { attribute: 'cart_adds', operator: 'eq', value: 0 }],
        stats: { audience_size: 700, audience_pct_of_base: 21.9, avg_product_views: 0.6, avg_order_likelihood: 0.163, avg_order_value_usd: 333, known_identity_pct: 66.3 },
        top_products: [
          { product_id: 'COA-76197', name: 'Tabby Crossbody Bag', line: 'Tabby', price_usd: 350, viewers: 153 },
          { product_id: 'COA-CBH23', name: 'Tabby Chain Crossbody Bag 19 With Quilting', line: 'Tabby', price_usd: 350, viewers: 147 },
          { product_id: 'COA-CY201', name: 'Tabby Shoulder Bag 20', line: 'Tabby', price_usd: 375, viewers: 146 },
        ],
      },
      {
        key: 'mid_journey_considering',
        name: 'Mid-Journey Considerers',
        description: 'Engaged browsers (5+ views or deep dwell) weighing options — show social proof + complete-the-look.',
        nl_prompt: 'shoppers actively comparing products mid-journey',
        recommended_module: 'social_proof',
        anchor_line: null,
        conditions: ['and',
          { attribute: 'journey_stage', operator: 'eq', value: 'mid' },
          { attribute: 'product_views', operator: 'gte', value: 5 }],
        stats: { audience_size: 132, audience_pct_of_base: 4.1, avg_product_views: 5.8, avg_order_likelihood: 0.3, avg_order_value_usd: 318, known_identity_pct: 65.2 },
        top_products: [
          { product_id: 'COA-CBH23', name: 'Tabby Chain Crossbody Bag 19 With Quilting', line: 'Tabby', price_usd: 350, viewers: 40 },
          { product_id: 'COA-CY201', name: 'Tabby Shoulder Bag 20', line: 'Tabby', price_usd: 375, viewers: 34 },
        ],
      },
      {
        key: 'late_journey_ready_to_buy',
        name: 'Late-Journey Ready-to-Buy (active cart)',
        description: 'Items added in the CURRENT session, not yet purchased — reassure with shipping/returns + checkout nudge.',
        nl_prompt: 'shoppers with items in their cart right now who are close to buying',
        recommended_module: 'checkout_nudge',
        anchor_line: null,
        conditions: ['and',
          { attribute: 'cart_adds', operator: 'gte', value: 1 },
          { attribute: 'purchases', operator: 'eq', value: 0 }],
        stats: { audience_size: 786, audience_pct_of_base: 24.6, avg_product_views: 4.8, avg_order_likelihood: 0.616, avg_order_value_usd: 336, known_identity_pct: 64.5 },
        top_products: [
          { product_id: 'COA-CBH23', name: 'Tabby Chain Crossbody Bag 19 With Quilting', line: 'Tabby', price_usd: 350, viewers: 272 },
          { product_id: 'COA-CY201', name: 'Tabby Shoulder Bag 20', line: 'Tabby', price_usd: 375, viewers: 268 },
        ],
      },
      {
        key: 'cart_abandoner',
        name: 'Cart Abandoners (returning)',
        description: 'Added to cart in a prior/this session and left without buying — retarget with the abandoned line + urgency.',
        nl_prompt: 'people who added to cart but abandoned without buying',
        recommended_module: 'cart_recovery',
        anchor_line: null,
        conditions: ['and',
          { attribute: 'cart_abandoned', operator: 'eq', value: true },
          { attribute: 'purchases', operator: 'eq', value: 0 }],
        stats: { audience_size: 1106, audience_pct_of_base: 34.6, avg_product_views: 4, avg_order_likelihood: 0.514, avg_order_value_usd: 332, known_identity_pct: 63.9 },
        top_products: [
          { product_id: 'COA-CBH23', name: 'Tabby Chain Crossbody Bag 19 With Quilting', line: 'Tabby', price_usd: 350, viewers: 358 },
        ],
      },
      {
        key: 'high_aov_gifter',
        name: 'High-AOV Gifters',
        description: 'Gift-oriented shoppers with elevated order value — surface gift sets, charms, and gift wrap.',
        nl_prompt: 'high-AOV gifters shopping for presents',
        recommended_module: 'gift_edit',
        anchor_line: null,
        conditions: ['and',
          { attribute: 'gifter', operator: 'eq', value: true },
          { attribute: 'average_order_value_usd', operator: 'gte', value: 300 }],
        stats: { audience_size: 279, audience_pct_of_base: 8.7, avg_product_views: 5.6, avg_order_likelihood: 0.523, avg_order_value_usd: 416, known_identity_pct: 65.6 },
        top_products: [
          { product_id: 'COA-CB925', name: 'Tabby Wallet With Chain', line: 'Tabby', price_usd: 250, viewers: 174 },
          { product_id: 'COA-CCZ00', name: 'Tabby Bag Charm', line: 'Tabby', price_usd: 150, viewers: 119 },
        ],
      },
      {
        key: 'luxe_affinity',
        name: 'Luxe / Elevated-Price Affinity',
        description: 'Shoppers browsing the elevated price band or with high AOV — promote Rogue, crystal Tabby, premium leathers.',
        nl_prompt: 'customers who love our most premium pieces',
        recommended_module: 'premium_hero',
        anchor_line: null,
        conditions: ['or',
          { attribute: 'price_band_viewed', operator: 'eq', value: 'elevated' },
          { attribute: 'average_order_value_usd', operator: 'gte', value: 500 }],
        stats: { audience_size: 999, audience_pct_of_base: 31.2, avg_product_views: 5.4, avg_order_likelihood: 0.521, avg_order_value_usd: 436, known_identity_pct: 65 },
        top_products: [
          { product_id: 'COA-CW620', name: 'Tabby Shoulder Bag 26 With Quilting', line: 'Tabby', price_usd: 575, viewers: 574 },
          { product_id: 'COA-CCX04', name: 'Tabby Shoulder Bag 26', line: 'Tabby', price_usd: 575, viewers: 545 },
        ],
      },
      {
        key: 'vip_loyalist',
        name: 'VIP Loyalists',
        description: 'Gold/Platinum loyalty with high engagement — early access + concierge messaging.',
        nl_prompt: 'our most loyal VIP customers',
        recommended_module: 'vip_early_access',
        anchor_line: null,
        conditions: ['and',
          { attribute: 'loyalty_tier', operator: 'in', value: ['gold', 'platinum'] },
          { attribute: 'engagement_rank', operator: 'in', value: ['high', 'vip'] }],
        stats: { audience_size: 302, audience_pct_of_base: 9.4, avg_product_views: 6.2, avg_order_likelihood: 0.679, avg_order_value_usd: 495, known_identity_pct: 100 },
        top_products: [
          { product_id: 'COA-CW620', name: 'Tabby Shoulder Bag 26 With Quilting', line: 'Tabby', price_usd: 575, viewers: 220 },
        ],
      },
      {
        key: 'brooklyn_browser',
        name: 'Brooklyn Line Affinity',
        description: 'Shoppers gravitating to the Brooklyn line — workhorse leather; pair with straps and totes.',
        nl_prompt: 'shoppers interested in the Brooklyn collection',
        recommended_module: 'line_spotlight',
        anchor_line: 'Brooklyn',
        conditions: ['and',
          { attribute: 'viewed_product_line', operator: 'eq', value: 'Brooklyn' },
          { attribute: 'product_views', operator: 'gte', value: 2 }],
        stats: { audience_size: 249, audience_pct_of_base: 7.8, avg_product_views: 7.3, avg_order_likelihood: 0.575, avg_order_value_usd: 392, known_identity_pct: 61.8 },
        top_products: [
          { product_id: 'COA-CU068', name: 'Brooklyn Shoulder Bag 28', line: 'Brooklyn', price_usd: 295, viewers: 91 },
          { product_id: 'COA-CW614', name: 'Brooklyn Shoulder Bag 23', line: 'Brooklyn', price_usd: 250, viewers: 97 },
        ],
      },
      {
        key: 'lapsed_reengagement',
        name: 'Lapsed but Re-Engaging',
        description: 'High churn-risk profiles showing fresh activity — win-back offer + bestsellers.',
        nl_prompt: 'lapsed customers who just came back',
        recommended_module: 'winback_offer',
        anchor_line: null,
        conditions: ['and',
          { attribute: 'churn_risk_score', operator: 'gte', value: 0.6 },
          { attribute: 'product_views', operator: 'gte', value: 1 }],
        stats: { audience_size: 140, audience_pct_of_base: 4.4, avg_product_views: 1.8, avg_order_likelihood: 0.266, avg_order_value_usd: 313, known_identity_pct: 62.1 },
        top_products: [
          { product_id: 'COA-CY919', name: 'Chain Tabby Shoulder Bag', line: 'Tabby', price_usd: 495, viewers: 23 },
        ],
      },
    ];

    // Aggregates (from insights.json `aggregates`).
    const AGGREGATES = {
      total_customers: 3200,
      total_events: 120041,
      total_revenue_usd: 3291802,
      funnel: { page_view: 28888, product_view: 50660, add_to_cart: 24101, purchase: 7293, view_to_cart_rate: 47.6, cart_to_purchase_rate: 30.3 },
      views_by_line: { Tabby: 23445, Essential: 6165, Brooklyn: 5032, 'Pillow Tabby': 2230, Lana: 2172, Mollie: 1915, Kira: 1769, Kisslock: 1195, Nolita: 1068, Cary: 942, Teri: 879, Nora: 823, Bandit: 845, Rogue: 520, Signature: 485, Willow: 439, Novelty: 393, Hadley: 343 },
      top_products: [
        { product_id: 'COA-CBH23', name: 'Tabby Chain Crossbody Bag 19 With Quilting', line: 'Tabby', price_usd: 350, views: 2622 },
        { product_id: 'COA-CY201', name: 'Tabby Shoulder Bag 20', line: 'Tabby', price_usd: 375, views: 2586 },
        { product_id: 'COA-76197', name: 'Tabby Crossbody Bag', line: 'Tabby', price_usd: 350, views: 2442 },
        { product_id: 'COA-CB925', name: 'Tabby Wallet With Chain', line: 'Tabby', price_usd: 250, views: 2122 },
        { product_id: 'COA-CW620', name: 'Tabby Shoulder Bag 26 With Quilting', line: 'Tabby', price_usd: 575, views: 1750 },
      ],
    };

    // Runtime-published audiences in standalone mode (in-memory only).
    const runtime = [];

    // Lightweight intent matcher: best insight by keyword overlap with the prompt.
    function suggest(prompt) {
      const p = prompt.toLowerCase();
      let best = null;
      let bestScore = 0;
      for (const ins of INSIGHTS) {
        let score = 0;
        const hay = (ins.nl_prompt + ' ' + ins.name + ' ' + ins.description + ' ' + (ins.anchor_line || '')).toLowerCase();
        // token overlap
        p.split(/[^a-z0-9]+/).filter((t) => t.length > 2).forEach((t) => {
          if (hay.includes(t)) score += 1;
        });
        // strong signals
        if (ins.anchor_line && p.includes(ins.anchor_line.toLowerCase())) score += 4;
        if (/no(t)?\s+(add|cart)|haven'?t.*cart|without.*cart/.test(p) && ins.key === 'high_intent_tabby_browser') score += 4;
        if (/cold|new|anonymous|just land/.test(p) && ins.key === 'early_journey_cold_start') score += 4;
        if (/cart|checkout|ready to buy|close to buy/.test(p) && ins.key === 'late_journey_ready_to_buy') score += 3;
        if (/abandon/.test(p) && ins.key === 'cart_abandoner') score += 4;
        if (/gift/.test(p) && ins.key === 'high_aov_gifter') score += 4;
        if (/premium|luxe|elevated|expensive/.test(p) && ins.key === 'luxe_affinity') score += 4;
        if (/vip|loyal|loyalty/.test(p) && ins.key === 'vip_loyalist') score += 4;
        if (/lapsed|win.?back|churn|came back/.test(p) && ins.key === 'lapsed_reengagement') score += 4;
        if (/complete the look|style the/.test(p) && ins.key === 'high_intent_tabby_browser') score += 3;
        if (score > bestScore) { bestScore = score; best = ins; }
      }
      if (!best || bestScore === 0) return [];
      // Return as an AudienceDef-shaped DRAFT (status:'suggested', source:'opal_nl').
      return [{
        key: best.key,
        name: best.name,
        description: prompt.trim() ? `${best.description}` : best.description,
        conditions: best.conditions,
        evaluation: 'realtime',
        source: 'opal_nl',
        createdAt: Date.now(),
        status: 'suggested',
        recommendedModule: best.recommended_module,
        anchorLine: best.anchor_line || undefined,
        stats: best.stats,
        top_products: best.top_products,
      }];
    }

    function publish(def) {
      const audienceId = 'aud_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
      if (!runtime.find((a) => a.key === def.key)) {
        runtime.push({ ...def, audienceId, status: 'published', source: def.source || 'opal_nl', createdAt: Date.now() });
      }
      // Synthetic "matched live sessions" for the confirmation line.
      const matched = 1 + Math.floor(Math.random() * 3);
      return { published: true, audienceId, matchedSessions: matched, experimentId: 'exp_' + audienceId.slice(4, 12), ts: Date.now() };
    }

    function audiences() {
      // seeds (status published) + anything published this session
      const seeds = INSIGHTS.map((ins) => ({
        key: ins.key,
        name: ins.name,
        description: ins.description,
        conditions: ins.conditions,
        evaluation: 'realtime',
        source: 'seed',
        status: 'published',
        createdAt: 0,
        recommendedModule: ins.recommended_module,
        anchorLine: ins.anchor_line || undefined,
        stats: ins.stats,
      }));
      const byKey = {};
      [...seeds, ...runtime].forEach((a) => { byKey[a.key] = a; });
      return Object.values(byKey);
    }

    function insights() { return { aggregates: AGGREGATES, insights: INSIGHTS }; }

    function prompts() {
      return [
        "high-intent Tabby browsers who haven't added to cart",
        'brand-new anonymous shoppers just landing',
        'shoppers with items in their cart right now',
        'people who added to cart but abandoned',
        'our most loyal VIP customers',
      ];
    }

    return { suggest, publish, audiences, insights, prompts, INSIGHTS, AGGREGATES };
  })();

  // ===============================================================
  // PROBE: is the real /operator API mounted?
  // ===============================================================
  async function probeApi() {
    try {
      await api('/operator/audiences');
      state.liveApi = true;
    } catch (e) {
      state.liveApi = false;
    }
    setMode();
  }

  // ===============================================================
  // INIT
  // ===============================================================
  function init() {
    buildChips();
    els.askBtn.addEventListener('click', onAsk);
    els.prompt.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onAsk();
    });
    els.refreshAud.addEventListener('click', () => loadAudiences());
    els.insightsBtn.addEventListener('click', toggleInsights);

    probeApi().finally(() => {
      loadAudiences();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
