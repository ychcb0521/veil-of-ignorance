/** Conditional paper additions; disabled and legacy rules retain their frozen identities. */
import { activeAdditionVetoes, additionVetoIdentity, validateAdditionVetoes } from './qualityAdditionVeto';
import type { QualityBuyFilter } from './quality';
import {validateStructureAddition,structureAdditionIdentity,structureAdditionLabel,type StructureAdditionRule,type StructureAdditionEvidence} from './qualityAdditionStructure';
export interface QualityAdditionRule {
  enabled: boolean; source: 'detector' | 'custom' | 'structure';
  structure?:StructureAdditionRule; stricterPct: number;
  quantityMode?: 'calculator' | 'entry' | 'fixed'; quantity?: number;
  repeat?:boolean;
  maxRounds?:number;
  rounds?:QualityAdditionRoundRule[];
  /** Custom indicators are conjunctive; condition remains the legacy first indicator. */
  conditions?: QualityBuyFilter[];
  /** 箱体或原探测时机的指标前提（必要不充分，时机那一刻须全部满足）。自选指标时机的前提仍是 conditions[1..]。 */
  prerequisites?: QualityBuyFilter[];
  minGainPct?:number;
  /**
   * 【用户要求】2026-11-02 支撑线下移减仓（按减仓计算器）：加仓后箱体支撑下移到 K 的支撑基准下方 ≥ minDropAtr×ATR、价格仍高于 K 时，
   * 在下一分钟开盘按 X＝(S−K′)÷(T−K′) 减仓（S 为当前持仓保本价，K′＝新支撑 − n×ATR），止损随之下移到 K′；X 超过 maxPct 或无法保本时不减。
   */
  supportReduction?: QualitySupportReductionRule;
  /** 【用户要求】2026-11-03 几何仓位 > multiple 时，止损从 Kₘ 上移到 Kₘ＋pct%×首次开仓价，至少保住 pct% 的开仓价有效涨幅（各次通用）。 */
  geometricLock?: QualityGeometricLockRule;
  /**
   * 【用户要求】2026-11-03「加仓后，无论如何都不要亏」：K 取防守线时，防守线要等 5 分钟收盘确认、下一分钟开盘才卖，成交价会低于 K。
   * 保本底线 F＝防守线 K − atr×ATR：盘中碰到 F 立即按 F 卖出全部持仓（跳空按开盘价），加仓量也按 F 用平衡公式算——
   * 于是不论收盘确认、组合卖出还是否决，成交价都不低于 F，整笔不亏（跳空除外）。只对防守线 K 生效，各次通用。
   */
  breakevenFloor?: QualityBreakevenFloorRule;
  /** 加仓否决（不再加仓）：任一启用条件在加仓那一刻成立，就跳过这一次（见 qualityAdditionVeto）。 */
  /** 【用户要求】2026-11-03「方向」里的探测算法条件：加仓那一刻所选探测算法的读数须达到原门槛再提高 stricterPct%（调整量＝原门槛绝对值 × 百分比）。featureId 不填＝这条信号的全部原探测算法同时满足。 */
  detectorPrerequisite?: QualityDetectorPrerequisite;
  entryVetoes?: import('./qualityAdditionVeto').QualityAdditionEntryVeto[];
  /** K = T - supportOffsetAtr * ATR（非箱体位置）。entryBufferAtr（旧「入场距离 T ≥ S＋n×ATR」）2026-11-01 应用户要求删除：引擎不再检查，只为读旧数据保留字段。 */
  entryBufferAtr?:number; supportOffsetAtr?:number;
  /**
   * 【用户要求】2026-11-04 恢复「指标＋入场距离（S/T/K）」位置：自选指标触发时要求 T ≥ S＋n×ATR（S＝最新成本线），不够就不加。
   * 新字段（不复用 entryBufferAtr）：11-01 之后引擎一直忽略 entryBufferAtr，复用会悄悄改变已有方案的结果。
   */
  entryDistanceAtr?:number;
  /** 涨幅门槛的基准：'average'＝相对持仓均价（10-31 版）；缺省＝相对最新成本线 S（11-01 起）。 */
  gainBasis?:'average';
  /** Frozen legacy rules retain their original cash sizing. New saves use quantityMode. */
  amountMode?: 'entry' | 'fixed'; amountUsdt?: number; condition?: QualityBuyFilter;
}
export interface QualityGeometricLockRule { enabled: boolean; multiple: number; pct: number }
export const defaultGeometricLock = (): QualityGeometricLockRule => ({ enabled: false, multiple: 10, pct: 1 });
export interface QualityBreakevenFloorRule { enabled: boolean; atr: number }
export const defaultBreakevenFloor = (): QualityBreakevenFloorRule => ({ enabled: false, atr: BREAKEVEN_FLOOR_DEFAULT_ATR });
/**
 * 保本底线 F 离防守线 K 的 ATR 倍数（缺省值）。2026-11-04 按「组合算法1-8」94 笔回放定为 0.25：
 * 不开 +1823.42（加仓后亏损 7 笔 −13.40）；m＝0.25 +1434.98、去前 2 名 +317.24、加仓后亏损 0；
 * m＝0.5 +1172.26 / +300.19 / 0；m＝1 +841.46 / +273.54 / 0。0.25 已消除全部加仓后亏损，对大趋势单削弱最小。
 */
export const BREAKEVEN_FLOOR_DEFAULT_ATR = 0.25;
export interface QualitySupportReductionRule { enabled: boolean; minDropAtr: number; maxPct: number;
  /** 【用户要求】2026-11-02 K 连续下移达到这个次数就全仓卖出（中间有加仓则重新计数）；不填＝不启用。 */
  exitAfterDrops?: number;
  /**
   * 2＝11-03 修正（support-drop-reduction-v2）：有过减仓后，加仓的成本线取整笔真实保本价、可用落袋记 0，减仓所得不再重复计入（ORDI 加仓2多加 8.25%）。
   * 缺省＝v1（11-02 原版）：已存的方案与模板照旧按 v1 计算，结果逐位不变（【用户要求】2026-11-03 模板必须能原样复原）。
   */
  version?: 2 }
/**
 * 减仓计算器同一公式：X＝(S−K′)÷(T−K′)。S＝整笔保本价＝(持仓成本−已落袋利润)÷持仓币数，K′ 新止损，T 减仓价。
 * 减掉 X 后，价格碰到 K′ 时整笔约保本。X≤0 只挪止损不减仓；X≥1（T 不够高）或超过单次上限则不减仓（返回 undefined）。
 */
export function supportDropReduction(p:{held:number;cost:number;realized:number},T:number,K:number,maxPct:number):{fraction:number;breakeven:number}|undefined{
  if(!(p.held>0)||!(T>K)||![T,K,p.cost,p.realized].every(Number.isFinite))return;
  const breakeven=(p.cost-p.realized)/p.held,X=(breakeven-K)/(T-K);
  if(!Number.isFinite(X)||X>=1||X*100>maxPct+1e-9)return;
  return {fraction:Math.max(0,X),breakeven};
}
export const defaultSupportReduction = (): QualitySupportReductionRule => ({ enabled: false, minDropAtr: .5, maxPct: 80, version: 2 });
/** 一次支撑下移减仓：减掉当时持仓的 fraction；costRemoved 为按均价移出的成本，realizedPnl＝quantity×price − costRemoved。 */
export interface QualityReductionFill { at: number; price: number; fraction: number; quantity: number; costRemoved: number; realizedPnl: number; breakeven: number; previousK: number; newK: number; previousSupport: number; newSupport: number; atr: number;
  /** 开着保本底线时：挪到的防守线 K′（newK 是它下方的保本底线 F′）。 */
  newGuardK?: number }
export interface QualityDetectorPrerequisite { enabled: boolean; stricterPct: number; featureId?: string }
export type QualityAdditionRoundRule=Pick<QualityAdditionRule,'source'|'structure'|'stricterPct'|'condition'|'conditions'|'prerequisites'|'minGainPct'|'entryBufferAtr'|'supportOffsetAtr'|'entryDistanceAtr'|'gainBasis'|'entryVetoes'|'detectorPrerequisite'>;
export const activeDetectorPrerequisite=(r?:Pick<QualityAdditionRoundRule,'detectorPrerequisite'|'source'>)=>r?.source!=='custom'&&r?.detectorPrerequisite?.enabled?r.detectorPrerequisite:undefined;
export const qualityAdditionAtrSettings=(rule:Pick<QualityAdditionRoundRule,'entryBufferAtr'|'supportOffsetAtr'>)=>({entryBufferAtr:rule.entryBufferAtr??2,supportOffsetAtr:rule.supportOffsetAtr??1.5});
const atrIdentity=(rule:QualityAdditionRoundRule)=>qualityAdditionAtrSettings(rule).supportOffsetAtr;
export const qualityAdditionRoundLimit=(rule:QualityAdditionRule)=>rule.maxRounds??(rule.repeat===false?1:Infinity);
export const qualityAdditionRound=(rule:QualityAdditionRule,index:number):QualityAdditionRoundRule=>rule.rounds?.[index]??rule;
export interface QualityAdditionFill {
  structureEvidence?:StructureAdditionEvidence;
  prsEvidence?:import('../prs6h').PrsRow;
  at: number; price: number; notional: number; quantity: number; scanFrom: number;
  reading: number; threshold: number; direction: '<' | '>'; metric: string; label: string;
  featureId?: string; definitionKey?: string; barOpenTime: number;
  conditions?: QualityAdditionObservation[];
  priceGate?: {basis:'real-average'|'cost-line';referencePrice:number;thresholdPct:number;observedPrice:number;gainPct:number;confirmedAt:number};
  sizing?: {support:number;previousSupport:number;atr:number;atrAt:number;coinsBefore:number;realAverageBefore:number;baseCoins:number;mirrorCoins:number;mirrorUsed:number;mirrorAvailableBefore?:number;costBufferAtr?:number;
    /** 保本底线：防守线 K（收盘确认的那条线）与 F 离它的 ATR 倍数；此时 support＝F（加仓量与盘中止损都按 F）。 */
    guardK?:number;floorAtr?:number;requiredBufferAtr?:number;supportOffsetAtr?:number;coverageGap?:number};
}
export interface QualityAdditionObservation {
  prsEvidence?:import('../prs6h').PrsRow;
  at:number;barOpenTime:number;reading:number;threshold:number;direction:'<'|'>';metric:string;label:string;featureId?:string;definitionKey?:string;
}
export function qualityAdditionConditions(rule?:Pick<QualityAdditionRule,'conditions'|'condition'>):QualityBuyFilter[]{
  return (rule?.conditions?.length?rule.conditions:rule?.condition?[rule.condition]:[]).filter(f=>f.enabled!==false);
}
const conditionIdentity=(f:QualityBuyFilter)=>[f.metric,f.direction,f.threshold,f.snapshot.definitionKey,f.snapshot.interval];
/**
 * 加仓「方向」（代码里叫 prerequisites）：必要不充分，时机触发的那一刻须全部满足。
 * 自选指标时机下，conditions[0] 是时机本身、其余是前提（与旧格式「同一时刻全部满足」完全相同）；
 * 箱体与原探测时机下，前提单独存在 prerequisites（不复用 conditions：旧规则里可能残留未生效的 condition）。
 */
export const qualityAdditionPrerequisites=(rule?:Pick<QualityAdditionRule,'source'|'conditions'|'condition'|'prerequisites'>)=>rule?.source==='custom'?qualityAdditionConditions(rule).slice(1):(rule?.prerequisites??[]).filter(f=>f.enabled!==false);
/** 箱体或原探测时机附加的指标前提；没有前提时不改变既有结果的身份。 */
const prerequisiteIdentity=(rule:QualityAdditionRoundRule)=>[...(rule.source!=='custom'&&qualityAdditionPrerequisites(rule).length?[['timing-prerequisites-v1',qualityAdditionPrerequisites(rule).map(conditionIdentity)]]:[]),
  ...(activeDetectorPrerequisite(rule)?[['detector-prerequisite-v1',activeDetectorPrerequisite(rule)!.stricterPct,activeDetectorPrerequisite(rule)!.featureId??'all']]:[])];
const timingIdentity=(r:QualityAdditionRoundRule)=>{const base=r.source==='structure'?r.structure&&structureAdditionIdentity(r.structure):r.source==='detector'?r.stricterPct:qualityAdditionConditions(r).map(conditionIdentity);const extra=prerequisiteIdentity(r);return extra.length?[base,...extra]:base;};
/**
 * 【用户要求】2026-11-02 加仓前提是镜像止盈已成交且留有余仓（0 < 卖出比例 < 100%），不再限定恰好 50%：
 * 「组合算法1」镜像卖 67% 时 150 笔全被「须先完成 50% 半仓镜像」拦下，用户看到条件达标却没有加仓。
 */
export const isPartialMirror=(fill?:{fraction:number}):fill is {fraction:number}&{at:number;price:number}=>!!fill&&fill.fraction>0&&fill.fraction<1;
/** 镜像卖出比例不是 50% 的方案，旧结果是「未加仓」口径，须重算；50% 方案身份不变、结果照旧复用。 */
export const additionMirrorIdentity=(addition?:Pick<QualityAdditionRule,'enabled'|'quantityMode'>,mirror?:{enabled:boolean;sellPct:number}):unknown[]=>addition?.enabled&&addition.quantityMode&&mirror?.enabled&&mirror.sellPct!==50?[['addition-after-partial-mirror-v1']]:[];
export const defaultQualityAddition = (): QualityAdditionRule => ({ enabled: false, source: 'detector', stricterPct: 10, quantityMode: 'calculator', quantity: 1, repeat:true });
export const additionIdentity = (rule?: QualityAdditionRule): unknown[] => !rule?.enabled ? [] : [rule.quantityMode==='calculator'?'holding-add-after-half-2atr-balance-v3':rule.quantityMode?'holding-add-once-after-half-quantity-v2':'holding-add-once-v1',rule.source,
  rule.source === 'structure' ? rule.structure&&structureAdditionIdentity(rule.structure) : rule.source === 'detector' ? rule.stricterPct : qualityAdditionConditions(rule)[0] && conditionIdentity(qualityAdditionConditions(rule)[0]),
  rule.quantityMode??rule.amountMode,...(rule.quantityMode==='calculator'?[rule.repeat!==false]:[]),rule.quantityMode?(rule.quantityMode==='fixed'?rule.quantity:null):(rule.amountMode==='fixed'?rule.amountUsdt:null),
  ...(rule.source==='custom'&&qualityAdditionConditions(rule).length>1?[['all-indicators-v1',...qualityAdditionConditions(rule).slice(1).map(conditionIdentity)]]:[]),
  ...prerequisiteIdentity(rule),
  ...(rule.minGainPct!=null?[['closed-gain-gate-v1',rule.minGainPct,rule.quantityMode==='calculator'?'cost-line':'real-average']]:[]),
  ...(rule.maxRounds!=null||rule.rounds?.length?[['independent-addition-rounds-v1',rule.maxRounds??null,rule.rounds?.map(r=>[r.source,timingIdentity(r),r.minGainPct??null])??null]]:[]),
  // 入场距离删除后结果口径变了：所有平衡公式加仓都带新标记，旧口径（含入场距离门槛）的结果不会被当成新结果
  ...(rule.quantityMode==='calculator'?[['addition-k-atr-no-entry-distance-v2',atrIdentity(rule),rule.rounds?.map(atrIdentity)??null]]:[]),
  // 2026-11-04 恢复入场距离与「相对持仓均价」涨幅门槛：只有设了的方案身份才变，旧结果照旧复用
  ...([rule,...(rule.rounds??[])].some(r=>r.entryDistanceAtr!=null)?[['entry-distance-v1',[rule,...(rule.rounds??[])].map(r=>r.entryDistanceAtr??null)]]:[]),
  ...([rule,...(rule.rounds??[])].some(r=>r.gainBasis==='average')?[['gain-basis-average-v1',[rule,...(rule.rounds??[])].map(r=>r.gainBasis??null)]]:[]),
  ...(rule.geometricLock?.enabled?[['geometric-lock-v1',rule.geometricLock.multiple,rule.geometricLock.pct]]:[]),
  ...(rule.breakevenFloor?.enabled?[['breakeven-floor-v1',rule.breakevenFloor.atr]]:[]),
  // v2（2026-11-03）：减仓后再加仓时，减仓所得不再当成额外可用利润重复计入（v1 会多加）；开了减仓的方案须重算
  ...(rule.supportReduction?.enabled?[[rule.supportReduction.version===2?'support-drop-reduction-v2':'support-drop-reduction-v1',rule.supportReduction.minDropAtr,rule.supportReduction.maxPct,...(rule.supportReduction.exitAfterDrops!=null?[['exit-after-support-drops-v1',rule.supportReduction.exitAfterDrops]]:[])]]:[]),
  // 2026-11-02 加仓否决：只有启用了否决的方案身份才变，旧结果照旧复用
  ...([rule,...(rule.rounds??[])].some(r=>activeAdditionVetoes(r.entryVetoes).length)?[['addition-entry-vetoes-v1',additionVetoIdentity(rule.entryVetoes),rule.rounds?.map(r=>additionVetoIdentity(r.entryVetoes))??null]]:[])];
export function validateQualityAddition(rule?: QualityAdditionRule): void {
  if (!rule?.enabled) return;
  if (!['detector','custom','structure'].includes(rule.source) || !(rule.quantityMode?['calculator','entry','fixed'].includes(rule.quantityMode):['entry','fixed'].includes(rule.amountMode))) throw new Error('加仓条件来源或数量方式无效');
  if(rule.source==='structure'){validateStructureAddition(rule.structure);if(rule.quantityMode!=='calculator')throw Error('箱体加仓须使用按平衡公式定量');}
  if(rule.quantityMode){if(rule.quantityMode==='fixed'&&(!(rule.quantity!>0)||!Number.isFinite(rule.quantity)))throw new Error('加仓数量须为大于 0 的有限数字');}
  else if (rule.amountMode === 'fixed' && (!(rule.amountUsdt! > 0) || !Number.isFinite(rule.amountUsdt))) throw new Error('加仓金额须为大于 0 的有限数字');
  if (rule.source === 'detector' && (!(rule.stricterPct > 0) || !Number.isFinite(rule.stricterPct))) throw new Error('加仓门槛提高幅度须为大于 0 的有限数字');
  if (rule.source === 'custom' && (!qualityAdditionConditions(rule).length || qualityAdditionConditions(rule).some(f=>!Number.isFinite(f.threshold)||!['<','>'].includes(f.direction)))) throw new Error('请选择加仓指标并填写有限数字门槛');
  if(rule.source!=='custom'&&qualityAdditionPrerequisites(rule).some(f=>!Number.isFinite(f.threshold)||!['<','>'].includes(f.direction)))throw new Error('加仓方向条件的指标须填写有限数字门槛');
  if(rule.minGainPct!=null&&(!Number.isFinite(rule.minGainPct)||rule.minGainPct<0))throw new Error('加仓涨幅门槛须为不小于 0 的有限数字');
  validateAdditionVetoes(rule.entryVetoes);
  for(const r of [rule,...(rule.rounds??[])]){const dp=activeDetectorPrerequisite(r);if(dp&&(!Number.isFinite(dp.stricterPct)||dp.stricterPct<0||dp.stricterPct>1000))throw new Error('方向 · 探测算法：门槛提高幅度须为 0–1000%');}
  if(rule.breakevenFloor?.enabled){const f=rule.breakevenFloor;if(!Number.isFinite(f.atr)||f.atr<0||f.atr>20)throw new Error('保本底线：离防守线的 ATR 倍数须为 0–20');}
  if(rule.geometricLock?.enabled){const g=rule.geometricLock;if(!Number.isFinite(g.multiple)||g.multiple<=0||g.multiple>1e6)throw new Error('保住有效涨幅：几何仓位门槛须为大于 0 的数字');if(!Number.isFinite(g.pct)||g.pct<0||g.pct>100)throw new Error('保住有效涨幅：百分比须为 0–100%');}
  if(rule.supportReduction?.enabled){const r=rule.supportReduction;if(!Number.isFinite(r.minDropAtr)||r.minDropAtr<0||r.minDropAtr>20)throw new Error('支撑下移减仓：触发的下移幅度须为 0–20 倍 ATR');if(!Number.isFinite(r.maxPct)||r.maxPct<=0||r.maxPct>100)throw new Error('支撑下移减仓：单次减仓上限须为 0–100%');if(r.exitAfterDrops!=null&&(!Number.isInteger(r.exitAfterDrops)||r.exitAfterDrops<1||r.exitAfterDrops>20))throw new Error('K 连续下移全仓卖出：次数须为 1–20 的整数');}
  if(rule.quantityMode==='calculator'){
    const atr=qualityAdditionAtrSettings(rule);
    if(rule.source!=='structure'&&(!Number.isFinite(atr.supportOffsetAtr)||atr.supportOffsetAtr<=0))throw new Error('K 回撤的 ATR 倍数须为大于 0 的有限数字');
    for(const r of [rule,...(rule.rounds??[])]){
      if(r.entryDistanceAtr!=null&&(!Number.isFinite(r.entryDistanceAtr)||r.entryDistanceAtr<0||r.entryDistanceAtr>50))throw new Error('入场距离须为 0–50 倍 ATR');
      if(r.gainBasis!=null&&r.gainBasis!=='average')throw new Error('涨幅门槛基准无效');
    }
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
  if(rounds.some(r=>r.source==='structure'))return rounds.length===1&&rounds[0].structure?structureAdditionLabel(rounds[0].structure):'逐轮箱体 / ATR 平衡线独立设置';
  // 2026-11-04 S/T/K：设了入场距离时一并写出（各次相同才合写）
  const same=rounds.every(r=>qualityAdditionAtrSettings(r).supportOffsetAtr===first.supportOffsetAtr&&r.entryDistanceAtr===rounds[0].entryDistanceAtr);
  return !same?'逐轮 ATR 倍数独立设置':`${rounds[0].entryDistanceAtr!=null?`T≥S+${rounds[0].entryDistanceAtr}ATR · `:''}K=T−${first.supportOffsetAtr}ATR`;
}
export const additionLabel = (rule?: QualityAdditionRule) => rule?.enabled ? `${rule.maxRounds!=null?`最多加仓 ${rule.maxRounds} 次（逐轮独立条件）`:rule.quantityMode==='calculator'&&rule.repeat!==false?'多轮加仓':'加仓一次'}：${rule.source === 'structure'&&rule.structure ? structureAdditionLabel(rule.structure) : rule.source === 'detector' ? `原探测门槛严格 ${rule.stricterPct}%` : qualityAdditionConditions(rule).map(f=>`${f.label} ${f.direction} ${f.threshold}`).join(' 且 ')}${rule.source!=='custom'&&qualityAdditionPrerequisites(rule).length?` 且 方向 ${qualityAdditionPrerequisites(rule).map(f=>`${f.label} ${f.direction} ${f.threshold}`).join(' 且 ')}`:''}${activeDetectorPrerequisite(rule)?` 且 ${activeDetectorPrerequisite(rule)!.featureId??'原探测算法'} 探测值达原门槛再提高 ${activeDetectorPrerequisite(rule)!.stricterPct}%`:''}${rule.minGainPct!=null?` 且 相对最新成本线 S 上涨 ≥ ${rule.minGainPct}%`:''} · ${rule.quantityMode?(rule.quantityMode==='calculator'?`镜像止盈后按余仓平衡定量 · ${additionFormulaLabel(rule)} · ${rule.repeat===false?'一次':'多轮'} · K止损${rule.geometricLock?.enabled?` · 几何仓位 > ${rule.geometricLock.multiple} 保住有效涨幅 ${rule.geometricLock.pct}%`:''}${rule.supportReduction?.enabled?` · 支撑下移 ≥ ${rule.supportReduction.minDropAtr} ATR 减仓（单次 ≤ ${rule.supportReduction.maxPct}%）${rule.supportReduction.exitAfterDrops!=null?`，连续下移 ${rule.supportReduction.exitAfterDrops} 次全仓卖出`:''}`:''}`:rule.quantityMode==='entry'?'与镜像止盈后余仓币数相同':rule.quantity+' 枚'):(rule.amountMode==='entry'?'与开仓等额':rule.amountUsdt+' USDT')}` : '';
/** Mirror partial sales retain their original-coin sizing; 100% closes every coin then held. */
export function qualityAdditionFills(result:{additionFill?:QualityAdditionFill;additionFills?:readonly QualityAdditionFill[]}):readonly QualityAdditionFill[]{return result.additionFills?.length?result.additionFills:result.additionFill?[result.additionFill]:[];}
export function additionPosition(notional: number, entry: number, mark: number, closed: boolean, addition: QualityAdditionFill|readonly QualityAdditionFill[],
  mirror?: { at:number;price:number;fraction:number }, reductions: readonly QualityReductionFill[] = []) {
  const fills=Array.isArray(addition)?addition:[addition as QualityAdditionFill];
  const totalInvested = notional + fills.reduce((n,a)=>n+a.notional,0), totalQuantity = notional / entry + fills.reduce((n,a)=>n+a.quantity,0);
  const fullMirror = mirror?.fraction === 1;
  const mirrorQuantity = mirror ? fullMirror ? totalQuantity : notional / entry * mirror.fraction : 0;
  const mirrorCost = mirror ? fullMirror ? totalInvested : notional * mirror.fraction : 0;
  const mirrorPnl = mirror ? mirrorQuantity * mirror.price - mirrorCost : 0;
  // 支撑下移减仓：按当时均价移出成本，已实现部分计入；剩余仓位按标记价估值（现金流口径，合计与逐笔一致）
  const reducedQuantity = reductions.reduce((n, r) => n + r.quantity, 0), reducedCost = reductions.reduce((n, r) => n + r.costRemoved, 0), reductionPnl = reductions.reduce((n, r) => n + r.realizedPnl, 0);
  const unsoldQuantity = totalQuantity - mirrorQuantity - reducedQuantity, unsoldCost = totalInvested - mirrorCost - reducedCost;
  const remainingPnl = unsoldQuantity * mark - unsoldCost, totalPnl = mirrorPnl + reductionPnl + remainingPnl;
  const values = [totalInvested,totalQuantity,mirrorPnl,remainingPnl,totalPnl];
  if (!values.every(Number.isFinite) || !(totalInvested > 0) || !fills.every(a=>a.quantity>0&&Number.isFinite(a.quantity)&&a.notional>0&&Number.isFinite(a.notional))) throw new Error('加仓金额或持仓数量超出可计算范围');
  return { totalInvested,totalQuantity,mirrorQuantity,mirrorCost,mirrorPnl,remainingPnl,totalPnl,reductionPnl,
    returnPct: totalPnl / totalInvested * 100, averageEntryPrice: unsoldQuantity > 0 ? unsoldCost / unsoldQuantity : totalInvested / totalQuantity,
    remainingQuantity: closed ? 0 : unsoldQuantity, remainingCost: closed ? 0 : unsoldCost,
    realizedPnl: mirrorPnl + reductionPnl + (closed ? remainingPnl : 0), exitQuantity: closed ? unsoldQuantity : 0 };
}

/** Both downloads retain the same frozen gate and sizing evidence as the campaign. */
export const additionEvidenceHeaders=['本轮可用落袋利润 USDT','安全垫贡献币数','落袋利润贡献币数','同时满足的指标 JSON','涨幅门槛 %','涨幅基准价','确认收盘价','确认涨幅 %','T高于S的ATR倍数','最低ATR距离','K平衡差 USDT','K回撤ATR倍数','箱体加仓依据 JSON'];
export function additionEvidenceValues(a?:QualityAdditionFill){return [a?.sizing?.mirrorAvailableBefore??null,a?.sizing?.baseCoins??null,a?.sizing?.mirrorCoins??null,a?.conditions?JSON.stringify(a.conditions):null,a?.priceGate?.thresholdPct??null,a?.priceGate?.referencePrice??null,a?.priceGate?.observedPrice??null,a?.priceGate?.gainPct??null,a?.sizing?.costBufferAtr??null,a?.sizing?.requiredBufferAtr??null,a?.sizing?.coverageGap??null,a?.structureEvidence?null:a?.sizing?(a.sizing.supportOffsetAtr??1.5):null,a?.structureEvidence?JSON.stringify(a.structureEvidence):null];}
