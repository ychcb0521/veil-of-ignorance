import {expect,it} from 'vitest';
import {mergeLibraryDirectoryEdits} from '../libraryDirectoryEdits';
import {newQualityStudy} from '../quality';
import {renameLibraryDirectory,editLibraryDirectory,copyMonitorStudy} from '../qualityMonitorArchive';
import {preserveQualityMonitorLibrary} from '../qualityMonitorLibrary';
import {emptyPreEntryLibrary,mergePreEntryLibraries} from '../preEntryMonitor';
import {parsePreEntryLibraryBackup} from '../preEntryLibraryTransfer';
import {makeLibraryPackage,parseLibraryPackage,stringifyLibraryFile} from '../libraryTransfer';
import {payload} from './libraryTransfer.fixture';
import {monitorArchiveFixture} from './monitorArchive.fixture';
it('keeps names through old-tab visibility writes, restores, stale writes and default-name resets',()=>{
 const base=newQualityStudy(1),named=renameLibraryDirectory(base,'round','  我的目录  ',10);
 expect(named.monitorLibrary!.directoryEdits!.round).toEqual({hidden:false,at:0,name:'我的目录',nameAt:10});
 const oldTab=editLibraryDirectory(base,'round',true,20),merged=preserveQualityMonitorLibrary(named,oldTab);
 expect(merged.monitorLibrary!.directoryEdits!.round).toEqual({hidden:true,at:20,name:'我的目录',nameAt:10});
 expect(preserveQualityMonitorLibrary(oldTab,named).monitorLibrary).toEqual(merged.monitorLibrary);
 const restored=editLibraryDirectory(merged,'round',false,21),reset=renameLibraryDirectory(restored,'round','',22);
 expect(preserveQualityMonitorLibrary(reset,named).monitorLibrary!.directoryEdits!.round).toEqual({hidden:false,at:21,name:'',nameAt:22});
 expect(base.monitorLibrary).toBeUndefined();expect(renameLibraryDirectory(base,'round','x'.repeat(121))).toBe(base);
 expect(mergeLibraryDirectoryEdits({round:{hidden:false,at:0,name:'a',nameAt:1}},{round:{hidden:true,at:2}}).round.name).toBe('a');
});
it('persists independently from snapshot copies without modifying frozen templates or results',()=>{
 const base=newQualityStudy(1),named=renameLibraryDirectory(base,'archive','独立目录',10),before=structuredClone(named);
 const copied=copyMonitorStudy(named,newQualityStudy(2),20);
 expect(copied.monitorLibrary!.directoryEdits).toEqual(named.monitorLibrary!.directoryEdits);expect(named).toEqual(before);
 expect(named.samples).toBe(base.samples);expect(named.results).toBe(base.results);expect(named.sellPlans).toBe(base.sellPlans);expect(named.planTemplates).toBe(base.planTemplates);
});
it('retains entry names through stale process saves and full backup round trips',()=>{
 const named={...emptyPreEntryLibrary(),directoryEdits:{round:{hidden:false,at:0,name:'入选样本',nameAt:4}}};
 const reloaded=JSON.parse(JSON.stringify(mergePreEntryLibraries(named,emptyPreEntryLibrary())));
 expect(reloaded.directoryEdits).toEqual(named.directoryEdits);
 expect(parsePreEntryLibraryBackup(JSON.stringify({format:'veil-pre-entry-library',version:1,library:reloaded}))).toEqual(named);
 reloaded.directoryEdits.round.name=3;
 expect(()=>parsePreEntryLibraryBackup(JSON.stringify({format:'veil-pre-entry-library',version:1,library:reloaded}))).toThrow('目录标记无效');
});
it('carries the original directory name when copying freezes a monitor round into its own archive',()=>{
 const base=monitorArchiveFixture(),round=base.monitorLibrary!.rounds[0],named=renameLibraryDirectory(base,round.id,'关键样本',10);
 const copied=copyMonitorStudy(named,newQualityStudy(2),20,round.id),frozen=copied.monitorLibrary!.archives!.find(a=>a.sourceRoundId===round.id)!;
 expect(copied.monitorLibrary!.directoryEdits![frozen.id].name).toBe('关键样本');expect(named.monitorLibrary!.directoryEdits![frozen.id]).toBeUndefined();
});
it('keeps filter and monitor names in scoped full downloads without unrelated monitor results',async()=>{
 const libraries=payload();libraries.monitor!.directoryEdits={'f-round':{hidden:false,at:0,name:'我的过滤目录',nameAt:3},'m-round':{hidden:false,at:0,name:'我的检测目录',nameAt:4}};
 for(const scope of ['filter','monitor'] as const){
  const pack=await makeLibraryPackage('owner','本账号',libraries,scope,5),parsed=await parseLibraryPackage(stringifyLibraryFile(pack));
  expect(parsed.libraries.monitor!.directoryEdits).toEqual(libraries.monitor!.directoryEdits);
  if(scope==='filter')expect(parsed.libraries.monitor!.records).toEqual([]);
 }
});
