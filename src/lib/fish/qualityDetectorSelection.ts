import { FISH_DEFAULT_RULES } from './defaultRules';
import type { QualityGroup } from './quality';
import { fishMetricLabel } from './records';

/**
 * 【用户要求】2026-10-28「持仓监测这里的探测算法下拉菜单，绝大多数都是无用的干扰项。我只需要捕捞和批量挖掘中现在的默认算法和数值，
 * 以后默认中如果有新增，就在这里增加，除此之外，其他多余的都删除」：
 * 下拉只列默认规则（捕捞与批量挖掘共用的 FISH_DEFAULT_RULES），顺序同捕捞的算法卡；默认里新增一条，这里自动多一项。
 * 同一条默认规则在历史数据里可能因公式版本不同存成几组（名字、门槛都一样），下拉里合成一项，勾它就勾上全部这些组。
 */
const DEFAULT_DETECTORS = FISH_DEFAULT_RULES.map(rule => ({ key: rule.id, featureId: rule.featureId, series: rule.statistic, threshold: Number(rule.threshold) }));

export interface QualityDetectorChoice {
  key: string;
  /** 例如「CBI-2·avg₂」。 */
  label: string;
  direction: '>';
  threshold: number;
  /** 数据里属于这条默认规则的探测组。 */
  ids: string[];
}

function defaultIndex(group: QualityGroup): number {
  const snapshot = group.snapshot;
  if ((snapshot.direction ?? '>') !== '>' || snapshot.constraints?.length) return -1;
  const metric = fishMetricLabel(snapshot), featureId = snapshot.featureId ?? snapshot.algorithmKey?.split('|')[0];
  return DEFAULT_DETECTORS.findIndex(rule => (!featureId || featureId === rule.featureId) && metric === rule.series && snapshot.threshold === rule.threshold);
}

/** 只含数据里出现过的默认规则；没有探测组的默认规则不列（不编造空项）。 */
export function qualityDetectorChoices(groups: readonly QualityGroup[]): QualityDetectorChoice[] {
  return DEFAULT_DETECTORS.flatMap((rule, index) => {
    const matched = groups.filter(group => defaultIndex(group) === index);
    return matched.length ? [{ key: rule.key, label: matched[0].label, direction: '>' as const, threshold: rule.threshold, ids: matched.map(group => group.id) }] : [];
  });
}

/** 打开时默认勾上全部默认规则（按默认顺序）。 */
export function defaultQualityDetectorIds(groups: readonly QualityGroup[]): string[] {
  return qualityDetectorChoices(groups).flatMap(choice => choice.ids);
}
