import { beforeEach, expect, it, vi } from 'vitest';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { importQualityLibrary, newQualityStudy, qualityDisplayRows, qualityResultKey, qualityRunSamples, type FishQualityStudy } from '@/lib/fish/quality';
import { beginQualityMonitorRound, captureQualityMonitorResult, finishQualityMonitorRound } from '@/lib/fish/qualityMonitorLibrary';
import { monitorCampaignRecordId, qualityMonitorCampaignId, qualityMonitorCampaignPath, qualityMonitorCampaignRun } from '@/lib/fish/qualityMonitorCampaign';
import { loadQualityCampaignData, qualityCampaignDataFromStudy, qualityMonitorCampaignDataFromStudy } from '@/lib/fish/qualityCampaigns';
import { isQualityCampaignId } from '@/lib/campaignSections';
import { loadQualityStudy } from '@/lib/fish/qualityStore';
import { buildMonitorSheets } from '@/lib/fish/qualityMonitorTable';
vi.mock('@/lib/fish/qualityStore',()=>({loadQualityStudy:vi.fn()}));
const T=Date.UTC(2026,9,27);
beforeEach(()=>vi.clearAllMocks());
function saved():FishQualityStudy {
 let s=enableQualityComparison(importQualityLibrary(newQualityStudy(T),[{id:'signal',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:''}]));
 s.sellPlans=[{...s.sellPlans![0],rule:{metric:'state',direction:'<',threshold:.5}}];s.selectedRowIds=qualityDisplayRows(s).map(r=>r.id);
 for(const threshold of [.5,.4]) {
  s={...s,sellPlans:[{...s.sellPlans[0],rule:{metric:'state',direction:'<',threshold}}]};
  const begun=beginQualityMonitorRound(s,s,T+1),sample=qualityRunSamples(s)[0],plan=s.sellPlans[0];
  const result={key:qualityResultKey(sample,plan,0),sampleId:sample.id,groupId:plan.id,status:'closed' as const,complete:true,evaluatedAt:T+600000,entryTime:T,entryPrice:100,endTime:T+600000,endPrice:110,pnl:10,returnPct:10};
  s=finishQualityMonitorRound(captureQualityMonitorResult(begun.study,begun.capture,result,T+600000),begun.capture,'complete',T+600001);
 }
 return s;
}
it('round trips complete record IDs without collisions, including Unicode and setting differences',()=>{
 for(const id of ['["配置甲","AAAUSDT",1]','["配置乙","AAAUSDT",1]','abc/+_%']){
  const campaign=qualityMonitorCampaignId(id);expect(isQualityCampaignId(campaign)).toBe(true);expect(monitorCampaignRecordId(campaign)).toBe(id);expect(qualityMonitorCampaignPath(id)).toContain(campaign);
 }
 expect(monitorCampaignRecordId('fish-sell-monitor-bad_')).toBeUndefined();
});
it('opens all library-only trades using exact frozen conditions even when current samples, results and plans have gone',async()=>{
 const s=saved(),before=JSON.stringify(s.monitorLibrary);s.samples=[];s.results=[];s.sellPlans=[];s.campaignRuns=[];
 vi.mocked(loadQualityStudy).mockResolvedValue({study:s} as never);
 for(const record of s.monitorLibrary!.records){
  const setting=s.monitorLibrary!.settings.find(x=>x.id===record.settingId)!,id=qualityMonitorCampaignId(record.id);
  const data=await loadQualityCampaignData('owner',id);
  expect(data.campaign.id).toBe(id);expect(data.campaign.user_id).toBe('owner');expect(data.campaign.title).toContain(`< ${setting.plan.rule!.threshold}`);
  expect(data.legs[0].campaign_id).toBe(id);expect(data.tradeRecords[0]).toMatchObject({entryPrice:100,exitPrice:110,pnl:10});
  expect(data.campaign.notes).toContain('监测库历史快照');expect(data.campaign.actual_evolution).toHaveLength(2);
 }
 expect(JSON.stringify(s.monitorLibrary)).toBe(before);
 const listed=qualityCampaignDataFromStudy('owner',s,'quality');expect(listed).toHaveLength(2);
 expect(new Set(listed.map(r=>r.campaign.id)).size).toBe(2);
});
it('distinguishes frozen records even if their evaluation keys are identical',()=>{
 const s=saved(),[a,b]=s.monitorLibrary!.records;b.result={...b.result!,key:a.result!.key};
 const first=qualityMonitorCampaignDataFromStudy('owner',s,qualityMonitorCampaignId(a.id));
 const second=qualityMonitorCampaignDataFromStudy('owner',s,qualityMonitorCampaignId(b.id));
 expect(first.campaign.id).not.toBe(second.campaign.id);expect(first.campaign.title).toContain('< 0.5');expect(second.campaign.title).toContain('< 0.4');
});
it('preserves holding trades and never invents a closing order or a filtered-out trade',()=>{
 const s=saved(),r=s.monitorLibrary!.records[0],setting=s.monitorLibrary!.settings.find(x=>x.id===r.settingId)!;
 r.result={...r.result!,status:'open'};
 const full=qualityMonitorCampaignDataFromStudy('owner',s,qualityMonitorCampaignId(r.id));expect(full.campaign.status).toBe('active');expect(full.campaign.closed_at).toBeNull();expect(full.tradeRecords).toEqual([]);
 r.filterStatus={state:'fail',detail:'未买入'};expect(qualityMonitorCampaignRun(r,setting)).toBeUndefined();
 expect(()=>qualityMonitorCampaignDataFromStudy('owner',s,qualityMonitorCampaignId(r.id))).toThrow('尚未形成有效交易');
 r.filterStatus={state:'pass',detail:''};r.result={...r.result,entryPrice:undefined};expect(qualityMonitorCampaignRun(r,setting)).toBeUndefined();
 expect(()=>qualityMonitorCampaignDataFromStudy('other',newQualityStudy(),qualityMonitorCampaignId(r.id))).toThrow('本账号未找到');
});
it('exports exact campaign links along with every trade',()=>{
 const s=saved(),settings=new Map(s.monitorLibrary!.settings.map(x=>[x.id,x])),sheet=buildMonitorSheets(s.monitorLibrary!.records,settings)[0];
 const column=sheet.columns.findIndex(c=>c.header==='交易战役链接');expect(column).toBeGreaterThan(0);
 for(const [i,r] of s.monitorLibrary!.records.entries())expect(sheet.rows[i][column]).toContain(qualityMonitorCampaignPath(r.id));
});


it('does not count an archived trade twice when the same trade also exists in the monitor library',()=>{
 const s=saved();s.results=s.monitorLibrary!.records.map(r=>r.result!);
 const listed=qualityCampaignDataFromStudy('owner',s,'quality');
 expect(listed).toHaveLength(2);
 expect(listed.map(r=>r.campaign.title).sort()).toEqual(['AAAUSDT · 状态 S 原始值 < 0.4','AAAUSDT · 状态 S 原始值 < 0.5']);
});
