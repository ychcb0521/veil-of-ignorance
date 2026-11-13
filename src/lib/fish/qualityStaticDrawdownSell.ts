import { definitionKey, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { FishSnapshot } from './algorithm';
import type { QualityExitRule } from './quality';

export const STATIC_DRAWDOWN_SELL_VERSION = 'sell-static-drawdown-v1' as const;
export const STATIC_DRAWDOWN_SELL_LABEL = '静态最大回撤止损';
export const STATIC_DRAWDOWN_SELL_METRIC = 'staticDrawdown';
export const STATIC_DRAWDOWN_SELL_CHOICE = STATIC_DRAWDOWN_SELL_VERSION + ':' + STATIC_DRAWDOWN_SELL_METRIC;
export type StaticDrawdownSellRule = {
  metric: typeof STATIC_DRAWDOWN_SELL_METRIC;
  direction: '>=';
  threshold: number;
  version: typeof STATIC_DRAWDOWN_SELL_VERSION;
};
export const isStaticDrawdownSell = (rule?: QualityExitRule): rule is StaticDrawdownSellRule =>
  rule?.version === STATIC_DRAWDOWN_SELL_VERSION;
export const isStaticDrawdownSellSnapshot = (snapshot: FishSnapshot) => snapshot.featureId === STATIC_DRAWDOWN_SELL_VERSION;

const priceSource: DeepDigFeatureDef = {
  id: STATIC_DRAWDOWN_SELL_VERSION, name: STATIC_DRAWDOWN_SELL_LABEL, short: STATIC_DRAWDOWN_SELL_LABEL,
  interval: '1m', formula: 'C', definition: '', scale: 1, unit: '%', positive: '1', control: '0',
};
export function staticDrawdownSellSnapshot(threshold: number): FishSnapshot {
  // Keep the minute price source in the snapshot. The position engine supplies the entry-relative reading.
  return { featureId: priceSource.id, featureName: priceSource.name, featureShort: priceSource.short,
    definitionKey: definitionKey(priceSource), interval: '1m', statistic: STATIC_DRAWDOWN_SELL_METRIC,
    threshold, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0, cutoffMs: 0, scale: 1, unit: '%' };
}

export function validateQualityExitRule(snapshot: FishSnapshot, rule?: QualityExitRule) {
  if (isStaticDrawdownSellSnapshot(snapshot) || isStaticDrawdownSell(rule)) {
    if (!isStaticDrawdownSell(rule) || !isStaticDrawdownSellSnapshot(snapshot)
      || rule.metric !== STATIC_DRAWDOWN_SELL_METRIC || rule.direction !== '>=' || snapshot.interval !== '1m'
      || !Number.isFinite(rule.threshold) || rule.threshold <= 0 || rule.threshold >= 100) {
      throw Error('静态最大回撤止损须填写大于 0、低于 100% 的阈值');
    }
  } else if (rule && (rule.version != null || !Number.isFinite(rule.threshold) || !['<', '>'].includes(rule.direction))) {
    throw Error('卖出门槛必须是有限数字');
  }
}

export const qualityExitThresholdText = (rule: QualityExitRule) =>
  isStaticDrawdownSell(rule) ? `≥ ${rule.threshold}%` : `${rule.direction} ${rule.threshold}`;
