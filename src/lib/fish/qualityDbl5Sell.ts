import {definitionKey, type DeepDigFeatureDef} from '@/lib/deepDig/features';
import type {FishSnapshot} from './algorithm';
import type {QualityExitRule} from './quality';
import {defaultBoxStop, freezeBoxStop, selectBoxStopReference, validateBoxStop, type BoxStopRule} from './qualityBoxStop';
import type {QualityHoldingVeto} from './qualityVeto';

export const DBL5_SELL_VERSION = 'sell-dbl5-line-v1' as const;
export const DBL5_SELL_LINES = {'sell-dbl5-guard':'DBL-5 防守线','sell-dbl5-impulse':'DBL-5 急拉线'} as const;
export type Dbl5SellLine = keyof typeof DBL5_SELL_LINES;
export const DBL5_SELL_METRIC = 'line' as const;
export type Dbl5SellRule = QualityExitRule & {version: typeof DBL5_SELL_VERSION; boxSell: BoxStopRule};
export const isDbl5Sell = (rule?: QualityExitRule): rule is Dbl5SellRule => rule?.version === DBL5_SELL_VERSION;
export const isDbl5SellLine = (id?: string): id is Dbl5SellLine => !!id && Object.prototype.hasOwnProperty.call(DBL5_SELL_LINES,id);
export const dbl5SellChoice = (id: Dbl5SellLine) => id + ':' + DBL5_SELL_METRIC;
export const dbl5SellChoiceLine = (choice: string) => {
  const [id] = choice.split(':');
  return isDbl5SellLine(id) && choice === dbl5SellChoice(id) ? id : undefined;
};
export function makeDbl5Sell(line: Dbl5SellLine, atr: number, defs: readonly DeepDigFeatureDef[], prior?: Dbl5SellRule) {
  const def: DeepDigFeatureDef = {id:line,name:DBL5_SELL_LINES[line],short:DBL5_SELL_LINES[line],
    definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'1m'};
  const box = prior?.boxSell ?? (line === 'sell-dbl5-impulse'
    ? selectBoxStopReference(defaultBoxStop(defs),'impulse1115') : defaultBoxStop(defs));
  const boxSell = freezeBoxStop({...box,structure:{...box.structure,kSource:'guard',buffer:atr,bufferUnit:'atr'}});
  const rule: Dbl5SellRule = {version:DBL5_SELL_VERSION,metric:DBL5_SELL_METRIC,direction:'<',threshold:atr,boxSell};
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
  if (box.structure.algorithm !== 'dbl5' || box.structure.kSource !== 'guard' ||
      box.structure.buffer !== rule.threshold || box.structure.bufferUnit !== 'atr' || box.confirmation !== 'touch' ||
      box.update !== 'raise-only' || (snapshot.featureId === 'sell-dbl5-impulse' ? box.reference?.kind !== 'impulse1115' : !!box.reference))
    throw Error('DBL-5 卖出线与冻结的执行参数不一致');
}

export function dbl5SellAsBox(rule: Dbl5SellRule, id: string): QualityHoldingVeto {
  return {id,label:DBL5_SELL_LINES[rule.boxSell.reference ? 'sell-dbl5-impulse' : 'sell-dbl5-guard'],kind:'box-stop',metric:rule.metric,direction:'<=',threshold:0,enabled:true,boxStop:rule.boxSell};
}
