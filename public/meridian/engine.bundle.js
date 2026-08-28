// src/demos/meridian/reflexConfig.ts
var SECOND = 1e3;
var MINUTE = 60 * SECOND;
var HOUR = 60 * MINUTE;
var DAY = 24 * HOUR;
var DEMO_TAUS = {
  // Retuned against a measured run. The three surfaces still retreat in order —
  // narrow, then broad, then need — but the whole staircase now completes inside
  // ~90s of narration instead of ~160s of silence.
  broad: 45 * SECOND,
  narrow: 30 * SECOND,
  band: 150 * SECOND,
  durable: 120 * SECOND,
  need: 60 * SECOND,
  content: 45 * SECOND,
  // Intent is the most perishable thing here. Someone who was deciding two
  // minutes ago and has been idle since is browsing again.
  stage: 40 * SECOND
};
var PROD_TAUS = {
  broad: 14 * DAY,
  narrow: 7 * DAY,
  band: 45 * DAY,
  durable: 60 * DAY,
  need: 21 * DAY,
  content: 14 * DAY,
  stage: 3 * DAY
};
var SHAPE_TUNING = {
  broad: { K: 1.8, thetaIn: 0.6, thetaOut: 0.45 },
  narrow: { K: 1.6, thetaIn: 0.6, thetaOut: 0.45 },
  band: { K: 2.4, thetaIn: 0.55, thetaOut: 0.4 },
  durable: { K: 2.2, thetaIn: 0.58, thetaOut: 0.42 },
  need: { K: 1.8, thetaIn: 0.6, thetaOut: 0.45 },
  content: { K: 1.6, thetaIn: 0.6, thetaOut: 0.45 },
  // Low K on purpose: one add-to-bag (weight 3.0) gives a = 3.0/(3.0+1.4) =
  // 0.68, clear of θ_in. Deciding is a state you enter on one decisive act.
  stage: { K: 1.4, thetaIn: 0.6, thetaOut: 0.45 }
};
var MERIDIAN_WEIGHTS = {
  /** The cold-start seed, derived from published census figures. Sized to land
      the band affinity visibly above zero but below theta_out — we know
      something, we have not committed to anything.
      At 1.6 it landed a = 1.6/(1.6+2.4) = 0.400 against a theta_out of 0.40,
      i.e. exactly ON the line, so it claimed for one tick and immediately
      announced its own retreat. 1.35 gives a = 0.36: unmistakably non-zero on
      the bar, and comfortably short of committing. */
  prior: 1.35,
  /** An off-site arrival — email opened, ad clicked, form submitted. Someone
      chose to act on a surface that is not your website, which is a stronger
      statement than a page view and weaker than adding to a bag. */
  arrival: 2,
  /** Zero-party: the visitor STATED this rather than revealed it. Weighted above
      an arrival because it is unambiguous, and below a purchase because saying
      you like evening pieces is not the same as buying one. Critically it lands
      in the SAME vector as observed behaviour and decays on the SAME clock — a
      preference declared once stops driving the page unless behaviour agrees. */
  declared: 3.2,
  /** Choosing a department is a broader statement than opening one product —
      it is the visitor telling you which aisle they are in. */
  nav_click: 2,
  view: 1,
  scroll_depth: 0.5,
  rail_click: 1.5,
  block_read: 1.2,
  row_click: 1.5,
  search: 2,
  save: 3,
  intent_start: 3,
  // add to cart · begin application
  convert: 4,
  // purchase · submit application
  reflex_tick: 0
  // re-evaluate only — never accumulates
};
function dim(shape, key, source, taus, extra = {}) {
  return { key, source, tauMs: taus[shape], ...SHAPE_TUNING[shape], ...extra };
}
function buildConfig(vertical, taus) {
  const retail = vertical === "retail";
  const rate = taus === DEMO_TAUS ? "demo" : "prod";
  return {
    version: `meridian-${vertical}-${rate}-v1`,
    dimensions: [
      dim("broad", retail ? "category" : "productFamily", "category", taus),
      // The one place the two registries read different fields — see the header.
      dim("narrow", retail ? "line" : "subFamily", retail ? "line" : "subcategory", taus),
      dim("band", retail ? "priceBand" : "amountBand", "value_usd", taus, {
        derive: "band",
        // Retail: everyday / considered / premium. Financial: modest / core / major.
        cuts: retail ? [75, 250] : [25e3, 25e4],
        labels: retail ? ["entry", "core", "premium"] : ["modest", "core", "major"]
      }),
      dim("durable", retail ? "styleWorld" : "lifeStage", "world", taus),
      dim("need", retail ? "occasion" : "intent", "needs", taus, { multi: true }),
      dim("content", "contentType", "contentType", taus),
      // Source deliberately names no item field. extractTouches skips a source
      // it cannot find, so this dimension can only ever be moved by an
      // explicitly emitted verb — which is exactly the guarantee we want.
      dim("stage", retail ? "journeyStage" : "applicationStage", "__verb__", taus)
    ],
    weights: { ...MERIDIAN_WEIGHTS },
    // Globals are per-dimension-overridden above; these are the floor.
    tauMs: taus.broad,
    K: 1.8,
    thetaIn: 0.6,
    thetaOut: 0.45,
    epsilon: 0.01,
    maxValuesPerDim: 24
  };
}
var MERIDIAN_RETAIL_CONFIG = buildConfig("retail", DEMO_TAUS);
var MERIDIAN_FINANCIAL_CONFIG = buildConfig("financial", DEMO_TAUS);
var MERIDIAN_RETAIL_CONFIG_PROD = buildConfig("retail", PROD_TAUS);
var MERIDIAN_FINANCIAL_CONFIG_PROD = buildConfig("financial", PROD_TAUS);
function configFor(vertical, rate = "demo") {
  if (rate === "prod") {
    return vertical === "retail" ? MERIDIAN_RETAIL_CONFIG_PROD : MERIDIAN_FINANCIAL_CONFIG_PROD;
  }
  return vertical === "retail" ? MERIDIAN_RETAIL_CONFIG : MERIDIAN_FINANCIAL_CONFIG;
}
var SHAPE_OF_KEY = {
  category: "broad",
  productFamily: "broad",
  line: "narrow",
  subFamily: "narrow",
  priceBand: "band",
  amountBand: "band",
  styleWorld: "durable",
  lifeStage: "durable",
  occasion: "need",
  intent: "need",
  contentType: "content",
  journeyStage: "stage",
  applicationStage: "stage"
};
var SHAPE_ORDER = ["broad", "narrow", "need", "band", "durable", "content", "stage"];
var LEAD_BY = {
  line: "recency"
};
var DEFAULT_TRAILING = 0.25;
var TRAILING = {
  line: 0.25
};
var trailingFor = (dimKey) => TRAILING[dimKey] ?? DEFAULT_TRAILING;
for (const vertical of ["retail", "financial"]) {
  for (const d of configFor(vertical).dimensions) {
    const shape = SHAPE_OF_KEY[d.key];
    if (!shape) {
      throw new Error(
        `reflexConfig: dimension "${d.key}" (${vertical}) is missing from SHAPE_OF_KEY. It would score nothing and fail silently. Add it, and add its shape to SHAPE_ORDER.`
      );
    }
    if (!SHAPE_ORDER.includes(shape)) {
      throw new Error(
        `reflexConfig: shape "${shape}" (from "${d.key}") is missing from SHAPE_ORDER, so it would never be drawn on the instrument.`
      );
    }
  }
}
for (const key of /* @__PURE__ */ new Set([...Object.keys(LEAD_BY), ...Object.keys(TRAILING)])) {
  if (!SHAPE_OF_KEY[key]) {
    throw new Error(
      `reflexConfig: LEAD_BY/TRAILING names "${key}", which is not a Meridian dimension key. The recency rule would silently apply to nothing.`
    );
  }
}
var STAGE_OF_ACTION = {
  view: "browse",
  row_click: "browse",
  rail_click: "browse",
  block_read: "browse",
  nav_click: "browse",
  scroll_depth: "browse",
  arrival: "browse",
  search: "consider",
  save: "consider",
  intent_start: "decide",
  convert: "decide"
};
var STAGE_LABELS = {
  retail: { browse: "browsing", consider: "considering", decide: "deciding" },
  financial: { browse: "exploring", consider: "comparing", decide: "applying" }
};
var stageKeyFor = (v) => v === "retail" ? "journeyStage" : "applicationStage";
var decidingValueFor = (v) => STAGE_LABELS[v].decide;
function stageTouchFor(action, vertical) {
  const step = STAGE_OF_ACTION[action];
  if (!step) return null;
  return { dim: stageKeyFor(vertical), value: STAGE_LABELS[vertical][step] };
}
function expiryOf(state, dim2, value, config) {
  const entry = state.dims?.[dim2]?.[value];
  if (!entry) return null;
  const spec = config.dimensions.find((d) => d.key === dim2);
  const K = spec?.K ?? config.K;
  const thetaOut = spec?.thetaOut ?? config.thetaOut;
  const tauMs = spec?.tauMs ?? config.tauMs;
  const floor = K * thetaOut / (1 - thetaOut);
  if (entry.s <= floor) return null;
  return entry.t + tauMs * Math.log(entry.s / floor);
}

// src/demos/meridian/lead.ts
function leadValue(state, dimKey) {
  const entries = state?.dims?.[dimKey];
  if (!entries) return null;
  let lead = null;
  let best = null;
  for (const [value, e] of Object.entries(entries)) {
    if (lead === null || best === null) {
      lead = value;
      best = e;
      continue;
    }
    const newer = e.t > best.t || e.t === best.t && (e.s > best.s || e.s === best.s && value < lead);
    if (newer) {
      lead = value;
      best = e;
    }
  }
  return lead;
}
function leadWeights(state, spec, trailing = trailingFor(spec.key)) {
  if (LEAD_BY[spec.key] !== "recency") return null;
  const lead = leadValue(state, spec.key);
  if (lead === null) return null;
  return {
    dim: spec.key,
    by: "recency",
    lead,
    trailing,
    weight: (value) => value === lead ? 1 : trailing,
    mark: (value) => value === lead ? { lead: "recency" } : { lead: "trailing", trailing, ledBy: lead }
  };
}

// src/demos/meridian/composer.ts
var SLOT_STRATEGIES = {
  // Each slot's HIGHEST-weighted shape is its lead, and the lead is what decides
  // whether the slot may still claim the visitor as its reason. Leads are chosen
  // so that the three surfaces sit on three different decay constants — narrow
  // (60s), broad (90s), need (120s) — which is what turns one stretch of
  // inactivity into three separate, nameable retreats instead of one collapse.
  //
  // The hero commits. It leans on the slow axes so it does not flap.
  hero: { broad: 0.35, durable: 0.3, need: 0.2, band: 0.15, narrow: 0, content: 0, stage: 0 },
  // The rail is fast-twitch: it answers the last thing you did.
  rail: { narrow: 0.4, broad: 0.3, need: 0.2, band: 0.1, durable: 0, content: 0, stage: 0 },
  // The row ranks merchandise. Led by NEED rather than narrow so it outlives the
  // rail — a row about "things for a project" stays true longer than a row about
  // "cordless sanders specifically".
  row: { need: 0.3, narrow: 0.25, broad: 0.25, band: 0.15, durable: 0.05, content: 0, stage: 0 },
  // Blocks are content: what KIND of asset earns attention matters most.
  block_a: { content: 0.35, broad: 0.25, need: 0.2, durable: 0.2, narrow: 0, band: 0, stage: 0 },
  block_b: { content: 0.35, broad: 0.25, need: 0.2, durable: 0.2, narrow: 0, band: 0, stage: 0 }
};
function match(record, source, value) {
  const raw = record[source];
  if (raw == null) return 0;
  if (Array.isArray(raw)) {
    const hit = raw.some((v) => String(v) === value);
    return hit ? 1 / Math.max(1, raw.length) : 0;
  }
  return String(raw) === value ? 1 : 0;
}
function bandLabel(v, cuts, labels) {
  let i = 0;
  while (i < cuts.length && v >= cuts[i]) i += 1;
  return labels[i] ?? labels[labels.length - 1];
}
function scoreOne(record, input, strategy) {
  const drivers = [];
  let score = 0;
  for (const spec of input.config.dimensions) {
    const shape = input.shapeOfKey[spec.key];
    const omega = strategy[shape] ?? 0;
    if (omega === 0) continue;
    const perValue = input.affinity.dims[spec.key];
    if (!perValue) continue;
    const lead = input.state ? leadWeights(input.state, spec) : null;
    for (const [value, a] of Object.entries(perValue)) {
      if (a <= 0) continue;
      const m = spec.derive === "band" && spec.cuts && spec.labels ? bandLabel(Number(record[spec.source] ?? 0), spec.cuts, spec.labels) === value ? 1 : 0 : match(record, spec.source, value);
      if (m === 0) continue;
      const contribution = omega * a * (lead ? lead.weight(value) : 1) * m;
      score += contribution;
      drivers.push({ dim: spec.key, value, a: round(a), weight: round(contribution), ...lead ? lead.mark(value) : {} });
    }
  }
  drivers.sort((x, y) => y.weight - x.weight);
  const leadShape = Object.entries(strategy).sort((a, b) => b[1] - a[1])[0]?.[0];
  const leadSpec = input.config.dimensions.find((d) => input.shapeOfKey[d.key] === leadShape);
  const leadDriver = leadSpec ? drivers.find((d) => d.dim === leadSpec.key) : void 0;
  const fallbackDriver = drivers[0];
  const judged = leadDriver ?? fallbackDriver;
  const judgedSpec = judged ? input.config.dimensions.find((d) => d.key === judged.dim) : void 0;
  return {
    score,
    drivers: drivers.filter((d, i) => i < 4 || "lead" in d),
    // a trailing value is small by design; the receipt still names it
    confidence: judged?.a ?? 0,
    thetaOut: judgedSpec?.thetaOut ?? input.config.thetaOut
  };
}
var round = (n) => Math.round(n * 1e4) / 1e4;
function gateOf(item) {
  if (item.available === false) return { ok: false, gate: "unavailable" };
  if (item.embargoed) return { ok: false, gate: "embargoed" };
  return { ok: true };
}
function compose(input) {
  const { items, blocks, config } = input;
  const rowSize = input.rowSize ?? 6;
  const decisions = [];
  const coldStart = Object.keys(input.affinity.dims).length === 0;
  let order = 0;
  const usedItems = /* @__PURE__ */ new Set();
  const usedBlocks = /* @__PURE__ */ new Set();
  const rank = (pool, slot, used) => {
    const strategy = SLOT_STRATEGIES[slot];
    const scored = pool.filter((r) => !used.has(r.id)).map((r) => ({ r, ...scoreOne(r, input, strategy) })).sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));
    const eligible = [];
    const refused = [];
    for (const s of scored) {
      const g = gateOf(s.r);
      if (g.ok) eligible.push(s);
      else refused.push({ id: s.r.id, score: round(s.score), gate: g.gate });
    }
    return { scored: eligible, refused, gated: refused.map((x) => `${x.gate}:${x.id}`) };
  };
  const explainOf = (drivers, candidates, gatesFailed, rankPos, confidence, thetaOut) => ({
    drivers,
    candidates,
    gatesFailed: gatesFailed.slice(0, 4),
    rank: rankPos,
    confidence,
    thetaOut,
    configVersion: config.version
  });
  const strategyFor = (s) => {
    if (coldStart) return "cold-start";
    if (!s || s.score <= 0) return "fallback";
    return s.confidence >= s.thetaOut ? "affinity" : "fading";
  };
  for (const slot of ["hero", "rail"]) {
    const pin = input.pins?.[slot];
    if (pin) {
      decisions.push({
        slot,
        order: order++,
        itemId: pin,
        strategy: "pin",
        explain: explainOf([], items.length, ["pinned-by-merchandiser"], 0)
      });
      usedItems.add(pin);
      continue;
    }
    const { scored, gated, refused } = rank(items, slot, usedItems);
    const top = scored[0];
    if (top) usedItems.add(top.r.id);
    decisions.push({
      slot,
      order: order++,
      itemId: top?.r.id,
      strategy: strategyFor(top),
      explain: {
        ...explainOf(top?.drivers ?? [], scored.length, gated, 0, top?.confidence, top?.thetaOut),
        refused: refused.slice(0, 3)
      }
    });
  }
  {
    const stageKey = Object.keys(input.shapeOfKey).find((k) => input.shapeOfKey[k] === "stage");
    const stageSpec = config.dimensions.find((d) => d.key === stageKey);
    const stageVals = stageKey ? input.affinity.dims[stageKey] ?? {} : {};
    const decidingA = input.decidingValue ? stageVals[input.decidingValue] ?? 0 : 0;
    const anchor = input.anchorId ? items.find((i) => i.id === input.anchorId) : void 0;
    const completing = !!anchor && !!input.decidingValue && decidingA >= (stageSpec?.thetaOut ?? config.thetaOut);
    if (completing && anchor) {
      const { scored, gated } = rank(
        // Complementary, not substitutable: a different category to the anchor's.
        items.filter((i) => i.category !== anchor.category),
        "row",
        usedItems
      );
      const cohered = scored.map((s) => {
        const it = s.r;
        const drivers = [...s.drivers];
        let bonus = 0;
        if (it.world && it.world === anchor.world) {
          bonus += 0.45;
          drivers.push({ dim: "completes", value: `same world \xB7 ${anchor.world}`, a: 1, weight: 0.45 });
        }
        const band = (v) => v == null ? "" : v < 75 ? "entry" : v < 250 ? "core" : "premium";
        if (band(it.value_usd) && band(it.value_usd) === band(anchor.value_usd)) {
          bonus += 0.25;
          drivers.push({ dim: "completes", value: `same band \xB7 ${band(anchor.value_usd)}`, a: 1, weight: 0.25 });
        }
        const shared = (it.needs ?? []).filter((n) => (anchor.needs ?? []).includes(n));
        if (shared.length) {
          bonus += 0.3;
          drivers.push({ dim: "completes", value: `same occasion \xB7 ${shared[0]}`, a: 1, weight: 0.3 });
        }
        return { ...s, drivers, score: s.score + bonus };
      }).sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));
      cohered.slice(0, rowSize).forEach((s, i) => {
        usedItems.add(s.r.id);
        decisions.push({
          slot: "row",
          order: order++,
          itemId: s.r.id,
          strategy: "completion",
          anchorId: anchor.id,
          explain: explainOf(s.drivers, cohered.length, i === 0 ? gated : [], i, s.confidence, s.thetaOut)
        });
      });
    } else {
      const { scored, gated } = rank(items, "row", usedItems);
      scored.slice(0, rowSize).forEach((s, i) => {
        usedItems.add(s.r.id);
        decisions.push({
          slot: "row",
          order: order++,
          itemId: s.r.id,
          strategy: strategyFor(s),
          explain: explainOf(s.drivers, scored.length, i === 0 ? gated : [], i, s.confidence, s.thetaOut)
        });
      });
    }
  }
  for (const slot of ["block_a", "block_b"]) {
    const pool = blocks.filter((b) => b.slots.includes(slot));
    const { scored, gated } = rank(pool, slot, usedBlocks);
    const top = scored[0];
    if (top) usedBlocks.add(top.r.id);
    decisions.push({
      slot,
      order: order++,
      blockId: top?.r.id,
      strategy: strategyFor(top),
      explain: explainOf(top?.drivers ?? [], scored.length, gated, 0, top?.confidence, top?.thetaOut)
    });
  }
  return decisions;
}

// src/reflex/core.ts
function slugValue(v) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function audienceKey(dim2, value) {
  return `${slugValue(dim2)}_${slugValue(value)}_affinity`;
}
function dimParams(config, spec) {
  return {
    tauMs: spec?.tauMs ?? config.tauMs,
    K: spec?.K ?? config.K,
    thetaIn: spec?.thetaIn ?? config.thetaIn,
    thetaOut: spec?.thetaOut ?? config.thetaOut
  };
}
function specOf(config, dim2) {
  return config.dimensions.find((d) => d.key === dim2);
}
function effectiveScore(entry, now, tauMs) {
  const dt = Math.max(0, now - entry.t);
  return entry.s * Math.exp(-dt / tauMs);
}
function affinityOf(effScore, K) {
  return effScore <= 0 ? 0 : effScore / (effScore + K);
}
function emptyState(config) {
  return { v: 1, dims: {}, audiences: [], configVersion: config.version };
}
function extractTouches(product, config) {
  const touches = [];
  for (const spec of config.dimensions) {
    const raw = product[spec.source];
    if (raw === void 0 || raw === null) continue;
    if (spec.derive === "band") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n) || !spec.cuts || !spec.labels) continue;
      let idx = spec.cuts.findIndex((cut) => n < cut);
      if (idx === -1) idx = spec.cuts.length;
      const label = spec.labels[idx];
      if (label) touches.push({ dim: spec.key, value: label });
      continue;
    }
    if (spec.multi && Array.isArray(raw)) {
      for (const v of raw) {
        if (typeof v === "string" && v.trim()) touches.push({ dim: spec.key, value: v });
      }
      continue;
    }
    if (typeof raw === "string" && raw.trim()) {
      touches.push({ dim: spec.key, value: raw });
    }
  }
  return touches;
}
function apply(prev, input, now, config) {
  const base = prev && prev.v === 1 ? prev : emptyState(config);
  const weight = config.weights[input.action] ?? 0;
  const dims = {};
  for (const d of Object.keys(base.dims)) dims[d] = { ...base.dims[d] };
  if (weight > 0) {
    for (const touch of input.touches) {
      if (!touch.value) continue;
      const spec = specOf(config, touch.dim);
      if (!spec) continue;
      const p = dimParams(config, spec);
      const dimMap = dims[touch.dim] = dims[touch.dim] ?? {};
      const prevEntry = dimMap[touch.value];
      const carried = prevEntry ? effectiveScore(prevEntry, now, p.tauMs) : 0;
      dimMap[touch.value] = { s: carried + weight, t: now };
    }
  }
  for (const d of Object.keys(dims)) {
    const p = dimParams(config, specOf(config, d));
    const dimMap = dims[d];
    for (const v of Object.keys(dimMap)) {
      if (effectiveScore(dimMap[v], now, p.tauMs) < config.epsilon) delete dimMap[v];
    }
    const values = Object.keys(dimMap);
    if (values.length > config.maxValuesPerDim) {
      values.map((v) => ({ v, eff: effectiveScore(dimMap[v], now, p.tauMs) })).sort((a, b) => a.eff - b.eff || (a.v < b.v ? -1 : 1)).slice(0, values.length - config.maxValuesPerDim).forEach(({ v }) => delete dimMap[v]);
    }
    if (Object.keys(dimMap).length === 0) delete dims[d];
  }
  const prevAudiences = new Set(base.audiences);
  const next = /* @__PURE__ */ new Set();
  const explain = [];
  const meta = /* @__PURE__ */ new Map();
  for (const d of Object.keys(dims).sort()) {
    const p = dimParams(config, specOf(config, d));
    const dimMap = dims[d];
    for (const v of Object.keys(dimMap).sort()) {
      const a = affinityOf(effectiveScore(dimMap[v], now, p.tauMs), p.K);
      const key = audienceKey(d, v);
      meta.set(key, { dim: d, value: v, a, p });
      const wasMember = prevAudiences.has(key);
      if (wasMember ? a >= p.thetaOut : a >= p.thetaIn) next.add(key);
    }
  }
  const entered = [...next].filter((k) => !prevAudiences.has(k)).sort();
  const exited = [...prevAudiences].filter((k) => !next.has(k)).sort();
  for (const key of entered) {
    const m = meta.get(key);
    explain.push({
      ts: now,
      audience: key,
      dim: m.dim,
      value: m.value,
      direction: "enter",
      score: round4(m.a),
      thetaIn: m.p.thetaIn,
      thetaOut: m.p.thetaOut,
      trigger: input.action,
      configVersion: config.version
    });
  }
  for (const key of exited) {
    const m = meta.get(key);
    explain.push({
      ts: now,
      audience: key,
      dim: m?.dim ?? "",
      value: m?.value ?? "",
      direction: "exit",
      score: round4(m?.a ?? 0),
      thetaIn: m?.p.thetaIn ?? config.thetaIn,
      thetaOut: m?.p.thetaOut ?? config.thetaOut,
      trigger: input.action,
      configVersion: config.version
    });
  }
  return {
    state: { v: 1, dims, audiences: [...next].sort(), configVersion: config.version },
    changes: { entered, exited, explain }
  };
}
function tick(state, now, config) {
  return apply(state, { action: "tick", touches: [] }, now, config);
}
function snapshot(state, now, config) {
  const dims = {};
  for (const d of Object.keys(state.dims).sort()) {
    const p = dimParams(config, specOf(config, d));
    const out = {};
    for (const v of Object.keys(state.dims[d]).sort()) {
      out[v] = round4(affinityOf(effectiveScore(state.dims[d][v], now, p.tauMs), p.K));
    }
    dims[d] = out;
  }
  return { dims, audiences: [...state.audiences] };
}
function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}

// src/demos/meridian/silhouettes.ts
var SILHOUETTE = {
  Bags: '<path d="M35 40 Q35 23 50 23 Q65 23 65 40"/><path d="M23 40 L77 40 L72 79 L28 79 Z"/>',
  Outerwear: '<path d="M31 28 L69 28 L73 80 L27 80 Z"/><path d="M42 28 L50 41 L58 28"/><path d="M31 28 L20 63"/><path d="M69 28 L80 63"/>',
  Knitwear: '<path d="M33 33 L67 33 L69 72 L31 72 Z"/><path d="M42 33 Q50 41 58 33"/><path d="M33 33 L21 58 L29 63"/><path d="M67 33 L79 58 L71 63"/>',
  Footwear: '<path d="M34 24 L48 24 L50 57 Q70 61 74 70 L74 79 L30 79 L30 34 Z"/><path d="M30 68 L74 68"/>',
  Jewellery: '<circle cx="50" cy="57" r="23"/><path d="M43 30 L50 18 L57 30 Z"/>',
  Fragrance: '<path d="M44 18 L56 18 L56 28 L44 28 Z"/><path d="M47 28 L53 28 L53 34 L47 34"/><path d="M38 34 L62 34 Q66 34 66 40 L66 76 Q66 80 62 80 L38 80 Q34 80 34 76 L34 40 Q34 34 38 34 Z"/>',
  Eyewear: '<circle cx="33" cy="53" r="14"/><circle cx="67" cy="53" r="14"/><path d="M47 51 Q50 46 53 51"/><path d="M19 48 L13 43"/><path d="M81 48 L87 43"/>',
  Scarves: '<path d="M32 24 Q50 35 68 24 L68 35 Q50 46 32 35 Z"/><path d="M37 40 L34 79"/><path d="M63 40 L66 79"/>',
  // Financial — the same job, a different shelf.
  Mortgage: '<path d="M22 50 L50 26 L78 50"/><path d="M30 50 L30 79 L70 79 L70 50"/><path d="M44 79 L44 60 L56 60 L56 79"/>',
  Auto: '<path d="M20 60 L26 42 L74 42 L80 60 L80 70 L20 70 Z"/><circle cx="33" cy="70" r="6"/><circle cx="67" cy="70" r="6"/>',
  Card: '<rect x="20" y="34" width="60" height="38" rx="5"/><path d="M20 46 L80 46"/><path d="M30 60 L48 60"/>',
  Savings: '<path d="M28 44 Q28 32 50 32 Q72 32 72 44 L72 68 Q72 76 62 76 L38 76 Q28 76 28 68 Z"/><path d="M46 32 L46 22"/><path d="M54 32 L54 22"/>',
  Investing: '<path d="M22 72 L40 52 L54 62 L78 30"/><path d="M62 30 L78 30 L78 46"/>'
};
var FALLBACK_SILHOUETTE = '<rect x="28" y="30" width="44" height="48" rx="4"/><path d="M28 62 L44 48 L58 62 L72 50"/>';
function silhouetteFor(category) {
  return SILHOUETTE[category] ?? FALLBACK_SILHOUETTE;
}
function packshot(item, opts = {}) {
  const words = item.name.split(" ");
  const mid = Math.ceil(words.length / 2);
  const l1 = words.slice(0, mid).join(" ");
  const l2 = words.slice(mid).join(" ");
  const g = `g${item.id.replace(/[^a-z0-9]/gi, "")}`;
  const H = opts.square ? 100 : 125;
  const shadowY = opts.square ? 79 : 86;
  const label = opts.withName === false ? "" : `
  <text x="50" y="104" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif"
        font-size="6.4" font-weight="700" fill="${item.hex}" opacity=".92">${esc(l1)}</text>
  <text x="50" y="113" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif"
        font-size="6.4" font-weight="700" fill="${item.hex}" opacity=".92">${esc(l2)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(item.name)}">
  <defs><linearGradient id="${g}" x1="0" y1="0" x2="0.6" y2="1">
    <stop offset="0" stop-color="${item.hex}" stop-opacity=".34"/>
    <stop offset="1" stop-color="${item.hex}" stop-opacity=".13"/>
  </linearGradient></defs>
  <rect width="100" height="${H}" fill="url(#${g})"/>
  <ellipse cx="50" cy="${shadowY}" rx="26" ry="3.5" fill="${item.hex}" opacity=".18"/>
  <g fill="none" stroke="${item.hex}" stroke-opacity=".72" stroke-width="2.1"
     stroke-linecap="round" stroke-linejoin="round">${silhouetteFor(item.category)}</g>${label}
</svg>`;
}
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export {
  DEMO_TAUS,
  PROD_TAUS,
  SHAPE_OF_KEY,
  SHAPE_ORDER,
  SLOT_STRATEGIES,
  STAGE_LABELS,
  affinityOf,
  apply,
  audienceKey,
  compose,
  configFor,
  decidingValueFor,
  effectiveScore,
  emptyState,
  expiryOf,
  extractTouches,
  packshot,
  silhouetteFor,
  snapshot,
  stageKeyFor,
  stageTouchFor,
  tick
};
