/** One conditional addition per paper position; disabled rules retain all legacy identities. */
import type { QualityBuyFilter } from './quality';
export interface QualityAdditionRule {
  enabled: boolean; source: 'detector' | 'custom'; stricterPct: number;
  amountMode: 'entry' | 'fixed'; amountUsdt: number; condition?: QualityBuyFilter;
}
export interface QualityAdditionFill {
  at: number; price: number; notional: number; quantity: number; scanFrom: number;
  reading: number; threshold: number; direction: '<' | '>'; metric: string; label: string;
  featureId?: string; definitionKey?: string; barOpenTime: number;
}
export const defaultQualityAddition = (): QualityAdditionRule => ({ enabled: false, source: 'detector', stricterPct: 10, amountMode: 'entry', amountUsdt: 100 });
export const additionIdentity = (rule?: QualityAdditionRule): unknown[] => !rule?.enabled ? [] : ['holding-add-once-v1',rule.source,
  rule.source === 'detector' ? rule.stricterPct : rule.condition && [rule.condition.metric,rule.condition.direction,rule.condition.threshold,rule.condition.snapshot.definitionKey,rule.condition.snapshot.interval],
  rule.amountMode,rule.amountMode === 'fixed' ? rule.amountUsdt : null];
export function validateQualityAddition(rule?: QualityAdditionRule): void {
  if (!rule?.enabled) return;
  if (!['detector','custom'].includes(rule.source) || !['entry','fixed'].includes(rule.amountMode)) throw new Error('加仓条件来源或金额方式无效');
  if (rule.amountMode === 'fixed' && (!(rule.amountUsdt > 0) || !Number.isFinite(rule.amountUsdt))) throw new Error('加仓金额须为大于 0 的有限数字');
  if (rule.source === 'detector' && (!(rule.stricterPct > 0) || !Number.isFinite(rule.stricterPct))) throw new Error('加仓门槛提高幅度须为大于 0 的有限数字');
  if (rule.source === 'custom' && (!rule.condition || !Number.isFinite(rule.condition.threshold) || !['<','>'].includes(rule.condition.direction))) throw new Error('请选择加仓指标并填写有限数字门槛');
}
export function stricterAdditionThreshold(threshold: number, direction: '<' | '>', pct: number): number {
  // Zero has no percentage scale: use one raw unit as its reference, and show this convention in the editor.
  const next = threshold + (direction === '>' ? 1 : -1) * (Math.abs(threshold) || 1) * pct / 100;
  if (!Number.isFinite(next) || !(direction === '>' ? next > threshold : next < threshold)) throw new Error('加仓门槛提高幅度超出有效精度或范围');
  return Number(next.toPrecision(15));
}
export const additionLabel = (rule?: QualityAdditionRule) => rule?.enabled ? `加仓一次：${rule.source === 'detector' ? `原探测门槛严格 ${rule.stricterPct}%` : `${rule.condition?.label} ${rule.condition?.direction} ${rule.condition?.threshold}`} · ${rule.amountMode === 'entry' ? '与开仓等额' : rule.amountUsdt + ' USDT'}` : '';
/** Mirror partial sales retain their original-coin sizing; 100% closes every coin then held. */
export function additionPosition(notional: number, entry: number, mark: number, closed: boolean, addition: QualityAdditionFill,
  mirror?: { at:number;price:number;fraction:number }) {
  const totalInvested = notional + addition.notional, totalQuantity = notional / entry + addition.quantity;
  const fullMirror = mirror?.fraction === 1;
  const mirrorQuantity = mirror ? fullMirror ? totalQuantity : notional / entry * mirror.fraction : 0;
  const mirrorCost = mirror ? fullMirror ? totalInvested : notional * mirror.fraction : 0;
  const mirrorPnl = mirror ? mirrorQuantity * mirror.price - mirrorCost : 0;
  const unsoldQuantity = totalQuantity - mirrorQuantity, unsoldCost = totalInvested - mirrorCost;
  const remainingPnl = unsoldQuantity * mark - unsoldCost, totalPnl = mirrorPnl + remainingPnl;
  const values = [totalInvested,totalQuantity,mirrorPnl,remainingPnl,totalPnl];
  if (!values.every(Number.isFinite) || !(totalInvested > 0) || !(addition.quantity > 0)) throw new Error('加仓金额或持仓数量超出可计算范围');
  return { totalInvested,totalQuantity,mirrorQuantity,mirrorCost,mirrorPnl,remainingPnl,totalPnl,
    returnPct: totalPnl / totalInvested * 100, averageEntryPrice: unsoldQuantity > 0 ? unsoldCost / unsoldQuantity : totalInvested / totalQuantity,
    remainingQuantity: closed ? 0 : unsoldQuantity, remainingCost: closed ? 0 : unsoldCost,
    realizedPnl: mirrorPnl + (closed ? remainingPnl : 0), exitQuantity: closed ? unsoldQuantity : 0 };
}
