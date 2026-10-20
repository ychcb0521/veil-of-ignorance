import type { TradeSignal } from '@/lib/signalLibrary';
import { stockCode } from '@/lib/signalMarket';
import { signalDedupKey } from '@/lib/signalLibrary';
import { CBI2_DEF, definitionKey } from '@/lib/deepDig/features';
import { constraintFingerprint, fishAlgorithmKey } from './algorithm';
/** Migrate deterministically; never let normal signal-library dedup collapse different algorithms. */
export function migrateFishSignal(s: TradeSignal): TradeSignal {
  const r=s.fish;
  if(r?.algorithms?.length)return s;
  // 旧记录（外层 avg）有 H；最早的记录连算法键都没有，当时固定是 avg 24h。现在的记录没有 H。
  const texts=r?.constraints??[],H=r?.H??(r?.algorithmKey?undefined:24),direction=r?.direction??'>',threshold=r?.threshold??0.3,featureId=r?.featureId??'cbi2';
  const statistic=r?.statistic??'结果',constraintKey=constraintFingerprint(texts),algorithmKey=fishAlgorithmKey(featureId,H,direction,threshold,constraintKey,statistic);
  const fish={...r,average:r?.average??NaN,cbi2:r?.cbi2??r?.value??NaN,startAverage:r?.startAverage??NaN,previousAverage:r?.previousAverage??NaN,cutoffMs:r?.cutoffMs??s.timeMs,
    statistic,featureId,featureName:r?.featureName??CBI2_DEF.name,featureShort:r?.featureShort??CBI2_DEF.short,definitionKey:r?.definitionKey??definitionKey(CBI2_DEF),interval:r?.interval??'5m',H,direction,threshold,thresholdRaw:r?.thresholdRaw??threshold/(r?.scale??1),scale:r?.scale??1,unit:r?.unit??CBI2_DEF.unit,constraints:texts,constraintKey,algorithmKey,value:r?.value??r?.cbi2??NaN,startConstraints:r?.startConstraints??[],cutoffConstraints:r?.cutoffConstraints??[]};
  const venue=s.exchange&&s.exchange!=='binance'?`${s.exchange}-`:'';
  return {...s,...(s.market==='us_stock'?{underlying:stockCode(s),exchange:s.exchange??'binance'}:{}),id:`fish-${s.market==='us_stock'?`us-${s.exchange??'binance'}-${stockCode(s)}`:`${venue}${s.symbol}`}-${s.timeMs}-${encodeURIComponent(algorithmKey)}`,fish};
}
export const fishDedupKey=(s:TradeSignal)=>`${signalDedupKey(s)}|${migrateFishSignal(s).fish!.algorithmKey}`;
export function mergeFishSignals(existing: readonly TradeSignal[],incoming: readonly TradeSignal[]): TradeSignal[] {
  const map=new Map<string,TradeSignal>();
  for(const raw of [...existing,...incoming]){
    const s=migrateFishSignal(raw),key=fishDedupKey(s),previous=map.get(key);
    map.set(key,previous?{...previous,...s,quality:previous.quality??s.quality,freshCatch:previous.freshCatch||s.freshCatch||undefined}:s);
  }
  return [...map.values()];
}
/** 算法简称：交集「A ∩ B」，并集「A ∪ B」（并集另记命中的是哪几个，见快照 hitAlgorithms）。 */
export const fishAlgorithmShort=(s:TradeSignal)=>s.fish?.algorithms?.length?s.fish.algorithms.map(a=>a.featureShort??a.featureName).join(s.fish.combination==='or'?' ∪ ':' ∩ '):`${s.fish?.featureShort??'CBI-2'}${s.fish?.statistic&&s.fish.statistic!=='结果'?` [${s.fish.statistic}]`:''}`;

/**
 * 「算法类型」：这条鱼实际是哪个（些）算法捕到的。单算法 = 它自己；交集 = 每个算法；并集 = 命中的那几个。
 * 【用户要求】2026-10-20「把具体是哪个算法捕捞到的（如果是多个，就把多个都写上去），专门开设一列（命名为：算法类型）」。
 */
export function fishCaughtBy(s: TradeSignal): string[] {
  const r = s.fish;
  if (!r) return ['CBI-2'];
  const name = (a: { featureShort?: string; featureName?: string } | undefined) => a?.featureShort || a?.featureName || '—';
  if (r.algorithms?.length) {
    const picked = r.combination === 'or' ? (r.hitAlgorithms ?? []).map(i => r.algorithms![i - 1]) : r.algorithms;
    return [...new Set(picked.filter(Boolean).map(name))];
  }
  return [r.featureShort ?? 'CBI-2'];
}
