import {qualityGroupId,qualityMembers} from './quality';
import {capturedReading} from './libraryConditions';
import {fishMetricLabel} from './records';
import type {QualityFilterRecord} from './qualityFilterLibrary';

export interface FilterDetectorReading {
  metric:string;
  reading?:number;
  rawReading?:number;
  percentile?:number;
  sampleCount?:number;
}
type SavedReading=FilterDetectorReading & {family?:string;population?:number};
export interface FilterSourceSelection {
  family?:string;
  percentile?:number;
  readings?:SavedReading[];
  hits?:FilterSourceSelection[];
}
export function filterDetectorReadings(record:Pick<QualityFilterRecord,'sourceSelection'|'sample'>):FilterDetectorReading[]{
  const saved=record.sourceSelection;
  if(saved){
    return (saved.hits??[saved]).flatMap(hit=>(hit.readings??[]).map(r=>{
      const family=r.family??hit.family;
      const metric=[family,r.metric].filter(Boolean).join(' · ');
      const position=r.percentile??(hit.readings?.length===1?hit.percentile:undefined);
      return {metric,reading:Number.isFinite(r.reading)?r.reading:undefined,
        rawReading:Number.isFinite(r.rawReading)?r.rawReading:undefined,
        percentile:Number.isFinite(position)&&position!>=0&&position!<=100?position:undefined,
        sampleCount:r.sampleCount??r.population};
    }));
  }
  const sample=record.sample;
  return (sample?.groups??[]).flatMap(id=>{
    const snapshot=sample?.readings?.[id]??qualityMembers(sample!.source).find(member=>qualityGroupId(member)===id);
    if(!snapshot)return [];
    const {reading,rawReading}=capturedReading(snapshot);
    return [{metric:fishMetricLabel(snapshot),reading,rawReading}];
  });
}
export function percentilePosition(r:FilterDetectorReading):string{
  if(r.percentile===undefined)return '未记录';
  const percent=r.percentile+'%';
  const count=r.sampleCount;
  if(!count||!Number.isSafeInteger(count)||count<1)return percent;
  const rank=Math.round(r.percentile*count/100);
  return Math.abs(100*rank/count-r.percentile)<1e-9 ? percent+'（'+rank+'/'+count+'）' : percent;
}
