/* edge-personalization SDK v0.1.0 — one package: core (identity, transport), emit (four capture paths), listen (decisions). */

// src/sdk/identity.ts
var DEFAULT_VISITOR_KEY = "opt_visitor_id";
var YEAR_SECONDS = 60 * 60 * 24 * 365;
function mintVisitorId(host, key = DEFAULT_VISITOR_KEY) {
  let id = null;
  try {
    id = host.storage.get(key);
  } catch {
  }
  if (!id) {
    try {
      id = host.cookie.get(key);
    } catch {
    }
  }
  if (!id) id = `vis-${host.uuid()}`;
  try {
    host.storage.set(key, id);
  } catch {
  }
  try {
    host.cookie.set(key, id, YEAR_SECONDS);
  } catch {
  }
  return id;
}
function mintAnonId(host) {
  return `v-${host.uuid().replace(/-/g, "").slice(0, 9).toUpperCase()}`;
}
function mintSessionId(host) {
  return `s-${host.now().toString(36).toUpperCase()}`;
}
function entrySignals(host) {
  let utmMedium = "", utmSource = "";
  try {
    const usp = new URLSearchParams(host.location?.search ?? "");
    utmMedium = usp.get("utm_medium") ?? "";
    utmSource = usp.get("utm_source") ?? "";
  } catch {
  }
  return { utmMedium, utmSource, referrer: host.referrer ?? "", siteHost: host.location?.hostname ?? "" };
}

// src/sdk/wire.ts
var WIRE = {
  page_view: { type: "page_view" },
  product_view: { type: "product_view" },
  add_to_cart: { type: "add_to_cart" },
  wishlist_add: { type: "wishlist_add" },
  email_open: { type: "email_open" },
  form_submit: { type: "form_submit" },
  button_click: { type: "button_click" },
  custom: { type: "custom" },
  // Not yet first-class server-side; named honestly inside the payload.
  purchase: { type: "custom", event: "purchase" },
  content_impression: { type: "custom", event: "content_impression" },
  content_click: { type: "custom", event: "content_click" },
  content_dwell: { type: "custom", event: "content_dwell" },
  video_complete: { type: "custom", event: "video_complete" }
};
function toWire(type, data) {
  const m = WIRE[type] ?? WIRE.custom;
  return { type: m.type, data: m.event ? { event: m.event, ...data } : { ...data } };
}

// src/sdk/core.ts
var DEFAULT_PATHS = {
  action: "/realtime/action",
  ws: "/realtime/ws",
  reflex: "/realtime/reflex",
  snapshot: "/v1/{tenant}/decisions/snapshot"
};
function resolveConfig(c, host) {
  const origin = host.location ? `${host.location.protocol}//${host.location.host}` : "";
  return {
    tenant: c.tenant,
    ...c.brand ? { brand: c.brand } : {},
    endpoint: (c.endpoint ?? origin).replace(/\/+$/, ""),
    ...c.sdkKey ? { sdkKey: c.sdkKey } : {},
    source: c.source ?? "sdk",
    ...c.surface ? { surface: c.surface } : {},
    listenOnly: Boolean(c.listenOnly),
    heartbeatMs: c.heartbeatMs ?? 25e3,
    reconnectMs: c.reconnectMs ?? 3e3,
    hydrateTimeoutMs: c.hydrateTimeoutMs ?? 1500,
    visitorIdKey: c.visitorIdKey ?? DEFAULT_VISITOR_KEY,
    paths: { ...DEFAULT_PATHS, ...c.paths ?? {} }
  };
}
function createCore(config, host) {
  const cfg = resolveConfig(config, host);
  const visitorId = mintVisitorId(host, cfg.visitorIdKey);
  const anonId = mintAnonId(host);
  const sessionId = mintSessionId(host);
  const entry = entrySignals(host);
  const listeners = /* @__PURE__ */ new Map();
  function on(event, fn) {
    const set = listeners.get(event) ?? /* @__PURE__ */ new Set();
    set.add(fn);
    listeners.set(event, set);
    return () => {
      set.delete(fn);
    };
  }
  function emit(event, ...args) {
    for (const fn of listeners.get(event) ?? []) {
      try {
        fn(...args);
      } catch {
      }
    }
  }
  let lastAppliedTs;
  function applyIncoming(update, fromPush, rttMs) {
    if (typeof update.timestamp === "number") {
      if (fromPush && update.timestamp === lastAppliedTs) return;
      lastAppliedTs = update.timestamp;
    }
    emit("update", update, { fromPush, rttMs });
  }
  function url(path, query) {
    const base = `${cfg.endpoint}${path.replace("{tenant}", encodeURIComponent(cfg.tenant))}`;
    const parts = Object.entries(query ?? {}).filter(([, v]) => v !== void 0 && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return parts.length ? `${base}?${parts.join("&")}` : base;
  }
  function headers(extra = {}) {
    return { ...cfg.sdkKey ? { "X-SDK-Key": cfg.sdkKey } : {}, ...extra };
  }
  function envelope(type, data = {}) {
    const w = toWire(type, data);
    return {
      type: w.type,
      userId: visitorId,
      anonymousId: anonId,
      sessionId,
      data: w.data,
      source: cfg.source,
      ...cfg.surface ? { surface: cfg.surface } : {},
      entry,
      timestamp: host.now()
    };
  }
  async function send(type, data = {}, opts = {}) {
    const env = envelope(type, data);
    const body = JSON.stringify(env);
    const target = url(cfg.paths.action);
    if (opts.beacon && host.sendBeacon) {
      let ok = false;
      try {
        ok = host.sendBeacon(target, body);
      } catch {
        ok = false;
      }
      if (ok) {
        emit("sent", env, { via: "beacon" });
        return null;
      }
    }
    const t0 = host.now();
    try {
      const res = await host.fetch(target, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        credentials: "include",
        body,
        ...opts.keepalive ? { keepalive: true } : {}
      });
      const json = await res.json();
      emit("sent", env, { via: "fetch" });
      if (json?.odp) emit("receipt", json.odp);
      const update = json?.update?.data ?? null;
      if (update) applyIncoming(update, false, host.now() - t0);
      return update;
    } catch {
      return null;
    }
  }
  async function getJson(path, query) {
    try {
      const res = await host.fetch(url(path, query), { method: "GET", headers: headers(), credentials: "include" });
      return await res.json();
    } catch {
      return null;
    }
  }
  let socket = null;
  let status = host.openSocket ? "closed" : "unavailable";
  let wanted = false;
  let heartbeat = null;
  let reconnectTimer = null;
  function setStatus(s) {
    status = s;
    emit("socket", s);
  }
  function socketUrl() {
    if (!cfg.endpoint) return null;
    const base = cfg.endpoint.replace(/^http(s?):/, (_m, secure) => `ws${secure}:`);
    const q = new URLSearchParams({ userId: visitorId, ...cfg.sdkKey ? { sdkKey: cfg.sdkKey } : {} });
    return `${base}${cfg.paths.ws}?${q.toString()}`;
  }
  function handleFrame(raw) {
    let msg;
    try {
      msg = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const data = msg.data ?? {};
    switch (msg.type) {
      case "connected":
        setStatus("connected");
        return;
      case "heartbeat_response":
        return;
      case "odp_receipt":
        emit("receipt", data);
        return;
      case "content_decisions":
        emit("decisions", msg);
        return;
      default:
        break;
    }
    if (msg.type === "audience_published" || data.audienceWentLive) emit("audience", data.audienceWentLive ?? msg.audienceWentLive ?? data);
    if (msg.type === "personalization_update" || msg.type === "segment_update" || data.segments) {
      const ms = typeof data.decisionMs === "number" ? data.decisionMs : null;
      applyIncoming(data, true, ms);
    }
  }
  function stopHeartbeat() {
    if (heartbeat !== null) {
      host.clearInterval(heartbeat);
      heartbeat = null;
    }
  }
  function connect() {
    wanted = true;
    if (!host.openSocket) {
      setStatus("unavailable");
      return;
    }
    const target = socketUrl();
    if (!target) {
      setStatus("unavailable");
      return;
    }
    if (reconnectTimer !== null) {
      host.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    setStatus("connecting");
    try {
      socket = host.openSocket(target);
    } catch {
      setStatus("error");
      return;
    }
    const s = socket;
    s.onopen = () => {
      setStatus("connected");
      stopHeartbeat();
      heartbeat = host.setInterval(() => {
        if (s.readyState === 1) {
          try {
            s.send(JSON.stringify({ type: "heartbeat" }));
          } catch {
          }
        }
      }, cfg.heartbeatMs);
    };
    s.onmessage = (ev) => handleFrame(ev.data);
    s.onerror = () => setStatus("error");
    s.onclose = () => {
      stopHeartbeat();
      if (!wanted) {
        setStatus("closed");
        return;
      }
      setStatus("reconnecting");
      reconnectTimer = host.setTimeout(() => {
        reconnectTimer = null;
        if (wanted) connect();
      }, cfg.reconnectMs);
    };
  }
  function disconnect() {
    wanted = false;
    stopHeartbeat();
    if (reconnectTimer !== null) {
      host.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    try {
      socket?.close();
    } catch {
    }
    socket = null;
    setStatus("closed");
  }
  return {
    config: cfg,
    host,
    visitorId,
    anonId,
    sessionId,
    entry,
    get socketStatus() {
      return status;
    },
    on,
    emit,
    envelope,
    send,
    url,
    headers,
    getJson,
    connect,
    disconnect,
    applyIncoming
  };
}

// src/sdk/emit.ts
var first = (v) => Array.isArray(v) && v[0] && typeof v[0] === "object" ? v[0] : {};
var eco = (e) => e.ecommerce && typeof e.ecommerce === "object" ? e.ecommerce : e;
function ga4Item(e) {
  const it = first(eco(e).items);
  return {
    productId: String(it.item_id ?? it.id ?? ""),
    ...it.item_name !== void 0 ? { name: it.item_name } : {},
    ...it.price !== void 0 ? { price: it.price } : {},
    ...it.item_category !== void 0 ? { category: it.item_category } : {},
    ...it.item_brand !== void 0 ? { brand: it.item_brand } : {},
    ...it.item_variant !== void 0 ? { variant: it.item_variant } : {}
  };
}
var GA4_MAPPING = {
  page_view: (e) => ({ type: "page_view", data: { path: e.page_location ?? e.page_path ?? "" } }),
  view_item: (e) => {
    const d = ga4Item(e);
    return d.productId ? { type: "product_view", data: d } : null;
  },
  add_to_cart: (e) => {
    const d = ga4Item(e);
    return d.productId ? { type: "add_to_cart", data: d } : null;
  },
  add_to_wishlist: (e) => {
    const d = ga4Item(e);
    return d.productId ? { type: "wishlist_add", data: d } : null;
  },
  purchase: (e) => {
    const x = eco(e);
    const items = Array.isArray(x.items) ? x.items.map((it) => ({
      productId: String(it.item_id ?? it.id ?? ""),
      quantity: it.quantity ?? 1,
      ...it.price !== void 0 ? { price: it.price } : {}
    })) : [];
    return { type: "purchase", data: { orderId: String(x.transaction_id ?? ""), value: Number(x.value ?? 0), currency: x.currency ?? "USD", items } };
  }
};
function createEmit(core, listen) {
  const host = core.host;
  const track = (type, data = {}) => core.send(type, data);
  const withItem = (type) => (productId, attrs = {}) => track(type, { productId, ...attrs });
  const withContent = (type) => (contentId, slot, attrs = {}) => track(type, { contentId, slot, ...attrs });
  function declarative(opts = {}) {
    if (core.config.listenOnly) return () => {
    };
    const dom = opts.dom ?? host.dom;
    if (!dom) return () => {
    };
    const dwellMinMs = opts.dwellMinMs ?? 1e3;
    const offs = [];
    const seen = /* @__PURE__ */ new Set();
    for (const el of dom.querySelectorAll("[data-op-content]")) {
      const contentId = el.getAttribute("data-op-content") ?? "";
      const slot = el.getAttribute("data-op-slot") ?? "unknown";
      if (!contentId) continue;
      const attrs = { contentId, slot, ...el.getAttribute("data-op-type") ? { contentType: el.getAttribute("data-op-type") } : {} };
      let shownAt = null;
      offs.push(dom.observe(el, (visible) => {
        if (visible) {
          if (shownAt === null) shownAt = host.now();
          const key = `${slot}:${contentId}`;
          if (!seen.has(key)) {
            seen.add(key);
            void track("content_impression", attrs);
          }
          return;
        }
        if (shownAt === null) return;
        const ms = host.now() - shownAt;
        shownAt = null;
        if (ms >= dwellMinMs) void track("content_dwell", { ...attrs, ms });
      }));
      el.addEventListener("click", () => {
        void track("content_click", attrs);
      });
    }
    for (const el of dom.querySelectorAll("[data-op-track]")) {
      const type = el.getAttribute("data-op-track") ?? "";
      if (!(type in WIRE)) continue;
      const label = el.getAttribute("data-op-label");
      const productId = el.getAttribute("data-op-product");
      el.addEventListener("click", () => {
        void track(type, { ...label ? { label } : {}, ...productId ? { productId } : {} });
      });
    }
    return () => {
      for (const off of offs) off();
    };
  }
  function dataLayer(opts = {}) {
    const layer = opts.layer ?? host.dataLayer;
    if (!layer) return () => {
    };
    const mapping = { ...GA4_MAPPING, ...opts.mapping ?? {} };
    const handle = (entry) => {
      if (!entry || typeof entry !== "object") return;
      const e = entry;
      const name = typeof e.event === "string" ? e.event : null;
      if (!name) return;
      const m = mapping[name];
      if (!m) return;
      let mapped = null;
      try {
        mapped = m(e);
      } catch {
        mapped = null;
      }
      if (mapped) void track(mapped.type, mapped.data);
    };
    if (opts.replay !== false) for (const entry of [...layer]) handle(entry);
    const original = layer.push;
    layer.push = function(...args) {
      const r = original.apply(layer, args);
      for (const a of args) handle(a);
      return r;
    };
    return () => {
      layer.push = original;
    };
  }
  return {
    track,
    pageView: (data = {}) => track("page_view", { path: host.location?.href ?? "", ...data }),
    productView: withItem("product_view"),
    addToCart: withItem("add_to_cart"),
    wishlistAdd: withItem("wishlist_add"),
    purchase: (input) => core.send("purchase", { ...input }, { keepalive: true }),
    contentImpression: withContent("content_impression"),
    contentClick: withContent("content_click"),
    contentDwell: (contentId, slot, ms, attrs = {}) => track("content_dwell", { contentId, slot, ms, ...attrs }),
    videoComplete: withContent("video_complete"),
    custom: (name, data = {}) => track("custom", { event: name, ...data }),
    declarative,
    dataLayer,
    rendered: (slot, contentId, el) => listen.rendered(slot, contentId, el)
  };
}

// src/sdk/listen.ts
function createListen(core, opts = {}) {
  const host = core.host;
  const dwellMinMs = opts.dwellMinMs ?? 1e3;
  const slotSubs = /* @__PURE__ */ new Map();
  const setSubs = /* @__PURE__ */ new Set();
  const impressed = /* @__PURE__ */ new Set();
  let current = null;
  function notifyAbsence() {
    for (const cb of setSubs) {
      try {
        cb(null);
      } catch {
      }
    }
  }
  function apply(set) {
    current = set;
    impressed.clear();
    const bySlot = /* @__PURE__ */ new Map();
    for (const d of set.decisions ?? []) {
      const list = bySlot.get(d.slot) ?? [];
      list.push(d);
      bySlot.set(d.slot, list);
    }
    for (const list of bySlot.values()) list.sort((a, b) => a.order - b.order);
    for (const [slot, subs] of slotSubs) {
      const list = bySlot.get(slot) ?? [];
      for (const cb of subs) {
        try {
          cb(list, set);
        } catch {
        }
      }
    }
    for (const cb of setSubs) {
      try {
        cb(set);
      } catch {
      }
    }
  }
  core.on("decisions", (set) => apply(set));
  async function hydrate(o) {
    let settled = false;
    let timedOut = false;
    const timer = host.setTimeout(() => {
      if (!settled) {
        timedOut = true;
        notifyAbsence();
      }
    }, core.config.hydrateTimeoutMs);
    const json = await core.getJson(core.config.paths.snapshot, {
      page: o.page,
      visitorId: core.visitorId,
      brand: core.config.brand,
      channel: o.channel
    });
    settled = true;
    host.clearTimeout(timer);
    if (!json || json.ok !== true || !Array.isArray(json.decisions)) {
      if (!timedOut) notifyAbsence();
      return null;
    }
    const set = {
      page: json.page ?? o.page,
      ...json.arm ? { arm: json.arm } : {},
      ...json.versions ? { versions: json.versions } : {},
      ...json.config_label ? { config_label: json.config_label } : {},
      ...typeof json.ts === "number" ? { ts: json.ts } : {},
      decisions: json.decisions
    };
    apply(set);
    return set;
  }
  function subscribe(slot, cb) {
    const set = slotSubs.get(slot) ?? /* @__PURE__ */ new Set();
    set.add(cb);
    slotSubs.set(slot, set);
    if (current) {
      const list = (current.decisions ?? []).filter((d) => d.slot === slot).sort((a, b) => a.order - b.order);
      try {
        cb(list, current);
      } catch {
      }
    }
    return () => {
      set.delete(cb);
    };
  }
  function onDecisions(cb) {
    setSubs.add(cb);
    return () => {
      setSubs.delete(cb);
    };
  }
  function rendered(slot, contentId, el) {
    if (core.config.listenOnly) return;
    const key = `${slot}:${contentId}`;
    if (impressed.has(key)) return;
    impressed.add(key);
    const piece = (current?.decisions ?? []).find((d) => d.slot === slot && d.contentId === contentId);
    const data = { contentId, slot, ...piece ? { customerContentId: piece.customerContentId, contentType: piece.type } : {} };
    void core.send("content_impression", data);
    if (el && host.dom) {
      let shownAt = null;
      const off = host.dom.observe(el, (visible) => {
        if (visible) {
          if (shownAt === null) shownAt = host.now();
          return;
        }
        if (shownAt === null) return;
        const ms = host.now() - shownAt;
        shownAt = null;
        if (ms >= dwellMinMs) void core.send("content_dwell", { ...data, ms });
        off();
      });
    }
  }
  return { hydrate, subscribe, onDecisions, apply, current: () => current, rendered };
}

// src/sdk/memoryHost.ts
function memoryHost(overrides = {}) {
  const storage = /* @__PURE__ */ new Map();
  const cookies = /* @__PURE__ */ new Map();
  const base = {
    now: () => Date.now(),
    uuid: () => `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
    storage: { get: (k) => storage.get(k) ?? null, set: (k, v) => {
      storage.set(k, v);
    } },
    cookie: { get: (k) => cookies.get(k) ?? null, set: (k, v) => {
      cookies.set(k, v);
    } },
    location: null,
    referrer: "",
    fetch: async () => ({ ok: false, status: 0, json: async () => null }),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (h) => globalThis.clearInterval(h)
  };
  return { ...base, ...overrides };
}

// src/sdk/host.ts
function domOf(doc, win) {
  return {
    querySelectorAll: (sel) => Array.from(doc.querySelectorAll(sel)),
    observe: (el, cb) => {
      if (typeof win.IntersectionObserver !== "function") {
        cb(true);
        return () => {
        };
      }
      const io = new win.IntersectionObserver((entries) => {
        for (const e of entries) cb(e.intersectionRatio >= 0.5);
      }, { threshold: [0, 0.5] });
      io.observe(el);
      return () => io.disconnect();
    }
  };
}
function browserHost() {
  const win = globalThis;
  const doc = typeof document !== "undefined" ? document : void 0;
  const loc = typeof location !== "undefined" ? location : void 0;
  const nav = typeof navigator !== "undefined" ? navigator : void 0;
  const cookieRe = (k) => new RegExp(`(?:^|;\\s*)${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]+)`);
  return {
    now: () => Date.now(),
    uuid: () => win.crypto && typeof win.crypto.randomUUID === "function" ? win.crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    storage: {
      get: (k) => {
        try {
          return win.localStorage.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          win.localStorage.setItem(k, v);
        } catch {
        }
      }
    },
    cookie: {
      get: (k) => {
        try {
          return (doc?.cookie.match(cookieRe(k)) ?? [])[1] ?? null;
        } catch {
          return null;
        }
      },
      set: (k, v, maxAge) => {
        try {
          if (doc) doc.cookie = `${k}=${v}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
        } catch {
        }
      }
    },
    location: loc ? { href: loc.href, host: loc.host, hostname: loc.hostname, protocol: loc.protocol, search: loc.search } : null,
    referrer: doc?.referrer ?? "",
    fetch: (url, init) => win.fetch(url, init),
    ...nav && typeof nav.sendBeacon === "function" ? { sendBeacon: (url, body) => {
      try {
        return nav.sendBeacon(url, new Blob([body], { type: "application/json" }));
      } catch {
        return false;
      }
    } } : {},
    ...typeof win.WebSocket === "function" ? { openSocket: (url) => new win.WebSocket(url) } : {},
    setTimeout: (fn, ms) => win.setTimeout(fn, ms),
    clearTimeout: (h) => win.clearTimeout(h),
    setInterval: (fn, ms) => win.setInterval(fn, ms),
    clearInterval: (h) => win.clearInterval(h),
    onPageHide: (fn) => {
      try {
        win.addEventListener("pagehide", fn);
      } catch {
      }
      try {
        doc?.addEventListener("visibilitychange", () => {
          if (doc.visibilityState === "hidden") fn();
        });
      } catch {
      }
    },
    ...doc ? { dom: domOf(doc, win) } : {},
    ...Array.isArray(win.dataLayer) ? { dataLayer: win.dataLayer } : {}
  };
}

// src/sdk/version.ts
var VERSION = "0.1.0";

// src/sdk/index.ts
function createClient(config, host = browserHost(), options = {}) {
  const core = createCore(config, host);
  const listen = createListen(core, options);
  const emit = createEmit(core, listen);
  return {
    VERSION,
    visitorId: core.visitorId,
    sessionId: core.sessionId,
    core,
    emit,
    listen,
    connect: () => core.connect(),
    disconnect: () => core.disconnect(),
    on: (event, fn) => core.on(event, fn)
  };
}
export {
  DEFAULT_PATHS,
  GA4_MAPPING,
  VERSION,
  browserHost,
  createClient,
  createCore,
  createEmit,
  createListen,
  memoryHost
};
