import {expect,it} from 'vitest';
import {payload} from './libraryTransfer.fixture';
import {newQualityStudy} from '../quality';
import {retireFilterDirectory} from '../qualityFilterDeletion';
import {preserveQualityFilterLibrary} from '../qualityFilterLibrary';
import {createFilterDirectoryReader} from '../qualityLibraryDirectory';

it('permanently removes exclusive frozen results and rebases survivors on stale merges in either direction',()=>{
 const old=payload().filter!, [first,second]=old.rounds;
 const exclusive={...old.records[0],id:'exclusive'},legacy={...old.records[0],id:'legacy'};
 old.records.push(exclusive,legacy);
 old.rounds=[{...first,recordIds:[exclusive.id,'filtered'],filterSnapshot:{at:100,settings:old.settings,records:[exclusive]}},
   {...second,removed:[exclusive.id]}];
 const retired=retireFilterDirectory(old,first.id)!;
 for(const [a,b] of [[old,retired],[retired,old]]){
   const current=newQualityStudy(),merged=preserveQualityFilterLibrary({...current,filterLibrary:a},{...current,filterLibrary:b}).filterLibrary!;
   expect(merged.records.map(r=>r.id)).toEqual(['filtered','legacy']);
   expect(merged.rounds.map(r=>r.id)).toEqual([second.id]);
   expect(createFilterDirectoryReader(merged)(merged.rounds[0]).records.map(r=>r.id)).toEqual(['filtered']);
   expect(createFilterDirectoryReader(merged)().records.map(r=>r.id)).toEqual(['legacy']);
   const clean=retireFilterDirectory(merged,'filter-legacy')!;
   expect(clean.records.map(r=>r.id)).toEqual(['filtered']);
   expect(retireFilterDirectory(clean,first.id)).toBe(clean);
 }
 expect(retireFilterDirectory({...old,rounds:[{...first,state:'running'}]},first.id)).toBeUndefined();
});
