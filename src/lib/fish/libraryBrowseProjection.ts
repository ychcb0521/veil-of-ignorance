import {miningHitSnapshots,miningFamilySnapshot,capturedReading} from './libraryConditions';
import {miningAlgorithmFamily} from './miningLibraryDirectory';
import type {FishMiningRecord,FishMiningRun} from './miningLibrary';
import type {QualityFilterRecord} from './qualityFilterLibrary';
import type {BrowseRow} from './libraryBrowse';

const statusLabels:Record<string,string>={pass:'满足',fail:'不满足',pending:'待判断',error:'缺数据',none:'不过滤'};
export function filterBrowseRow(record:Pick<QualityFilterRecord,'id'|'source'|'status'>):BrowseRow {
  return [record.source.symbol,record.source.timeMs,[statusLabels[record.status.state]??record.status.state,record.status.detail].filter(Boolean).join(' · '),record.id];
}
export function miningBrowseRows(record:FishMiningRecord,run?:FishMiningRun) {
  const families=new Map<string,string[]>();
  for(const snapshot of miningHitSnapshots(record,run)){
    const resolved=miningFamilySnapshot(snapshot),family=miningAlgorithmFamily(resolved);
    const value=capturedReading(snapshot);
    const detail=[resolved.featureShort??resolved.featureId??family,resolved.statistic,value.reading??(value.rawReading!=null?'原始值 '+value.rawReading:undefined)].filter(v=>v!=null).join(' ');
    const entries=families.get(family)??[];entries.push(detail);families.set(family,entries);
  }
  if(!families.size)families.set('未分类',['捕捞信号']);
  return [...families].map(([family,details])=>({family,row:[record.signal.symbol,record.signal.timeMs,details.join(' · '),record.id] as BrowseRow}));
}

export function selectedDirectoryRecords<T extends {id:string}>(records:readonly T[], ids:ReadonlySet<string>):T[] {
  const found=records.filter(record=>ids.has(record.id));
  if(found.length!==ids.size || new Set(found.map(record=>record.id)).size!==ids.size)
    throw Error('原始档案与预览记录不一致，请重新打开目录后选择');
  return found;
}
