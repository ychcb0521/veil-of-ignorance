import {isDelayedTuringReplaySample} from '@/lib/turingReplaySamples';
import {serializeAccountBlob} from '@/lib/accountBlobCodec';
import {activeBuyFilters, activeStandaloneBuyFilters, newQualityStudy, qualityComparisonRows, qualityDisplayRows, qualityEntryIdentity, qualityFilterReadingKey, qualityFilterStatus, type FishQualityStudy, type QualityBuyFilter, type QualityFilterStatus, type QualityGroup, type QualityResult, type QualitySample} from './quality';
import {qualityResultMap, qualityRowResult} from './qualityComparison';
import {qualityScreeningResults, screeningResultIndex, screeningRowResults, type QualityScreeningResult} from './qualityScreeningResults';
import {activeSignalMetrics, signalReadingKey, type QualitySignalMetric} from './qualitySignalReadings';
import {qualityPostExitKey, type QualityPostExitReading} from './qualityPostExit';
import {qualityRowMonitorTimeBasis,qualitySignalTime} from './qualityAdmissionTime';

interface TemplateSourceRow {
  samples:readonly QualitySample[];
  detector?:QualityGroup;
}
export interface QualityTemplateTable {
  study: FishQualityStudy;
  rows: QualitySample[];
  results: Map<string, Map<string, QualityResult>>;
  filterStatus: Map<string, Map<string, QualityFilterStatus>>;
  screening: Map<string, QualityScreeningResult[]>;
  postExit: Map<string, Map<string, QualityPostExitReading>>;
  importRows?:Map<string,TemplateSourceRow>;
}

const savedCampaignPaths = new WeakMap<QualityResult, string>();
export const setTemplateCampaignPath = (result: QualityResult, path: string) => savedCampaignPaths.set(result, path);
export const templateCampaignPath = (result: QualityResult) => savedCampaignPaths.get(result);
const signature = (value: unknown) => serializeAccountBlob(value);
const withoutId = <T extends {id: string}>({id: _id, ...value}: T) => value;
const resultEvidence = ({key:_key,sampleId:_sampleId,groupId:_groupId,evaluatedAt:_evaluatedAt,...value}:QualityResult) => value;
const withoutKey = <T extends {key: string}>({key: _key, ...value}: T) => value;

/** A disposable view. Keep separate rows for differing saved evidence and never rewrite a campaign key. */
export function createQualityTemplateTable(importSelection=false) {
  const study: FishQualityStudy = {...newQualityStudy(0), independentFilters:true, sellPlans:[], buyFilters:[], filterReadings:[], signalMetrics:[], signalReadings:[], selectedRowIds:[], monitorTimeBasisByRow:{}};
  const table: QualityTemplateTable = {study, rows:[], results:new Map(), filterStatus:new Map(), screening:new Map(), postExit:new Map()};
  if(importSelection)table.importRows=new Map();
  const keys = new Set<string>(), detectors = new Map<string, QualityGroup>(), columns = new Map<string, QualityGroup>();
  const conditions = new Map<string, QualityBuyFilter>(), metrics = new Map<string, QualitySignalMetric>();
  const column = <T extends {id:string}>(items: Map<string,T>, prefix:string, value:T, body:unknown=withoutId(value)):T => {
    const key=signature(body), old=items.get(key);
    if(old) return old;
    const next={...value,id:'template-'+prefix+'-'+items.size};
    items.set(key,next);
    return next;
  };

  const append=(input:FishQualityStudy, campaignPath?:(result:QualityResult)=>string|undefined)=>{
    const screeningOnly=!!input.screeningResults&&!input.results.length&&!input.sellPlans?.length;
    const displayRows=screeningOnly?input.samples.map(sample=>qualityComparisonRows({samples:[sample]})[0]):qualityComparisonRows(input);
    if(!displayRows.length) return;
    const originalRows=importSelection?new Map<string,QualitySample[]>():undefined;
    const originalKey=(sample:QualitySample)=>JSON.stringify([
      qualityEntryIdentity(sample.source,sample.enteredAt),screeningOnly?sample.source.preEntryMonitor?.recordId:undefined,
    ]);
    if(originalRows)for(const sample of input.samples){
      const key=originalKey(sample), matches=originalRows.get(key);
      if(matches)matches.push(sample);else originalRows.set(key,[sample]);
    }
    const savedResults=qualityResultMap(input), byResult=new Map<string,QualityResult | null>();
    for (const result of input.results) {
      const key=JSON.stringify([result.sampleId,result.groupId]);
      if (!byResult.has(key)) byResult.set(key,result);
      else if (byResult.get(key)?.key !== result.key) byResult.set(key,null);
    }
    const savedFilters=new Map(input.filterReadings?.map(r=>[r.key,r])), savedSignals=new Map(input.signalReadings?.map(r=>[r.key,r]));
    const savedPostExit=new Map(input.postExitReadings?.map(r=>[r.key,r]));
    const savedScreening=qualityScreeningResults(input,undefined,true);
    const screeningIndex=screeningResultIndex(savedScreening);
    const screeningById=new Map(savedScreening.map(item=>[item.record.id,item]));
    if(input.screeningResults) study.screeningResults ??= [];
    const detectorMap=new Map(input.groups.map(group=>[group.id,group]));
    const plans=(input.sellPlans??input.groups.filter(g=>!!g.rule)).map(plan=>[plan,column(columns,'plan',plan,{...withoutId(plan),buyFilters:plan.buyFilters?.map(withoutId)})] as const);
    const buyFilters=[...activeStandaloneBuyFilters(input),...plans.flatMap(([p])=>activeBuyFilters(input,p))];
    const filters=[...new Set(buyFilters)].map(f=>[f,column(conditions,'filter',f)] as const);
    const readings=activeSignalMetrics(input).map(m=>[m,column(metrics,'metric',m)] as const);
    for(const row of displayRows){
      const sources=row.groups.flatMap(id=>{const group=detectorMap.get(id);return group?[[id,column(detectors,'detector',group)] as const]:[];});
      const basis=qualityRowMonitorTimeBasis(input,row);
      const sell=plans.map(([original,plan])=>{
        const result=qualityRowResult(input,row,original,savedResults) ?? byResult.get(JSON.stringify([row.id,original.id])) ?? undefined;
        const path=result&&(templateCampaignPath(result)??campaignPath?.(result));
        const status=activeBuyFilters(input,original).length?qualityFilterStatus(input,row,original,savedFilters):undefined;
        const exitKey=qualityPostExitKey(row.source,result,original);
        return {plan,result,path,status,exit:exitKey?savedPostExit.get(exitKey):undefined};
      });
      const filtered=filters.map(([original,f])=>[f,savedFilters.get(qualityFilterReadingKey(row,original))] as const);
      const signal=readings.map(([original,m])=>[m,savedSignals.get(signalReadingKey(row,original))] as const);
      const matched=row.source.preEntryMonitor?.recordId;
      const exactMatch=matched?screeningById.get(matched):undefined;
      const screened=exactMatch?[exactMatch]:screeningRowResults(row,screeningIndex);
      const key=signature([qualityEntryIdentity(row.source,row.enteredAt),row.basis,basis,row.source.quality,qualitySignalTime(row.source),row.minedAt,row.monitorEntry?.at,row.monitorEntry?.error,
        row.origins,row.readings,sources.map(([,group])=>group.id),row.source.preEntryMonitor?.matchedAt,
        filtered.map(([f,r])=>[f.id,r&&withoutKey(r)]),signal.map(([m,r])=>[m.id,r&&withoutKey(r)]),
        sell.map(({plan,result,path,status,exit})=>[plan.id,result&&resultEvidence(result),path??result?.key,status,exit&&withoutKey(exit)]),
        screened.map(({record,round})=>{
          const {id:_id,roundId:_round,sample:_sample,updatedAt:_updated,tableClearedAt:_cleared,...evidence}=record;
          return [round.engine,round.hours,round.plans,round.filters,round.instantTrading,round.instantMonitor,evidence];
        })]);
      if(keys.has(key)) continue;
      keys.add(key);
      const id='template-row-'+study.samples.length;
      const base={...row,id,signalId:undefined,groups:sources.map(([,g])=>g.id),
        readings:Object.fromEntries(sources.flatMap(([old,g])=>row.readings?.[old]?[[g.id,row.readings[old]]]:[]))};
      if(basis) study.monitorTimeBasisByRow![id]=basis;
      study.samples.push(base);
      for(const {plan,result,path,status,exit} of sell){
        if(result){
          const value=path?{...result}:result;
          if(path) setTemplateCampaignPath(value,path);
          study.results.push(value);
          const cell=table.results.get(id)??new Map<string,QualityResult>();cell.set(plan.id,value);table.results.set(id,cell);
        }
        if(status){const cell=table.filterStatus.get(plan.id)??new Map<string,QualityFilterStatus>();cell.set(id,status);table.filterStatus.set(plan.id,cell);}
        if(exit){const cell=table.postExit.get(id)??new Map<string,QualityPostExitReading>();cell.set(plan.id,exit);table.postExit.set(id,cell);}
      }
      for(const [f,r] of filtered) if(r) study.filterReadings!.push({...r,key:qualityFilterReadingKey(base,f)});
      for(const [m,r] of signal) if(r) study.signalReadings!.push({...r,key:signalReadingKey(base,m,id)});
      if(screened.length) table.screening.set(id,screened);
      for(const detectorId of base.groups.length?base.groups:[undefined]){
        const expanded={...base,signalId:id,id:id+'/detector/'+(detectorId??'none'),detectorId,groups:detectorId?[detectorId]:[]};
        table.rows.push(expanded);study.selectedRowIds!.push(expanded.id);
        if(originalRows&&table.importRows){
          const originals=originalRows.get(originalKey(row))??[];
          const originalDetector=sources.find(([,group])=>group.id===detectorId)?.[0];
          table.importRows.set(expanded.id,{samples:originals,detector:originalDetector?detectorMap.get(originalDetector):undefined});
        }
      }
    }
  };
  return {append,finish(){
    study.groups=[...detectors.values()];
    study.sellPlans=[...columns.values()];
    study.buyFilters=[...conditions.values()];
    study.signalMetrics=[...metrics.values()];
    return table;
  }};
}

/** Batch import copies original inputs only. View IDs, settings, and archived results stay in the library. */
export function qualityTemplateImportSelection(table:QualityTemplateTable,ids:readonly string[]) {
  const groups=new Map<string,QualityGroup>(), samples=new Map<string,{original:QualitySample;groups:Set<string>}>();
  for(const id of ids){
    const entry=table.importRows?.get(id);
    if(!entry)continue;
    for(const sample of entry.samples){
      if(isDelayedTuringReplaySample(sample.source))continue;
      const detector=entry.detector;
      if(detector&&!sample.groups.includes(detector.id)||!detector&&sample.groups.length)continue;
      const key=JSON.stringify([sample.id,qualityEntryIdentity(sample.source,sample.enteredAt)]);
      let picked=samples.get(key);
      if(!picked){picked={original:sample,groups:new Set()};samples.set(key,picked);}
      if(detector){groups.set(detector.id,detector);picked.groups.add(detector.id);}
    }
  }
  const snapshot={...newQualityStudy(0),samples:[...samples.values()].map(({original,groups})=>({...original,groups:[...groups]})),groups:[...groups.values()]};
  return {snapshot,ids:qualityDisplayRows(snapshot).map(row=>row.id)};
}
