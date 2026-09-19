import type { Env } from '@/types/env';
import { readRevisionForMutation } from '@/config/versionedStore';
import { compiledDefaultFor, isDemoConfigScope, REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import type { ContentCatalog } from './types';
import { contentTypeValues } from './typeAffinity';
import { ignoredFieldsOf } from './import';
import { DEFAULT_SLOTS, SLOTS_KIND } from './kinds';

type Warning = { code: 'no_nonempty_registered_tags'; pieceIndex: number }
  | { code: 'unknown_dimension'; pieceIndex: number; dimensionIndex: number; dimension: string; dimensionTruncated: boolean }
  | { code: 'case_variant_value'; pieceIndex: number; dimensionIndex: number; dimension: string; dimensionTruncated: boolean; values: string[]; valuesTruncated: boolean }
  | { code: 'ignored_field'; pieceIndex: number; field: string; fieldTruncated: boolean }
  // A slot type no page of the tenant's own slots document defines. Advisory:
  // the piece is stored whole and refused by nothing; it is simply eligible for
  // no slot this tenant publishes, so nothing will ever serve it.
  | { code: 'unknown_slot_type'; pieceIndex: number; slotType: string; slotTypeTruncated?: true };
export interface CatalogDiagnostics {
  schema: 'catalog-registry-diagnostics/v1';
  advisory: true;
  status: 'available' | 'unavailable';
  catalogRevision: number | null;
  registry: { scope: string | null; source: 'stored' | 'compiled-default' | 'unavailable'; revision: number | null; version: string | null };
  /**
   * Which slot-type vocabulary the channel compared the stored pieces against:
   * the tenant's own published slots document, else the compiled fallback the
   * engine would decide from, else `unavailable` when the publication cannot be
   * read — in which case no `unknown_slot_type` warning is raised, because an
   * outage must never invent one. Three keys, and no `scope`: the registry
   * carries one because a registry may live at a demo config scope, while the
   * slots document is always the catalogue tenant's own.
   */
  slots: { source: 'stored' | 'compiled-default' | 'unavailable'; revision: number | null; version: string | null };
  warningCount: number | null;
  omittedWarningCount: number | null;
  warnings: Warning[] | null;
}

/**
 * The records one write carried, so the same channel can also name what the
 * request lost. Every other warning is a pure function of the stored catalogue
 * and the tenant's published registry and is recomputed on a read; an
 * `ignored_field` exists only for the request that carried it, so a read never
 * carries one and no caller passes this on a read.
 */
export interface DiagnosedRequest {
  /** The submitted records, in the order the request listed them; `pieceIndex` is that position. */
  records: readonly unknown[];
  /** The field spellings THIS path accepts: the feed adapter's aliases, or the validator's own closed set for a direct publication. */
  accepted: ReadonlySet<string>;
}

const BOUND = 64, VALUES_BOUND = 20;

/**
 * The slot-type vocabulary this tenant's engine decides from, and which
 * document it came from. Contained on its own so that a slots outage costs the
 * channel only its slot-type advice: `defined` is null then, and no
 * `unknown_slot_type` warning is raised about a document nobody could read.
 */
async function definedSlotTypes(env: Env, tenant: string): Promise<{ slots: CatalogDiagnostics['slots']; defined: ReadonlySet<string> | null }> {
  try {
    const stored = await readRevisionForMutation(env, SLOTS_KIND, tenant);
    // The same fallback the read and decision paths use when a tenant has
    // published no slots document of its own (routes/content.ts, `k.fallback`).
    const document = stored ? stored.value : DEFAULT_SLOTS;
    const defined = new Set<string>();
    for (const page of Object.values(document.pages)) for (const slot of page) defined.add(slot.slot);
    return { slots: { source: stored ? 'stored' : 'compiled-default', revision: stored?.revision ?? 0, version: document.version ?? null }, defined };
  } catch { return { slots: { source: 'unavailable', revision: null, version: null }, defined: null }; }
}

/** Current, optional administration feedback; never publication or serving authority. */
export async function catalogDiagnostics(env: Env, tenant: string, catalog: ContentCatalog, catalogRevision: number | null,
  request?: DiagnosedRequest): Promise<CatalogDiagnostics> {
  const unavailable: CatalogDiagnostics = { schema: 'catalog-registry-diagnostics/v1', advisory: true, status: 'unavailable', catalogRevision,
    registry: { scope: null, source: 'unavailable', revision: null, version: null },
    slots: { source: 'unavailable', revision: null, version: null }, warningCount: null, omittedWarningCount: null, warnings: null };
  // The tenant's own slot-type vocabulary, read in its own container: an
  // unreadable slots document names itself `unavailable` and raises no warning,
  // and it never turns the registry's own answer into an outage.
  const vocabulary = await definedSlotTypes(env, tenant);
  unavailable.slots = vocabulary.slots;
  // Contain the whole optional read/scan, including demo read failures. A receipt
  // already committed by the caller must not become an apparent failed write.
  try {
    const scope = reflexScopeForTenant(tenant); unavailable.registry.scope = scope;
    const stored = await readRevisionForMutation(env, REFLEX_KIND, scope);
    if (!stored && !isDemoConfigScope(scope)) return unavailable;
    const config = stored ? stored.value : await compiledDefaultFor(scope);
    const registered = new Set(config.dimensions.map(dimension => dimension.key));
    const implicitType = config.dimensions.some(dimension => dimension.key === 'contentType' && !dimension.derive);
    const warnings: Warning[] = []; let warningCount = 0;
    const add = (warning: Warning) => { warningCount++; if (warnings.length < 50) warnings.push(warning); };
    catalog.pieces.forEach((piece, pieceIndex) => {
      let nonempty = false;
      Object.entries(piece.tags).forEach(([dimension, values], dimensionIndex) => {
        if (!registered.has(dimension)) add({ code: 'unknown_dimension', pieceIndex, dimensionIndex,
          dimension: dimension.slice(0, BOUND), dimensionTruncated: dimension.length > BOUND });
        else if (values.some(value => value.trim().length > 0)) nonempty = true;
        // Two spellings of one value that differ only by case are two values to
        // every scorer, so one of them is dead taxonomy the feed cannot see.
        // Named, never rewritten: which spelling is the right one is the
        // content team's decision, not this engine's.
        const variants = new Map<string, Set<string>>();
        for (const value of values) {
          const key = value.toLowerCase();
          let spellings = variants.get(key); if (!spellings) { spellings = new Set(); variants.set(key, spellings); }
          spellings.add(value);
        }
        for (const spellings of variants.values()) {
          if (spellings.size < 2) continue;
          const sorted = [...spellings].sort();
          add({ code: 'case_variant_value', pieceIndex, dimensionIndex, dimension: dimension.slice(0, BOUND), dimensionTruncated: dimension.length > BOUND,
            values: sorted.slice(0, VALUES_BOUND).map(value => value.slice(0, BOUND)),
            valuesTruncated: sorted.length > VALUES_BOUND || sorted.some(value => value.length > BOUND) });
        }
      });
      if (!nonempty && implicitType && !Object.prototype.hasOwnProperty.call(piece.tags, 'contentType') && contentTypeValues(piece)) nonempty = true;
      if (!nonempty) add({ code: 'no_nonempty_registered_tags', pieceIndex });
      // A slot type no page of the tenant's slots document defines. The piece is
      // still stored whole and refused by nothing — it is simply eligible for no
      // slot this tenant publishes, which is advice, not a refusal.
      if (vocabulary.defined) for (const slotType of piece.slotTypes) {
        if (vocabulary.defined.has(slotType)) continue;
        add({ code: 'unknown_slot_type', pieceIndex, slotType: slotType.slice(0, BOUND),
          ...(slotType.length > BOUND ? { slotTypeTruncated: true as const } : {}) });
      }
    });
    // What the request carried and no stored piece can hold. Appended after the
    // catalogue's own warnings so the bounded list keeps the same shape it had.
    request?.records.forEach((raw, pieceIndex) => {
      for (const field of ignoredFieldsOf(raw, request.accepted)) {
        add({ code: 'ignored_field', pieceIndex, field: field.slice(0, BOUND), fieldTruncated: field.length > BOUND });
      }
    });
    return { ...unavailable, status: 'available', registry: { scope, source: stored ? 'stored' : 'compiled-default', revision: stored?.revision ?? 0, version: config.version },
      warningCount, omittedWarningCount: warningCount - warnings.length, warnings };
  } catch { return unavailable; }
}
