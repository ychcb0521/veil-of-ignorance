import type { TradeSignal } from '@/lib/signalLibrary';
import { signalDedupKey } from '@/lib/signalLibrary';
import { CBI2_DEF, definitionKey } from '@/lib/deepDig/features';
import { constraintFingerprint, fishAlgorithmKey } from './algorithm';
/** Migrate deterministically; never let normal signal-library dedup collapse different algorithms. */
export function migrateFishSignal(s: TradeSignal): TradeSignal {
  const r=s.fish;
  const texts=r?.constraints??[],H=r?.H??24,direction=r?.direction??'>',threshold=r?.threshold??0.3,featureId=r?.featureId??'cbi2';
  const constraintKey=constraintFingerprint(texts),algorithmKey=fishAlgorithmKey(featureId,H,direction,threshold,constraintKey);
  const fish={...r,average:r?.average??NaN,cbi2:r?.cbi2??r?.value??NaN,startAverage:r?.startAverage??NaN,previousAverage:r?.previousAverage??NaN,cutoffMs:r?.cutoffMs??s.timeMs,
    featureId,featureName:r?.featureName??CBI2_DEF.name,featureShort:r?.featureShort??CBI2_DEF.short,definitionKey:r?.definitionKey??definitionKey(CBI2_DEF),interval:r?.interval??'5m',H,direction,threshold,thresholdRaw:r?.thresholdRaw??threshold/(r?.scale??1),scale:r?.scale??1,unit:r?.unit??CBI2_DEF.unit,constraints:texts,constraintKey,algorithmKey,value:r?.value??r?.cbi2??NaN,startConstraints:r?.startConstraints??[],cutoffConstraints:r?.cutoffConstraints??[]};
  const venue=s.exchange&&s.exchange!=='binance'?`${s.exchange}-`:'';
  return {...s,id:`fish-${venue}${s.symbol}-${s.timeMs}-${encodeURIComponent(algorithmKey)}`,fish};
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
export const fishAlgorithmShort=(s:TradeSignal)=>s.fish?.featureShort??'CBI-2';
