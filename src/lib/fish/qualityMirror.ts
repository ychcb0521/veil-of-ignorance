/** One limit take-profit per paper position, measured from its original entry. */
export interface QualityMirrorTakeProfit { enabled: boolean; gainPct: number; sellPct: number }
export interface QualityMirrorFill { at: number; price: number; fraction: number; gainPct: number; atOpen: boolean }
export const defaultQualityMirror = (): QualityMirrorTakeProfit => ({ enabled: true, gainPct: 5, sellPct: 50 });
export const mirrorIdentity = (rule?: QualityMirrorTakeProfit): unknown[] => rule?.enabled ? ['mirror-limit-v1', rule.gainPct, rule.sellPct] : [];
export function validateQualityMirror(rule?: QualityMirrorTakeProfit): void {
  if (!rule?.enabled) return;
  if (!Number.isFinite(rule.gainPct) || rule.gainPct <= 0) throw new Error('镜像止盈的涨幅须为大于 0 的有限数字');
  if (!Number.isFinite(rule.sellPct) || rule.sellPct <= 0 || rule.sellPct > 100) throw new Error('镜像止盈的卖出比例须大于 0 且不超过 100%');
}
export const mirrorLabel = (rule?: QualityMirrorTakeProfit) => rule?.enabled ? `镜像止盈：涨幅 ≥ ${rule.gainPct}% 卖出初始币数 ${rule.sellPct}%` : '';
export function mirrorWeightedReturn(entry: number, mark: number, fill?: QualityMirrorFill): number {
  const fraction = fill?.fraction ?? 0;
  return ((fill ? fraction * (fill.price / entry - 1) : 0) + (1 - fraction) * (mark / entry - 1)) * 100;
}
