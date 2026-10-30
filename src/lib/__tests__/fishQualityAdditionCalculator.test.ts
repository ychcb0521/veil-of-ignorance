import {evaluateCampaignAddSizing} from '@/lib/campaignAddSizingCheck';
import {describe,it,expect} from 'vitest';
import {evaluateQualitySample,type QualityGroup,type QualitySample} from '@/lib/fish/quality';
import {definitionKey} from '@/lib/deepDig/features';
import {defaultQualityAddition} from '@/lib/fish/qualityAddition';
import {calculateAddPosition,initialAddPositionState} from '@/lib/addPositionCoverage';
import {chartAtr} from '@/lib/atr';
import type {ResearchBar} from '@/lib/deepRsa/window';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
import {buildQualityCampaignData} from '@/lib/fish/qualityCampaigns';
import {computeCampaignRealizedPnl} from '@/lib/campaignRealizedPnl';
import {qualityMirrorBoard,qualityFinalSale} from '@/lib/fish/qualityMirrorBoard';
const M=60000,T=Date.UTC(2026,9,29);
const def={id:'round-add',name:'触发',short:'触发',definition:'',formula:'raw = B',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
const snapshot={featureId:def.id,featureName:def.name,featureShort:def.short,definitionKey:definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:.5,direction:'>' as const,average:1,cbi2:1,startAverage:1,previousAverage:0,cutoffMs:T};
const sample:QualitySample={id:'round',enteredAt:T,basis:'capture',importedAt:T,groups:[],source:{id:'round',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:'',fish:snapshot}};
const group=():QualityGroup=>({id:'g',label:'多轮',metric:'raw',snapshot,rule:{metric:'raw',direction:'<',threshold:-1},execution:'intrabar-1m',mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50},addition:{...defaultQualityAddition(),enabled:true,source:'custom',condition:{id:'add',label:'触发',metric:'raw',direction:'>',threshold:.5,enabled:true,snapshot}}});
const bar=(at:number,open=100,volume=0,low=open-1,high=open+1,close=open):ResearchBar=>({openTime:at,open,close,low,high,volume,quoteVolume:100,takerBuyVolume:0,takerBuyQuoteVolume:volume});
function loader(path:(minute:number)=>ResearchBar,atrChange=0,requests?:{from:number;to:number;step:number}[]):FishReconstructionLoader{return async(_row,from,to,p)=>{requests?.push({from,to,step:p.step});return Array.from({length:(to-from)/p.step},(_,i)=>{const at=from+i*p.step;if(p.step===M)return at<T?bar(at):path((at-T)/M);return bar(at,100,0,99,at>=T?101+atrChange:101);});};}
const rising=(minute:number)=>bar(T+minute*M,100+minute*10,minute<2?1:0,99+minute*10,minute===0?106:101+minute*10);
const run=async(g:QualityGroup,load:FishReconstructionLoader,n:number,previous?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>{const r=await evaluateQualitySample(sample,g,0,T+n*M,load,new AbortController().signal,previous);if(r.status==='error')throw Error(r.reason);return r;};
const campaign=(g:QualityGroup,r:Awaited<ReturnType<typeof run>>)=>buildQualityCampaignData('owner',{sample,plan:g,result:r,detectors:[],observeHours:0,firstEvaluatedAt:T},'sell');
describe('calculator additions with causal ATR and support stops',()=>{
 it('shares chart ATR true ranges, gap handling, EMA smoothing and seed',()=>{
  const values=chartAtr([{high:101,low:99,close:100},{high:111,low:109,close:110},{high:110,low:100,close:105}]);
  expect(values[0]).toBe(2);expect(values[1]).toBeCloseTo(11*2/15+2*13/15);expect(values[2]).toBeCloseTo(10*2/15+values[1]*13/15);
 });
 it('uses initial entry S then the preceding K, with calculator coin sizing and independently weighted real average',async()=>{
  const g=group(),r=await run(g,loader(rising),3);expect(r.status).toBe('open');expect(r.additionFills).toHaveLength(2);
  const [a,b]=r.additionFills!;const first=calculateAddPosition({currentPrice:110,support:107,state:initialAddPositionState(100,.5,2.5)}),second=calculateAddPosition({currentPrice:120,support:117,state:first.next!});
  expect(a).toMatchObject({at:T+M,price:110,quantity:expect.closeTo(first.addCoins),sizing:{support:107,previousSupport:100,atr:2,atrAt:T,coinsBefore:.5,realAverageBefore:100}});
  expect(b).toMatchObject({at:T+2*M,quantity:expect.closeTo(second.addCoins),sizing:{support:117,previousSupport:107,coinsBefore:expect.closeTo(first.newCoins),realAverageBefore:expect.closeTo(first.realAverage)}});
  expect(r.averageEntryPrice).toBeCloseTo(second.realAverage);expect(r.totalInvested).toBeCloseTo(100+a.notional+b.notional);
  const resumed=await run(g,loader(rising),3,await run(g,loader(rising),2));expect(resumed).toEqual(r);
 });
 it('only uses five-minute candles already closed at fill time, including after resume',async()=>{
  const requests:{from:number;to:number;step:number}[]=[],g=group();const r=await run(g,loader(rising,999,requests),3);
  expect(r.additionFills?.map(a=>a.sizing?.atr)).toEqual([2,2]);expect(requests.filter(r=>r.step===5*M).every(r=>r.to<=T)).toBe(true);
  expect(await run(g,loader(rising,999),3,await run(g,loader(rising,999),2))).toEqual(r);
 });
 it.each([false,true])('stops the whole multiround holding at K or a gap open (gap=%s) and records every lot',async gap=>{
  const g=group(),path=loader(m=>m<3?rising(m):bar(T+m*M,gap?110:125,0,gap?109:116)),r=await run(g,path,5);
  expect(r).toMatchObject({status:'closed',endTime:T+3*M,endPrice:gap?110:117,remainingQuantity:0,exitSnapshot:{cause:{kind:'addition-support',threshold:117},atOpen:gap}});expect(r.additionFills).toHaveLength(2);
  expect(r.reason).toContain(gap?'跳空':'触线');expect(r.pnl).toBeCloseTo(2.5+(.5+r.additionFills!.reduce((n,a)=>n+a.quantity,0))*r.endPrice!-(r.totalInvested!-50));
  const data=campaign(g,r);expect(data.legs.map(l=>l.leg_role)).toEqual(['main_open','mirror_tp','main_add_1','main_add_2']);expect(data.campaign.comparison?.sellEvidence?.additionFills).toEqual(r.additionFills);
  expect(computeCampaignRealizedPnl(data.campaign,data.legs,data.tradeRecords,{}).total).toBeCloseTo(r.pnl!);
  expect(await run(g,path,5,await run(g,path,3))).toEqual(r);
 });
 it('activates the new K immediately after an opening addition and gives an opening ordinary sell priority',async()=>{
  const g=group(),path=loader(m=>m===0?bar(T,100,1,99,106):bar(T+m*M,110,0,106));const r=await run(g,path,3);
  expect(r).toMatchObject({status:'closed',endTime:T+M,endPrice:107,additionFills:[{at:T+M}]});
  const ordinary=await run({...g,rule:{metric:'raw',direction:'>',threshold:.5}},path,3);expect(ordinary.status).toBe('closed');expect(ordinary.additionFills).toBeUndefined();
 });
 it('can restrict to a single calculator addition while keeping its support stop active',async()=>{
  const g=group();g.addition!.repeat=false;const r=await run(g,loader(m=>m<3?rising(m):bar(T+m*M,110,0,105)),5);
  expect(r.additionFills).toHaveLength(1);expect(r).toMatchObject({status:'closed',endTime:T+3*M,endPrice:107});
 });
 it('skips an uncovered addition without advancing S or installing an imaginary stop',async()=>{
  const r=await run(group(),loader(m=>m===0?bar(T,100,1,99,106):bar(T+m*M,90,m<2?1:0,89)),4);expect(r.status).toBe('open');expect(r.additionFills).toBeUndefined();
 });
 it('consumes banked mirror profit once across rounds and keeps accounting after a partial mirror aligned',async()=>{
  const g={...group(),mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50}},path=loader(m=>m===0?bar(T,100,1,99,106):rising(m));const r=await run(g,path,3);
  expect(r.additionFills).toHaveLength(2);const [a,b]=r.additionFills!;
  expect(a.sizing).toMatchObject({coinsBefore:.5,mirrorUsed:2.5});expect(a.quantity).toBeCloseTo((.5*7+2.5)/3);expect(b.sizing?.mirrorUsed).toBe(0);expect(b.sizing!.realAverageBefore).not.toBe(b.sizing!.previousSupport);expect(b.sizing?.coinsBefore).toBeCloseTo(.5+a.quantity);
  const data=campaign(g,r);expect(qualityMirrorBoard(data.campaign)?.quantity).toBe(.5);expect(r.mirrorRealizedPnl).toBeCloseTo(2.5);
  const closed=await run(g,loader(m=>m===0?bar(T,100,1,99,106):m<3?rising(m):bar(T+m*M,110,0,109)),5);const final=campaign(g,closed);expect(computeCampaignRealizedPnl(final.campaign,final.legs,final.tradeRecords,{}).total).toBeCloseTo(closed.pnl!);
 });
 it.each([false,true])('waits until a later minute after a half mirror, using only the unsold coins (atOpen=%s)',async atOpen=>{
  const g={...group(),mirrorTakeProfit:{enabled:true,gainPct:15,sellPct:50}},path=loader(m=>m===0?bar(T,100,1):m===1?bar(T+M,atOpen?116:110,1,atOpen?115:109,117):rising(m));
  const r=await run(g,path,3);expect(r.mirrorFill).toMatchObject({at:T+M,atOpen});expect(r.additionFills).toHaveLength(1);
  const a=r.additionFills![0],P=.5*(r.mirrorFill!.price-100);expect(a).toMatchObject({at:T+2*M,sizing:{coinsBefore:.5,previousSupport:100,mirrorUsed:expect.closeTo(P)}});expect(a.quantity).toBeCloseTo((.5*17+P)/3);
  const resumed=await run(g,path,3,await run(g,path,2));expect(resumed).toMatchObject({additionFills:r.additionFills,mirrorFill:r.mirrorFill,totalInvested:r.totalInvested,remainingQuantity:r.remainingQuantity,averageEntryPrice:r.averageEntryPrice,pnl:r.pnl,endTime:r.endTime,endPrice:r.endPrice});
 });
 it.each([undefined,{enabled:false,gainPct:5,sellPct:50},{enabled:true,gainPct:50,sellPct:50},{enabled:true,gainPct:5,sellPct:25},{enabled:true,gainPct:5,sellPct:100}])('never adds before an actual half mirror or after a different mirror ratio (%j)',async mirrorTakeProfit=>{
  const g={...group(),mirrorTakeProfit},requests:{from:number;to:number;step:number}[]=[],r=await run(g,loader(rising,0,requests),3);expect(r.additionFill).toBeUndefined();expect(r.additionFills).toBeUndefined();expect(requests.some(r=>r.step===5*M)).toBe(false);expect(r.additionNote).toContain('半仓镜像');
 });
 it('does not carry a pre-mirror trigger into a later addition when no fresh condition qualifies',async()=>{
  const g={...group(),mirrorTakeProfit:{enabled:true,gainPct:15,sellPct:50}},r=await run(g,loader(m=>bar(T+m*M,m<3?100:120,m<2?1:0,m<3?99:119,m===2?116:m<3?101:121)),5);
  expect(r.mirrorFill).toMatchObject({at:T+2*M,atOpen:false});expect(r.additionFill).toBeUndefined();
 });
 it('fully closes the initial holding without additions when the mirror sells 100%',async()=>{
  const g={...group(),mirrorTakeProfit:{enabled:true,gainPct:35,sellPct:100}},r=await run(g,loader(m=>m<3?rising(m):bar(T+m*M,130,0,129,140)),5);
  expect(r).toMatchObject({status:'closed',endPrice:135,pnl:expect.closeTo(35)});expect(r.additionFills).toBeUndefined();const data=campaign(g,r);expect(data.legs).toHaveLength(1);expect(qualityMirrorBoard(data.campaign)?.quantity).toBe(1);
 });
 it('sells all original remaining coins and every addition together on an ordinary final exit',async()=>{
  const g={...group(),snapshot:{...snapshot,definitionKey:definitionKey({...def,formula:'raw = C'})},rule:{metric:'raw',direction:'>' as const,threshold:125}},r=await run(g,loader(rising),5),data=campaign(g,r);
  const Q=.5+r.additionFills!.reduce((n,a)=>n+a.quantity,0),closes=data.tradeRecords.filter(t=>t.exit_reason_text!=='镜像止盈');
  expect(r).toMatchObject({status:'closed',endTime:T+4*M,remainingQuantity:0});expect(closes).toHaveLength(3);expect(closes.every(t=>t.closeTime===r.endTime&&t.exitPrice===r.endPrice)).toBe(true);expect(closes.reduce((n,t)=>n+t.quantity,0)).toBeCloseTo(Q);
  expect(qualityFinalSale(data.campaign,data.tradeRecords)).toMatchObject({at:r.endTime,price:r.endPrice,quantity:expect.closeTo(Q),label:'余仓＋加仓 · 全部卖出'});expect(data.legs.every(l=>l.post_simulated_close_time!=null)).toBe(true);
  expect(computeCampaignRealizedPnl(data.campaign,data.legs,data.tradeRecords).total).toBeCloseTo(r.pnl!);
 });
 it('uses the personal campaign validation engine for every frozen ATR addition and ignores the shared batch evaluation clock',async()=>{
  const g=group(),r=await run(g,loader(rising),3),data=campaign(g,r),checks=evaluateCampaignAddSizing(data);
  for(const [i,fill] of r.additionFills!.entries()){
   const leg=data.legs.find(l=>l.leg_role===`main_add_${i+1}`)!,v=checks.get(leg.id)!;
   expect(v).toMatchObject({status:'ok',s1:fill.sizing!.support,s2:fill.price,x1Coins:expect.closeTo(fill.sizing!.coinsBefore),x2Coins:expect.closeTo(fill.quantity),maxAllowedCoins:expect.closeTo(fill.quantity)});
  }
  const legacy={...data,legs:data.legs.map(l=>({...l,quality_addition_fill:undefined,pre_planned_stop_loss:999}))};expect([...evaluateCampaignAddSizing(legacy).values()].every(v=>v.status==='unknown'&&v.reason==='no_stop_line')).toBe(true);
 });
 it('exports each frozen round with S, K and closed ATR evidence in both libraries',async()=>{
  const {newQualityStudy,importQualityLibrary,qualityComparisonRows}=await import('@/lib/fish/quality');
  const {buildQualitySheets}=await import('@/lib/fish/qualityExport');
  const {beginQualityMonitorRound,captureQualityMonitorResult}=await import('@/lib/fish/qualityMonitorLibrary');
  const {buildMonitorSheets}=await import('@/lib/fish/qualityMonitorTable');
  const g=group(),study={...importQualityLibrary(newQualityStudy(T),[sample.source]),sellPlans:[g]},row=qualityComparisonRows(study)[0];study.selectedRowIds=[row.id];
  const r=await evaluateQualitySample(row,g,0,T+3*M,loader(rising),new AbortController().signal);study.results=[r];
  const sheets=buildQualitySheets(study,[row]),detail=sheets.find(s=>s.name==='加仓明细')!;expect(detail.rows).toHaveLength(2);expect(detail.rows.map(row=>row.slice(7,10))).toEqual([[100,107,2],[107,117,2]]);expect(detail.rows.map(row=>row.at(-1))).toEqual([.5,2.5]);
  const begun=beginQualityMonitorRound(study,study,T),saved=captureQualityMonitorResult(begun.study,begun.capture,r,T+3*M),lib=saved.monitorLibrary!;
  const output=buildMonitorSheets(lib.records,new Map(lib.settings.map(s=>[s.id,s]))).find(s=>s.name==='加仓记录')!;expect(output.rows).toHaveLength(2);expect(output.rows.map(row=>row.slice(12,16))).toEqual([[1,100,107,2],[2,107,117,2]]);expect(output.rows.map(row=>row.at(-1))).toEqual([.5,2.5]);
  for(const sheet of [...sheets,output])expect(sheet.rows.every(row=>row.length===sheet.columns.length)).toBe(true);
 });
 it('keeps every round beyond the six manual journal role presets distinct',async()=>{
  const g=group(),r=await run(g,loader(m=>bar(T+m*M,100+m*10,m<8?1:0,99+m*10,m===0?106:101+m*10)),9);expect(r.additionFills).toHaveLength(8);expect(campaign(g,r).legs.at(-1)?.leg_role).toBe('main_add_8');
 });
});
