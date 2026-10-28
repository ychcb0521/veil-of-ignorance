import {expect,it} from 'vitest';
import {halfMirrorSummary,qualityPeakPct,campaignHalfMirror} from '@/lib/fish/qualityPresentation';
import type {QualityResult} from '@/lib/fish/quality';
import {buildQualityCampaignData} from '@/lib/fish/qualityCampaigns';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import {newQualityStudy,importQualityLibrary,qualityComparisonRows,qualityResultKey} from '@/lib/fish/quality';
import {buildQualitySheets} from '@/lib/fish/qualityExport';
const T=Date.UTC(2026,9,28),rule={enabled:true,gainPct:5,sellPct:50};
const result:QualityResult={key:'r',sampleId:'s',groupId:'p',evaluatedAt:T,status:'closed',entryTime:T,entryPrice:100,endTime:T+60000,endPrice:110,returnPct:7.5,peakPct:18,pnl:7.5,
 mirrorFill:{at:T,price:105,fraction:.5,gainPct:5,atOpen:false}};
it('distinguishes disabled, pending, missing, not-triggered and filled without manufacturing zero returns',()=>{
 expect(halfMirrorSummary(undefined,result).state).toBe('filled');
 expect(halfMirrorSummary(undefined,{status:'closed',returnPct:10}).state).toBe('disabled');
 expect(halfMirrorSummary(rule).state).toBe('pending');
 expect(halfMirrorSummary(rule,{status:'error',returnPct:999}).value).toBeNull();
 expect(halfMirrorSummary(rule,{status:'closed',returnPct:7.5}).state).toBe('untriggered');
 expect(halfMirrorSummary(rule,{status:'closed',returnPct:7.5}).value).toBeNull();
 expect(halfMirrorSummary(rule,result)).toMatchObject({state:'filled',label:'已卖 50%',value:7.5,text:'+7.50% · 已卖 50%'});
 expect(halfMirrorSummary({...rule,sellPct:25},{...result,returnPct:0,mirrorFill:{...result.mirrorFill!,fraction:.25}})).toMatchObject({label:'已卖 25%',value:0,text:'0.00% · 已卖 25%'});
});
it('treats peak gain as a measured price path, never as the weighted strategy return',()=>{
 expect(qualityPeakPct(result)).toBe(18);
 expect(qualityPeakPct({...result,peakPct:0})).toBe(0);
 expect(qualityPeakPct({...result,peakPct:undefined})).toBeNull();
 expect(qualityPeakPct({...result,status:'error'})).toBeNull();
});
it('uses identical frozen values in the table export and campaign, including legacy rows with no mirror strategy',()=>{
 let study=enableQualityComparison(importQualityLibrary(newQualityStudy(T),[{id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''}]));
 const sample=qualityComparisonRows(study)[0],plan=study.sellPlans![0];plan.mirrorTakeProfit=rule;
 const r={...result,sampleId:sample.id,groupId:plan.id,key:qualityResultKey(sample,plan,0)};study.results=[r];
 const campaign=buildQualityCampaignData('owner',{sample,plan,result:r,detectors:[],firstEvaluatedAt:T,observeHours:0},'sell').campaign;
 expect(campaign.comparison?.holdingMetrics).toMatchObject({peakPct:18,returnPct:7.5});
 expect(campaignHalfMirror(campaign)).toEqual(halfMirrorSummary(rule,r));
 const sheets=buildQualitySheets(study,[sample]),headers=sheets[0].columns.map(c=>c.header),row=sheets[0].rows[0];
 expect(row).toHaveLength(headers.length);
 expect(row[headers.indexOf(`${plan.label} · 峰值涨幅 %`)]).toBe(18);
 expect(row[headers.indexOf(`${plan.label} · 半仓镜像收益率 %`)]).toBe(7.5);
 expect(row[headers.indexOf(`${plan.label} · 半仓镜像状态`)]).toBe('已卖 50%');
 expect(headers.some(h=>h.includes('动态最大回撤'))).toBe(false);
 expect(campaignHalfMirror({comparison:undefined})).toBeUndefined();
});
