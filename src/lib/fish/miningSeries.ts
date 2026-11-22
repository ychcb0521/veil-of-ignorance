import type {FishSnapshot} from './algorithm';
import {savedFishMetric} from './records';

export const miningSeriesTypes = [
  {id:'raw',label:'原值'}, {id:'avg',label:'avg'}, {id:'avg-2',label:'avg-2'},
] as const;
/** Classify the frozen selected metric, never the current editable formula. */
export function miningSeries(snapshot:Partial<FishSnapshot>) {
  const metric=savedFishMetric(snapshot);
  const key=snapshot.algorithmKey?.split('|');
  const hours=snapshot.H??(key?.length===6&&key[2]!=='='?Number(key[2]):undefined);
  if(hours!==undefined&&Number.isFinite(hours)&&hours>0)
    return {id:'legacy:'+JSON.stringify([metric,hours]),label:`旧版均值（${metric??'序列未记录'}，${hours}h）`};
  if(!metric)return {id:'unknown',label:'序列未记录'};
  const average=/^avg_(.+?)(?:_(\d+))?$/.exec(metric);
  if(!average)return miningSeriesTypes[0];
  if(!average[2])return miningSeriesTypes[1];
  if(average[2]==='2')return miningSeriesTypes[2];
  return {id:'avg-'+average[2],label:'avg-'+average[2]};
}
export const miningSeriesDirectoryId=(parent:string,series:string)=>parent+'/series/'+encodeURIComponent(series);
