import {expect,it} from 'vitest';
import {miningSeries} from '../miningSeries';
import {miningBrowseSeriesGroups} from '../miningSeriesBrowse';
import {miningSeriesDirectories,miningDirectoryStudy,miningReadingsByEntry} from '../miningLibraryDirectory';
import {emptyMiningLibrary,type FishMiningRecord} from '../miningLibrary';
import {qualityComparisonRows} from '../quality';

const snapshot=(statistic:string,average=0)=>({featureId:'bss',featureShort:'BSS',statistic,average,scale:1,direction:'>' as const,threshold:-1,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:1});
const record=(id:string,statistics:string[],hits:number[]):FishMiningRecord=>({id,runId:'r',anchorMs:2,catchKey:id,firstSavedAt:3,updatedAt:3,
 signal:{id,symbol:id+'USDT',timeMs:1,timeLabel:'',fallbackZone:'',fish:{...snapshot(statistics[0]),combination:'or',algorithms:statistics.map(s=>snapshot(s)),hitAlgorithms:hits}}});
it('classifies the captured metric and frozen result formula without consulting editable definitions',()=>{
 expect(['BSS','avg_BSS','avg_BSS_2','avg_BSS_3'].map(statistic=>miningSeries(snapshot(statistic)).id)).toEqual(['raw','avg','avg-2','avg-3']);
 expect(miningSeries({...snapshot('结果'),definitionKey:JSON.stringify(['x = 1\navg_BSS_2 = x'])}).id).toBe('avg-2');
 expect(miningSeries(snapshot('结果')).id).toBe('unknown');
 expect(miningSeries({...snapshot('BSS'),H:4}).id).toContain('legacy:');
 expect(miningSeries({algorithmKey:'bss|avg_BSS_2|=|>|1|[]'}).id).toBe('avg-2');
});
it('deduplicates each record within a subtype, retains overlaps, excludes OR non-hits and preserves originals',()=>{
 const library={...emptyMiningLibrary(),records:[record('both',['BSS','avg_BSS','avg_BSS_2','avg_BSS_2'],[2,3,4]),record('raw',['BSS','avg_BSS_2'],[1])]};
 const original=structuredClone(library),[group]=miningBrowseSeriesGroups(library),[local]=miningSeriesDirectories(library);
 expect(group.rows.map(row=>row[3])).toEqual(['both','raw']);
 expect(group.children!.map(child=>[child.title,child.rows.map(row=>row[3])])).toEqual([['原值',['raw']],['avg',['both']],['avg-2',['both']]]);
 expect(local.children.map(child=>child.records.map(record=>record.id))).toEqual([['raw'],['both'],['both']]);
 expect(group.children![2].rows[0][2]).toContain('avg_BSS_2 0');
 expect(group.children![1].rows[0][2]).not.toContain('avg_BSS_2');
 expect(library).toEqual(original);
});
it('retains empty subtype directories without fabricating readings, and obeys parent deletion cutoffs',()=>{
 const library={...emptyMiningLibrary(),records:[record('only',['avg_BSS_2'],[1])]};
 expect(miningBrowseSeriesGroups(library)[0].children!.map(child=>child.rows.length)).toEqual([0,0,1]);
 expect(miningBrowseSeriesGroups(library,{'mining-family-BSS':{hidden:true,at:3}})).toEqual([]);
 expect(miningBrowseSeriesGroups(library,{'mining-family-BSS':{hidden:true,at:2}})[0].children![2].rows).toHaveLength(1);
});
it('limits local combination rows and frozen readings to the selected subtype',()=>{
 const records=[record('both',['avg_BSS','avg_BSS_2'],[1,2])],library={...emptyMiningLibrary(),records};
 const study=miningDirectoryStudy(records,'BSS','avg-2');
 expect(qualityComparisonRows(study)).toHaveLength(1);
 const readings=[...miningReadingsByEntry({family:'BSS',series:'avg-2',records,runs:new Map()}).values()].flat();
 expect(readings).toHaveLength(1);expect(readings[0]).toMatchObject({metric:'avg_BSS_2',reading:0,rawReading:0,percentile:100});
 expect(miningSeriesDirectories(library)[0].children[0].records).toEqual([]);
});
