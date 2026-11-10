import {normalizeSignalQuality,signalDedupKey,type TradeSignal} from '../signalLibrary';
import type {FishQualityStudy} from './quality';

/** User annotations, independent of frozen plans, original market evidence and
 * historical archive bodies. Null is an explicit removal, not a missing value. */
export type QualitySourceRatings=Record<string,{quality:number|null;updatedAt:number}>;
export function setMatchingSourceQuality(list:TradeSignal[],source:TradeSignal,quality:number|undefined):TradeSignal[]{
  const key=signalDedupKey(source);let changed=false;
  const next=list.map(item=>{
    if(signalDedupKey(item)!==key||normalizeSignalQuality(item.quality)===quality)return item;
    changed=true;const {quality:_old,...rest}=item;return quality===undefined?rest:{...rest,quality};
  });
  return changed?next:list;
}
export function applyQualitySourceRatings(study:FishQualityStudy):FishQualityStudy{
  if(!study.sourceRatings)return study;
  const samples=study.samples.map(sample=>{
    const rating=study.sourceRatings![signalDedupKey(sample.source)];
    if(!rating||!Number.isFinite(rating.updatedAt)||rating.updatedAt<=0)return sample;
    const quality=rating.quality===null?undefined:normalizeSignalQuality(rating.quality);
    if(normalizeSignalQuality(sample.source.quality)===quality)return sample;
    const {quality:_old,...source}=sample.source;
    return {...sample,source:quality===undefined?source:{...source,quality}};
  });
  return samples.every((sample,i)=>sample===study.samples[i])?study:{...study,samples};
}
export function preserveQualitySourceRatings(previous:FishQualityStudy|undefined,incoming:FishQualityStudy):FishQualityStudy{
  let ratings=incoming.sourceRatings;
  for(const [key,value]of Object.entries(previous?.sourceRatings??{})){
    if(!Number.isFinite(value.updatedAt)||value.updatedAt<=0)continue;
    if(!ratings?.[key]||value.updatedAt>ratings[key].updatedAt)ratings={...ratings,[key]:value};
  }
  return applyQualitySourceRatings(ratings===incoming.sourceRatings?incoming:{...incoming,sourceRatings:ratings});
}
export function rateQualitySource(study:FishQualityStudy,source:TradeSignal,quality:number|undefined,now=Date.now()):FishQualityStudy{
  if(quality!==undefined&&(normalizeSignalQuality(quality)!==quality))throw Error('评分须为 1～5 星');
  const key=signalDedupKey(source),updatedAt=Math.max(now,(study.sourceRatings?.[key]?.updatedAt??0)+1);
  return applyQualitySourceRatings({...study,sourceRatings:{...study.sourceRatings,[key]:{quality:quality??null,updatedAt}}});
}
