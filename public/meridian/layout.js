// public/meridian/layout.js
// ─────────────────────────────────────────────────────────────────────────────
// paintLayout(order) — the page's sections re-ordered on screen, with the travel
// witnessed. A standalone ES module: it imports nothing, and meridian.js takes
// only this one function from it.
//
// The engine decides the order (composeLayout, in engine.bundle.js). This only
// moves DOM nodes and animates the move — FLIP: measure every visible section
// before, re-order, measure after, translate each moved section back to where
// it was with no transition, then release it next frame so it slides into
// place. A section climbing from third to first is the beat; it has to be
// seen, not inferred from a receipt.
//
// CONTRACT FOR THE INTEGRATOR (meridian.js):
//   • Mark each re-orderable region:  <section data-section="hero">, and give
//     the row's section data-section="row" (the id in composeLayout's order),
//     so the DOM speaks the engine's names. Ids in `order` with no matching
//     section are ignored; sections `order` does not name keep their place,
//     ahead of the ordered ones.
//   • A non-section sibling that belongs with a section — the row's heading
//     div — must say so: <div class="row-head" data-follows="row">. It is moved
//     and animated together with that section. Any other non-section child of
//     .page-inner is left where it is, which puts it ahead of anything moved.
//   • Call paintLayout AFTER paintRow, and after checkOffer has toggled the
//     offer's visibility, so before/after rects are measured on the frame's
//     final content.
//   • On a frame where the row's section moved, SKIP the card FLIP inside the
//     row: the section's translation is added to every card's delta and the
//     cards would fly twice the distance. Read the row's decision from
//     composeLayout (rank !== prevRank) before calling paintRow.
//   • Sections with the `hidden` attribute or display:none are placed in order
//     but neither measured, animated nor reported.
//   • Honours prefers-reduced-motion: the re-order still happens, nothing slides.
//
// Returns [{ section, from, to }] for the visible sections whose position in
// the section sequence changed — from/to are 0-based indices among
// `.page-inner > section[data-section]` in DOM order, hidden ones included,
// which is the rank vocabulary composeLayout uses.
// ─────────────────────────────────────────────────────────────────────────────

const SELECTOR = ':scope > section[data-section]';
// meridian.css --ease, written out: a custom property that is not defined on the
// element's ancestors would void the whole transition rather than fall back.
const DEFAULT_EASING = 'cubic-bezier(.33,0,.2,1)';

const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
const companionsOf = (host, id) =>
  [...host.querySelectorAll(`:scope > [data-follows="${CSS.escape(id)}"]`)];

/**
 * @param {string[]} order   section ids, top to bottom — composeLayout().order
 * @param {{ duration?: number, easing?: string, root?: Element }} [opts]
 * @returns {Array<{ section: string, from: number, to: number }>} the visible sections that changed rank
 */
export function paintLayout(order, { duration = 700, easing = DEFAULT_EASING, root, stagger = 0 } = {}) {
  const host = root ?? document.querySelector('.page-inner');
  if (!host || !Array.isArray(order)) return [];
  const sections = [...host.querySelectorAll(SELECTOR)];
  if (!sections.length) return [];

  const byId = new Map(sections.map((el) => [el.dataset.section, el]));
  const current = sections.map((el) => el.dataset.section);
  const named = [...new Set(order)].filter((id) => byId.has(id));
  const target = [...current.filter((id) => !named.includes(id)), ...named];
  // Already in this order: touch no node. Re-inserting a node restarts its
  // animations and drops focus, and there is nothing here to witness.
  if (target.every((id, i) => id === current[i])) return [];

  // 1. Measure before. Companions ride with their section.
  const tracked = [];
  for (const el of sections) {
    if (!isVisible(el)) continue;
    tracked.push(el);
    for (const c of companionsOf(host, el.dataset.section)) if (isVisible(c)) tracked.push(c);
  }
  const before = new Map(tracked.map((el) => [el, el.getBoundingClientRect()]));

  // 2. Re-order from the first rank that differs; sections above it stay put.
  let k = 0;
  while (k < target.length && target[k] === current[k]) k += 1;
  for (const id of target.slice(k)) {
    for (const c of companionsOf(host, id)) host.appendChild(c);
    host.appendChild(byId.get(id));
  }

  // 3. What moved — IN THE POSITIONS THE ROOM COUNTS. The grammar's array holds
  //    sections the page is not rendering (the offer before she decides, the
  //    takeover), so array indices and what a person sees drift apart: a row
  //    that visibly went third to second reported "was 5, now 3". Positions are
  //    computed over the VISIBLE sections, in both directions.
  // A companion (the second story, the row's heading) is its own block on the
  // page even though the grammar moves it with its section — so it counts in
  // the positions the room reads, or the numbers skip and nothing lines up.
  const seen = new Map(sections.map((el) => [el.dataset.section, isVisible(el)]));
  // A HEADING IS NOT A BLOCK. Only companions that are content in their own
  // right count — the second story does, the row's title line does not — and
  // this must match paintPositions() in meridian.js exactly, or a badge says
  // "now 4" over a chip that says 3.
  const counts = (el) => isVisible(el) && !el.classList.contains('row-head');
  const withCompanions = (ids) => ids.flatMap((id) => (seen.get(id)
    ? [id, ...companionsOf(host, id).filter(counts).map((c) => c.id || `${id}__c`)] : []));
  const visBefore = withCompanions(current);
  const visAfter = withCompanions(target);
  const moves = [];
  for (const id of current) {
    if (!seen.get(id)) continue;
    const from = visBefore.indexOf(id), to = visAfter.indexOf(id);
    if (to !== from) moves.push({ section: id, from, to });
  }

  // 4. FLIP the pixels, unless the viewer asked for no motion.
  // NOT DECORATION — THE POINT. Watching each section travel is how the room
  // reads what the engine did, so this one animation runs even when the
  // machine asks for reduced motion. (It cost us the whole effect: on a laptop
  // with animations off the page simply snapped, which is exactly what it was
  // reported as.) Everything else on the page still honours the preference.
  if (duration > 0) {
    const flying = [];
    for (const el of tracked) {
      const b = before.get(el);
      const a = el.getBoundingClientRect();
      const dx = b.left - a.left;
      const dy = b.top - a.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      // Sit it back where it came from, with no transition...
      // A CSS ANIMATION BEATS AN INLINE TRANSFORM. Re-inserting a node to
      // reorder it RESTARTS its animations, so a section with an entry
      // animation that touches transform (the offer's offerIn) replayed its
      // entry and threw the travel away — it snapped while its neighbours
      // slid. Animations stand down for the length of the flight.
      el.classList.add('flipping');
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      flying.push(el);
    }
    if (flying.length) {
      // ...and release it two frames on: the first commits the inverted
      // transform, the second lets the transition see a change.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        // CHOREOGRAPHED when asked: one section at a time, top of the new order
        // first, so the room can follow each move — with the "slowed for the
        // room" honesty carried by the caller.
        const ordered = stagger ? [...flying].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top) : flying;
        ordered.forEach((el, i) => release(el, duration, easing, stagger ? i * stagger : 0));
      }));
    }
  }
  return moves;
}

function release(el, duration, easing, delay = 0) {
  let timer;
  function cleanup() {
    clearTimeout(timer);
    el.removeEventListener('transitionend', done);
    el.classList.remove('flipping');
    el.style.transition = '';
    el.style.transform = '';
  }
  // FILTER THE EVENT. transitionend bubbles: a photograph inside the section
  // finishing its own opacity fade would otherwise end this travel early —
  // the row's card FLIP learned that the hard way.
  function done(e) {
    if (e.target === el && e.propertyName === 'transform') cleanup();
  }
  el.addEventListener('transitionend', done);
  // A section hidden mid-flight fires no transitionend; never leave a stale transform behind.
  timer = setTimeout(cleanup, duration + delay + 150);
  el.style.transition = `transform ${duration}ms ${easing} ${delay}ms`;
  el.style.transform = '';
}
