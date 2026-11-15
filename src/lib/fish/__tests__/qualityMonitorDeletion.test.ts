import { describe, it, expect } from 'vitest';
import { archiveDeletionGuard, markMonitorEntriesDeleted } from '../qualityMonitorDeletion';
import { archiveQualityMonitorStudy, preserveQualityMonitorLibrary, qualityMonitorRoundRecordIds } from '../qualityMonitorLibrary';
import { qualityMonitorCampaignDataFromStudy } from '../qualityCampaignProjection';
import { qualityMonitorCampaignId } from '../qualityMonitorCampaign';
import { createQualityTemplateDirectory } from '../qualityTemplateDirectory';
import { monitorArchiveFixture, ARCHIVE_T } from './monitorArchive.fixture';

describe('monitor directory', () => {
  it('uses the complete frozen plan to match a template after its label changes', () => {
    const study = monitorArchiveFixture(), plan = study.sellPlans![0];
    const templates = createQualityTemplateDirectory({ planTemplates: [{id:'actual-template',name:'原模板',savedAt:1,updatedAt:1,plan}] });
    expect(templates.groupPlans([{...plan,id:'copied',label:'副本'}]).title).toBe('原模板');
    const different = {...plan, label:'同名副本', snapshot:{...plan.snapshot,definitionKey:'changed-definition'} };
    expect(templates.groupPlans([different]).id).not.toBe(templates.groupPlans([plan]).id);
    expect(templates.groupPlans([different]).title).toBe('同名副本');
  });

  it('removes only exclusive non-trading results and keeps existing campaign details exact', () => {
    const study = monitorArchiveFixture(), library = study.monitorLibrary!;
    const active = library.records.find(record=>record.result?.status==='closed')!;
    const waiting = {...active,id:'exclusive',result:{...active.result!,status:'waiting' as const}};
    const removedRound = {...library.rounds[0],id:'delete-me',recordIds:[active.id,waiting.id],base:undefined,added:undefined,removed:undefined};
    const nextRound = {...removedRound,id:'keep-me',recordIds:undefined,base:removedRound.id,removed:[active.id,waiting.id],added:[]};
    const original = {...study,monitorLibrary:{...library,rounds:[removedRound,nextRound],records:[...library.records,waiting]}};
    const campaignId = qualityMonitorCampaignId(active.id);
    const baseline = qualityMonitorCampaignDataFromStudy('fixture',original,campaignId);
    const deleted = markMonitorEntriesDeleted(original,[removedRound.id]);
    const staleWrite = preserveQualityMonitorLibrary(deleted,original);
    expect(staleWrite.monitorLibrary!.rounds.map(round=>round.id)).toEqual(['keep-me']);
    expect(qualityMonitorRoundRecordIds(staleWrite.monitorLibrary!,staleWrite.monitorLibrary!.rounds[0])).toEqual([]);
    expect(staleWrite.monitorLibrary!.records.some(row=>row.id===waiting.id)).toBe(false);
    expect(qualityMonitorCampaignDataFromStudy('fixture',staleWrite,campaignId)).toEqual(baseline);
    expect(staleWrite.campaignRuns).toEqual(original.campaignRuns);
  });

  it('blocks an archive whose changed campaign result has no exact independent copy', () => {
    const study = monitorArchiveFixture();
    const archived = archiveQualityMonitorStudy(study, ARCHIVE_T+10_000_000);
    const snapshot = archived.monitorLibrary!.archives![0].study!;
    const next = {...snapshot, results:snapshot.results.map(row=>({...row,pnl:(row.pnl??0)+1}))};
    expect(archiveDeletionGuard(study)(snapshot)).toBe(true);
    expect(archiveDeletionGuard(study)(next)).toBe(false);
  });
});
