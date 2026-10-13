/* enablement/site/what-it-is.js
   Progressive enhancement for the marketing page, and nothing else (lane M2, LANE-BRIEF-V3 section 4.1). The page
   reads in full, and every picture shows its end state, without it. It stores nothing, sends nothing, loads nothing
   and writes no style attribute, so the Content-Security-Policy stays script-src 'self' and style-src 'self'.

   It starts each picture's CSS keyframes when the picture comes into view, so the reader sees the motion instead of
   missing it further up the page. A picture marked data-motion is set to "armed" (its start state, drawn by
   /what-it-is.css) and to "play" once at least half of it is on screen; when it has left the screen it is armed
   again, so it plays the next time it is seen. Each run lasts a few seconds and ends still. Under
   prefers-reduced-motion the stylesheet keeps every picture at its end state, and this script does nothing. */
(function () {
  'use strict';

  var pictures = document.querySelectorAll('[data-motion]');
  if (!pictures.length || typeof window.IntersectionObserver !== 'function') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var observer = new window.IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) entry.target.setAttribute('data-motion', 'play');
      else if (!entry.isIntersecting) entry.target.setAttribute('data-motion', 'armed');
    });
  }, { threshold: [0, 0.5] });

  Array.prototype.forEach.call(pictures, function (picture) {
    picture.setAttribute('data-motion', 'armed');
    observer.observe(picture);
  });
})();
