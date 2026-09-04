// src/learn/external.ts
// Doc 22 §9, bringing their own model. The model's output is one named,
// weighted term in the same explain record: the engine adds w_ext × score to
// the base score and lists it beside every other driver. Three kinds share one
// contract. Given the shopper's interest state, the candidates and the cell,
// return a score in [0, 1] per item and a version tag. `table` is a lookup they
// publish to KV and costs nothing on the hot path; `service` is a Worker they
// own behind a service binding (an https URL is accepted for a model hosted
// elsewhere); `workers_ai` is a hosted model. Every kind runs under a hard
// budget in parallel with the engine's own reads and, on a miss, the term is
// omitted and the decision says so. Nitin's team owns the model, its training
// and its versioning; the engine stays inspectable at the term level.

import type { Cell } from '@/content/types';

export type ExternalKind = 'service' | 'table' | 'workers_ai';
export interface ExternalModelConfig { kind: ExternalKind; ref: string; timeoutMs: number; fallback: 'omit' }

/** The contract's input: what the engine knows when it scores. No visitor id crosses the boundary. */
export interface ExternalRequest {
  tenant: string;
  brand: string;
  page: string;
  slots: string[];
  cell: Cell;
  affinity: Readonly<Record<string, Readonly<Record<string, number>>>>;
  candidates: Array<{ id: string; tags: Readonly<Record<string, readonly string[]>> }>;
}
/** The contract's output: a version tag and a score in [0, 1] per candidate id. */
export interface ExternalResponse { version: string; scores: Record<string, number> }
export type ExternalResult = ({ ok: true; ms: number } & ExternalResponse) | { ok: false; reason: string; ms: number };

export const DEFAULT_TIMEOUT_MS = 20;
/** The `table` kind's KV key: one table per tenant and brand, `{ version, scores }` by item id. */
export const extTableKey = (tenant: string, brand: string) => `ext:${tenant}:${brand}`;

const TABLE_TTL_MS = 60_000;
const tableCache = new Map<string, { at: number; value: ExternalResponse | null }>();
export function invalidateExternalCache(): void { tableCache.clear(); }

/** The response shape, enforced: unknown fields dropped, scores clamped to [0, 1], anything else rejected. */
export function coerceResponse(raw: unknown): ExternalResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'string' || !r.scores || typeof r.scores !== 'object' || Array.isArray(r.scores)) return null;
  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.scores as Record<string, unknown>)) {
    const x = Number(v);
    if (Number.isFinite(x)) scores[k] = Math.min(1, Math.max(0, x));
  }
  return { version: r.version, scores };
}

export interface ExternalDeps {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  kv?: { get(key: string, type: 'json'): Promise<unknown> };
  ai?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  /** The worker's bindings, for `service` refs that name a service binding. */
  bindings?: Record<string, unknown>;
}

type Attempt = { ok: true; value: ExternalResponse } | { ok: false; reason: string };

async function attempt(cfg: ExternalModelConfig, req: ExternalRequest, now: number, deps: ExternalDeps): Promise<Attempt> {
  switch (cfg.kind) {
    case 'table': {
      const key = extTableKey(req.tenant, req.brand);
      const hit = tableCache.get(key);
      const value = hit && now - hit.at < TABLE_TTL_MS ? hit.value : coerceResponse(await deps.kv?.get(key, 'json'));
      if (!hit || now - hit.at >= TABLE_TTL_MS) tableCache.set(key, { at: now, value });
      return value ? { ok: true, value } : { ok: false, reason: `no table at ${key}, or not in the { version, scores } shape` };
    }
    case 'service': {
      const binding = deps.bindings?.[cfg.ref] as { fetch?: (url: string, init: RequestInit) => Promise<Response> } | undefined;
      const isUrl = /^https?:\/\//.test(cfg.ref);
      const call = binding && typeof binding.fetch === 'function'
        ? (u: string, i: RequestInit) => binding.fetch!(u, i)
        : isUrl && deps.fetch ? deps.fetch : null;
      if (!call) return { ok: false, reason: `no service binding named ${cfg.ref}` };
      const res = await call(isUrl ? cfg.ref : 'https://model/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
      if (!res.ok) return { ok: false, reason: `service responded ${res.status}` };
      const value = coerceResponse(await res.json());
      return value ? { ok: true, value } : { ok: false, reason: 'service response not in the { version, scores } shape' };
    }
    case 'workers_ai': {
      if (!deps.ai) return { ok: false, reason: 'no AI binding on this deployment' };
      const out = await deps.ai.run(cfg.ref, {
        prompt: `Score each candidate from 0 to 1 for this shopper. Reply with JSON only: {"version": string, "scores": {id: number}}.\n${JSON.stringify(req)}`,
      });
      const text = out && typeof out === 'object' && typeof (out as { response?: unknown }).response === 'string' ? (out as { response: string }).response : null;
      let parsed: unknown = out;
      if (text !== null) { try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { parsed = null; } }
      const value = coerceResponse(parsed);
      return value ? { ok: true, value } : { ok: false, reason: 'model output not in the { version, scores } shape' };
    }
    default:
      return { ok: false, reason: `unknown kind ${String((cfg as { kind: unknown }).kind)}` };
  }
}

/** The one call the decision service makes. Never throws; a miss is a result. */
export async function scoreExternal(cfg: ExternalModelConfig, req: ExternalRequest, now: number, deps: ExternalDeps): Promise<ExternalResult> {
  const budget = Math.max(1, Math.floor(cfg.timeoutMs || DEFAULT_TIMEOUT_MS));
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Attempt>((resolve) => { timer = setTimeout(() => resolve({ ok: false, reason: `timeout after ${budget}ms` }), budget); });
  const outcome = await Promise.race([attempt(cfg, req, now, deps).catch((e: unknown) => ({ ok: false as const, reason: `error: ${e instanceof Error ? e.message : String(e)}` })), timeout]);
  if (timer) clearTimeout(timer);
  const ms = Date.now() - t0;
  return outcome.ok ? { ok: true, ms, ...outcome.value } : { ok: false, ms, reason: outcome.reason };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * A reference implementation of the contract, for a data science team to copy:
 * a candidate scores the mean, over the dimensions the shopper has any interest
 * in, of the best interest value among the tags it carries in that dimension.
 * Transparent on purpose; it is an example of the shape, not a model.
 */
export function referenceScore(req: ExternalRequest): ExternalResponse {
  const dims = Object.entries(req.affinity).filter(([, values]) => Object.keys(values).length > 0);
  const scores: Record<string, number> = {};
  for (const c of req.candidates) {
    if (!dims.length) { scores[c.id] = 0; continue; }
    let sum = 0;
    for (const [dim, values] of dims) {
      let best = 0;
      for (const v of c.tags[dim] ?? []) best = Math.max(best, values[v] ?? 0);
      sum += Math.min(1, Math.max(0, best));
    }
    scores[c.id] = r3(sum / dims.length);
  }
  return { version: 'reference-1', scores };
}
