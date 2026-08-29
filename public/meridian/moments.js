// Meridian — Reflex Moments (Decision 10).
//
// Ported WHOLE from the Coach storefront (public/storefront.js: the _rmx* state,
// reactToAffinity, showReflexMoment, dockReflexMoment, expireReflexMoment) and
// re-voiced for Calder & Co. and Calder Financial. Standalone on purpose: no
// imports, and nothing touches the DOM until initMoments() is called, so the
// same file runs under a test harness with a fake clock and a fake mount.
//
// THE DISCIPLINE, exactly as Coach:
//   · one card at a time on the strip; the same story key at most once per
//     3 minutes; 6s between cards; a story that arrives while an offer holds
//     the strip is QUEUED and played in sequence, never dropped;
//   · an offer holds the strip ~20s, then DOCKS to a compact pill that keeps
//     ticking and stays claimable;
//   · an offer lasts exactly as long as the intent that earned it: the
//     white-glove countdown IS the audience's own exit time (expiryOf), an
//     offer whose backing audience exits ends early, and every ending NAMES
//     its reason — nothing here silently vanishes;
//   · non-offer cards auto-dismiss after 9s; the revert beat after 15s.
//
// ONE CLOCK. Every deadline lives on a moment clock that stops while the
// presenter is talking (pause/resume) and is advanced by a single interval —
// no scattered setTimeouts to chase. getNow is injectable for rehearsal.

export const TIMING = Object.freeze({
  cooldownMs: 180_000,     // the same story key shows at most once per 3 minutes
  holdCooldownMs: 60_000,  // the bag/rate hold is action-anchored; Coach lets it re-fire after 60s
  spacingMs: 6_000,        // global spacing between cards
  dockAfterMs: 20_000,     // an offer holds the main strip this long, then docks to the pill
  holdMs: 15 * 60_000,     // the hold's own countdown (15:00)
  ttlMs: 9_000,            // non-offer cards auto-dismiss
  revertTtlMs: 15_000,     // the ending beat stays a little longer
  endedTtlMs: 9_000,       // an expired offer's "ended" card / pill lingers, reason named
  tickMs: 250,             // the driver; the visible clock changes on the second
  nextDelayMs: 600,        // breath before the next queued story after a dismiss or dock
  queueMax: 3,             // the queue keeps the last three stories
  queueStaleMs: 90_000,    // a story older than this has lost its moment
});

/** Which engine dimension plays which role, per vertical (src/demos/meridian/reflexConfig.ts). */
export const DIMS = Object.freeze({
  retail: {
    line: 'line', band: 'priceBand', need: 'occasion', bandTop: 'premium',
    needSkip: /^(everyday|gift)$/i,          // Coach: the everyday and gift occasions do not earn a card
    all: ['category', 'line', 'priceBand', 'styleWorld', 'occasion', 'contentType', 'journeyStage'],
  },
  financial: {
    line: 'subFamily', band: 'amountBand', need: 'intent', bandTop: 'major',
    needSkip: null,
    all: ['productFamily', 'subFamily', 'amountBand', 'lifeStage', 'intent', 'contentType', 'applicationStage'],
  },
});

// The exact key core mints (src/reflex/core.ts audienceKey) — mirrored, not
// imported, so this module stays dependency-free.
const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export const audienceKeyOf = (dim, value) => `${slug(dim)}_${slug(value)}_affinity`;
export const defaultPrettyAudience = (key) => String(key).replace(/_affinity$/, '').replace(/_/g, ' · ');

// Calder Financial nouns. A shopper keeps coming back to "the Linden"; an
// applicant keeps coming back to "fixed-rate lending", not to "fixed".
const FAMILY = { fixed: 'fixed-rate lending', variable: 'variable-rate lending', revolving: 'revolving credit', deposit: 'deposit savings', managed: 'managed investing' };
const FAMILY_ADJ = { fixed: 'fixed-rate', variable: 'variable-rate', revolving: 'revolving credit', deposit: 'deposit', managed: 'managed portfolio' };
const INTENT = { borrow: 'borrow', refinance: 'refinance', save: 'save', protect: 'protect what you have', invest: 'invest' };
const family = (v) => FAMILY[slug(v)] || String(v);
const familyAdj = (v) => FAMILY_ADJ[slug(v)] || String(v);
const intent = (v) => INTENT[slug(v)] || String(v);
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const nameOf = (item, fallback) => (item && (item.name || item.title)) || fallback;
const scoreTag = (a) => (typeof a === 'number' ? ` · ${a.toFixed(2)}` : '');

/**
 * The stories, per vertical. Each builder returns
 *   { key, kind, badge, eyebrow, title, body, cta, countdownMs?, expiryKey?, dockLabel?, expiredReason?, ttlMs?, cooldownMs?, ending? }
 * `key` is what the cooldown map remembers. An offer is anything with a
 * countdownMs (a fixed hold) or an expiryKey (its life = that audience's life).
 */
export const STORIES = Object.freeze({
  retail: {
    hold: ({ item }) => ({
      key: 'hold', kind: 'hold', cooldownMs: TIMING.holdCooldownMs,
      badge: 'White glove', eyebrow: 'Reserved for you',
      title: 'We’re holding your bag',
      body: `${nameOf(item, 'Your selection')} is set aside, with complimentary express delivery if you complete within`,
      countdownMs: TIMING.holdMs, dockLabel: 'Holding your bag',
      expiredReason: 'The hold released — your bag returned to the shelf.',
      cta: 'View your bag',
    }),
    whiteglove: ({ c, pretty }) => ({
      key: c.key, kind: 'whiteglove', expiryKey: c,
      badge: 'White glove', eyebrow: `Premium affinity · decided live${scoreTag(c.a)}`,
      title: 'Complimentary monogramming — on us',
      body: 'You have an eye for our finest. Monogramming and express delivery are on the house if you order within',
      dockLabel: 'Monogramming on us',
      expiredReason: `You drifted out of ${pretty(c.key)} — the offer retired with it.`,
      cta: 'Explore the Premium edit',
    }),
    curated: ({ c, pretty }) => ({
      key: c.key, kind: 'curated',
      badge: 'Decided live', eyebrow: `You entered ${pretty(c.key)}${scoreTag(c.a)}`,
      title: `You keep coming back to the ${c.value}`,
      body: 'So we re-centred your edit on it — the pieces you’ve been circling, and the ones that finish them.',
      cta: `See your ${c.value} edit`,
    }),
    shift: ({ c, old }) => ({
      key: 'shift_' + c.key, kind: 'shift',
      badge: 'Live', eyebrow: `Affinity shift · decided live${scoreTag(c.a)}`,
      title: `Your taste is shifting — ${c.value} is taking over`,
      body: `${old.value} is fading as ${c.value} rises. The edit re-centred in real time.`,
      cta: `See the ${c.value} edit`,
    }),
    occasion: ({ c }) => ({
      key: c.key, kind: 'occasion',
      badge: 'Decided live', eyebrow: `Occasion affinity${scoreTag(c.a)}`,
      title: `Styling for ${c.value}?`,
      body: `Your edit now leans ${c.value} — we pulled the pieces that finish that look forward.`,
      cta: `See the ${c.value} edit`,
    }),
    revert: () => ({
      key: 'revert', kind: 'revert', ending: true, ttlMs: TIMING.revertTtlMs,
      badge: 'Faded', eyebrow: 'Affinity decayed',
      title: 'Your session affinity faded below the line',
      body: 'so the edit returned to neutral. Browse anything — it will follow you again.',
    }),
  },
  financial: {
    hold: ({ item }) => ({
      key: 'hold', kind: 'hold', cooldownMs: TIMING.holdCooldownMs,
      badge: 'Rate lock', eyebrow: 'Reserved for you',
      title: 'We’re holding your rate',
      body: `${nameOf(item, 'Your application')} is locked at today’s rate if you complete within`,
      countdownMs: TIMING.holdMs, dockLabel: 'Holding your rate',
      expiredReason: 'The rate lock released — today’s rate is no longer held.',
      cta: 'Continue your application',
    }),
    whiteglove: ({ c, pretty }) => ({
      key: c.key, kind: 'whiteglove', expiryKey: c,
      badge: 'Named adviser', eyebrow: `Major affinity · decided live${scoreTag(c.a)}`,
      title: 'A named adviser on this application',
      body: 'Someone who has read what you have been comparing, on the line before you submit — if you start within',
      dockLabel: 'Adviser on the line',
      expiredReason: `You drifted out of ${pretty(c.key)} — the offer retired with it.`,
      cta: 'Meet your adviser',
    }),
    curated: ({ c, pretty }) => ({
      key: c.key, kind: 'curated',
      badge: 'Decided live', eyebrow: `You entered ${pretty(c.key)}${scoreTag(c.a)}`,
      title: `You keep coming back to ${family(c.value)}`,
      body: 'So we re-centred the page on it — the products you have been comparing, and the ones that complete them.',
      cta: `See your ${familyAdj(c.value)} options`,
    }),
    shift: ({ c, old }) => ({
      key: 'shift_' + c.key, kind: 'shift',
      badge: 'Live', eyebrow: `Affinity shift · decided live${scoreTag(c.a)}`,
      title: `Your priorities are shifting — ${family(c.value)} is taking over`,
      body: `${capFirst(family(old.value))} is fading as ${family(c.value)} rises. The page re-centred in real time.`,
      cta: `See the ${familyAdj(c.value)} options`,
    }),
    occasion: ({ c }) => ({
      key: c.key, kind: 'occasion',
      badge: 'Decided live', eyebrow: `Intent affinity${scoreTag(c.a)}`,
      title: `Planning to ${intent(c.value)}?`,
      body: `Your page now leans ${c.value} — we pulled the products that get that done forward.`,
      cta: `See the ${c.value} options`,
    }),
    revert: () => ({
      key: 'revert', kind: 'revert', ending: true, ttlMs: TIMING.revertTtlMs,
      badge: 'Faded', eyebrow: 'Affinity decayed',
      title: 'Your session affinity faded below the line',
      body: 'so the page returned to neutral. Browse anything — it will follow you again.',
    }),
  },
});

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const scoreOf = (dims, dim, value) => {
  const v = dims && dims[dim] && dims[dim][value];
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') { const a = v.a ?? v.s ?? v.score; return typeof a === 'number' ? a : null; }
  return null;
};

/**
 * initMoments({ mount, vertical, getNow, expiryOf, prettyAudience, onCta })
 *   mount          the #moments element above the hero (or a selector); null runs headless
 *   vertical       'retail' | 'financial'
 *   getNow         () => wall-clock ms (default Date.now)
 *   expiryOf       (audienceKey, { dim, value }) => wall-clock ms the audience will lapse, or null
 *   prettyAudience (audienceKey) => display name
 *   onCta          (kind, story) => void — 'hold' | 'whiteglove' | 'curated' | 'shift' | 'occasion'
 */
export function initMoments(opts = {}) {
  const getNow = typeof opts.getNow === 'function' ? opts.getNow : () => Date.now();
  const pretty = typeof opts.prettyAudience === 'function' ? opts.prettyAudience : defaultPrettyAudience;
  const onCta = typeof opts.onCta === 'function' ? opts.onCta : () => {};
  const expiryOf = typeof opts.expiryOf === 'function' ? opts.expiryOf : null;
  let vertical = opts.vertical === 'financial' ? 'financial' : 'retail';

  const st = {
    cooldowns: Object.create(null),  // story key → moment-clock ts last shown
    lastAt: -Infinity,               // moment-clock ts of the last card
    queue: [],                       // [{ story, at }] — stories waiting their turn
    card: null,                      // { story, ending, reason, dismissAt } — what the strip shows
    offer: null,                     // { story, key, backed, expiryKey, end, total, docked, dockAt, ending, reason, endingUntil }
    nextAt: null,                    // moment-clock ts to try the queue
    paused: false, pausedAt: 0, pausedTotal: 0,
    members: new Set(),              // audiences currently held, from the diffs we were given
    known: new Map(),                // audience key → { dim, value, a } once resolved
  };

  // ── The moment clock ─────────────────────────────────────────────────────
  const clock = () => (st.paused ? st.pausedAt : getNow()) - st.pausedTotal;
  const wallToClock = (w) => clock() + (w - getNow());

  // ── Mount ────────────────────────────────────────────────────────────────
  let mount = opts.mount || null;
  if (typeof mount === 'string' && typeof document !== 'undefined') mount = document.querySelector(mount);
  let rows = null;
  const onClick = (e) => {
    const t = e && e.target;
    const el = t && typeof t.closest === 'function' ? t.closest('[data-act]') : null;
    if (!el) return;
    const act = el.getAttribute ? el.getAttribute('data-act') : (el.dataset && el.dataset.act);
    if (act === 'cta') api.cta();
    else if (act === 'dismiss') api.dismiss();
    else if (act === 'dismiss-dock') api.dismissDock();
    else if (act === 'dock-cta') api.claimDock();
  };
  if (mount) {
    if (mount.classList) mount.classList.add('mmt-host');
    mount.innerHTML = '<div class="mmt-dock-row" data-mmt="dockrow"></div><div class="mmt-card-row" data-mmt="cardrow"></div>';
    rows = { dock: mount.querySelector('[data-mmt="dockrow"]'), card: mount.querySelector('[data-mmt="cardrow"]') };
    if (typeof mount.addEventListener === 'function') mount.addEventListener('click', onClick);
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  const syncHidden = () => {
    if (!mount) return;
    mount.hidden = !(st.card || (st.offer && st.offer.docked));
    if (mount.dataset) mount.dataset.paused = st.paused ? '1' : '';
  };
  function renderCard() {
    if (!rows) return;
    const c = st.card;
    if (!c) { rows.card.innerHTML = ''; syncHidden(); return; }
    const m = c.story;
    const kind = c.ending ? 'ending' : m.kind;
    const live = !c.ending && !!st.offer && st.offer.story === m && !st.offer.docked;
    rows.card.innerHTML =
      `<div class="mmt" data-kind="${esc(kind)}" data-key="${esc(m.key || '')}" role="status" aria-live="polite">` +
        '<div class="mmt-strip">' +
          `<span class="mmt-badge">${esc(c.ending ? 'Ended' : (m.badge || 'Live'))}</span>` +
          '<div class="mmt-text">' +
            (m.eyebrow && !c.ending ? `<div class="mmt-eyebrow">${esc(m.eyebrow)}</div>` : '') +
            `<div class="mmt-title">${esc(c.ending ? c.reason : m.title)}</div>` +
            (m.body && !c.ending ? `<div class="mmt-body">${esc(m.body)}</div>` : '') +
          '</div>' +
          (live ? '<span class="mmt-count" data-mmt="count"></span>' : '') +
          (m.cta && !c.ending ? `<button class="mmt-cta" type="button" data-act="cta">${esc(m.cta)}</button>` : '') +
          '<button class="mmt-x" type="button" data-act="dismiss" aria-label="Dismiss">&times;</button>' +
        '</div>' +
        (live ? '<div class="mmt-bar"><span data-mmt="bar"></span></div>' : '') +
      '</div>';
    syncHidden();
  }
  function renderDock() {
    if (!rows) return;
    const o = st.offer;
    if (!o || !o.docked) { rows.dock.innerHTML = ''; syncHidden(); return; }
    rows.dock.innerHTML = o.ending
      ? '<div class="mmt-dock" data-state="ending" role="status" aria-live="polite">' +
          `<span class="mmt-dock-label">${esc(o.reason)}</span>` +
          '<button class="mmt-x" type="button" data-act="dismiss-dock" aria-label="Dismiss">&times;</button>' +
        '</div>'
      : '<div class="mmt-dock" data-state="live" role="status" aria-live="polite">' +
          `<button class="mmt-dock-label" type="button" data-act="dock-cta" title="${esc(o.story.cta || '')}">${esc(o.story.dockLabel || o.story.title)}</button>` +
          '<span class="mmt-dock-count" data-mmt="dock-count"></span>' +
          '<button class="mmt-x" type="button" data-act="dismiss-dock" aria-label="Dismiss">&times;</button>' +
        '</div>';
    syncHidden();
  }
  function paintClock() {
    const o = st.offer;
    if (!o || o.ending || !rows) return;
    const left = o.end - clock();
    const t = fmt(left);
    if (!o.docked) {
      const c = rows.card.querySelector('[data-mmt="count"]');
      if (c && c.textContent !== t) c.textContent = t;
      const b = rows.card.querySelector('[data-mmt="bar"]');
      if (b && b.style) b.style.width = Math.max(0, Math.min(100, (left / o.total) * 100)) + '%';
    } else {
      const dc = rows.dock.querySelector('[data-mmt="dock-count"]');
      if (dc && dc.textContent !== t) dc.textContent = t;
    }
  }

  // ── Resolving audience keys ──────────────────────────────────────────────
  // The snapshot's own dims are the authority (they carry the raw value, e.g.
  // "Linden"); a key we resolved once is remembered so its exit still reads
  // well after the value has decayed out; the key's shape is the fallback.
  function resolve(key, snapshot) {
    const dims = (snapshot && (snapshot.dims || (snapshot.state && snapshot.state.dims))) || null;
    if (st.known.has(key)) {
      const k = st.known.get(key);
      const a = scoreOf(dims, k.dim, k.value);
      return { key, dim: k.dim, value: k.value, a: a == null ? k.a : a };
    }
    if (dims) {
      for (const dim of Object.keys(dims)) {
        for (const value of Object.keys(dims[dim] || {})) {
          if (audienceKeyOf(dim, value) !== key) continue;
          const rec = { key, dim, value, a: scoreOf(dims, dim, value) };
          st.known.set(key, rec);
          return rec;
        }
      }
    }
    const m = /^(.*)_affinity$/.exec(String(key));
    if (m) {
      for (const dim of DIMS[vertical].all) {
        const p = slug(dim) + '_';
        if (!m[1].startsWith(p)) continue;
        const raw = m[1].slice(p.length).replace(/_/g, ' ');
        return { key, dim, value: dim === 'line' ? capFirst(raw) : raw, a: null };
      }
    }
    return { key, dim: null, value: null, a: null };
  }
  const expiryWall = (c) => (expiryOf ? expiryOf(c.key, { dim: c.dim, value: c.value }) : null);

  // ── The discipline ───────────────────────────────────────────────────────
  const offerOwnsStrip = () => !!(st.offer && !st.offer.docked && !st.offer.ending);
  const offerLive = () => !!(st.offer && !st.offer.ending);

  function enqueue(m) {
    st.queue.push({ story: m, at: clock() });
    if (st.queue.length > TIMING.queueMax) st.queue = st.queue.slice(-TIMING.queueMax);
  }
  function killOffer() { st.offer = null; renderDock(); }

  /** Returns 'shown' | 'queued' | 'cooldown' | 'no-expiry'. */
  function show(m, fromQueue = false) {
    const now = clock();
    const isOffer = !!(m.countdownMs || m.expiryKey);
    // While an offer holds the MAIN strip (before it docks), arriving stories WAIT.
    if (offerOwnsStrip() && !isOffer) { enqueue(m); return 'queued'; }
    if (m.key && now - (st.cooldowns[m.key] ?? -Infinity) < (m.cooldownMs ?? TIMING.cooldownMs)) return 'cooldown';
    if (!fromQueue && now - st.lastAt < TIMING.spacingMs && !isOffer && !m.ending) { enqueue(m); return 'queued'; }
    // An offer needs an honest end before it may claim anything.
    let end = null, total = null;
    if (isOffer) {
      if (m.expiryKey && expiryOf) {
        const w = expiryWall(m.expiryKey);
        if (!w || w <= getNow()) return 'no-expiry';      // the intent that would earn it is already gone
        end = wallToClock(w);
      } else {
        end = now + (m.countdownMs || TIMING.holdMs);
      }
      total = Math.max(1, end - now);
    }
    if (m.key) st.cooldowns[m.key] = now;
    st.lastAt = now;
    st.nextAt = null;
    if (isOffer) killOffer();                              // a NEW offer replaces any live offer (Coach)
    st.card = { story: m, ending: false, reason: null, dismissAt: isOffer ? null : now + (m.ttlMs || TIMING.ttlMs) };
    if (isOffer) {
      st.offer = {
        story: m, key: m.key || null, backed: !!m.expiryKey, expiryKey: m.expiryKey || null,
        end, total, docked: false, dockAt: now + TIMING.dockAfterMs, ending: false, reason: null, endingUntil: null,
      };
    }
    renderCard(); renderDock(); paintClock();
    return 'shown';
  }

  /** Shrink the live offer to the pill — visible, honest, still expiring — and free the strip. */
  function dock() {
    const o = st.offer;
    if (!o || o.docked || o.ending) return;
    o.docked = true;
    if (st.card && st.card.story === o.story) st.card = null;
    renderCard(); renderDock(); paintClock();
    st.nextAt = clock() + TIMING.nextDelayMs;
  }

  /** The prominent ENDING: amber, the reason named. Offers never silently vanish. */
  function expire(reason) {
    const o = st.offer;
    if (!o || o.ending) return;
    const r = reason || o.story.expiredReason || 'The window closed — offers here are real, so they end.';
    const now = clock();
    if (o.docked) {
      o.ending = true; o.reason = r; o.endingUntil = now + TIMING.endedTtlMs;
      renderDock();
      return;
    }
    st.offer = null;
    if (st.card && st.card.story === o.story) {
      st.card = { story: o.story, ending: true, reason: r, dismissAt: now + TIMING.endedTtlMs };
      renderCard(); renderDock();
    } else {
      renderDock();
      st.nextAt = now;
    }
  }

  function dismiss() {
    if (!st.card) return;
    st.card = null;
    // The strip held the offer (if any) — dismissing kills it. A DOCKED offer survives.
    if (st.offer && !st.offer.docked) st.offer = null;
    renderCard(); renderDock();
    st.nextAt = clock() + TIMING.nextDelayMs;
  }
  function dismissDock() {
    if (!st.offer || !st.offer.docked) return;
    st.offer = null;
    renderDock();
  }
  function showNext() {
    if (st.card || offerOwnsStrip()) return;
    const now = clock();
    while (st.queue.length) {
      const q = st.queue.shift();
      if (now - q.at > TIMING.queueStaleMs) continue;     // stale story
      if (show(q.story, true) === 'shown') return;
    }
  }

  // The single driver. Deadlines are compared against the moment clock, so a
  // pause freezes every one of them at once.
  function tick() {
    if (st.paused) return;
    const now = clock();
    const o = st.offer;
    if (o) {
      if (o.ending) { if (now >= o.endingUntil) dismissDock(); }
      else if (o.end - now <= 0) expire(o.story.expiredReason);
      else { if (!o.docked && now >= o.dockAt) dock(); paintClock(); }
    }
    if (st.card && st.card.dismissAt != null && now >= st.card.dismissAt) dismiss();
    if (st.nextAt != null && now >= st.nextAt) { st.nextAt = null; showNext(); }
    else if (st.nextAt == null && st.queue.length && !st.card && !offerOwnsStrip() && now - st.lastAt >= TIMING.spacingMs) showNext();
  }
  const timer = setInterval(tick, TIMING.tickMs);
  if (timer && typeof timer.unref === 'function') timer.unref();

  // ── Stories from the audience diffs ──────────────────────────────────────
  function audienceChange({ entered = [], exited = [], snapshot = null } = {}) {
    const D = DIMS[vertical];
    const ent = entered.map((k) => resolve(k, snapshot));
    const ext = exited.map((k) => resolve(k, snapshot));
    entered.forEach((k) => st.members.add(k));
    exited.forEach((k) => st.members.delete(k));

    // The audience backing the ACTIVE offer decayed out → end it honestly, naming why.
    const o = st.offer;
    if (o && !o.ending && o.key && exited.includes(o.key)) {
      expire(`You drifted out of ${pretty(o.key)} — the offer retired with it.`);
    } else if (o && !o.ending && o.backed && expiryOf) {
      // Re-sync to the audience's true exit: a fresh touch extends it, a pause
      // left the strip behind it. The offer lasts exactly as long as the intent.
      const w = expiryWall(o.expiryKey);
      if (w) {
        const e = wallToClock(w);
        if (Math.abs(e - o.end) > 500) { o.end = e; o.total = Math.max(o.total, e - clock()); paintClock(); }
      }
    }

    const lineIn = ent.find((c) => c.dim === D.line);
    const lineOut = ext.find((c) => c.dim === D.line);
    const needIn = ent.find((c) => c.dim === D.need && !(D.needSkip && D.needSkip.test(c.value)));
    const bandIn = ent.find((c) => c.dim === D.band && slug(c.value) === D.bandTop);
    const S = STORIES[vertical];

    // EVERY story this change earned, in priority order — the winner shows now,
    // the rest queue and play in sequence instead of being silently dropped.
    const cands = [];
    if (lineIn && lineOut && lineOut.value !== lineIn.value) cands.push(S.shift({ c: lineIn, old: lineOut, pretty }));
    else if (lineIn) cands.push(S.curated({ c: lineIn, pretty }));
    if (bandIn) cands.push(S.whiteglove({ c: bandIn, pretty }));
    if (needIn) cands.push(S.occasion({ c: needIn, pretty }));
    if (cands.length) {
      show(cands[0]);
      for (const m of cands.slice(1)) enqueue(m);
      return;
    }
    // Everything faded: the ending beat, with the reason named.
    if (lineOut) {
      const live = snapshot && Array.isArray(snapshot.audiences) ? snapshot.audiences : [...st.members];
      const anyLineLeft = live.some((k) => resolve(k, snapshot).dim === D.line);
      if (!anyLineLeft) { st.queue = []; show(S.revert()); }
    }
  }

  // ── Public surface ───────────────────────────────────────────────────────
  const api = {
    audienceChange,
    /** The action-anchored hold: fired on a confirmed add-to-bag / application start. */
    addToBag(item) { return show(STORIES[vertical].hold({ item })); },
    /** Any story through the same discipline (an Opal-written moment, say). */
    show(story) { return show(story); },
    expire(reason) { expire(reason); },
    dismiss() { dismiss(); },
    dismissDock() { dismissDock(); },
    cta() {
      const m = st.card && !st.card.ending ? st.card.story : null;
      dismiss();
      if (m) { try { onCta(m.kind, m); } catch (e) { /* the page's problem, not the strip's */ } }
    },
    claimDock() {
      const o = st.offer;
      if (!o || o.ending || !o.docked) return;
      try { onCta(o.story.kind, o.story); } catch (e) { /* as above */ }
    },
    setVertical(v) {
      const next = v === 'financial' ? 'financial' : 'retail';
      if (next === vertical) return;
      vertical = next;
      api.reset();                                          // a retail hold means nothing to an applicant
    },
    reset() {
      st.cooldowns = Object.create(null); st.lastAt = -Infinity; st.queue = [];
      st.card = null; st.offer = null; st.nextAt = null;
      st.members = new Set(); st.known = new Map();
      renderCard(); renderDock();
    },
    /** The presenter is talking: nothing advances, nothing expires, nothing docks. */
    pause() { if (st.paused) return; st.paused = true; st.pausedAt = getNow(); syncHidden(); },
    resume() {
      if (!st.paused) return;
      st.pausedTotal += getNow() - st.pausedAt;
      st.paused = false; st.pausedAt = 0;
      syncHidden(); tick();
    },
    /** Advance the scheduler by hand (the module does this itself every tickMs). */
    tick() { tick(); },
    state() {
      const now = clock();
      const c = st.card, o = st.offer;
      return {
        vertical, paused: st.paused, clock: now,
        card: c ? { key: c.story.key, kind: c.ending ? 'ending' : c.story.kind, title: c.ending ? c.reason : c.story.title,
                    dismissIn: c.dismissAt == null ? null : c.dismissAt - now } : null,
        offer: o ? { key: o.key, kind: o.story.kind, docked: o.docked, ending: o.ending, reason: o.reason,
                     left: o.ending ? 0 : o.end - now, clock: o.ending ? null : fmt(o.end - now),
                     dockIn: o.docked ? null : o.dockAt - now } : null,
        queue: st.queue.map((q) => q.story.key),
        cooldowns: { ...st.cooldowns },
        members: [...st.members],
      };
    },
    get vertical() { return vertical; },
    get mount() { return mount; },
    destroy() {
      clearInterval(timer);
      if (mount && typeof mount.removeEventListener === 'function') mount.removeEventListener('click', onClick);
      st.card = null; st.offer = null; st.queue = [];
      if (mount) { mount.innerHTML = ''; mount.hidden = true; }
    },
  };
  return api;
}

export default initMoments;
