import {beforeEach,expect,it,vi} from 'vitest';
import {newQualityStudy,qualityComparisonRows,qualityResultKey} from '../quality';
import {monitorArchiveFixture,ARCHIVE_T as T} from './monitorArchive.fixture';
import {archiveQualityMonitorStudy} from '../qualityMonitorLibrary';
import {archiveQualityStudy} from '../qualityCampaignArchive';
import {markSourceDeletions} from '../libraryDeletion';
const sync=vi.hoisted(()=>({load:vi.fn(),saved:vi.fn()}));
vi.mock('@/lib/accountBlobSync',()=>({syncAccountBlobOnLoad:sync.load,noteAccountBlobSaved:sync.saved}));
import {loadQualityStudy,mergeRemoteQualityStudy} from '../qualityStore';
beforeEach(()=>{localStorage.clear();sync.load.mockReset().mockResolvedValue('unchanged');});
it('restores every core record and frozen archive into a previously blank new-origin study',()=>{
 const prior=monitorArchiveFixture();prior.sellPlans!.forEach(p=>{p.rule={metric:p.metric,direction:'<',threshold:.5};});
 prior.results=prior.results.map(r=>({...r,key:qualityResultKey(qualityComparisonRows(prior).find(s=>s.id===r.sampleId)!,prior.sellPlans!.find(p=>p.id===r.groupId)!,prior.observeHours)}));
 const remote=archiveQualityMonitorStudy(archiveQualityStudy(prior),T+4000000),local=newQualityStudy(T+5000000);
 expect(remote.campaignRuns?.length).toBeGreaterThan(0);
 const merged=mergeRemoteQualityStudy(local,remote,true);
 expect(merged.samples).toEqual(remote.samples);expect(merged.results).toEqual(remote.results);expect(merged.campaignRuns).toEqual(remote.campaignRuns);
 expect(merged.monitorLibrary!.archives).toEqual(remote.monitorLibrary!.archives);expect(merged.monitorLibrary!.records).toEqual(remote.monitorLibrary!.records);
 expect(merged.entryReadings).toEqual(remote.entryReadings);expect(merged.sellPlans).toEqual(remote.sellPlans);
});
it('keeps newer local manual settings and results while restoring missing remote records',()=>{
 const remote=monitorArchiveFixture(),local=structuredClone(remote);local.observeHours=72;
 local.samples=local.samples.slice(0,1);local.results=local.results.slice(0,1);local.results[0]={...local.results[0],evaluatedAt:T+7000000,returnPct:31};
 const merged=mergeRemoteQualityStudy(local,remote,false);
 expect(merged.observeHours).toBe(72);expect(merged.samples).toHaveLength(remote.samples.length);expect(merged.results).toHaveLength(remote.results.length);
 expect(merged.results.find(r=>r.key===local.results[0].key)?.returnPct).toBe(31);expect(remote.results[0].returnPct).toBe(10);
});
it('respects explicit local source deletions when an older cloud copy is merged',()=>{
 const remote=archiveQualityMonitorStudy(monitorArchiveFixture(),T+4000000),row=remote.samples[0];
 const local=markSourceDeletions(remote,[{source:row.source,entry:row.enteredAt}],T+6000000);
 const merged=mergeRemoteQualityStudy(local,remote,true);
 expect(merged.samples).toEqual(local.samples);expect(merged.results).toEqual(local.results);expect(merged.monitorLibrary!.archives).toEqual(local.monitorLibrary!.archives);
});
it.each(['failed','timed_out'])('never presents a failed account recovery (%s) as a new empty study',async status=>{
 sync.load.mockResolvedValue(status);
 await expect(loadQualityStudy('owner')).rejects.toThrow('原数据仍保留');expect(sync.saved).not.toHaveBeenCalled();
});
