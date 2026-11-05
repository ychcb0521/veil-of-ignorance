import {describe,it,expect} from 'vitest';
import {computeDbl5} from '../dbl5m';
import {computeSbs5m} from '../sbs5m';
import {sample,T} from './fixtures/dblBars';
import {sbsComplete,SBS_T} from './fixtures/sbsBars';
import {defaultStructureAddition,structureAdditionIdentity,structureAdditionLabel,structureAdditionSignal,structureAdditionK,withMinKDistance,validateStructureAddition,createStructureAdditionReader,type StructureAdditionRule,type StructureAdditionEvidence} from '../fish/qualityAdditionStructure';
import {findCalculatorAdditions} from '../fish/qualityAdditionCalculator';
import {holdingVetoLabel,validateHoldingVeto,validatePayoffStops} from '../fish/qualityVeto';
import {additionIdentity,additionMirrorIdentity,defaultQualityAddition,validateQualityAddition,additionEvidenceHeaders,additionEvidenceValues} from '../fish/qualityAddition';
import {evaluateQualitySample,type QualityGroup,type QualitySample} from '../fish/quality';
import {definitionKey} from '../deepDig/features';
import {buildQualityCampaignData} from '../fish/qualityCampaigns';
import type {ResearchBar} from '../deepRsa/window';
import type {FishReconstructionLoader} from '../fish/reconstruction';
import {compileFishProgram} from '../fish/algorithm';
import {makeQualityBuyFilter} from '../fish/qualityFilters';
import {BUILTIN_FEATURES} from '../deepDig/features';
import type {AdditionCandidate} from '../fish/qualityAdditionScan';
const M=60000,STEP=5*M;
const row={id:'structure',symbol:'TESTUSDT',timeMs:T+400*STEP,timeLabel:'',fallbackZone:''};
const plain=(at:number,price=90):ResearchBar=>({openTime:at,open:price,high:price+1,low:price-1,close:price,volume:10,quoteVolume:1000,takerBuyVolume:5,takerBuyQuoteVolume:500,DBL5_tick_size:1,SBS5M_tick_size:.1,PRS6H_tick_size:.1});
function context(input:ResearchBar[],entry=input[0].openTime-STEP,end=input.at(-1)!.openTime+2*STEP){
 const map=new Map(input.map(b=>[b.openTime,b])),requests:{from:number;to:number;step:number}[]=[];
 const minute=(at:number)=>{if(at<input[0].openTime)return plain(at);const b=map.get(Math.floor(at/STEP)*STEP)??input.at(-1)!;return {...b,openTime:at,open:b.close,low:b.close-.1,high:b.close+.1};};
 const load:FishReconstructionLoader=async(_row,from,to,p)=>{requests.push({from,to,step:p.step});return Array.from({length:(to-from)/p.step},(_,i)=>{const at=from+i*p.step;return p.step===STEP?map.get(at)??plain(at):minute(at);});};
 const prices=Array.from({length:(end-entry)/M},(_,i)=>minute(entry+i*M));
 return {row:{...row,timeMs:end},entry,entryPrice:90,notional:100,end,since:entry,prices,previous:[],mirror:{at:entry+M,price:100,fraction:.5,atOpen:true,gainPct:(100/90-1)*100},repeat:true,candidates:[],entryBufferAtr:0,load,signal:new AbortController().signal,requests};
}
const rule=(algorithm:'dbl5'|'sbs5m'='dbl5',trigger:StructureAdditionRule['trigger']='raise')=>({...defaultStructureAddition(algorithm),trigger,buffer:0});
const dblRows=()=>computeDbl5(sample(),{symbol:row.symbol}).rows;
const evidence=()=>structureAdditionSignal(rule('dbl5','confirm'),dblRows()[7],T-24*3600000)!;

describe('native box decisions for holding additions',()=>{
 it('accepts only selected full confirmations and distinguishes raised support from baseline',()=>{
  const rows=dblRows();expect(rows.flatMap(r=>structureAdditionSignal(rule(),r,T)??[]).map(e=>[e.event,e.supportPrice])).toEqual([['UP_STEP',102]]);
  expect(rows.flatMap(r=>structureAdditionSignal(rule('dbl5','confirm'),r,T)??[]).map(e=>[e.event,e.supportPrice])).toEqual([['BASELINE',100],['UP_STEP',102]]);
  expect(structureAdditionSignal(rule(),rows[17],T)).toBeUndefined();
 });
 it('uses SBS confirmed raises and independent retests; pending formation never qualifies',()=>{
  const rows=computeSbs5m(sbsComplete(),{symbol:row.symbol,tickSize:.1}).rows;
  expect(rows.flatMap(r=>structureAdditionSignal(rule('sbs5m'),r,SBS_T)??[]).map(e=>[e.event,e.supportPrice])).toEqual([['STEP_CONFIRMED',104]]);
  expect(rows.flatMap(r=>structureAdditionSignal(rule('sbs5m','retest'),r,SBS_T)??[]).map(e=>e.event)).toEqual(['RETEST_SUCCEEDED']);
  expect(rows.slice(0,36).flatMap(r=>structureAdditionSignal(rule('sbs5m','confirm'),r,SBS_T)??[])).toEqual([]);
 });
 it('can use the frozen SBS invalidation price as the K base',()=>{
  const native=computeSbs5m(sbsComplete(),{symbol:row.symbol,tickSize:.1}).rows[45];
  const r={...rule('sbs5m'),kBasis:'invalidation' as const},e=structureAdditionSignal(r,native,SBS_T)!;
  expect(e.basePrice).toBe(native.active!.K);expect(e.nativeInvalidation).toBe(e.basePrice);expect(e.confirmedAt).toBe(e.at);
 });
 it('subtracts chosen ATR or percent redundancy and floors decimal arithmetic to the true tick',()=>{
  expect(structureAdditionK({...evidence(),buffer:.5,tickSize:'.1'},2)).toEqual({k:99,bufferPrice:1});
  expect(structureAdditionK({...evidence(),bufferUnit:'percent',buffer:1.25,tickSize:'.1'},2)).toEqual({k:98.7,bufferPrice:expect.closeTo(1.3)});
  expect(structureAdditionK({...evidence(),basePrice:.3,buffer:1,tickSize:'.1'},.1)?.k).toBe(.2);
  expect(structureAdditionK({...evidence(),buffer:999},2)).toBeUndefined();
 });
 it('validates choices, parameter snapshots and buffer bounds before saving',()=>{
  for(const change of [{buffer:-1},{buffer:NaN},{buffer:100,bufferUnit:'percent'},{trigger:'retest'},{kBasis:'invalidation'},{definition:{...rule().definition,interval:'1m'}},{definition:{...rule().definition,DBL5_config:{n:36}}}])expect(()=>validateStructureAddition({...rule(),...change} as StructureAdditionRule)).toThrow();
  expect(()=>validateStructureAddition({...rule(),buffer:0})).not.toThrow();
  expect(()=>validateQualityAddition({...defaultQualityAddition(),enabled:true,source:'structure',quantityMode:'fixed',structure:rule()})).toThrow('平衡公式');
 });
 it('changes run identity for algorithm, timing, K reference, redundancy and native parameters while retaining old identities',()=>{
  const old={...defaultQualityAddition(),enabled:true},a=additionIdentity(old);expect(a[0]).toBe('holding-add-after-half-2atr-balance-v3');
  const root={...old,source:'structure' as const,structure:rule()};const key=JSON.stringify(additionIdentity(root));
  for(const structure of [{...rule(),buffer:1},{...rule(),trigger:'confirm' as const},rule('sbs5m'),{...rule(),definition:{...rule().definition,DBL5_config:{n:2}}}])expect(JSON.stringify(additionIdentity({...root,structure}))).not.toBe(key);
 });
 it('never uses future confirmation and retains one decision per box across resume and pagination',async()=>{
  const o=context(sample()),read=createStructureAdditionReader(o),r=rule('dbl5','confirm');
  const early=await read(r,o.entry,T+8*STEP,[]);expect(early).toBeUndefined();
  // 【用户要求】2026-11-01 新 C 产生即加仓、K 取上一箱体的旧 C：首个箱体（BASELINE）没有旧 C，不作加仓位置
  expect(await read(r,o.entry,T+14*STEP,[])).toBeUndefined();
  const first=await read(r,o.entry,o.end,[]);expect(first).toMatchObject({at:T+14*STEP,structureEvidence:{supportPrice:102,previousSupportPrice:100,basePrice:100,event:'UP_STEP'}});
  const fake={...first!,quantity:1,notional:100};const next=await read(r,o.entry,o.end,[fake]);expect(next).toBeUndefined();
  expect(await read(r,first!.at,o.end,[fake])).toEqual(next);
  const restored=await createStructureAdditionReader(o)(r,first!.at,o.end,[fake]);expect(restored).toEqual(next);
  const longer={...o,end:T+250*STEP,row:{...o.row,timeMs:T+250*STEP}};expect(await createStructureAdditionReader(longer)(r,o.entry,longer.end,[])).toEqual(first);
 });
 // 【用户要求】2026-11-01 加仓可选 K 用旧 C 还是新 C；默认旧 C，身份不变
 // 【用户要求】2026-11-03 盈亏比止盈：整笔盈亏 ÷ L₀ ≥ N 立刻卖出全部持仓（L₀＝初始仓位 × 静态回撤%）
 it('sells everything once the whole-trade payoff ratio reaches the threshold, at the exact target or a gapped open',async()=>{
  const o=context(sample()),stop=(id:string,kind:'static-drawdown'|'payoff-ratio',threshold:number)=>({id,label:kind,kind,direction:'>=' as const,threshold,enabled:true});
  const plain=await findCalculatorAdditions({...o,structure:{...rule(),kSource:'current'},maxRounds:1,vetoes:[stop('s','static-drawdown',5)]});
  const paid=await findCalculatorAdditions({...o,structure:{...rule(),kSource:'current'},maxRounds:1,vetoes:[stop('s','static-drawdown',5),stop('p','payoff-ratio',2)]});
  expect(paid.stop?.cause).toMatchObject({kind:'payoff-ratio',threshold:2,payoffBasis:{l0:5,l0Pct:5}});
  const basis=paid.stop!.cause!.payoffBasis!;expect(basis.pnl).toBeGreaterThanOrEqual(10-1e-9);if(!paid.stop!.atOpen)expect(basis.pnl).toBeCloseTo(10,6);
  expect(paid.stop!.at).toBeLessThanOrEqual(plain.stop?.at??Infinity);
  expect(()=>validatePayoffStops([stop('p','payoff-ratio',5000)])).toThrow('静态回撤');expect(()=>validatePayoffStops([stop('s','static-drawdown',5),stop('p','payoff-ratio',5000)])).not.toThrow();
  expect(holdingVetoLabel(stop('p','payoff-ratio',5000))).toBe('盈亏比 ≥ 5000R');
  expect(()=>validateHoldingVeto(stop('p','payoff-ratio',0))).toThrow('盈亏比');
 });
 // 【用户要求】2026-11-03 几何仓位 > 门槛时至少保留 x% 开仓价有效涨幅：止损从 Kₘ 上移到 Kₘ＋x%×首次开仓价，盘中碰线卖出
 it('raises the stop to K + x% of the first entry price once the geometric position exceeds the threshold',async()=>{
  const o=context(sample()),base={...o,structure:{...rule(),kSource:'current' as const},maxRounds:1};
  const plain=await findCalculatorAdditions(base);expect(plain.fills).toHaveLength(1);
  const k=plain.fills[0].sizing!.support;
  const locked=await findCalculatorAdditions({...base,geometricLock:{enabled:true,multiple:.01,pct:1}});
  expect(locked.fills).toEqual(plain.fills);
  expect(locked.stop?.cause).toMatchObject({id:'geometric-lock',kind:'addition-support',geometricLock:{threshold:.01,pct:1,k}});
  expect(locked.stop!.cause!.threshold).toBeCloseTo(k+.9,9);expect(locked.stop!.price).toBeGreaterThanOrEqual(locked.stop!.atOpen?0:k+.9-1e-9);
  if(plain.stop)expect(locked.stop!.at).toBeLessThanOrEqual(plain.stop.at);
  // 几何仓位没超过门槛、或未启用：照旧碰 K
  expect((await findCalculatorAdditions({...base,geometricLock:{enabled:true,multiple:1e5,pct:1}})).stop).toEqual(plain.stop);
  expect((await findCalculatorAdditions({...base,geometricLock:{enabled:false,multiple:.01,pct:1}})).stop).toEqual(plain.stop);
  const add={...defaultQualityAddition(),enabled:true,source:'structure' as const,structure:rule()},on={...add,geometricLock:{enabled:true,multiple:10,pct:1}};
  expect(JSON.stringify(additionIdentity(on))).not.toBe(JSON.stringify(additionIdentity(add)));
  expect(JSON.stringify(additionIdentity({...add,geometricLock:{enabled:false,multiple:10,pct:1}}))).toBe(JSON.stringify(additionIdentity(add)));
  expect(()=>validateQualityAddition({...on,quantityMode:'calculator',geometricLock:{enabled:true,multiple:10,pct:101}})).toThrow('保住有效涨幅');
 });
 // 【用户要求】2026-11-03「方向」探测算法条件：信号没有所选探测算法时这一轮注定不满足，不再加仓；身份与说明各自带上
 it('stops adding when the detector condition cannot be met, and gives the detector condition its own identity',async()=>{
  const o=context(sample());
  expect((await findCalculatorAdditions({...o,structure:rule(),maxRounds:1})).fills.length).toBe(1);
  expect((await findCalculatorAdditions({...o,structure:rule(),maxRounds:1,unavailable:'这条信号没有所选的探测算法'})).fills).toEqual([]);
  const base={...defaultQualityAddition(),enabled:true,source:'structure' as const,structure:rule()},dp={...base,detectorPrerequisite:{enabled:true,stricterPct:10}};
  expect(JSON.stringify(additionIdentity(dp))).toContain('detector-prerequisite-v1');expect(additionIdentity({...dp,detectorPrerequisite:{enabled:false,stricterPct:10}})).toEqual(additionIdentity(base));
  expect(()=>validateQualityAddition({...dp,detectorPrerequisite:{enabled:true,stricterPct:NaN}})).toThrow('探测算法');
 });
 // 【用户要求】2026-11-03 K 最小距离：K 离加仓价不足 x% 时按 T×(1−x%) 当 K，加仓量与止损都用它
 it('widens K to T×(1−x%) when it sits closer than the minimum distance, sizing and stopping on the wider K',async()=>{
  const e={...evidence(),tickSize:'1'},sel={k:99,bufferPrice:1};
  expect(withMinKDistance(e,sel,100,2,2)).toEqual({k:98,bufferPrice:2,widenedFrom:99,minDistancePct:2});
  expect(withMinKDistance(e,sel,100,2,1)).toBe(sel);expect(withMinKDistance(e,sel,100,2,undefined)).toBe(sel);
  const o=context(sample()),base={...rule(),buffer:.5,kSource:'current' as const};
  const plain=await findCalculatorAdditions({...o,structure:base,maxRounds:1}),wide=await findCalculatorAdditions({...o,structure:{...base,minDistancePct:10},maxRounds:1});
  const p=plain.fills[0],w=wide.fills[0];expect(w.at).toBe(p.at);
  expect(w.sizing!.support).toBe(Math.floor(w.price*.9));expect(w.sizing!.support).toBeLessThan(p.sizing!.support);
  expect(w.structureEvidence).toMatchObject({widenedFrom:p.sizing!.support,minDistancePct:10,k:w.sizing!.support});
  expect(w.quantity).toBeLessThan(p.quantity);
  const z=w.sizing!;expect(z.coinsBefore*(z.support-z.previousSupport)+z.mirrorUsed).toBeCloseTo(w.quantity*(w.price-z.support));
  expect(structureAdditionIdentity({...base,minDistancePct:10})).not.toEqual(structureAdditionIdentity(base));
  expect(structureAdditionLabel({...base,minDistancePct:10})).toContain('离现价 ≥ 10%');
  for(const bad of [0,-1,50,NaN])expect(()=>validateStructureAddition({...base,minDistancePct:bad})).toThrow('最小距离');
 });
 it('lets K use the new C instead: the first box qualifies and K = new C − n×ATR, with its own identity',async()=>{
  const o=context(sample()),r={...rule('dbl5','confirm'),kSource:'current' as const};
  const first=await createStructureAdditionReader(o)(r,o.entry,o.end,[]);expect(first).toMatchObject({at:T+8*STEP,structureEvidence:{event:'BASELINE',supportPrice:100,basePrice:100}});expect(first!.structureEvidence!.previousSupportPrice).toBeUndefined();
  const older=await findCalculatorAdditions({...o,structure:{...rule(),buffer:.5},maxRounds:1}),newer=await findCalculatorAdditions({...o,structure:{...rule(),buffer:.5,kSource:'current'},maxRounds:1});
  expect(older.fills[0].sizing!.support).toBe(98);const f=newer.fills[0],z=f.sizing!;expect(f).toMatchObject({at:T+14*STEP,structureEvidence:{supportPrice:102,basePrice:102}});expect(z.support).toBe(100);
  expect(z.coinsBefore*(z.support-z.previousSupport)+z.mirrorUsed).toBeCloseTo(f.quantity*(f.price-z.support));expect(f.quantity).toBeGreaterThan(older.fills[0].quantity);
  expect(structureAdditionIdentity({...rule(),kSource:'previous'})).toEqual(structureAdditionIdentity(rule()));expect(structureAdditionIdentity({...rule(),kSource:'current'})).not.toEqual(structureAdditionIdentity(rule()));
  expect(()=>validateStructureAddition({...rule(),kSource:'other' as never})).toThrow('K 基准');
 });
 it('checks closed-price gain at the event itself and discards events before the mirror or last decision',async()=>{
  const o=context(sample()),read=createStructureAdditionReader(o),r=rule('dbl5','confirm');
  expect(await read(r,T+14*STEP,o.end,[])).toBeUndefined();
  expect(await read(r,o.entry,o.end,[],{referencePrice:100,thresholdPct:10})).toBeUndefined();
  const hit=await read(r,o.entry,o.end,[],{referencePrice:100,thresholdPct:2});expect(hit?.priceGate).toMatchObject({observedPrice:105,confirmedAt:T+14*STEP,referencePrice:100});
 });
 it('rejects incomplete venue precision instead of falling back to candidate or inferred support',async()=>{
  const o=context(sample()),load=o.load;o.load=async(...args)=>(await load(...args)).map(b=>({...b,DBL5_tick_size:null,PRS6H_tick_size:null,ATI6H_tick_size:null}));await expect(createStructureAdditionReader(o)(rule(),o.entry,o.end,[])).rejects.toThrow('报价精度');
 });
 it('sizes at the next minute open with the chosen K and preserves the balance equation and export evidence',async()=>{
  const o=context(sample()),r=await findCalculatorAdditions({...o,structure:{...rule(),buffer:.5},maxRounds:1});expect(r.fills).toHaveLength(1);
  const fill=r.fills[0],z=fill.sizing!;expect(fill).toMatchObject({at:T+14*STEP,price:105,structureEvidence:{event:'UP_STEP',supportPrice:102,previousSupportPrice:100,basePrice:100,k:z.support},sizing:{previousSupport:90}});
  expect(z.support).toBe(98);expect(z.support).toBe(100-fill.structureEvidence!.bufferPrice!);
  expect(z.coinsBefore*(z.support-z.previousSupport)+z.mirrorUsed).toBeCloseTo(fill.quantity*(fill.price-z.support));expect(z.coverageGap).toBeCloseTo(0);
  expect(additionEvidenceValues(fill)).toHaveLength(additionEvidenceHeaders.length);expect(JSON.parse(additionEvidenceValues(fill).at(-1) as string)).toEqual(fill.structureEvidence);
  const wide=await findCalculatorAdditions({...o,structure:{...rule(),buffer:1},maxRounds:1});expect(wide.fills[0].sizing!.support).toBeLessThan(z.support);expect(wide.fills[0].quantity).toBeLessThan(fill.quantity);
 });
 it('keeps an accepted structure and K fixed when resumed and does not add again from an ordinary floor touch',async()=>{
  const o=context(sample()),first=await findCalculatorAdditions({...o,end:T+15*STEP,structure:rule(),maxRounds:3}),full=await findCalculatorAdditions({...o,structure:rule(),maxRounds:3});
  expect(full.fills).toHaveLength(1);expect(full.fills).toEqual(first.fills);
  expect((await findCalculatorAdditions({...o,since:T+15*STEP,previous:first.fills,structure:rule(),maxRounds:3})).fills).toEqual(full.fills);
 });
 it('does not add on a gap below the confirmed floor or when risk budget is insufficient; the removed entry distance no longer blocks',async()=>{
  const o=context(sample()),prices=o.prices.map(b=>b.openTime===T+14*STEP?{...b,open:101}:b);
  expect((await findCalculatorAdditions({...o,prices,structure:rule()})).fills).toEqual([]);
  expect((await findCalculatorAdditions({...o,structure:{...rule(),buffer:10}})).fills).toEqual([]);
  expect((await findCalculatorAdditions({...o,structure:rule(),entryBufferAtr:100})).fills).toEqual((await findCalculatorAdditions({...o,structure:rule()})).fills);
 });
 it('uses SBS confirmed timing and its native fixed invalidation line through the same calculator',async()=>{
  const input=sbsComplete(),o=context(input),structure={...rule('sbs5m'),kBasis:'invalidation' as const};
  const result=await findCalculatorAdditions({...o,structure,maxRounds:2});expect(result.fills.map(f=>[f.structureEvidence!.supportPrice,f.structureEvidence!.previousSupportPrice,f.sizing!.support])).toEqual([[100,89,88],[104,100,98.3]]);
  const fill=result.fills.at(-1)!;expect(fill.structureEvidence).toMatchObject({algorithm:'sbs5m',event:'STEP_CONFIRMED',supportPrice:104,kBasis:'invalidation'});
  // K 基准是上一箱体的失效线（旧 C 那一箱），不是新箱体自己的失效线
  expect(fill.structureEvidence!.basePrice).toBe(result.fills[0].structureEvidence!.nativeInvalidation);expect(fill.structureEvidence!.basePrice).toBeLessThan(fill.structureEvidence!.nativeInvalidation!);
  expect(fill.sizing!.support).toBeLessThanOrEqual(fill.structureEvidence!.basePrice);
  expect((await findCalculatorAdditions({...o,structure,previous:result.fills,since:fill.at+M})).fills).toEqual(result.fills);
 });
 it('activates the frozen structure K as the protective exit and preserves it on resume',async()=>{
  const o=context(sample()),initial=await findCalculatorAdditions({...o,structure:rule(),maxRounds:1}),fill=initial.fills[0],at=fill.at+M,K=fill.sizing!.support;
  const prices=o.prices.map(b=>b.openTime===at?{...b,open:K+1,high:K+2,low:K-.1}:b);
  const result=await findCalculatorAdditions({...o,prices,structure:rule(),maxRounds:1});expect(result.stop).toMatchObject({at,price:K,support:K,atOpen:false});
  const resumed=await findCalculatorAdditions({...o,prices,structure:rule(),maxRounds:1,previous:[fill],since:at});expect(resumed.stop).toEqual(result.stop);expect(resumed.fills).toEqual(result.fills);
 });
 it('does not let an invalid future candle cancel a previously available event',async()=>{
  const input=sample().map((b,i)=>i===17?{...b,DBL5_tick_size:3}:b),o=context(input);
  const hit=await createStructureAdditionReader(o)(rule('dbl5','confirm'),o.entry,o.end,[]);expect(hit?.at).toBe(T+14*STEP);
 });
 it('integrates structure decisions through evaluateQualitySample, saved campaign and personal sizing validation',async()=>{
  const o=context(sample()),def={id:'never-sell',name:'不卖',short:'不卖',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
  const snapshot={featureId:def.id,featureName:def.name,featureShort:def.short,definitionKey:definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:0,direction:'<' as const,average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:o.entry};
  const qualitySample:QualitySample={id:'structure-run',enteredAt:o.entry,basis:'capture',importedAt:o.entry,groups:[],source:{...o.row,timeMs:o.entry,fish:snapshot}};
  const group:QualityGroup={id:'g',label:'箱体加仓',snapshot,metric:'raw',rule:{metric:'raw',direction:'<',threshold:0},mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50},addition:{...defaultQualityAddition(),enabled:true,source:'structure',structure:rule(),entryBufferAtr:0,maxRounds:1}};
  const result=await evaluateQualitySample(qualitySample,group,0,T+17*STEP,o.load,o.signal);expect(result.status).not.toBe('error');expect(result.additionFills).toHaveLength(1);
  const data=buildQualityCampaignData('owner',{sample:qualitySample,plan:group,result,detectors:[],observeHours:0,firstEvaluatedAt:o.entry},'sell');expect(data.campaign.comparison!.sellEvidence!.additionFills![0].structureEvidence).toEqual(result.additionFills![0].structureEvidence);
  // 2026-11-02 战役元数据「持仓监测」：战役带上当时冻结的整套方案
  expect(data.campaign.comparison!.monitorPlan).toEqual(group);expect(data.campaign.comparison!.monitorPlan).not.toBe(group);
  // 2026-11-02 操作时间按真实物理时间（监测算出结果的时刻），成交本身仍按行情时间
  const {campaignOperationTime}=await import('../objectiveOperationTime');
  expect(campaignOperationTime(data.legs,data.tradeRecords)).toBe(result.evaluatedAt);expect(data.tradeRecords.every(r=>r.closedRealAt===r.closeTime)).toBe(true);
  // 2026-11-02 委托列：加仓的支撑线 K 作为提前挂好的止损单，页面与导出图同一结果
  const addLeg=data.legs.find(l=>l.leg_role==='main_add_1')!,K=result.additionFills![0].sizing!.support;
  const {buildCampaignLegsExportRows}=await import('../campaignLegsPngExport');
  const rows=buildCampaignLegsExportRows({campaign:data.campaign,legs:data.legs,tradeRecords:data.tradeRecords,reverseHedgeOrders:[]});
  expect(rows.find(r=>r.kind==='leg'&&r.legId===addLeg.id)!.cells[15].map(l=>l.text).join(' ')).toMatch(new RegExp(`^支撑线 K ${String(K).replace('.','\\.')}`));
  const {render,screen,cleanup}=await import('@testing-library/react'),{createElement}=await import('react'),{MemoryRouter}=await import('react-router-dom'),{CampaignLegsList}=await import('@/components/journal/CampaignLegsList');
  render(createElement(MemoryRouter,null,createElement(CampaignLegsList,{campaign:data.campaign,legs:data.legs,tradeRecords:data.tradeRecords,reverseHedgeOrders:[]})));
  expect(screen.getByTestId(`leg-addition-stop-${addLeg.id}`)).toHaveTextContent('支撑线 K');expect(screen.queryByTestId(`leg-addition-stop-${data.legs[0].id}`)).toBeNull();cleanup();
  const {evaluateCampaignAddSizing}=await import('../campaignAddSizingCheck');expect([...evaluateCampaignAddSizing(data).values()].every(v=>v.status==='ok')).toBe(true);
 });

 it('adds after any partial mirror (e.g. 67%), not only a half mirror; a 100% mirror leaves nothing to add to',async()=>{
  // 【用户要求】2026-11-02「组合算法1」镜像卖 67%，条件达标却从不加仓：前提改为镜像已成交且留有余仓
  const o=context(sample()),mirror={...o.mirror,fraction:.67};
  const r=await findCalculatorAdditions({...o,mirror,structure:{...rule(),buffer:.5},maxRounds:1});expect(r.fills).toHaveLength(1);
  const z=r.fills[0].sizing!;expect(z.coinsBefore).toBeCloseTo(100/90*(1-.67));
  expect(z.coinsBefore*(z.support-z.previousSupport)+z.mirrorUsed).toBeCloseTo(r.fills[0].quantity*(r.fills[0].price-z.support));
  expect((await findCalculatorAdditions({...o,mirror:{...o.mirror,fraction:1},structure:rule(),maxRounds:1})).fills).toEqual([]);
  const def={id:'never-sell',name:'不卖',short:'不卖',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
  const snapshot={featureId:def.id,featureName:def.name,featureShort:def.short,definitionKey:definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:0,direction:'<' as const,average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:o.entry};
  const qualitySample:QualitySample={id:'structure-67',enteredAt:o.entry,basis:'capture',importedAt:o.entry,groups:[],source:{...o.row,timeMs:o.entry,fish:snapshot}};
  const group:QualityGroup={id:'g',label:'箱体加仓',snapshot,metric:'raw',rule:{metric:'raw',direction:'<',threshold:0},mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:67},addition:{...defaultQualityAddition(),enabled:true,source:'structure',structure:rule(),maxRounds:1}};
  const result=await evaluateQualitySample(qualitySample,group,0,T+17*STEP,o.load,o.signal);
  expect(result.status).not.toBe('error');expect(result.additionNote).toBeUndefined();expect(result.mirrorFill?.fraction).toBe(.67);expect(result.additionFills).toHaveLength(1);
  const data=buildQualityCampaignData('owner',{sample:qualitySample,plan:group,result,detectors:[],observeHours:0,firstEvaluatedAt:o.entry},'sell');
  const {evaluateCampaignAddSizing}=await import('../campaignAddSizingCheck');expect([...evaluateCampaignAddSizing(data).values()].every(v=>v.status==='ok')).toBe(true);
 });
 it('recomputes only plans whose mirror is not 50%: half-mirror identities stay unchanged',()=>{
  const add={...defaultQualityAddition(),enabled:true};
  expect(additionMirrorIdentity(add,{enabled:true,gainPct:5,sellPct:50} as never)).toEqual([]);
  expect(additionMirrorIdentity(add,{enabled:true,gainPct:2.5,sellPct:67} as never)).toEqual([['addition-after-partial-mirror-v1']]);
  expect(additionMirrorIdentity({...add,enabled:false},{enabled:true,sellPct:67})).toEqual([]);
 });
 it('K can use the DBL-5 guard line: frozen guard, regime and close count; SBS cannot',async()=>{
  const g={...rule(),kSource:'guard' as const};
  expect(()=>validateStructureAddition({...rule('sbs5m'),kSource:'guard'})).toThrow('防守线');
  expect(structureAdditionIdentity(g)).not.toEqual(structureAdditionIdentity(rule()));expect(structureAdditionLabel(g)).toContain('K＝防守线');
  const o=context(sample()),r=await findCalculatorAdditions({...o,structure:g,maxRounds:1});
  expect(r.fills.length).toBeGreaterThan(0);
  for(const f of r.fills){const e=f.structureEvidence!;expect(e.guardPrice).toBe(e.basePrice);expect(['trend','range']).toContain(e.guardRegime);expect(e.guardCloses).toBe(e.guardRegime==='trend'?1:2);expect(f.sizing!.support).toBe(e.k);expect(e.k).toBeLessThanOrEqual(e.guardPrice!);}
 });
 // 【用户要求】2026-11-03 防守线分两种：实线和虚线都用（默认、旧方案不变）／只用实线（虚线＝震荡期时不加仓，记进未加仓理由）
 it('can restrict the guard K to the solid (trend) line: range events are skipped with a reason, old plans unchanged',async()=>{
  const g={...rule('dbl5','confirm'),kSource:'guard' as const},only={...g,guardTrendOnly:true};
  expect(structureAdditionIdentity(only)).not.toEqual(structureAdditionIdentity(g));expect(JSON.stringify(structureAdditionIdentity(only))).toContain('guard-trend-only-v1');
  expect(structureAdditionIdentity({...g,guardTrendOnly:false})).toEqual(structureAdditionIdentity(g));
  expect(structureAdditionIdentity({...rule(),guardTrendOnly:true})).toEqual(structureAdditionIdentity(rule()));
  expect(structureAdditionLabel(only)).toContain('K＝防守线（只用实线）');expect(structureAdditionLabel(g)).not.toContain('只用实线');
  expect(()=>validateStructureAddition({...only,guardTrendOnly:'yes' as unknown as boolean})).toThrow('防守线类型');
  const o=context(sample()),both=await findCalculatorAdditions({...o,structure:g,maxRounds:3}),solid=await findCalculatorAdditions({...o,structure:only,maxRounds:3});
  expect(both.fills.map(f=>[f.at,f.structureEvidence!.guardRegime])).toEqual([[T+8*STEP,'range'],[T+14*STEP,'trend']]);expect(both.skipped).toBeUndefined();
  expect(solid.fills.map(f=>[f.at,f.structureEvidence!.guardRegime])).toEqual([[T+14*STEP,'trend']]);
  expect(solid.skipped).toEqual([{at:T+8*STEP,round:1,support:100,kind:'guard-range',label:'防守线是虚线（震荡期）',reading:'只用实线时，震荡期不加仓'}]);
 });
 it('a guard K stop ignores wicks and sells at the next minute open after the required closes',async()=>{
  const o=context(sample()),at=o.entry+20*STEP,K=95;
  const fill={at,price:100,quantity:1,notional:100,scanFrom:o.entry,reading:0,threshold:0,direction:'>' as const,metric:'confirmed_support',label:'',barOpenTime:at-STEP,structureEvidence:{...evidence(),guardPrice:K,guardRegime:'range' as const,guardCloses:2,k:K},sizing:{support:K,previousSupport:90,atr:1,atrAt:at,coinsBefore:1,realAverageBefore:90,baseCoins:1,mirrorCoins:0,mirrorUsed:0}};
  const m=(t:number,open:number,low:number,close:number)=>({openTime:t,open,high:Math.max(open,close)+.1,low,close,volume:1,quoteVolume:1,takerBuyVolume:1,takerBuyQuoteVolume:1});
  // 第一个 5 分钟：影线到 90 但收 96；第二个收 94（1 根）；第三个回到 96（清零）；第四、五个连续收 94、93 → 第六个 5 分钟的第一分钟开盘卖出
  const closes=[96,94,96,94,93,92],prices=Array.from({length:35},(_,i)=>{const t=at+i*M,c=closes[Math.floor(i/5)]??92;return m(t,c,i===2?90:c-.1,c);});
  const r=await findCalculatorAdditions({...o,since:at,end:at+35*M,prices,previous:[fill],maxRounds:1});
  expect(r.stop).toMatchObject({at:at+25*M,price:92,support:K,atOpen:true,confirmCloses:2});
  const trend=await findCalculatorAdditions({...o,since:at,end:at+35*M,prices,previous:[{...fill,structureEvidence:{...fill.structureEvidence,guardRegime:'trend' as const,guardCloses:1}}],maxRounds:1});
  expect(trend.stop).toMatchObject({at:at+10*M,price:96,confirmCloses:1});
 });
 // 【用户要求】2026-11-03「加仓后，无论如何都不要亏」：保本底线 F＝防守线 K − m×ATR，加仓量按 F 算，盘中碰到 F 即按 F 卖
 it('sizes a guard-line addition on the breakeven floor F below the guard K, and leaves box K untouched',async()=>{
  const o=context(sample()),g={...rule(),kSource:'guard' as const};
  const plain=await findCalculatorAdditions({...o,structure:g,maxRounds:1}),floored=await findCalculatorAdditions({...o,structure:g,maxRounds:1,breakevenFloor:{enabled:true,atr:.5}});
  const p=plain.fills[0],f=floored.fills[0];expect(f.at).toBe(p.at);
  expect(f.sizing!.guardK).toBe(p.sizing!.support);expect(f.sizing!.floorAtr).toBe(.5);expect(f.structureEvidence!.k).toBe(p.sizing!.support);
  expect(f.sizing!.support).toBeLessThan(f.sizing!.guardK!);expect(f.sizing!.support).toBeGreaterThanOrEqual(f.sizing!.guardK!-.5*f.sizing!.atr-1);
  expect(f.quantity).toBeLessThan(p.quantity);
  const z=f.sizing!;expect(z.coinsBefore*(z.support-z.previousSupport)+z.mirrorUsed).toBeCloseTo(f.quantity*(f.price-z.support));
  // K 不取防守线（旧 C / 新 C 碰线即卖）时这个选项不起作用
  const box=await findCalculatorAdditions({...o,structure:rule(),maxRounds:1}),boxFloor=await findCalculatorAdditions({...o,structure:rule(),maxRounds:1,breakevenFloor:{enabled:true,atr:.5}});
  expect(boxFloor.fills).toEqual(box.fills);
 });
 it('sells at F intrabar when price falls through it before the guard close confirms, otherwise keeps the close-confirmed guard stop',async()=>{
  const o=context(sample()),at=o.entry+20*STEP,G=95,F=93;
  const fill={at,price:100,quantity:1,notional:100,scanFrom:o.entry,reading:0,threshold:0,direction:'>' as const,metric:'confirmed_support',label:'',barOpenTime:at-STEP,structureEvidence:{...evidence(),guardPrice:G,guardRegime:'range' as const,guardCloses:2,k:G},sizing:{support:F,previousSupport:90,atr:1,atrAt:at,coinsBefore:1,realAverageBefore:90,baseCoins:1,mirrorCoins:0,mirrorUsed:0,guardK:G,floorAtr:2}};
  const m=(t:number,open:number,low:number,close:number)=>({openTime:t,open,high:Math.max(open,close)+.1,low,close,volume:1,quoteVolume:1,takerBuyVolume:1,takerBuyQuoteVolume:1});
  // 第 3 分钟一根长下影刺到 92：防守线（收盘确认）不卖，保本底线 F＝93 盘中触到，按 93 卖
  const wick=Array.from({length:35},(_,i)=>{const t=at+i*M;return m(t,96,i===2?92:95.9,96);});
  const r=await findCalculatorAdditions({...o,since:at,end:at+35*M,prices:wick,previous:[fill],maxRounds:1});
  expect(r.stop).toMatchObject({at:at+2*M,price:F,atOpen:false,cause:{id:'addition-floor',label:'保本底线 F',threshold:F}});
  // 收盘连续 2 根低于防守线 95、却没碰到 93：照旧下一分钟开盘卖
  const closes=[96,94,94,94],slow=Array.from({length:20},(_,i)=>{const t=at+i*M,c=closes[Math.floor(i/5)]??94;return m(t,c,c-.1,c);});
  const g=await findCalculatorAdditions({...o,since:at,end:at+20*M,prices:slow,previous:[fill],maxRounds:1});
  expect(g.stop).toMatchObject({at:at+15*M,price:94,support:G,atOpen:true,confirmCloses:2});expect(g.stop!.cause).toBeUndefined();
  // 跳空：开盘已在 F 下方，按开盘价
  const gap=Array.from({length:10},(_,i)=>{const t=at+i*M;return i<3?m(t,96,95.9,96):m(t,90,89.9,90);});
  expect((await findCalculatorAdditions({...o,since:at,end:at+10*M,prices:gap,previous:[fill],maxRounds:1})).stop).toMatchObject({at:at+3*M,price:90,atOpen:true,cause:{id:'addition-floor'}});
 });
 it('adds the floor to the run identity only when enabled and validates m',()=>{
  const add={...defaultQualityAddition(),enabled:true,source:'structure' as const,structure:{...rule(),kSource:'guard' as const}},on={...add,breakevenFloor:{enabled:true,atr:.5}};
  expect(JSON.stringify(additionIdentity(on))).toContain('breakeven-floor-v1');
  expect(JSON.stringify(additionIdentity({...add,breakevenFloor:{enabled:false,atr:.5}}))).toBe(JSON.stringify(additionIdentity(add)));
  for(const atr of [-1,NaN,21])expect(()=>validateQualityAddition({...on,quantityMode:'calculator',breakevenFloor:{enabled:true,atr}})).toThrow('保本底线');
 });
 // 【用户要求】2026-11-03 ORDIUSDT「K 下移时并未减仓，后续的加仓也出了问题」：减仓所得已用来把成本线压到 K′，不能再当可用利润
 it('after a support-drop reduction, sizes the next addition on the real ledger: remaining lots’ cushion at K plus all banked profit',async()=>{
  const o=context(sample()),e=o.entryPrice,coins0=o.notional/e,mirror=o.mirror,early=T+9*STEP;
  // 第 1 次加仓（续算的旧成交）：95 买 0.5 枚、K＝92，用掉全部镜像利润；随后支撑下移在 97 减仓 20%，K 挪到 93
  const q1=.5,mirrorProfit=coins0*mirror.fraction*(mirror.price-e);
  const fill1={at:early,price:95,quantity:q1,notional:95*q1,scanFrom:o.entry,reading:0,threshold:0,direction:'>' as const,metric:'confirmed_support',label:'',barOpenTime:early-STEP,sizing:{support:92,previousSupport:e,atr:1,atrAt:early,coinsBefore:coins0*(1-mirror.fraction),realAverageBefore:e,baseCoins:q1,mirrorCoins:0,mirrorUsed:mirrorProfit}};
  const held=coins0*(1-mirror.fraction)+q1,cost=o.notional*(1-mirror.fraction)+95*q1,x=.2,cut=T+12*STEP;
  const red={at:cut,price:97,fraction:x,quantity:x*held,costRemoved:x*cost,realizedPnl:x*held*97-x*cost,breakeven:0,previousK:92,newK:93,previousSupport:95,newSupport:94,atr:1};
  const v2={enabled:false,minDropAtr:.5,maxPct:80,version:2 as const};
  const r=await findCalculatorAdditions({...o,since:cut+M,previous:[fill1],previousReductions:[red],structure:rule(),maxRounds:2,supportReduction:v2});
  const f=r.fills.at(-1)!;expect(r.fills).toHaveLength(2);const K=f.sizing!.support;
  // 加仓校验的账：各仓按开仓价在 K 的浮盈垫 + 全部落袋 G ＝ 新增币数 ×（T − K）
  const lots=coins0*(1-mirror.fraction)*(1-x)*(K-e)+q1*(1-x)*(K-95),G=mirrorProfit+red.realizedPnl;
  expect(f.quantity*(f.price-K)).toBeCloseTo(lots+G,9);
  // 成本线取减仓后整笔真实保本价，落袋不再另算可用
  expect(f.sizing!.previousSupport).toBeCloseTo((cost*(1-x)-G)/(held*(1-x)),9);expect(f.sizing!.mirrorAvailableBefore).toBe(0);
  // 【用户要求】2026-11-03 模板必须原样复原：没写版本（11-02 存的方案与模板）照旧按 v1——成本线取 K′，减仓所得另算可用
  const v1=await findCalculatorAdditions({...o,since:cut+M,previous:[fill1],previousReductions:[red],structure:rule(),maxRounds:2,supportReduction:{...v2,version:undefined}});
  const g=v1.fills.at(-1)!;expect(g.at).toBe(f.at);expect(g.sizing!.previousSupport).toBe(93);expect(g.quantity).not.toBeCloseTo(f.quantity,6);
 });
 it('skips a vetoed addition, records the time and reason, and waits for the next new C (2026-11-02 加仓否决)',async()=>{
  const o=context(sample()),plain=await findCalculatorAdditions({...o,structure:rule(),maxRounds:1});expect(plain.fills).toHaveLength(1);expect(plain.vetoed).toBeUndefined();
  const all=await findCalculatorAdditions({...o,structure:rule(),maxRounds:1,entryVetoes:[{kind:'volatility',enabled:true,ratio:50,er:1}]});
  expect(all.fills).toEqual([]);expect(all.vetoed?.[0]).toMatchObject({at:plain.fills[0].at,round:1,kind:'volatility',label:expect.stringContaining('高震荡')});
  const off=await findCalculatorAdditions({...o,structure:rule(),maxRounds:1,entryVetoes:[{kind:'volatility',enabled:false,ratio:50,er:1}]});expect(off.fills).toHaveLength(1);
 });
 it('checks 方向 conditions at the box event itself: unmet conditions skip the event, met ones are recorded with the fill',async()=>{
  const price=(direction:'<'|'>',threshold:number):AdditionCandidate=>({plan:compileFishProgram({id:'add-dir-price',name:'价格',short:'价',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'5m'},{statistic:'结果',direction,threshold,constraints:[]}),scale:1,threshold,direction,metric:'结果',label:'收盘价'});
  const o=context(sample()),structure={...rule(),buffer:.5};
  const plain=await findCalculatorAdditions({...o,structure,maxRounds:1});expect(plain.fills).toHaveLength(1);
  const met=await findCalculatorAdditions({...o,structure,required:[price('>',0)],maxRounds:1});
  expect(met.fills).toHaveLength(1);expect(met.fills[0]).toMatchObject({at:plain.fills[0].at,price:plain.fills[0].price,quantity:plain.fills[0].quantity});
  expect(met.fills[0].conditions).toHaveLength(1);expect(met.fills[0].conditions![0]).toMatchObject({label:'收盘价',direction:'>',threshold:0,at:plain.fills[0].at});
  const unmet=await findCalculatorAdditions({...o,structure,required:[price('>',1e9)],maxRounds:1});expect(unmet.fills).toEqual([]);
 });
 it('adds 方向 conditions to the identity only when present, so existing box and detector plans keep their results',()=>{
  const old={...defaultQualityAddition(),enabled:true},box={...old,source:'structure' as const,structure:rule()},filter=makeQualityBuyFilter('mbi:MBI','>',.5,true,BUILTIN_FEATURES);
  for(const base of [old,box]){
   const key=JSON.stringify(additionIdentity(base));
   expect(JSON.stringify(additionIdentity({...base,prerequisites:[]}))).toBe(key);
   expect(JSON.stringify(additionIdentity({...base,prerequisites:[filter]}))).not.toBe(key);
   expect(JSON.stringify(additionIdentity({...base,maxRounds:2,rounds:[base,{...base,prerequisites:[filter]}]}))).not.toBe(JSON.stringify(additionIdentity({...base,maxRounds:2,rounds:[base,base]})));
  }
  expect(()=>validateQualityAddition({...box,prerequisites:[{...filter,threshold:NaN}]})).toThrow('方向条件');
 });
 // 【用户要求】2026-11-03 未加仓理由：支撑线上移（新 C）却没加仓的每一次都记下第几次加仓、原因与读数
 it('records why a raised support did not become an addition: gain gate, no old C, gap below C, sizing, direction',async()=>{
  const o=context(sample()),at=T+14*STEP;
  expect((await findCalculatorAdditions({...o,structure:rule(),maxRounds:1})).skipped).toBeUndefined();
  const gain=await findCalculatorAdditions({...o,structure:rule(),minGainPct:500});expect(gain.fills).toEqual([]);
  expect(gain.skipped).toEqual([{at,round:1,support:102,kind:'gain',label:'涨幅门槛未达',reading:'收盘 105 比成本线 S 90 只涨 16.67%，要求 ≥ 500%'}]);
  // 首个箱体（BASELINE）没有旧 C：只报一次，之后的新 C 照常加仓
  const confirm=await findCalculatorAdditions({...o,structure:rule('dbl5','confirm'),maxRounds:3});
  expect(confirm.fills.map(f=>f.at)).toEqual([at]);expect(confirm.skipped).toEqual([expect.objectContaining({at:T+8*STEP,round:1,support:100,kind:'no-old-c',label:'没有旧 C'})]);
  const prices=o.prices.map(b=>b.openTime===at?{...b,open:101}:b);
  expect((await findCalculatorAdditions({...o,prices,structure:rule()})).skipped).toEqual([expect.objectContaining({at,round:1,kind:'below-c',reading:'下一分钟开盘 T 101 ≤ 新 C 102'})]);
  expect((await findCalculatorAdditions({...o,structure:{...rule(),buffer:10}})).skipped).toEqual([expect.objectContaining({at,round:1,kind:'sizing',label:'落袋利润不够'})]);
  const price:AdditionCandidate={plan:compileFishProgram({id:'add-dir-price',name:'价格',short:'价',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'5m'},{statistic:'结果',direction:'>',threshold:1e9,constraints:[]}),scale:1,threshold:1e9,direction:'>',metric:'结果',label:'收盘价'};
  const dir=await findCalculatorAdditions({...o,structure:rule(),required:[price],maxRounds:1});expect(dir.fills).toEqual([]);
  expect(dir.skipped).toEqual([expect.objectContaining({at,round:1,kind:'direction',label:'方向条件未满足',reading:'需同时满足：收盘价 > 1000000000'})]);
  // 被否决的加仓只进 vetoed，不重复记成跳过
  const vetoed=await findCalculatorAdditions({...o,structure:rule(),maxRounds:1,entryVetoes:[{kind:'volatility',enabled:true,ratio:50,er:1}]});
  expect(vetoed.vetoed).toHaveLength(1);expect(vetoed.skipped).toBeUndefined();
 });
 it('reports each skipped box event once across paginated reads and never for a box already added on',async()=>{
  const o=context(sample()),r=rule('dbl5','confirm'),seen:unknown[]=[],read=createStructureAdditionReader(o);
  const first=await read(r,o.entry,T+14*STEP,[],undefined,s=>seen.push(s));expect(first).toBeUndefined();
  const hit=await read(r,T+14*STEP-M,o.end,[],undefined,s=>seen.push(s));expect(hit?.at).toBe(T+14*STEP);
  await read(r,hit!.at,o.end,[],undefined,s=>seen.push(s));
  expect(seen).toEqual([{at:T+8*STEP,support:100,reason:'no-old-c'}]);
  // BASELINE 那一箱已加过仓（续算的旧成交）：不再把它记成「没有旧 C」
  const baseline=(await createStructureAdditionReader(o)({...r,kSource:'current'},o.entry,o.end,[]))!.structureEvidence!;expect(baseline).toMatchObject({at:T+8*STEP,event:'BASELINE'});
  const used={...hit!,quantity:1,notional:100,structureEvidence:{...hit!.structureEvidence!,boxId:baseline.boxId}},late:unknown[]=[];
  await createStructureAdditionReader(o)(r,o.entry,o.end,[used],undefined,s=>late.push(s));expect(late).toEqual([]);
 });
 it('carries the skip records through evaluateQualitySample and merges them without duplicates on resume',async()=>{
  const o=context(sample()),def={id:'never-sell',name:'不卖',short:'不卖',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
  const snapshot={featureId:def.id,featureName:def.name,featureShort:def.short,definitionKey:definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:0,direction:'<' as const,average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:o.entry};
  const qualitySample:QualitySample={id:'structure-skips',enteredAt:o.entry,basis:'capture',importedAt:o.entry,groups:[],source:{...o.row,timeMs:o.entry,fish:snapshot}};
  const group:QualityGroup={id:'g',label:'箱体加仓',snapshot,metric:'raw',rule:{metric:'raw',direction:'<',threshold:0},mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50},addition:{...defaultQualityAddition(),enabled:true,source:'structure',structure:rule(),entryBufferAtr:0,minGainPct:500}};
  const full=await evaluateQualitySample(qualitySample,group,0,T+17*STEP,o.load,o.signal);expect(full.status).not.toBe('error');
  expect(full.additionFills??[]).toEqual([]);expect(full.additionSkipsFrom).toBe(full.entryTime);
  expect(full.additionSkips).toEqual([expect.objectContaining({at:T+14*STEP,round:1,kind:'gain'})]);
  const part=await evaluateQualitySample(qualitySample,group,0,T+15*STEP,o.load,o.signal),resumed=await evaluateQualitySample(qualitySample,group,0,T+17*STEP,o.load,o.signal,part);
  expect(resumed.additionSkips).toEqual(full.additionSkips);expect(resumed.additionSkipsFrom).toBe(full.additionSkipsFrom);
  // 旧版本结果（没有 additionSkipsFrom）续算：记录只从续算起点开始
  const legacy={...part};delete legacy.additionSkips;delete legacy.additionSkipsFrom;
  const fromLegacy=await evaluateQualitySample(qualitySample,group,0,T+17*STEP,o.load,o.signal,legacy);expect(fromLegacy.additionSkipsFrom).toBeGreaterThan(full.entryTime!);
  const data=buildQualityCampaignData('owner',{sample:qualitySample,plan:group,result:full,detectors:[],observeHours:0,firstEvaluatedAt:o.entry},'sell'),ev=data.campaign.comparison!.sellEvidence!;
  expect(ev.additionSkips).toEqual(full.additionSkips);expect(ev.additionSkipsFrom).toBe(full.additionSkipsFrom);
 });
});

// 【用户要求】2026-11-05 每轮分流（版本 3）：这一轮的保守（箱体）与进攻（指标 S/T/K）规则同时等候，先满足者成交，同一分钟先箱体；成交记下 lane
describe('per-round race between the conservative box rule and the attack alternative',()=>{
 const price=(threshold:number):AdditionCandidate=>({plan:compileFishProgram({id:'race-price',name:'价格',short:'价',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'5m'},{statistic:'结果',direction:'>',threshold,constraints:[]}),scale:1,threshold,direction:'>',metric:'结果',label:'收盘价'});
 it('lets the earlier rule win, records the lane, and leaves rounds without an alternative untouched',async()=>{
  const o=context(sample()),structure={...rule(),buffer:.5};
  const plain=await findCalculatorAdditions({...o,structure,maxRounds:1,roundRules:[{candidates:[],structure}]});
  expect(plain.fills).toHaveLength(1);expect(plain.fills[0].lane).toBeUndefined();
  const attack=await findCalculatorAdditions({...o,structure,maxRounds:1,roundRules:[{candidates:[],structure,alternative:{candidates:[price(0)],supportOffsetAtr:1.5}}]});
  expect(attack.fills).toHaveLength(1);const f=attack.fills[0];
  expect(f.lane).toBe('attack');expect(f.structureEvidence).toBeUndefined();expect(f.at).toBeLessThan(plain.fills[0].at);
  expect(f.sizing!.support).toBeCloseTo(f.price-1.5*f.sizing!.atr);
  expect((attack.skipped??[]).every(s=>s.at<=f.at)).toBe(true);
  const conservative=await findCalculatorAdditions({...o,structure,maxRounds:1,roundRules:[{candidates:[],structure,alternative:{candidates:[price(1e9)],supportOffsetAtr:1.5}}]});
  expect(conservative.fills).toHaveLength(1);expect(conservative.fills[0]).toEqual({...plain.fills[0],lane:'structure'});
 });
 it('gives alternative rounds their own identity and validation',()=>{
  const base={...defaultQualityAddition(),enabled:true,source:'structure' as const,structure:rule(),maxRounds:1,rounds:[{source:'structure' as const,stricterPct:10,structure:rule()}]};
  const alt={source:'custom' as const,stricterPct:10,condition:makeQualityBuyFilter('state:state','>',.85,true,BUILTIN_FEATURES),minGainPct:10,gainBasis:'average' as const,entryDistanceAtr:2,supportOffsetAtr:1.5};
  const raced={...base,alternativeRounds:[alt]};
  validateQualityAddition(raced);
  expect(JSON.stringify(additionIdentity(raced))).toContain('addition-round-race-v1');expect(additionIdentity({...raced,alternativeRounds:[]})).toEqual(additionIdentity(base));
  expect(()=>validateQualityAddition({...raced,alternativeRounds:[alt,alt]})).toThrow('不能多于');
  expect(()=>validateQualityAddition({...raced,alternativeRounds:[{...alt,supportOffsetAtr:0}]})).toThrow('进攻备选');
  // 【用户要求】2026-11-06 结构开局：attackFromRound＝1 身份不变；>1 身份加 addition-round-race-from-v1；不能超过备选轮数、须配合备选
  expect(additionIdentity({...raced,attackFromRound:1})).toEqual(additionIdentity(raced));
  const two={...raced,maxRounds:2,rounds:[raced.rounds[0],raced.rounds[0]],alternativeRounds:[alt,alt],attackFromRound:2};
  validateQualityAddition(two);expect(JSON.stringify(additionIdentity(two))).toContain('["addition-round-race-from-v1",2]');
  expect(()=>validateQualityAddition({...two,attackFromRound:3})).toThrow('1 至 2');
  expect(()=>validateQualityAddition({...base,attackFromRound:2})).toThrow('须配合进攻备选');
 });
 // 【用户要求】2026-11-06 结构开局：进攻备选从第 n 次起才参与竞速，之前的轮次只扫保守规则
 it('keeps the attack lane out of the rounds before attackFromRound',async()=>{
  const o=context(sample()),structure={...rule(),buffer:.5};
  const roundRules=[{candidates:[],structure,alternative:{candidates:[price(0)],supportOffsetAtr:1.5}}];
  const plain=await findCalculatorAdditions({...o,structure,maxRounds:1,roundRules:[{candidates:[],structure}]});
  const gated=await findCalculatorAdditions({...o,structure,maxRounds:1,roundRules,attackFromRound:2});
  expect(gated.fills).toHaveLength(1);expect(gated.fills[0]).toEqual(plain.fills[0]);expect(gated.fills[0].lane).toBeUndefined();
  const open=await findCalculatorAdditions({...o,structure,maxRounds:1,roundRules,attackFromRound:1});
  expect(open.fills[0].lane).toBe('attack');
 });
});
