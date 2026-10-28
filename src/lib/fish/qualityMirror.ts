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
/** Actual price gain at the saved execution, independent of allocation and final ROI. */
export function mirrorFillGainPct(entry: number | undefined, fill?: QualityMirrorFill): number | null {
  return entry != null && Number.isFinite(entry) && entry > 0 && fill && Number.isFinite(fill.price) && fill.price > 0
    ? (fill.price / entry - 1) * 100 : null;
}
export function mirrorWeightedReturn(entry: number, mark: number, fill?: QualityMirrorFill): number {
  const fraction = fill?.fraction ?? 0;
  return ((fill ? fraction * (fill.price / entry - 1) : 0) + (1 - fraction) * (mark / entry - 1)) * 100;
}

/** Only mirror-enabled legacy close-confirmation trials need a new cache identity. */
export function mirrorExecutionIdentity(plan:{mirrorTakeProfit?:QualityMirrorTakeProfit;execution?:'intrabar-1m';holdingVetoes?:readonly {enabled:boolean}[];combo?:unknown}):unknown[] {
 return plan.mirrorTakeProfit?.enabled && plan.execution!=='intrabar-1m' && !plan.holdingVetoes?.some(v=>v.enabled) && !plan.combo ? ['mirror-preserve-close-v2'] : [];
}
export function mirrorPnlBreakdown(notional:number,entry:number,mark:number,fill?:QualityMirrorFill) {
 const fraction=fill?.fraction??0;
 const mirrorPnl=fill?notional*fraction*(fill.price/entry-1):0;
 const remainingPnl=notional*(1-fraction)*(mark/entry-1);
 const returnPct=fill?(mirrorPnl+remainingPnl)/notional*100:(mark/entry-1)*100;
 return {mirrorPnl,remainingPnl,totalPnl:fill?mirrorPnl+remainingPnl:notional*returnPct/100,returnPct};
}
