import {compileFishProgram,shortFishHash} from './algorithm';
import {dbl5SellAsBox, makeDbl5Sell} from './qualityDbl5Sell';
import {createBoxStopReader, validateBoxStop} from './qualityBoxStop';
import {definitionKey, type DeepDigFeatureDef} from '@/lib/deepDig/features';
import type {FishReconstructionLoader} from './reconstruction';
import type {QualityBuyFilter, QualitySample} from './quality';

export const STATIC_DBL_DISTANCE_VERSION = 'static-dbl5-distance-v1' as const;
const names = {
  nearest: '距最近 DBL-5 线（%）',
  guard: '距 DBL-5 防守线（%）',
  impulse: '距 DBL-5 急拉线（%）',
} as const;
type DistanceSource = keyof typeof names;
export const staticDblDistanceChoices = (Object.keys(names) as DistanceSource[]).map(metric=>({
  key:STATIC_DBL_DISTANCE_VERSION+':'+metric, label:names[metric], group:'DBL-5 价线距离', featureId:STATIC_DBL_DISTANCE_VERSION, metric,
}));
export const staticDblDistanceChoice = (key:string) => staticDblDistanceChoices.find(choice=>choice.key===key);
const price: DeepDigFeatureDef = {id:STATIC_DBL_DISTANCE_VERSION,name:'DBL-5 价线距离',short:'DBL-5 价线距离',
  definition:'',formula:'C',scale:1,unit:'%',positive:'1',control:'0',interval:'5m'};

export function makeStaticDblDistance(choice:NonNullable<ReturnType<typeof staticDblDistanceChoice>>,
    direction:'<'|'>', threshold:number, enabled:boolean, atr:number, previous?:QualityBuyFilter):QualityBuyFilter {
  if (!Number.isFinite(atr) || atr<0 || !Number.isFinite(threshold) || threshold<0) throw Error('DBL-5 距离门槛和冗余 ATR 须为非负数');
  const lines = choice.metric==='guard' ? ['sell-dbl5-guard'] as const :
    choice.metric==='impulse' ? ['sell-dbl5-impulse'] as const : ['sell-dbl5-guard','sell-dbl5-impulse'] as const;
  const rules = lines.map((line,i)=>makeDbl5Sell(line,atr,[],previous?.staticDblDistance?.rules[i]).rule);
  const definition = definitionKey(price);
  return {id:'buy-'+shortFishHash(JSON.stringify([choice.key,direction,threshold,rules])), label:choice.label,
    metric:choice.metric,direction,threshold,enabled,staticDblDistance:{version:STATIC_DBL_DISTANCE_VERSION,atr,rules},
    snapshot:{featureId:price.id,featureShort:price.short,featureName:price.name,definitionKey:definition,
      statistic:choice.metric,interval:'5m',scale:1,unit:'%',threshold,direction,cutoffMs:0,
      average:0,cbi2:0,startAverage:0,previousAverage:0}};
}

export async function readStaticDblDistance(sample:QualitySample, filter:QualityBuyFilter, load:FishReconstructionLoader, signal:AbortSignal) {
  const config=filter.staticDblDistance;
  if (config?.version!==STATIC_DBL_DISTANCE_VERSION || !staticDblDistanceChoice(STATIC_DBL_DISTANCE_VERSION+':'+filter.metric) ||
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
  if (bar?.openTime!==cut-step || !Number.isFinite(bar.close) || bar.close<=0) throw Error('缺少买入前已收盘的 5 分钟价格');
  const reader=createBoxStopReader({vetoes:config.rules.map((rule,i)=>dbl5SellAsBox(rule,'static-distance-'+i)),
    row:sample.source,entry:cut,since:cut,load,signal});
  await reader.read({...bar,openTime:cut,open:bar.close,high:bar.close,low:bar.close});
  const lines=reader.latestLines();
  if (!lines.length) throw Error('买入前没有已确认的 DBL-5 价线');
  const value=Math.min(...lines.map(line=>Math.abs(bar.close-line)/bar.close*100));
  return {at:cut,value};
}
