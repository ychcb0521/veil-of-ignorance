import { definitionKey, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { FishSnapshot } from './algorithm';
import type { QualityExitRule, QualityGroup, QualityResult } from './quality';
import { FREE_STATIC_DRAWDOWN_LABEL, LIMITED_PAYOFF_RISK_VERSION, PAYOFF_STOP_KIND } from './qualityVeto';

export const STATIC_DRAWDOWN_SELL_VERSION = 'sell-static-drawdown-v1' as const;
export const ORIGINAL_STATIC_DRAWDOWN_SELL_LABEL = '静态最大回撤止损';
export const STATIC_DRAWDOWN_SELL_LABEL = '限制静态最大回撤';
export const DEFAULT_STATIC_DRAWDOWN_SELL_PCT = 3;
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
  id: STATIC_DRAWDOWN_SELL_VERSION, name: ORIGINAL_STATIC_DRAWDOWN_SELL_LABEL, short: ORIGINAL_STATIC_DRAWDOWN_SELL_LABEL,
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
      throw Error(`${STATIC_DRAWDOWN_SELL_LABEL}须填写大于 0、低于 100% 的阈值`);
    }
  } else if (rule && (rule.version != null || !Number.isFinite(rule.threshold) || !['<', '>'].includes(rule.direction))) {
    throw Error('卖出门槛必须是有限数字');
  }
}

export const qualityExitThresholdText = (rule: QualityExitRule) =>
  isStaticDrawdownSell(rule) ? `≥ ${rule.threshold}%` : `${rule.direction} ${rule.threshold}`;

export const qualityExitAlgorithmLabel = (rule: QualityExitRule | undefined, label: string) =>
  isStaticDrawdownSell(rule) && label === ORIGINAL_STATIC_DRAWDOWN_SELL_LABEL ? STATIC_DRAWDOWN_SELL_LABEL : label;

export function qualityStaticDrawdownReason(result?: Pick<QualityResult, 'exitSnapshot' | 'reason'>) {
  const cause = result?.exitSnapshot?.cause;
  if (cause?.kind === 'sell-static-drawdown') return result?.reason?.replace(ORIGINAL_STATIC_DRAWDOWN_SELL_LABEL, STATIC_DRAWDOWN_SELL_LABEL);
  if (cause?.kind === 'static-drawdown' && cause.label) return result?.reason?.replace(cause.label, FREE_STATIC_DRAWDOWN_LABEL);
  return result?.reason;
}

function limitedDrawdownPct(rule?: QualityExitRule) {
  return isStaticDrawdownSell(rule) && Number.isFinite(rule.threshold) && rule.threshold > 0 && rule.threshold < 100
    ? rule.threshold : undefined;
}

type LimitedDrawdownPlan = Pick<QualityGroup, 'rule' | 'combo' | 'router'>;

export const initialLimitedDrawdownPct = (plan: LimitedDrawdownPlan) =>
  limitedDrawdownPct((plan.router?.structure ?? plan).rule);

export function withLimitedPayoffRisk(plan: QualityGroup): QualityGroup {
  const hasPayoff = (plan.holdingVetoes ?? []).some(v => v.enabled && v.kind === PAYOFF_STOP_KIND)
    || plan.vetoStages?.some(stage => stage.conditions.some(v => v.enabled && v.kind === PAYOFF_STOP_KIND));
  const version = plan.addition?.enabled && initialLimitedDrawdownPct(plan) != null && hasPayoff ? LIMITED_PAYOFF_RISK_VERSION : undefined;
  if (version === plan.payoffRiskVersion) return plan;
  const { payoffRiskVersion: _, ...base } = plan;
  return version ? { ...base, payoffRiskVersion: version } : base;
}

export function qualityLimitedDrawdownText(plan: LimitedDrawdownPlan) {
  const initial = plan.router?.structure ?? plan;
  const before = initialLimitedDrawdownPct(initial);
  if (!initial.combo) return before == null ? '—' : `${before}%`;
  const after = limitedDrawdownPct(initial.combo.after.rule);
  if (before == null && after == null) return '—';
  return `前段 ${before == null ? '—' : before + '%'} / 后段 ${after == null ? '—' : after + '%'}`;
}
