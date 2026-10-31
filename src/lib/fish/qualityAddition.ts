/** Conditional paper additions; disabled and legacy rules retain their frozen identities. */
import type { QualityBuyFilter } from './quality';
export interface QualityAdditionRule {
  enabled: boolean; source: 'detector' | 'custom'; stricterPct: number;
  quantityMode?: 'calculator' | 'entry' | 'fixed'; quantity?: number;
  repeat?:boolean;
  maxRounds?:number;
  rounds?:QualityAdditionRoundRule[];
  /** Custom indicators are conjunctive; condition remains the legacy first indicator. */
  conditions?: QualityBuyFilter[];
  minGainPct?:number;
  /** Per-round ATR distances: T >= S + entryBufferAtr * ATR; K = T - supportOffsetAtr * ATR. */
  entryBufferAtr?:number; supportOffsetAtr?:number;
  /** Frozen legacy rules retain their original cash sizing. New saves use quantityMode. */
  amountMode?: 'entry' | 'fixed'; amountUsdt?: number; condition?: QualityBuyFilter;
}
export type QualityAdditionRoundRule=Pick<QualityAdditionRule,'source'|'stricterPct'|'condition'|'conditions'|'minGainPct'|'entryBufferAtr'|'supportOffsetAtr'>;
export const qualityAdditionAtrSettings=(rule:Pick<QualityAdditionRoundRule,'entryBufferAtr'|'supportOffsetAtr'>)=>({entryBufferAtr:rule.entryBufferAtr??2,supportOffsetAtr:rule.supportOffsetAtr??1.5});
const atrIdentity=(rule:QualityAdditionRoundRule)=>{const a=qualityAdditionAtrSettings(rule);return [a.entryBufferAtr,a.supportOffsetAtr];};
const customAtrSettings=(rule:QualityAdditionRoundRule)=>{const a=qualityAdditionAtrSettings(rule);return a.entryBufferAtr!==2||a.supportOffsetAtr!==1.5;};
export const qualityAdditionRoundLimit=(rule:QualityAdditionRule)=>rule.maxRounds??(rule.repeat===false?1:Infinity);
export const qualityAdditionRound=(rule:QualityAdditionRule,index:number):QualityAdditionRoundRule=>rule.rounds?.[index]??rule;
export interface QualityAdditionFill {
  prsEvidence?:import('../prs6h').PrsRow;
  at: number; price: number; notional: number; quantity: number; scanFrom: number;
  reading: number; threshold: number; direction: '<' | '>'; metric: string; label: string;
  featureId?: string; definitionKey?: string; barOpenTime: number;
  conditions?: QualityAdditionObservation[];
  priceGate?: {basis:'real-average';referencePrice:number;thresholdPct:number;observedPrice:number;gainPct:number;confirmedAt:number};
  sizing?: {support:number;previousSupport:number;atr:number;atrAt:number;coinsBefore:number;realAverageBefore:number;baseCoins:number;mirrorCoins:number;mirrorUsed:number;mirrorAvailableBefore?:number;costBufferAtr?:number;requiredBufferAtr?:number;supportOffsetAtr?:number;coverageGap?:number};
}
export interface QualityAdditionObservation {
  prsEvidence?:import('../prs6h').PrsRow;
  at:number;barOpenTime:number;reading:number;threshold:number;direction:'<'|'>';metric:string;label:string;featureId?:string;definitionKey?:string;
}
export function qualityAdditionConditions(rule?:Pick<QualityAdditionRule,'conditions'|'condition'>):QualityBuyFilter[]{
  return (rule?.conditions?.length?rule.conditions:rule?.condition?[rule.condition]:[]).filter(f=>f.enabled!==false);
}
const conditionIdentity=(f:QualityBuyFilter)=>[f.metric,f.direction,f.threshold,f.snapshot.definitionKey,f.snapshot.interval];
export const defaultQualityAddition = (): QualityAdditionRule => ({ enabled: false, source: 'detector', stricterPct: 10, quantityMode: 'calculator', quantity: 1, repeat:true });
export const additionIdentity = (rule?: QualityAdditionRule): unknown[] => !rule?.enabled ? [] : [rule.quantityMode==='calculator'?'holding-add-after-half-2atr-balance-v3':rule.quantityMode?'holding-add-once-after-half-quantity-v2':'holding-add-once-v1',rule.source,
  rule.source === 'detector' ? rule.stricterPct : qualityAdditionConditions(rule)[0] && conditionIdentity(qualityAdditionConditions(rule)[0]),
  rule.quantityMode??rule.amountMode,...(rule.quantityMode==='calculator'?[rule.repeat!==false]:[]),rule.quantityMode?(rule.quantityMode==='fixed'?rule.quantity:null):(rule.amountMode==='fixed'?rule.amountUsdt:null),
  ...(rule.source==='custom'&&qualityAdditionConditions(rule).length>1?[['all-indicators-v1',...qualityAdditionConditions(rule).slice(1).map(conditionIdentity)]]:[]),
  ...(rule.minGainPct!=null?[['closed-gain-gate-v1',rule.minGainPct,'real-average']]:[]),
  ...(rule.maxRounds!=null||rule.rounds?.length?[['independent-addition-rounds-v1',rule.maxRounds??null,rule.rounds?.map(r=>[r.source,r.source==='detector'?r.stricterPct:qualityAdditionConditions(r).map(conditionIdentity),r.minGainPct??null])??null]]:[]),
  ...(rule.quantityMode==='calculator'&&[rule,...(rule.rounds??[])].some(customAtrSettings)?[['addition-atr-settings-v1',atrIdentity(rule),rule.rounds?.map(atrIdentity)??null]]:[])];
export function validateQualityAddition(rule?: QualityAdditionRule): void {
  if (!rule?.enabled) return;
  if (!['detector','custom'].includes(rule.source) || !(rule.quantityMode?['calculator','entry','fixed'].includes(rule.quantityMode):['entry','fixed'].includes(rule.amountMode))) throw new Error('加仓条件来源或数量方式无效');
  if(rule.quantityMode){if(rule.quantityMode==='fixed'&&(!(rule.quantity!>0)||!Number.isFinite(rule.quantity)))throw new Error('加仓数量须为大于 0 的有限数字');}
  else if (rule.amountMode === 'fixed' && (!(rule.amountUsdt! > 0) || !Number.isFinite(rule.amountUsdt))) throw new Error('加仓金额须为大于 0 的有限数字');
  if (rule.source === 'detector' && (!(rule.stricterPct > 0) || !Number.isFinite(rule.stricterPct))) throw new Error('加仓门槛提高幅度须为大于 0 的有限数字');
  if (rule.source === 'custom' && (!qualityAdditionConditions(rule).length || qualityAdditionConditions(rule).some(f=>!Number.isFinite(f.threshold)||!['<','>'].includes(f.direction)))) throw new Error('请选择加仓指标并填写有限数字门槛');
  if(rule.minGainPct!=null&&(!Number.isFinite(rule.minGainPct)||rule.minGainPct<0))throw new Error('加仓涨幅门槛须为不小于 0 的有限数字');
  if(rule.quantityMode==='calculator'){
    const atr=qualityAdditionAtrSettings(rule);
    if(!Number.isFinite(atr.entryBufferAtr)||atr.entryBufferAtr<0)throw new Error('T 高于 S 的 ATR 倍数须为不小于 0 的有限数字');
    if(!Number.isFinite(atr.supportOffsetAtr)||atr.supportOffsetAtr<=0)throw new Error('K 回撤的 ATR 倍数须为大于 0 的有限数字');
  }
  if(rule.maxRounds!=null&&(!Number.isInteger(rule.maxRounds)||rule.maxRounds<1||rule.maxRounds>100))throw new Error('最多加仓次数须为 1 至 100 的整数');
  if(rule.rounds){if(rule.maxRounds==null||rule.rounds.length!==rule.maxRounds)throw new Error('每次加仓须有对应的独立条件');for(const [i,round] of rule.rounds.entries()){try{validateQualityAddition({...rule,...round,maxRounds:undefined,rounds:undefined});}catch(e){throw new Error(`第 ${i+1} 次加仓：${e instanceof Error?e.message:'条件无效'}`);}}}
}
export function stricterAdditionThreshold(threshold: number, direction: '<' | '>', pct: number): number {
  // Zero has no percentage scale: use one raw unit as its reference, and show this convention in the editor.
  const next = threshold + (direction === '>' ? 1 : -1) * (Math.abs(threshold) || 1) * pct / 100;
  if (!Number.isFinite(next) || !(direction === '>' ? next > threshold : next < threshold)) throw new Error('加仓门槛提高幅度超出有效精度或范围');
  return Number(next.toPrecision(15));
}
function additionFormulaLabel(rule:QualityAdditionRule){
  const rounds=rule.rounds?.length?rule.rounds:[rule],first=qualityAdditionAtrSettings(rounds[0]);
  return rounds.some(r=>{const a=qualityAdditionAtrSettings(r);return a.entryBufferAtr!==first.entryBufferAtr||a.supportOffsetAtr!==first.supportOffsetAtr;})?'逐轮 ATR 倍数独立设置':`T≥S+${first.entryBufferAtr}ATR · K=T−${first.supportOffsetAtr}ATR`;
}
export const additionLabel = (rule?: QualityAdditionRule) => rule?.enabled ? `${rule.maxRounds!=null?`最多加仓 ${rule.maxRounds} 次（逐轮独立条件）`:rule.quantityMode==='calculator'&&rule.repeat!==false?'多轮加仓':'加仓一次'}：${rule.source === 'detector' ? `原探测门槛严格 ${rule.stricterPct}%` : qualityAdditionConditions(rule).map(f=>`${f.label} ${f.direction} ${f.threshold}`).join(' 且 ')}${rule.minGainPct!=null?` 且 相对当前持仓均价上涨 ≥ ${rule.minGainPct}%`:''} · ${rule.quantityMode?(rule.quantityMode==='calculator'?`半仓镜像后按余仓平衡定量 · ${additionFormulaLabel(rule)} · ${rule.repeat===false?'一次':'多轮'} · K止损`:rule.quantityMode==='entry'?'与半仓镜像后余仓币数相同':rule.quantity+' 枚'):(rule.amountMode==='entry'?'与开仓等额':rule.amountUsdt+' USDT')}` : '';
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

/** Both downloads retain the same frozen gate and sizing evidence as the campaign. */
export const additionEvidenceHeaders=['本轮可用落袋利润 USDT','安全垫贡献币数','落袋利润贡献币数','同时满足的指标 JSON','涨幅门槛 %','涨幅基准均价','确认收盘价','确认涨幅 %','T高于S的ATR倍数','最低ATR距离','K平衡差 USDT','K回撤ATR倍数'];
export function additionEvidenceValues(a?:QualityAdditionFill){return [a?.sizing?.mirrorAvailableBefore??null,a?.sizing?.baseCoins??null,a?.sizing?.mirrorCoins??null,a?.conditions?JSON.stringify(a.conditions):null,a?.priceGate?.thresholdPct??null,a?.priceGate?.referencePrice??null,a?.priceGate?.observedPrice??null,a?.priceGate?.gainPct??null,a?.sizing?.costBufferAtr??null,a?.sizing?.requiredBufferAtr??null,a?.sizing?.coverageGap??null,a?.sizing?(a.sizing.supportOffsetAtr??1.5):null];}
