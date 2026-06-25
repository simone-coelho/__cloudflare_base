// src/connectors/evaluateCondition.ts
// Pure ODP-style condition-tree evaluator. Extracted/generalized from
// OptimizelyService.evaluateConditions so both the mock SegmentProvider and a
// future live path share identical semantics. No I/O, fully deterministic.

import type { AudienceCondition, AudiencePredicate } from './types';

/**
 * Evaluate an ODP-style audience condition tree against a flat attribute map.
 * Logical nodes are arrays (['and'|'or'|'not', ...]); leaves are predicate objects.
 */
export function evaluateCondition(
  cond: AudienceCondition,
  attributes: Record<string, any>
): boolean {
  if (Array.isArray(cond)) {
    const [op, ...rest] = cond as [string, ...AudienceCondition[]];
    switch (op) {
      case 'and':
        return rest.every((c) => evaluateCondition(c, attributes));
      case 'or':
        return rest.some((c) => evaluateCondition(c, attributes));
      case 'not':
        return rest.length > 0 ? !evaluateCondition(rest[0], attributes) : false;
      default:
        return false;
    }
  }
  return evaluatePredicate(cond, attributes);
}

function evaluatePredicate(pred: AudiencePredicate, attributes: Record<string, any>): boolean {
  const actual = attributes[pred.attribute];
  const { operator, value } = pred;

  switch (operator) {
    case 'eq':
      return actual === value;
    case 'neq':
      return actual !== value;
    case 'gte':
      return typeof actual === 'number' && actual >= (value as number);
    case 'lte':
      return typeof actual === 'number' && actual <= (value as number);
    case 'gt':
      return typeof actual === 'number' && actual > (value as number);
    case 'lt':
      return typeof actual === 'number' && actual < (value as number);
    case 'contains':
      if (typeof actual === 'string') return actual.includes(String(value));
      if (Array.isArray(actual)) return actual.includes(value as never);
      return false;
    case 'in':
      return Array.isArray(value) && (value as Array<string | number>).includes(actual);
    case 'not_in':
      return Array.isArray(value) && !(value as Array<string | number>).includes(actual);
    default:
      return false;
  }
}
