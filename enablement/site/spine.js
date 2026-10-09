/* enablement/site/spine.js
   Progressive enhancement for the shared spine, and nothing else: it replays the spine's CSS animations. Lane S1,
   LANE-BRIEF-V3 section 3. The spine reads in full, and its motion runs once, without this script; the end state is
   the stylesheet's base style. It loads nothing, stores nothing, sends nothing, writes no HTML and no style
   attribute: it only adds and removes class names and the hidden attribute.

   1. "Play again": the watch-it loop's control is in the page hidden; the script shows it, unless the reader asks
      for reduced motion, and restarts the loop when it is pressed.
   2. First view: an animated picture that is out of view when the page loads is held at its start, and plays the
      first time half of it comes into view, so the reader who scrolls to it sees it move. */
(function () {
  'use strict';

  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var still = function () { return Boolean(reduce && reduce.matches); };
  var each = function (selector, fn) { Array.prototype.forEach.call(document.querySelectorAll(selector), fn); };

  // Restart every CSS animation under el: take the class that runs them away, let the browser see it gone, put it back.
  function replay(el) {
    el.classList.remove('spine-wait');
    el.classList.remove('spine-play');
    void el.getBoundingClientRect();
    el.classList.add('spine-play');
  }

  /* 1. Play again */
  each('.spine-watch', function (block) {
    var loop = block.querySelector('.spine-loop');
    var button = block.querySelector('.spine-replay');
    if (!loop || !button) return;
    var sync = function () { button.hidden = still(); };
    sync();
    if (reduce && typeof reduce.addEventListener === 'function') reduce.addEventListener('change', sync);
    button.addEventListener('click', function () { replay(loop); });
  });

  /* 2. First view */
  if (!('IntersectionObserver' in window)) return;
  var watcher = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      watcher.unobserve(entry.target);
      if (!still()) replay(entry.target);
    });
  }, { threshold: 0.5 });
  each('.spine .spine-play', function (el) {
    var box = el.getBoundingClientRect();
    var height = window.innerHeight || document.documentElement.clientHeight;
    if (box.top >= height || box.bottom <= 0) {
      el.classList.add('spine-wait');
      watcher.observe(el);
    }
  });
})();
