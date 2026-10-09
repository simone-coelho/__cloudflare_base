/* enablement/site/site.js
   Progressive enhancement for the enablement pages, and nothing else. Every page reads in full, and prints
   in full, without it. It stores nothing, sends nothing, loads nothing and writes no style attribute, so the
   Content-Security-Policy can allow script-src 'self' and style-src 'self' and nothing more. It is loaded
   with defer, so the page is parsed before it runs.

   1. Tabs: a [data-tabs] block whose [data-tab-panel] sections each carry one [data-tab-label] header.
      Without the script the panels read one after another. With it, each header is copied into a tab and
      one panel shows at a time. Arrow keys, Home and End move between the tabs (the credits page's
      timeline, which behaves as the shared original did: Before shows first, a tab shows its phase).
   2. A figure with data-switch="before during after": one button per part. Choosing a part brings it
      forward and fades the other two; choosing it again shows all three. On a narrow screen the figure's
      frame scrolls sideways, and the chosen part is scrolled into view.
   3. A figure frame that scrolls sideways becomes a focusable, labeled region, so a keyboard can scroll it.
   4. Before printing, every closed question opens; after printing, it closes again. */
(function () {
  'use strict';

  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var each = function (selector, fn) { Array.prototype.forEach.call(document.querySelectorAll(selector), fn); };

  /* 1. Tabs */
  function initTabs(root, n) {
    var panels = Array.prototype.slice.call(root.querySelectorAll('[data-tab-panel]'));
    if (panels.length < 2) return;
    var list = document.createElement('div');
    list.className = root.getAttribute('data-tabs-class') || 'tabs-list';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', root.getAttribute('data-tabs-label') || 'Sections');
    var tabs = panels.map(function (panel, i) {
      if (!panel.id) panel.id = 'tabs-' + n + '-panel-' + i;
      var head = panel.querySelector('[data-tab-label]');
      var tab = document.createElement('button');
      tab.type = 'button';
      tab.id = panel.id + '-tab';
      tab.className = panel.getAttribute('data-tab-class') || '';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', panel.id);
      if (head) {
        for (var c = head.firstChild; c; c = c.nextSibling) tab.appendChild(c.cloneNode(true));
        head.setAttribute('aria-hidden', 'true');
      }
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.setAttribute('tabindex', '0');
      list.appendChild(tab);
      return tab;
    });
    panels[0].parentNode.insertBefore(list, panels[0]);

    function select(i, focus) {
      tabs.forEach(function (t, j) {
        var on = i === j;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.setAttribute('tabindex', on ? '0' : '-1');
        panels[j].hidden = !on;
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(i, false); });
      t.addEventListener('keydown', function (e) {
        var vertical = window.getComputedStyle(list).flexDirection === 'column';
        var next = vertical ? 'ArrowDown' : 'ArrowRight';
        var prev = vertical ? 'ArrowUp' : 'ArrowLeft';
        var to = -1;
        if (e.key === next) to = (i + 1) % tabs.length;
        else if (e.key === prev) to = (i + tabs.length - 1) % tabs.length;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = tabs.length - 1;
        if (to >= 0) { e.preventDefault(); select(to, true); }
      });
    });
    root.classList.add('tabs-ready');
    select(0, false);
  }

  /* 2. A figure with one button per part */
  function initFigureSwitch(fig, n) {
    var parts = (fig.getAttribute('data-switch') || '').split(/\s+/).filter(Boolean);
    var frame = fig.querySelector('.figure-frame');
    var svg = frame && frame.querySelector('svg');
    if (!svg || !parts.length) return;
    if (!frame.id) frame.id = 'figure-frame-' + n;
    var names = { before: 'Before', during: 'During', after: 'After' };
    var group = document.createElement('div');
    group.className = 'figure-switch-buttons';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', fig.getAttribute('data-switch-label') || 'Bring one part of the figure forward');
    var buttons = parts.map(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = names[p] || p;
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-controls', frame.id);
      b.addEventListener('click', function () { choose(p); });
      group.appendChild(b);
      return b;
    });
    buttons.forEach(function (b, i) {
      b.addEventListener('keydown', function (e) {
        var to = -1;
        if (e.key === 'ArrowRight') to = (i + 1) % buttons.length;
        else if (e.key === 'ArrowLeft') to = (i + buttons.length - 1) % buttons.length;
        if (to >= 0) { e.preventDefault(); buttons[to].focus(); }
      });
    });

    function bringIntoView(p) {
      if (frame.scrollWidth <= frame.clientWidth + 1) return;
      var col = svg.querySelector('g[data-box~="column"][data-box~="' + p + '"]');
      if (!col) return;
      var fr = frame.getBoundingClientRect();
      var cr = col.getBoundingClientRect();
      var left = Math.max(0, frame.scrollLeft + (cr.left - fr.left) - Math.max(0, (fr.width - cr.width) / 2));
      if (typeof frame.scrollTo === 'function') frame.scrollTo({ left: left, behavior: reduced ? 'auto' : 'smooth' });
      else frame.scrollLeft = left;
    }
    function choose(p) {
      var on = fig.getAttribute('data-focus') === p ? null : p;
      if (on) fig.setAttribute('data-focus', on); else fig.removeAttribute('data-focus');
      buttons.forEach(function (b, i) { b.setAttribute('aria-pressed', parts[i] === on ? 'true' : 'false'); });
      if (on) bringIntoView(on);
    }

    var help = fig.querySelector('.figure-switch-help');
    if (help) { help.hidden = false; help.parentNode.insertBefore(group, help.nextSibling); }
    else frame.parentNode.insertBefore(group, frame);
  }

  /* 3. Frames that scroll sideways can be reached and scrolled from the keyboard */
  function markScrollable() {
    each('.figure-frame', function (f) {
      var fig = f.closest('figure');
      var cap = fig && fig.querySelector('figcaption');
      if (f.scrollWidth > f.clientWidth + 1) {
        f.setAttribute('tabindex', '0');
        f.setAttribute('role', 'region');
        f.setAttribute('aria-label', (cap ? cap.textContent.trim() + '. ' : '') + 'The figure scrolls sideways.');
      } else if (f.getAttribute('role') === 'region') {
        f.removeAttribute('tabindex');
        f.removeAttribute('role');
        f.removeAttribute('aria-label');
      }
    });
  }

  /* 4. Print every answer */
  var opened = [];
  window.addEventListener('beforeprint', function () {
    each('details:not([open])', function (d) { d.open = true; opened.push(d); });
  });
  window.addEventListener('afterprint', function () {
    opened.splice(0).forEach(function (d) { d.open = false; });
  });

  var n = 0;
  each('[data-tabs]', function (root) { initTabs(root, n++); });
  each('figure[data-switch]', function (fig) { initFigureSwitch(fig, n++); });
  markScrollable();
  var pending = false;
  window.addEventListener('resize', function () {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function () { pending = false; markScrollable(); });
  });
})();
