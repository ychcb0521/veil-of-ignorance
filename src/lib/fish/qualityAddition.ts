/** Conditional paper additions; disabled and legacy rules retain their frozen identities. */
import type { QualityBuyFilter } from './quality';
export interface QualityAdditionRule {
  enabled: boolean; source: 'detector' | 'custom'; stricterPct: number;
  quantityMode?: 'calculator' | 'entry' | 'fixed'; quantity?: number;
  repeat?:boolean;
  /** Frozen legacy rules retain their original cash sizing. New saves use quantityMode. */
  amountMode?: 'entry' | 'fixed'; amountUsdt?: number; condition?: QualityBuyFilter;
}
export interface QualityAdditionFill {
  at: number; price: number; notional: number; quantity: number; scanFrom: number;
  reading: number; threshold: number; direction: '<' | '>'; metric: string; label: string;
  featureId?: string; definitionKey?: string; barOpenTime: number;
  sizing?: {support:number;previousSupport:number;atr:number;atrAt:number;coinsBefore:number;realAverageBefore:number;baseCoins:number;mirrorCoins:number;mirrorUsed:number};
}
export const defaultQualityAddition = (): QualityAdditionRule => ({ enabled: false, source: 'detector', stricterPct: 10, quantityMode: 'calculator', quantity: 1, repeat:true });
export const additionIdentity = (rule?: QualityAdditionRule): unknown[] => !rule?.enabled ? [] : [rule.quantityMode==='calculator'?'holding-add-atr14ema5m-1.5-support-stop-v1':rule.quantityMode?'holding-add-once-quantity-v1':'holding-add-once-v1',rule.source,
  rule.source === 'detector' ? rule.stricterPct : rule.condition && [rule.condition.metric,rule.condition.direction,rule.condition.threshold,rule.condition.snapshot.definitionKey,rule.condition.snapshot.interval],
  rule.quantityMode??rule.amountMode,...(rule.quantityMode==='calculator'?[rule.repeat!==false]:[]),rule.quantityMode?(rule.quantityMode==='fixed'?rule.quantity:null):(rule.amountMode==='fixed'?rule.amountUsdt:null)];
export function validateQualityAddition(rule?: QualityAdditionRule): void {
  if (!rule?.enabled) return;
  if (!['detector','custom'].includes(rule.source) || !(rule.quantityMode?['calculator','entry','fixed'].includes(rule.quantityMode):['entry','fixed'].includes(rule.amountMode))) throw new Error('加仓条件来源或数量方式无效');
  if(rule.quantityMode){if(rule.quantityMode==='fixed'&&(!(rule.quantity!>0)||!Number.isFinite(rule.quantity)))throw new Error('加仓数量须为大于 0 的有限数字');}
  else if (rule.amountMode === 'fixed' && (!(rule.amountUsdt! > 0) || !Number.isFinite(rule.amountUsdt))) throw new Error('加仓金额须为大于 0 的有限数字');
  if (rule.source === 'detector' && (!(rule.stricterPct > 0) || !Number.isFinite(rule.stricterPct))) throw new Error('加仓门槛提高幅度须为大于 0 的有限数字');
  if (rule.source === 'custom' && (!rule.condition || !Number.isFinite(rule.condition.threshold) || !['<','>'].includes(rule.condition.direction))) throw new Error('请选择加仓指标并填写有限数字门槛');
}
export function stricterAdditionThreshold(threshold: number, direction: '<' | '>', pct: number): number {
  // Zero has no percentage scale: use one raw unit as its reference, and show this convention in the editor.
  const next = threshold + (direction === '>' ? 1 : -1) * (Math.abs(threshold) || 1) * pct / 100;
  if (!Number.isFinite(next) || !(direction === '>' ? next > threshold : next < threshold)) throw new Error('加仓门槛提高幅度超出有效精度或范围');
  return Number(next.toPrecision(15));
}
export const additionLabel = (rule?: QualityAdditionRule) => rule?.enabled ? `${rule.quantityMode==='calculator'&&rule.repeat!==false?'多轮加仓':'加仓一次'}：${rule.source === 'detector' ? `原探测门槛严格 ${rule.stricterPct}%` : `${rule.condition?.label} ${rule.condition?.direction} ${rule.condition?.threshold}`} · ${rule.quantityMode?(rule.quantityMode==='calculator'?`加仓计算器 · 5m ATR(14) × 1.5 · ${rule.repeat===false?'一次':'多轮'} · K止损`:rule.quantityMode==='entry'?'与初始币数相同':rule.quantity+' 枚'):(rule.amountMode==='entry'?'与开仓等额':rule.amountUsdt+' USDT')}` : '';
/** Mirror partial sales retain their original-coin sizing; 100% closes every coin then held. */
export function qualityAdditionFills(result:{additionFill?:QualityAdditionFill;additionFills?:readonly QualityAdditionFill[]}):readonly QualityAdditionFill[]{return result.additionFills?.length?result.additionFills:result.additionFill?[result.additionFill]:[];}
export function additionPosition(notional: number, entry: number, mark: number, closed: boolean, addition: QualityAdditionFill|readonly QualityAdditionFill[],
  mirror?: { at:number;price:number;fraction:number }) {
  const fills=Array.isArray(addition)?addition:[addition as QualityAdditionFill];
  const totalInvested = notional + fills.reduce((n,a)=>n+a.notional,0), totalQuantity = notional / entry + fills.reduce((n,a)=>n+a.quantity,0);
  const fullMirror = mirror?.fraction === 1;
  const mirrorQuantity = mirror ? fullMirror ? totalQuantity : notional / entry * mirror.fraction : 0;
  const mirrorCost = mirror ? fullMirror ? totalInvested : notional * mirror.fraction : 0;
  const mirrorPnl = mirror ? mirrorQuantity * mirror.price - mirrorCost : 0;
  const unsoldQuantity = totalQuantity - mirrorQuantity, unsoldCost = totalInvested - mirrorCost;
  const remainingPnl = unsoldQuantity * mark - unsoldCost, totalPnl = mirrorPnl + remainingPnl;
  const values = [totalInvested,totalQuantity,mirrorPnl,remainingPnl,totalPnl];
  if (!values.every(Number.isFinite) || !(totalInvested > 0) || !fills.every(a=>a.quantity>0&&Number.isFinite(a.quantity)&&a.notional>0&&Number.isFinite(a.notional))) throw new Error('加仓金额或持仓数量超出可计算范围');
  return { totalInvested,totalQuantity,mirrorQuantity,mirrorCost,mirrorPnl,remainingPnl,totalPnl,
    returnPct: totalPnl / totalInvested * 100, averageEntryPrice: unsoldQuantity > 0 ? unsoldCost / unsoldQuantity : totalInvested / totalQuantity,
    remainingQuantity: closed ? 0 : unsoldQuantity, remainingCost: closed ? 0 : unsoldCost,
    realizedPnl: mirrorPnl + (closed ? remainingPnl : 0), exitQuantity: closed ? unsoldQuantity : 0 };
}
