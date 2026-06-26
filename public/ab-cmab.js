/* ===== A/B + CMAB (owner: ab-cmab) =====
 * Engine-tab readouts + the launchExperiment integration seam (Revenue Radar → engine).
 * Attaches to window.store (set by storefront.js) like revenue-radar.js. Renders into the
 * EXISTING Engine markup (#ab-readout / #cmab-readout). The CMAB readout is backed by the real
 * /experiment/cmab decision service; the A/B readout renders a launched experiment's result.
 *
 * Seam (build-to-this-blind): store.launchExperiment({audienceId, audienceName, variations,
 *   metric, type}) -> { experimentId, experimentKey, readoutUrl, status }, and it opens the
 *   Engine tab + renders the readout so the Revenue Radar loop closes on screen.
 * Lift figures are clearly-labeled REPRESENTATIVE (TDD §7).
 */
(function () {
  function ready(cb) { var t = setInterval(function () { if (window.store) { clearInterval(t); cb(window.store); } }, 40); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function rate(r) { return (Math.round((r || 0) * 10) / 10) + '%'; }

  ready(function (store) {
    /* — the ONE seam Revenue Radar calls — */
    store.launchExperiment = async function (opts) {
      opts = opts || {};
      try {
        var res = await fetch('/experiment/launch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audienceId: opts.audienceId, audienceName: opts.audienceName,
            variations: opts.variations, metric: opts.metric,
            type: opts.type || 'ab', name: opts.name, experimentKey: opts.experimentKey,
          }),
        });
        var exp = await res.json();
        store._lastExperiment = exp;
        try { store.setTab('engine'); } catch (e) {}
        store.showExperimentReadout(exp);
        try { store.sendAction('experiment_launched', { experimentKey: exp.experimentKey, flagKey: exp.flagKey, audienceId: exp.audienceId }, { label: exp.experimentKey }); } catch (e) {}
        return { experimentId: exp.experimentId, experimentKey: exp.experimentKey, readoutUrl: exp.readoutUrl, status: exp.status };
      } catch (e) { console.warn('[ab-cmab] launchExperiment failed', e); return null; }
    };

    /* — render a launched experiment into the A/B readout (control vs treatment + lift) — */
    store.showExperimentReadout = function (exp) {
      if (!exp) return;
      if (typeof exp === 'string') {
        fetch('/experiment/' + encodeURIComponent(exp) + '/readout')
          .then(function (r) { return r.json(); })
          .then(function (e) { if (e && !e.error) store.showExperimentReadout(e); })
          .catch(function () {});
        return;
      }
      var ro = exp.readout || {}; var arms = ro.arms || [];
      var wrap = document.getElementById('ab-arms');
      if (wrap && arms.length) {
        var max = Math.max.apply(null, arms.map(function (a) { return a.rate || 0; }).concat([1]));
        wrap.innerHTML = arms.map(function (a) {
          return '<div class="ab-arm ' + (a.win ? 'win' : 'base') + '">'
            + '<div class="ab-arm-top"><span class="ab-arm-name">' + (a.win ? '<b>' + esc(a.name) + '</b>' : esc(a.name)) + '</span>'
            + '<span class="ab-arm-cvr">' + rate(a.rate) + '</span></div>'
            + '<div class="ab-track"><i style="width:0" data-w="' + Math.round((a.rate / max) * 100) + '"></i></div></div>';
        }).join('');
      }
      var foot = document.getElementById('ab-foot');
      if (foot) {
        var live = exp.status === 'live' ? 'live' : (exp.status === 'stubbed' ? 'plan · writes off' : 'live · simulated');
        foot.innerHTML = '<b>+' + (ro.liftRel || 0) + '% ' + esc((ro.metric && ro.metric.name) || 'lift') + '</b> for the treatment · ' + (ro.confidence || 96) + '% confidence'
          + '<div style="margin-top:8px;font-size:10.5px;line-height:1.5;color:#8A8170;">'
          + 'Experiment <b style="color:#B9AF9C;">' + esc(exp.experimentKey) + '</b> · flag ' + esc(exp.flagKey) + ' · ' + esc(exp.environment || '')
          + (exp.fellBack ? ' · targeted-delivery' : '') + ' · ' + live + ' · created via Opal'
          + ' · <span style="color:#6B6258;">figures representative</span></div>';
      }
      var rd = document.getElementById('ab-readout'); if (rd) rd.classList.add('show');
      try { store.scrollEngineTo('ab-readout'); } catch (e) {}
      requestAnimationFrame(function () {
        setTimeout(function () {
          document.querySelectorAll('#ab-arms .ab-track > i').forEach(function (i) { i.style.width = i.dataset.w + '%'; });
        }, 80);
      });
    };

    /* — CMAB readout backed by the REAL /experiment/cmab decision service — */
    var origCmab = (typeof store.showCmab === 'function') ? store.showCmab.bind(store) : null;
    store.showCmabLive = async function () {
      try {
        var r = await fetch('/experiment/cmab/matrix');
        var data = await r.json();
        var wrap = document.getElementById('cmab-ctx'); if (!wrap) throw new Error('no cmab-ctx');
        var rd = document.getElementById('cmab-readout'); if (rd) rd.classList.add('show');
        wrap.innerHTML = '';
        (data.contexts || []).forEach(function (c, i) {
          setTimeout(function () {
            if (rd && !rd.classList.contains('show')) return;
            var row = document.createElement('div'); row.className = 'cmab-ctx';
            row.innerHTML = '<div class="cmab-ctx-name">' + esc(c.contextLabel) + '</div>'
              + '<div class="cmab-ctx-win"><span class="cmab-win-name">' + esc(c.variationName) + '</span><span class="cmab-win-tag">Winner</span></div>'
              + '<div class="cmab-lift">' + esc(c.lift) + ' · ' + Math.round((c.confidence || 0) * 100) + '% confidence</div>';
            wrap.appendChild(row);
          }, 200 + i * 440);
        });
        try { store.scrollEngineTo('cmab-readout'); } catch (e) {}
      } catch (e) { if (origCmab) origCmab(); } // graceful fallback to the representative render
    };
    // Route beat 13 through the live CMAB service (falls back to the original if the API is unreachable).
    store.showCmab = function () { store.showCmabLive(); };

    /* — deep link: /storefront?experiment=<key>#engine opens that experiment's readout — */
    try {
      var ek = new URLSearchParams(location.search).get('experiment');
      if (ek) setTimeout(function () { try { store.setTab('engine'); } catch (e) {} store.showExperimentReadout(ek); }, 600);
    } catch (e) {}

    console.log('[ab-cmab] ready — store.launchExperiment + live CMAB readout attached');
  });
})();
