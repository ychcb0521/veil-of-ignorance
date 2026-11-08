import type { QualityHoldingVeto } from './qualityVeto';
import { holdingVetoIdentity } from './qualityVeto';
import { shortFishHash } from './algorithm';

/**
 * DBL-5 guard settings were serialized in insertion order when frozen. JSONB
 * returns the same values with range_atr before trend_atr. Both historical
 * encodings must remain readable; never rewrite a saved manifest to accept it.
 * Only object key order changes here. No values, defaults or engine tags change.
 */
export function compatibleHoldingParameterOrder(vetoes: readonly QualityHoldingVeto[] | undefined, frozen: string): boolean {
  const orders = [
    ['guard_trend_atr', 'guard_range_atr', 'guard_range_closes'],
    ['guard_range_atr', 'guard_trend_atr', 'guard_range_closes'],
  ];
  return orders.some(order => {
    let reordered = false;
    const candidate = (vetoes ?? []).map(v => {
      if (!v.enabled || v.kind !== 'box-stop' || v.boxStop?.structure.algorithm !== 'dbl5') return v;
      const rule = v.boxStop, structure = rule.structure, definition = structure.definition, config = definition.DBL5_config;
      if (!config || !order.some(key => Object.prototype.hasOwnProperty.call(config, key))) return v;
      reordered = true;
      const ordered = Object.fromEntries([
        ...Object.entries(config).filter(([key]) => !order.includes(key)),
        ...order.filter(key => Object.prototype.hasOwnProperty.call(config, key)).map(key => [key, config[key]]),
      ]);
      return { ...v, boxStop: { ...rule, structure: { ...structure, definition: { ...definition, DBL5_config: ordered } } } };
    });
    return reordered && frozen === '参数 #' + shortFishHash(JSON.stringify(holdingVetoIdentity(candidate)));
  });
}
