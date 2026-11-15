import {preparePreEntryTables} from './preEntryArchiveClient';
import {newQualityStudy,qualityComparisonRows,qualityFilterReadingKey,qualityEntryIdentity,qualityMembers,qualityGroupId,type FishQualityStudy,type QualitySample} from './quality';
import {createLibraryRoundReader} from './libraryRounds';
import type {QualityFilterLibrary,QualityFilterRound} from './qualityFilterLibrary';
import {preEntrySignal,type PreEntryLibrary,type PreEntryRecord,type PreEntryRound} from './preEntryMonitor';
import {buildQualitySheets} from './qualityExport';
import {buildXlsx} from '@/lib/xlsxWorkbook';
import {formatUTC8} from '@/lib/timeFormat';
import {fishSourceLabel,fishMetricLabel} from './records';

export function createFilterDirectoryReader(library:QualityFilterLibrary) {
  const readIds=createLibraryRoundReader(library.rounds);
  let index:Map<string,{record:QualityFilterLibrary['records'][number];position:number}[]>|undefined;
  return (round?:QualityFilterRound)=>{
    if(round?.filterSnapshot)return round.filterSnapshot;
    if(round){
      if(!index){
        index=new Map();
        library.records.forEach((record,position)=>{
          const matches=index!.get(record.id);
          if(matches)matches.push({record,position});else index!.set(record.id,[{record,position}]);
        });
      }
      const records=[...new Set(readIds(round))].flatMap(id=>index!.get(id)??[])
        .sort((a,b)=>a.position-b.position).map(entry=>entry.record);
      return {settings:library.settings,records};
    }
    const referenced=new Set<string>();
    const seen=new Set<string[]>();
    for(const round of library.rounds){
      const ids=readIds(round);
      if(seen.has(ids))continue;
      seen.add(ids);for(const id of ids)referenced.add(id);
    }
    return {settings:library.settings,records:library.records.filter(record=>!referenced.has(record.id))};
  };
}

export function filterDirectoryData(library:QualityFilterLibrary,round?:QualityFilterRound) {
  return createFilterDirectoryReader(library)(round);
}
/** Only saved inputs/readings are projected; this viewer never executes a formula. */
export function filterDirectoryStudy(library:QualityFilterLibrary,round?:QualityFilterRound,data=filterDirectoryData(library,round)):FishQualityStudy{
  const out:FishQualityStudy={...newQualityStudy(round?.startedAt??0),independentFilters:true,buyFilters:[],filterReadings:[],sellPlans:[]};
  const snapshot = round?.filterSnapshot;
  if (snapshot?.signalMetrics?.length) {
    out.signalMetrics = structuredClone(snapshot.signalMetrics);
    out.signalReadings = structuredClone(snapshot.signalReadings ?? []);
  }
  const settings=new Map(data.settings.map(s=>[s.id,s]));
  for(const r of data.records){
    if(!settings.has(r.settingId))continue;
    const sample:QualitySample=r.sample?structuredClone(r.sample):{id:r.id,source:structuredClone(r.source),enteredAt:r.enteredAt,basis:r.basis,importedAt:r.firstSavedAt,groups:[],origin:r.origin,origins:r.origins};
    out.samples.push(sample);
    for(const snapshot of qualityMembers(sample.source)){
      const id=qualityGroupId(snapshot);if(!sample.groups.includes(id)||out.groups.some(g=>g.id===id))continue;
      out.groups.push({id,label:fishSourceLabel(snapshot),metric:fishMetricLabel(snapshot),snapshot});
    }
    for(const filter of settings.get(r.settingId)!.filters)if(!out.buyFilters!.some(f=>f.id===r.settingId+'/'+filter.id))out.buyFilters!.push({...structuredClone(filter),id:r.settingId+'/'+filter.id});
  }
  const rows=new Map(qualityComparisonRows(out).map(r=>[qualityEntryIdentity(r.source,r.enteredAt),r]));
  for(const r of data.records){const row=rows.get(qualityEntryIdentity(r.source,r.enteredAt)),setting=settings.get(r.settingId);if(!row||!setting)continue;
    setting.filters.forEach((f,i)=>{const reading=r.readings[i];if(reading)out.filterReadings!.push({...structuredClone(reading),key:qualityFilterReadingKey(row,{...f,id:r.settingId+'/'+f.id})});});
  }
  out.selectedRowIds=qualityComparisonRows(out).map(r=>r.id);return out;
}
export function entryDirectoryGroups(library: PreEntryLibrary) {
  const byRound = new Map<string, {records:PreEntryRecord[];matched:number}>();
  for (const record of library.records) {
    let bucket=byRound.get(record.roundId);
    if(!bucket){bucket={records:[],matched:0};byRound.set(record.roundId,bucket);}
    bucket.records.push(record);
    if(record.status==='matched')bucket.matched++;
  }
  return library.rounds.flatMap(round => {
    const {records,matched}=byRound.get(round.id)??{records:[],matched:0};
    if (!matched && !round.workspaceSaved) return [];
    const status = round.state === 'running' ? '运行中' : round.state === 'paused' ? '已暂停' : '已完成';
    return [{ round, records, label: round.workspaceSaved ? '筛选轮次' : '入选轮次', summary: `${matched} 条记录 · ${status}` }];
  });
}

export function entryDirectoryStudy(library:PreEntryLibrary,round:PreEntryRound, records=library.records.filter(record=>record.roundId===round.id), copy=true):FishQualityStudy{
  const out:FishQualityStudy={...newQualityStudy(round.startedAt),independentFilters:true,sellPlans:[]};
  for(const record of records){
    const signal=preEntrySignal(record);
    if (!signal) {
      if (round.workspaceSaved) out.samples.push({...structuredClone(record.sample),groups:[],readings:undefined});
      continue;
    }
    // Keep the first-match entry semantics used by the main combination table.
    out.samples.push({id:signal.id,source:{...signal,quality:record.sample.source.quality},enteredAt:signal.timeMs,basis:'signal',importedAt:record.updatedAt,groups:[],origin:'pre-entry',origins:['pre-entry']});
  }
  out.screeningRounds=[copy?structuredClone(round):round];
  const saved=records.filter(r=>round.workspaceSaved||r.status==='matched').map(r=>{
    if(!r.tableClearedAt)return r;
    const {tableClearedAt:_clear,...record}=r;return record;
  });
  out.screeningResults=copy?structuredClone(saved):saved;
  out.selectedRowIds=qualityComparisonRows(out).map(r=>r.id);return out;
}
export function downloadDirectoryTables(name:string,tables:readonly {id:string;study:FishQualityStudy}[],at=Date.now()){
  if(!tables.length)throw Error('暂无可导出的记录');
  const cold=tables.some(t=>t.study.screeningResults?.some(r=>r.processRef));
  const download=(blob:Blob)=>{const filename=`${name}-${formatUTC8(at).replace(/\D/g,'').slice(0,14)}.xlsx`,url=URL.createObjectURL(blob),link=document.createElement('a');
  try{link.href=url;link.download=filename;document.body.appendChild(link);link.click();}finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return filename;};
  if(cold)return preparePreEntryTables([...tables]).then(download);
  const sheets=tables.flatMap((t,i)=>buildQualitySheets(t.study,qualityComparisonRows(t.study)).map((sheet,j)=>({...sheet,name:`${i+1}-${j+1}-${sheet.name}`.slice(0,31)})));
  return download(buildXlsx(sheets));
}
