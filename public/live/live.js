/* ============================================================================
 * THE BRIGHT HOUR — storefront runtime
 * Design law: docs/qvc/QVC-Site-Recon-Demo-Design.md — B1 (tokens), A6
 * (availability vocabulary + the no-urgency-theater doctrine), A9 (design
 * language + accessibility), A10 (card template order), A15 (must-haves),
 * C4 (the beats), D2/D3 (assets in code + copy voice), and the DO NOT USE list.
 *
 * ISOLATION CONTRACT (non-negotiable)
 *   · own visitor namespace: bh_visitor_id / bh_session_id / bh_pdfs / bh_*
 *   · EVERY fetch and socket is credentials:'omit' — no other demo's session
 *     cookie may travel with a Bright Hour request
 *   · "New Viewer" clears only bh_* keys
 *   · opt_* keys are never read and never written
 *
 * SERVER CONTRACT this file codes against (sibling agent owns the server):
 *   POST /live/api/page  {visitorId, page:'home'} →
 *     { page, epochMs, demoClock:{multiplier}, decisions:[
 *         { slot_id, order, item,
 *           offer:{code,label,type,lifecycleState,windowLanguage},
 *           explain:{gates_passed,gates_failed,pinned,quota_reserved,
 *                    dimension_scores,rank_score,rank_position,tie_break_hash,
 *                    config_version},
 *           decision_id } ],
 *       nextTransitionAt, affinitySnapshot }
 *   POST /live/api/event   (falls back to /realtime/action with surface:'brighthour')
 *   WS   /live/api/ws      (optional; absent → refresh on nextTransitionAt boundaries)
 * If the endpoints 404 the page runs against MOCK, which emits the identical
 * shape. The Glass Box always states which one is live.
 * ========================================================================== */
(function () {
  'use strict';

  /* ==========================================================================
   * 1 · IDENTITY — our own namespace, nobody else's
   * ======================================================================== */
  var NS = 'bh_';

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  function clearOwnKeys() {
    // Clears ONLY bh_* keys. opt_* and every other demo's storage is untouched.
    try {
      var doomed = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(NS) === 0) doomed.push(k);
      }
      doomed.forEach(function (k) { window.localStorage.removeItem(k); });
    } catch (e) {}
    try {
      var s = [];
      for (var j = 0; j < window.sessionStorage.length; j++) {
        var sk = window.sessionStorage.key(j);
        if (sk && sk.indexOf(NS) === 0) s.push(sk);
      }
      s.forEach(function (k) { window.sessionStorage.removeItem(k); });
    } catch (e) {}
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'x-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function mintVisitorId() {
    var id = lsGet(NS + 'visitor_id');
    if (!id) { id = 'bh-' + uuid(); lsSet(NS + 'visitor_id', id); }
    return id;
  }

  function mintSessionId() {
    var id = null;
    try { id = window.sessionStorage.getItem(NS + 'session_id'); } catch (e) {}
    if (!id) {
      id = 'bhs-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      try { window.sessionStorage.setItem(NS + 'session_id', id); } catch (e) {}
    }
    return id;
  }

  /* ==========================================================================
   * 2 · CONFIG
   * ======================================================================== */
  var ENDPOINTS = {
    page: '/live/api/page',
    events: '/live/api/events',   // batch — the default sink
    event: '/live/api/event',     // singular — fallback for older server builds
    reflex: '/live/api/reflex',
    ws: '/live/api/ws'
  };

  // C1 dimension registry. Demo τ shown; production τ carried alongside because
  // showing both is itself the credibility move.
  var DIMENSIONS = [
    { key: 'category',             label: 'category',             thetaIn: 0.60, thetaOut: 0.45, tauDemo: '90s',  tauProd: '14d' },
    { key: 'subcategory',          label: 'subcategory',          thetaIn: 0.60, thetaOut: 0.45, tauDemo: '60s',  tauProd: '3d' },
    { key: 'brandPersonality',     label: 'brandPersonality',     thetaIn: 0.55, thetaOut: 0.40, tauDemo: '240s', tauProd: '30d' },
    { key: 'priceBand',            label: 'priceBand',            thetaIn: 0.55, thetaOut: 0.40, tauDemo: '300s', tauProd: '45d' },
    { key: 'offerTypeAffinity',    label: 'offerTypeAffinity',    thetaIn: 0.60, thetaOut: 0.45, tauDemo: '120s', tauProd: '7d' },
    { key: 'urgencyResponsiveness',label: 'urgencyResponsiveness',thetaIn: 0.65, thetaOut: 0.45, tauDemo: '45s',  tauProd: '24h' },
    { key: 'hostAffinity',         label: 'hostAffinity',         thetaIn: 0.55, thetaOut: 0.40, tauDemo: '180s', tauProd: '21d' },
    { key: 'sessionMission',       label: 'sessionMission',       thetaIn: 0.70, thetaOut: 0.50, tauDemo: '30s',  tauProd: 'session' },
    { key: 'mediaAffinity',        label: 'mediaAffinity',        thetaIn: 0.60, thetaOut: 0.45, tauDemo: '90s',  tauProd: '10d' }
  ];

  // Eight categories (B2). Tints are warm and low-chroma so the placeholder grid
  // reads as ONE catalogue, which is exactly what real packshots will do later.
  var CATS = {
    kitchen:     { label: 'Kitchen & Table',    tint: '#D9C4A8', edge: '#9A7F5C' },
    home:        { label: 'For the Home',       tint: '#CBD2C6', edge: '#87927F' },
    beauty:      { label: 'Beauty & Wellness',  tint: '#E9CBD0', edge: '#B4868F' },
    fashion:     { label: 'Fashion',            tint: '#C8CEDB', edge: '#8891A4' },
    jewelry:     { label: 'Jewelry',            tint: '#DED3B6', edge: '#A8976C' },
    electronics: { label: 'Electronics & Tech', tint: '#C6CACE', edge: '#878D93' },
    garden:      { label: 'Garden & Outdoor',   tint: '#C2CFB6', edge: '#849476' },
    food:        { label: 'Food & Wine',        tint: '#E3C6A8', edge: '#AB8A67' }
  };

  // A6 — the COMPLETE availability vocabulary. Nine strings. Nothing else ships.
  var AVAIL = {
    on_air:         'On Air',
    in_stock:       'In Stock',
    low_stock:      'Low Stock',
    sold_out:       'Sold Out',
    waitlist:       'Waitlist',
    advanced_order: 'Advanced Order',
    wait_cancel:    'Wait Cancel',
    pre_order:      'Pre Order Possible',
    just_missed:    'Just missed it! This item is Sold Out.'
  };

  // A5 — badge STYLE comes from the code; badge TEXT comes from the
  // merchandiser-authored label. Never the other way round.
  var BADGE_BUCKET = {
    TBO: 'tsv', TBOPREV: 'tsv', TBOPRE: 'tsv', BH2: 'tsv',
    EVT: 'sale', EVT120: 'sale', EVT72: 'sale', EVT48: 'sale', FIN: 'sale',
    LHS: 'sale', PTS: 'sale', DDP: 'sale', OTO: 'sale', LC: 'sale', FIN_S: 'sale',
    WEB: 'webonly', Q50: 'spb', IOA: 'onair'
  };

  var SLOT_META = {
    hero_billboard:     { render: 'hero',     title: '',                        kicker: '' },
    daily_deal:         { render: 'deal',     title: 'Today’s Bright One℠', kicker: 'One great item. One-day price. A new one tomorrow.' },
    spotlight_for_you:  { render: 'reco',     title: 'Spotlight for You',       kicker: 'Picked for you — and it changes as you look around.' },
    deals_rail:         { render: 'grid',     title: 'Deals Worth the Trip',    kicker: 'Named offers, each with its own window — no hunting required.' },
    on_air_rail:        { render: 'onair',    title: 'On Air Now',              kicker: 'What our hosts are showing, and what they just showed.' },
    category_rail:      { render: 'cats',     title: 'Shop by Category',        kicker: 'Eight aisles — start anywhere.' },
    event_module:       { render: 'event',    title: 'The 120-Hour Reveal',     kicker: '' },
    discovery_rail:     { render: 'reco',     title: 'Something New to You',    kicker: 'Held open on purpose — a few things the ranking did not pick.' }
  };

  /* ==========================================================================
   * 3 · MOCK — identical shape to the server contract. Used only when
   *     /live/api/page is unavailable. The Glass Box always says which.
   * ======================================================================== */
  function money(n) {
    if (n == null || isNaN(n)) return '';
    return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  var SEQ = 0;
  function item(o) {
    SEQ++;
    var band = o.price < 40 ? 'entry' : o.price < 120 ? 'core' : o.price < 300 ? 'elevated' : 'premium';
    var inst = o.installments || 4;
    return {
      itemNumber: o.n,
      shortDescription: o.name,
      shortDubner: o.dubner || o.name,
      longDescription: o.blurb,
      brandName: o.brand,
      brandPersonality: o.personality || 'heritage-classic',
      primaryClassCode: o.klass || 'K221',
      category: o.cat,
      categories: [{ id: o.klass || 'K221', primary: true }],
      pricing: {
        comparableRetail: o.compare || null,
        ourPrice: o.was || null,
        currentSellingPrice: o.price,
        priceBand: band,
        brightPay: {
          code: 'C' + inst, installments: inst,
          amount: Math.round((o.price / inst) * 100) / 100,
          phrasing: inst + ' Bright Pays of ' + money(Math.round((o.price / inst) * 100) / 100)
        },
        cardGatedPay: o.card ? {
          code: 'Q5', installments: 5,
          phrasing: '5 Bright Payments of ' + money(Math.round((o.price / 5) * 100) / 100) + ' using a Bright Card®'
        } : null
      },
      offer: {
        code: o.code || null,
        label: o.label || null,
        type: o.type || 'evergreen',
        badgeBucket: BADGE_BUCKET[o.code] || 'info',
        lifecycleState: o.lifecycle || (o.code ? 'live' : null),
        windowLanguage: o.windowLanguage || null,
        windowStart: o.windowStart || null,
        windowEnd: o.windowEnd || null,
        parentEvent: o.parentEvent || null,
        revealIndex: o.revealIndex || null
      },
      availability: {
        ats: o.urgency === 'sold_out' ? 'N' : (o.urgency === 'waitlist' ? 'W' : 'Y'),
        maxOrderableQuantity: o.max || 5
      },
      urgencyState: o.urgency || 'in_stock',
      signals: { presentedBy: o.host || null, airedLabel: o.aired || null },
      merch: { discoveryTag: o.discovery || null, finalSale: !!o.finalSale },
      returnPolicy: o.finalSale ? 'final_sale' : 'standard',
      shippingHandling: o.sh == null ? 5.50 : o.sh,
      reviews: { count: o.reviews == null ? 214 : o.reviews, averageRating: o.rating == null ? 4.4 : o.rating }
    };
  }

  var CATALOG = {
    dutchOven: item({ n: 'B412907', cat: 'kitchen', brand: 'Copperline', personality: 'value-workhorse',
      name: 'Copperline 9-Qt Enamelled Cast Iron Dutch Oven', dubner: '9-Qt Dutch Oven',
      blurb: 'The one pot you’ll reach for all season — braises on Sunday, soup on Tuesday, and it goes from the range straight to the table without an apology.',
      price: 79.98, was: 109.98, compare: 149.00, installments: 4, card: true, rating: 4.7, reviews: 3765,
      code: 'TBO', label: 'Today’s Bright One℠', type: 'daily_deal', lifecycle: 'live',
      windowLanguage: 'One-Day Price', host: 'Dana Reyes', klass: 'K221' }),

    skillet: item({ n: 'B412934', cat: 'kitchen', brand: 'Copperline', personality: 'value-workhorse',
      name: 'Copperline 12" Pre-Seasoned Skillet', blurb: 'Cornbread, steak, a Sunday frittata — this is the pan that gets better the more you use it.',
      price: 44.98, was: 62.00, installments: 3, rating: 4.6, reviews: 1908,
      code: 'DDP', label: 'Deal Drop', type: 'limited_time_event', lifecycle: 'live', host: 'Dana Reyes' }),

    knives: item({ n: 'B417702', cat: 'kitchen', brand: 'Fresco Nine', personality: 'modern-clean',
      name: 'Fresco Nine 8-Piece Knife Block Set', blurb: 'Eight pieces, one tidy block — and the paring knife you’ll actually use every day.',
      price: 129.98, was: 189.00, compare: 240.00, installments: 5, card: true, rating: 4.5, reviews: 812,
      code: 'EVT', label: 'Harvest Kitchen Event', type: 'limited_time_event', lifecycle: 'live' }),

    mixer: item({ n: 'B421188', cat: 'kitchen', brand: 'Marlow & Bell', personality: 'heritage-classic',
      name: 'Marlow & Bell 5-Qt Tilt-Head Stand Mixer', blurb: 'Bread dough, meringue, birthday cake — it handles all of it, and it looks good sitting out on the counter.',
      price: 279.98, was: 379.00, installments: 6, card: true, rating: 4.8, reviews: 2440, urgency: 'low_stock',
      code: 'EVT120', label: 'The 120-Hour Reveal', type: 'limited_time_event', lifecycle: 'live',
      parentEvent: 'EVT120-FALL', revealIndex: 7, host: 'Dana Reyes' }),

    stockpot: item({ n: 'B419044', cat: 'kitchen', brand: 'Copperline', personality: 'value-workhorse',
      name: 'Copperline 12-Qt Stockpot with Steamer Insert', blurb: 'Big-batch chili, corn on the cob, canning day — it earns its shelf space twice a year and then some.',
      price: 64.98, was: 89.00, installments: 4, rating: 4.4, reviews: 640,
      code: 'LC', label: 'Last Chance', type: 'clearance', lifecycle: 'live' }),

    coverlet: item({ n: 'B506231', cat: 'home', brand: 'Havenmoor', personality: 'heritage-classic',
      name: 'Havenmoor Stonewashed Cotton Coverlet', blurb: 'Soft the day it arrives — softer after the third wash. Layer it now, live under it all winter.',
      price: 89.98, was: 129.00, installments: 4, rating: 4.6, reviews: 1522,
      code: 'WEB', label: 'Online Only', type: 'web_exclusive', lifecycle: 'live' }),

    lamp: item({ n: 'B508870', cat: 'home', brand: 'Lumen House', personality: 'modern-clean',
      name: 'Lumen House Arc Floor Lamp with Dimmer', blurb: 'One switch, three brightness levels — and a reach that finally puts the light where you’re reading.',
      price: 149.98, was: 199.00, installments: 5, card: true, rating: 4.3, reviews: 388,
      code: 'PTS', label: 'Primetime Steals℠', type: 'limited_time_event', lifecycle: 'live' }),

    throw: item({ n: 'B503117', cat: 'home', brand: 'Wren Hollow', personality: 'artisan',
      name: 'Wren Hollow Hand-Loomed Wool Throw', blurb: 'Woven in small runs — no two are quite the same, which is rather the point.',
      price: 68.00, installments: 4, rating: 4.7, reviews: 231, discovery: 'new-to-you' }),

    serum: item({ n: 'B610455', cat: 'beauty', brand: 'Solene', personality: 'modern-clean',
      name: 'Solene Overnight Renewing Serum, 1.7 oz', blurb: 'Use it at night — you’ll notice it at the bathroom mirror on about day ten.',
      price: 54.98, was: 78.00, installments: 3, sh: 3.50, rating: 4.5, reviews: 2917,
      code: 'LHS', label: 'Lunch Hour Steals', type: 'limited_time_event', lifecycle: 'ending_today', windowLanguage: 'Ends Today' }),

    handcream: item({ n: 'B612008', cat: 'beauty', brand: 'Fieldnote', personality: 'artisan',
      name: 'Fieldnote Hand Cream Trio', blurb: 'One for the kitchen, one for the handbag, one to give away — that’s always how it goes.',
      price: 34.98, installments: 3, sh: 3.50, rating: 4.8, reviews: 1104, discovery: 'new-to-you' }),

    cream: item({ n: 'B613901', cat: 'beauty', brand: 'Aurelle Labs', personality: 'tech-forward',
      name: 'Aurelle Labs Peptide Recovery Cream', blurb: 'Rich without being heavy — it sinks in before you’ve finished brushing your teeth.',
      price: 62.00, was: 88.00, installments: 4, sh: 3.50, rating: 4.2, reviews: 506, urgency: 'waitlist',
      code: 'OTO', label: 'One Time Only Price', type: 'one_time_only', lifecycle: 'live' }),

    jacket: item({ n: 'B702554', cat: 'fashion', brand: 'Delaney Park', personality: 'host-led',
      name: 'Delaney Park Sherpa-Lined Zip Jacket', blurb: 'The one you’ll grab on the way out the door — pockets deep enough for a phone and a set of keys.',
      price: 59.98, was: 82.00, installments: 4, rating: 4.6, reviews: 3308, host: 'Marisol Vega',
      code: 'EVT72', label: 'Weekend Bonus Value℠', type: 'limited_time_event', lifecycle: 'live' }),

    pant: item({ n: 'B704120', cat: 'fashion', brand: 'Trueform', personality: 'value-workhorse',
      name: 'Trueform Ponte Straight-Leg Pant', blurb: 'Pull-on comfort that reads as tailored — wear it to the office or to Thanksgiving, nobody will know the difference.',
      price: 42.98, was: 58.00, installments: 3, rating: 4.4, reviews: 2201 }),

    cardigan: item({ n: 'B706318', cat: 'fashion', brand: 'Nell & Bray', personality: 'artisan',
      name: 'Nell & Bray Long Duster Cardigan', blurb: 'Throw it over everything from September to May — that’s the whole idea.',
      price: 74.98, installments: 4, rating: 4.5, reviews: 417, urgency: 'sold_out',
      code: 'FIN', label: 'Finale Price', type: 'limited_time_event', lifecycle: 'live' }),

    hoops: item({ n: 'B801744', cat: 'jewelry', brand: 'Vireo Fine', personality: 'heritage-classic',
      name: 'Vireo Fine 14K Gold Pavé Hoop Earrings', blurb: 'Small enough for every day — bright enough that someone will ask.',
      price: 189.98, was: 260.00, compare: 420.00, installments: 5, card: true, sh: 0, rating: 4.9, reviews: 688,
      code: 'FIN_S', label: 'Final Sale', type: 'final_sale', lifecycle: 'live', finalSale: true }),

    cuff: item({ n: 'B803016', cat: 'jewelry', brand: 'Larkspur Silver', personality: 'artisan',
      name: 'Larkspur Silver Hammered Cuff Bracelet', blurb: 'Hand-hammered, so the light catches it differently every time you turn your wrist.',
      price: 98.00, installments: 4, sh: 0, rating: 4.6, reviews: 302, discovery: 'new-to-you' }),

    ring: item({ n: 'B805529', cat: 'jewelry', brand: 'Coronet', personality: 'heritage-classic',
      name: 'Coronet Simulated Diamond Solitaire Ring', blurb: 'The look of two carats — and you’ll wear it to the grocery store without a second thought.',
      price: 129.98, was: 168.00, installments: 5, card: true, sh: 0, rating: 4.3, reviews: 1490,
      code: 'BH2', label: 'BH2 Nightly Deal', type: 'daily_deal', lifecycle: 'live', windowLanguage: 'Live' }),

    headphones: item({ n: 'B900312', cat: 'electronics', brand: 'Northbeam', personality: 'tech-forward',
      name: 'Northbeam Noise-Cancelling Over-Ear Headphones', blurb: 'Turn them on and the aeroplane goes quiet — that is genuinely the whole review.',
      price: 179.98, was: 249.00, installments: 6, card: true, rating: 4.5, reviews: 1877,
      code: 'EVT120', label: 'The 120-Hour Reveal', type: 'limited_time_event', lifecycle: 'live',
      parentEvent: 'EVT120-FALL', revealIndex: 6 }),

    speakers: item({ n: 'B902288', cat: 'electronics', brand: 'Quilla Audio', personality: 'tech-forward',
      name: 'Quilla Audio Bookshelf Speaker Pair', blurb: 'Set them either side of the television and you will stop asking people to repeat the dialogue.',
      price: 219.98, was: 289.00, installments: 6, card: true, rating: 4.4, reviews: 522, urgency: 'advanced_order',
      code: 'WEB', label: 'Online Only', type: 'web_exclusive', lifecycle: 'live' }),

    display: item({ n: 'B904501', cat: 'electronics', brand: 'Halo Field', personality: 'modern-clean',
      name: 'Halo Field 10" Smart Kitchen Display', blurb: 'Recipes at eye level, timer on the side — and the photographs are big enough to actually see.',
      price: 119.98, installments: 4, rating: 4.1, reviews: 244, discovery: 'new-to-you' }),

    planter: item({ n: 'C101223', cat: 'garden', brand: 'Rootwell', personality: 'value-workhorse',
      name: 'Rootwell Self-Watering Raised Planter', blurb: 'Fill the reservoir on Sunday and forget about it — the tomatoes will not hold it against you.',
      price: 89.98, was: 119.00, installments: 4, rating: 4.4, reviews: 361,
      code: 'EVT', label: 'Harvest Kitchen Event', type: 'limited_time_event', lifecycle: 'live' }),

    wateringcan: item({ n: 'C103780', cat: 'garden', brand: 'Terrace & Thorn', personality: 'artisan',
      name: 'Terrace & Thorn Copper Watering Can', blurb: 'It waters the ferns and then it sits on the windowsill looking lovely — both jobs matter.',
      price: 48.00, installments: 3, rating: 4.7, reviews: 189, discovery: 'new-to-you' }),

    chowder: item({ n: 'C201664', cat: 'food', brand: 'Harbor Larder', personality: 'artisan',
      name: 'Harbor Larder Chowder Trio, 3 Jars', blurb: 'Heat it, ladle it, add a crusty roll — supper is done and you barely touched the stove.',
      price: 39.98, was: 52.00, installments: 3, sh: 7.95, rating: 4.6, reviews: 806,
      code: 'LHS', label: 'Lunch Hour Steals', type: 'limited_time_event', lifecycle: 'live', windowLanguage: 'Last Hours' }),

    sourdough: item({ n: 'C204190', cat: 'food', brand: 'Two Rivers Bake Co.', personality: 'heritage-classic',
      name: 'Two Rivers Sourdough Starter Kit', blurb: 'Everything but the patience — and by week two you will have that as well.',
      price: 34.98, installments: 3, sh: 7.95, rating: 4.5, reviews: 271, discovery: 'new-to-you' })
  };

  var BILLBOARD = {
    eyebrow: 'The Harvest Kitchen Event',
    title: 'It’s nearly autumn — and your kitchen knows it before you do.',
    sub: 'Four and a half days of Copperline, Fresco Nine and Marlow & Bell, with a fresh reveal every three hours. Come back often; it moves.',
    ctaPrimary: 'Shop the Event',
    ctaSecondary: 'See every named offer',
    scene: 'kitchen',
    authored: 'Merchandiser-authored'
  };

  // Same explain shape the composer emits, including the `excluded[]` refusal
  // ledger — so the offline payload exercises exactly the same panel code path.
  function mockExplain(o) {
    return {
      candidates_considered: o.candidates == null ? 6 : o.candidates,
      candidate_set: o.set || [],
      gates_passed: o.pass || ['window_open', 'availability', 'vip_offer_exclusion', 'financing_conflict', 'channel'],
      gates_failed: o.fail || [],
      excluded: o.excluded || [],
      pinned: !!o.pinned,
      quota_reserved: !!o.quota,
      dimension_scores: o.scores || {},
      rank_score: o.rank == null ? 0 : o.rank,
      rank_position: o.pos == null ? 1 : o.pos,
      tie_break_hash: o.hash || Math.random().toString(16).slice(2, 10),
      config_version: 'brighthour-demo-mock',
      engine_latency_ms: o.latency == null ? 7 : o.latency
    };
  }

  var MOCK_SNAPSHOT = {
    category: 0.71, subcategory: 0.58, brandPersonality: 0.44, priceBand: 0.51,
    offerTypeAffinity: 0.63, urgencyResponsiveness: 0.83, hostAffinity: 0.62,
    sessionMission: 0.34, mediaAffinity: 0.47
  };

  function mockPage(opts) {
    var mission = opts.mode === 'mission';
    var vip = opts.vipOfferActive !== false;
    var now = Date.now();
    var C = CATALOG;
    var d = [];
    var order = 0;

    function push(slot, itm, offerOverride, xp, extra) {
      var dec = {
        slot_id: slot, order: order++, item: itm || null,
        offer: offerOverride || (itm && itm.offer) || null,
        explain: xp, decision_id: 'dec_' + slot + '_' + Math.random().toString(36).slice(2, 10)
      };
      if (extra) Object.keys(extra).forEach(function (k) { dec[k] = extra[k]; });
      d.push(dec);
    }

    push('hero_billboard', { billboard: BILLBOARD }, null, mockExplain({
      pinned: true, pass: ['merchandiser_pin', 'offer_window_open'],
      scores: {}, rank: 0, pos: 1, latency: 3
    }));

    push('daily_deal', C.dutchOven, C.dutchOven.offer, mockExplain({
      scores: { category: 0.71, offerTypeAffinity: 0.63, urgencyResponsiveness: 0.83, priceBand: 0.51 },
      rank: 0.742, pos: 1, latency: 6
    }));

    // Beat 14 — the engineered refusal. A high-affinity Final Sale item is
    // excluded by RULE, not by score, whenever the cardholder offer is running.
    var spotExcluded = vip ? [{
      itemId: C.hoops.itemNumber, name: C.hoops.shortDescription,
      gates_failed: ['vip_offer_exclusion (final_sale)'],
      dimension_scores: { category: 0.81, brandPersonality: 0.74 }, rank_score: 0.81, affinity: 0.81
    }] : [];

    push('spotlight_for_you', null, null, mockExplain({
      fail: vip ? ['vip_offer_exclusion (final_sale)'] : [],
      excluded: spotExcluded,
      scores: { category: 0.71, brandPersonality: 0.44, priceBand: 0.51, hostAffinity: 0.62 },
      rank: 0.688, pos: 1, latency: 9
    }), { items: [C.skillet, C.knives, C.coverlet, C.stockpot] });

    push('deals_rail', null, null, mockExplain({
      scores: { offerTypeAffinity: 0.63, urgencyResponsiveness: 0.83, category: 0.71 },
      rank: 0.611, pos: 2, latency: 8
    }), { items: mission
        ? [C.serum, C.chowder, C.jacket, C.ring]
        : [C.serum, C.chowder, C.jacket, C.ring, C.lamp, C.planter, C.cream, C.cardigan] });

    if (!mission) {
      push('on_air_rail', null, null, mockExplain({
        scores: { mediaAffinity: 0.47, hostAffinity: 0.62 },
        rank: 0.502, pos: 3, latency: 11
      }), {
        onAir: { show: 'In the Kitchen with Dana', host: 'Dana Reyes', channel: 'BH Live' },
        items: [
          Object.assign({}, C.mixer,   { signals: { presentedBy: 'Dana Reyes', airedLabel: null, live: true } }),
          Object.assign({}, C.skillet, { signals: { presentedBy: 'Dana Reyes', airedLabel: 'Aired earlier this hour' } }),
          Object.assign({}, C.knives,  { signals: { presentedBy: 'Dana Reyes', airedLabel: 'Aired this afternoon' } }),
          Object.assign({}, C.jacket,  { signals: { presentedBy: 'Marisol Vega', airedLabel: 'Aired this morning' } }),
          Object.assign({}, C.coverlet,{ signals: { presentedBy: 'Marisol Vega', airedLabel: 'Aired this morning' } }),
          Object.assign({}, C.chowder, { signals: { presentedBy: 'Dana Reyes', airedLabel: 'Aired yesterday' } })
        ]
      });

      push('category_rail', null, null, mockExplain({
        pass: ['taxonomy_complete'], scores: {}, rank: 0, pos: 4, latency: 2
      }), { categories: Object.keys(CATS) });

      push('event_module', C.mixer, C.mixer.offer, mockExplain({
        scores: { category: 0.71, offerTypeAffinity: 0.63, urgencyResponsiveness: 0.83 },
        rank: 0.655, pos: 5, latency: 7
      }), {
        event: {
          name: 'The 120-Hour Reveal', revealIndex: 7, revealTotal: 40,
          lede: 'Five days, forty reveals — and a fresh one every three hours. Keep this page handy.',
          cadence: 'A new reveal every three hours, right through Sunday evening. When one closes, the next one is already here.'
        }
      });

      push('discovery_rail', null, null, mockExplain({
        quota: true,
        pass: ['discovery_quota', 'exposure_floor_reserved'],
        scores: { category: 0.02, brandPersonality: 0.11 },
        rank: 0.041, pos: 6, latency: 5
      }), { items: [C.throw, C.handcream, C.cuff, C.wateringcan, C.sourdough, C.display, C.speakers, C.headphones] });
    }

    return {
      page: 'home',
      epochMs: now,
      demoClock: { multiplier: 60 },
      decisions: d,
      nextTransitionAt: now + 90 * 60 * 1000,   // demo-clock ms → 90 real seconds at ×60
      affinitySnapshot: MOCK_SNAPSHOT,
      sessionMission: opts.mode || 'browse',
      moduleCount: d.length,
      mode: opts.mode || 'browse',
      config_version: 'bh-config@2026.08.18-3',
      source: 'mock'
    };
  }

  /* ==========================================================================
   * 4 · NORMALIZERS — the sibling's field names may differ in detail; read
   *     defensively so a real payload renders without a redeploy.
   * ======================================================================== */
  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== '') return arguments[i];
    }
    return null;
  }

  // The server sends a category LABEL ("Kitchen & Table"); the packshot recipes
  // are keyed. Resolve both, and degrade by keyword rather than blanking a tile.
  function catKey(v) {
    if (!v) return 'kitchen';
    if (CATS[v]) return v;
    var s = String(v).toLowerCase();
    for (var k in CATS) { if (CATS[k].label.toLowerCase() === s || s.indexOf(k) !== -1) return k; }
    if (/kitchen|table|cook|cutler|bakew/.test(s)) return 'kitchen';
    if (/home|bed|bath|light|decor|furnit|rug/.test(s)) return 'home';
    if (/beaut|wellness|skin|hair|fragran/.test(s)) return 'beauty';
    if (/fashion|apparel|handbag|shoe|accessor|jacket|knit/.test(s)) return 'fashion';
    if (/jewel|necklace|ring|earring|bracelet|watch/.test(s)) return 'jewelry';
    if (/electron|tech|audio|comput|tv|headphone/.test(s)) return 'electronics';
    if (/garden|outdoor|patio|plant|grill/.test(s)) return 'garden';
    if (/food|wine|larder|bake|gourmet|coffee/.test(s)) return 'food';
    return 'kitchen';
  }

  function titleCaseHost(v) {
    if (!v) return null;
    return String(v).replace(/^host_/, '').split(/[_\s]+/)
      .map(function (w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; }).join(' ');
  }

  /* -- PRICING AND REVIEWS ARE THE COMPOSER'S ------------------------------
     The composer owns anchor prices, instalment terms and review aggregates,
     so this page renders exactly what it is given and invents nothing. An
     absent brightPay means the item carries NO instalment offer (they are not
     universal — §C3 has eligibility rules and a six-instalment cap), so the
     line simply does not render. Absent price or reviews is a broken payload
     rather than a merchandising fact, and the Glass Box says so.
     ---------------------------------------------------------------------- */
  var DERIVED = { used: false, note: '' };

  function norm(raw, ctx) {
    if (!raw) return null;
    var p = raw.pricing || {};
    var offer = (ctx && ctx.offer) || raw.offer || null;
    var id = pick(raw.itemNumber, raw.item_number, raw.id, raw.sku, '—');
    var sell = Number(pick(p.currentSellingPrice, raw.priceUsd, p.price, raw.price, 0));

    var was = pick(p.ourPrice, raw.ourPrice);
    var compare = pick(p.comparableRetail, raw.comparableRetail);
    var brightPay = pick(p.brightPay, raw.brightPay);
    var cardPay = pick(p.cardGatedPay, raw.cardGatedPay);
    var reviews = raw.reviews || (raw.avgRating != null ? { averageRating: raw.avgRating, count: raw.reviewCount } : null);

    if (!sell) { DERIVED.used = true; DERIVED.note = 'payload missing currentSellingPrice'; }
    if (!reviews) { DERIVED.used = true; DERIVED.note = 'payload missing review aggregate'; }

    return {
      raw: raw,
      id: id,
      name: pick(raw.shortDescription, raw.name, raw.title, 'Item'),
      blurb: pick(raw.longDescription, raw.description, raw.blurb, ''),
      brand: pick(raw.brandName, raw.brand, ''),
      cat: catKey(pick(raw.category, raw.categoryKey, raw.subcategory, (raw.categories && raw.categories[0] && raw.categories[0].key))),
      subcategory: pick(raw.subcategory, null),
      sell: sell,
      was: was != null ? Number(was) : null,
      compare: compare != null ? Number(compare) : null,
      brightPay: brightPay,
      cardPay: cardPay,
      offer: offer,
      urgency: pick(raw.urgencyState, raw.urgency_state, (raw.availability && raw.availability.state), 'in_stock'),
      maxQty: Number(pick(raw.availability && raw.availability.maxOrderableQuantity, raw.maxOrderableQuantity, 5)),
      rating: Number(pick(reviews && reviews.averageRating, 0)),
      reviewCount: Number(pick(reviews && reviews.count, 0)),
      host: titleCaseHost(pick(raw.presentedBy, raw.signals && raw.signals.presentedBy, null)),
      aired: pick(raw.signals && raw.signals.airedLabel, airedLanguage(raw.lastOnAirDate, ctx && ctx.now)),
      live: !!(ctx && ctx.live) || !!(raw.signals && raw.signals.live),
      finalSale: (raw.returnPolicy === 'final_sale') || !!(raw.merch && raw.merch.finalSale) ||
                 !!(offer && (offer.code === 'FIN_S' || offer.type === 'final_sale'))
    };
  }

  /* On-air recency is expressed as LANGUAGE, never as a timestamp or a timer —
     the same doctrine that keeps a clock off every shopper-facing surface. */
  function airedLanguage(iso, now) {
    if (!iso) return null;
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    var d = (now || Date.now()) - t;
    if (d < 0) return 'Coming up on air';
    var h = d / 3600000;
    if (h < 1) return 'Aired in the last hour';
    if (h < 6) return 'Aired earlier today';
    if (h < 24) return 'Aired today';
    if (h < 48) return 'Aired yesterday';
    if (h < 168) return 'Aired this week';
    return 'Aired recently';
  }

  function cadenceLanguage(ms) {
    if (!ms) return '';
    var h = Math.round(ms / 3600000);
    var words = { 1: 'an hour', 2: 'two hours', 3: 'three hours', 4: 'four hours', 6: 'six hours', 8: 'eight hours', 12: 'twelve hours', 24: 'a day' };
    return 'A new reveal every ' + (words[h] || (h + ' hours')) + ' — when one closes, the next is already here.';
  }

  // The FOUR window strings, and the lifecycle names their own data already uses.
  // There is no shopper-facing clock anywhere on this page — by design (A6).
  function windowLanguage(offer) {
    if (!offer) return null;
    if (offer.windowLanguage) return offer.windowLanguage;
    var st = offer.lifecycleState;
    if (st === 'preview') return 'Preview';
    if (st === 'prelaunch') return 'Coming Up';
    if (st === 'presale') return 'Presale';
    if (st === 'ending_today') return 'Ends Today';
    if (st === 'postsale') return 'Just Ended';
    if (st === 'expired') return 'Offer Closed';
    return offer.type === 'daily_deal' ? 'One-Day Price' : 'Live';
  }

  /* ==========================================================================
   * 5 · PACKSHOT PLACEHOLDERS — coded SVG on #FEFEFE, category-tinted
   *     silhouette + the item name, drawn inside an 8% margin of a 100×100
   *     view box. Real photography drops into the identical frame later with
   *     zero layout work: replace <svg> with <img>, nothing else moves.
   * ======================================================================== */
  var SIL = {
    kitchen: function (t, e) { return '' +
      '<path d="M24 44 L76 44 L72 68 Q70 74 62 74 L38 74 Q30 74 28 68 Z" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<rect x="15" y="46" width="9" height="6" rx="3" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<rect x="76" y="46" width="9" height="6" rx="3" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<ellipse cx="50" cy="42" rx="28" ry="5.4" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<rect x="46" y="32" width="8" height="7" rx="2.2" fill="' + e + '"/>'; },
    home: function (t, e) { return '' +
      '<path d="M34 28 L66 28 L75 54 L25 54 Z" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<rect x="47" y="54" width="6" height="16" fill="' + e + '"/>' +
      '<ellipse cx="50" cy="72" rx="17" ry="4.6" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>'; },
    beauty: function (t, e) { return '' +
      '<rect x="43" y="19" width="14" height="5" rx="2" fill="' + e + '"/>' +
      '<rect x="47.2" y="24" width="5.6" height="8" fill="' + e + '"/>' +
      '<path d="M41 38 L59 38 L56.5 31 L43.5 31 Z" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<rect x="36" y="37" width="28" height="37" rx="4" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<rect x="36" y="51" width="28" height="10" fill="#FEFEFE" opacity=".62"/>'; },
    fashion: function (t, e) { return '' +
      '<path d="M30 33 L44 28 L56 28 L70 33 L75 48 L66 50.5 L66 73 L34 73 L34 50.5 L25 48 Z" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<path d="M44 28 Q50 35 56 28" fill="none" stroke="' + e + '" stroke-width="1.4"/>'; },
    jewelry: function (t, e) { return '' +
      '<circle cx="50" cy="57" r="16" fill="none" stroke="' + t + '" stroke-width="6.5"/>' +
      '<circle cx="50" cy="57" r="16" fill="none" stroke="' + e + '" stroke-width="1" opacity=".8"/>' +
      '<path d="M50 24 L59 34 L50 43 L41 34 Z" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<path d="M41 34 L59 34 M50 24 L50 43" stroke="' + e + '" stroke-width=".9" opacity=".7"/>'; },
    electronics: function (t, e) { return '' +
      '<rect x="32" y="22" width="36" height="52" rx="3" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<circle cx="50" cy="40" r="10" fill="none" stroke="' + e + '" stroke-width="1.4"/>' +
      '<circle cx="50" cy="40" r="4" fill="' + e + '" opacity=".55"/>' +
      '<circle cx="50" cy="61" r="6" fill="none" stroke="' + e + '" stroke-width="1.4"/>'; },
    garden: function (t, e) { return '' +
      '<path d="M38 43 Q42 28 57 31" fill="none" stroke="' + e + '" stroke-width="3.4" stroke-linecap="round"/>' +
      '<path d="M65 48 L80 34 L85 39 L70 53 Z" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<circle cx="83" cy="36" r="4.4" fill="' + e + '" opacity=".7"/>' +
      '<path d="M32 44 L67 44 L64 73 L35 73 Z" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<rect x="30" y="39" width="39" height="5.4" rx="2.2" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>'; },
    food: function (t, e) { return '' +
      '<rect x="32" y="24" width="36" height="10" rx="3" fill="' + e + '" opacity=".75"/>' +
      '<rect x="34" y="34" width="32" height="40" rx="4.5" fill="' + t + '" stroke="' + e + '" stroke-width="1.2"/>' +
      '<rect x="34" y="49" width="32" height="12" fill="#FEFEFE" opacity=".66"/>'; }
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function wrap(text, max, lines) {
    var words = String(text || '').split(/\s+/), out = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var next = cur ? cur + ' ' + words[i] : words[i];
      if (next.length > max && cur) { out.push(cur); cur = words[i]; }
      else { cur = next; }
      if (out.length === lines) break;
    }
    if (out.length < lines && cur) out.push(cur);
    if (out.length === lines) {
      // anything left over is elided rather than overflowing the frame
      var consumed = out.join(' ').length;
      if (consumed < String(text || '').length - 1) {
        out[lines - 1] = out[lines - 1].replace(/[\s,.;:-]+$/, '') + '…';
      }
    }
    return out;
  }

  /* ── THE REAL-IMAGE SEAM ────────────────────────────────────────────────
     Photography arrives as files under /live/img/ and as a path on the item.
     Nobody has promised WHICH field carries it, and the catalogue already ships
     QVC-shaped paths (/img/b/42/b421104.001.jpg) that resolve to nothing here —
     so this reads every plausible field, in order, and treats each as a
     CANDIDATE rather than a promise.

     The placeholder is not replaced; it is UNDERNEATH. The <img> is layered on
     top inside the very same frame, so:
       · a hit covers the placeholder with no reflow,
       · a miss removes the <img> and reveals the placeholder already painted —
         no empty frame, no flash, and no second layout pass either way.
     The frame owns the box (aspect-ratio on .bh-frame), so layout shift is
     structurally impossible whichever way each item resolves. */
  var IMG_BASE = '/live/img/';
  var PHOTO_EXT = /\.(jpe?g|png|webp|avif)$/i;

  function photoCandidates(n) {
    var raw = (n && n.raw) || {};
    var out = [];
    function add(v) {
      if (v == null) return;
      var s = String(v).trim();
      if (!s || s === 'null' || s === 'undefined') return;
      // a bare filename is understood as living in the conventional image dir
      if (!/^(https?:)?\/\//i.test(s) && s.charAt(0) !== '/') s = IMG_BASE + s;
      if (out.indexOf(s) === -1) out.push(s);
    }
    // 1 · whatever the payload actually declares (server projects imageUrl;
    //     the catalogue carries image_url; assets.primary is the third shape)
    add(raw.imageUrl); add(raw.image_url); add(raw.image);
    var a = raw.assets;
    if (a && a.primary) {
      var p = String(a.primary);
      if (!PHOTO_EXT.test(p)) p += '.jpg';
      add(a.base ? String(a.base) + p : p);
    }
    // 2 · the convention, which is what tonight's generated packshots land on
    if (n && n.id && n.id !== '—') {
      add(IMG_BASE + n.id + '.jpg');
      add(IMG_BASE + String(n.id).toLowerCase() + '.jpg');
    }
    return out;
  }

  function packshot(n) {
    var c = CATS[n.cat] || CATS.kitchen;
    var sil = (SIL[n.cat] || SIL.kitchen)(c.tint, c.edge);
    var lines = wrap(n.name, 30, 2);
    var text = lines.map(function (l, i) {
      return '<text x="50" y="' + (83.5 + i * 7) + '" text-anchor="middle" font-size="5.2" fill="#484842">' + esc(l) + '</text>';
    }).join('');
    var svg = '<svg class="bh-packshot" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' +
      esc(n.name) + ' — product photography placeholder">' +
      '<rect width="100" height="100" fill="#FEFEFE"/>' +
      '<ellipse cx="50" cy="76" rx="26" ry="2.3" fill="#233047" opacity=".07"/>' +
      sil + text + '</svg>';

    var cands = photoCandidates(n);
    if (!cands.length) return svg;
    // The placeholder keeps the accessible name; a decorative photo on top of it
    // would otherwise announce the item twice.
    return svg +
      '<img class="bh-photo" data-bh-photo loading="lazy" decoding="async" alt="" aria-hidden="true"' +
      ' src="' + esc(cands[0]) + '"' +
      (cands.length > 1 ? ' data-alts="' + esc(cands.slice(1).join(' ')) + '"' : '') + '>';
  }

  /* Neither `error` nor `load` bubbles, so the seam listens in the CAPTURE phase
     — one pair of listeners for every packshot on the page, present and future,
     and no inline handler to trip a content-security policy. */
  function isPhoto(el) { return !!(el && el.tagName === 'IMG' && el.hasAttribute('data-bh-photo')); }

  document.addEventListener('error', function (ev) {
    var el = ev.target;
    if (!isPhoto(el)) return;
    var alts = (el.getAttribute('data-alts') || '').split(' ').filter(Boolean);
    // Out of candidates: drop the layer entirely and let the placeholder — which
    // has been sitting underneath it the whole time — simply be what shows.
    if (!alts.length) { if (el.parentNode) el.parentNode.removeChild(el); return; }
    var next = alts.shift();
    if (alts.length) el.setAttribute('data-alts', alts.join(' '));
    else el.removeAttribute('data-alts');
    el.removeAttribute('data-loaded');
    el.src = next;
  }, true);

  document.addEventListener('load', function (ev) {
    var el = ev.target;
    if (isPhoto(el)) el.setAttribute('data-loaded', '');
  }, true);

  function catDisc(key) {
    var c = CATS[key];
    var sil = (SIL[key] || SIL.kitchen)('#FEFEFE', c.edge);
    return '<svg class="bh-cat__disc" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
      '<circle cx="50" cy="50" r="49" fill="' + c.tint + '"/>' +
      '<g transform="translate(50,50) scale(.72) translate(-50,-50)">' + sil + '</g></svg>';
  }

  /* ==========================================================================
   * 6 · CARD PARTS — their grid-card template order, exactly (A10):
   *     image → badge → brand → 3-line clamp → price → instalment → stars → CTA
   * ======================================================================== */
  function badgesHtml(n, opts) {
    var out = [];
    var offer = n.offer || {};
    if (offer.label) {
      var bucket = offer.badgeBucket || BADGE_BUCKET[offer.code] || 'info';
      out.push('<span class="bh-badge bh-badge--' + esc(bucket) + '">' + esc(offer.label) + '</span>');
    }
    if (n.live) out.push('<span class="bh-badge bh-badge--onair">Item On Air</span>');
    if (n.urgency === 'low_stock') out.push('<span class="bh-badge bh-badge--lowstock">' + AVAIL.low_stock + '</span>');
    if (n.urgency === 'sold_out') out.push('<span class="bh-badge bh-badge--info">' + AVAIL.sold_out + '</span>');
    if (n.urgency === 'waitlist') out.push('<span class="bh-badge bh-badge--info">' + AVAIL.waitlist + '</span>');
    if (n.urgency === 'advanced_order') out.push('<span class="bh-badge bh-badge--info">' + AVAIL.advanced_order + '</span>');
    if (opts && opts.window && offer.lifecycleState) {
      out.push('<span class="bh-badge bh-badge--info">' + esc(windowLanguage(offer)) + '</span>');
    }
    return '<div class="bh-badges">' + out.join('') + '</div>';
  }

  // Their dual-track price pattern: the struck price is aria-hidden and assistive
  // technology is handed ", was, $X" instead.
  function priceHtml(n) {
    var h = '<div class="bh-price"><span class="bh-price__sell">' + money(n.sell) + '</span>';
    if (n.was && n.was > n.sell) {
      h += '<span class="bh-price__old" aria-hidden="true">was ' + money(n.was) + '</span>' +
           '<span class="bh-sr-only">, was, ' + money(n.was) + '</span>';
    }
    h += '</div>';
    if (n.compare && n.compare > (n.was || n.sell)) {
      h += '<p class="bh-price__compare">Comparable Retail Value ' + money(n.compare) + '</p>';
    }
    var pays = '';
    if (n.brightPay && n.brightPay.phrasing) pays += '<p class="bh-payline">' + esc(n.brightPay.phrasing) + '</p>';
    if (n.cardPay && n.cardPay.phrasing) pays += '<p class="bh-payline bh-payline--card">' + esc(n.cardPay.phrasing) + '</p>';
    if (pays) h += '<div class="bh-paylines">' + pays + '</div>';
    return h;
  }

  // Stars are INK, drawn as a width-percentage overlay. Never gold.
  function starsHtml(n) {
    if (!n.rating) return '';
    var pct = Math.max(0, Math.min(100, (n.rating / 5) * 100));
    return '<div class="bh-rating">' +
      '<span class="bh-stars" aria-hidden="true">' +
        '<span class="bh-stars__base">★★★★★</span>' +
        '<span class="bh-stars__fill" style="width:' + pct.toFixed(1) + '%">★★★★★</span>' +
      '</span>' +
      '<span class="bh-sr-only">' + n.rating.toFixed(1) + ' of 5 Stars</span>' +
      '<span class="bh-rating__count">(' + n.reviewCount.toLocaleString() + ')</span>' +
    '</div>';
  }

  function availHtml(n) {
    if (n.urgency === 'sold_out') return '<p class="bh-avail bh-avail--soldout">' + AVAIL.just_missed + '</p>';
    if (n.urgency === 'low_stock') return '<p class="bh-avail bh-avail--low">' + AVAIL.low_stock + '</p>';
    if (n.urgency === 'waitlist') return '<p class="bh-avail">' + AVAIL.waitlist + '</p>';
    if (n.urgency === 'advanced_order') return '<p class="bh-avail">' + AVAIL.advanced_order + '</p>';
    if (n.urgency === 'pre_order') return '<p class="bh-avail">' + AVAIL.pre_order + '</p>';
    if (n.urgency === 'wait_cancel') return '<p class="bh-avail">' + AVAIL.wait_cancel + '</p>';
    return '<p class="bh-avail">' + AVAIL.in_stock + '</p>';
  }

  function qtyHtml(n) {
    if (n.urgency === 'sold_out') return '';
    return '<div class="bh-qty" role="group" aria-label="Quantity for ' + esc(n.name) + '">' +
      '<button type="button" data-bh-qty="-1" aria-label="Decrease quantity">−</button>' +
      '<span class="bh-qty__val" data-bh-qtyval aria-live="polite">1</span>' +
      '<button type="button" data-bh-qty="1" aria-label="Increase quantity">+</button>' +
    '</div>';
  }

  // "Add to Cart" — suppressed entirely when sold out (their rule). The alternate
  // states use their own strings, and nothing else.
  function ctaHtml(n) {
    if (n.urgency === 'sold_out') return '';
    if (n.urgency === 'waitlist') {
      return '<button class="bh-btn bh-btn--tertiary bh-btn--block" type="button" data-bh-cta="waitlist">' + AVAIL.waitlist + '</button>';
    }
    if (n.urgency === 'advanced_order') {
      return '<button class="bh-btn bh-btn--tertiary bh-btn--block" type="button" data-bh-cta="advanced_order">' + AVAIL.advanced_order + '</button>';
    }
    if (n.urgency === 'pre_order') {
      return '<button class="bh-btn bh-btn--tertiary bh-btn--block" type="button" data-bh-cta="pre_order">' + AVAIL.pre_order + '</button>';
    }
    return '<button class="bh-btn bh-btn--primary bh-btn--block" type="button" data-bh-cta="add_to_cart">Add to Cart</button>';
  }

  function cardHtml(n, ctx) {
    var frame = ctx.frame === 'reco' ? 'bh-frame--reco' : 'bh-frame--square';
    return '<article class="bh-card" data-bh-card data-bh-item="' + esc(n.id) + '"' +
        ' data-bh-slot="' + esc(ctx.slot) + '" data-bh-decision="' + esc(ctx.decisionId || '') + '">' +
      '<div class="bh-frame ' + frame + '">' + packshot(n) + '</div>' +
      badgesHtml(n, { window: !!ctx.showWindow }) +
      '<div class="bh-card__body">' +
        (n.brand ? '<p class="bh-card__brand">' + esc(n.brand) + '</p>' : '') +
        '<p class="bh-card__desc"><a href="#bh-main" data-bh-open>' + esc(n.name) + '</a></p>' +
        (n.aired ? '<p class="bh-onair__aired">' + esc(n.aired) + '</p>' : '') +
        priceHtml(n) +
        starsHtml(n) +
        '<div class="bh-card__foot">' + availHtml(n) + qtyHtml(n) + ctaHtml(n) + '</div>' +
      '</div>' +
    '</article>';
  }

  /* ==========================================================================
   * 7 · SLOT RENDERERS
   * ======================================================================== */
  function slotShell(dec, inner, opts) {
    var meta = SLOT_META[dec.slot_id] || { title: dec.slot_id, kicker: '' };
    var title = (opts && opts.title) || meta.title;
    var kicker = (opts && opts.kicker !== undefined) ? opts.kicker : meta.kicker;
    var head = '';
    if (title || kicker) {
      head = '<div class="bh-slot__head"><div class="bh-slot__titles">' +
        (title ? '<h2 class="bh-slot__title">' + title + '</h2>' : '') +
        (kicker ? '<p class="bh-slot__kicker">' + kicker + '</p>' : '') +
      '</div>' + explainBtn(dec) + '</div>';
    } else {
      head = '<div class="bh-slot__head"><div class="bh-slot__titles"></div>' + explainBtn(dec) + '</div>';
    }
    return '<section class="bh-slot" id="bh-slot-' + esc(dec.slot_id) + '" data-bh-slotsection="' + esc(dec.slot_id) + '" aria-label="' +
      esc(title || dec.slot_id) + '">' + head + inner + '</section>';
  }

  function explainBtn(dec) {
    return '<button class="bh-explain" type="button" data-bh-explain="' + esc(dec.slot_id) + '" aria-expanded="false">' +
      '<svg width="9" height="11" viewBox="0 0 9 11" aria-hidden="true" focusable="false"><path d="M1.5 1 6.5 5.5 1.5 10" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>' +
      'explain</button>';
  }

  var HERO_SCENES = {
    kitchen: 'radial-gradient(120% 140% at 78% 18%, #FBEFE9 0%, #F6E6E4 42%, #EDEBE7 100%)',
    home:    'radial-gradient(120% 140% at 78% 18%, #F8F7F5 0%, #EDEBE7 46%, #DCD9D3 100%)',
    beauty:  'radial-gradient(120% 140% at 78% 18%, #FBEFE9 0%, #F6E6E4 55%, #EDE6E6 100%)',
    default: 'radial-gradient(120% 140% at 78% 18%, #FBEFE9 0%, #F6E6E4 45%, #EDEBE7 100%)'
  };

  /* The billboard is merchandiser-authored and identical for every visitor.
     When the composer pins an ITEM to the slot rather than a copy block, the
     headline still comes from the authored deck below — the pin decides WHAT is
     featured, a human decided how it reads. */
  var BILLBOARD_COPY = {
    EVT:    { title: 'It’s nearly autumn — and your kitchen knows it before you do.',
              sub: 'Four and a half days of Copperline, Fresco Nine and Marlow & Bell, with a fresh reveal every few hours. Come back often; it moves.' },
    EVT120: { title: 'Five days. Forty reveals. One very good week.',
              sub: 'We’re opening something new every three hours — and no, you don’t have to sit and wait for it. We’ll keep it right here.' },
    TBO:    { title: 'One great item. One-day price. A new one tomorrow.',
              sub: 'Our hosts pick it, we price it, and it’s here until it isn’t — that’s the whole idea.' },
    DEFAULT:{ title: 'Come for the hour — stay for the find.',
              sub: 'Named offers, real windows, and hosts who actually use the things they show you.' }
  };

  function heroFrom(dec) {
    var it = dec.item || {};
    if (it.billboard) return it.billboard;
    var offer = dec.offer || it.offer || {};
    var deck = BILLBOARD_COPY[offer.code] || (offer.parentEvent && BILLBOARD_COPY[String(offer.parentEvent).split('_')[0]]) || BILLBOARD_COPY.DEFAULT;
    var n = norm(it, { offer: offer, now: demoNow() });
    return {
      eyebrow: offer.label || 'Featured',
      title: deck.title, sub: deck.sub,
      ctaPrimary: 'Shop the Event', ctaSecondary: 'See every named offer',
      scene: n ? n.cat : 'kitchen',
      authored: 'Merchandiser-authored',
      product: n
    };
  }

  function renderHero(dec) {
    var b = heroFrom(dec);
    var scene = HERO_SCENES[b.scene] || HERO_SCENES.default;
    var inner = '<div class="bh-hero">' +
      '<div class="bh-hero__scene" style="background:' + scene + '">' +
        // decorative coded scene — a coral arc rising behind the copy, no baked text
        '<svg class="bh-hero__art" viewBox="0 0 600 340" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">' +
          '<circle cx="452" cy="150" r="104" fill="#EF7A5E" opacity=".22"/>' +
          '<circle cx="452" cy="150" r="66" fill="#EF7A5E" opacity=".34"/>' +
          '<path d="M300 262 H600" stroke="#233047" stroke-width="4" opacity=".22"/>' +
          '<rect x="352" y="196" width="72" height="66" rx="4" fill="#233047" opacity=".12"/>' +
          '<rect x="440" y="214" width="112" height="48" rx="4" fill="#233047" opacity=".09"/>' +
        '</svg>' +
        (b.product ? '<div class="bh-hero__pack"><div class="bh-frame bh-frame--square">' + packshot(b.product) + '</div>' +
          '<p class="bh-hero__packname">' + esc(b.product.brand) + ' &middot; ' + money(b.product.sell) + '</p></div>' : '') +
        '<div class="bh-hero__copy">' +
          (b.eyebrow ? '<p class="bh-hero__eyebrow">' + esc(b.eyebrow) + '</p>' : '') +
          '<h2 class="bh-hero__title">' + esc(b.title || '') + '</h2>' +
          (b.sub ? '<p class="bh-hero__sub">' + esc(b.sub) + '</p>' : '') +
          '<div class="bh-hero__actions">' +
            '<a class="bh-btn bh-btn--primary" href="#bh-slot-event_module">' + esc(b.ctaPrimary || 'Shop the Event') + '</a>' +
            '<a class="bh-btn bh-btn--tertiary" href="#bh-slot-deals_rail">' + esc(b.ctaSecondary || 'See every named offer') + '</a>' +
          '</div>' +
        '</div>' +
        (b.authored ? '<p class="bh-hero__authored">' + esc(b.authored) + '</p>' : '') +
      '</div>' +
    '</div>';
    return slotShell(dec, inner, { title: '', kicker: '' });
  }

  var DEAL_BLURB = {
    kitchen: 'The one you’ll reach for all season — and it goes from the range straight to the table without an apology.',
    home: 'Soft the day it arrives, softer after the third wash — layer it now and live with it all winter.',
    beauty: 'Use it at night, and you’ll notice it at the bathroom mirror somewhere around day ten.',
    fashion: 'The one you’ll grab on the way out the door — pockets deep enough for a phone and a set of keys.',
    jewelry: 'Small enough for every day — bright enough that somebody will ask about it.',
    electronics: 'Set it up once and forget about it. That’s honestly the whole review.',
    garden: 'Fill it on Sunday and forget about it — the tomatoes will not hold it against you.',
    food: 'Heat it, ladle it, add a crusty roll — supper is done and you barely touched the stove.'
  };

  /* Beat 13 — the offer-framing experiment, on the ONE slot that carries it.
     The two arms say the same true thing about the same window in two
     registers: time_language keeps the window state as language (the §A6/§D2
     default), value_language states the value instead. Neither arm invents
     scarcity, a countdown, or social proof — the banned vocabulary is banned in
     both, which is what makes the read a read on FRAMING and not on pressure.

     The server is the only thing that decides; this renders the decision. When
     the arm is time_language — or the experiment is absent, or the copy is
     missing — the window language renders exactly as it always has. */
  function offerFraming(offer) {
    var lang = windowLanguage(offer);
    var x = state.payload && state.payload.experiment;
    if (!x || x.slotId !== 'daily_deal') return lang;
    var copy = typeof x.offerCopy === 'string' ? x.offerCopy.trim() : '';
    var isValue = x.variationKey === 'value_language' || x.framing === 'value';
    return (isValue && copy) ? copy : lang;
  }

  function renderDeal(dec) {
    var n = norm(dec.item, { offer: dec.offer, now: demoNow() });
    if (!n) return '';
    if (dec.offer) n.offer = dec.offer;
    if (!n.blurb) n.blurb = DEAL_BLURB[n.cat] || DEAL_BLURB.kitchen;
    var lang = offerFraming(n.offer);
    var inner = '<div class="bh-deal" data-bh-card data-bh-item="' + esc(n.id) + '" data-bh-slot="' + esc(dec.slot_id) +
        '" data-bh-decision="' + esc(dec.decision_id || '') + '">' +
      '<div class="bh-deal__media"><div class="bh-frame bh-frame--square">' + packshot(n) + '</div></div>' +
      '<div class="bh-deal__info">' +
        '<div class="bh-deal__meta">' +
          badgesHtml(n, {}) +
          '<span class="bh-lifecycle">' + esc(n.offer && n.offer.lifecycleState ? n.offer.lifecycleState.replace(/_/g, ' ') : 'live') + '</span>' +
          '<span class="bh-window"><span class="bh-window__dot" aria-hidden="true"></span>' + esc(lang) + '</span>' +
        '</div>' +
        (n.brand ? '<p class="bh-deal__brand">' + esc(n.brand) + '</p>' : '') +
        '<h3 class="bh-deal__name">' + esc(n.name) + '</h3>' +
        (n.blurb ? '<p class="bh-deal__blurb">' + esc(n.blurb) + '</p>' : '') +
        '<div class="bh-deal__price">' + priceHtml(n) + '</div>' +
        starsHtml(n) +
        availHtml(n) +
        '<div class="bh-deal__actions">' + qtyHtml(n) + ctaHtml(n) +
          '<a class="bh-btn bh-btn--secondary" href="#bh-slot-on_air_rail">See it on air</a>' +
        '</div>' +
        '<p class="bh-deal__item-no">Item # ' + esc(n.id) + ' &middot; Shipping &amp; Handling ' + money(dec.item.shippingHandling == null ? 5.5 : dec.item.shippingHandling) + '</p>' +
        (dec.queued ? '<p class="bh-deal__queued">Next up &mdash; another ' + esc(dec.queued.label || 'Bright One') +
          ' is already in <strong>' + esc(dec.queued.lifecycleState || 'preview') + '</strong>, waiting for its window to open.</p>' : '') +
      '</div>' +
    '</div>';
    return slotShell(dec, inner);
  }

  function renderRail(dec, frame) {
    var items = dec.items || (dec.item ? [dec.item] : []);
    var now = demoNow();
    var cards = items.map(function (it) {
      var n = norm(it, { offer: it.offer || dec.offer, now: now });
      return n ? cardHtml(n, { slot: dec.slot_id, decisionId: dec.decision_id, frame: frame }) : '';
    }).join('');
    var kicker = SLOT_META[dec.slot_id] ? SLOT_META[dec.slot_id].kicker : '';
    if (dec.slot_id === 'discovery_rail' && dec.explain && dec.explain.quota_reserved) {
      kicker = 'Held open on purpose — a few things the ranking did not pick.';
    }
    return slotShell(dec, '<div class="bh-rail' + (frame === 'reco' ? ' bh-rail--wide' : '') + '">' + cards + '</div>', { kicker: kicker });
  }

  function renderOnAir(dec) {
    var now = demoNow();
    var leadItem = dec.item ? norm(dec.item, { offer: dec.offer, now: now, live: true }) : null;
    var oa = dec.onAir || {
      show: leadItem ? ('Live from the ' + (CATS[leadItem.cat] || CATS.kitchen).label + ' studio') : 'Live from the studio',
      host: (leadItem && leadItem.host) || 'Our hosts',
      channel: 'BH Live'
    };
    var items = dec.items || [];
    var lead = '<div class="bh-onair__lead">' +
      '<div class="bh-stage">' +
        '<svg viewBox="0 0 600 340" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" style="position:absolute;inset:0;width:100%;height:100%">' +
          '<rect width="600" height="340" fill="#233047"/>' +
          '<circle cx="430" cy="120" r="120" fill="#EF7A5E" opacity=".26"/>' +
          '<circle cx="180" cy="230" r="150" fill="#F6E6E4" opacity=".10"/>' +
          '<rect x="120" y="180" width="360" height="120" rx="6" fill="#FFFFFF" opacity=".07"/>' +
        '</svg>' +
        '<div class="bh-stage__caption">' +
          '<span class="bh-livedot"><i aria-hidden="true"></i>On Air</span>' +
          '<h3>' + esc(oa.show || 'In the Kitchen') + '</h3>' +
          '<p>' + esc(oa.host || 'Our hosts') + ' · ' + esc(oa.channel || 'BH Live') + ' — watch, then shop what you just saw.</p>' +
        '</div>' +
      '</div>' +
      '<div class="bh-onair__blurb">' +
        '<h3 class="bh-slot__title">Items Recently On Air</h3>' +
        '<p>Everything our hosts have held up today, newest first — so you can catch what you missed while the kettle was on.</p>' +
        '<p><a class="bh-btn bh-btn--secondary" href="#bh-slot-deals_rail">Shop Items On Air</a></p>' +
      '</div>' +
    '</div>';
    var seen = {};
    var cards = (leadItem ? [leadItem] : []).concat(items.map(function (it) {
      return norm(it, { offer: it.offer || dec.offer, now: now });
    })).filter(function (n) {
      if (!n || seen[n.id]) return false; seen[n.id] = 1; return true;
    }).map(function (n) {
      return cardHtml(n, { slot: dec.slot_id, decisionId: dec.decision_id, frame: 'square' });
    }).join('');
    return slotShell(dec, lead + '<div class="bh-rail">' + cards + '</div>');
  }

  // A15 #9: the shop-by-category tile grid is page taxonomy, not a decision — it
  // renders alongside whatever the composer ranked into the slot.
  function renderCats(dec) {
    var keys = dec.categories || Object.keys(CATS);
    var tiles = keys.map(function (k) {
      var c = CATS[k]; if (!c) return '';
      return '<a class="bh-cat" href="#bh-slot-deals_rail" data-bh-cat="' + esc(k) + '">' + catDisc(k) + '<span>' + esc(c.label) + '</span></a>';
    }).join('');
    var inner = '<div class="bh-cats">' + tiles + '</div>';
    var items = dec.items || [];
    if (items.length) {
      var now = demoNow();
      inner += '<h3 class="bh-subhead">Picked from your aisles</h3><div class="bh-rail">' +
        items.map(function (it) {
          var n = norm(it, { offer: it.offer || dec.offer, now: now });
          return n ? cardHtml(n, { slot: dec.slot_id, decisionId: dec.decision_id, frame: 'square' }) : '';
        }).join('') + '</div>';
    }
    return slotShell(dec, inner);
  }

  function renderEvent(dec) {
    var ev = dec.event || {};
    var n = norm(dec.item, { offer: dec.offer, now: demoNow() });
    var total = ev.revealCapacity || ev.revealTotal || 40;
    var idx = ev.revealIndex || (dec.offer && dec.offer.revealIndex) || 1;
    if (!ev.name) ev.name = (dec.offer && dec.offer.label) || 'The 120-Hour Reveal';
    if (!ev.lede) ev.lede = 'Five days, ' + total + ' reveals — and you don’t have to sit and watch for them. We’ll keep the current one right here.';
    if (!ev.cadence) ev.cadence = cadenceLanguage(ev.revealCadenceMs) || 'A new reveal every few hours, right through the weekend.';
    var ticks = '';
    for (var i = 1; i <= total; i++) {
      ticks += '<span class="bh-reveal__tick' + (i < idx ? ' bh-reveal__tick--done' : (i === idx ? ' bh-reveal__tick--now' : '')) + '"></span>';
    }
    var inner = '<div class="bh-event">' +
      '<div class="bh-event__head">' +
        '<h3 class="bh-event__title">' + esc(ev.name || 'The 120-Hour Reveal') + '</h3>' +
        '<p class="bh-event__lede">' + esc(ev.lede || '') + '</p>' +
        '<p class="bh-event__cadence">' + esc(ev.cadence || '') + '</p>' +
      '</div>' +
      '<div class="bh-event__body">' +
        '<div>' +
          '<p class="bh-reveal"><span class="bh-reveal__n">' + idx + '</span><span class="bh-reveal__of">Reveal ' + idx + ' of ' + total + '</span></p>' +
          '<div class="bh-reveal__track" role="img" aria-label="Reveal ' + idx + ' of ' + total + '">' + ticks + '</div>' +
        '</div>' +
        (n ? '<div class="bh-event__now">' + cardHtml(n, { slot: dec.slot_id, decisionId: dec.decision_id, frame: 'square', showWindow: true }) + '</div>' : '') +
      '</div>' +
    '</div>';
    return slotShell(dec, inner, { kicker: 'Reveal ' + idx + ' of ' + total + ' — the next one arrives on its own.' });
  }

  function renderDecision(dec) {
    var meta = SLOT_META[dec.slot_id];
    var kind = meta ? meta.render : 'grid';
    if (kind === 'hero') return renderHero(dec);
    if (kind === 'deal') return renderDeal(dec);
    if (kind === 'onair') return renderOnAir(dec);
    if (kind === 'cats') return renderCats(dec);
    if (kind === 'event') return renderEvent(dec);
    if (kind === 'reco') return renderRail(dec, 'reco');
    return renderRail(dec, 'square');
  }

  /* ==========================================================================
   * 8 · STATE + TRANSPORT
   * ======================================================================== */
  var state = {
    visitorId: mintVisitorId(),
    sessionId: mintSessionId(),
    mode: 'browse',
    vipOfferActive: true,
    quotaEnabled: true,
    moduleCount: null,
    epochMs: null,
    payload: null,
    source: 'mock',
    latencyMs: null,
    push: 'not connected',
    eventSink: 'server',
    eventError: null,
    batchSupported: true,
    batchCount: 0,
    lastBatchSize: 0,
    pendingEvents: 0,
    inFlightEvents: 0,
    affinity: null,
    reflexConfig: null,
    localEvents: [],
    cart: 0,
    clockBaseDemo: Date.now(),
    clockBaseReal: Date.now(),
    multiplier: 1,
    /* Beat 2f — the presenter's time-travel offset, in ms of DEMO time. Held
       here and replayed on EVERY composition, so the advanced calendar survives
       a toggle, a boundary refresh, and a WebSocket push. Offer windows only:
       affinity decay is read on real time by the server and must stay that way. */
    clockOffsetMs: 0,
    ws: null,
    wsAttempts: 0,
    boundaryTimer: null,
    refreshTimer: null,
    reqSeq: 0,
    pageInFlight: false,
    pageWanted: false,
    seenImpressions: {}
  };

  function $(id) { return document.getElementById(id); }

  /* ONE Bright Hour request on the wire at a time.
     Composition and telemetry both resolve against the same per-visitor state
     object, and asking it two things at once is asking for a lock-order problem
     in someone else's process. A storefront has no need for request parallelism
     — it needs the next answer to be correct and to arrive. Everything below
     carries a hard timeout, so a single slow call can never own the chain. */
  var apiChain = Promise.resolve();
  var apiWaiting = 0;
  function withApiLock(fn) {
    apiWaiting++;
    var run = apiChain.then(fn, fn);
    apiChain = run.then(function () { apiWaiting--; }, function () { apiWaiting--; });
    return run;
  }

  /* No request from this page may hang indefinitely. A wedged backend must cost
     the presenter a fallback render, never a frozen storefront. */
  function fetchWithTimeout(url, opts, ms) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var o = Object.assign({}, opts);
    if (ctl) o.signal = ctl.signal;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, o).then(
      function (r) { clearTimeout(timer); return r; },
      function (e) { clearTimeout(timer); throw (ctl && ctl.signal.aborted) ? new Error('timeout after ' + ms + 'ms') : e; }
    );
  }

  async function fetchPage() {
    // Composition requests are COALESCED, never overlapped. A presenter flipping
    // two switches quickly, a boundary firing mid-click, or a reset followed by a
    // toggle would otherwise put two questions to the same per-visitor state
    // object at once. One in flight; the latest intent runs next.
    if (state.pageInFlight) { state.pageWanted = true; return; }
    var seq = ++state.reqSeq;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    // The server owns the surface stamp (it must never be trusted from the
    // browser), so the body carries identity + the presenter's switches only.
    var body = JSON.stringify({
      visitorId: state.visitorId, sessionId: state.sessionId, page: 'home',
      missionOverride: state.mode,
      vipOfferActive: state.vipOfferActive,
      quotaEnabled: state.quotaEnabled,
      clockOffsetMs: state.clockOffsetMs
    });
    var payload = null;
    // ?mock=1 forces the offline payload — the storefront still presents if the
    // network or the composer is unavailable, and it exercises the availability
    // states (waitlist / advanced order) the live catalogue may not surface today.
    if (state.forceMock) {
      payload = mockPage({ mode: state.mode, vipOfferActive: state.vipOfferActive });
      state.source = 'mock (forced by ?mock=1)';
      state.latencyMs = 0;
      applyPayload(payload);
      return;
    }
    state.pageInFlight = true;
    try {
      var json = await withApiLock(async function () {
        var res = await fetchWithTimeout(ENDPOINTS.page, {
          method: 'POST', credentials: 'omit', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }, body: body
        }, 8000);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      });
      if (!json || !Array.isArray(json.decisions)) throw new Error('unexpected shape');
      payload = json; state.source = 'api';
    } catch (e) {
      payload = mockPage({ mode: state.mode, vipOfferActive: state.vipOfferActive });
      state.source = 'mock (' + (e && e.message ? e.message : 'unavailable') + ')';
    } finally {
      state.pageInFlight = false;
      if (state.pageWanted) { state.pageWanted = false; setTimeout(fetchPage, 0); }
    }
    if (seq !== state.reqSeq) return;   // superseded — drop it on the floor
    var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
    state.latencyMs = Math.round(t1 - t0);
    applyPayload(payload);
  }

  function applyPayload(p) {
    state.payload = p;
    state.multiplier = (p.demoClock && p.demoClock.multiplier) || 1;
    // nowMs is demo-NOW; epochMs is the catalogue's day epoch. The clock ticks
    // from nowMs — pinning it to epochMs would park the readout at midnight.
    state.clockBaseDemo = pick(p.nowMs, p.epochMs, Date.now());
    state.clockBaseReal = Date.now();
    state.epochMs = p.epochMs || null;
    // The composition's snapshot and the reflex poll are two reads of the same
    // instrument. Whichever was taken LATER wins — otherwise a page response
    // computed before the last batch landed would drag the meters backwards in
    // front of the room.
    adoptAffinity(p.affinitySnapshot, pick(p.nowMs, p.epochMs, Date.now()));
    if (p.sessionMission) state.mode = p.sessionMission;
    if (p.moduleCount != null) state.moduleCount = p.moduleCount;
    render();
    renderPanel();
    scheduleBoundary();
  }

  function render() {
    var p = state.payload;
    var host = $('bh-slots');
    if (!p || !host) return;
    // Re-evaluated per render, so the Glass Box reports the fallback status of
    // the payload ON SCREEN — not a flag latched by some earlier one.
    DERIVED.used = false; DERIVED.note = '';
    var decs = p.decisions.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    // One malformed decision must not blank the storefront mid-demo.
    host.innerHTML = decs.map(function (d) {
      try { return renderDecision(d); }
      catch (e) { console.error('Bright Hour: slot render failed', d && d.slot_id, e); return ''; }
    }).join('');
    // The seen-set SURVIVES a recompose. Wiping it here made every card still on
    // screen re-impress after each refresh — the meter would climb on a toggle
    // the shopper never touched, which is an honesty problem, not just noise.
    // An item that genuinely LEAVES the composition forgets its mark, so it can
    // impress again if the engine later brings it back.
    pruneImpressions();
    wireCards();
    observeImpressions();
    var lr = $('bh-live-region');
    if (lr) lr.textContent = decs.length + ' sections updated.';
  }

  /* -- boundary refresh. Never polling: one timer, aimed at nextTransitionAt. --
     nextTransitionAt and epochMs are both on the DEMO clock, so the real-world
     wait is the demo gap divided by the multiplier. (If the server ever emits a
     wall-clock nextTransitionAt with multiplier 1, this is identical.) */
  function scheduleBoundary() {
    if (state.boundaryTimer) { clearTimeout(state.boundaryTimer); state.boundaryTimer = null; }
    var p = state.payload;
    if (!p || !p.nextTransitionAt) return;
    // The server hands us the REAL instant the boundary lands on when the clock
    // is compressed. Prefer it; fall back to scaling the demo gap ourselves.
    var real;
    if (p.nextTransitionAtReal != null) real = p.nextTransitionAtReal - Date.now();
    else real = (p.nextTransitionAt - pick(p.nowMs, p.epochMs, Date.now())) / (state.multiplier || 1);
    if (!isFinite(real)) return;
    // A boundary already in the past must not become a 1.5s refetch loop — that
    // is polling wearing a costume. Re-ask once, unhurried, and re-plan from the
    // answer.
    if (real < 1000) real = 20000;
    real = Math.min(real, 10 * 60 * 1000);
    state.boundaryTimer = setTimeout(function () { fetchPage(); }, real);
  }

  function scheduleRefresh(ms) {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(function () { fetchPage(); }, ms || 450);
  }

  function connectWs() {
    if (state.wsAttempts > 2) { state.push = 'boundary refresh (no socket)'; renderOps(); return; }
    state.wsAttempts++;
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = proto + '//' + location.host + ENDPOINTS.ws + '?visitorId=' + encodeURIComponent(state.visitorId) + '&surface=brighthour';
    var ws;
    try { ws = new WebSocket(url); } catch (e) { state.push = 'boundary refresh (no socket)'; renderOps(); return; }
    state.ws = ws;
    ws.onopen = function () { state.wsAttempts = 0; state.push = 'websocket connected'; renderOps(); };
    ws.onclose = function () {
      state.push = 'boundary refresh (socket closed)'; renderOps();
      setTimeout(connectWs, 4000);
    };
    ws.onerror = function () { /* onclose follows */ };
    ws.onmessage = function (ev) {
      var msg = null;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg) return;
      if (msg.decisions && Array.isArray(msg.decisions)) { state.source = 'api (push)'; applyPayload(msg); return; }
      if (msg.data && Array.isArray(msg.data.decisions)) { state.source = 'api (push)'; applyPayload(msg.data); return; }
      // any other push means "composition may have changed" — ask for the truth
      fetchPage();
    };
  }

  /* -- Event posting.
        POST /live/api/events is the sink for everything. The server stamps
        surface:'brighthour' itself and forwards into the shared ingestion path;
        posting straight to /realtime/action from the browser would arrive
        UNSTAMPED and land in the other demo's audience space, so that fallback
        is deliberately not taken. credentials:'omit' on every path, no exception.

        A scroll surfaces cards in bulk, so the natural unit here is the BATCH,
        not the single POST — thirty-two impressions become one request. The
        singular endpoint stays wired as an automatic fallback for any server
        build that predates /live/api/events.

        Ordering is safe to defer: the server settles a visitor's event queue
        before answering /live/api/page and /live/api/reflex, so the affinity a
        presenter reads is never behind the events that produced it. -- */
  var BATCH_MAX = 200;        // the endpoint's documented ceiling
  var BATCH_SOFT = 60;        // flush early rather than sit on a big buffer
  var BATCH_DEBOUNCE = 250;   // a scroll's worth of impressions, then go

  var evBuffer = [];
  var evTimer = null;

  function envelope(action, data) {
    var d = data || {};
    return {
      visitorId: state.visitorId,
      sessionId: state.sessionId,
      action: action,
      itemId: d.item_id || d.itemId || undefined,
      data: d,
      timestamp: Date.now()
    };
  }

  /* Passive telemetry: coalesce a burst, then send it as one batch. */
  function queueEvent(action, data) {
    evBuffer.push(envelope(action, data));
    state.pendingEvents = evBuffer.length;
    if (evBuffer.length >= BATCH_SOFT) { flushEvents(); return; }
    if (evTimer) clearTimeout(evTimer);
    evTimer = setTimeout(function () { evTimer = null; flushEvents(); }, BATCH_DEBOUNCE);
  }

  /* Intent (click, add to cart, waitlist, search): flushes immediately, and
     carries any pending impressions out with it so the order the shopper
     actually did things is the order the engine sees. */
  function postEvent(action, data) {
    evBuffer.push(envelope(action, data));
    return flushEvents();
  }

  async function flushEvents() {
    if (evTimer) { clearTimeout(evTimer); evTimer = null; }
    // anything that failed earlier goes out first, ahead of the fresh signals
    var outgoing = state.localEvents.concat(evBuffer);
    state.localEvents = [];
    evBuffer = [];
    state.pendingEvents = 0;
    state.inFlightEvents = outgoing.length;
    if (!outgoing.length) return true;

    var ok = true;
    while (outgoing.length) {
      var chunk = outgoing.splice(0, BATCH_MAX);
      var sent = await sendBatch(chunk);
      if (!sent) {
        // keep it, ordered, for the next attempt — and stop hammering
        state.localEvents = chunk.concat(outgoing, state.localEvents);
        ok = false;
        break;
      }
    }
    state.inFlightEvents = 0;
    renderOps();
    if (ok) refreshAffinity();
    return ok;
  }

  /* Beat 1 is "watch the bar cross θin" — so the instrument cannot wait for the
     next composition. After telemetry lands, re-read JUST the affinity snapshot
     and repaint the meters. Cheap, throttled, and it never re-ranks the page. */
  var affinityAt = 0;      // throttle stamp for the poll itself
  var affinityReadAt = 0;  // engine-time of the snapshot currently on screen

  function adoptAffinity(snap, stampMs) {
    if (!snap) return false;
    var stamp = Number(stampMs) || 0;
    if (state.affinity && stamp < affinityReadAt) return false;
    state.affinity = snap;
    affinityReadAt = stamp;
    return true;
  }

  async function refreshAffinity() {
    var now = Date.now();
    if (now - affinityAt < 700) return;
    affinityAt = now;
    try {
      var r = await withApiLock(function () {
        return fetchWithTimeout(ENDPOINTS.reflex + '?visitorId=' + encodeURIComponent(state.visitorId),
          { method: 'GET', credentials: 'omit', cache: 'no-store' }, 6000);
      });
      if (!r.ok) return;
      var j = await r.json();
      if (j && j.affinity) {
        if (j.config && j.config.dims) state.reflexConfig = j.config.dims;
        if (adoptAffinity(j.affinity, pick(j.now, Date.now()))) renderDims();
      }
    } catch (e) { /* the meters simply stay where they were */ }
  }

  /* ── IDLE DECAY POLL (the Two-Speed beat) ───────────────────────────────
     Decay is computed lazily AT READ, so a vector nobody reads looks frozen
     even while it is decaying. Every other refresh in this file is triggered by
     something happening — a flush, a compose — which is exactly wrong for the
     beat where the point is that NOTHING is happening: the presenter stops
     touching the page for 60–90s and the bars must visibly fall.

     So while the instrument is actually on screen and the page is genuinely
     idle, re-read the snapshot. The bars animate themselves (.bh-dim__bar
     transitions width, and honours prefers-reduced-motion).

     This is a POLL, and it is the page's second interval — but it is presenter
     panel machinery only, and it is not a clock: the demo clock remains the one
     ticking clock on this page, still inside [data-presenter]. */
  var IDLE_POLL_MS = 5000;
  var IDLE_AFTER_MS = 3000;
  var lastActivityAt = Date.now();
  function markActivity() { lastActivityAt = Date.now(); }

  function idleDecayTick() {
    var panel = $('bh-panel');
    if (!panel || panel.hidden) return;               // instrument not visible
    if (document.hidden) return;                      // tab in the background
    if (Date.now() - lastActivityAt < IDLE_AFTER_MS) return;  // not idle yet
    if (state.pendingEvents || state.inFlightEvents) return;  // the flush path has it
    refreshAffinity();
  }

  function initIdleDecay() {
    ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart'].forEach(function (t) {
      window.addEventListener(t, markActivity, { passive: true });
    });
    setInterval(idleDecayTick, IDLE_POLL_MS);
  }

  async function sendBatch(chunk) {
    var body = JSON.stringify({ visitorId: state.visitorId, events: chunk });
    try {
      var r = await withApiLock(function () {
        return fetchWithTimeout(state.batchSupported ? ENDPOINTS.events : ENDPOINTS.event, {
          method: 'POST', credentials: 'omit', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: state.batchSupported ? body : JSON.stringify(chunk[0])
        }, 10000);
      });
      if (r.ok) {
        state.eventSink = 'server';
        state.eventError = null;
        state.batchCount++;
        state.lastBatchSize = state.batchSupported ? chunk.length : 1;
        // singular fallback: this call carried one event, the rest still queue
        if (!state.batchSupported && chunk.length > 1) {
          state.localEvents = chunk.slice(1).concat(state.localEvents);
        }
        return true;
      }
      if (r.status === 404 && state.batchSupported) {
        // older server build — fall back to the singular endpoint and retry once
        state.batchSupported = false;
        return await sendBatch(chunk);
      }
      state.eventError = 'HTTP ' + r.status;
    } catch (e) {
      state.eventError = (e && e.message) ? e.message : 'network';
    }
    state.eventSink = 'local';
    return false;
  }

  /* ==========================================================================
   * 9 · INTERACTION WIRING
   * ======================================================================== */
  function cardContext(el) {
    var card = el.closest('[data-bh-card]');
    if (!card) return null;
    return {
      el: card,
      item_id: card.getAttribute('data-bh-item'),
      slot_id: card.getAttribute('data-bh-slot'),
      decision_id: card.getAttribute('data-bh-decision')
    };
  }

  function wireCards() {
    var host = $('bh-slots');
    if (!host || host.__bhWired) return;
    host.__bhWired = true;

    host.addEventListener('click', function (ev) {
      var qtyBtn = ev.target.closest('[data-bh-qty]');
      if (qtyBtn) {
        var wrapEl = qtyBtn.parentElement;
        var val = wrapEl.querySelector('[data-bh-qtyval]');
        var ctx0 = cardContext(qtyBtn);
        var max = 5;
        var cur = parseInt(val.textContent, 10) || 1;
        var next = Math.min(max, Math.max(1, cur + parseInt(qtyBtn.getAttribute('data-bh-qty'), 10)));
        val.textContent = String(next);
        if (ctx0) queueEvent('quantity_change', { item_id: ctx0.item_id, slot_id: ctx0.slot_id, decision_id: ctx0.decision_id, quantity: next });
        return;
      }

      var cta = ev.target.closest('[data-bh-cta]');
      if (cta) {
        var ctx = cardContext(cta);
        if (!ctx) return;
        var kind = cta.getAttribute('data-bh-cta');
        var qEl = ctx.el.querySelector('[data-bh-qtyval]');
        var quantity = qEl ? (parseInt(qEl.textContent, 10) || 1) : 1;
        if (kind === 'add_to_cart') {
          state.cart += quantity;
          var cc = $('bh-cart-count'); if (cc) cc.textContent = String(state.cart);
          announce('Added to cart.');
        } else {
          announce(kind === 'waitlist' ? 'Added to your waitlist. Your price is held.' : 'Order placed in advance.');
        }
        postEvent(kind, { item_id: ctx.item_id, slot_id: ctx.slot_id, decision_id: ctx.decision_id, quantity: quantity });
        scheduleRefresh(600);
        return;
      }

      var open = ev.target.closest('[data-bh-open]');
      if (open) {
        ev.preventDefault();
        var ctx2 = cardContext(open);
        if (ctx2) { postEvent('product_click', { item_id: ctx2.item_id, slot_id: ctx2.slot_id, decision_id: ctx2.decision_id }); scheduleRefresh(600); }
        return;
      }

      var catLink = ev.target.closest('[data-bh-cat]');
      if (catLink) {
        postEvent('category_click', { category: catLink.getAttribute('data-bh-cat') });
        scheduleRefresh(600);
        return;
      }

      var xb = ev.target.closest('[data-bh-explain]');
      if (xb) { openExplain(xb.getAttribute('data-bh-explain'), xb); }
    });
  }

  /* An impression is a property of the ITEM, not of the slot it happened to
     occupy — the same product surfacing in a second rail is not a second look at
     it. Marks for items the new composition dropped are released, so a genuine
     re-entry can impress again. */
  function pruneImpressions() {
    var live = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-bh-item]'), function (c) {
      var id = c.getAttribute('data-bh-item');
      if (id) live[id] = 1;
    });
    Object.keys(state.seenImpressions).forEach(function (k) {
      if (!live[k]) delete state.seenImpressions[k];
    });
  }

  var io = null;
  function observeImpressions() {
    if (!('IntersectionObserver' in window)) return;
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        // Half the card counts as seen — but a card taller than half the viewport
        // can never reach ratio 0.5, so a substantial slice of it counts too.
        var slice = e.intersectionRect ? e.intersectionRect.height : 0;
        if (e.intersectionRatio < 0.5 && slice < 260) return;
        var card = e.target;
        var key = card.getAttribute('data-bh-item');
        if (!key || state.seenImpressions[key]) { io.unobserve(card); return; }
        state.seenImpressions[key] = 1;
        io.unobserve(card);
        queueEvent('product_view', {
          item_id: card.getAttribute('data-bh-item'),
          slot_id: card.getAttribute('data-bh-slot'),
          decision_id: card.getAttribute('data-bh-decision')
        });
      });
    }, { threshold: [0, 0.25, 0.5] });
    Array.prototype.forEach.call(document.querySelectorAll('[data-bh-card]'), function (c) { io.observe(c); });
  }

  function announce(msg) {
    var lr = $('bh-live-region');
    if (!lr) return;
    lr.textContent = msg;
    setTimeout(function () { if (lr.textContent === msg) lr.textContent = ''; }, 1200);
  }

  /* ==========================================================================
   * 10 · THE GLASS BOX
   * ======================================================================== */
  function fmtClock(ms) {
    var d = new Date(ms);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function demoNow() {
    return state.clockBaseDemo + (Date.now() - state.clockBaseReal) * (state.multiplier || 1);
  }

  function tickClock() {
    var el = $('bh-ops-clock'); if (!el) return;
    var n = demoNow();
    el.textContent = fmtClock(n);
    var iso = $('bh-ops-clock-iso');
    if (iso) iso.textContent = new Date(n).toISOString();
    var nx = $('bh-ops-next');
    var p = state.payload;
    if (nx && p && p.nextTransitionAt) {
      var realLeft = Math.max(0, (p.nextTransitionAt - n) / (state.multiplier || 1) / 1000);
      nx.textContent = new Date(p.nextTransitionAt).toISOString() + '  (' + realLeft.toFixed(0) + 's real)';
    }
  }

  /* "+26h" reads better than 93600000 at two feet from a projector. */
  function fmtOffset(ms) {
    if (!ms) return 'live';
    var sign = ms < 0 ? '−' : '+';
    var t = Math.abs(ms) / 3600000;
    var d = Math.floor(t / 24), h = t % 24;
    var parts = [];
    if (d) parts.push(d + 'd');
    if (h) parts.push((Math.round(h * 10) / 10) + 'h');
    return sign + (parts.join(' ') || '0h');
  }

  function renderOps() {
    var p = state.payload || {};
    var set = function (id, v) { var e = $(id); if (e) e.textContent = v; };
    set('bh-ops-mult', '×' + (state.multiplier || 1));
    var off = $('bh-ops-offset');
    if (off) {
      off.textContent = fmtOffset(state.clockOffsetMs);
      off.classList.toggle('bh-ops__v--hot', !!state.clockOffsetMs);
    }
    set('bh-ops-source', state.source);
    set('bh-ops-latency', state.latencyMs == null ? '—' : state.latencyMs + ' ms');
    set('bh-ops-push', state.push);
    set('bh-ops-visitor', state.visitorId);
    // Beat 13: the arm this visitor is actually in, and how it was decided —
    // 'sdk' means Optimizely bucketed them, not us.
    var x = p.experiment;
    set('bh-ops-experiment', x && x.variationKey
      ? 'Experiment: ' + x.variationKey + ' · ' + (x.source || 'unknown')
      : '—');
    var cfg = null;
    (p.decisions || []).some(function (d) { if (d.explain && d.explain.config_version) { cfg = d.explain.config_version; return true; } return false; });
    set('bh-ops-config', cfg || p.config_version || '—');
    var mode = $('bh-ops-mode');
    if (mode) { mode.textContent = 'Mode: ' + state.mode; mode.setAttribute('aria-pressed', state.mode === 'mission' ? 'true' : 'false'); }
    var vip = $('bh-ops-vip');
    if (vip) { vip.textContent = 'Cardholder offer: ' + (state.vipOfferActive ? 'on' : 'off'); vip.setAttribute('aria-pressed', state.vipOfferActive ? 'true' : 'false'); }
    var quota = $('bh-ops-quota');
    if (quota) { quota.textContent = 'Discovery quota: ' + (state.quotaEnabled ? 'on' : 'off'); quota.setAttribute('aria-pressed', state.quotaEnabled ? 'true' : 'false'); }
    var st = $('bh-ops-status');
    if (st) {
      st.textContent = 'slots rendered: ' + ((p.decisions || []).length) +
        (state.moduleCount != null ? ' (moduleCount ' + state.moduleCount + ')' : '') +
        ' · events: ' + state.eventSink +
        (state.eventSink === 'server'
          ? ' (' + state.batchCount + ' batch' + (state.batchCount === 1 ? '' : 'es') + ', last ' + state.lastBatchSize + ')'
          : ' (' + state.localEvents.length + ' buffered' + (state.eventError ? ', ' + state.eventError : '') + ')') +
        (state.batchSupported ? '' : ' [singular fallback]') +
        (DERIVED.used ? ' · ⚠ ' + DERIVED.note : '');
    }
  }

  /* The engine reports each dimension as a map of VALUE → score
     (category: { "Kitchen & Table": 0.73 }), because a dimension is a space, not
     a number. The instrument shows the leading value and its score — which is
     what makes Beat 1 legible: the bar crossing θin has a NAME on it. A scalar
     is still accepted, for any surface that reports one. */
  function leadingValue(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number') return { value: null, score: raw, others: 0 };
    if (typeof raw === 'object') {
      if (typeof raw.value === 'number') return { value: raw.label || null, score: raw.value, others: 0 };
      var keys = Object.keys(raw).filter(function (k) { return typeof raw[k] === 'number'; });
      if (!keys.length) return null;
      keys.sort(function (a, b) { return raw[b] - raw[a]; });
      return { value: keys[0], score: raw[keys[0]], others: keys.length - 1 };
    }
    return null;
  }

  function tauLabel(ms) {
    if (!ms) return null;
    if (ms >= 86400000) return Math.round(ms / 86400000) + 'd';
    if (ms >= 3600000) return Math.round(ms / 3600000) + 'h';
    return Math.round(ms / 1000) + 's';
  }

  function renderDims() {
    var host = $('bh-dims'); if (!host) return;
    var p = state.payload || {};
    // state.affinity is the freshest read (reflex poll after telemetry); the
    // payload's snapshot is the fallback.
    var snap = state.affinity || p.affinitySnapshot || {};
    var values = snap.dims || snap.dimensions || snap;
    var cfg = state.reflexConfig || {};

    host.innerHTML = DIMENSIONS.map(function (d) {
      // θ and τ come from the ENGINE's own config when it reports it — the panel
      // shows what the engine is actually running, not what the spec says.
      var c = cfg[d.key] || {};
      var thetaIn = (typeof c.thetaIn === 'number') ? c.thetaIn : d.thetaIn;
      var thetaOut = (typeof c.thetaOut === 'number') ? c.thetaOut : d.thetaOut;
      var tauDemo = tauLabel(c.tauMs) || d.tauDemo;
      var lead = leadingValue(values[d.key]);
      // sessionMission is derived and reported at the top level, not as a score
      if (!lead && d.key === 'sessionMission' && p.sessionMission) {
        lead = { value: p.sessionMission, score: null, others: 0 };
      }
      var v = (lead && typeof lead.score === 'number' && isFinite(lead.score)) ? lead.score : 0;
      var hot = v >= thetaIn;
      var readout = lead
        ? (lead.value ? esc(lead.value) + ' · ' : '') + (typeof lead.score === 'number' ? lead.score.toFixed(2) : '—') +
          (lead.others ? ' <span class="bh-dim__more">+' + lead.others + '</span>' : '')
        : '<span class="bh-dim__cold">no signal yet</span>';
      return '<div class="bh-dim">' +
        '<div class="bh-dim__row">' +
          '<span class="bh-dim__name">' + esc(d.label) + '</span>' +
          '<span class="bh-dim__val">' + readout + '</span>' +
        '</div>' +
        '<div class="bh-dim__track">' +
          '<div class="bh-dim__bar' + (hot ? ' bh-dim__bar--hot' : '') + '" style="width:' + (Math.max(0, Math.min(1, v)) * 100).toFixed(1) + '%"></div>' +
          '<div class="bh-dim__theta bh-dim__theta--out" style="left:' + (thetaOut * 100).toFixed(1) + '%"></div>' +
          '<div class="bh-dim__theta bh-dim__theta--in" style="left:' + (thetaIn * 100).toFixed(1) + '%"></div>' +
        '</div>' +
        '<div class="bh-dim__tau">τ ' + tauDemo + ' demo / ' + d.tauProd + ' prod &middot; θin ' + thetaIn.toFixed(2) + '</div>' +
      '</div>';
    }).join('');

    // Beat 10: the audiences the catalogue generated, not ones anybody typed.
    var mem = snap.memberships || snap.audiences || [];
    var memHost = $('bh-memberships');
    if (memHost) {
      memHost.innerHTML = mem.length
        ? mem.map(function (m) { return '<span class="bh-mem">' + esc(m) + '</span>'; }).join('')
        : '<p class="bh-panel__empty">No audience memberships yet — the catalogue generates them as affinity crosses θin.</p>';
    }
  }

  function gateHtml(g, fail) {
    var text;
    if (typeof g === 'string') text = g;
    else if (g && typeof g === 'object') {
      text = (g.gate || g.name || g.rule || 'gate');
      if (g.reason) text += ' (' + g.reason + ')';
      if (g.item) text += ' — ' + g.item;
      if (g.affinity != null) text += ' · affinity ' + Number(g.affinity).toFixed(2);
    } else text = String(g);
    return '<span class="bh-gate bh-gate--' + (fail ? 'fail' : 'pass') + '">' + (fail ? '✖ ' : '✓ ') + esc(text) + '</span>';
  }

  function isVipExclusion(g) {
    var s = (typeof g === 'string') ? g : JSON.stringify(g || '');
    return /vip_offer_exclusion/i.test(s);
  }

  function renderExplains() {
    var host = $('bh-explains'); if (!host) return;
    var decs = ((state.payload && state.payload.decisions) || []).slice()
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    if (!decs.length) { host.innerHTML = '<p class="bh-panel__empty">No decisions in this payload.</p>'; return; }
    host.innerHTML = decs.map(function (d) {
      var x = d.explain || {};
      var fails = (x.gates_failed || []).slice().sort(function (a, b) {
        return (isVipExclusion(b) ? 1 : 0) - (isVipExclusion(a) ? 1 : 0);
      });
      var scores = x.dimension_scores || {};
      var scoreRows = Object.keys(scores).map(function (k) {
        var v = Number(scores[k]) || 0;
        var reg = DIMENSIONS.filter(function (dd) { return dd.key === k; })[0];
        var thIn = reg ? reg.thetaIn : 0.6;
        return '<div class="bh-dim">' +
          '<div class="bh-dim__row"><span class="bh-dim__name">' + esc(k) + '</span><span class="bh-dim__val">' + v.toFixed(2) + '</span></div>' +
          '<div class="bh-dim__track">' +
            '<div class="bh-dim__bar' + (v >= thIn ? ' bh-dim__bar--hot' : '') + '" style="width:' + (Math.max(0, Math.min(1, v)) * 100).toFixed(1) + '%"></div>' +
            '<div class="bh-dim__theta bh-dim__theta--in" style="left:' + (thIn * 100).toFixed(1) + '%"></div>' +
          '</div></div>';
      }).join('');

      // ★ Beat 14 lives here: the composer records every candidate it REFUSED,
      // with the rule that refused it and the affinity it beat. A vip_offer_exclusion
      // is hoisted to the top of the list because that is the moment to click on.
      var excluded = (x.excluded || []).slice().sort(function (a, b) {
        return (isVipExclusion(b) ? 1 : 0) - (isVipExclusion(a) ? 1 : 0);
      });
      var exclHtml = excluded.length ? '<h4 class="bh-xp__h">refused candidates</h4>' + excluded.map(function (c) {
        var scored = c.dimension_scores || {};
        var top = Object.keys(scored).sort(function (a, b) { return (scored[b] || 0) - (scored[a] || 0); })[0];
        var aff = c.affinity != null ? c.affinity : (top ? scored[top] : null);
        return '<div class="bh-excl">' +
          '<div class="bh-excl__name">' + esc(c.name || c.itemId || 'candidate') + '</div>' +
          (c.gates_failed || []).map(function (g) { return gateHtml(g, true); }).join('') +
          '<div class="bh-excl__meta">rank_score ' + esc(c.rank_score == null ? '—' : c.rank_score) +
            (aff != null ? ' · top affinity ' + Number(aff).toFixed(2) : '') + '</div>' +
        '</div>';
      }).join('') : '';

      var badgeText = fails.length ? '✖ ' + fails.length + ' gate' + (fails.length > 1 ? 's' : '')
        : (x.pinned ? 'pinned' : (x.quota_reserved ? 'quota' : 'rank ' + (x.rank_position == null ? '?' : x.rank_position)));

      return '<div class="bh-xp" data-bh-xp="' + esc(d.slot_id) + '">' +
        '<button class="bh-xp__head" type="button" data-bh-xptoggle="' + esc(d.slot_id) + '" aria-expanded="false">' +
          '<span>' + esc(d.slot_id) + (d.strategy ? ' <em>· ' + esc(d.strategy) + '</em>' : '') + '</span>' +
          '<span>' + badgeText + '</span>' +
        '</button>' +
        '<div class="bh-xp__body" hidden>' +
          (fails.length ? '<div>' + fails.map(function (g) { return gateHtml(g, true); }).join('') + '</div>' : '') +
          ((x.gates_passed || []).length ? '<div>' + x.gates_passed.map(function (g) { return gateHtml(g, false); }).join('') + '</div>' : '') +
          '<div style="margin:8px 0 6px">' +
            (x.pinned ? '<span class="bh-flag bh-flag--pin">pinned · ranking skipped</span>' : '') +
            (x.quota_reserved ? '<span class="bh-flag bh-flag--quota">quota_reserved · exposure floor</span>' : '') +
          '</div>' +
          (scoreRows ? '<div>' + scoreRows + '</div>' : '') +
          exclHtml +
          '<dl class="bh-kv">' +
            '<dt>strategy</dt><dd>' + esc(d.strategy || '—') + '</dd>' +
            '<dt>candidates</dt><dd>' + esc(x.candidates_considered == null ? '—' : x.candidates_considered) + '</dd>' +
            '<dt>candidate_set</dt><dd>' + esc((x.candidate_set || []).join(', ') || '—') + '</dd>' +
            '<dt>rank_score</dt><dd>' + esc(x.rank_score == null ? '—' : x.rank_score) + '</dd>' +
            '<dt>rank_position</dt><dd>' + esc(x.rank_position == null ? '—' : x.rank_position) + '</dd>' +
            '<dt>tie_break_hash</dt><dd>' + esc(x.tie_break_hash || '—') + '</dd>' +
            '<dt>config_version</dt><dd>' + esc(x.config_version || '—') + '</dd>' +
            '<dt>latency</dt><dd>' + esc(x.engine_latency_ms == null ? '—' : x.engine_latency_ms + ' ms') + '</dd>' +
            '<dt>decision_id</dt><dd>' + esc(d.decision_id || '—') + '</dd>' +
          '</dl>' +
        '</div>' +
      '</div>';
    }).join('');

    host.querySelectorAll('[data-bh-xptoggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var body = b.nextElementSibling;
        var open = b.getAttribute('aria-expanded') === 'true';
        b.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (body) body.hidden = open;
      });
    });
  }

  function renderPanel() { renderOps(); renderDims(); renderExplains(); tickClock(); }

  function setPanel(open) {
    var panel = $('bh-panel'), btn = $('bh-panel-open');
    if (!panel) return;
    panel.hidden = !open;
    if (btn) btn.hidden = open;
    document.body.classList.toggle('bh-panel-open', open);
    lsSet(NS + 'panel', open ? '1' : '0');
  }

  function openExplain(slotId, btn) {
    setPanel(true);
    Array.prototype.forEach.call(document.querySelectorAll('[data-bh-explain]'), function (b) {
      b.setAttribute('aria-expanded', b === btn ? 'true' : 'false');
    });
    var row = document.querySelector('[data-bh-xp="' + slotId + '"]');
    if (!row) return;
    var head = row.querySelector('[data-bh-xptoggle]');
    var body = row.querySelector('.bh-xp__body');
    if (head && body) { head.setAttribute('aria-expanded', 'true'); body.hidden = false; }
    row.scrollIntoView({ block: 'center', behavior: 'auto' });
  }

  /* ==========================================================================
   * 11 · ACCESSIBILITY CONTROLS
   * ======================================================================== */
  var FONT = { min: 12, max: 24, step: 2, def: 16, key: NS + 'pdfs' };

  function applyTextSize(px, announceIt) {
    var v = Math.max(FONT.min, Math.min(FONT.max, px));
    document.documentElement.style.setProperty('--bh-body-size', v + 'px');
    lsSet(FONT.key, String(v));
    var out = $('bh-text-value'); if (out) out.textContent = v + ' px';
    var minus = $('bh-text-smaller'), plus = $('bh-text-larger');
    if (minus) minus.disabled = v <= FONT.min;
    if (plus) plus.disabled = v >= FONT.max;
    if (announceIt) {
      var a = $('bh-text-announce');
      if (a) { a.textContent = 'Text size ' + v + ' pixels'; setTimeout(function () { a.textContent = ''; }, 500); }
    }
    return v;
  }

  function currentTextSize() {
    var stored = parseInt(lsGet(FONT.key), 10);
    return isFinite(stored) ? stored : FONT.def;
  }

  function initResizer() {
    applyTextSize(currentTextSize(), false);
    var minus = $('bh-text-smaller'), plus = $('bh-text-larger');
    if (minus) minus.addEventListener('click', function () { applyTextSize(currentTextSize() - FONT.step, true); });
    if (plus) plus.addEventListener('click', function () { applyTextSize(currentTextSize() + FONT.step, true); });
  }

  function initNav() {
    var toggles = document.querySelectorAll('.bh-nav__toggle');
    Array.prototype.forEach.call(toggles, function (t) {
      var menu = document.getElementById(t.getAttribute('aria-controls'));
      t.addEventListener('click', function () {
        var open = t.getAttribute('aria-expanded') === 'true';
        Array.prototype.forEach.call(toggles, function (o) {
          o.setAttribute('aria-expanded', 'false');
          var m = document.getElementById(o.getAttribute('aria-controls'));
          if (m) m.hidden = true;
        });
        if (!open) { t.setAttribute('aria-expanded', 'true'); if (menu) menu.hidden = false; }
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      Array.prototype.forEach.call(toggles, function (o) {
        o.setAttribute('aria-expanded', 'false');
        var m = document.getElementById(o.getAttribute('aria-controls'));
        if (m) m.hidden = true;
      });
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('.bh-nav__item')) return;
      Array.prototype.forEach.call(toggles, function (o) {
        o.setAttribute('aria-expanded', 'false');
        var m = document.getElementById(o.getAttribute('aria-controls'));
        if (m) m.hidden = true;
      });
    });

    var form = $('bh-search-form');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('bh-search-input').value.trim();
      if (!q) return;
      postEvent('search', { query: q });
      announce('Searched for ' + q + '.');
      scheduleRefresh(500);
    });

    var cart = $('bh-cart-btn');
    if (cart) cart.addEventListener('click', function () { announce('Your cart holds ' + state.cart + ' item' + (state.cart === 1 ? '' : 's') + '.'); });
  }

  function newViewer() {
    clearOwnKeys();
    state.visitorId = mintVisitorId();
    state.sessionId = mintSessionId();
    state.cart = 0;
    state.localEvents = [];
    state.seenImpressions = {};
    // Anything still queued belongs to the viewer who just left. Posting it now
    // would attribute their impressions to the new one — drop it.
    evBuffer = [];
    if (evTimer) { clearTimeout(evTimer); evTimer = null; }
    state.pendingEvents = 0;
    state.affinity = null;      // a new viewer starts cold, and must LOOK cold
    affinityAt = 0;
    affinityReadAt = 0;
    // New Viewer is the panic button: it returns the WHOLE stage to the
    // known-good cold open, the offer calendar included. A presenter who has
    // travelled +24h and then resets the viewer should not be left composing
    // against tomorrow's windows without having asked for it.
    state.clockOffsetMs = 0;
    var cc = $('bh-cart-count'); if (cc) cc.textContent = '0';
    applyTextSize(FONT.def, false);
    if (state.ws) { try { state.ws.close(); } catch (e) {} }
    state.wsAttempts = 0;
    fetchPage().then(function () { connectWs(); });
  }

  /* Beat 2f — succession on stage.
     Advancing moves the OFFER CALENDAR and nothing else: the slot's queued
     successor becomes its occupant the moment the window boundary is crossed,
     lifecycle chips restate, window language restates. Affinity is untouched —
     the server keeps reading real time for decay, so a decay beat is still
     played by waiting out demo-τ, never by pressing a button here. */
  function advanceClock(ms) {
    state.clockOffsetMs += ms;
    renderOps();
    announce('Demo clock ' + fmtOffset(state.clockOffsetMs) + ' — offer windows only.');
    fetchPage();
  }

  function resetClock() {
    if (!state.clockOffsetMs) return;
    state.clockOffsetMs = 0;
    renderOps();
    announce('Demo clock back to live.');
    fetchPage();
  }

  function initOps() {
    var CLOCK_BTNS = [
      ['bh-ops-clock-1h', 3600000],
      ['bh-ops-clock-6h', 21600000],
      ['bh-ops-clock-24h', 86400000]
    ];
    CLOCK_BTNS.forEach(function (pair) {
      var b = $(pair[0]);
      if (b) b.addEventListener('click', function () { advanceClock(pair[1]); });
    });
    var rst = $('bh-ops-clock-reset');
    if (rst) rst.addEventListener('click', resetClock);

    var mode = $('bh-ops-mode');
    if (mode) mode.addEventListener('click', function () {
      state.mode = state.mode === 'mission' ? 'browse' : 'mission';
      renderOps(); fetchPage();
    });
    var vip = $('bh-ops-vip');
    if (vip) vip.addEventListener('click', function () {
      state.vipOfferActive = !state.vipOfferActive;
      renderOps(); fetchPage();
    });
    var quota = $('bh-ops-quota');
    if (quota) quota.addEventListener('click', function () {
      state.quotaEnabled = !state.quotaEnabled;
      renderOps(); fetchPage();
    });
    var nv = $('bh-ops-newviewer');
    if (nv) nv.addEventListener('click', newViewer);
    var close = $('bh-panel-close');
    if (close) close.addEventListener('click', function () { setPanel(false); });
    var open = $('bh-panel-open');
    if (open) open.addEventListener('click', function () { setPanel(true); });
  }

  /* ==========================================================================
   * 12 · BOOT
   * ======================================================================== */
  function boot() {
    var q = new URLSearchParams(location.search);
    if (q.get('mode') === 'mission') state.mode = 'mission';
    if (q.get('mock') === '1') state.forceMock = true;
    initResizer();
    initNav();
    initOps();
    setPanel(q.get('panel') === '0' ? false : (lsGet(NS + 'panel') !== '0'));
    setInterval(tickClock, 250);
    initIdleDecay();
    fetchPage().then(function () { connectWs(); });
    window.BrightHour = state;   // presenter console handle
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
