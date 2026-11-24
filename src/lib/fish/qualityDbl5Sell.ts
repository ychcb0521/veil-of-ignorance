import {definitionKey, type DeepDigFeatureDef} from '@/lib/deepDig/features';
import type {FishSnapshot} from './algorithm';
import type {QualityExitRule,QualityGroup} from './quality';
import {boxStopLabel, defaultBoxStop, freezeBoxStop, selectBoxStopReference, selectBoxStopGuardRegime, selectBoxStopChannels, validateBoxStop, type BoxStopRule} from './qualityBoxStop';
import type {QualityHoldingVeto} from './qualityVeto';

export const DBL5_SELL_VERSION = 'sell-dbl5-line-v1' as const;
export const DBL5_SELL_OR_VERSION = 'sell-dbl5-line-or-v2' as const;
const guardLines = {
  'sell-dbl5-guard': 'DBL-5 防守线（实线和虚线）',
  'sell-dbl5-guard-trend': 'DBL-5 防守线（实线）',
  'sell-dbl5-guard-range': 'DBL-5 防守线（虚线）',
} as const;
const impulseLines = {
  'sell-dbl5-impulse': 'DBL-5 急拉线-1115（实线）',
  'sell-dbl5-impulse0': 'DBL-5 急拉线-0（虚线）',
  'sell-dbl5-guard-plus': 'DBL-5 防守线+急拉线-1115',
} as const;
type GuardLine = keyof typeof guardLines;
type ParallelLine = `${GuardLine}+impulse1115` | `${GuardLine}+impulse0`;
export const DBL5_SELL_LINES = {
  ...guardLines, ...impulseLines,
  ...Object.fromEntries(Object.entries(guardLines).flatMap(([id,label])=>[
    [id+'+impulse1115',label+' 或 急拉线-1115（实线）'],
    [id+'+impulse0',label+' 或 急拉线-0（虚线）'],
  ])) as Record<ParallelLine,string>,
};
export type Dbl5SellLine = keyof typeof DBL5_SELL_LINES;
export const DBL5_SELL_METRIC = 'line' as const;
export type Dbl5SellRule = QualityExitRule & {version: typeof DBL5_SELL_VERSION | typeof DBL5_SELL_OR_VERSION; boxSell: BoxStopRule};
export const isDbl5Sell = (rule?: QualityExitRule): rule is Dbl5SellRule => rule?.version === DBL5_SELL_VERSION || rule?.version === DBL5_SELL_OR_VERSION;
export const isDbl5SellLine = (id?: string): id is Dbl5SellLine => !!id && Object.prototype.hasOwnProperty.call(DBL5_SELL_LINES,id);
export const dbl5SellChoice = (id: Dbl5SellLine) => id + ':' + DBL5_SELL_METRIC;
export const dbl5SellChoiceLine = (choice: string) => {
  const [id] = choice.split(':');
  return isDbl5SellLine(id) && choice === dbl5SellChoice(id) ? id : undefined;
};
export const isParallelDbl5Sell = (line?: Dbl5SellLine): boolean => !!line?.includes('+');
const guardRegime = (line:string) => line.endsWith('-trend') ? 'trend' : line.endsWith('-range') ? 'range' : 'both';
const referenceFor = (line:string) => line === 'sell-dbl5-impulse0' ? 'impulse0' : line === 'sell-dbl5-guard-plus' ? 'guard-plus1115' : line === 'sell-dbl5-impulse' ? 'impulse1115' : undefined;

export function makeDbl5Sell(line: Dbl5SellLine, atr: number, defs: readonly DeepDigFeatureDef[], prior?: Dbl5SellRule, impulseAtr?:number) {
  const name = line==='sell-dbl5-guard' ? 'DBL-5 防守线' : line==='sell-dbl5-impulse' ? 'DBL-5 急拉线' : DBL5_SELL_LINES[line];
  const def: DeepDigFeatureDef = {id:line,name,short:name,
    definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'1m'};
  const configure = (box:BoxStopRule, buffer:number) =>
    freezeBoxStop({...box,structure:{...box.structure,kSource:'guard',buffer,bufferUnit:'atr'}});
  const [guard, parallelReference] = line.split('+');
  const base = defaultBoxStop(defs);
  const reference = referenceFor(line);
  const regular = selectBoxStopGuardRegime(configure(base,atr),guardRegime(guard));
  const boxSell = isParallelDbl5Sell(line)
    ? selectBoxStopChannels({
        regular:{enabled:true,rule:configure(prior?.boxSell.channels?.regular.rule ?? regular,atr)},
        impulse:{enabled:true,rule:configure(prior?.boxSell.channels?.impulse.rule ??
          selectBoxStopReference(base,parallelReference==='impulse0'?'impulse0':'impulse1115'),impulseAtr ?? atr)},
      })
    : configure(prior?.boxSell ?? (reference ? selectBoxStopReference(base,reference) : regular),atr);
  const version = line === 'sell-dbl5-guard' || line === 'sell-dbl5-impulse' ? DBL5_SELL_VERSION : DBL5_SELL_OR_VERSION;
  const rule: Dbl5SellRule = {version,metric:DBL5_SELL_METRIC,direction:'<',threshold:atr,boxSell};
  const snapshot: FishSnapshot = {featureId:line,featureName:def.name,featureShort:def.short,interval:'1m',
    definitionKey:definitionKey(def),statistic:DBL5_SELL_METRIC,threshold:atr,average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:0,scale:1};
  validateDbl5Sell(snapshot,rule);
  return {rule,snapshot};
}

export function validateDbl5Sell(snapshot: FishSnapshot, rule?: QualityExitRule) {
  if (!isDbl5SellLine(snapshot.featureId) || !isDbl5Sell(rule) || rule.metric !== DBL5_SELL_METRIC ||
    rule.direction !== '<' || !Number.isFinite(rule.threshold) || rule.threshold < 0) throw Error('DBL-5 卖出冗余 ATR 须为非负数');
  const box = rule.boxSell;
  validateBoxStop(box);
  const line = snapshot.featureId;
  const check = (value:BoxStopRule) => value.structure.algorithm === 'dbl5' && value.structure.kSource==='guard' &&
    value.structure.bufferUnit==='atr' && value.confirmation==='touch' && value.update==='raise-only';
  const [guard, parallelReference] = line.split('+');
  const expectedRegime = guardRegime(guard);
  const valid = box.channels
    ? isParallelDbl5Sell(line) && box.channels.regular.enabled && box.channels.impulse.enabled &&
      check(box.channels.regular.rule) && check(box.channels.impulse.rule) &&
      (box.channels.regular.rule.guardRegime ?? 'both')===expectedRegime &&
      box.channels.impulse.rule.reference?.kind===parallelReference
    : !isParallelDbl5Sell(line) && check(box) && box.reference?.kind===referenceFor(line) &&
      (box.guardRegime ?? 'both')===expectedRegime;
  if (!valid || box.structure.buffer !== rule.threshold ||
      (rule.version===DBL5_SELL_VERSION && line!=='sell-dbl5-guard' && line!=='sell-dbl5-impulse'))
    throw Error('DBL-5 卖出线与冻结的执行参数不一致');
}

export function initialDbl5RiskVetoes(plan:Pick<QualityGroup,'rule'|'holdingVetoes'>):QualityHoldingVeto[] {
  const initial = isDbl5Sell(plan.rule) ? [dbl5SellAsBox(plan.rule,'initial-dbl5-seller')] : [];
  return [...initial,...(plan.holdingVetoes ?? []).filter(v=>v.enabled && v.kind==='box-stop' &&
    !v.activation && v.mirrorStage?.stage!=='after' && v.boxStop?.confirmation==='touch' &&
    v.boxStop.structure.algorithm==='dbl5' && (v.boxStop.structure.kSource==='guard' || !!v.boxStop.reference))];
}

export function dbl5SellAsBox(rule: Dbl5SellRule, id: string): QualityHoldingVeto {
  return {id,label:rule.version===DBL5_SELL_OR_VERSION ? boxStopLabel(rule.boxSell) : rule.boxSell.reference ? 'DBL-5 急拉线' : 'DBL-5 防守线',kind:'box-stop',metric:rule.metric,direction:'<=',threshold:0,enabled:true,boxStop:rule.boxSell};
}
