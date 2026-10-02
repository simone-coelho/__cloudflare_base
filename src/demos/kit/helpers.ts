// src/demos/kit/helpers.ts
// ──────────────────────────────────────────────────────
// The demo kit's pure helpers (docs/demo-kit/Demo-Kit-Design.md §2.1), lifted
// from src/routes/vantage.ts unchanged in logic. What was Vantage's own
// constant is now a parameter: the tenant prefix a decision id must carry, and
// the intents a page may assert. Nothing here reads an environment, a clock or
// a binding, so each is checkable on its own.
// ──────────────────────────────────────────────────────

/** The two documents a beat may publish. */
export type BeatKind = 'catalog' | 'slots';

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A note is attribution, not free text: it lands in the audit index. */
export const noteOf = (value: unknown): string =>
  (typeof value === 'string' ? value : '').replace(/[^\p{L}\p{N} .,:;'’—-]/gu, '').slice(0, 120);

/**
 * The document a beat file publishes, or null. The file must say it is this
 * beat, that it is a publish, and that it publishes the kind the closed list
 * names for it; anything else (a context beat, a renamed file, the static
 * host's HTML fallback for a missing asset) publishes nothing.
 */
export function publishedDocument(beat: unknown, name: string, kind: BeatKind): Record<string, unknown> | null {
  if (!isRecord(beat) || beat.name !== name || beat.kind !== 'publish') return null;
  const publish = beat.publish;
  if (!isRecord(publish) || publish.kind !== kind || !isRecord(publish.document)) return null;
  return publish.document;
}

/**
 * Whether a decision id names one of THIS visitor's decisions on `tenant`. Ids
 * are `${tenant}:${ts36}:${visitorId}:${page}:${slot}:${position}[:n1:${nonce}]`
 * (src/content/decide.ts), so the owner is checkable before anything is read.
 * An empty tenant, like an empty subject, names no one's decisions.
 */
export function ownDecisionId(id: unknown, subject: string, tenant: string): id is string {
  if (typeof id !== 'string' || id.length > 512 || !subject || !tenant) return false;
  if (!/^[A-Za-z0-9:._~-]+$/.test(id)) return false;
  const prefix = `${tenant}:`;
  if (!id.startsWith(prefix)) return false;
  const rest = id.slice(prefix.length);
  const at = rest.indexOf(':');
  if (at <= 0 || !/^[0-9a-z]+$/.test(rest.slice(0, at))) return false;
  return rest.slice(at + 1).startsWith(`${subject}:`);
}

/**
 * What the "why these" panel may show of one ledger record: everything that
 * explains the decision, nothing that identifies the visitor or replays her
 * vector. `explain` carries the drivers, the arrival seeds (`contextual`),
 * merchandising, stage, freshness, fatigue, diversity and the regional blend.
 */
const RECEIPT_FIELDS = ['decision_id', 'ts', 'page', 'slot', 'position', 'ranking_position', 'item_id', 'customer_item_id',
  'arm', 'authority', 'explored', 'cell', 'journey', 'versions', 'config_label', 'candidates', 'explain', 'measurementBasis',
  'featured_product_ids'] as const;

export function receiptOf(record: Record<string, unknown>): Record<string, unknown> {
  const receipt: Record<string, unknown> = {};
  for (const field of RECEIPT_FIELDS) if (record[field] !== undefined) receipt[field] = record[field];
  return receipt;
}

/** A region key as the engine builds them: country, or country-region. */
const REGION_KEY = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

export type AssertedContext = { intent?: string; region?: string };

/**
 * The page's own assertions for the snapshot that produced the decisions, as
 * the page reports them on the receipt request: `{ intent, region }`. Null
 * when absent; an Error when present and not a value the page can assert. The
 * intents a page can assert are the demo's own (`intents`, its buy-box values).
 */
export function assertedContextOf(value: unknown, intents: ReadonlySet<string>): AssertedContext | null | Error {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return new Error('context must be an object of intent and region');
  const out: AssertedContext = {};
  for (const [key, raw] of Object.entries(value)) {
    // `ctx.intent` or `intent`: the dot is literal, so `ctx-intent` or `ctxXintent` names nothing asserted.
    const name = key.replace(/^ctx\./, '');
    if (name !== 'intent' && name !== 'region') return new Error(`context names ${key}; only intent and region are asserted`);
    if (typeof raw !== 'string') return new Error(`context.${name} must be a string`);
    const v = name === 'region' ? raw.trim().toUpperCase() : raw.trim();
    if (name === 'intent' && !intents.has(v)) return new Error(`context.intent must be one of ${[...intents].join(', ')}`);
    if (name === 'region' && !REGION_KEY.test(v)) return new Error('context.region must be a region key such as US-TX');
    out[name] = v;
  }
  return out;
}

/**
 * What was ASSERTED, rather than observed, for one decision, and where each
 * value comes from, so the page can label it as asserted. The ledger at HEAD
 * records no asserted intent at all, and records an asserted region only when
 * it selected the regional prior (`explain.regional.asserted`, the demo
 * profile's override); anything else is the page's own report of the request
 * that produced the decision. The edge's region is `cell.region`, observed.
 */
export function assertedOf(record: Record<string, unknown>, context: AssertedContext | null): Record<string, unknown> | null {
  const asserted: Record<string, { value: string; from: 'record' | 'request' }> = {};
  const explain = isRecord(record.explain) ? record.explain : {};
  const regional = isRecord(explain.regional) ? explain.regional : null;
  if (regional?.asserted === true && typeof regional.region === 'string') asserted['ctx.region'] = { value: regional.region, from: 'record' };
  else if (context?.region) asserted['ctx.region'] = { value: context.region, from: 'request' };
  if (context?.intent) asserted['ctx.intent'] = { value: context.intent, from: 'request' };
  return Object.keys(asserted).length ? asserted : null;
}

/**
 * The engine's refusal of a day report (a 413: one of its report budgets), as
 * the page prints it. The engine builds one whole UTC day, the narrowest window
 * it accepts (it has no slot or hour filter), so a busy day can outgrow the
 * budget whatever the page asks for; the honest answer names the window and the
 * budget rather than passing it off as a gateway failure.
 */
export function reportTooLarge(date: string, slot: string, refusal: unknown): Record<string, unknown> {
  const r = isRecord(refusal) ? refusal : {};
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    ok: false, code: 'report_too_large', error: 'report too large for the window',
    window: { date, unit: 'UTC day', slot },
    budget: typeof r.budget === 'string' ? r.budget.slice(0, 40) : null, limit: count(r.limit), observed: count(r.observed),
  };
}
