/* public/live/ops.js
 * ───────────────────────────────────────────────────────────────────────────
 * The Offer Desk (Beat 2). Four calls, no framework:
 *
 *   GET  /live/ops-api/staged          the tray + the taxonomy the selects use
 *   POST /live/ops-api/propose/:item   the tagging model runs
 *   POST /live/ops-api/approve/:item   { approvedBy, edits, rejects, window }
 *   POST /live/ops-api/reset           put the tray back for the next presenter
 *
 * The page holds NO state of its own beyond the operator's unsaved edits: chips,
 * lifecycle and window language all come from the server, which derives them
 * from the window and the clock. Refresh mid-beat and nothing is lost.
 * ─────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var API = '/live/ops-api';
  var tray = document.getElementById('tray');
  var vocab = null;
  var records = [];
  /** Unsaved operator input, keyed by item number: { edits, rejects, window }. */
  var draft = {};

  // ── plumbing ──────────────────────────────────────────────────────────────

  function api(path, options) {
    return fetch(API + path, options || {}).then(function (r) {
      return r.json().then(function (body) {
        return { status: r.status, body: body };
      });
    });
  }

  function post(path, payload) {
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function money(n) {
    return '$' + Number(n || 0).toFixed(2);
  }

  function clockText(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }

  /** Window state as language, never a counter — the ops view may say the time. */
  function windowLine(status) {
    if (!status || !status.windowStart) return '';
    return 'Window ' + clockText(status.windowStart) + ' → ' + clockText(status.windowEnd) +
      ' · lifecycle: ' + String(status.lifecycleState || '').replace(/_/g, ' ');
  }

  function draftFor(itemNumber) {
    if (!draft[itemNumber]) {
      draft[itemNumber] = { edits: {}, rejects: {}, approvedBy: 'dana.k', startInMinutes: 0, durationHours: 24 };
    }
    return draft[itemNumber];
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  var CHIP_ORDER = ['staged', 'proposed', 'approved', 'live', 'expired'];

  function chipRow(record) {
    var status = record.status || {};
    var reached = status.chip === 'queued' ? 'approved' : status.chip;
    var reachedIndex = CHIP_ORDER.indexOf(reached);
    var row = el('div', 'chips');
    CHIP_ORDER.forEach(function (name, i) {
      if (i > 0) row.appendChild(el('span', 'chip chip--sep', '›'));
      var cls = 'chip';
      if (i < reachedIndex) cls += ' chip--done';
      else if (i === reachedIndex) {
        cls += name === 'live' ? ' chip--live' : name === 'expired' ? ' chip--expired' : ' chip--now';
      }
      var label = name;
      if (name === 'approved' && status.chip === 'queued') label = 'approved · queued';
      row.appendChild(el('span', cls, label));
    });
    return row;
  }

  function confidenceCell(tag) {
    var wrap = el('div', 'conf');
    var bar = el('div', 'conf__bar');
    var fill = el('div', 'conf__fill' + (tag.confidence < 0.6 ? ' conf__fill--low' : ''));
    fill.style.width = Math.round(tag.confidence * 100) + '%';
    bar.appendChild(fill);
    wrap.appendChild(bar);
    wrap.appendChild(el('span', 'conf__num', tag.confidence.toFixed(2)));
    return wrap;
  }

  function optionsFor(key, category) {
    if (!vocab) return [];
    switch (key) {
      case 'category': return vocab.categories;
      case 'subcategory': return vocab.subcategoriesByCategory[category] || [];
      case 'brandPersonality': return vocab.brandPersonalities;
      case 'occasion': return vocab.occasions;
      case 'priceBand': return vocab.priceBands;
      case 'offerCode': return vocab.constructs.map(function (c) { return c.code; });
      default: return [];
    }
  }

  function constructLabel(code) {
    if (!vocab) return code;
    var found = vocab.constructs.filter(function (c) { return c.code === code; })[0];
    return found ? code + ' — ' + found.label : code;
  }

  function proposalTable(record) {
    var d = draftFor(record.itemNumber);
    var proposal = record.proposal;
    var table = el('table', 'tags');
    var head = el('tr');
    ['Tag', 'Proposed', 'Confidence', 'Why', 'Approve as', ''].forEach(function (h) {
      head.appendChild(el('th', null, h));
    });
    table.appendChild(head);

    var currentCategory = d.edits.category ||
      (proposal.tags.filter(function (t) { return t.key === 'category'; })[0] || {}).value;

    proposal.tags.forEach(function (tag) {
      var row = el('tr');
      if (d.rejects[tag.key]) row.className = 'rejected';

      row.appendChild(el('td', 'tagname', tag.label));

      var proposedCell = el('td');
      proposedCell.appendChild(el('div', null, tag.key === 'offerCode' ? constructLabel(tag.value) : tag.value));
      proposedCell.appendChild(el('div', 'source', tag.source === 'rule' ? 'rule · arithmetic' : 'model'));
      row.appendChild(proposedCell);

      var confCell = el('td');
      confCell.appendChild(confidenceCell(tag));
      row.appendChild(confCell);

      row.appendChild(el('td', 'rationale', tag.rationale));

      var editCell = el('td');
      var select = document.createElement('select');
      var values = optionsFor(tag.key, currentCategory);
      if (values.indexOf(tag.value) === -1) values = [tag.value].concat(values);
      values.forEach(function (v) {
        var option = document.createElement('option');
        option.value = v;
        option.textContent = tag.key === 'offerCode' ? constructLabel(v) : v;
        select.appendChild(option);
      });
      select.value = d.edits[tag.key] || tag.value;
      if (select.value !== tag.value) select.className = 'edited';
      select.disabled = !!d.rejects[tag.key] || record.state === 'approved';
      select.addEventListener('change', function () {
        if (select.value === tag.value) delete d.edits[tag.key];
        else d.edits[tag.key] = select.value;
        // Changing the category changes which subcategories are legal.
        if (tag.key === 'category') delete d.edits.subcategory;
        render();
      });
      editCell.appendChild(select);
      row.appendChild(editCell);

      var rejectCell = el('td');
      if (tag.rejectable && record.state !== 'approved') {
        var label = el('label', 'reject');
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !!d.rejects[tag.key];
        box.addEventListener('change', function () {
          if (box.checked) d.rejects[tag.key] = true;
          else delete d.rejects[tag.key];
          render();
        });
        label.appendChild(box);
        label.appendChild(el('span', null, 'reject'));
        rejectCell.appendChild(label);
      } else if (!tag.rejectable) {
        rejectCell.appendChild(el('span', 'source', 'required'));
      }
      row.appendChild(rejectCell);

      table.appendChild(row);
    });
    return table;
  }

  function windowControls(record) {
    var d = draftFor(record.itemNumber);
    var wrap = el('div', 'window');

    function selectField(labelText, value, options, onChange) {
      var field = el('div', 'field');
      var id = 'f' + Math.random().toString(36).slice(2, 8);
      var label = el('label', null, labelText);
      label.setAttribute('for', id);
      var select = document.createElement('select');
      select.id = id;
      options.forEach(function (opt) {
        var option = document.createElement('option');
        option.value = String(opt.value);
        option.textContent = opt.label;
        select.appendChild(option);
      });
      select.value = String(value);
      select.addEventListener('change', function () { onChange(Number(select.value)); });
      field.appendChild(label);
      field.appendChild(select);
      return field;
    }

    wrap.appendChild(selectField('Opens', d.startInMinutes, [
      { value: 0, label: 'Now' },
      { value: 2, label: 'In 2 minutes' },
      { value: 15, label: 'In 15 minutes' },
      { value: 60, label: 'In an hour' },
    ], function (v) { d.startInMinutes = v; }));

    wrap.appendChild(selectField('Runs for', d.durationHours, [
      { value: 0.0833, label: '5 minutes' },
      { value: 0.25, label: '15 minutes' },
      { value: 1, label: '1 hour' },
      { value: 24, label: '24 hours' },
    ], function (v) { d.durationHours = v; }));

    var who = el('div', 'field');
    var whoLabel = el('label', null, 'Approved by');
    var whoInput = document.createElement('input');
    whoInput.type = 'text';
    whoInput.value = d.approvedBy;
    whoInput.addEventListener('input', function () { d.approvedBy = whoInput.value; });
    who.appendChild(whoLabel);
    who.appendChild(whoInput);
    wrap.appendChild(who);

    var spacer = el('div');
    spacer.style.flex = '1 1 auto';
    wrap.appendChild(spacer);

    var approve = el('button', 'btn btn--primary', 'Approve and publish');
    approve.addEventListener('click', function () {
      approve.disabled = true;
      approve.textContent = 'Publishing…';
      post('/approve/' + encodeURIComponent(record.itemNumber), {
        approvedBy: d.approvedBy || 'merchandiser',
        edits: d.edits,
        rejects: Object.keys(d.rejects),
        window: { startInMinutes: d.startInMinutes, durationHours: d.durationHours },
      }).then(function (res) {
        if (!res.body.ok) {
          record.error = res.body.error || 'approval refused';
          render();
          return;
        }
        delete record.error;
        refresh();
      });
    });
    wrap.appendChild(approve);
    return wrap;
  }

  function approvedPanel(record) {
    var panel = el('div', 'approved');
    var p = record.provenance || {};
    var line = el('div');
    line.innerHTML = '<strong>Approved</strong> by ' + escapeHtml(p.approvedBy || '') +
      ' at ' + escapeHtml(clockText(p.timestamps && p.timestamps.approvedAt)) +
      ' · proposed by <code>' + escapeHtml(p.proposedBy || '') + '</code>';
    panel.appendChild(line);

    var edited = (p.editedFields || []).map(function (k) { return vocab ? vocab.tagLabels[k] : k; });
    var rejected = (p.rejectedFields || []).map(function (k) { return vocab ? vocab.tagLabels[k] : k; });
    panel.appendChild(el('div', null,
      'Edited: ' + (edited.length ? edited.join(', ') : 'none') +
      ' · Rejected: ' + (rejected.length ? rejected.join(', ') : 'none')));

    var tags = record.approvedTags || {};
    panel.appendChild(el('div', null, Object.keys(tags).map(function (k) {
      return k + ' = ' + tags[k];
    }).join(' · ')));

    panel.appendChild(el('div', null, windowLine(record.status)));

    var open = el('a', null, 'Open the storefront to watch it land →');
    open.href = '/live/';
    open.target = '_blank';
    open.rel = 'noopener';
    panel.appendChild(open);
    return panel;
  }

  function escapeHtml(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function card(record) {
    var wrap = el('section', 'card');
    var head = el('div', 'card__head');

    var titleBlock = el('div');
    titleBlock.appendChild(el('h2', 'card__title', record.staged.name));
    titleBlock.appendChild(el('div', 'card__meta',
      'Item ' + record.itemNumber + ' · ' + (record.staged.brandName || 'unknown brand') +
      ' · from the ' + (record.staged.source || 'feed').replace(/_/g, ' ')));
    head.appendChild(titleBlock);
    head.appendChild(el('div', 'card__spacer'));
    head.appendChild(el('div', 'card__price', money(record.staged.price_usd)));
    wrap.appendChild(head);

    var body = el('div', 'card__body');
    body.appendChild(chipRow(record));

    var feed = el('div', 'feedrow');
    feed.style.marginTop = '12px';
    feed.textContent =
      'name: ' + record.staged.name + '\n' +
      'price: ' + money(record.staged.price_usd) + '\n' +
      'description: ' + (record.staged.shortDescription || '(none supplied)') + '\n' +
      'category hint: ' + (record.staged.categoryHint || '(absent)');
    body.appendChild(feed);

    if (record.state === 'staged') {
      var propose = el('button', 'btn btn--secondary', 'Propose tags');
      propose.style.marginTop = '14px';
      propose.addEventListener('click', function () {
        propose.disabled = true;
        propose.textContent = 'Reading the item…';
        post('/propose/' + encodeURIComponent(record.itemNumber), {}).then(function () { refresh(); });
      });
      body.appendChild(propose);
    }

    if (record.proposal) {
      var provenanceNote = el('div', 'note note--model');
      provenanceNote.style.margin = '14px 0 8px';
      provenanceNote.textContent = record.proposal.proposedBy === 'ai'
        ? 'Proposed by ' + record.proposal.model + ' at ' + clockText(record.proposal.proposedAt)
        : 'Proposed by the deterministic fallback (no model key configured) at ' + clockText(record.proposal.proposedAt);
      body.appendChild(provenanceNote);

      if (record.proposal.hintConflict) {
        body.appendChild(el('div', 'hint-conflict',
          'The feed said "' + record.proposal.hintConflict.hint + '". The proposal says "' +
          record.proposal.hintConflict.proposed + '" — judged from the title and copy, not the hint.'));
      }
      (record.proposal.corrections || []).forEach(function (c) {
        body.appendChild(el('div', 'hint-conflict',
          'Model returned "' + c.rejectedValue + '" for ' + c.key + ', which is not on the shelf map. Using "' + c.usedValue + '".'));
      });

      body.appendChild(proposalTable(record));
      if (record.state !== 'approved') body.appendChild(windowControls(record));
    }

    if (record.state === 'approved') body.appendChild(approvedPanel(record));
    if (record.error) body.appendChild(el('div', 'err', record.error));

    wrap.appendChild(body);
    return wrap;
  }

  function render() {
    tray.innerHTML = '';
    records.forEach(function (record) { tray.appendChild(card(record)); });
  }

  // ── Beat 8: the live catalog controls ─────────────────────────────────────

  var floor = document.getElementById('floor');
  var occupants = [];
  var manualItem = '';

  function availabilityButton(row) {
    var soldOut = row.ats === 'N';
    var btn = el('button', 'btn btn--sm ' + (soldOut ? 'btn--quiet' : 'btn--secondary'),
      soldOut ? 'Restock' : 'Sell it out');
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = soldOut ? 'Restocking…' : 'Selling out…';
      var path = (soldOut ? '/restock/' : '/soldout/') + encodeURIComponent(row.itemNumber);
      post(path, { setBy: draftFor('__desk').approvedBy }).then(function () { refreshFloor(); });
    });
    return btn;
  }

  function stateChip(row) {
    var cls = row.ats === 'N' ? 'state state--out' : row.ats === 'W' ? 'state state--wait' : 'state state--in';
    var text = row.ats === 'N' ? 'sold out' : row.ats === 'W' ? 'waitlist' : 'in stock';
    return el('span', cls, text);
  }

  function renderFloor() {
    floor.innerHTML = '';
    var table = el('table', 'floor');
    var head = el('tr');
    ['Slot', 'Item', 'Offer', 'Availability', ''].forEach(function (h) { head.appendChild(el('th', null, h)); });
    table.appendChild(head);

    occupants.forEach(function (row) {
      var tr = el('tr', row.ats === 'N' ? 'out' : null);
      tr.appendChild(el('td', 'slotname', String(row.slotId).replace(/_/g, ' ')));

      var itemCell = el('td');
      itemCell.appendChild(el('div', null, row.name));
      itemCell.appendChild(el('div', 'itemno', row.itemNumber));
      tr.appendChild(itemCell);

      tr.appendChild(el('td', 'note', row.offerLabel || '—'));

      var stateCell = el('td');
      stateCell.appendChild(stateChip(row));
      if (row.override) {
        stateCell.appendChild(el('div', 'source',
          'set by ' + (row.override.setBy || 'desk') + ' at ' + clockText(row.override.setAt)));
      }
      tr.appendChild(stateCell);

      var actionCell = el('td');
      actionCell.appendChild(availabilityButton(row));
      tr.appendChild(actionCell);

      table.appendChild(tr);
    });

    if (occupants.length === 0) {
      floor.appendChild(el('p', 'muted', 'Nothing is occupying the offer slots at this instant.'));
    } else {
      floor.appendChild(table);
    }

    // Any item number, for the case where the presenter wants one that is not
    // currently occupying a slot.
    var manual = el('div', 'manual');
    var field = el('div', 'field');
    var label = el('label', null, 'Any item number');
    label.setAttribute('for', 'manual-item');
    var input = document.createElement('input');
    input.type = 'text';
    input.id = 'manual-item';
    input.placeholder = 'B412907';
    input.value = manualItem;
    input.addEventListener('input', function () { manualItem = input.value; });
    field.appendChild(label);
    field.appendChild(input);
    manual.appendChild(field);

    ['soldout', 'restock'].forEach(function (action) {
      var btn = el('button', 'btn btn--sm btn--quiet', action === 'soldout' ? 'Sell it out' : 'Restock');
      btn.addEventListener('click', function () {
        var id = (manualItem || '').trim().toUpperCase();
        if (!/^B\d{6}$/.test(id)) {
          floor.appendChild(el('div', 'err', 'An item number reads B###### — e.g. B412907.'));
          return;
        }
        post('/' + action + '/' + encodeURIComponent(id), {
          setBy: draftFor('__desk').approvedBy,
        }).then(function (res) {
          if (!res.body.ok) floor.appendChild(el('div', 'err', res.body.error || 'that did not take'));
          refreshFloor();
        });
      });
      manual.appendChild(btn);
    });
    floor.appendChild(manual);
  }

  function refreshFloor() {
    return api('/occupants').then(function (res) {
      if (!res.body || !res.body.ok) return;
      occupants = res.body.occupants || [];
      renderFloor();
    });
  }

  // ── loading ───────────────────────────────────────────────────────────────

  function applyState(body) {
    if (!body || !body.ok) return;
    if (body.vocabulary) vocab = body.vocabulary;
    var errors = {};
    records.forEach(function (r) { if (r.error) errors[r.itemNumber] = r.error; });
    records = (body.records || []).map(function (r) {
      if (errors[r.itemNumber]) r.error = errors[r.itemNumber];
      return r;
    });
    if (typeof body.nowMs === 'number') {
      document.getElementById('clock').textContent = clockText(new Date(body.nowMs).toISOString());
    }
    if (typeof body.clockMultiplier === 'number') {
      document.getElementById('clock-note').textContent =
        body.clockMultiplier === 1 ? 'demo clock ×1 — real time' : 'demo clock ×' + body.clockMultiplier;
    }
    if (typeof body.modelConfigured === 'boolean') {
      document.getElementById('model-note').textContent = body.modelConfigured
        ? 'Tagging model: configured — proposals are a live call'
        : 'Tagging model: not configured — proposals use the deterministic fallback';
    }
    render();
  }

  /** Full reload (tray + taxonomy + what is on the floor). */
  function refresh() {
    return Promise.all([
      api('/staged').then(function (res) { applyState(res.body); }),
      refreshFloor(),
    ]);
  }

  /** Cheap poll: chips and lifecycle only, so a window opening is visible. */
  function tick() {
    api('/state').then(function (res) {
      if (!res.body || !res.body.ok) return;
      var byId = {};
      (res.body.records || []).forEach(function (r) { byId[r.itemNumber] = r; });
      var changed = false;
      records.forEach(function (r) {
        var fresh = byId[r.itemNumber];
        if (!fresh) return;
        if (JSON.stringify(fresh.status) !== JSON.stringify(r.status) || fresh.state !== r.state) {
          r.status = fresh.status;
          r.state = fresh.state;
          r.provenance = fresh.provenance;
          r.approvedTags = fresh.approvedTags;
          r.proposal = fresh.proposal;
          changed = true;
        }
      });
      if (typeof res.body.nowMs === 'number') {
        document.getElementById('clock').textContent = clockText(new Date(res.body.nowMs).toISOString());
      }
      if (changed) render();
    });
    // The floor moves on its own too: a window opening or expiring changes who
    // occupies the takeover slot, and the presenter needs the CURRENT occupant.
    refreshFloor();
  }

  document.getElementById('reset').addEventListener('click', function () {
    draft = {};
    post('/reset', {}).then(function () { refresh(); });
  });

  refresh();
  setInterval(tick, 3000);
})();
