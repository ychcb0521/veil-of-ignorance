import { describe, expect, it } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { evaluateQualitySample, qualityResultKey, type QualityGroup, type QualitySample } from '@/lib/fish/quality';
import { defaultQualityAddition, additionIdentity, stricterAdditionThreshold, validateQualityAddition } from '@/lib/fish/qualityAddition';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';
import { buildQualityCampaignData } from '@/lib/fish/qualityCampaigns';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { qualitySellKey } from '@/lib/fish/qualityCampaignArchive';
import { qualityMirrorBoard } from '@/lib/fish/qualityMirrorBoard';
import { FISH_STATE_HOLD_TEXT } from '@/lib/fish/algorithm';
const M=60000,T=Date.UTC(2026,9,29);
const def={id:'test-add',name:'价格',short:'价格',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
const snapshot={featureId:def.id,featureName:def.name,featureShort:def.short,definitionKey:definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:100,direction:'>' as const,average:100,cbi2:100,startAverage:100,previousAverage:99,cutoffMs:T};
const row:QualitySample={id:'a',enteredAt:T,basis:'capture',importedAt:T,groups:[],source:{id:'a',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:'',fish:snapshot}};
function group():QualityGroup {return {id:'g',label:'卖出',metric:'raw',snapshot,execution:'intrabar-1m',rule:{metric:'raw',direction:'<',threshold:0},addition:{...defaultQualityAddition(),quantityMode:undefined,quantity:undefined,amountMode:'entry',amountUsdt:100,enabled:true,source:'custom',condition:{id:'add',label:'价格',metric:'raw',direction:'>',threshold:105,enabled:true,snapshot}}};}
const bar=(at:number,open=100,close=open,high=Math.max(open,close),low=Math.min(open,close)):ResearchBar=>({openTime:at,open,high,low,close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50});
const load=(path:(at:number)=>ResearchBar):FishReconstructionLoader=>async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{
 const at=from+i*p.step;if(p.step===M)return path(at);
 const list=Array.from({length:p.step/M},(_,j)=>path(at+j*M));return {...list[0],high:Math.max(...list.map(b=>b.high)),low:Math.min(...list.map(b=>b.low)),close:list.at(-1)!.close};
});
const run=(g:QualityGroup,path:FishReconstructionLoader,minutes=5,prior?:Awaited<ReturnType<typeof evaluateQualitySample>>,s=row)=>evaluateQualitySample(s,g,0,T+minutes*M,path,new AbortController().signal,prior);
describe('conditional additions',()=>{
 it('keeps historical identities when disabled and rejects invalid amounts, thresholds and insufficient precision',()=>{
  const g=group(),base={...g,addition:undefined};
  expect(qualityResultKey(row,base,0)).toBe(qualityResultKey(row,{...g,addition:{...g.addition!,enabled:false}},0));
  expect(qualitySellKey(base)).not.toBe(qualitySellKey(g));expect(additionIdentity(g.addition)).not.toEqual([]);
  for(const amountUsdt of [0,-1,NaN,Infinity])expect(()=>validateQualityAddition({...g.addition!,amountMode:'fixed',amountUsdt})).toThrow('加仓金额');
  expect(()=>validateQualityAddition({...g.addition!,source:'detector',stricterPct:0})).toThrow('提高幅度');
  expect(stricterAdditionThreshold(-10,'>',10)).toBe(-9);expect(stricterAdditionThreshold(-10,'<',10)).toBe(-11);expect(stricterAdditionThreshold(0,'>',10)).toBe(.1);
 });
 it('adds once at the next minute open, weights actual coin quantities and divides profit by total investment',async()=>{
  const path=load(at=>at<T?bar(at):at===T?bar(at,100,101):at===T+M?bar(at,101,111):at===T+2*M?bar(at,120):bar(at,90));
  const r=await run(group(),path);
  expect(r).toMatchObject({status:'open',additionFill:{at:T+2*M,price:120,notional:100,quantity:expect.closeTo(100/120),scanFrom:T},totalInvested:200,pnl:expect.closeTo(-35),returnPct:expect.closeTo(-17.5),averageEntryPrice:expect.closeTo(200/(1+100/120))});
  const resumed=await run(group(),path,5,await run(group(),path,3));expect(resumed).toEqual(r);
 });
 it('never uses pre-entry hits or eventual candle closes and waits for a complete post-entry observation',async()=>{
  const g=group(),five={...g,addition:{...g.addition!,condition:{...g.addition!.condition!,snapshot:{...snapshot,interval:'5m'}}}};
  const path=load(at=>at<T?bar(at,150):at<T+4*M?bar(at,100):bar(at,100,110));
  expect((await run(five,path,4)).additionFill).toBeUndefined();
  expect((await run(five,path,5)).additionFill).toBeUndefined();
  expect((await run(five,path,7)).additionFill?.at).toBe(T+5*M);
  expect((await run(g,load(at=>at<T?bar(at,150):bar(at,100)))).additionFill).toBeUndefined();
 });
 it('replays original detector constraints with a strictly stronger threshold',async()=>{
  const g={...group(),addition:{...group().addition!,source:'detector' as const}},s={...row,source:{...row.source,fish:{...snapshot,constraints:['X > 115']}}};
  const path=load(at=>at===T?bar(at,100,111):at===T+M?bar(at,111,116):at>=T+2*M?bar(at,120):bar(at));
  const r=await run(g,path,5,undefined,s);expect(r.additionFill).toMatchObject({at:T+2*M,threshold:110,reading:116});
  const missing={...s,source:{...s.source,fish:undefined}};expect(await run(g,path,5,undefined,missing)).toMatchObject({status:'open',additionNote:expect.stringContaining('没有原探测算法')});
 });
 it('resets the original S duration gate at entry instead of inheriting a pre-entry qualified run',async()=>{
  const state={...def,id:'state',formula:'state = C / 100'},f={...snapshot,featureId:'state',statistic:'state',definitionKey:definitionKey(state),threshold:.6,constraints:[FISH_STATE_HOLD_TEXT]};
  const s={...row,source:{...row.source,fish:f}},g={...group(),addition:{...group().addition!,source:'detector' as const}};
  const path=load(at=>bar(at));
  expect((await run(g,path,180,undefined,s)).additionFill).toBeUndefined();
  expect((await run(g,path,185,undefined,s)).additionFill?.at).toBe(T+181*M);
 });
 it('gives exits priority and never adds after a stop or 100% mirror close',async()=>{
  const g={...group(),rule:{metric:'raw',direction:'>' as const,threshold:105}},path=load(at=>at>=T?bar(at,100,110):bar(at));
  const r=await run(g,path);expect(r.status).toBe('closed');expect(r.endTime).toBe(T+M);expect(r.additionFill).toBeUndefined();
  const mirror=await run({...group(),mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:100}},path);expect(mirror.endTime).toBe(T);expect(mirror.additionFill).toBeUndefined();
 });
 it.each([false,true])('accounts for partial mirror sales before or after the addition, preserving both campaign lots (mirror first=%s)',async before=>{
  const g={...group(),rule:{metric:'raw',direction:'<' as const,threshold:80},mirrorTakeProfit:{enabled:true,gainPct:before?5:30,sellPct:50}};
  const path=load(at=>at<T?bar(at):at===T?bar(at,100,100,before?106:100):at===T+M?bar(at,100,110,before?110:110):at===T+2*M?bar(at,120):at===T+3*M?bar(at,120,70,before?120:140):bar(at,90));
  const r=await run(g,path);expect(r.status).toBe('closed');expect(r.additionFill).toBeDefined();
  expect(r.totalInvested).toBe(200);expect(r.pnl).toBeCloseTo(before?-27.5:-15);expect(r.returnPct).toBeCloseTo((before?-27.5:-15)/2);
  const campaign=buildQualityCampaignData('owner',{sample:row,plan:g,result:r,detectors:[],observeHours:0,firstEvaluatedAt:T},'sell');
  expect(campaign.legs.map(l=>l.leg_role)).toEqual(['main_open','mirror_tp','main_add_1']);
  expect(campaign.tradeRecords.reduce((sum,t)=>sum+t.pnl,0)).toBeCloseTo(r.pnl!);
  expect(computeCampaignRealizedPnl(campaign.campaign,campaign.legs,campaign.tradeRecords,{}).total).toBeCloseTo(r.pnl!);
  expect(campaign.campaign.comparison!.sellEvidence!.additionFill).toEqual(r.additionFill);
  expect(qualityMirrorBoard(campaign.campaign)).toMatchObject({totalInvested:200,totalPnl:expect.closeTo(r.pnl!),mirrorPnl:expect.closeTo(r.mirrorRealizedPnl!),remainingPnl:expect.closeTo(r.remainingPnl!)});
 });
 it('fully closes added coins too on a 100% mirror and rejects missing detector values',async()=>{
  const g={...group(),mirrorTakeProfit:{enabled:true,gainPct:30,sellPct:100}},path=load(at=>at<T?bar(at):at===T?bar(at,100,110):at===T+M?bar(at,120):bar(at,120,140));
  const r=await run(g,path);expect(r).toMatchObject({status:'closed',additionFill:{price:120},endPrice:130,totalInvested:200,remainingQuantity:0,pnl:expect.closeTo(130*(1+100/120)-200)});
  const campaign=buildQualityCampaignData('owner',{sample:row,plan:g,result:r,detectors:[],observeHours:0,firstEvaluatedAt:T},'sell');expect(campaign.tradeRecords.reduce((sum,t)=>sum+t.quantity,0)).toBeCloseTo(1+100/120);
  expect(qualityMirrorBoard(campaign.campaign)).toMatchObject({quantity:expect.closeTo(1+100/120),totalInvested:200,totalPnl:expect.closeTo(r.pnl!),mirrorPnl:expect.closeTo(r.pnl!),remainingPnl:expect.closeTo(0)});
  const bad=await run(group(),load(at=>at===T+M?bar(at,100,NaN):bar(at)));expect(bad.status).toBe('error');expect(bad.reason).toContain('缺失');
 });
});

it('executes a previously confirmed opening addition before a later intraminute stop, without using that minute low to cancel the buy',async()=>{
 const g={...group(),vetoFill:'stop' as const,holdingVetoes:[{id:'risk',label:'静态回撤',kind:'static-drawdown' as const,direction:'>=' as const,threshold:5,enabled:true}]};
 const r=await run(g,load(at=>at<T?bar(at):at===T?bar(at,100,110):bar(at,120,100,120,90)));
 expect(r).toMatchObject({status:'closed',endTime:T+M,endPrice:95,additionFill:{at:T+M,price:120},pnl:expect.closeTo(95*(1+100/120)-200)});
});

it('retains distinct frozen addition configurations, exact fills and total investment in both exports',async()=>{
 const {newQualityStudy,importQualityLibrary,qualityComparisonRows}=await import('@/lib/fish/quality');
 const {buildQualitySheets}=await import('@/lib/fish/qualityExport');
 const {beginQualityMonitorRound,captureQualityMonitorResult}=await import('@/lib/fish/qualityMonitorLibrary');
 const {buildMonitorSheets}=await import('@/lib/fish/qualityMonitorTable');
 const plan={...group(),addition:{...group().addition!,amountMode:'fixed' as const,amountUsdt:75}};
 const study={...importQualityLibrary(newQualityStudy(T),[row.source]),sellPlans:[plan]},sample=qualityComparisonRows(study)[0];study.selectedRowIds=[sample.id];
 const result=await run(plan,load(at=>at===T?bar(at,100,110):at>=T+M?bar(at,120):bar(at)),5,undefined,sample);
 expect(result.totalInvested).toBe(175);study.results=[result];
 const output=buildQualitySheets(study,[sample]).find(s=>s.name==='运行结果')!,headers=output.columns.map(c=>c.header);
 expect(output.rows[0][headers.indexOf('加仓金额 USDT')]).toBe(75);expect(output.rows[0][headers.indexOf('累计投入 USDT')]).toBe(175);
 const begun=beginQualityMonitorRound(study,study,T),saved=captureQualityMonitorResult(begun.study,begun.capture,result,T+5*M),lib=saved.monitorLibrary!;
 const sheets=buildMonitorSheets(lib.records,new Map(lib.settings.map(s=>[s.id,s]))),adds=sheets.find(s=>s.name==='加仓记录')!;
 expect(adds.rows[0][4]).toBe(75);expect(adds.rows[0][9]).toBe(175);expect(sheets.find(s=>s.name==='算法与公式')!.rows.some(r=>r.includes('加仓'))).toBe(true);
});
it('syncs a saved custom addition formula while preserving its chosen threshold and old frozen rule',async()=>{
 const {syncQualitySellDefinitions}=await import('@/lib/fish/qualityComparison');
 const {makeQualityBuyFilter}=await import('@/lib/fish/qualityFilters');
 const {BUILTIN_FEATURES,MBI_DEF}=await import('@/lib/deepDig/features');
 const condition=makeQualityBuyFilter('mbi:MBI','>',.8),plan={...group(),addition:{...group().addition!,condition}};
 const {newQualityStudy}=await import('@/lib/fish/quality');const study={...newQualityStudy(),sellPlans:[plan]};
 const next=syncQualitySellDefinitions(study,BUILTIN_FEATURES.map(d=>d.id==='mbi'?{...MBI_DEF,MBI_N:7}:d));
 expect(next.sellPlans![0].addition!.condition!.threshold).toBe(.8);expect(next.sellPlans![0].addition!.condition!.snapshot.definitionKey).toContain('MBI_N=7');
 expect(condition.snapshot.definitionKey).not.toContain('MBI_N=7');
});

// Addition is a complete holding experiment even when the user clears all sell conditions.
it('values an addition-only holding without requiring a sell algorithm',async()=>{
 const g={...group(),rule:undefined};
 const r=await run(g,load(at=>at===T?bar(at,100,110):at>=T+M?bar(at,120):bar(at)));
 expect(r).toMatchObject({status:'open',totalInvested:200,additionFill:{at:T+M,price:120},returnPct:expect.closeTo(10)});
});

it.each([['entry',.5],['fixed',.5]] as const)('sizes %s additions after the half mirror and values only the remaining holding',async(quantityMode,quantity)=>{
 const g=group(),plan={...g,mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50},addition:{...g.addition!,quantityMode,quantity}},path=load(at=>at<T?bar(at):at===T?bar(at,100,101,106):at===T+M?bar(at,101,111):at===T+2*M?bar(at,120):bar(at,90));
 const result=await run(plan,path),cost=100+quantity*120,remainingCost=50+quantity*120,pnl=2.5+(.5+quantity)*90-remainingCost;
 expect(result.additionFill).toMatchObject({price:120,quantity,notional:quantity*120});expect(result.totalInvested).toBe(cost);expect(result.averageEntryPrice).toBeCloseTo(remainingCost/(.5+quantity));expect(result.pnl).toBeCloseTo(pnl);expect(result.returnPct).toBeCloseTo(pnl/cost*100);
 expect(await run(plan,path,5,await run(plan,path,3))).toEqual(result);
});
it('invalidates earlier coin-sized cached trials while retaining frozen legacy cash fills and rejecting invalid quantities',async()=>{
 const g=group(),plan={...g,mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50},addition:{...g.addition!,quantityMode:'entry' as const,quantity:1}},path=load(at=>at<T?bar(at):at===T?bar(at,100,101,106):at===T+M?bar(at,101,111):at===T+2*M?bar(at,120):bar(at,90));
 expect(qualityResultKey(row,g,0)).not.toBe(qualityResultKey(row,plan,0));const old=await run(g,path);expect(old.additionFill!.notional).toBe(100);expect((await run(plan,path,5,old)).additionFill).toMatchObject({quantity:.5,notional:60});expect(old.additionFill!.quantity).toBeCloseTo(100/120);
 expect(additionIdentity(plan.addition)[0]).toBe('holding-add-once-after-half-quantity-v2');
 for(const quantity of [0,-1,NaN,Infinity])expect(()=>validateQualityAddition({...plan.addition,quantityMode:'fixed',quantity})).toThrow('加仓数量');expect(()=>validateQualityAddition({...plan.addition,quantityMode:'fixed',quantity:.25})).not.toThrow();
});
it.each(['entry','fixed'] as const)('requires a realized half mirror even for %s coin sizing',async quantityMode=>{
 const plan={...group(),addition:{...group().addition!,quantityMode,quantity:.5}},path=load(at=>at<T?bar(at):at===T?bar(at,100,110):bar(at,120));
 for(const mirrorTakeProfit of [undefined,{enabled:true,gainPct:50,sellPct:50},{enabled:true,gainPct:5,sellPct:25},{enabled:true,gainPct:5,sellPct:100}]){
  const result=await run({...plan,mirrorTakeProfit},path);expect(result.additionFill).toBeUndefined();expect(result.additionNote).toContain('半仓镜像');
 }
});
it('defers a coin-sized addition past the half-mirror opening minute and freezes campaign PnL correctly',async()=>{
 const g={...group(),addition:{...group().addition!,quantityMode:'entry' as const,quantity:1},mirrorTakeProfit:{enabled:true,gainPct:15,sellPct:50}},path=load(at=>at<T?bar(at):at===T?bar(at,100,110):at===T+M?bar(at,120):bar(at,130));
 const result=await run(g,path);expect(result).toMatchObject({status:'open',additionFill:{at:T+2*M,price:130,quantity:.5,notional:65},mirrorFill:{at:T+M,price:120},totalInvested:165,pnl:25});
 const campaign=buildQualityCampaignData('owner',{sample:row,plan:g,detectors:[],result,observeHours:0,firstEvaluatedAt:result.evaluatedAt},'sell');expect(campaign.legs).toHaveLength(3);expect(qualityMirrorBoard(campaign.campaign)?.quantity).toBe(.5);
});
