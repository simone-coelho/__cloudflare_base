/* edge-head v0.2.0 — the head script: the carousel's context order before paint (P84). */
"use strict";
(() => {
  // src/sdk/armDraw.ts
  function fnv1a(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mix32(h) {
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  }
  var hash32 = (s) => mix32(fnv1a(s));
  function bucketOf(visitorId, salt) {
    return hash32(`${salt}:${visitorId}`) / 4294967296;
  }
  function holdoutShare(share) {
    return Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0));
  }
  function armFor(visitorId, h) {
    const share = holdoutShare(h.share);
    if (share <= 0) return "personalized";
    const b = bucketOf(visitorId, h.salt);
    if (b >= share) return "personalized";
    const arms = h.arms.length ? h.arms : ["default"];
    const idx = Math.min(arms.length - 1, Math.floor(b / share * arms.length));
    return arms[idx] ?? "default";
  }
  function defaultArmProbability(h) {
    const arms = h.arms.length ? h.arms : ["default"];
    return holdoutShare(h.share) * arms.filter((a) => a === "default").length / arms.length;
  }
  var armClassOf = (arm) => arm === "default" ? "default" : "personalized";

  // src/services/platform.ts
  function deviceClassOf(value) {
    return value === "mobile" || value === "desktop" ? value : null;
  }
  function deviceFromHint(hint) {
    const value = (hint ?? "").trim();
    return value === "?1" ? "mobile" : value === "?0" ? "desktop" : null;
  }
  function deviceFromUserAgent(ua) {
    const value = (ua ?? "").trim();
    if (!/^Mozilla\//.test(value)) return null;
    if (/\biPad\b/.test(value) || /\bTablet\b/.test(value)) return "desktop";
    if (/\b(?:iPhone|iPod)\b/.test(value)) return "mobile";
    if (/\bAndroid\b/.test(value)) return /\bMobile\b/.test(value) ? "mobile" : "desktop";
    return /Mobi/.test(value) ? "mobile" : "desktop";
  }
  function deviceOf(headers) {
    return deviceFromHint(headers.get("Sec-CH-UA-Mobile")) ?? deviceFromUserAgent(headers.get("User-Agent"));
  }

  // src/services/visit.ts
  var VISIT_GAP_MS = 30 * 60 * 1e3;
  var CLASSIFIER_VERSION = "entry-channel-v1";
  function recencyBucketOf(value) {
    return value === "same_day" || value === "within_7_days" || value === "8_to_30_days" || value === "30_and_more" ? value : null;
  }
  var ENTRY_CHANNELS = ["direct", "paid_social", "paid_search", "email", "organic", "referral"];
  var CONTEXT_ID = /^[a-z][a-z0-9_]{0,63}$/;
  var isContextId = (v) => typeof v === "string" && CONTEXT_ID.test(v) && v !== "unknown" && v !== "any";
  var ENTRY_LIMITS = { utmMedium: 128, utmSource: 256, utmTerm: 256, utmCampaign: 256, referrer: 2048, siteHost: 253 };
  var ENTRY_CAMPAIGN_LIMIT = ENTRY_LIMITS.utmCampaign;
  var ENTRY_TERM_LIMIT = ENTRY_LIMITS.utmTerm;
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
  function entryChannelOf(value) {
    if (typeof value !== "string") return null;
    const channel = value.trim().toLowerCase();
    return ENTRY_CHANNELS.includes(channel) ? channel : null;
  }
  function pageView(entry) {
    return typeof entry.referrer === "string" && siteOf(entry.siteHost) !== "";
  }
  function observedChannel(entry, vocabulary) {
    if (!validEntry(entry) || !entry || !Object.values(entry).some((v) => typeof v === "string")) return void 0;
    if (vocabulary) return classifyByVocabulary(entry, vocabulary) ?? void 0;
    const channel = classifyEntryChannel(entry);
    return channel !== "direct" || pageView(entry) ? channel : void 0;
  }
  var tokensOf = (value) => value.split(/[\s_-]+/).filter((token) => token !== "");
  function ruleHolds(rule, entry) {
    const medium = norm(entry.utmMedium), source = norm(entry.utmSource), campaign = norm(entry.utmCampaign);
    if (rule.utmMedium && (medium === "" || !rule.utmMedium.some((m) => norm(m) === medium))) return false;
    if (rule.utmSource && (source === "" || !rule.utmSource.some((s) => {
      const wanted = norm(s);
      return wanted === source || !source.includes(".") && tokensOf(source).includes(wanted);
    }))) return false;
    if (rule.utmCampaign && (campaign === "" || !rule.utmCampaign.some((t) => tokensOf(campaign).includes(norm(t))))) return false;
    if (rule.untagged === true && (medium !== "" || source !== "" || campaign !== "")) return false;
    if (rule.referrer !== void 0) {
      const host = hostOf(norm(entry.referrer)), site = siteOf(entry.siteHost);
      const sameSite = host !== "" && site !== "" && (host === site || host.endsWith(`.${site}`));
      if (rule.referrer === "none") {
        if (!pageView(entry) || host !== "" && !sameSite) return false;
      } else if (rule.referrer === "external") {
        if (host === "" || sameSite) return false;
      } else if (!matches(host, rule.referrer.map((domain) => norm(domain)))) return false;
    }
    return true;
  }
  function classifyByVocabulary(entry, vocabulary) {
    for (const rule of vocabulary.rules) if (ruleHolds(rule, entry)) return rule.channel;
    return null;
  }
  function sourcePlatformOf(entry, vocabulary) {
    if (!entry || !validEntry(entry)) return void 0;
    const platforms = vocabulary.sourcePlatforms;
    const byHost = (host) => platforms.find((p) => matches(host, p.networks.map((n) => norm(n))))?.id;
    const source = norm(entry.utmSource);
    if (source !== "") {
      if (source.includes(".")) {
        const id = byHost(hostOf(source));
        if (id) return id;
      } else for (const token of sourceTokens(source)) {
        if (!SOCIAL_SOURCES.has(token) && !SEARCH_SOURCES.has(token)) continue;
        const id = platforms.find((p) => p.networks.some((n) => norm(n).split(".")[0] === token))?.id;
        if (id) return id;
      }
    }
    return byHost(hostOf(norm(entry.referrer)));
  }
  function landingPageTypeOf(pageType, vocabulary) {
    if (typeof pageType !== "string") return void 0;
    const id = pageType.trim().toLowerCase();
    return vocabulary.landingPageTypes.some((t) => t.id === id) ? id : void 0;
  }
  var vocabularyMark = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
  function validVisitContext(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const v = value;
    const marked = vocabularyMark(v.vocabularyRevision);
    return (v.visitCount === void 0 || Number.isSafeInteger(v.visitCount) && v.visitCount >= 1) && (v.lastVisitAt === void 0 || Number.isSafeInteger(v.lastVisitAt) && v.lastVisitAt >= 0) && (v.vocabularyRevision === void 0 || marked) && (v.entryChannel === void 0 || entryChannelOf(v.entryChannel) === v.entryChannel || marked && isContextId(v.entryChannel)) && (v.sourcePlatform === void 0 || marked && isContextId(v.sourcePlatform)) && (v.landingPageType === void 0 || marked && isContextId(v.landingPageType)) && (v.device === void 0 || deviceClassOf(v.device) === v.device) && (v.recency === void 0 || recencyBucketOf(v.recency) === v.recency);
  }
  var needsMark = (v) => v.entryChannel !== void 0 && entryChannelOf(v.entryChannel) !== v.entryChannel || v.sourcePlatform !== void 0 || v.landingPageType !== void 0;
  function liveVisit(previous, lastSeen, now, entry, inputs) {
    const prior = previous && validVisitContext(previous) ? previous : void 0;
    const opening = isNewVisit(lastSeen, now);
    const carried = !opening ? prior : void 0;
    const published = inputs?.vocabulary ?? null;
    const out = {
      visitCount: nextVisitCount(prior?.visitCount, lastSeen, now),
      lastVisitAt: opening ? now : prior?.lastVisitAt ?? now,
      entryChannel: carried?.entryChannel ?? observedChannel(entry, published?.vocabulary)
    };
    const sourcePlatform = carried?.sourcePlatform ?? (published ? sourcePlatformOf(entry, published.vocabulary) : void 0);
    const landingPageType = carried?.landingPageType ?? (published ? landingPageTypeOf(inputs?.pageType, published.vocabulary) : void 0);
    if (sourcePlatform !== void 0) out.sourcePlatform = sourcePlatform;
    if (landingPageType !== void 0) out.landingPageType = landingPageType;
    if (needsMark(out)) {
      const mark = published?.revision ?? carried?.vocabularyRevision;
      if (vocabularyMark(mark)) out.vocabularyRevision = mark;
    }
    return out;
  }
  function isNewVisit(lastSeenMs, nowMs, gapMs = VISIT_GAP_MS) {
    if (lastSeenMs === null || lastSeenMs === void 0 || !Number.isFinite(lastSeenMs)) return true;
    return nowMs - lastSeenMs >= gapMs;
  }
  function nextVisitCount(previous, lastSeenMs, nowMs, gapMs = VISIT_GAP_MS) {
    const prior = typeof previous === "number" && Number.isFinite(previous) && previous >= 1 ? Math.floor(previous) : 0;
    if (prior === 0) return 1;
    return isNewVisit(lastSeenMs, nowMs, gapMs) ? prior + 1 : prior;
  }
  function bucketNamesOf(cut) {
    return cut.map((bound, i) => {
      const next = cut[i + 1];
      if (next === void 0) return `${bound}+`;
      return next - 1 === bound ? String(bound) : `${bound}-${next - 1}`;
    });
  }
  function visitBucketUnder(n, cut, names = bucketNamesOf(cut)) {
    if (n === null || n === void 0 || !Number.isFinite(n) || n < 1) return "unknown";
    let at = 0;
    for (let i = 0; i < cut.length; i++) if (n >= cut[i]) at = i;
    return names[at] ?? "unknown";
  }
  function visitBucket(visitCount) {
    const n = typeof visitCount === "number" && Number.isFinite(visitCount) ? Math.floor(visitCount) : 1;
    if (n <= 1) return "1";
    if (n <= 3) return "2-3";
    return "4+";
  }
  var PAID_SEARCH_MEDIUMS = /* @__PURE__ */ new Set(["cpc", "ppc", "paidsearch", "paid_search", "paid-search", "sem", "search_paid"]);
  var PAID_SOCIAL_MEDIUMS = /* @__PURE__ */ new Set(["paid_social", "paidsocial", "paid-social", "social_paid", "display", "banner"]);
  var NETWORK_PAID_MEDIUMS = /* @__PURE__ */ new Set(["paid", "cpm"]);
  var EMAIL_MEDIUMS = /* @__PURE__ */ new Set(["email", "e-mail", "e_mail", "newsletter", "crm"]);
  var ORGANIC_MEDIUMS = /* @__PURE__ */ new Set(["organic", "organic_search"]);
  var REFERRAL_MEDIUMS = /* @__PURE__ */ new Set(["referral", "affiliate", "partner"]);
  var SOCIAL_MEDIUMS = /* @__PURE__ */ new Set(["social", "social_media", "sm"]);
  var EMAIL_SOURCES = /* @__PURE__ */ new Set(["klaviyo", "mailchimp", "braze", "sfmc", "salesforce_marketing_cloud", "sendgrid", "iterable", "newsletter", "email"]);
  var SEARCH_HOSTS = [
    // google, per market
    "google.com",
    "google.ca",
    "google.de",
    "google.fr",
    "google.it",
    "google.es",
    "google.nl",
    "google.be",
    "google.ch",
    "google.at",
    "google.se",
    "google.no",
    "google.dk",
    "google.fi",
    "google.ie",
    "google.pt",
    "google.pl",
    "google.cz",
    "google.sk",
    "google.hu",
    "google.ro",
    "google.bg",
    "google.gr",
    "google.hr",
    "google.si",
    "google.lt",
    "google.lv",
    "google.ee",
    "google.rs",
    "google.ru",
    "google.cl",
    "google.ae",
    "google.co.uk",
    "google.co.in",
    "google.co.jp",
    "google.co.kr",
    "google.co.id",
    "google.co.th",
    "google.co.nz",
    "google.co.za",
    "google.co.il",
    "google.com.au",
    "google.com.br",
    "google.com.mx",
    "google.com.co",
    "google.com.ar",
    "google.com.pe",
    "google.com.tr",
    "google.com.sa",
    "google.com.eg",
    "google.com.ng",
    "google.com.hk",
    "google.com.tw",
    "google.com.sg",
    "google.com.my",
    "google.com.ph",
    "google.com.vn",
    "google.com.ua",
    // yahoo, per market
    "yahoo.com",
    "yahoo.ca",
    "yahoo.de",
    "yahoo.es",
    "yahoo.fr",
    "yahoo.it",
    "yahoo.co.jp",
    "yahoo.co.uk",
    "yahoo.com.au",
    "yahoo.com.br",
    "yahoo.com.mx",
    // yandex, per market
    "yandex.com",
    "yandex.ru",
    "yandex.by",
    "yandex.kz",
    "yandex.uz",
    "yandex.com.tr",
    // the single-domain networks
    "bing.com",
    "duckduckgo.com",
    "ecosia.org",
    "baidu.com",
    "brave.com",
    "startpage.com"
  ];
  var SOCIAL_HOSTS = [
    "facebook.com",
    "fb.com",
    "fb.me",
    "meta.com",
    "instagram.com",
    "tiktok.com",
    "pinterest.com",
    "snapchat.com",
    "twitter.com",
    "x.com",
    "t.co",
    "linkedin.com",
    "lnkd.in",
    "reddit.com",
    "youtube.com",
    "threads.net"
  ];
  var SOCIAL_SOURCES = /* @__PURE__ */ new Set(["facebook", "fb", "meta", "instagram", "tiktok", "pinterest", "snapchat", "twitter", "linkedin", "reddit", "youtube", "threads"]);
  var SEARCH_SOURCES = /* @__PURE__ */ new Set(["google", "bing", "yahoo", "duckduckgo", "yandex", "baidu", "ecosia", "brave", "startpage"]);
  var SOURCE_ALIASES = { fb: "facebook", ig: "instagram", insta: "instagram", yt: "youtube", ddg: "duckduckgo" };
  function norm(v) {
    return typeof v === "string" ? v.trim().toLowerCase() : "";
  }
  function hostOf(referrer) {
    const url = referrer === "" ? null : parsed(referrer);
    return url ? rootStripped(url.hostname.toLowerCase()) : "";
  }
  function siteOf(value) {
    return typeof value === "string" ? rootStripped(authorityHost(value.trim())) : "";
  }
  var matches = (host, domains) => host !== "" && domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  function sourceTokens(source) {
    return source.split(/[\s_-]+/).filter((token) => token !== "").map((token) => SOURCE_ALIASES[token] ?? token);
  }
  function declaresNetwork(source, names, hosts) {
    if (source === "") return false;
    return source.includes(".") ? matches(hostOf(source), hosts) : sourceTokens(source).some((token) => names.has(token));
  }
  var declaresSocial = (source) => declaresNetwork(source, SOCIAL_SOURCES, SOCIAL_HOSTS);
  var declaresSearch = (source) => declaresNetwork(source, SEARCH_SOURCES, SEARCH_HOSTS);
  var GCLID_LIMIT = 512;
  function autoTagged(signals) {
    const id = signals.gclid;
    return typeof id === "string" && id.trim() !== "" && id.length <= GCLID_LIMIT;
  }
  function classifyEntryChannel(signals) {
    const medium = norm(signals.utmMedium);
    const source = norm(signals.utmSource);
    if (source === "" && autoTagged(signals)) return "paid_search";
    if (medium !== "") {
      if (PAID_SEARCH_MEDIUMS.has(medium) || NETWORK_PAID_MEDIUMS.has(medium)) {
        if (declaresSocial(source)) return "paid_social";
        if (PAID_SEARCH_MEDIUMS.has(medium) || declaresSearch(source)) return "paid_search";
      } else if (PAID_SOCIAL_MEDIUMS.has(medium)) return "paid_social";
      else if (EMAIL_MEDIUMS.has(medium)) return "email";
      else if (REFERRAL_MEDIUMS.has(medium)) return "referral";
      else if (ORGANIC_MEDIUMS.has(medium)) return "organic";
      else if (SOCIAL_MEDIUMS.has(medium)) return declaresSocial(source) ? "paid_social" : "referral";
    }
    if (source !== "" && EMAIL_SOURCES.has(source)) return "email";
    const host = hostOf(norm(signals.referrer));
    if (host === "") return "direct";
    const site = siteOf(signals.siteHost);
    if (site !== "" && (host === site || host.endsWith(`.${site}`))) return "direct";
    if (matches(host, SEARCH_HOSTS)) return "organic";
    return "referral";
  }

  // src/sdk/identity.ts
  var DEFAULT_VISITOR_KEY = "opt_visitor_id";
  var HEAD_STATE_KEY = "opt_head";
  var YEAR_SECONDS = 60 * 60 * 24 * 365;
  var DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1e3;
  function entrySignals(host) {
    let utmMedium = "", utmSource = "", utmTerm = "", utmCampaign = "";
    try {
      const usp = new URLSearchParams(host.location?.search ?? "");
      utmMedium = usp.get("utm_medium") ?? "";
      utmSource = usp.get("utm_source") ?? "";
      utmTerm = usp.get("utm_term") ?? "";
      if (utmTerm.length > ENTRY_TERM_LIMIT) utmTerm = "";
      utmCampaign = usp.get("utm_campaign") ?? "";
      if (utmCampaign.length > ENTRY_CAMPAIGN_LIMIT) utmCampaign = "";
    } catch {
    }
    return {
      utmMedium,
      utmSource,
      ...utmTerm ? { utmTerm } : {},
      ...utmCampaign ? { utmCampaign } : {},
      referrer: host.referrer ?? "",
      siteHost: host.location?.hostname ?? ""
    };
  }

  // src/sdk/head.ts
  var SHOTS_MS = 30 * 864e5;
  var record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  var isClass = (v) => v === "default" || v === "personalized";
  function readBlock(page2, id) {
    try {
      const el = page2.document.getElementById(id);
      return el ? JSON.parse(el.textContent || "null") : null;
    } catch {
      return null;
    }
  }
  function tableOf(v) {
    if (!record(v) || typeof v.version !== "string" || typeof v.classifierVersion !== "string" || !Array.isArray(v.rows) || !record(v.holdout) || typeof v.holdout.share !== "number" || !Array.isArray(v.holdout.arms) || v.carouselSlot !== null && typeof v.carouselSlot !== "string") return null;
    return v;
  }
  function stateOf(raw) {
    try {
      const v = JSON.parse(raw || "{}");
      return record(v) ? v : {};
    } catch {
      return {};
    }
  }
  function cookieRefuses(page2, choice) {
    const own = choice === "tracking" ? "opt_tracking_consent" : "opt_personalization_enabled";
    return page2.document.cookie.split(";").some((pair) => {
      const at = pair.indexOf("="), name = pair.slice(0, at).trim(), value = pair.slice(at + 1).trim();
      return at > 0 && (name === own ? value === "false" : name.startsWith("opt_shopper_refusal") && name.endsWith(`_${choice}`) && value !== "");
    });
  }
  function main(page2) {
    const table = tableOf(readBlock(page2, "op-context-table")), images = readBlock(page2, "op-images");
    if (!table) return;
    const root = page2.document.documentElement, now = Date.now();
    let state = {};
    try {
      state = stateOf(page2.localStorage.getItem(HEAD_STATE_KEY));
    } catch {
      state = {};
    }
    const hint = (root.getAttribute("data-op-consent") || "").split(/\s+/);
    const kept = record(state.consent) ? state.consent : null;
    const refusesTracking = cookieRefuses(page2, "tracking") || kept !== null && kept.tracking !== true;
    const tracking = !refusesTracking && (kept !== null || hint.includes("tracking") || hint.includes("personalization"));
    const personalization = tracking && (kept ? kept.personalization === true : hint.includes("personalization")) && !cookieRefuses(page2, "personalization");
    const cell = tracking ? cellOf(page2, table, state, now) : null;
    if (refusesTracking) delete state.visit;
    const nav = page2.navigator;
    const device = deviceOf({ get: (name) => name === "User-Agent" ? nav.userAgent : name === "Sec-CH-UA-Mobile" && nav.userAgentData ? nav.userAgentData.mobile ? "?1" : "?0" : null });
    const holdout = table.holdout, arms = holdout.arms.length ? holdout.arms : ["default"];
    let cls, rotated = false, visitor = null;
    try {
      visitor = page2.localStorage.getItem(DEFAULT_VISITOR_KEY);
    } catch {
      visitor = null;
    }
    const experiment = record(state.experiment) && typeof state.experiment.id === "string" ? state.experiment : null;
    const moved = (version) => typeof version === "number" && typeof holdout.saltVersion === "number" && version !== holdout.saltVersion;
    const draw = () => {
      const drawn = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 < defaultArmProbability({ share: holdout.share, arms }) ? "default" : "personalized";
      state.arm = { class: drawn, saltVersion: holdout.saltVersion, tableVersion: table.version };
      return drawn;
    };
    if (visitor && experiment) {
      cls = armClassOf(armFor(visitor, { share: holdout.share, salt: experiment.id.split(":").slice(2).join(":"), arms }));
      rotated = moved(experiment.saltVersion);
    } else if (record(state.arm) && isClass(state.arm.class)) {
      rotated = moved(state.arm.saltVersion);
      if (typeof state.arm.saltVersion !== "number" && typeof holdout.saltVersion === "number") state.arm.saltVersion = holdout.saltVersion;
      cls = rotated ? draw() : state.arm.class;
    } else cls = draw();
    const row = personalization && cls === "personalized" && !rotated && table.classifierVersion === CLASSIFIER_VERSION && cell?.channel && device ? table.rows.find((r) => record(r) && r.channel === cell.channel && r.visitBucket === cell.bucket) : void 0;
    root.setAttribute("data-op-context", row && cell ? `${cell.channel}|${cell.bucket}|${device}` : "default");
    root.setAttribute("data-op-arm", cls);
    root.setAttribute("data-op-table", table.version);
    const shots = state.shots, own = personalization && cls === "personalized" && !rotated && record(shots) && visitor && shots.subject === visitor && typeof shots.ts === "number" && now - shots.ts <= SHOTS_MS && Array.isArray(shots.order) ? shots.order.filter((v) => typeof v === "string") : [];
    if (refusesTracking || cookieRefuses(page2, "personalization") || kept && kept.personalization !== true) delete state.shots;
    try {
      page2.localStorage.setItem(HEAD_STATE_KEY, JSON.stringify(state));
    } catch {
    }
    const rowShots = row && device ? row.shotOrder[device] : null;
    if (typeof table.carouselSlot === "string" && Array.isArray(images)) {
      paint(page2, table, table.carouselSlot, images, own.length ? [...own, ...(rowShots ?? []).filter((v) => !own.includes(v))] : rowShots, now);
    }
  }
  function cellOf(page2, table, state, now) {
    const cv = table.channelVocabulary;
    const vocabulary = cv ? {
      revision: cv.revision,
      vocabulary: { channels: cv.channels.map((id) => ({ id, name: id })), rules: cv.rules, sourcePlatforms: [], landingPageTypes: [], visitBuckets: cv.visitBuckets }
    } : null;
    const prior = record(state.visit) ? state.visit : null;
    const visit = liveVisit(prior, prior ? prior.lastSeen : null, now, entrySignals({ location: page2.location, referrer: page2.document.referrer }), vocabulary ? { vocabulary } : void 0);
    state.visit = { ...visit, lastSeen: now };
    return { channel: visit.entryChannel ?? null, bucket: cv ? visitBucketUnder(visit.visitCount, cv.visitBuckets) : visitBucket(visit.visitCount) };
  }
  function paint(page2, table, slot, images, shots, now) {
    const root = page2.document.documentElement;
    const valuesOf = (n, dimension) => {
      const v = images[n]?.tags?.[dimension];
      return Array.isArray(v) ? v : [];
    };
    const tagged = (n, rule) => valuesOf(n, rule.dimension).includes(rule.value);
    const rank = (n) => {
      if (!shots) return 0;
      let best = shots.length;
      for (const value of valuesOf(n, "contentType")) {
        const at = typeof value === "string" ? shots.indexOf(value) : -1;
        if (at >= 0 && at < best) best = at;
      }
      return best;
    };
    let order = images.map((_, n) => n).sort((a, b) => rank(a) - rank(b) || a - b);
    const rules = table.brandRules ?? {}, fixed = /* @__PURE__ */ new Set();
    const pin = rules.pinnedTag;
    if (pin && Date.parse(pin.window.from) <= now && now < Date.parse(pin.window.to)) {
      const lead2 = order.find((n) => tagged(n, pin));
      if (lead2 !== void 0) {
        order = [lead2, ...order.filter((n) => n !== lead2)];
        fixed.add(lead2);
      }
    }
    const minimum = rules.minimum;
    if (minimum) {
      const within = Math.min(minimum.within, order.length);
      const need = minimum.count - order.slice(0, within).filter((n) => tagged(n, minimum)).length;
      const ranked = order.filter((n) => !fixed.has(n)), kept = order.slice(0, within).filter((n) => !fixed.has(n)).length;
      const head = ranked.slice(0, kept), tail = ranked.slice(kept);
      const pool = tail.filter((n) => tagged(n, minimum)), leaving = head.filter((n) => !tagged(n, minimum));
      const k = need > 0 ? Math.min(need, pool.length, leaving.length) : 0;
      if (k > 0) {
        const incoming = pool.slice(0, k), displaced = new Set(leaving.slice(-k));
        const next = [...head.filter((n) => !displaced.has(n)), ...incoming, ...head.filter((n) => displaced.has(n)), ...tail.filter((n) => !incoming.includes(n))];
        let j = 0;
        order = order.map((n) => fixed.has(n) ? n : next[j++]);
      }
    }
    order.forEach((n, at) => root.style.setProperty(`--op-${slot}-${n + 1}`, String(at + 1)));
    const lead = order.length ? images[order[0]] : void 0;
    if (!lead || typeof lead.src !== "string") return;
    const link = page2.document.createElement("link");
    link.setAttribute("rel", "preload");
    link.setAttribute("as", "image");
    link.setAttribute("href", lead.src);
    if (typeof lead.srcset === "string") link.setAttribute("imagesrcset", lead.srcset);
    if (typeof lead.sizes === "string") link.setAttribute("imagesizes", lead.sizes);
    link.setAttribute("fetchpriority", "high");
    page2.document.head.insertBefore(link, page2.document.head.querySelector('link[rel="stylesheet"]'));
  }
  var page = globalThis;
  if (page.document && page.location) {
    try {
      main(page);
    } catch {
    }
  }
})();
