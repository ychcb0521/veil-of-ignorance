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
});

