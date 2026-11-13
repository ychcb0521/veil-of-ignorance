import {HOLDING_LEDGER_ADDITION_VERSION,replayQualityHoldingLedger} from '@/lib/fish/qualityHoldingLedger';
import {findCalculatorAdditions} from '@/lib/fish/qualityAdditionCalculator';
import {positionGeometricMultiple} from '@/lib/campaignGeometricMetrics';
import {additionMetricBaseDefinition, additionMetricTimeFields, withAdditionMetricTime} from '@/lib/fish/qualityAdditionMetric';
import {syncQualityThresholdDefinitions} from '@/lib/fish/qualityComparison';
import {displayAverage} from '@/lib/avgHighlight';
import {makeQualityHoldingVeto} from '@/lib/fish/qualityFilters';
import {evaluateCampaignAddSizing} from '@/lib/campaignAddSizingCheck';
import {describe,it,expect} from 'vitest';
import {evaluateQualitySample,newQualityStudy,qualityDefinition,type QualityGroup,type QualitySample} from '@/lib/fish/quality';
import {definitionKey} from '@/lib/deepDig/features';
import {ADDITION_INDICATOR_INCREASE_VERSION, defaultQualityAddition, type AdditionIncreaseMetric} from '@/lib/fish/qualityAddition';
import {calculateAddPosition,initialAddPositionState} from '@/lib/addPositionCoverage';
import {chartAtr} from '@/lib/atr';
import type {ResearchBar} from '@/lib/deepRsa/window';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
import {freezeQualityPlan, planVersionChanges} from '@/lib/fish/qualityPlanVersions';
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
 it.each([[undefined,'启用镜像止盈'],[{enabled:false,gainPct:5,sellPct:50},'启用镜像止盈'],[{enabled:true,gainPct:50,sellPct:50},'等待镜像止盈实际成交'],[{enabled:true,gainPct:5,sellPct:100},'没有余仓']] as const)('never adds without a filled partial mirror (%j)',async(mirrorTakeProfit,note)=>{
  const g={...group(),mirrorTakeProfit},requests:{from:number;to:number;step:number}[]=[],r=await run(g,loader(rising,0,requests),3);expect(r.additionFill).toBeUndefined();expect(r.additionFills).toBeUndefined();expect(requests.some(r=>r.step===5*M)).toBe(false);expect(r.additionNote).toContain(note);
 });
 it('adds after a filled mirror of any partial ratio, sizing from the coins actually left (2026-11-02: no longer only 50%)',async()=>{
  const g={...group(),mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:25}},r=await run(g,loader(rising),3);
  expect(r.additionNote).toBeUndefined();expect(r.mirrorFill?.fraction).toBe(.25);expect(r.additionFills?.[0].sizing?.coinsBefore).toBeCloseTo(.75);
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

it('includes realized half-mirror profit in the first addition exactly as the calculator; a hit close above S still adds (entry distance removed)',async()=>{
 const r=await run(group(),loader(rising),3),[a,b]=r.additionFills!;
 expect(a.sizing).toMatchObject({coinsBefore:.5,mirrorAvailableBefore:2.5,mirrorUsed:2.5,baseCoins:expect.closeTo(7/6),mirrorCoins:expect.closeTo(5/6)});expect(a.quantity).toBeCloseTo(2);
 expect(b.sizing).toMatchObject({mirrorAvailableBefore:0,mirrorUsed:0,mirrorCoins:0});
 const close=await run(group(),loader(m=>m===0?bar(T,100,1,99,106):bar(T+m*M,102,0,101)),3),c=close.additionFill!;expect(c).toMatchObject({price:102,sizing:{previousSupport:100,support:99}});expect(c.sizing!.coinsBefore*(c.sizing!.support-c.sizing!.previousSupport)+c.sizing!.mirrorUsed).toBeCloseTo(c.quantity*(c.price-c.sizing!.support));
});
// 【用户要求】2026-11-01 涨幅门槛相对最新成本线 S（首轮为首次买入价，之后为上一次加仓的 K），不是持仓均价
it('rechecks gain against the latest cost line S after every successful addition',async()=>{
 const g=group();g.addition={...g.addition!,minGainPct:5};
 const prices=[100,110,114,118,121,123],path=loader(m=>bar(T+m*M,prices[m]??123,1,(prices[m]??123)-1,m===0?106:(prices[m]??123)+1));
 const r=await run(g,path,6),[a,b]=r.additionFills!;expect(r.additionFills).toHaveLength(2);
 expect(a.priceGate).toMatchObject({basis:'cost-line',referencePrice:100,thresholdPct:5,observedPrice:110,confirmedAt:T+2*M});
 expect(b.priceGate).toMatchObject({basis:'cost-line',referencePrice:a.sizing!.support,thresholdPct:5});expect(b.priceGate!.observedPrice).toBeGreaterThanOrEqual(a.sizing!.support*1.05);
 // 两次加仓之间没有更早达标的收盘：第二次就是第一根越过「上一次 K × 1.05」的收盘
 // 第 m 根 K 线在 T+(m+1) 分钟收盘；确认第二次加仓的是第 (confirmedAt−T)/M − 1 根
 const confirming=(b.priceGate!.confirmedAt-T)/M-1;expect(b.priceGate!.observedPrice).toBe(prices[confirming]??123);
 for(let m=(a.at-T)/M;m<confirming;m++)expect(prices[m]??123).toBeLessThan(a.sizing!.support*1.05);for(const v of evaluateCampaignAddSizing(campaign(g,r)).values())expect(v.status).toBe('ok');
 expect(await run(g,path,6,await run(g,path,3))).toEqual(r);
 const stopped=await run(g,loader(m=>bar(T+m*M,[100,110,114,110][m]??110,1,([100,110,114,110][m]??110)-1,m===0?106:([100,110,114,110][m]??110)+1)),5);expect(stopped).toMatchObject({status:'closed',endTime:T+3*M,endPrice:110,remainingQuantity:0});expect(stopped.additionFills).toHaveLength(1);
});
it('requires every custom indicator and gain gate together, preserving the observations in campaign and library output',async()=>{
 const g=group(),first=g.addition!.condition!,second={...first,id:'second',label:'价格约束',snapshot:{...snapshot,definitionKey:definitionKey({...def,formula:'raw = C'})},threshold:115};g.addition={...g.addition!,conditions:[first,second],minGainPct:5};
 const prices=[100,110,114,118,121],path=loader(m=>bar(T+m*M,prices[m]??121,1,(prices[m]??121)-1,m===0?106:(prices[m]??121)+1)),r=await run(g,path,5);
 expect(r.additionFills).toHaveLength(1);expect(r.additionFill).toMatchObject({at:T+4*M,priceGate:{observedPrice:118,referencePrice:100},conditions:[{reading:1,threshold:.5,at:T+4*M},{reading:118,threshold:115,at:T+4*M}]});
 expect(campaign(g,r).campaign.comparison!.sellEvidence!.additionFills).toEqual(r.additionFills);
 const single={...g,addition:{...g.addition!,conditions:undefined}};expect((await run(single,path,5)).additionFills![0].at).toBe(T+2*M);
 const fixed={...g,addition:{...g.addition!,quantityMode:'fixed' as const,quantity:3}};expect((await run(fixed,path,5)).additionFill).toMatchObject({at:T+4*M,quantity:3,conditions:[{reading:1},{reading:118}]});
});
it('checks confirmed closing gain instead of an intrabar peak or the following opening gap',async()=>{
 const g=group();g.addition={...g.addition!,minGainPct:5};
 const onlyHigh=await run(g,loader(m=>bar(T+m*M,m===0?100:110,1,99,120,100)),3);expect(onlyHigh.mirrorFill).toBeDefined();expect(onlyHigh.additionFill).toBeUndefined();
 const confirmed=await run(g,loader(m=>m===0?bar(T,100,1,99,106,105):bar(T+m*M,104,0,103)),2);expect(confirmed.additionFill).toMatchObject({at:T+M,price:104,priceGate:{observedPrice:105,gainPct:expect.closeTo(5)}});
});
it('exports frozen conjunctive readings, cost-line gain and banked-profit contributions in both downloads',async()=>{
 const {newQualityStudy,importQualityLibrary,qualityComparisonRows}=await import('@/lib/fish/quality'),{buildQualitySheets}=await import('@/lib/fish/qualityExport'),{beginQualityMonitorRound,captureQualityMonitorResult}=await import('@/lib/fish/qualityMonitorLibrary'),{buildMonitorSheets}=await import('@/lib/fish/qualityMonitorTable');
 const g=group();g.addition={...g.addition!,conditions:[g.addition!.condition!,{...g.addition!.condition!,id:'price',label:'价格',snapshot:{...snapshot,definitionKey:definitionKey({...def,formula:'raw = C'})},threshold:115}],minGainPct:5};
 const study={...importQualityLibrary(newQualityStudy(T),[sample.source]),sellPlans:[g]},row=qualityComparisonRows(study)[0];study.selectedRowIds=[row.id];const r=await evaluateQualitySample(row,g,0,T+5*M,loader(m=>bar(T+m*M,100+m*10,1,99+m*10,m===0?106:101+m*10)),new AbortController().signal);study.results=[r];
 const begun=beginQualityMonitorRound(study,study,T),saved=captureQualityMonitorResult(begun.study,begun.capture,r,T+5*M),lib=saved.monitorLibrary!;
 const sheets=[...buildQualitySheets(study,[row]),...buildMonitorSheets(lib.records,new Map(lib.settings.map(s=>[s.id,s])))];
 for(const sheet of sheets){expect(sheet.rows.every(row=>row.length===sheet.columns.length)).toBe(true);if(!['加仓明细','加仓记录'].includes(sheet.name))continue;const headers=sheet.columns.map(c=>c.header),values=sheet.rows[0];expect(JSON.parse(values[headers.indexOf('同时满足的指标 JSON')] as string)).toHaveLength(2);expect(values[headers.indexOf('涨幅门槛 %')]).toBe(5);expect(values[headers.indexOf('涨幅基准价')]).toBe(100);expect(values[headers.indexOf('本轮可用落袋利润 USDT')]).toBe(2.5);expect(values[headers.indexOf('落袋利润贡献币数')]).toBeGreaterThan(0);expect(values[headers.indexOf('K回撤ATR倍数')]).toBe(1.5);expect(values[headers.indexOf('最低ATR距离')]??null).toBeNull();}
});
// 2026-11-01 用户删除「入场距离 T ≥ S＋n×ATR」：位置达到即按均衡线 K 定量，不再要求 T 高出 S 多少（旧版 T＜104 不加仓）。
it.each([100.5,102,103.999,104,110])('adds at T=%s without any minimum distance above dynamic S, balanced at K',async price=>{
 const r=await run(group(),loader(m=>m===0?bar(T,100,1,99,106):bar(T+m*M,price,0,price-.1)),3);expect(r.additionFill).toBeDefined();
 const a=r.additionFill!,z=a.sizing!;expect(z.requiredBufferAtr).toBeUndefined();expect(z).toMatchObject({costBufferAtr:expect.closeTo((price-100)/2),coverageGap:expect.closeTo(0)});expect(z.support).toBeCloseTo(price-3);
 expect(z.coinsBefore*(z.support-z.previousSupport)+z.mirrorUsed).toBeCloseTo(a.quantity*(a.price-z.support));
});
it('uses the previous K as dynamic S and balances all rounds at K',async()=>{
 const path=loader(m=>{const p=[100,104,104.5,105,105][m]??105;return bar(T+m*M,p,m<3?1:0,p-.1,m===0?106:p+.1);}),r=await run(group(),path,5);
 expect(r.additionFills!.map(a=>a.at)).toEqual([T+M,T+2*M,T+3*M]);const [first,second,third]=r.additionFills!;expect(first.quantity).toBeCloseTo(1);expect(second.quantity).toBeCloseTo(.25);expect(third.quantity).toBeCloseTo(.875/3);expect(second.sizing).toMatchObject({previousSupport:101,support:101.5,mirrorAvailableBefore:0,costBufferAtr:1.75});expect(third.sizing).toMatchObject({previousSupport:101.5,support:102});
 for(const a of r.additionFills!){const z=a.sizing!;expect(z.coinsBefore*(z.support-z.previousSupport)+z.mirrorUsed).toBeCloseTo(a.quantity*(a.price-z.support));expect((z.coinsBefore*z.previousSupport+a.quantity*a.price-z.mirrorUsed)/(z.coinsBefore+a.quantity)).toBeCloseTo(z.support);expect(z.coverageGap).toBeCloseTo(0);}
 for(const v of evaluateCampaignAddSizing(campaign(group(),r)).values())expect(v.status).toBe('ok');expect(await run(group(),path,5,await run(group(),path,2))).toEqual(r);
});
it('uses independent round conditions in order, respects the cap after resume, and keeps the final K stop armed',async()=>{
 const g=group(),first=g.addition!.condition!,second={...first,threshold:1.5,label:'第二次门槛'};g.addition={...g.addition!,maxRounds:2,rounds:[{source:'custom',stricterPct:10,condition:first,minGainPct:5},{source:'custom',stricterPct:10,condition:second,minGainPct:10}]};
 const path=loader(m=>{const p=[100,110,114,118,125,132,140,150][m]??150;return bar(T+m*M,p,m===0||m===1?1:m===3||m>=5?2:0,p-1,m===0?106:p+1);});
 const r=await run(g,path,8);expect(r.additionFills!.map(a=>a.at)).toEqual([T+2*M,T+6*M]);expect(r.additionFills![0].priceGate?.thresholdPct).toBe(5);expect(r.additionFills![1]).toMatchObject({threshold:1.5,label:'第二次门槛',priceGate:{thresholdPct:10}});expect(await run(g,path,8,await run(g,path,4))).toEqual(r);
 const stopped=await run(g,loader(m=>m<7?([100,110,114,118,125,132,140].map((p,i)=>bar(T+i*M,p,i===0||i===1?1:i===3||i>=5?2:0,p-1,i===0?106:p+1))[m]):bar(T+m*M,135,5,134)),9);expect(stopped).toMatchObject({status:'closed',endTime:T+7*M,endPrice:135,remainingQuantity:0});expect(stopped.additionFills).toHaveLength(2);
 const changed={...g,addition:{...g.addition!,rounds:[g.addition!.rounds![0],{...g.addition!.rounds![1],minGainPct:20}]}};expect((await run(changed,path,8)).key).not.toBe(r.key);
});

it.each([101,105.999,106])('uses the configured root K offset at T=%s; a stale entry distance in old data is ignored',async price=>{
 const g=group();g.addition={...g.addition!,entryBufferAtr:3,supportOffsetAtr:2};
 const r=await run(g,loader(m=>m===0?bar(T,100,1,99,106):bar(T+m*M,price,0,price-.1)),3);expect(r.additionFill).toBeDefined();
 const a=r.additionFill!,z=a.sizing!;expect(z).toMatchObject({supportOffsetAtr:2,atr:2,support:expect.closeTo(price-4)});expect(z.requiredBufferAtr).toBeUndefined();expect(a.quantity).toBeCloseTo((.5*(z.support-100)+2.5)/4);
});
it('applies each round’s own K offset to sizing, frozen evidence, resume and whole-position stops',async()=>{
 const g=group(),round={source:'custom' as const,stricterPct:10,condition:g.addition!.condition};
 g.addition={...g.addition!,maxRounds:2,rounds:[{...round,supportOffsetAtr:1},{...round,supportOffsetAtr:2}]};
 const path=loader(m=>{const p=[100,107.9,108,110,112,114][m]??113;return bar(T+m*M,p,1,m>=6?107:p-.1,m===0?106:p+.1);});
 const r=await run(g,path,6),[first,second]=r.additionFills!;expect(r.additionFills!.map(a=>a.at)).toEqual([T+M,T+3*M]);
 expect(first).toMatchObject({quantity:expect.closeTo(2.725),sizing:{previousSupport:100,support:expect.closeTo(105.9),supportOffsetAtr:1,mirrorUsed:2.5}});
 expect(second).toMatchObject({quantity:expect.closeTo(.3225/4),sizing:{previousSupport:expect.closeTo(105.9),support:106,supportOffsetAtr:2,mirrorUsed:0}});
 for(const a of r.additionFills!){const z=a.sizing!;expect(z.coinsBefore*(z.support-z.previousSupport)+z.mirrorUsed).toBeCloseTo(a.quantity*(a.price-z.support));expect(z.coverageGap).toBeCloseTo(0);}
 expect(await run(g,path,6,await run(g,path,3))).toEqual(r);
 const data=campaign(g,r);expect(data.campaign.comparison!.sellEvidence!.additionFills).toEqual(r.additionFills);expect(data.legs.filter(l=>l.quality_addition_fill).map(l=>l.quality_addition_fill!.sizing!.supportOffsetAtr)).toEqual([1,2]);for(const v of evaluateCampaignAddSizing(data).values())expect(v.status).toBe('ok');
 const drop=loader(m=>{const p=[100,107.9,108,110,112,114][m]??113;return bar(T+m*M,p,1,m>=6?105.5:p-.1,m===0?106:p+.1);});
 const stopped=await run(g,drop,8);expect(stopped).toMatchObject({status:'closed',endTime:T+6*M,endPrice:106,remainingQuantity:0});expect(stopped.additionFills).toHaveLength(2);expect(await run(g,drop,8,await run(g,drop,6))).toEqual(stopped);
 const changed={...g,addition:{...g.addition!,rounds:[g.addition!.rounds![0],{...g.addition!.rounds![1],supportOffsetAtr:3}]}};expect((await run(changed,path,6)).key).not.toBe(r.key);
});
it('allows a wider K offset when banked mirror profit covers the old-position loss, still sizing at exact balance',async()=>{
 const g=group();g.addition={...g.addition!,supportOffsetAtr:2,maxRounds:1};
 const r=await run(g,loader(m=>m===0?bar(T,100,1,99,106):bar(T+m*M,102,0,101)),3);expect(r.additionFill).toMatchObject({price:102,quantity:.375,sizing:{support:98,previousSupport:100,mirrorUsed:2.5,supportOffsetAtr:2,coverageGap:0}});
});

const geometricProfit=(multiple=100,gain=5)=>makeQualityHoldingVeto('addition-geometric-profit','>=',gain,true,undefined,multiple);
it('sells all lots after geometric position reaches the default 100× and price touches 5% above the latest equilibrium K, even at the addition cap',async()=>{
 const g=group();g.addition!.maxRounds=4;g.holdingVetoes=[geometricProfit()];
 const path=loader(m=>{const p=[100,110,120,130,140,143][m]??143;return bar(T+m*M,p,1,p-.1,m===0?106:m===5?144:p+1);});
 const r=await run(g,path,8);expect(r).toMatchObject({status:'closed',endTime:T+5*M,endPrice:expect.closeTo(143.85),remainingQuantity:0,exitSnapshot:{cause:{kind:'addition-geometric-profit',geometricMultiple:100,threshold:5,additionBasis:{equilibriumPrice:137,targetPrice:expect.closeTo(143.85)}}}});expect(r.additionFills).toHaveLength(4);
 const data=campaign(g,r),basis=r.exitSnapshot!.cause!.additionBasis!;expect(basis.geometricMultiple).toBeGreaterThan(100);expect(basis.geometricMultiple).toBeCloseTo(positionGeometricMultiple(r.additionFills!.map(a=>a.quantity/a.sizing!.coinsBefore),.5)!);expect(data.campaign.comparison!.sellEvidence!.holdingVetoes![0]).toMatchObject({geometricMultiple:100});expect(computeCampaignRealizedPnl(data.campaign,data.legs,data.tradeRecords,{}).total).toBeCloseTo(r.pnl!);expect(r.reason).toContain('卖出全部余仓与加仓');expect(await run(g,path,8,await run(g,path,5))).toEqual(r);
});
it.each([[1000,5],[100,50]])('does not sell when only one part of the joint condition is satisfied (position=%s, gain=%s)',async(multiple,gain)=>{
 const g=group();g.addition!.maxRounds=4;g.holdingVetoes=[geometricProfit(multiple,gain)];const r=await run(g,loader(m=>{const p=[100,110,120,130,140,143][m]??143;return bar(T+m*M,p,1,p-.1,m===0?106:p+1);}),8);expect(r.status).toBe('open');expect(r.additionFills).toHaveLength(4);
});
it('uses latest K rather than weighted average, and cannot activate before a real addition',async()=>{
 const g=group();g.addition!.maxRounds=1;g.holdingVetoes=[geometricProfit(2,5)];
 const path=loader(m=>m===0?bar(T,100,1,99,106):m===1?bar(T+M,110,1,109,111):bar(T+m*M,112.2,1,112.1,112.4));
 const r=await run(g,path,4);expect(r).toMatchObject({status:'closed',endTime:T+2*M,endPrice:expect.closeTo(112.35),exitSnapshot:{cause:{additionBasis:{geometricMultiple:2.5,equilibriumPrice:107}}}});
 const disabled=await run({...g,addition:{...g.addition!,enabled:false}},path,4);expect(disabled.status).toBe('open');expect(disabled.additionFill).toBeUndefined();
});
it.each([false,true])('keeps protective-stop priority when intraminute order is unknown, while respecting a known profit at the open (open=%s)',async(open)=>{
 const g=group();g.addition!.maxRounds=1;g.holdingVetoes=[geometricProfit(2,5)];
 const r=await run(g,loader(m=>m===0?bar(T,100,1,99,106):m===1?bar(T+M,110,1,109,111):bar(T+m*M,open?114:111,1,106,115)),4);
 expect(r).toMatchObject({status:'closed',endTime:T+2*M,endPrice:open?114:107,exitSnapshot:{atOpen:open,cause:{kind:open?'addition-geometric-profit':'addition-support'}}});
});
it('evaluates multiple addition-profit rules independently and preserves the earliest rule and resumed fills',async()=>{
 const g=group();g.addition!.maxRounds=2;g.holdingVetoes=[geometricProfit(1000,0),geometricProfit(3,5)];
 const path=loader(m=>{const p=[100,110,120,130,200][m]??200;return bar(T+m*M,p,1,p-.1,m===0?106:p+1);});const r=await run(g,path,6);
 expect(r).toMatchObject({status:'closed',endTime:T+3*M,endPrice:130,exitSnapshot:{atOpen:true,cause:{kind:'addition-geometric-profit',geometricMultiple:3,threshold:5}}});expect(r.additionFills).toHaveLength(2);expect(await run(g,path,6,await run(g,path,3))).toEqual(r);
});

it('rejects invalid minute highs instead of treating a missing high as a profit-target touch',async()=>{
 const mirror=(await run(group(),loader(rising),2)).mirrorFill!;
 for(const high of [NaN,Infinity,90])await expect(findCalculatorAdditions({candidates:[],row:sample.source,entry:T,entryPrice:100,notional:100,end:T+2*M,since:T,prices:[rising(0),{...rising(1),high}],previous:[],mirror,repeat:true,load:loader(rising),signal:new AbortController().signal})).rejects.toThrow('加仓行情读数无效');
});

// New execution is explicit; every mirror-first test above keeps its old version.
describe('general holding-ledger additions, mirror optional',()=>{
 const general=()=>{const g=group();g.addition={...g.addition!,positionVersion:HOLDING_LEDGER_ADDITION_VERSION};return g;};
 it.each([undefined,{enabled:false,gainPct:5,sellPct:50},{enabled:true,gainPct:1000,sellPct:50}])('adds before a mirror exists or triggers (%j)',async mirrorTakeProfit=>{
  const g={...general(),mirrorTakeProfit},r=await run(g,loader(rising),3);expect(r.additionFills).toHaveLength(2);expect(r.additionNote).toBeUndefined();expect(r.mirrorFill).toBeUndefined();expect(r.additionFills![0]).toMatchObject({positionVersion:HOLDING_LEDGER_ADDITION_VERSION,sizing:{coinsBefore:1},ledger:{costBefore:100,realizedBefore:0,mirrorQuantityBefore:0}});
  const p=replayQualityHoldingLedger({notional:100,entryPrice:100,entryAt:T,additions:r.additionFills!});expect(r.pnl).toBeCloseTo(p.held*r.endPrice!-p.cost+p.realized,8);
 });
 it('handles additions on both sides of a partial mirror and resumes with identical evidence',async()=>{
  const g=general();g.mirrorTakeProfit={enabled:true,gainPct:35,sellPct:67};g.addition!.maxRounds=3;
  const load=loader(m=>{const open=100+m*10;return bar(T+m*M,open,[0,1,3,4].includes(m)?1:0,open-1,m===3?136:open+1);});
  const r=await run(g,load,6);expect(r.mirrorFill?.at).toBe(T+3*M);expect(r.additionFills).toHaveLength(3);expect(r.additionFills!.map(f=>f.at)).toEqual([T+M,T+2*M,T+4*M]);
  const beforeThird=replayQualityHoldingLedger({notional:100,entryPrice:100,entryAt:T,additions:r.additionFills!.slice(0,2),mirror:r.mirrorFill,through:T+4*M});expect(r.additionFills![2].ledger!.costBefore).toBeCloseTo(beforeThird.cost,9);expect(r.additionFills![2].ledger!.realizedBefore).toBeCloseTo(beforeThird.realized,9);
  const resumed=await run(g,load,6,await run(g,load,3));expect(resumed.additionFills).toEqual(r.additionFills);expect(resumed.pnl).toBeCloseTo(r.pnl!,9);
  const data=campaign(g,r),mirrorTrades=data.tradeRecords.filter(t=>t.exit_reason_text==='镜像止盈');expect(mirrorTrades.reduce((n,t)=>n+t.quantity,0)).toBeCloseTo(.67,10);expect(mirrorTrades.reduce((n,t)=>n+t.pnl,0)).toBeCloseTo(r.mirrorRealizedPnl!,8);
  const checks=evaluateCampaignAddSizing(data);expect([...checks.values()].every(c=>c.status==='ok')).toBe(true);
 });
 it('does not retain a future mirror after an earlier K exit',async()=>{
  const g=general();g.mirrorTakeProfit={enabled:true,gainPct:500,sellPct:50};const load=loader(m=>bar(T+m*M,100+m*10,m<2?1:0,m===2?90:99+m*10,m===5?700:101+m*10));const r=await run(g,load,7);expect(r.status).toBe('closed');expect(r.endTime).toBeLessThan(T+5*M);expect(r.mirrorFill).toBeUndefined();expect(campaign(g,r).tradeRecords.some(t=>t.exit_reason_text==='镜像止盈')).toBe(false);
 });
 it('full mirror closes the actual inventory including all preceding additions',async()=>{
  const g=general();g.mirrorTakeProfit={enabled:true,gainPct:35,sellPct:100};const r=await run(g,loader(m=>bar(T+m*M,100+m*10,m<2?1:0,99+m*10,m===3?136:101+m*10)),5);expect(r.status).toBe('closed');expect(r.additionFills).toHaveLength(2);expect(r.mirrorFill?.fraction).toBe(1);expect(r.remainingQuantity).toBe(0);expect(r.mirrorRealizedPnl).toBeCloseTo(r.pnl!,8);const data=campaign(g,r);expect(data.tradeRecords.filter(t=>t.action==='CLOSE').every(t=>t.exit_reason_text==='镜像止盈')).toBe(true);expect(computeCampaignRealizedPnl(data.campaign,data.legs,data.tradeRecords).total).toBeCloseTo(r.pnl!,8);
 });
 it('supports add-only closed-bar monitoring without mirror or ordinary sell rules',async()=>{
  const g=general();g.rule=undefined;g.execution=undefined;g.mirrorTakeProfit=undefined;const r=await run(g,loader(rising),3);expect(r.status).toBe('open');expect(r.additionFills).toHaveLength(2);
 });
 it('keeps the shared fast-drop veto independently effective without mirror',async()=>{
  const g=general();g.mirrorTakeProfit=undefined;const load=loader(m=>m===0?bar(T,100,1,89,101,90):rising(m));const plain=await run(g,load,3);expect(plain.additionFills).toHaveLength(2);
  g.addition!.entryVetoes=[{kind:'fast-drop',enabled:true,windows:[{minutes:1,pct:5}]}];const blocked=await run(g,load,3);expect(blocked.additionFills??[]).toHaveLength(0);expect(blocked.additionVetoes?.some(v=>v.kind==='fast-drop')).toBe(true);expect(blocked).toMatchObject({initialNotional:100,remainingQuantity:1,remainingCost:100,realizedPnl:0});
  g.addition!.entryVetoes[0].enabled=false;const restored=await run(g,load,3);expect(restored.additionFills).toHaveLength(2);
 });

});

it('compares every metric with the last executed purchase and retains the same baseline on resume', async () => {
 const metric=(id:string,formula:string):AdditionIncreaseMetric=>{
  const definition={...def,id,formula,interval:'5m' as const};
  return {label:id,metric:'raw',snapshot:{...snapshot,featureId:id,interval:'5m',definitionKey:definitionKey(definition)}};
 };
 const metrics=[metric('收盘指标','raw = C'),metric('成交量指标','raw = B')];
 const g=group();
 g.addition={...g.addition!,positionVersion:HOLDING_LEDGER_ADDITION_VERSION,indicatorIncrease:{version:ADDITION_INDICATOR_INCREASE_VERSION,metrics}};
 const load:FishReconstructionLoader=async (_row,from,to,plan)=>Array.from({length:(to-from)/plan.step},(_,i)=>{
  const at=from+i*plan.step,minute=(at-T)/M;
  if(plan.step===M)return bar(at,100+Math.max(0,minute)*2,1);
  if(plan.def.id==='add-atr-prices')return bar(at);
  const values=minute < 0 ? [1,1] : minute < 5 ? [2,1] : minute < 10 ? [3,2] : minute < 15 ? [2,3] : [4,4];
  return bar(at,values[0],values[1],.5,5);
 });
 const result=await run(g,load,22);
 expect(result.additionFills?.map(fill=>fill.at)).toEqual([T+10*M,T+20*M]);
 expect(result.additionFills?.[0].indicatorIncrease).toEqual([
  {label:'收盘指标',metric:'raw',value:3,at:T+10*M,previousAt:T,previousValue:1},
  {label:'成交量指标',metric:'raw',value:2,at:T+10*M,previousAt:T,previousValue:1},
 ]);
 expect(result.additionFills?.[1].indicatorIncrease).toMatchObject([
  {value:4,previousValue:3,previousAt:T+10*M},{value:4,previousValue:2,previousAt:T+10*M},
 ]);
 expect(result.additionSkips).toEqual(expect.arrayContaining([
  expect.objectContaining({at:T+5*M,kind:'indicator-increase',reading:expect.stringContaining('成交量指标 1 ≤ 1')}),
  expect.objectContaining({at:T+15*M,kind:'indicator-increase',reading:expect.stringContaining('收盘指标 2 ≤ 3')}),
 ]));
 const resumed=await run(g,load,22,await run(g,load,14));
 expect(resumed.additionFills).toEqual(result.additionFills);
 const frozen=freezeQualityPlan(g),restored=JSON.parse(JSON.stringify(frozen));
 expect(planVersionChanges(restored)).toEqual([]);
 expect((await run(restored,load,22)).additionFills).toEqual(result.additionFills);
 restored.addition.indicatorIncrease.metrics[0].snapshot.definitionKey=definitionKey({...def,formula:'raw = C * 2',interval:'5m'});
 expect(planVersionChanges(restored)).toEqual(expect.arrayContaining([expect.objectContaining({key:'addition-increase-1'})]));
});

it('uses the selected weighted window in actual addition checks and independently in the backup branch', async () => {
 const indicator={...def,id:'state',formula:'state = C\navg_state_2 = avg(state, 24)',interval:'5m' as const};
 const base={id:'growth',label:'状态 S avg₂',metric:'avg_state_2',direction:'>' as const,threshold:0,enabled:true,
   snapshot:{...snapshot,featureId:'state',interval:'5m',definitionKey:definitionKey(indicator)}};
 const short=withAdditionMetricTime(base,{window:'1'}),long=withAdditionMetricTime(base,{window:'24'});
 const g=group();
 const round=(metric:AdditionIncreaseMetric)=>({source:'custom' as const,stricterPct:10,condition:g.addition!.condition,
  indicatorIncrease:{version:ADDITION_INDICATOR_INCREASE_VERSION,metrics:[metric]}});
 const configure=(metric:AdditionIncreaseMetric,backup?:AdditionIncreaseMetric)=>freezeQualityPlan({...g,addition:{
  ...g.addition!,...round(metric),positionVersion:HOLDING_LEDGER_ADDITION_VERSION,maxRounds:1,rounds:[round(metric)],
  ...(backup?{alternativeRounds:[round(backup)]}:{}),
 }});
 const priceAt=(at:number)=>at===T-60*M?1000:at===T?15:10;
 const load:FishReconstructionLoader=async (_row,from,to,plan)=>Array.from({length:(to-from)/plan.step},(_,i)=>{
  const at=from+i*plan.step,minute=(at-T)/M;
  if(plan.step===M)return bar(at,100+Math.max(0,minute)*2,1);
  if(plan.def.id==='add-atr-prices')return bar(at);
  return bar(at,priceAt(at),1);
 });
 const fast=configure(short),slow=configure(long),branched=configure(short,long);
 expect(fast.frozenVersions).toEqual(expect.arrayContaining([expect.objectContaining({key:'addition-indicator-time',version:expect.stringContaining('addition-indicator-time-v1')})]));
 expect(planVersionChanges(JSON.parse(JSON.stringify(fast)))).toEqual([]);
 const configured={...fast, sellStages:[{afterAdditions:1,label:short.label,metric:short.metric,snapshot:short.snapshot,rule:{metric:short.metric,direction:'<' as const,threshold:2}}]};
 expect(syncQualityThresholdDefinitions({...newQualityStudy(),sellPlans:[configured]},[indicator]).sellPlans?.[0].sellStages).toEqual(configured.sellStages);
 const shortRun=await run(fast,load,8),longRun=await run(slow,load,8),branchRun=await run(branched,load,8);
 expect(shortRun.additionFills??[]).toHaveLength(0);
 expect(longRun.additionFills).toHaveLength(1);
 expect(branchRun.additionFills).toMatchObject([{at:T+5*M,lane:'attack'}]);
 const values=Array.from({length:290},(_,i)=>priceAt(T+(i-288)*5*M));
 const expected=displayAverage(values,24,'avg2');
 expect(longRun.additionFills?.[0].indicatorIncrease?.[0].previousValue).toBeCloseTo(expected[287],10);
 expect(longRun.additionFills?.[0].indicatorIncrease?.[0].value).toBeCloseTo(expected[288],10);
 expect(branchRun.additionFills?.[0].indicatorIncrease).toEqual(longRun.additionFills?.[0].indicatorIncrease);
 const changed=structuredClone(branched);
 changed.addition!.alternativeRounds![0].indicatorIncrease!.metrics[0]=short;
 expect(planVersionChanges(changed)).toEqual(expect.arrayContaining([expect.objectContaining({key:'addition-indicator-time'})]));
});

it('preserves the account formula and supports clearing custom lookback and half-life', () => {
 const indicator={...def,formula:'raw = retain(avg(C, avgh), C, prev(C), hl, 48)',avgHours:12,halfLifeHours:6,interval:'5m' as const};
 const base={id:'growth',label:'读数',metric:'raw',direction:'>' as const,threshold:0,enabled:true,
   snapshot:{...snapshot,interval:'5m' as const,definitionKey:definitionKey(indicator)}};
 expect(additionMetricTimeFields(indicator.formula,'raw')).toEqual(['avgh','hl']);
 const timed=withAdditionMetricTime(base,{avgh:'1',hl:'24'});
 expect(qualityDefinition(timed.snapshot)).toMatchObject({formula:indicator.formula,avgHours:1,halfLifeHours:24});
 expect(additionMetricBaseDefinition(timed.snapshot)).toMatchObject({formula:indicator.formula,avgHours:12,halfLifeHours:6});
 expect(withAdditionMetricTime(timed,{})).toMatchObject({label:base.label,snapshot:base.snapshot});
});

it('lets the qualified alternate candidate win when the primary fails the increase check', async () => {
 const g=group(),base=g.addition!,noGrowth={label:'平盘指标',metric:'raw',snapshot:{...snapshot,featureId:'flat',definitionKey:definitionKey({...def,formula:'raw = C - C + 1'})}};
 const main={source:'custom' as const,stricterPct:10,condition:base.condition,indicatorIncrease:{version:ADDITION_INDICATOR_INCREASE_VERSION,metrics:[noGrowth]}};
 const alternative={source:'custom' as const,stricterPct:10,condition:{...base.condition!,threshold:.25}};
 g.addition={...base,...main,positionVersion:HOLDING_LEDGER_ADDITION_VERSION,maxRounds:1,rounds:[main],alternativeRounds:[alternative]};
 const result=await run(g,loader(rising),4);
 expect(result.additionFills).toMatchObject([{at:T+M,lane:'attack'}]);
});
