import {preparePreEntryTables} from './preEntryArchiveClient';
import {newQualityStudy,qualityComparisonRows,qualityFilterReadingKey,qualityEntryIdentity,qualityMembers,qualityGroupId,type FishQualityStudy,type QualitySample} from './quality';
import {libraryRoundRecordIds} from './libraryRounds';
import type {QualityFilterLibrary,QualityFilterRound} from './qualityFilterLibrary';
import {preEntrySignal,type PreEntryLibrary,type PreEntryRecord,type PreEntryRound} from './preEntryMonitor';
import {buildQualitySheets} from './qualityExport';
import {buildXlsx} from '@/lib/xlsxWorkbook';
import {formatUTC8} from '@/lib/timeFormat';
import {fishSourceLabel,fishMetricLabel} from './records';

export function filterDirectoryData(library:QualityFilterLibrary,round?:QualityFilterRound){
  if(round?.filterSnapshot)return round.filterSnapshot;
  if(round){const ids=new Set(libraryRoundRecordIds(library.rounds,round));return {settings:library.settings,records:library.records.filter(r=>ids.has(r.id))};}
  const cache=new Map<string,string[]>(),referenced=new Set(library.rounds.flatMap(r=>libraryRoundRecordIds(library.rounds,r,cache)));
  return {settings:library.settings,records:library.records.filter(r=>!referenced.has(r.id))};
}
/** Only saved inputs/readings are projected; this viewer never executes a formula. */
export function filterDirectoryStudy(library:QualityFilterLibrary,round?:QualityFilterRound):FishQualityStudy{
  const data=filterDirectoryData(library,round),out:FishQualityStudy={...newQualityStudy(round?.startedAt??0),independentFilters:true,buyFilters:[],filterReadings:[],sellPlans:[]};
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
  const byRound = new Map<string, PreEntryRecord[]>();
  for (const record of library.records) {
    if (record.status !== 'matched') continue;
    const records = byRound.get(record.roundId);
    if (records) records.push(record);
    else byRound.set(record.roundId, [record]);
  }
  return library.rounds.flatMap(round => {
    const records = byRound.get(round.id);
    if (!records?.length) return [];
    const status = round.state === 'running' ? '运行中' : round.state === 'paused' ? '已暂停' : '已完成';
    return [{ round, records, label: '入选轮次', summary: `${records.length} 条记录 · ${status}` }];
  });
}

export function entryDirectoryStudy(library:PreEntryLibrary,round:PreEntryRound):FishQualityStudy{
  const out:FishQualityStudy={...newQualityStudy(round.startedAt),independentFilters:true,sellPlans:[]};
  for(const record of library.records.filter(r=>r.roundId===round.id)){
    const signal=preEntrySignal(record);if(!signal)continue;
    // Keep the first-match entry semantics used by the main combination table.
    out.samples.push({id:signal.id,source:{...signal,quality:record.sample.source.quality},enteredAt:signal.timeMs,basis:'signal',importedAt:record.updatedAt,groups:[],origin:'pre-entry',origins:['pre-entry']});
  }
  out.screeningRounds=[structuredClone(round)];
  out.screeningResults=structuredClone(library.records.filter(r=>r.roundId===round.id&&r.status==='matched').map(({tableClearedAt:_clear,...record})=>record));
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
