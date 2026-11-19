import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as features from '@/lib/deepDig/features';
import {intervalMs} from '@/lib/deepRsa/marketData';

import {BOX_SECOND_BREAK_CHOICE,BOX_SECOND_BREAK_VERSION,boxStopIdentity,createBoxStopReader,defaultBoxBreak,defaultBoxSecondBreak,defaultBoxStop,selectBoxStopTimeframe,validateBoxStop} from '@/lib/fish/qualityBoxStop';
import {evaluateQualitySample,qualityResultKey,type QualityGroup,type QualitySample} from '@/lib/fish/quality';
import {defaultQualityAddition} from '@/lib/fish/qualityAddition';
import {holdingVetoDraft,parseHoldingVetoDraft,makeQualityBuyFilter} from '@/lib/fish/qualityFilters';
import {freezeQualityPlan,planVersionChanges,qualityPlanVersions} from '@/lib/fish/qualityPlanVersions';
import {stagedHoldingVetoes} from '@/lib/fish/qualityVetoStages';
import {emptyPreEntryConditions,validatePreEntryConditions} from '@/lib/fish/preEntryConditions';
import type {QualityHoldingVeto} from '@/lib/fish/qualityVeto';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
import type {ResearchBar} from '@/lib/deepRsa/window';
const M=60000,T=Date.UTC(2026,9,20),signal=new AbortController().signal;
const row={id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const sample:QualitySample={id:'s',enteredAt:T,basis:'signal',importedAt:T,groups:[],source:row};
const bar=(at:number,open=100,low=open-1,close=open):ResearchBar=>({openTime:at,open,high:Math.max(open,close)+1,low,close,volume:1,quoteVolume:100,takerBuyVolume:0,takerBuyQuoteVolume:1});
const actualEvaluate=features.evaluateOnBars;
let broken:(at:number)=>boolean,invalid=false;
beforeEach(()=>{
 broken=at=>at===T+5*M||at===T+15*M;invalid=false;
 vi.spyOn(features,'evaluateOnBars').mockImplementation((bars,compiled,params)=>{
  if(!compiled.usesDbl5)return actualEvaluate(bars,compiled,params);
  const step=intervalMs(features.intervalOf(params));
  return {vars:new Map(),DBL5_details:bars.map(b=>({at:b.openTime+step,data_valid:!invalid,darvas_5m_guard:null,darvas_5m_available:false,darvas_5m_guard_broken:broken(b.openTime+step)}))} as unknown as ReturnType<typeof features.evaluateOnBars>;
 });
});
afterEach(()=>vi.restoreAllMocks());
const veto=(rule=defaultBoxSecondBreak(),id='second'):QualityHoldingVeto=>({id,label:'二次断裂',kind:'box-stop',direction:'<=',threshold:0,enabled:true,boxStop:rule});
const load=(minute:(t:number)=>ResearchBar=bar):FishReconstructionLoader=>async(_row,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?minute(a+i*M):bar(a+i*p.step));
const reader=(previous?:Parameters<typeof createBoxStopReader>[0]['previous'],since=T,rule=defaultBoxSecondBreak())=>createBoxStopReader({vetoes:[veto(rule)],row,entry:T,since,load:load(),signal,previous});
const plan=():QualityGroup=>({id:'g',label:'二次红叉',metric:'raw',vetoFill:'stop',holdingVetoes:[veto()],snapshot:{featureId:'p',definitionKey:'C',statistic:'raw',interval:'5m',scale:1,threshold:0,direction:'<',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T}});
const run=async(g=plan(),now=T+18*M,l=load(),prior?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>{
 const result=await evaluateQualitySample(sample,g,0,now,l,signal,prior);
 expect(result.status,result.reason).not.toBe('error');return result;
};
const triggerDef={id:'add',name:'加仓',short:'加仓',definition:'',formula:'raw = B',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
const addCondition=makeQualityBuyFilter('add:raw','>',.5,true,[triggerDef]);
addCondition.snapshot={...addCondition.snapshot,interval:'1m',definitionKey:features.definitionKey(triggerDef)};
const addingPlan=():QualityGroup=>({...plan(),addition:{...defaultQualityAddition(),enabled:true,source:'custom',condition:addCondition},mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50}});
const rising=load(at=>{const n=(at-T)/M;return {...bar(at,100+Math.max(0,n)*10),volume:1,...(n===0?{high:106}:{})};});

it('first confirmed event locks additions without selling; warmup, wicks and repeated reads do not count again',async()=>{
 const original=broken;broken=at=>at<=T||original(at);
 const r=reader();
 expect(await r.read(bar(T,100,1))).toBeUndefined();expect(r.states().second.breakCount).toBeUndefined();
 expect(await r.read(bar(T+4*M,100,1))).toBeUndefined();
 expect(await r.read(bar(T+5*M))).toBeUndefined();
 expect(r.states().second).toMatchObject({breakCount:1,firstBreakAt:T+5*M,confirmedAt:T+5*M});
 expect(await r.read(bar(T+5*M,80,1))).toBeUndefined();
 expect(await r.read(bar(T+10*M,80,1))).toBeUndefined();
 expect(r.states().second.breakCount).toBe(1);
 expect(r.statesAt(T+4*M).second.firstBreakAt).toBeUndefined();
 expect(await r.read(bar(T+15*M,70,1))).toMatchObject({at:T+15*M,fillPrice:70,cause:{threshold:2,boxBreakEvidence:{version:BOX_SECOND_BREAK_VERSION,breakCount:2,firstBreakAt:T+5*M,confirmedAt:T+15*M,sourceBarOpenTime:T+10*M}}});
});
it.each([false,true])('restores counts from checkpoints or missed settlement history (saved=%s)',async saved=>{
 const r=reader();await r.read(bar(T+8*M));
 const resumed=reader(saved?JSON.parse(JSON.stringify(r.states())):undefined,T+9*M);
 expect(await resumed.read(bar(T+10*M))).toBeUndefined();
 expect(resumed.states().second.breakCount).toBe(1);
 expect(await resumed.read(bar(T+15*M,77))).toMatchObject({fillPrice:77,cause:{boxBreakEvidence:{breakCount:2,firstBreakAt:T+5*M}}});
});
it('resumes the whole holding identically and never invents the second execution open',async()=>{
 const g=plan(),l=load(t=>bar(t,t===T+15*M?77:100));
 const first=await run(g,T+9*M,l);
 expect(first).toMatchObject({status:'open',additionsBlockedAt:T+5*M,boxStopStates:{second:{breakCount:1}},additionNote:expect.stringContaining('停止后续加仓')});
 expect(await run(g,T+18*M,l,JSON.parse(JSON.stringify(first)))).toEqual(await run(g,T+18*M,l));
 const pending=await run(g,T+15*M,l);
 expect(pending.status).toBe('open');
 expect(await run(g,T+16*M,l,pending)).toMatchObject({status:'closed',endTime:T+15*M,endPrice:77,reason:expect.stringContaining('第二次箱体断裂')});
});
it('stops both calculator lanes and all later rounds at the first break while retaining earlier fills',async()=>{
 const g=addingPlan(),round={source:'custom' as const,stricterPct:0,condition:addCondition};
 g.addition={...g.addition!,maxRounds:20,rounds:Array.from({length:20},()=>round),alternativeRounds:Array.from({length:20},()=>round)};
 const result=await run(g,T+14*M,rising);
 expect(result.additionFills?.map(f=>f.at),JSON.stringify(result)).toEqual([1,2,3,4].map(n=>T+n*M));
 expect(result).toMatchObject({status:'open',additionsBlockedAt:T+5*M});
 expect(await run(g,T+14*M,rising,await run(g,T+7*M,rising))).toEqual(result);
 const attackOnly=structuredClone(g);
 attackOnly.addition!.rounds=attackOnly.addition!.rounds!.map(r=>({...r,condition:{...addCondition,threshold:2}}));
 const attack=await run(attackOnly,T+14*M,rising);
 expect(attack.additionFills?.map(f=>[f.at,f.lane])).toEqual([1,2,3,4].map(n=>[T+n*M,'attack']));
});
it.each(['fixed','entry',undefined] as const)('blocks single-addition sizing too (mode=%s)',async quantityMode=>{
 const g=addingPlan();g.addition={...g.addition!,quantityMode,quantity:1,amountMode:'fixed',amountUsdt:100,
  condition:{...addCondition,threshold:2}};
 const late=load(at=>({...bar(at,at===T?100:120),volume:at>=T+4*M?3:0,takerBuyQuoteVolume:at>=T+4*M?3:0,...(at===T?{high:106}:{})}));
 expect((await run(g,T+14*M,late)).additionFill).toBeUndefined();
 g.holdingVetoes=[];
 expect((await run(g,T+14*M,late)).additionFill?.at).toBe(T+5*M);
});
it('continues the existing addition K stop and ordinary exits after the first break',async()=>{
 const g=addingPlan(),l=load(at=>{const n=(at-T)/M;return n<6?{...bar(at,100+Math.max(0,n)*10),volume:n===0?1:0,takerBuyQuoteVolume:n===0?1:0,...(n===0?{high:106}:{})}:bar(at,120,100);});
 const stopped=await run(g,T+10*M,l);
 expect(stopped,JSON.stringify(stopped)).toMatchObject({status:'closed',endTime:T+6*M,additionsBlockedAt:T+5*M,exitSnapshot:{cause:{kind:'addition-support'}}});
 const ordinary={...plan(),rule:{metric:'raw',direction:'>' as const,threshold:150},snapshot:{...plan().snapshot,definitionKey:features.definitionKey({...triggerDef,formula:'raw = C'}),interval:'1m'}};
 expect(await run(ordinary,T+14*M,rising)).toMatchObject({status:'closed',endTime:T+7*M,additionsBlockedAt:T+5*M});
});
it('does not leak a future first break into an earlier stage checkpoint or lose the lock on stage replacement',async()=>{
 const g=addingPlan();g.sellStages=[{afterAdditions:1,label:'后段',metric:'raw',snapshot:addCondition.snapshot,rule:{metric:'raw',direction:'<' as const,threshold:-1}}];
 const first=await run(g,T+3*M,rising);expect(first.additionsBlockedAt).toBeUndefined();expect(first.boxStopStates?.second.firstBreakAt).toBeUndefined();
 const whole=await run(g,T+14*M,rising);
 expect(whole.additionsBlockedAt).toBe(T+5*M);expect(whole.additionFills,JSON.stringify(whole)).toHaveLength(4);
 const changed={...addingPlan(),holdingVetoes:[]};
 const prior={...whole,key:qualityResultKey(sample,changed,0)};
 const resumed=await run(changed,T+16*M,rising,prior);
 expect(resumed.additionsBlockedAt).toBe(T+5*M);expect(resumed.additionFills).toHaveLength(4);
});
it('freezes an independent execution version and roundtrips without altering legacy rules or stage slots',()=>{
 const old=freezeQualityPlan({...plan(),holdingVetoes:[veto(defaultBoxBreak(),'old'),veto(defaultBoxStop(),'stop')]}),copy=structuredClone(old);
 const next=freezeQualityPlan(plan());expect(planVersionChanges(next)).toEqual([]);
 expect(qualityPlanVersions(next).find(v=>v.key==='hard-stop-box-0')?.version).toContain(BOX_SECOND_BREAK_VERSION);
 const reordered=JSON.parse(JSON.stringify(next,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));
 expect(planVersionChanges(reordered)).toEqual([]);
 const changed=structuredClone(next);changed.holdingVetoes![0].boxStop!.structure.definition.DBL5_config!.guard_range_closes=3;
 expect(planVersionChanges(changed).map(v=>v.key)).toContain('hard-stop-box-0');
 expect(parseHoldingVetoDraft(holdingVetoDraft(next.holdingVetoes))[0].boxStop).toEqual(next.holdingVetoes![0].boxStop);
 const slots=stagedHoldingVetoes({...old,vetoStages:[{afterAdditions:1,conditions:[veto()]}]},1);
 expect(slots).toHaveLength(3);expect(old).toEqual(copy);expect(planVersionChanges(old)).toEqual([]);
 expect(boxStopIdentity(defaultBoxBreak())).not.toEqual(boxStopIdentity(defaultBoxSecondBreak()));
 expect(()=>parseHoldingVetoDraft([{choice:BOX_SECOND_BREAK_CHOICE,direction:'<=',threshold:'0',enabled:true,boxStop:defaultBoxBreak()}])).toThrow('执行版本不符');
 expect(()=>validateBoxStop({...defaultBoxSecondBreak(),confirmation:'touch'})).toThrow('原生红叉');
 expect(()=>validatePreEntryConditions({...emptyPreEntryConditions(),hardVetoes:[veto()]})).toThrow('不能用于买前筛选');
});
it('fails on missing native data rather than silently resetting the first break',async()=>{
 invalid=true;await expect(reader().read(bar(T+6*M))).rejects.toThrow('不能跳过缺口');
});
it('matches two independent unmocked renderer red crosses without changing DBL-5 output',async()=>{
 vi.restoreAllMocks();
 const {computeDbl5,dbl5Numeric,DBL5_RETEST_GUARD_VERSION}=await import('@/lib/dbl5m');
 const rule=defaultBoxSecondBreak([],DBL5_RETEST_GUARD_VERSION),step=5*M,from=T-Math.ceil(features.featureWindowMs(rule.structure.definition)/step)*step;
 let seed=7,price=10000;
 const random=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
 const bars=Array.from({length:1600},(_,i)=>{
  const phase=i%700,drift=phase<200?0:phase<500?6:(11800-price)*.02,open=price,close=Math.max(100,Math.round(open+drift+(random()-.5)*60));
  const wick=phase>=500&&random()<.08?120:20,high=Math.max(open,close)+Math.round(random()*20),low=Math.max(1,Math.min(open,close)-Math.round(random()*wick));price=close;
  return {...bar(from+i*step,open,low,close),high,DBL5_tick_size:1,DBL5_closed:true};
 });
 const expected=computeDbl5(bars,{symbol:row.symbol,tickSize:1,config:rule.structure.definition.DBL5_config,initializationStart:from}).rows.filter(r=>r.at>T&&dbl5Numeric(r,'_DBL5_guard_broken')===1);
 expect(expected.length).toBeGreaterThanOrEqual(2);
 const nativeLoad:FishReconstructionLoader=async(_row,a,b)=>bars.filter(x=>x.openTime>=a&&x.openTime<b);
 const r=createBoxStopReader({vetoes:[veto(rule)],row,entry:T,since:T,load:nativeLoad,signal});
 expect(await r.read(bar(expected[0].at,123))).toBeUndefined();
 expect(r.states().second).toMatchObject({breakCount:1,firstBreakAt:expected[0].at});
 expect(await r.read(bar(expected[1].at-M,123))).toBeUndefined();
 expect(await r.read(bar(expected[1].at,87))).toMatchObject({at:expected[1].at,fillPrice:87,cause:{boxBreakEvidence:{firstBreakAt:expected[0].at,confirmedAt:expected[1].at}}});
});
it('counts the chosen native hourly events independently of the five-minute option',async()=>{
 broken=at=>at===T+60*M||at===T+120*M;
 const r=reader(undefined,T,selectBoxStopTimeframe(defaultBoxSecondBreak(),'1h'));
 expect(await r.read(bar(T+59*M))).toBeUndefined();
 expect(await r.read(bar(T+60*M))).toBeUndefined();
 expect(await r.read(bar(T+119*M))).toBeUndefined();
 expect(await r.read(bar(T+120*M,55))).toMatchObject({fillPrice:55,cause:{boxBreakEvidence:{event:'darvas_1h_guard_broken',firstBreakAt:T+60*M,confirmedAt:T+120*M}}});
});
