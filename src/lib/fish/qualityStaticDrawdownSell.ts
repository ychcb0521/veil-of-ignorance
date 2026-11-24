import { definitionKey, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { FishSnapshot } from './algorithm';
import type { QualityExitRule, QualityGroup, QualityResult } from './quality';
import {isDbl5Sell, isDbl5SellLine, validateDbl5Sell} from './qualityDbl5Sell';
import { FREE_STATIC_DRAWDOWN_LABEL, LIMITED_PAYOFF_RISK_VERSION, PAYOFF_STOP_KIND, isLimitedStaticDrawdownVeto, payoffStopL0Pct } from './qualityVeto';

export const STATIC_DRAWDOWN_SELL_VERSION = 'sell-static-drawdown-v1' as const;
export const ORIGINAL_STATIC_DRAWDOWN_SELL_LABEL = '静态最大回撤止损';
export const STATIC_DRAWDOWN_SELL_LABEL = '限制静态最大回撤';
export const PRE_MIRROR_STATIC_SELL_VERSION = 'sell-static-drawdown-pre-mirror-v3' as const;
export const DEFAULT_STATIC_DRAWDOWN_SELL_PCT = 3;
export const STATIC_DRAWDOWN_SELL_METRIC = 'staticDrawdown';
export const STATIC_DRAWDOWN_SELL_CHOICE = STATIC_DRAWDOWN_SELL_VERSION + ':' + STATIC_DRAWDOWN_SELL_METRIC;
export const TIMED_STATIC_DRAWDOWN_VERSION = 'sell-static-drawdown-timed-v2' as const;
export const DRAWDOWN_BAND_STARTS = [0, 5, 15, 30, 60] as const;
export const DRAWDOWN_BAND_LABELS = ['0–5', '5–15', '15–30', '30–60', '60 及以后'] as const;
export function staticDrawdownThresholdAt(rule: StaticDrawdownSellRule, elapsedMinutes: number) {
  if (!rule.bandThresholds) return rule.threshold;
  const nextBand = DRAWDOWN_BAND_STARTS.findIndex(start => elapsedMinutes < start);
  const index = nextBand < 0 ? DRAWDOWN_BAND_STARTS.length - 1 : Math.max(0, nextBand - 1);
  return rule.bandThresholds[index];
}
export type StaticDrawdownSellRule = {
  metric: typeof STATIC_DRAWDOWN_SELL_METRIC;
  direction: '>=';
  threshold: number;
  version: typeof STATIC_DRAWDOWN_SELL_VERSION | typeof TIMED_STATIC_DRAWDOWN_VERSION;
  bandThresholds?: number[];
  mirrorScopeVersion?: typeof PRE_MIRROR_STATIC_SELL_VERSION;
};
export const isStaticDrawdownSell = (rule?: QualityExitRule): rule is StaticDrawdownSellRule =>
  rule?.version === STATIC_DRAWDOWN_SELL_VERSION || rule?.version === TIMED_STATIC_DRAWDOWN_VERSION;
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
  if (isDbl5SellLine(snapshot.featureId) || isDbl5Sell(rule)) { validateDbl5Sell(snapshot, rule); return; }
  if (isStaticDrawdownSellSnapshot(snapshot) || isStaticDrawdownSell(rule)) {
    if (!isStaticDrawdownSell(rule) || !isStaticDrawdownSellSnapshot(snapshot)
      || rule.metric !== STATIC_DRAWDOWN_SELL_METRIC || rule.direction !== '>=' || snapshot.interval !== '1m'
      || !Number.isFinite(rule.threshold) || rule.threshold <= 0 || rule.threshold >= 100) {
      throw Error(`${STATIC_DRAWDOWN_SELL_LABEL}须填写大于 0、低于 100% 的阈值`);
    }
    if (rule.mirrorScopeVersion != null && rule.mirrorScopeVersion !== PRE_MIRROR_STATIC_SELL_VERSION) {
      throw Error('未知的镜像前限制回撤版本');
    }
    if (rule.version === TIMED_STATIC_DRAWDOWN_VERSION
      ? !Array.isArray(rule.bandThresholds) || rule.bandThresholds.length !== 5 ||
        Array.from(rule.bandThresholds).some(value => !Number.isFinite(value) || value <= 0 || value >= 100) ||
        rule.threshold !== rule.bandThresholds[0]
      : rule.bandThresholds !== undefined) {
      throw Error('分时回撤需要五个大于 0、低于 100% 的门槛');
    }
  } else if (rule && (rule.version != null || !Number.isFinite(rule.threshold) || !['<', '>'].includes(rule.direction))) {
    throw Error('卖出门槛必须是有限数字');
  }
}

export const qualityExitThresholdText = (rule: QualityExitRule) =>
  isDbl5Sell(rule) ? `冗余 ${rule.threshold} ATR` : isStaticDrawdownSell(rule) ? rule.bandThresholds ? rule.bandThresholds.map((value, i) => `${DRAWDOWN_BAND_LABELS[i]} 分钟 ≥ ${value}%`).join(' / ') : `≥ ${rule.threshold}%` : `${rule.direction} ${rule.threshold}`;

export const qualityExitAlgorithmLabel = (rule: QualityExitRule | undefined, label: string) =>
  isStaticDrawdownSell(rule) && label === ORIGINAL_STATIC_DRAWDOWN_SELL_LABEL ? STATIC_DRAWDOWN_SELL_LABEL : label;

export function qualityStaticDrawdownReason(result?: Pick<QualityResult, 'exitSnapshot' | 'reason'>) {
  const cause = result?.exitSnapshot?.cause;
  if (cause?.kind === 'sell-static-drawdown') return result?.reason?.replace(ORIGINAL_STATIC_DRAWDOWN_SELL_LABEL, STATIC_DRAWDOWN_SELL_LABEL);
  if (cause?.kind === 'static-drawdown' && cause.label) return isLimitedStaticDrawdownVeto(cause)?result?.reason:result?.reason?.replace(cause.label, FREE_STATIC_DRAWDOWN_LABEL);
  return result?.reason;
}

/** Reporting only: keep the risk unit fixed across all five holding-time bands. */
export function timedDrawdownPayoffPct(plan: Pick<QualityGroup, 'rule' | 'combo' | 'router'>) {
  const initial = plan.router?.structure ?? plan;
  const rule = initial.rule?.version === TIMED_STATIC_DRAWDOWN_VERSION ? initial.rule
    : initial.combo?.after.rule.version === TIMED_STATIC_DRAWDOWN_VERSION ? initial.combo.after.rule : undefined;
  const bands = rule?.bandThresholds;
  return bands?.length === DRAWDOWN_BAND_STARTS.length && bands.every(value => Number.isFinite(value) && value > 0 && value < 100)
    ? Math.max(...bands) : undefined;
}

function limitedDrawdownPct(rule?: QualityExitRule) {
  return isStaticDrawdownSell(rule) && Number.isFinite(rule.threshold) && rule.threshold > 0 && rule.threshold < 100
    ? rule.threshold : undefined;
}

type LimitedDrawdownPlan = Pick<QualityGroup, 'rule' | 'combo' | 'router' | 'holdingVetoes' | 'vetoStages'>;

export function initialLimitedDrawdownPct(plan: LimitedDrawdownPlan){
  const initial=plan.router?.structure??plan,ordinary=limitedDrawdownPct(initial.rule);
  const hard=(initial.holdingVetoes??[]).filter(v=>v.enabled&&isLimitedStaticDrawdownVeto(v)&&v.mirrorStage?.stage!=='after'&&Number.isFinite(v.threshold)&&v.threshold>0&&v.threshold<100).map(v=>v.threshold);
  return hard.length?Math.min(...hard,...(ordinary!=null?[ordinary]:[])):ordinary;
}
export function initialPayoffRiskThreshold(plan:LimitedDrawdownPlan){
  const initial=plan.router?.structure??plan,limited=initialLimitedDrawdownPct(initial);
  if(limited!=null)return limited;
  const marked=[...(initial.holdingVetoes??[]),...(initial.vetoStages??[]).flatMap(s=>s.conditions)].some(v=>v.enabled&&isLimitedStaticDrawdownVeto(v));
  // Unmarked saved plans retain their original per-phase fallback, even if they carry an old payoff tag.
  return marked?payoffStopL0Pct(initial.holdingVetoes):undefined;
}

export function withLimitedPayoffRisk(plan: QualityGroup): QualityGroup {
  const hasPayoff = (plan.holdingVetoes ?? []).some(v => v.enabled && v.kind === PAYOFF_STOP_KIND)
    || plan.vetoStages?.some(stage => stage.conditions.some(v => v.enabled && v.kind === PAYOFF_STOP_KIND));
  const marked=[...(plan.holdingVetoes??[]),...(plan.vetoStages??[]).flatMap(s=>s.conditions)].some(v=>v.enabled&&isLimitedStaticDrawdownVeto(v));
  const initialRisk=initialLimitedDrawdownPct(plan)??(marked?payoffStopL0Pct(plan.holdingVetoes):undefined);
  const version = plan.addition?.enabled && initialRisk != null && hasPayoff ? LIMITED_PAYOFF_RISK_VERSION : undefined;
  if (version === plan.payoffRiskVersion) return plan;
  const { payoffRiskVersion: _, ...base } = plan;
  return version ? { ...base, payoffRiskVersion: version } : base;
}

export function qualityLimitedDrawdownText(plan: LimitedDrawdownPlan, entryPrice?: number) {
  const initial = plan.router?.structure ?? plan;
  const before = initialLimitedDrawdownPct(initial);
  const format = (pct?: number) => pct == null ? '—' : entryPrice != null && entryPrice > 0 && Number.isFinite(entryPrice)
    ? `${pct}% @ ${+(entryPrice * (1 - pct / 100)).toPrecision(10)}` : `${pct}%`;
  if (!initial.combo) return format(before);
  const after = limitedDrawdownPct(initial.combo.after.rule);
  if (before == null && after == null) return '—';
  return `前段 ${format(before)} / 后段 ${format(after)}`;
}
