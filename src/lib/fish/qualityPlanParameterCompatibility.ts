import type { QualityHoldingVeto } from './qualityVeto';
import { holdingVetoIdentity } from './qualityVeto';
import { shortFishHash } from './algorithm';
import type { QualityGroup } from './quality';
import { LOWER_WICK_VETO_VERSION, VETO_HISTORY_VERSION, isFiveMinuteShapeVeto } from './qualityAdditionVeto';
import { DOUBLE_DROP_VERSION } from './qualityDoubleDrop';

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

/** Historical raw-object hashes used editor insertion order, while JSONB orders
 * keys by length/bytes. Reproduce ONLY those encodings using the exact saved
 * fields/values. Never add defaults, drop unknown fields, reorder arrays, or
 * overwrite a manifest. An engine tag or actual parameter change still fails.
 */
export function compatibleAdditionParameterOrder(plan: QualityGroup, key: string, frozen: string): boolean {
  const rounds = plan.addition?.enabled ? [plan.addition, ...(plan.addition.rounds ?? []), ...(plan.addition.alternativeRounds ?? [])] : [];
  const vetoes = [...(plan.preEntryThreeStage?.additionVetoes ?? []), ...(plan.preEntryConditions?.entryVetoes ?? []), ...rounds.flatMap(r => r.entryVetoes ?? [])];
  let value: unknown, version: string;
  if (key === 'lower-wick-veto') {
    value = vetoes.filter(v => v.enabled && v.kind === 'lower-wick'); version = LOWER_WICK_VETO_VERSION;
  } else if (key === 'veto-history') {
    value = vetoes.filter(v => v.enabled && v.historyHours != null && !isFiveMinuteShapeVeto(v)); version = VETO_HISTORY_VERSION;
  } else if (key === 'addition-support-quality') {
    value = rounds.map(r => (r.entryVetoes ?? []).filter(v => v.enabled && v.kind === 'double-drop')).filter(r => r.length); version = DOUBLE_DROP_VERSION;
  } else return false;
  // parseAdditionVetoDraft / ADDITION_VETO_DEFAULTS field insertion order.
  const editorOrder = ['kind', 'enabled', 'historyHours', 'lookbackBars', 'atr', 'ratio', 'pct', 'er', 'windows', 'join', 'sticky'];
  const reorder = (raw: unknown, cloud: boolean): unknown => {
    if (Array.isArray(raw)) return raw.map(v => reorder(v, cloud));
    if (!raw || typeof raw !== 'object') return raw;
    const object = raw as Record<string, unknown>, keys = Object.keys(object);
    const known = 'kind' in object ? editorOrder : ['minutes', 'pct'];
    const order = cloud ? keys.sort((a,b) => a.length-b.length || (a<b?-1:a>b?1:0)) : [...known.filter(k => keys.includes(k)), ...keys.filter(k => !known.includes(k))];
    return Object.fromEntries(order.map(k => [k, reorder(object[k], cloud)]));
  };
  return [false, true].some(cloud => frozen === version + ' · 参数 #' + shortFishHash(JSON.stringify(reorder(value, cloud))));
}
