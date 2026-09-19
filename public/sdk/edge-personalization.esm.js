/* edge-personalization SDK v0.2.0 — one package: core (identity, transport), emit (four capture paths), listen (decisions). */

// src/sdk/identity.ts
var DEFAULT_VISITOR_KEY = "opt_visitor_id";
var YEAR_SECONDS = 60 * 60 * 24 * 365;
function writeVisitorId(host, key, id) {
  try {
    host.storage.set(key, id);
  } catch {
  }
  try {
    host.cookie.set(key, id, YEAR_SECONDS);
  } catch {
  }
}
var DEFAULT_SESSION_KEY = "opt_session";
var DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1e3;
function currentSessionId(host, key = DEFAULT_SESSION_KEY, idleMs = DEFAULT_SESSION_IDLE_MS) {
  const now = host.now();
  let stored = null;
  try {
    const raw = host.storage.get(key);
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  const id = stored && typeof stored.id === "string" && typeof stored.at === "number" && now - stored.at < idleMs ? stored.id : mintSessionId(host);
  try {
    host.storage.set(key, JSON.stringify({ id, at: now }));
  } catch {
  }
  return id;
}
function mintSessionId(host) {
  return `s-${host.now().toString(36).toUpperCase()}${host.uuid().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
function rotateBrowsingSession(host, key = DEFAULT_SESSION_KEY) {
  try {
    host.storage.set(key, JSON.stringify({ id: `s-${host.uuid()}`, at: host.now() }));
  } catch {
  }
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
  // First-class since CW3: the conversion event and the four content interactions.
  purchase: { type: "purchase" },
  content_impression: { type: "content_impression" },
  content_click: { type: "content_click" },
  content_dwell: { type: "content_dwell" },
  video_complete: { type: "video_complete" }
};
function toWire(type, data) {
  const m = WIRE[type] ?? WIRE.custom;
  return { type: m.type, data: m.event ? { event: m.event, ...data } : { ...data } };
}

// src/events/actionTypes.ts
var ACTION_EVENT_TYPES = [
  // The original five.
  "email_open",
  "form_submit",
  "page_view",
  "button_click",
  "custom",
  // Retail signals, the Coach storefront's.
  "product_view",
  "add_to_cart",
  "wishlist_add",
  // First-class since CW3. The SDK may still send these as custom + data.event;
  // actionOf() reads both, so its wire table can flip whenever it likes.
  "purchase",
  "content_impression",
  "content_click",
  "content_dwell",
  "video_complete"
];
var ACTION_EVENT_TYPE_SET = new Set(ACTION_EVENT_TYPES);
var isEventNonce = (value) => typeof value === "string" && value.length >= 1 && value.length <= 128 && !/[^A-Za-z0-9_-]/.test(value);
var isEventTimestamp = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());

// src/sdk/core.ts
var DEFAULT_PATHS = {
  identitySession: "/v1/{tenant}/identity/session",
  action: "/realtime/action",
  ws: "/realtime/ws",
  reflex: "/realtime/reflex",
  snapshot: "/v1/{tenant}/decisions/snapshot",
  identityLink: "/v1/{tenant}/identity/link",
  identityDetach: "/v1/{tenant}/identity/detach"
};
function decisionRequiresConsent(set) {
  if (!Array.isArray(set.decisions)) return true;
  return set.arm !== void 0 && set.arm !== "default" || set.decisions.length > 0 && (set.arm !== "default" || set.decisions.some((d) => d?.strategy === "affinity" || Boolean(d?.explain?.drivers?.length)));
}
function resolveConfig(c, host) {
  const origin = host.location ? `${host.location.protocol}//${host.location.host}` : "";
  if (c.sessionBroker !== void 0 && (!origin || !/^\/[A-Za-z0-9_/-]{1,160}$/.test(c.sessionBroker) || c.sessionBroker.startsWith("//"))) throw new Error("First-party broker unavailable");
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
    paths: { ...DEFAULT_PATHS, ...c.paths ?? {} },
    ...c.sessionBroker ? { sessionBroker: origin + c.sessionBroker } : {}
  };
}
function contentInteraction(type, data) {
  return [data.action, data.eventName, data.event, type].map((name) => typeof name === "string" ? name.trim() : "").find((name) => ["content_impression", "content_click", "content_dwell", "video_complete"].includes(name));
}
function createCore(config, host) {
  const cfg = resolveConfig(config, host);
  let visitorId = "", sessionId = "", anonId = "";
  let generation = 0;
  let eventSequence = 0;
  let transitioning = false;
  let capability = "";
  let expiresAt = 0;
  let bootstrapping = null;
  const capabilityKey = `opt_shopper_session:${encodeURIComponent(cfg.endpoint)}:${encodeURIComponent(cfg.tenant)}`;
  const refusalKey = `opt_shopper_refusal:${encodeURIComponent(cfg.endpoint)}:${encodeURIComponent(cfg.tenant)}`;
  const refusalCookie = encodeURIComponent(refusalKey);
  const lifetime = 30 * 86400 * 1e3;
  let instruction;
  let consentTimer;
  let consentClock = -Infinity;
  const consentNow = () => Math.max(host.now(), consentClock);
  const refusalExpiry = {};
  const mirrorOwned = {};
  const mirrorExpected = {};
  const mirrorRevision = {};
  const sharedPending = {};
  function readRefusal() {
    const result = {};
    for (const key of ["tracking", "personalization"]) {
      delete sharedPending[key];
      try {
        const raw = host.cookie.get(`${refusalCookie}_${key}`);
        if (!raw) continue;
        const v = JSON.parse(decodeURIComponent(raw));
        if (v.version !== 1 || v.endpoint !== cfg.endpoint || v.tenant !== cfg.tenant || v.switch !== key) {
          result[key] = false;
          continue;
        }
        const choice = v.choice;
        if (choice?.value === false && Number.isSafeInteger(choice.expiresAt) && Number.isSafeInteger(choice.chosenAt) && choice.expiresAt - choice.chosenAt === lifetime && choice.expiresAt > consentNow()) {
          result[key] = false;
          refusalExpiry[key] = choice.expiresAt;
          sharedPending[key] = v.pending === true;
        }
      } catch {
        result[key] = false;
      }
    }
    return result;
  }
  function acceptInstruction(value, subject = visitorId) {
    const v = value;
    if (!v || v.version !== 1 || v.tenant !== cfg.tenant || v.subject !== subject || typeof v.revision !== "string") return false;
    for (const key of ["tracking", "personalization"]) {
      const c = v[key];
      if (c !== void 0 && (typeof c.value !== "boolean" || !Number.isSafeInteger(c.chosenAt) || !Number.isSafeInteger(c.expiresAt) || c.expiresAt - c.chosenAt !== lifetime)) return false;
    }
    instruction = JSON.parse(JSON.stringify(v));
    if (consentTimer !== void 0) host.clearTimeout(consentTimer);
    const schedule = () => {
      const now = consentNow();
      const expiry = Math.min(...["tracking", "personalization"].flatMap((k) => instruction?.[k] && instruction[k].expiresAt > now ? [instruction[k].expiresAt] : []));
      const delay = Math.min(2147483647, Math.max(1, expiry - now));
      if (Number.isFinite(expiry)) consentTimer = host.setTimeout(() => {
        consentClock = Math.max(consentClock, now + delay);
        for (const key of ["tracking", "personalization"]) if (instruction?.[key] && instruction[key].expiresAt <= consentNow()) delete instruction[key];
        if (!instruction?.tracking && !instruction?.personalization) instruction = void 0;
        consentChanged();
        schedule();
      }, delay);
      consentTimer?.unref?.();
    };
    schedule();
    return true;
  }
  const anchorKey = `${capabilityKey}:authority`;
  let anchor = "", transitionExpected;
  let lease;
  const readAnchor = () => host.storage.get(anchorKey) ?? "";
  const sharedCurrent = () => {
    try {
      const observed = readAnchor();
      if (anchor && observed === anchor) return true;
      const saved = observed ? JSON.parse(observed) : void 0;
      if (capability && saved?.version === 1 && saved.persisted === true && saved.pending === false && host.storage.get(capabilityKey) === capability) {
        anchor = observed;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };
  function writeAnchor(persisted, pending = false) {
    if (!lease || lease.generation !== generation) return false;
    const next = JSON.stringify({ version: 1, id: host.uuid(), persisted, pending });
    anchor = next;
    try {
      host.storage.set(anchorKey, next);
      return readAnchor() === next;
    } catch {
      return false;
    }
  }
  function releaseLease(g) {
    if (lease?.generation === g) {
      const release = lease.release;
      lease = void 0;
      release();
    }
  }
  let recovery = {};
  try {
    recovery = readRefusal();
  } catch {
    recovery = { tracking: false, personalization: false };
  }
  const switches = ["tracking", "personalization"];
  const cookieNames = { tracking: "opt_tracking_consent", personalization: "opt_personalization_enabled" };
  const active = { ...recovery };
  const pendingRefusal = {};
  const consentListeners = /* @__PURE__ */ new Set();
  let consentEpoch = 0;
  let activityEpoch = 0;
  let entry;
  let entrySessionId = "";
  function onConsentChange(fn) {
    consentListeners.add(fn);
    return () => {
      consentListeners.delete(fn);
    };
  }
  function notifyConsent() {
    for (const fn of consentListeners) {
      try {
        fn();
      } catch {
      }
    }
  }
  function consentChanged() {
    consentEpoch++;
    entry = void 0;
    entrySessionId = "";
    notifyConsent();
  }
  async function saveRefusal(clear) {
    let marker = { ...recovery, ...pendingRefusal };
    try {
      if (capability && host.storage.get(capabilityKey) !== capability) marker = Object.keys(active).length ? { ...marker, ...active } : { tracking: false, personalization: false };
      const write = () => {
        for (const key of switches) {
          const name = `${refusalCookie}_${key}`, observed = host.cookie.get(name);
          const expiresAt2 = marker[key] === false ? refusalExpiry[key] ?? 0 : 0;
          const copy = {
            version: 1,
            endpoint: cfg.endpoint,
            tenant: cfg.tenant,
            subject: visitorId,
            switch: key,
            revision: mirrorRevision[key] ?? instruction?.revision,
            pending: pendingRefusal[key] === false,
            choice: { value: false, chosenAt: expiresAt2 - lifetime, expiresAt: expiresAt2 }
          };
          if (expiresAt2 > consentNow()) {
            if (observed && observed !== mirrorOwned[key] && observed !== mirrorExpected[key]) continue;
            const bytes = encodeURIComponent(JSON.stringify(copy));
            host.cookie.set(name, bytes, Math.max(0, Math.floor((expiresAt2 - consentNow()) / 1e3)));
            mirrorOwned[key] = bytes;
          } else if (observed && (observed === mirrorOwned[key] || clear && Object.hasOwn(clear, key) && observed === clear[key])) {
            host.cookie.set(name, "", 0);
            delete mirrorOwned[key];
          }
        }
        host.storage.set(refusalKey, "");
      };
      if (lease?.generation === generation && sharedCurrent()) write();
      else if (host.acquireAuthorityLock && sharedCurrent()) {
        const expected = anchor, g = generation;
        await host.acquireAuthorityLock(anchorKey).then((release) => {
          try {
            if (g === generation && readAnchor() === expected) write();
          } finally {
            release();
          }
        }).catch(() => void 0);
      }
    } catch {
    }
  }
  function restrict(value, local = false) {
    if (!value || typeof value !== "object") return;
    const couldCapture = active.tracking !== false && pendingRefusal.personalization !== false;
    let changed = false, save = false;
    for (const key of switches) if (value[key] === false) {
      if (active[key] !== false) {
        active[key] = false;
        changed = true;
      }
      if (local && pendingRefusal[key] !== false) {
        pendingRefusal[key] = false;
        save = true;
      }
    }
    if (couldCapture && (active.tracking === false || pendingRefusal.personalization === false)) activityEpoch++;
    if (save) saveRefusal();
    if (changed || save) consentChanged();
  }
  function acknowledge(value) {
    restrict(value);
    if (!value || typeof value !== "object") return;
    const held = pendingRefusal.personalization === false;
    let cleared = false;
    for (const key of switches) if (value[key] === false && pendingRefusal[key] === false) {
      delete pendingRefusal[key];
      cleared = true;
    }
    if (cleared) saveRefusal();
    if (held && pendingRefusal.personalization !== false) consentChanged();
  }
  function cookieFalse(key) {
    try {
      return host.cookie.get(cookieNames[key]) === "false";
    } catch {
      return false;
    }
  }
  function consent() {
    restrict(readRefusal());
    const hints = {};
    for (const key of switches) if (active[key] !== false && cookieFalse(key)) hints[key] = false;
    restrict(hints, true);
    const allowed = (key) => active[key] !== false && instruction?.[key]?.value === true && instruction[key].chosenAt <= consentNow() && instruction[key].expiresAt > consentNow();
    return { tracking: allowed("tracking"), personalization: allowed("personalization") };
  }
  function trackingAllowed() {
    return consent().tracking && pendingRefusal.personalization !== false && !sharedPending.personalization && !transitioning;
  }
  function personalizationAllowed() {
    const c = consent();
    return c.tracking && c.personalization && !transitioning;
  }
  function capture(fn) {
    if (transitioning) return;
    if (isCurrent(generation)) {
      if (trackingAllowed()) fn();
      return;
    }
    const pending = ready(), g = generation, epoch = activityEpoch;
    void pending.then((ok) => {
      if (ok && isCurrent(g) && epoch === activityEpoch && trackingAllowed()) {
        try {
          fn();
        } catch {
        }
      }
    });
  }
  function rememberUnknownConsent() {
    recovery = { tracking: false, personalization: false };
    for (const key of switches) if (instruction?.[key]) refusalExpiry[key] = instruction[key].expiresAt;
    restrict(recovery);
    saveRefusal();
  }
  const session = () => {
    if (!trackingAllowed()) return "";
    const current = currentSessionId(host);
    if (entrySessionId !== current) {
      entrySessionId = current;
      entry = void 0;
    }
    return current;
  };
  const entryOf = () => {
    if (!trackingAllowed()) return { utmMedium: "", utmSource: "", referrer: "", siteHost: "" };
    session();
    return entry ??= entrySignals(host);
  };
  const listeners = /* @__PURE__ */ new Map();
  let updateDelivery = 0;
  function on(event, fn) {
    const set = listeners.get(event) ?? /* @__PURE__ */ new Set();
    set.add(fn);
    listeners.set(event, set);
    return () => {
      set.delete(fn);
    };
  }
  function emit(event, ...args) {
    const g = generation;
    const delivery = event === "update" ? ++updateDelivery : updateDelivery;
    for (const fn of listeners.get(event) ?? []) {
      if (generation !== g || event === "update" && delivery !== updateDelivery || ["sent", "receipt", "update", "audience", "decisions", "identity"].includes(event) && !isCurrent(g) || (event === "sent" || event === "receipt") && !trackingAllowed() || (event === "update" || event === "audience") && !personalizationAllowed() || event === "decisions" && decisionRequiresConsent(args[0]) && !personalizationAllowed() || event === "update" && (generation !== g || delivery !== updateDelivery)) break;
      try {
        fn(...args);
      } catch {
      }
    }
  }
  let lastAppliedTs;
  const updateEchoes = /* @__PURE__ */ new Set();
  let updateEchoUnits = 0;
  function receiveUpdate(update, fromPush, rttMs) {
    const g = generation, owner = updateDelivery;
    const current = () => personalizationAllowed() && isCurrent(g) && owner === updateDelivery;
    if (!current()) return false;
    const timestamp = update.timestamp;
    if (!current()) return false;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      if (lastAppliedTs !== void 0 && timestamp < lastAppliedTs) return false;
      let fingerprint;
      try {
        fingerprint = JSON.stringify(update);
      } catch {
      }
      if (!current()) return false;
      if (lastAppliedTs === void 0 || timestamp > lastAppliedTs) {
        lastAppliedTs = timestamp;
        updateEchoes.clear();
        updateEchoUnits = 0;
      }
      if (typeof fingerprint === "string" && fingerprint.length <= 65536) {
        if (updateEchoes.has(fingerprint)) return false;
        while (updateEchoes.size >= 32 || updateEchoUnits + fingerprint.length > 65536) {
          const oldest = updateEchoes.values().next().value;
          updateEchoes.delete(oldest);
          updateEchoUnits -= oldest.length;
        }
        updateEchoes.add(fingerprint);
        updateEchoUnits += fingerprint.length;
      }
    }
    emit("update", update, { fromPush, rttMs });
    return personalizationAllowed() && g === generation && updateDelivery === owner + 1;
  }
  function applyIncoming(update, fromPush, rttMs) {
    receiveUpdate(update, fromPush, rttMs);
  }
  function url(path, query) {
    const base = `${cfg.endpoint}${path.replace("{tenant}", encodeURIComponent(cfg.tenant))}`;
    const parts = Object.entries(query ?? {}).filter(([, v]) => v !== void 0 && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return parts.length ? `${base}?${parts.join("&")}` : base;
  }
  function headers(extra = {}) {
    return { ...cfg.sdkKey ? { "X-SDK-Key": cfg.sdkKey } : {}, "X-Tenant": cfg.tenant, ...isCurrent(generation) ? { "X-Shopper-Session": capability } : {}, ...extra };
  }
  function isCurrent(g) {
    return g === generation && !!capability && expiresAt * 1e3 > host.now() && sharedCurrent();
  }
  function beginTransition() {
    try {
      sharedCurrent();
      transitionExpected = capability ? anchor : readAnchor();
    } catch {
      transitionExpected = void 0;
    }
    const g = ++generation;
    transitioning = true;
    bootstrapping = null;
    lastAppliedTs = void 0;
    updateEchoes.clear();
    updateEchoUnits = 0;
    updateDelivery++;
    entry = void 0;
    entrySessionId = "";
    const reconnect = wanted;
    disconnect();
    if (g !== generation) return g;
    wanted = reconnect;
    emit("generation", g);
    return g;
  }
  function finishTransition(g) {
    if (g !== generation) {
      releaseLease(g);
      return;
    }
    if (lease?.generation === g && sharedCurrent()) {
      let persisted = false;
      try {
        persisted = !!capability && host.storage.get(capabilityKey) === capability;
      } catch {
      }
      if (!writeAnchor(persisted)) {
        capability = "";
        expiresAt = 0;
      }
    }
    releaseLease(g);
    transitioning = false;
    notifyConsent();
    if (wanted) connect();
  }
  function forgetSession(g) {
    if (g !== generation) return;
    rememberUnknownConsent();
    capability = "";
    expiresAt = 0;
    visitorId = "";
    sessionId = "";
    anonId = "";
    if (lease?.generation === g && sharedCurrent()) {
      try {
        host.storage.set(capabilityKey, "");
      } catch {
      }
      writeVisitorId(host, cfg.visitorIdKey, "");
      writeAnchor(false);
    }
    if (trackingAllowed()) rotateBrowsingSession(host);
  }
  function adoptSession(value, g, reason) {
    const v = value;
    if (g !== generation || lease?.generation !== g || !sharedCurrent() || !v || v.tenant !== cfg.tenant || typeof v.subject !== "string" || !v.subject || typeof v.sessionId !== "string" || !v.sessionId || typeof v.capability !== "string" || !/^ss1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v.capability) || v.kind !== "anonymous" && v.kind !== "recognized" || typeof v.exp !== "number" || !Number.isSafeInteger(v.exp) || typeof v.iat !== "number" || !Number.isSafeInteger(v.iat) || v.iat > host.now() / 1e3 || v.exp * 1e3 <= host.now() || v.exp - v.iat > 86400 || v.exp <= v.iat) return false;
    if (recovery.tracking === false && v.consent?.tracking !== false || recovery.personalization === false && v.consent?.personalization !== false) return false;
    acknowledge(v.consent);
    instruction = void 0;
    acceptInstruction(v.consent?.instruction, v.subject);
    const acceptedInstruction = instruction;
    for (const key of switches) if (acceptedInstruction?.[key]) refusalExpiry[key] = Math.min(refusalExpiry[key] ?? Infinity, acceptedInstruction[key].expiresAt);
    if (g !== generation) return false;
    const previous = visitorId;
    if (previous && previous !== v.subject && consent().tracking) rotateBrowsingSession(host);
    visitorId = v.subject;
    sessionId = v.sessionId;
    capability = v.capability;
    expiresAt = v.exp;
    anonId = v.kind === "anonymous" ? v.subject : "";
    const retained = { ...active, ...recovery, ...pendingRefusal };
    if (Object.keys(retained).length) saveRefusal();
    try {
      host.storage.set(capabilityKey, capability);
    } catch {
    }
    recovery = {};
    for (const key of switches) if (v.consent?.[key] === false) delete pendingRefusal[key];
    let anchored = false;
    try {
      anchored = host.storage.get(capabilityKey) === capability;
      if (anchored) saveRefusal();
    } catch {
    }
    if (!anchored) try {
      saveRefusal();
    } catch {
    }
    if (!writeAnchor(anchored, transitioning)) {
      capability = "";
      expiresAt = 0;
      return false;
    }
    writeVisitorId(host, cfg.visitorIdKey, visitorId);
    emit("identity", { visitorId, previous, reason });
    if (g !== generation) return false;
    if (wanted && !transitioning) connect();
    return true;
  }
  function ready(transition = false) {
    consent();
    if (transitioning && !transition) return Promise.resolve(false);
    if (isCurrent(generation) && (!transition || lease?.generation === generation)) return Promise.resolve(true);
    if (bootstrapping) return bootstrapping;
    if (capability && !transition) {
      const g2 = beginTransition();
      if (g2 !== generation) return Promise.resolve(false);
      rememberUnknownConsent();
      transitioning = false;
      capability = "";
      expiresAt = 0;
      visitorId = "";
      sessionId = "";
    }
    const g = generation;
    const retiring = { capability, visitorId, expiresAt };
    let revocationAttempted = false;
    const refuseTransition = async () => {
      if (transition && g === generation && retiring.capability && retiring.expiresAt * 1e3 > host.now() && !revocationAttempted) {
        revocationAttempted = true;
        try {
          await host.fetch(url(cfg.paths.identityDetach), {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "X-Tenant": cfg.tenant,
              "X-Shopper-Session": retiring.capability,
              ...cfg.sdkKey ? { "X-SDK-Key": cfg.sdkKey } : {}
            },
            body: JSON.stringify({ visitorId: retiring.visitorId })
          });
        } catch {
        }
        rememberUnknownConsent();
      }
      return false;
    };
    const operation = (async () => {
      try {
        if (!host.acquireAuthorityLock) return refuseTransition();
        if (lease?.generation !== g) {
          const release = await host.acquireAuthorityLock(anchorKey);
          if (g !== generation) {
            release();
            return false;
          }
          lease = { generation: g, release };
          const previous = readAnchor();
          if (transition && transitionExpected !== previous) return refuseTransition();
          anchor = previous;
          let persisted2 = false;
          try {
            persisted2 = !!capability && host.storage.get(capabilityKey) === capability;
          } catch {
          }
          const marker = readRefusal();
          if (Object.keys(marker).length) {
            const value = marker;
            recovery = { ...recovery, ...value };
            restrict(value);
          }
          if (!writeAnchor(persisted2, true)) {
            return refuseTransition();
          }
          if (capability && expiresAt * 1e3 > host.now()) return true;
          let saved;
          try {
            saved = previous ? JSON.parse(previous) : void 0;
          } catch {
            return false;
          }
          if (saved && (saved.persisted !== true || saved.pending === true) && !Object.keys(recovery).length) rememberUnknownConsent();
        }
        let persisted = "";
        try {
          persisted = host.storage.get(capabilityKey) ?? "";
        } catch {
        }
        if (Object.keys(recovery).length) persisted = "";
        const request = () => boundedJSON(cfg.sessionBroker ?? url(cfg.paths.identitySession), { method: "POST", credentials: "include", headers: { ...headers({ "Content-Type": "application/json" }), ...persisted ? { "X-Shopper-Session": persisted } : {} }, body: JSON.stringify(Object.keys(active).length ? { consent: active } : {}) }, 16384);
        let res = await request();
        if (res.status === 401 && persisted && g === generation && !cfg.sessionBroker) {
          rememberUnknownConsent();
          persisted = "";
          try {
            host.storage.set(capabilityKey, "");
          } catch {
          }
          res = await request();
        }
        const body = res.json;
        if (g !== generation) return false;
        if (!res.ok || body?.ok !== true) {
          if (res.status === 401) try {
            host.storage.set(capabilityKey, "");
          } catch {
          }
          return false;
        }
        return adoptSession(body.session, g, "logout");
      } catch {
        return refuseTransition();
      } finally {
        if (!transition) {
          if (g === generation && lease?.generation === g && sharedCurrent()) {
            let persisted = false;
            try {
              persisted = !!capability && host.storage.get(capabilityKey) === capability;
            } catch {
            }
            if (!writeAnchor(persisted)) {
              capability = "";
              expiresAt = 0;
            }
          }
          releaseLease(g);
        }
      }
    })();
    bootstrapping = operation;
    void operation.finally(() => {
      if (bootstrapping === operation) bootstrapping = null;
    });
    return operation;
  }
  function envelope(type, data = {}) {
    const tracking = trackingAllowed();
    const w = toWire(type, tracking ? data : {});
    const timestamp = host.now();
    let eventId;
    if (tracking && isCurrent(generation)) {
      if (!isEventTimestamp(timestamp) || eventSequence >= Number.MAX_SAFE_INTEGER) throw new Error("Event identity unavailable");
      const token = host.uuid();
      if (!isEventNonce(token) || token.length > 96) throw new Error("Event identity unavailable");
      eventId = `${token}-${(++eventSequence).toString(36)}`;
    }
    return {
      ...eventId !== void 0 ? { eventId } : {},
      type: w.type,
      userId: visitorId,
      anonymousId: anonId,
      sessionId,
      browsingSessionId: session(),
      data: w.data,
      source: cfg.source,
      ...cfg.surface ? { surface: cfg.surface } : {},
      entry: entryOf(),
      timestamp
    };
  }
  let contentHandler;
  function bindContent(handler) {
    contentHandler = handler;
    return { send: sendRaw, release() {
      if (contentHandler === handler) contentHandler = void 0;
    } };
  }
  async function send(type, input = {}, opts = {}) {
    const pending = ready(), g = generation, epoch = activityEpoch;
    if (!await pending || !isCurrent(g) || !trackingAllowed() || epoch !== activityEpoch) return null;
    try {
      const data = typeof input === "function" ? input() : input, content = contentInteraction(type, data);
      return content ? contentHandler ? contentHandler(content, data) : null : sendRaw(type, data, opts);
    } catch {
      return null;
    }
  }
  async function sendRaw(type, data = {}, opts = {}) {
    if (transitioning) return null;
    const pending = ready();
    const g = generation, epoch = activityEpoch;
    if (!await pending || !isCurrent(g) || !trackingAllowed() || epoch !== activityEpoch) return null;
    try {
      const env = envelope(type, typeof data === "function" ? data() : data);
      const body = JSON.stringify(env);
      if (!isCurrent(g) || !trackingAllowed() || epoch !== activityEpoch) return null;
      const target = url(cfg.paths.action), t0 = host.now();
      const res = await host.fetch(target, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        credentials: "include",
        body,
        ...opts.keepalive || opts.beacon ? { keepalive: true } : {}
      });
      const json = await res.json();
      if (!res.ok || !isCurrent(g)) return null;
      if (epoch === activityEpoch) acknowledge(json?.consent);
      else restrict(json?.consent);
      if (!trackingAllowed() || epoch !== activityEpoch) return null;
      emit("sent", env, { via: "fetch" });
      if (!isCurrent(g) || !trackingAllowed() || epoch !== activityEpoch) return null;
      if (json?.odp) emit("receipt", json.odp, { via: "fetch" });
      if (!isCurrent(g) || !trackingAllowed() || epoch !== activityEpoch) return null;
      const update = personalizationAllowed() ? json?.update?.data ?? null : null;
      const applied = update && receiveUpdate(update, false, host.now() - t0);
      return applied && isCurrent(g) && personalizationAllowed() ? update : null;
    } catch {
      return null;
    }
  }
  async function boundedJSON(path, init, maxBytes = 2 * 1024 * 1024) {
    const controller = new AbortController();
    let reader;
    const timer = host.setTimeout(() => controller.abort(), 5e3);
    let abort;
    const stopped = new Promise((_, reject) => {
      abort = () => {
        void reader?.cancel().catch(() => void 0);
        reject(new Error("Request deadline"));
      };
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    const work = (async () => {
      const response = await host.fetch(path, { ...init, signal: controller.signal });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => void 0);
        throw new Error("Request deadline");
      }
      if (!response.body) return { ok: response.ok, status: response.status, json: await response.json() };
      reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      for (; ; ) {
        const part = await reader.read();
        if (controller.signal.aborted) throw new Error("Request deadline");
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBytes) throw new Error("Response bound");
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return { ok: response.ok, status: response.status, json: JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) };
    })();
    try {
      return await Promise.race([work, stopped]);
    } finally {
      host.clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
      controller.abort();
      void reader?.cancel().catch(() => void 0);
    }
  }
  async function sendRender(env) {
    const g = generation, epoch = activityEpoch;
    if (transitioning || !isCurrent(g) || !trackingAllowed() || env.type !== "content_impression" || !isEventNonce(env.eventId) || !isEventTimestamp(env.timestamp) || env.userId !== visitorId || env.sessionId !== sessionId || typeof env.data.renderOffer !== "string") return null;
    try {
      const body = JSON.stringify(env);
      const res = await boundedJSON(url(cfg.paths.action), { method: "POST", headers: headers({ "Content-Type": "application/json" }), credentials: "include", body });
      const json = res.json;
      if (!res.ok || !isCurrent(g) || epoch !== activityEpoch) return null;
      acknowledge(json?.consent);
      const ack = json?.render;
      if (!trackingAllowed() || epoch !== activityEpoch || !ack || ack.version !== 1 || ack.status !== "durable" || !["pending", "recovered"].includes(ack.source) || ack.eventId !== env.eventId || ack.decisionId !== env.data.decisionId || ack.pageInstance !== env.data.pageInstance) return null;
      const { renderOffer: _offer, ...data } = env.data;
      void _offer;
      emit("sent", { ...env, data }, { via: "fetch" });
      return isCurrent(g) && epoch === activityEpoch && trackingAllowed() ? { ...ack } : null;
    } catch {
      return null;
    }
  }
  async function matchesSessionWitness(witness) {
    const g = generation, token = capability;
    if (!cfg.sessionBroker || !isCurrent(g) || !/^[a-f0-9]{64}$/.test(witness)) return false;
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((v) => v.toString(16).padStart(2, "0")).join("");
    return isCurrent(g) && token === capability && digest === witness;
  }
  async function getJson(path, query) {
    const pending = ready();
    const g = generation;
    if (!await pending || !isCurrent(g)) return null;
    try {
      if (path === cfg.paths.snapshot) {
        const c = consent();
        query = { ...query, ...!c.tracking ? { browsingSessionId: void 0, channel: void 0, entry: void 0, trackingConsent: "false" } : {}, ...!c.personalization ? { personalizationEnabled: "false" } : {} };
      }
      const epoch = consentEpoch;
      const snapshotRequest = path === cfg.paths.snapshot;
      if (snapshotRequest && (query?.visitorId !== void 0 && query.visitorId !== visitorId || query?.userId !== void 0 && query.userId !== visitorId || query?.sessionId !== void 0 && query.sessionId !== sessionId)) return null;
      const context = snapshotRequest ? { ...query } : void 0;
      if (context) {
        delete context.visitorId;
        delete context.userId;
        delete context.sessionId;
      }
      const res = await boundedJSON(url(path, snapshotRequest ? void 0 : query), snapshotRequest ? { method: "POST", headers: headers({ "Content-Type": "application/json" }), credentials: "include", body: JSON.stringify(context ?? {}) } : { method: "GET", headers: headers(), credentials: "include" });
      const json = res.json;
      if (!res.ok || !isCurrent(g)) return null;
      if (path === cfg.paths.snapshot) {
        if (epoch !== consentEpoch) return null;
        const snapshot = json;
        if (snapshot?.ok === true && Array.isArray(snapshot.decisions)) {
          acknowledge(snapshot.sources?.consent);
          const acknowledgedEpoch = consentEpoch;
          await saveRefusal();
          if (decisionRequiresConsent({ arm: snapshot.arm, decisions: snapshot.decisions }) && (!personalizationAllowed() || acknowledgedEpoch !== consentEpoch)) return null;
        } else restrict(snapshot?.sources?.consent);
      }
      return isCurrent(g) ? json : null;
    } catch {
      return null;
    }
  }
  let pendingChoice;
  async function postJson(path, body) {
    const behaviorRequest = path === cfg.paths.action;
    if (behaviorRequest && (!consent().tracking || transitioning)) return { ok: false, status: 0, json: null };
    const g = generation;
    consent();
    const legacyPreferences = path === `/realtime/session/${encodeURIComponent(sessionId)}/preferences`;
    const preferenceRequest = isCurrent(g) && (path === "/realtime/session/preferences" || legacyPreferences) && body !== null && typeof body === "object" && !Array.isArray(body) && (body.userId === void 0 || body.userId === visitorId);
    if (/^\/realtime\/session\/(?:[^/]+\/)?preferences$/.test(path) && !preferenceRequest) return { ok: false, status: 0, json: null };
    const fields = body;
    const requested = preferenceRequest ? { tracking: fields?.trackingConsent, personalization: fields?.personalizationEnabled } : {};
    if (preferenceRequest) {
      path = "/realtime/session/preferences";
      body = { ...body };
      delete body.userId;
    }
    const oldFalse = preferenceRequest ? { tracking: cookieFalse("tracking"), personalization: cookieFalse("personalization") } : {};
    const oldScoped = preferenceRequest ? Object.fromEntries(switches.map((key) => [key, host.cookie.get(`${refusalCookie}_${key}`)])) : void 0;
    let choice;
    if (preferenceRequest) {
      try {
        const claims = JSON.parse(atob(capability.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        const supplied = body.choice;
        const payload = JSON.stringify(requested);
        const retry = pendingChoice?.capability === capability && pendingChoice.payload === payload && (supplied ? supplied.id === pendingChoice.operation.id : !pendingChoice.acknowledged);
        choice = supplied ?? (retry ? pendingChoice.operation : {
          id: host.uuid(),
          expectedRevision: instruction?.revision ?? null,
          grantId: claims.grantId,
          iat: claims.iat,
          exp: claims.exp
        });
        if (!retry) pendingChoice = { capability, payload, operation: choice, at: consentNow(), acknowledged: false };
        body = { ...body, choice };
      } catch {
        return { ok: false, status: 0, json: null };
      }
      for (const key of switches) if (requested[key] === false) {
        refusalExpiry[key] = pendingChoice.at + lifetime;
        mirrorRevision[key] = choice.id;
        mirrorExpected[key] = oldScoped[key];
      }
      consentEpoch++;
      restrict(requested, true);
    }
    const epoch = consentEpoch, ownedSession = sessionId;
    const actionEpoch = activityEpoch;
    const identityRequest = path === cfg.paths.identityLink || path === cfg.paths.identityDetach;
    if (!await ready(identityRequest) || !isCurrent(g)) return { ok: false, status: 0, json: null };
    try {
      if (behaviorRequest && (!trackingAllowed() || actionEpoch !== activityEpoch)) return { ok: false, status: 0, json: null };
      const serialized = JSON.stringify(body);
      if (!isCurrent(g) || behaviorRequest && (!trackingAllowed() || actionEpoch !== activityEpoch)) return { ok: false, status: 0, json: null };
      const res = await host.fetch(url(path), { method: "POST", headers: headers({ "Content-Type": "application/json" }), credentials: "include", body: serialized });
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (behaviorRequest && res.ok && isCurrent(g)) restrict(json?.consent);
      if (behaviorRequest && (!trackingAllowed() || actionEpoch !== activityEpoch)) return { ok: false, status: 0, json: null };
      if (preferenceRequest && res.ok && isCurrent(g) && ownedSession === sessionId) {
        consent();
        const ack = json;
        if (epoch === consentEpoch && ack?.success === true && ack.sessionId === ownedSession && choice && ack.consent?.instruction?.revision === choice.id && acceptInstruction(ack.consent.instruction)) {
          if (pendingChoice?.operation.id === choice.id) pendingChoice.acknowledged = true;
          const accepted = { tracking: ack.preferences?.trackingConsent, personalization: ack.preferences?.personalizationEnabled };
          let changed = false;
          for (const key of switches) {
            if (requested[key] === true && accepted[key] === true) {
              if (host.cookie.get(`${refusalCookie}_${key}`) !== oldScoped[key]) {
                restrict({ [key]: false }, true);
                continue;
              }
              if (cookieFalse(key) && !oldFalse[key]) {
                restrict({ [key]: false }, true);
                continue;
              }
              if (cookieFalse(key)) try {
                host.cookie.set(cookieNames[key], "", 0);
              } catch {
              }
              if (!cookieFalse(key)) {
                changed ||= active[key] === false;
                delete active[key];
                delete pendingRefusal[key];
                delete recovery[key];
              }
            } else if (accepted[key] === false) {
              restrict({ [key]: false });
              changed ||= pendingRefusal[key] === false;
              delete pendingRefusal[key];
            }
          }
          await saveRefusal(Object.fromEntries(switches.filter((key) => requested[key] === true && accepted[key] === true).map((key) => [key, oldScoped[key]])));
          const shared = readRefusal();
          for (const key of switches) if (requested[key] === true && accepted[key] === true && pendingRefusal[key] !== false && shared[key] !== false && !cookieFalse(key)) delete active[key];
          if (changed) consentChanged();
        }
      }
      return isCurrent(g) ? { ok: res.ok, status: res.status, json } : { ok: false, status: 0, json: null };
    } catch {
      return { ok: false, status: 0, json: null };
    }
  }
  function setVisitorId(id, reason) {
    const previous = visitorId;
    if (!id) return;
    const g = beginTransition();
    if (g !== generation) return;
    rememberUnknownConsent();
    capability = "";
    expiresAt = 0;
    sessionId = "";
    anonId = "";
    if (trackingAllowed()) rotateBrowsingSession(host);
    visitorId = id;
    emit("identity", { visitorId: id, previous, reason });
    finishTransition(g);
    if (wanted) connect();
  }
  let socket = null;
  let status = host.openSocket ? "closed" : "unavailable";
  let wanted = false;
  let heartbeat = null;
  let reconnectTimer = null;
  let socketGeneration = 0;
  function setStatus(s) {
    status = s;
    emit("socket", s);
  }
  function socketUrl() {
    if (!cfg.endpoint) return null;
    const base = cfg.endpoint.replace(/^http(s?):/, (_m, secure) => `ws${secure}:`);
    const q = new URLSearchParams({ tenant: cfg.tenant });
    return `${base}${cfg.paths.ws}?${q.toString()}`;
  }
  function handleFrame(raw) {
    const g = generation;
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
        emit("receipt", data, { via: "push" });
        return;
      case "content_decisions":
        restrict(msg.sources?.consent);
        if (personalizationAllowed() || !decisionRequiresConsent(msg)) emit("decisions", msg);
        return;
      default:
        break;
    }
    if (msg.type === "audience_published" || data.audienceWentLive) emit("audience", data.audienceWentLive ?? msg.audienceWentLive ?? data);
    if (!isCurrent(g)) return;
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
    const g = generation, sg = ++socketGeneration;
    void ready().then((ok) => {
      if (ok && wanted && isCurrent(g) && sg === socketGeneration) openSocket(g, sg);
    });
  }
  function openSocket(g, sg) {
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
    if (g !== generation || sg !== socketGeneration || !wanted || transitioning) return;
    try {
      const key = cfg.sdkKey ? new TextEncoder().encode(cfg.sdkKey) : void 0;
      if (key && (key.length > 512 || cfg.sdkKey?.trim() !== cfg.sdkKey)) throw new Error("Invalid site key");
      const protocol = key ? "sdk-key-v1." + btoa(String.fromCharCode(...key)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_") : void 0;
      socket = host.openSocket(target, ["shopper-session-v1", capability, ...protocol ? [protocol] : []]);
    } catch {
      setStatus("error");
      return;
    }
    const s = socket;
    const current = () => sg === socketGeneration && isCurrent(g);
    s.onopen = () => {
      if (!current()) {
        s.close();
        return;
      }
      setStatus("connected");
      stopHeartbeat();
      heartbeat = host.setInterval(() => {
        if (!current()) {
          s.close();
          return;
        }
        if (s.readyState === 1) {
          try {
            s.send(JSON.stringify({ type: "heartbeat" }));
          } catch {
          }
        }
      }, cfg.heartbeatMs);
    };
    s.onmessage = (ev) => {
      if (current()) handleFrame(ev.data);
    };
    s.onerror = () => {
      if (current()) setStatus("error");
    };
    s.onclose = () => {
      if (!current()) return;
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
    socketGeneration++;
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
  host.onStorageChange?.(anchorKey, () => {
    if (!capability || sharedCurrent()) return;
    const g = beginTransition();
    if (g !== generation) return;
    capability = "";
    expiresAt = 0;
    visitorId = "";
    sessionId = "";
    anonId = "";
    transitioning = false;
    notifyConsent();
  });
  return {
    config: cfg,
    host,
    get entry() {
      return entryOf();
    },
    get consent() {
      return consent();
    },
    get trackingAllowed() {
      return trackingAllowed();
    },
    onConsentChange,
    capture,
    get anonId() {
      return anonId;
    },
    get generation() {
      return generation;
    },
    ready,
    beginTransition,
    finishTransition,
    forgetSession,
    isCurrent,
    adoptSession,
    get visitorId() {
      return visitorId;
    },
    get sessionId() {
      return session();
    },
    /** Read only: naming the session never rolls one over or recomputes the entry. */
    get entrySessionId() {
      return entrySessionId;
    },
    get profileSessionId() {
      return sessionId;
    },
    get socketStatus() {
      return status;
    },
    on,
    emit,
    envelope,
    send,
    bindContent,
    sendRender,
    matchesSessionWitness,
    url,
    headers,
    getJson,
    postJson,
    setVisitorId,
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
  const track = async (type, input = {}) => {
    if (!await core.ready() || !core.trackingAllowed) return null;
    const data = typeof input === "function" ? input() : input;
    const content = contentInteraction(type, data);
    if (content) type = content;
    if (type === "content_impression") return listen.rendered(
      String(data.slot ?? ""),
      String(data.contentId ?? ""),
      void 0,
      typeof data.decisionId === "string" ? data.decisionId : void 0
    ).then(() => null);
    if (["content_click", "content_dwell", "video_complete"].includes(type)) return listen.outcome(type, String(data.contentId ?? ""), String(data.slot ?? ""), data);
    return core.send(type, data);
  };
  const withItem = (type) => (productId, attrs = {}) => core.send(type, () => ({ productId, ...attrs }));
  const withContent = (type) => (contentId, slot, attrs = {}) => track(type, () => ({ contentId, slot, ...attrs }));
  function declarative(opts = {}) {
    if (core.config.listenOnly) return () => {
    };
    const dom = opts.dom ?? host.dom;
    if (!dom) return () => {
    };
    const dwellMinMs = opts.dwellMinMs ?? 1e3;
    const offs = [];
    const seen = /* @__PURE__ */ new Set();
    let detached = false, installed = false, binding = 0;
    const stop = () => {
      binding++;
      installed = false;
      seen.clear();
      for (const off of offs.splice(0)) off();
    };
    const start = () => core.capture(() => {
      if (detached || installed) return;
      installed = true;
      const current = binding;
      const permitted = () => core.trackingAllowed && !detached && current === binding;
      for (const el of dom.querySelectorAll("[data-op-content]")) {
        if (!permitted()) return;
        const contentId = el.getAttribute("data-op-content") ?? "";
        const slot = el.getAttribute("data-op-slot") ?? "unknown";
        if (!contentId) continue;
        const decisionId = el.getAttribute("data-op-decision-id");
        const attrs = {
          contentId,
          slot,
          ...decisionId !== null ? { decisionId } : {},
          ...el.getAttribute("data-op-type") ? { contentType: el.getAttribute("data-op-type") } : {}
        };
        let shownAt = null;
        const off = dom.observe(el, (visible) => {
          if (!permitted()) {
            shownAt = null;
            return;
          }
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
        });
        if (!permitted()) {
          off();
          return;
        }
        offs.push(off);
        el.addEventListener("click", () => {
          if (permitted()) void track("content_click", attrs);
        });
      }
      for (const el of dom.querySelectorAll("[data-op-track]")) {
        if (!permitted()) return;
        const type = el.getAttribute("data-op-track") ?? "";
        if (!(type in WIRE)) continue;
        const label = el.getAttribute("data-op-label");
        const productId = el.getAttribute("data-op-product");
        const decisionId = el.getAttribute("data-op-decision-id");
        el.addEventListener("click", () => {
          if (!permitted()) return;
          void track(type, {
            ...label ? { label } : {},
            ...productId ? { productId } : {},
            ...decisionId !== null ? { decisionId } : {}
          });
        });
      }
    });
    const consentOff = core.onConsentChange(() => {
      if (core.trackingAllowed) start();
      else stop();
    });
    const generationOff = core.on("generation", stop);
    start();
    return () => {
      detached = true;
      consentOff();
      generationOff();
      stop();
    };
  }
  function dataLayer(opts = {}) {
    const layer = opts.layer ?? host.dataLayer;
    if (!layer) return () => {
    };
    let detached = false;
    const mapping = { ...GA4_MAPPING, ...opts.mapping ?? {} };
    const handle = (entry) => core.capture(() => {
      if (detached) return;
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
    });
    const replayLength = opts.replay !== false && core.trackingAllowed ? layer.length : 0;
    if (replayLength) core.capture(() => {
      if (!detached) for (let i = 0; i < replayLength; i++) handle(layer[i]);
    });
    const original = layer.push;
    layer.push = function(...args) {
      const r = original.apply(layer, args);
      for (const a of args) handle(a);
      return r;
    };
    return () => {
      detached = true;
      layer.push = original;
    };
  }
  return {
    track,
    pageView: (data = {}) => core.send("page_view", () => ({ path: host.location?.href ?? "", ...data })),
    productView: withItem("product_view"),
    addToCart: withItem("add_to_cart"),
    wishlistAdd: withItem("wishlist_add"),
    purchase: (input) => core.send("purchase", () => ({ ...input }), { keepalive: true }),
    contentImpression: withContent("content_impression"),
    contentClick: withContent("content_click"),
    contentDwell: (contentId, slot, ms, attrs = {}) => track("content_dwell", () => ({ contentId, slot, ms, ...attrs })),
    videoComplete: withContent("video_complete"),
    custom: (name, data = {}) => track("custom", () => ({ event: name, ...data })),
    declarative,
    dataLayer,
    rendered: (slot, contentId, el, decisionId) => listen.rendered(slot, contentId, el, decisionId)
  };
}

// src/services/visit.ts
var VISIT_GAP_MS = 30 * 60 * 1e3;
var ENTRY_QUERY_LIMIT = 4096;
var ENTRY_LIMITS = { utmMedium: 128, utmSource: 256, referrer: 2048, siteHost: 253 };
function parsed(value) {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return null;
  }
}
function authorityHost(value) {
  if (value === "" || /[/\\?#@\s]/.test(value)) return "";
  const url = parsed(value);
  if (!url) return "";
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") return "";
  const separator = value.indexOf(":", value.startsWith("[") ? value.indexOf("]") + 1 : 0);
  if (separator !== -1 && !/^[0-9]+$/.test(value.slice(separator + 1))) return "";
  return url.hostname;
}
function rootStripped(host) {
  return host.endsWith(".") ? host.slice(0, -1) : host;
}
function isHostname(value) {
  const host = authorityHost(value);
  return host !== "" && host.length <= ENTRY_LIMITS.siteHost;
}
function hostField(key, hostOnly) {
  return key === "siteHost" || hostOnly && key === "referrer";
}
function validEntry(value, hostOnly = false) {
  if (value === void 0) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, v]) => Object.hasOwn(ENTRY_LIMITS, key) && (v === void 0 || typeof v === "string" && v.length <= ENTRY_LIMITS[key] && (!hostField(key, hostOnly) || v === "" || isHostname(v))));
}
function snapshotEntry(entry) {
  const referrer = typeof entry.referrer === "string" ? hostOf(entry.referrer) : entry.referrer;
  if (entry.referrer && !referrer) return void 0;
  const value = { ...entry, ...entry.referrer === void 0 ? {} : { referrer } };
  if (!validEntry(value, true) || !Object.values(value).some((v) => typeof v === "string")) return void 0;
  const json = JSON.stringify(value);
  return json.length <= ENTRY_QUERY_LIMIT ? json : void 0;
}
function hostOf(referrer) {
  const url = referrer === "" ? null : parsed(referrer);
  return url ? rootStripped(url.hostname.toLowerCase()) : "";
}

// src/sdk/listen.ts
function createListen(core, opts = {}) {
  const host = core.host;
  const dwellMinMs = opts.dwellMinMs ?? 1e3;
  const slotSubs = /* @__PURE__ */ new Map();
  const setSubs = /* @__PURE__ */ new Set();
  const painted = /* @__PURE__ */ new Map();
  const observers = /* @__PURE__ */ new Set();
  let current = null;
  let absence = null;
  let selected, pageInstance = "", destroyed = false;
  let refreshing, trailing = false;
  let adopted = false;
  const content = core.bindContent((type, data) => type === "content_impression" ? rendered(String(data.slot ?? ""), String(data.contentId ?? ""), void 0, typeof data.decisionId === "string" ? data.decisionId : void 0).then(() => null) : outcome(type, String(data.contentId ?? ""), String(data.slot ?? ""), data));
  const placement = (d) => JSON.stringify([d.slot, d.order, d.contentId]);
  const sameAsset = (a, b) => a.customerContentId === b.customerContentId && a.type === b.type;
  const permitted = (set) => {
    if (!set || !decisionRequiresConsent(set)) return true;
    const consent = core.consent;
    return consent.tracking && consent.personalization;
  };
  let intent = 0, delivery = 0;
  function resetCapture() {
    painted.clear();
    for (const stop of [...observers]) stop();
  }
  const offConsent = core.onConsentChange(() => {
    if (!core.trackingAllowed) resetCapture();
    if (!permitted(current)) deliver(null, current?.page ?? "");
  });
  function admittedCurrent() {
    const candidate = current;
    if (!candidate) return null;
    const owned = core.isCurrent(core.generation);
    const admitted = owned && permitted(candidate);
    if (candidate !== current) return null;
    if (admitted) return candidate;
    current = null;
    if (owned) absence = { page: candidate.page, decisions: [] };
    resetCapture();
    return null;
  }
  function deliver(set, page) {
    const generation = core.generation;
    const owner = intent;
    if (!permitted(set)) set = null;
    if (generation !== core.generation || owner !== intent) return -1;
    const epoch = ++delivery;
    const active = () => permitted(set) && (!set || core.isCurrent(generation)) && generation === core.generation && owner === intent && epoch === delivery;
    const previous = current;
    if (!set || previous && (previous.page !== set.page || previous.pageInstance !== set.pageInstance)) resetCapture();
    if (set) {
      const keys = new Set(set.decisions.map(placement));
      for (const key of painted.keys()) if (!keys.has(key)) painted.delete(key);
      set = { ...set, decisions: set.decisions.map((d) => {
        const paint = painted.get(placement(d));
        if (paint && !sameAsset(paint.piece, d)) painted.delete(placement(d));
        return paint && sameAsset(paint.piece, d) && paint.generation === generation && paint.pageInstance === set.pageInstance ? paint.piece : d;
      }) };
    }
    const unchanged = previous && set && previous.page === set.page && previous.pageInstance === set.pageInstance && JSON.stringify(previous.decisions) === JSON.stringify(set.decisions);
    current = set;
    adopted = false;
    absence = set ? null : { page, decisions: [] };
    const context = set ?? absence;
    if (unchanged) return epoch;
    const bySlot = /* @__PURE__ */ new Map();
    for (const d of context.decisions ?? []) {
      const list = bySlot.get(d.slot) ?? [];
      list.push(d);
      bySlot.set(d.slot, list);
    }
    for (const list of bySlot.values()) list.sort((a, b) => a.order - b.order);
    for (const [slot, subs] of slotSubs) {
      const list = bySlot.get(slot) ?? [];
      if (set && previous && previous.page === set.page && previous.pageInstance === set.pageInstance && JSON.stringify(previous.decisions.filter((d) => d.slot === slot).sort((a, b) => a.order - b.order)) === JSON.stringify(list)) continue;
      for (const cb of subs) {
        if (!active()) return epoch;
        try {
          cb(list, context);
        } catch {
        }
      }
    }
    for (const cb of setSubs) {
      if (!active()) return epoch;
      try {
        cb(set);
      } catch {
      }
    }
    return epoch;
  }
  function apply(set) {
    if (!core.isCurrent(core.generation)) return;
    ++intent;
    deliver(set, set.page);
  }
  const offDecisions = core.on("decisions", (set) => apply(set));
  const offGeneration = core.on("generation", () => {
    const page = current?.page ?? absence?.page ?? "";
    pageInstance = "";
    deliver(null, page);
  });
  async function hydrate(o) {
    if (destroyed) return null;
    if (!pageInstance || !selected || selected.page !== o.page || selected.channel !== o.channel) {
      pageInstance = host.uuid();
      resetCapture();
    }
    selected = { ...o };
    const owner = ++intent;
    const pending = core.ready();
    const generation = core.generation;
    const active = () => owner === intent && generation === core.generation;
    if (!active()) return null;
    let settled = false;
    let timedOut = false;
    const timer2 = host.setTimeout(() => {
      if (!settled && active()) {
        timedOut = true;
        deliver(null, o.page);
      }
    }, core.config.hydrateTimeoutMs);
    if (!await pending || !active() || !core.isCurrent(generation)) {
      settled = true;
      host.clearTimeout(timer2);
      if (!timedOut && active()) deliver(null, o.page);
      return null;
    }
    const consent = core.consent;
    const json = await core.getJson(core.config.paths.snapshot, {
      page: o.page,
      pageInstance,
      browsingSessionId: consent.tracking ? core.sessionId : void 0,
      brand: core.config.brand,
      channel: consent.tracking ? o.channel : void 0,
      entry: consent.tracking ? snapshotEntry(core.entry) : void 0,
      trackingConsent: consent.tracking ? void 0 : "false",
      personalizationEnabled: consent.personalization ? void 0 : "false"
    });
    settled = true;
    host.clearTimeout(timer2);
    if (!active() || !core.isCurrent(generation)) return null;
    if (!json || json.ok !== true || !Array.isArray(json.decisions) || json.page !== void 0 && json.page !== o.page || json.pageInstance !== void 0 && json.pageInstance !== pageInstance) {
      if (!timedOut) deliver(null, o.page);
      return null;
    }
    const set = {
      page: json.page ?? o.page,
      ...json.pageInstance ? { pageInstance: json.pageInstance } : {},
      ...json.arm ? { arm: json.arm } : {},
      ...json.versions ? { versions: json.versions } : {},
      ...json.config_label ? { config_label: json.config_label } : {},
      ...typeof json.ts === "number" ? { ts: json.ts } : {},
      decisions: json.decisions
    };
    const epoch = deliver(set, set.page);
    const accepted = admittedCurrent();
    return accepted && active() && epoch === delivery && core.isCurrent(generation) ? accepted : null;
  }
  function refresh(o) {
    if (destroyed || !o && !selected) return Promise.resolve(null);
    if (o && selected && (o.page !== selected.page || o.channel !== selected.channel)) {
      ++intent;
      selected = { ...o };
      pageInstance = host.uuid();
      resetCapture();
    } else if (o) selected = { ...o };
    if (refreshing) {
      ++intent;
      trailing = true;
      return refreshing;
    }
    const operation = (async () => {
      let result = null;
      do {
        trailing = false;
        result = await hydrate(selected);
      } while (trailing && !destroyed);
      return result;
    })();
    refreshing = operation;
    const finish = () => {
      if (refreshing === operation) {
        refreshing = void 0;
        trailing = false;
      }
    };
    void operation.then(finish, finish);
    return operation;
  }
  function subscribe(slot, cb) {
    const set = slotSubs.get(slot) ?? /* @__PURE__ */ new Set();
    set.add(cb);
    slotSubs.set(slot, set);
    const context = admittedCurrent() ?? absence;
    if (context && !adopted) {
      const list = (context.decisions ?? []).filter((d) => d.slot === slot).sort((a, b) => a.order - b.order);
      try {
        cb(list, context);
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
  async function rendered(slot, contentId, el, decisionId) {
    if (destroyed || core.config.listenOnly || !core.trackingAllowed) return null;
    const set = admittedCurrent(), matches = set?.decisions.filter((d) => d.slot === slot && d.contentId === contentId && (decisionId === void 0 || decisionId === d.decisionId)) ?? [];
    if (!set?.pageInstance || matches.length !== 1) return null;
    const piece = matches[0];
    if (!piece.renderOffer || !piece.decisionId) return null;
    const key = placement(piece), generation = core.generation;
    let paint = painted.get(key);
    if (!paint) {
      const data = {
        contentId,
        slot,
        decisionId: piece.decisionId,
        page: set.page,
        position: piece.order,
        pageInstance: set.pageInstance,
        renderOffer: piece.renderOffer,
        customerContentId: piece.customerContentId,
        contentType: piece.type
      };
      paint = { piece, page: set.page, pageInstance: set.pageInstance, generation, envelope: core.envelope("content_impression", data), attempts: 0 };
      painted.set(key, paint);
    }
    const selectedPaint = paint;
    const active = () => !destroyed && painted.get(key) === selectedPaint && core.isCurrent(generation) && core.trackingAllowed && current?.pageInstance === selectedPaint.pageInstance;
    if (!active()) return null;
    if (!paint.ack && !paint.pending && paint.attempts < 3) {
      paint.attempts++;
      paint.pending = core.sendRender(paint.envelope).then((ack2) => {
        if (!active()) return null;
        if (ack2) selectedPaint.ack = ack2;
        return ack2;
      }).finally(() => {
        selectedPaint.pending = void 0;
      });
    }
    const ack = paint.ack ?? await paint.pending ?? null;
    if (!ack || !active()) return null;
    if (el && host.dom && !paint.observed) {
      paint.observed = true;
      const { renderOffer: _offer, ...data } = paint.envelope.data;
      void _offer;
      let shownAt = null;
      let off = () => void 0;
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        shownAt = null;
        off();
        observers.delete(stop);
      };
      observers.add(stop);
      off = host.dom.observe(el, (visible) => {
        if (stopped || !active()) {
          stop();
          return;
        }
        if (visible) {
          if (shownAt === null) shownAt = host.now();
          return;
        }
        if (shownAt === null) return;
        const ms = host.now() - shownAt;
        shownAt = null;
        if (ms >= dwellMinMs) void outcome("content_dwell", contentId, slot, { ...data, ms });
        stop();
      });
      if (stopped) off();
    }
    return ack;
  }
  async function outcome(type, contentId, slot, attrs = {}) {
    if (type === "content_impression") return null;
    const candidates = [...painted.values()].filter((p) => p.piece.slot === slot && p.piece.contentId === contentId && (attrs.decisionId === void 0 || attrs.decisionId === p.piece.decisionId));
    if (candidates.length !== 1) return null;
    const paint = candidates[0], ack = paint.ack ?? await paint.pending;
    if (!ack || destroyed || !core.isCurrent(paint.generation) || !core.trackingAllowed || current?.pageInstance !== paint.pageInstance || painted.get(placement(paint.piece)) !== paint) return null;
    const { renderOffer: _offer, action: _action, event: _event, eventName: _eventName, ...safe } = attrs;
    void _offer;
    void _action;
    void _event;
    void _eventName;
    return content.send(type, { ...safe, contentId, slot, decisionId: ack.decisionId });
  }
  async function adopt(value, o) {
    const owner = ++intent, generation = core.generation;
    const fail = () => {
      if (owner === intent && generation === core.generation) deliver(null, o.page);
      return false;
    };
    if (destroyed || !value || typeof value !== "object") return fail();
    const b = value;
    if (b.version !== 1 || b.tenant !== core.config.tenant || b.endpoint !== core.config.endpoint || b.page !== o.page || typeof b.pageInstance !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(b.pageInstance) || !Number.isSafeInteger(b.until) || b.until <= host.now() || b.until > host.now() + 3e4 || !Array.isArray(b.decisions) || b.decisions.length > 1e3 || !host.dom || !await core.ready() || !await core.matchesSessionWitness(b.sessionWitness) || generation !== core.generation || owner !== intent || !permitted(b)) return fail();
    const elements = [...host.dom.querySelectorAll("[data-op-page-instance]")];
    const expected = /* @__PURE__ */ new Map();
    for (const d of b.decisions) {
      if (!d || typeof d.contentId !== "string" || typeof d.slot !== "string" || !Number.isSafeInteger(d.order) || expected.has(placement(d))) return fail();
      expected.set(placement(d), d);
    }
    if (elements.length !== expected.size) return fail();
    const matched = /* @__PURE__ */ new Set();
    for (const el of elements) {
      const key = placement({ slot: el.getAttribute("data-op-slot") ?? "", contentId: el.getAttribute("data-op-content") ?? "", order: Number(el.getAttribute("data-op-position")) });
      const d = expected.get(key);
      if (!d || matched.has(key) || el.getAttribute("data-op-page-instance") !== b.pageInstance || (el.getAttribute("data-op-decision-id") ?? void 0) !== d.decisionId) return fail();
      matched.add(key);
    }
    if (owner !== intent || generation !== core.generation || !core.isCurrent(generation) || host.now() >= b.until || !permitted(b)) return fail();
    resetCapture();
    selected = { ...o };
    pageInstance = b.pageInstance;
    current = { ...b, decisions: b.decisions.map((d) => ({ ...d })) };
    absence = null;
    adopted = true;
    ++delivery;
    for (const el of elements) void rendered(
      el.getAttribute("data-op-slot"),
      el.getAttribute("data-op-content"),
      el,
      el.getAttribute("data-op-decision-id") ?? void 0
    );
    return true;
  }
  const offSent = core.on("sent", (event) => {
    if (!["content_impression", "content_dwell"].includes(event.type) && selected) void refresh();
  });
  const offSocket = core.on("socket", (status) => {
    if (status === "connected" && selected) void refresh();
  });
  const timer = opts.refreshMs === void 0 ? void 0 : host.setInterval(() => {
    if (selected) void refresh();
  }, Math.max(1e3, Math.min(3e5, opts.refreshMs)));
  function destroy() {
    destroyed = true;
    ++intent;
    resetCapture();
    content.release();
    offSent();
    offSocket();
    offConsent();
    offDecisions();
    offGeneration();
    if (timer !== void 0) host.clearInterval(timer);
    slotSubs.clear();
    setSubs.clear();
    current = null;
    absence = null;
  }
  return { hydrate, refresh, adopt, subscribe, onDecisions, apply, current: admittedCurrent, rendered, outcome, destroy };
}

// src/sdk/identify.ts
function createIdentity(core) {
  const failure = (error, status = 0, retried = false) => ({ ok: false, status, error, retried });
  async function attempt(accountId, o, generation, retry = false) {
    const visitorId = core.visitorId;
    let assertion = o.assertion, exp = o.exp;
    if (o.getAssertion !== void 0) {
      try {
        if (typeof o.getAssertion !== "function") return { failure: failure("identity proof provider invalid") };
        const proof = await o.getAssertion({ tenant: core.config.tenant, visitorId, accountId });
        if (!core.isCurrent(generation) || core.visitorId !== visitorId) return { failure: failure("identity changed during identify") };
        assertion = proof?.assertion;
        exp = proof?.exp;
        if (typeof assertion !== "string" || !assertion.trim() || assertion.length > 200 || !Number.isInteger(exp)) {
          return { failure: failure("identity proof provider returned invalid proof") };
        }
      } catch {
        return { failure: failure("identity proof provider failed") };
      }
    }
    if (!core.isCurrent(generation) || core.visitorId !== visitorId) return { failure: failure("identity changed during identify") };
    const response = await core.postJson(core.config.paths.identityLink, {
      visitorId,
      accountId,
      ...o.source ? { source: o.source } : {},
      ...typeof exp === "number" ? { exp } : {},
      ...assertion ? { assertion } : {}
    });
    if (!core.isCurrent(generation) || core.visitorId !== visitorId) return { failure: failure("identity changed during identify", 0, retry) };
    return { visitorId, response };
  }
  async function logout() {
    const g = core.beginTransition();
    try {
      if (!await core.ready(true) || !core.isCurrent(g)) {
        core.forgetSession(g);
        return { ok: false, status: 0, visitorId: core.visitorId };
      }
      const res = await core.postJson(core.config.paths.identityDetach, { visitorId: core.visitorId });
      const body = res.json;
      const ok = core.isCurrent(g) && res.ok && body?.ok === true && body.detached === true && core.adoptSession(body.session, g, "logout");
      if (!ok) core.forgetSession(g);
      return { ok, status: res.status, visitorId: core.visitorId };
    } finally {
      core.finishTransition(g);
    }
  }
  async function identify(accountId, options = {}) {
    if (!accountId || typeof accountId !== "string") return { ok: false, status: 0, error: "accountId required", retried: false };
    const g = core.beginTransition();
    try {
      if (!await core.ready(true) || !core.isCurrent(g)) return failure("shopper session unavailable");
      let retried = false;
      let attempted = await attempt(accountId, options, g);
      if ("failure" in attempted) return attempted.failure;
      if (!core.isCurrent(g) || core.visitorId !== attempted.visitorId) return failure("identity changed during identify");
      if (attempted.response.status === 409 && options.getAssertion !== void 0) {
        const detached = await core.postJson(core.config.paths.identityDetach, { visitorId: attempted.visitorId });
        if (!core.isCurrent(g) || core.visitorId !== attempted.visitorId) return failure("identity changed during identify");
        const body2 = detached.json;
        if (!detached.ok || body2?.ok !== true || body2?.detached !== true) return failure("identity detach failed", detached.status);
        if (!core.adoptSession(body2.session, g, "logout")) return failure("identity detach failed", detached.status);
        attempted = await attempt(accountId, options, g, true);
        if ("failure" in attempted) return attempted.failure;
        retried = true;
      }
      if (!core.isCurrent(g) || core.visitorId !== attempted.visitorId) return failure("identity changed during identify", 0, retried);
      const res = attempted.response;
      const body = res.json ?? {};
      const shopperId = typeof body.carry === "string" ? body.carry : typeof body.shopperId === "string" ? body.shopperId : null;
      if (!res.ok || body.ok === false || !shopperId) {
        return { ok: false, status: res.status, error: typeof body.error === "string" ? body.error : "link refused", retried };
      }
      if (body.session?.kind !== "recognized" || body.session.subject !== shopperId || !core.adoptSession(body.session, g, "identified")) return failure("shopper session unavailable", res.status, retried);
      return { ok: true, shopperId, visitorId: core.visitorId, outcome: typeof body.outcome === "string" ? body.outcome : null, retried };
    } finally {
      core.finishTransition(g);
    }
  }
  return { identify, logout };
}

// src/sdk/memoryHost.ts
function memoryHost(overrides = {}) {
  const storage = /* @__PURE__ */ new Map();
  const cookies = /* @__PURE__ */ new Map();
  const now = overrides.now ?? (() => Date.now());
  const schedule = overrides.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const cancel = overrides.clearTimeout ?? ((h) => globalThis.clearTimeout(h));
  const base = {
    now: () => Date.now(),
    uuid: () => `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
    storage: { get: (k) => storage.get(k) ?? null, set: (k, v) => {
      storage.set(k, v);
    } },
    cookie: {
      get: (k) => {
        const row = cookies.get(k);
        if (!row || row.expires <= now()) {
          cookies.delete(k);
          return null;
        }
        return row.value;
      },
      set: (k, value, maxAge) => {
        const previous = cookies.get(k);
        if (previous?.timer !== void 0) cancel(previous.timer);
        if (maxAge <= 0) {
          cookies.delete(k);
          return;
        }
        const row = { value, expires: now() + maxAge * 1e3 };
        cookies.set(k, row);
        const arm = (remaining) => {
          const delay = Math.min(2147483647, remaining);
          row.timer = schedule(() => {
            if (cookies.get(k) !== row) return;
            if (remaining <= delay || row.expires <= now()) cookies.delete(k);
            else arm(remaining - delay);
          }, delay);
          row.timer?.unref?.();
        };
        arm(maxAge * 1e3);
      }
    },
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
var storageNotification = "opt-shopper-storage";
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
          win.dispatchEvent(new CustomEvent(storageNotification, { detail: k }));
        } catch {
        }
      }
    },
    ...nav?.locks ? { acquireAuthorityLock: (name) => new Promise((resolve, reject) => {
      void nav.locks.request(name, { mode: "exclusive" }, () => new Promise((release) => resolve(release))).catch(reject);
    }) } : {},
    onStorageChange: (key, listener) => {
      const changed = (event) => {
        if (event.type === "storage" ? event.key === key || event.key === null : event.detail === key) listener();
      };
      win.addEventListener("storage", changed);
      win.addEventListener(storageNotification, changed);
      return () => {
        win.removeEventListener("storage", changed);
        win.removeEventListener(storageNotification, changed);
      };
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
    location: loc ? { get href() {
      return loc.href;
    }, host: loc.host, hostname: loc.hostname, protocol: loc.protocol, get search() {
      return loc.search;
    } } : null,
    get referrer() {
      return doc?.referrer ?? "";
    },
    fetch: (url, init) => win.fetch(url, init),
    ...nav && typeof nav.sendBeacon === "function" ? { sendBeacon: (url, body) => {
      try {
        return nav.sendBeacon(url, new Blob([body], { type: "application/json" }));
      } catch {
        return false;
      }
    } } : {},
    ...typeof win.WebSocket === "function" ? { openSocket: (url, protocols) => new win.WebSocket(url, protocols) } : {},
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
var VERSION = "0.2.0";

// src/sdk/index.ts
function createClient(config, host = browserHost(), options = {}) {
  const core = createCore(config, host);
  const listen = createListen(core, options);
  const emit = createEmit(core, listen);
  const identity = createIdentity(core);
  return {
    VERSION,
    get visitorId() {
      return core.visitorId;
    },
    get sessionId() {
      return core.sessionId;
    },
    core,
    emit,
    listen,
    identify: (accountId, options2) => identity.identify(accountId, options2),
    logout: () => identity.logout(),
    connect: () => core.connect(),
    disconnect: () => core.disconnect(),
    destroy: () => {
      listen.destroy();
      core.disconnect();
    },
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
  createIdentity,
  createListen,
  memoryHost
};
