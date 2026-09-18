import type { Env } from '@/types/env';
import { readRevisionForMutation } from '@/config/versionedStore';
import { compiledDefaultFor, isDemoConfigScope, REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import type { ContentCatalog } from './types';
import { contentTypeValues } from './typeAffinity';

type Warning = { code: 'no_nonempty_registered_tags'; pieceIndex: number }
  | { code: 'unknown_dimension'; pieceIndex: number; dimensionIndex: number; dimension: string; dimensionTruncated: boolean };
export interface CatalogDiagnostics {
  schema: 'catalog-registry-diagnostics/v1';
  advisory: true;
  status: 'available' | 'unavailable';
  catalogRevision: number | null;
  registry: { scope: string | null; source: 'stored' | 'compiled-default' | 'unavailable'; revision: number | null; version: string | null };
  warningCount: number | null;
  omittedWarningCount: number | null;
  warnings: Warning[] | null;
}

/** Current, optional administration feedback; never publication or serving authority. */
export async function catalogDiagnostics(env: Env, tenant: string, catalog: ContentCatalog, catalogRevision: number | null): Promise<CatalogDiagnostics> {
  const unavailable: CatalogDiagnostics = { schema: 'catalog-registry-diagnostics/v1', advisory: true, status: 'unavailable', catalogRevision,
    registry: { scope: null, source: 'unavailable', revision: null, version: null }, warningCount: null, omittedWarningCount: null, warnings: null };
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
          dimension: dimension.slice(0, 64), dimensionTruncated: dimension.length > 64 });
        else if (values.some(value => value.trim().length > 0)) nonempty = true;
      });
      if (!nonempty && implicitType && !Object.prototype.hasOwnProperty.call(piece.tags, 'contentType') && contentTypeValues(piece)) nonempty = true;
      if (!nonempty) add({ code: 'no_nonempty_registered_tags', pieceIndex });
    });
    return { ...unavailable, status: 'available', registry: { scope, source: stored ? 'stored' : 'compiled-default', revision: stored?.revision ?? 0, version: config.version },
      warningCount, omittedWarningCount: warningCount - warnings.length, warnings };
  } catch { return unavailable; }
}
