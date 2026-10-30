import {useCallback,useEffect,useRef,useState} from 'react';
import type {QualityRunner} from './useFishQuality';
import {qualityComparisonRows,qualityFilterStatus,type FishQualityStudy,type QualityProgress} from '@/lib/fish/quality';
import {qualityResultMap,qualityRowResult} from '@/lib/fish/qualityComparison';
import {qualityEntryKey,qualityEntryParts,validEntryReading,mergeQualityEntryReading,type QualityEntryTarget} from '@/lib/fish/qualityEntry';
/** Account-isolated observation queue; shares the existing scanner/request pool, never the monitor controller. */
export function useQualityEntryReadings(owner:string|undefined,ready:boolean,study:FishQualityStudy,run:QualityRunner,change:(apply:(s:FishQualityStudy)=>FishQualityStudy)=>void){
 const latest=useRef({owner,ready,study,run});latest.current={owner,ready,study,run};
 const controller=useRef<AbortController|null>(null),epoch=useRef(0),queue=useRef(new Map<string,QualityEntryTarget>()),active=useRef(new Set<string>()),paused=useRef(false);
 const[status,setStatus]=useState<{owner?:string;running:boolean;progress:QualityProgress|null;error:string}>({owner,running:false,progress:null,error:''});
 useEffect(()=>{epoch.current++;controller.current?.abort();controller.current=null;queue.current.clear();active.current.clear();paused.current=false;setStatus({owner,running:false,progress:null,error:''});return()=>{epoch.current++;controller.current?.abort();controller.current=null;queue.current.clear();active.current.clear();};},[owner]);
 const drain=useCallback(async()=>{
  if(controller.current||!queue.current.size)return;
  const generation=epoch.current,account=latest.current.owner,aborter=new AbortController();controller.current=aborter;
  const valid=()=>generation===epoch.current&&account===latest.current.owner&&!aborter.signal.aborted;
  setStatus({owner:account,running:true,progress:null,error:''});
  try{while(queue.current.size&&valid()){
   const targets=[...queue.current.values()];queue.current.clear();
   await latest.current.run({task:'entry',study:latest.current.study,entryTargets:targets,signal:aborter.signal,onResult:()=>{},onProgress:progress=>{if(valid())setStatus(s=>({...s,progress}));},onEntryReading:reading=>{if(!valid())return;change(s=>{const old=s.entryReadings??[];return {...s,entryReadings:[...old.filter(r=>r.key!==reading.key),mergeQualityEntryReading(old.find(r=>r.key===reading.key),reading)]};});}});
   for(const t of targets){const k=qualityEntryKey(t.source,t.result,t.plan,t.part);if(k)active.current.delete(k);}
  }}catch(error){if(valid())setStatus(s=>({...s,error:error instanceof Error?error.message:'入场读数补算失败'}));}
  finally{if(controller.current===aborter){controller.current=null;active.current.clear();if(generation===epoch.current)setStatus(s=>({...s,running:false}));}}
 },[change]);
 const request=useCallback((planIds:readonly string[],sampleIds:readonly string[],retry=false)=>{
  const current=latest.current;if(!current.ready||paused.current&&!retry)return;if(retry)paused.current=false;
  const plans=(current.study.sellPlans??[]).filter(p=>planIds.includes(p.id)),ids=new Set(sampleIds),results=qualityResultMap(current.study),cache=new Map((current.study.entryReadings??[]).map(r=>[r.key,r]));
  for(const row of qualityComparisonRows(current.study)){if(!ids.has(row.id)&&!ids.has(row.signalId??row.id))continue;
   for(const plan of plans){if(!['none','pass'].includes(qualityFilterStatus(current.study,row,plan).state))continue;const result=qualityRowResult(current.study,row,plan,results);
    for(const part of qualityEntryParts(plan)){const key=qualityEntryKey(row.source,result,plan,part),old=key?cache.get(key):undefined;
     if(!key||active.current.has(key)||validEntryReading(old)||old?.error&&!retry&&Date.now()-old.evaluatedAt<300000)continue;
     active.current.add(key);queue.current.set(key,{source:row.source,result:result!,plan,part});
    }
   }
  }void drain();
 },[drain]);
 const cancel=useCallback(()=>{paused.current=true;queue.current.clear();controller.current?.abort();},[]);
 return {...(status.owner===owner?status:{owner,running:false,progress:null,error:''}),request,cancel};
}
