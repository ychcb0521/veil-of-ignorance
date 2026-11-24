import {staticDblDistancePct} from './dblDistancePct';
export {staticDblDistancePct} from './dblDistancePct';
import {compileFishProgram,shortFishHash} from './algorithm';
import {dbl5SellAsBox, makeDbl5Sell} from './qualityDbl5Sell';
import {createBoxStopReader, validateBoxStop} from './qualityBoxStop';
import {definitionKey, type DeepDigFeatureDef} from '@/lib/deepDig/features';
import type {FishReconstructionLoader} from './reconstruction';
import type {QualityBuyFilter, QualitySample} from './quality';

export const LEGACY_STATIC_DBL_DISTANCE_VERSION = 'static-dbl5-distance-v1';
export const STATIC_DBL_DISTANCE_VERSION = 'static-dbl5-distance-v2';
export type StaticDblDistanceVersion = typeof LEGACY_STATIC_DBL_DISTANCE_VERSION | typeof STATIC_DBL_DISTANCE_VERSION;
const names = {
  nearest: '距最近 DBL-5 线（%）',
  guard: '距 DBL-5 防守线（%）',
  impulse: '距 DBL-5 急拉线（%）',
} as const;
type DistanceSource = keyof typeof names;
const distanceChoices = (version: StaticDblDistanceVersion) => (Object.keys(names) as DistanceSource[]).map(metric => ({
  key: version + ':' + metric, label: names[metric], group: 'DBL-5 价线距离', featureId: version, metric,
}));
export const staticDblDistanceChoices = distanceChoices(STATIC_DBL_DISTANCE_VERSION);
const allChoices = [...staticDblDistanceChoices, ...distanceChoices(LEGACY_STATIC_DBL_DISTANCE_VERSION)];
export const staticDblDistanceChoice = (key:string) => allChoices.find(choice => choice.key === key);
const price: DeepDigFeatureDef = {id:LEGACY_STATIC_DBL_DISTANCE_VERSION,name:'DBL-5 价线距离',short:'DBL-5 价线距离',
  definition:'',formula:'C',scale:1,unit:'%',positive:'1',control:'0',interval:'5m'};

export function makeStaticDblDistance(choice:NonNullable<ReturnType<typeof staticDblDistanceChoice>>,
    direction:'<'|'>', threshold:number, enabled:boolean, atr:number, previous?:QualityBuyFilter):QualityBuyFilter {
  if (!Number.isFinite(atr) || atr<0 || !Number.isFinite(threshold) || threshold<0) throw Error('DBL-5 距离门槛和冗余 ATR 须为非负数');
  if (previous?.staticDblDistance?.version === choice.featureId && previous.metric === choice.metric &&
      previous.staticDblDistance.atr === atr && previous.direction === direction &&
      previous.threshold === threshold && previous.enabled === enabled) return previous;
  const lines = choice.metric==='guard' ? ['sell-dbl5-guard'] as const :
    choice.metric==='impulse' ? ['sell-dbl5-impulse'] as const : ['sell-dbl5-guard','sell-dbl5-impulse'] as const;
  const rules = lines.map((line,i)=>makeDbl5Sell(line,atr,[],previous?.staticDblDistance?.rules[i]).rule);
  const definition = definitionKey(price);
  return {id:'buy-'+shortFishHash(JSON.stringify([choice.key,direction,threshold,rules])), label:choice.label,
    metric:choice.metric,direction,threshold,enabled,staticDblDistance:{version:choice.featureId,atr,rules},
    snapshot:{featureId:choice.featureId,featureShort:price.short,featureName:price.name,definitionKey:definition,
      statistic:choice.metric,interval:'5m',scale:1,unit:'%',threshold,direction,cutoffMs:0,
      average:0,cbi2:0,startAverage:0,previousAverage:0}};
}

export async function readStaticDblDistance(sample:QualitySample, filter:QualityBuyFilter, load:FishReconstructionLoader, signal:AbortSignal) {
  const config=filter.staticDblDistance;
  if (!config || config.version !== filter.snapshot.featureId || !staticDblDistanceChoice(config.version+':'+filter.metric) ||
      config.rules.length !== (filter.metric==='nearest'?2:1)) throw Error('DBL-5 距离配置无效');
  for (const [index, rule] of config.rules.entries()) {
    validateBoxStop(rule.boxSell);
    const impulse=filter.metric==='impulse'||index===1;
    if (rule.boxSell.reference?.kind !== (impulse?'impulse1115':undefined) ||
        rule.boxSell.structure.algorithm!=='dbl5' || rule.boxSell.structure.kSource!=='guard' ||
        rule.boxSell.structure.bufferUnit!=='atr' || rule.boxSell.structure.buffer!==config.atr)
      throw Error('DBL-5 价线和冗余 ATR 与冻结参数不符');
  }
  const step=300000, cut=Math.floor(sample.enteredAt!/step)*step;
  const plan=compileFishProgram(price,{statistic:'结果',direction:'>',threshold:0,constraints:[]});
  const [bar]=await load(sample.source,cut-step,cut,plan,signal);
  if (config.version === STATIC_DBL_DISTANCE_VERSION && bar?.DBL5_closed === false) throw Error('买入前的 5 分钟 K 线尚未收盘');
  if (bar?.openTime!==cut-step || !Number.isFinite(bar.close) || bar.close<=0) throw Error('缺少买入前已收盘的 5 分钟价格');
  const reader=createBoxStopReader({vetoes:config.rules.map((rule,i)=>dbl5SellAsBox(rule,'static-distance-'+i)),
    row:sample.source,entry:cut,since:cut,load,signal});
  const observation = {...bar,openTime:cut,open:bar.close,high:bar.close,low:bar.close};
  if (config.version === STATIC_DBL_DISTANCE_VERSION) {
    const distances: number[] = [];
    await reader.read(observation, {onRawReference: (line, atr) => {
      distances.push(staticDblDistancePct(bar.close, line, atr, config.atr));
    }});
    if (!distances.length) throw Error('买入前没有已确认的 DBL-5 价线');
    const value = Math.min(...distances);
    if (!Number.isFinite(value)) throw Error('DBL-5 距离无有效读数');
    return {at:cut, value};
  }
  await reader.read(observation);
  const lines=reader.latestLines();
  if (!lines.length) throw Error('买入前没有已确认的 DBL-5 价线');
  const value=Math.min(...lines.map(line=>Math.abs(bar.close-line)/bar.close*100));
  return {at:cut,value};
}
