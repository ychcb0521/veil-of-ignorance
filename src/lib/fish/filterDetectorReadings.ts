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
/** Table display only: stored readings and percentile positions retain full precision. */
export function detectorReadingText(r:FilterDetectorReading):string{
  if(Number.isFinite(r.reading))return r.reading!.toFixed(2);
  if(Number.isFinite(r.rawReading))return '原值 '+r.rawReading!.toFixed(2);
  return '未记录';
}
export function percentilePosition(r:FilterDetectorReading):string{
  return Number.isFinite(r.percentile)?r.percentile!.toFixed(2)+'%':'未记录';
}
