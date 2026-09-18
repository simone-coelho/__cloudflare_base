import { z } from 'zod';
import type { Env } from '@/types/env';
import type { ReflexConfig } from './core';
import type { SearchConfiguration } from '@/connectors/config';
import { admitModel, ConnectorUnavailable, invokeModel, type ConnectorDeadline } from '@/connectors/model';

const filter = z.object({ dimension: z.string().min(1).max(96), values: z.array(z.string().min(1).max(128)).min(1).max(32) }).strict();
export const searchIntentSchema = z.object({ supported: z.boolean(), filters: z.array(filter).max(32), exclusions: z.array(filter).max(32),
  price: z.object({ currency: z.string().regex(/^[A-Z]{3}$/), minMinor: z.number().int().safe().nonnegative().nullable(),
    maxMinor: z.number().int().safe().nonnegative().nullable() }).strict().nullable(),
  gift: z.enum(['any', 'required', 'exclude']), unsupported: z.array(z.string().min(1).max(200)).max(8),
}).strict();
export type SearchIntent = z.infer<typeof searchIntentSchema>;
export function validateSearchIntent(value: unknown, config: SearchConfiguration, registry: ReflexConfig): SearchIntent {
  const result = searchIntentSchema.safeParse(value);
  if (!result.success) throw new ConnectorUnavailable('schema');
  const intent = result.data, dimensions = new Map(registry.dimensions.map(d => [d.key, d]));
  const allowed = new Map(config.taxonomy.map(t => [t.dimension, new Set(t.values.map(v => v.value))]));
  for (const filters of [intent.filters, intent.exclusions]) {
    const seen = new Set<string>();
    for (const item of filters) {
      if (!dimensions.has(item.dimension) || seen.has(item.dimension) || new Set(item.values).size !== item.values.length
        || item.values.some(v => !allowed.get(item.dimension)?.has(v))) throw new ConnectorUnavailable('schema');
      seen.add(item.dimension);
    }
  }
  if (intent.price && (intent.price.currency !== config.currency || (intent.price.minMinor !== null && intent.price.maxMinor !== null
    && intent.price.minMinor > intent.price.maxMinor))) throw new ConnectorUnavailable('schema');
  if (intent.supported === (intent.unsupported.length > 0)) throw new ConnectorUnavailable('schema');
  return intent;
}
export async function interpretSearch(env: Env, tenant: string, query: string, registry: ReflexConfig, deadline: ConnectorDeadline, authorize: () => Promise<void>) {
  const admission = await admitModel(env, tenant, 'search'), config = admission.config as SearchConfiguration;
  if (config.taxonomy.some(t => !registry.dimensions.some(d => d.key === t.dimension))) throw new ConnectorUnavailable('schema');
  const generated = await invokeModel(env, tenant, 'search', admission, searchIntentSchema,
    { task: 'Interpret the explicit query only. Return unsupported for constraints not representable without guessing. Never select products. AND between dimensions, OR within one dimension. Exclusions must stay exclusions. Monetary bounds are inclusive integer minor units.',
      query, taxonomy: config.taxonomy, currency: config.currency, priceMinorUnits: config.priceMinorUnits, giftMeaning: config.giftMeaning }, deadline, [], authorize);
  return { intent: validateSearchIntent(generated.value, config, registry), witness: generated.witness };
}
