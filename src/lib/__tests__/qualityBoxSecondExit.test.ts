import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as features from '@/lib/deepDig/features';
import {intervalMs} from '@/lib/deepRsa/marketData';
import {BOX_SECOND_BREAK_CHOICE,BOX_SECOND_EXIT_CHOICE,BOX_SECOND_EXIT_VERSION,boxAdditionBlockedAt,boxStopIdentity,createBoxStopReader,defaultBoxBreak,defaultBoxSecondBreak,defaultBoxSecondExit,defaultBoxStop,selectBoxStopTimeframe,validateBoxStop} from '@/lib/fish/qualityBoxStop';
import {evaluateQualitySample,newQualityStudy,type QualityGroup,type QualitySample} from '@/lib/fish/quality';
import {defaultQualityAddition} from '@/lib/fish/qualityAddition';
import {defaultBoxBreakVeto} from '@/lib/fish/qualityAdditionVeto';
import {holdingVetoDraft,parseHoldingVetoDraft,makeQualityBuyFilter} from '@/lib/fish/qualityFilters';
import {freezeQualityPlan,planVersionChanges,qualityPlanVersions} from '@/lib/fish/qualityPlanVersions';
import {saveQualityPlanTemplate,qualityPlanFromTemplate,activeQualityPlanTemplates} from '@/lib/fish/qualityPlanTemplates';
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
const veto=(rule=defaultBoxSecondExit(),id='exit'):QualityHoldingVeto=>({id,label:'二次断裂终止',kind:'box-stop',direction:'<=',threshold:0,enabled:true,boxStop:rule});
const load=(minute:(t:number)=>ResearchBar=bar):FishReconstructionLoader=>async(_row,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?minute(a+i*M):bar(a+i*p.step));
const reader=(previous?:Parameters<typeof createBoxStopReader>[0]['previous'],since=T,rule=defaultBoxSecondExit())=>createBoxStopReader({vetoes:[veto(rule)],row,entry:T,since,load:load(),signal,previous});
const plan=():QualityGroup=>({id:'g',label:'二次断裂终止',metric:'raw',vetoFill:'stop',holdingVetoes:[veto()],snapshot:{featureId:'p',definitionKey:'C',statistic:'raw',interval:'5m',scale:1,threshold:0,direction:'<',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T}});
const run=async(g=plan(),now=T+18*M,l=load(),prior?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>{
 const result=await evaluateQualitySample(sample,g,0,now,l,signal,prior);
 expect(result.status,result.reason).not.toBe('error');return result;
};
const triggerDef={id:'add',name:'加仓',short:'加仓',definition:'',formula:'raw = B',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
const addCondition=makeQualityBuyFilter('add:raw','>',.5,true,[triggerDef]);
addCondition.snapshot={...addCondition.snapshot,interval:'1m',definitionKey:features.definitionKey(triggerDef)};
const addingPlan=():QualityGroup=>({...plan(),addition:{...defaultQualityAddition(),enabled:true,source:'custom',condition:addCondition},mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50}});
const rising=load(at=>({...bar(at,100+Math.max(0,(at-T)/M)*10),...(at===T?{high:106}:{})}));

it('counts the first post-entry native event without creating an addition lock, and exits only on the second',async()=>{
 const original=broken;broken=at=>at<=T||original(at);
 const r=reader();
 expect(await r.read(bar(T,100,1))).toBeUndefined();
 expect(await r.read(bar(T+4*M,100,1))).toBeUndefined();
 expect(r.states().exit.breakCount).toBeUndefined();
 expect(await r.read(bar(T+5*M))).toBeUndefined();
 expect(r.states().exit).toMatchObject({breakCount:1,firstCountedBreakAt:T+5*M,confirmedAt:T+5*M});
 expect(r.states().exit.firstBreakAt).toBeUndefined();
 expect(boxAdditionBlockedAt(r.states())).toBeUndefined();
 expect(await r.read(bar(T+5*M,80,1))).toBeUndefined();
 expect(await r.read(bar(T+10*M,80,1))).toBeUndefined();
 expect(r.states().exit.breakCount).toBe(1);
 expect(r.statesAt(T+4*M).exit.firstCountedBreakAt).toBeUndefined();
 expect(await r.read(bar(T+15*M,70,1))).toMatchObject({at:T+15*M,fillPrice:70,cause:{threshold:2,boxBreakEvidence:{version:BOX_SECOND_EXIT_VERSION,breakCount:2,firstBreakAt:T+5*M,confirmedAt:T+15*M,sourceBarOpenTime:T+10*M}}});
 expect(boxAdditionBlockedAt(r.states())).toBeUndefined();
});
it.each([false,true])('restores counts without locking additions from saved state or missed history (saved=%s)',async saved=>{
 const r=reader();await r.read(bar(T+8*M));
 const resumed=reader(saved?JSON.parse(JSON.stringify(r.states())):undefined,T+9*M);
 expect(await resumed.read(bar(T+10*M))).toBeUndefined();
 expect(resumed.states().exit.breakCount).toBe(1);
 expect(boxAdditionBlockedAt(resumed.states())).toBeUndefined();
 expect(await resumed.read(bar(T+15*M,77))).toMatchObject({fillPrice:77,cause:{boxBreakEvidence:{firstBreakAt:T+5*M,breakCount:2}}});
});
it('keeps the same complete holding on resume and waits for the actual second execution open',async()=>{
 const g=plan(),l=load(t=>bar(t,t===T+15*M?77:100));
 const first=await run(g,T+9*M,l);
 expect(first.status).toBe('open');expect(first.additionsBlockedAt).toBeUndefined();
 expect(first.additionNote??'').not.toContain('停止后续加仓');
 expect(first.boxStopStates?.exit.firstCountedBreakAt).toBe(T+5*M);
 expect(await run(g,T+18*M,l,JSON.parse(JSON.stringify(first)))).toEqual(await run(g,T+18*M,l));
 const pending=await run(g,T+15*M,l);expect(pending.status).toBe('open');
 expect(await run(g,T+16*M,l,pending)).toMatchObject({status:'closed',endTime:T+15*M,endPrice:77,reason:expect.stringContaining('本条件未在首次断裂时停止加仓')});
});
it.each(['primary','attack'] as const)('continues eligible %s additions through the first break and sells all at the second',async lane=>{
 const g=addingPlan(),round={source:'custom' as const,stricterPct:0,condition:addCondition};
 g.addition={...g.addition!,maxRounds:20,rounds:Array.from({length:20},()=>({...round,condition:lane==='attack'?{...addCondition,threshold:2}:addCondition})),alternativeRounds:lane==='attack'?Array.from({length:20},()=>round):undefined};
 const first=await run(g,T+14*M,rising);
 expect(first.additionsBlockedAt).toBeUndefined();
 expect(first.additionFills?.map(f=>f.at)).toEqual(Array.from({length:13},(_,i)=>T+(i+1)*M));
 if(lane==='attack')expect(first.additionFills?.every(f=>f.lane==='attack')).toBe(true);
 expect(await run(g,T+14*M,rising,await run(g,T+7*M,rising))).toEqual(first);
 const closed=await run(g,T+18*M,rising);
 expect(closed).toMatchObject({status:'closed',endTime:T+15*M,remainingQuantity:0,remainingFraction:0});
 expect(closed.additionFills?.map(f=>f.at)).toEqual(Array.from({length:14},(_,i)=>T+(i+1)*M));
});
it.each(['fixed','entry',undefined] as const)('does not block an otherwise eligible single addition after the first break (mode=%s)',async quantityMode=>{
 const g=addingPlan();g.addition={...g.addition!,quantityMode,quantity:1,amountMode:'fixed',amountUsdt:100,condition:{...addCondition,threshold:2}};
 const late=load(at=>({...bar(at,at===T?100:120),volume:at>=T+4*M?3:0,takerBuyQuoteVolume:at>=T+4*M?3:0,...(at===T?{high:106}:{})}));
 expect((await run(g,T+14*M,late)).additionFill?.at).toBe(T+5*M);
});
it('leaves independently enabled addition vetoes and the original first-break lock in force',async()=>{
 const g=addingPlan();
 g.addition={...g.addition!,entryVetoes:[{kind:'box-break',enabled:true,boxBreak:defaultBoxBreakVeto()}]};
 const vetoed=await run(g,T+14*M,rising);
 expect(vetoed.additionFills?.map(f=>f.at)).toEqual([1,2,3,4].map(n=>T+n*M));
 expect(vetoed.additionVetoes?.some(v=>v.kind==='box-break')).toBe(true);
 expect(vetoed.additionsBlockedAt).toBeUndefined();
 const both=addingPlan();both.holdingVetoes!.push(veto(defaultBoxSecondBreak(),'old'));
 const locked=await run(both,T+14*M,rising);
 expect(locked.additionsBlockedAt).toBe(T+5*M);
 expect(locked.additionFills?.map(f=>f.at)).toEqual([1,2,3,4].map(n=>T+n*M));
 expect(locked.boxStopStates).toMatchObject({exit:{firstCountedBreakAt:T+5*M},old:{firstBreakAt:T+5*M}});
});
it('retains an addition K exit and ordinary earlier exits',async()=>{
 const g=addingPlan(),l=load(at=>{const n=(at-T)/M;return n<6?{...bar(at,100+Math.max(0,n)*10),volume:n===0?1:0,takerBuyQuoteVolume:n===0?1:0,...(n===0?{high:106}:{})}:bar(at,120,100);});
 expect(await run(g,T+10*M,l)).toMatchObject({status:'closed',endTime:T+6*M,exitSnapshot:{cause:{kind:'addition-support'}}});
 const ordinary={...plan(),rule:{metric:'raw',direction:'>' as const,threshold:150},snapshot:{...plan().snapshot,definitionKey:features.definitionKey({...triggerDef,formula:'raw = C'}),interval:'1m'}};
 expect(await run(ordinary,T+14*M,rising)).toMatchObject({status:'closed',endTime:T+7*M});
});
it('keeps counts causal when sell stages cut a result before a later break',async()=>{
 const g=addingPlan();g.sellStages=[{afterAdditions:1,label:'后段',metric:'raw',snapshot:addCondition.snapshot,rule:{metric:'raw',direction:'<' as const,threshold:-1}}];
 const first=await run(g,T+3*M,rising);
 expect(first.boxStopStates?.exit.firstCountedBreakAt).toBeUndefined();
 const whole=await run(g,T+14*M,rising);
 expect(whole.additionsBlockedAt).toBeUndefined();
 expect(whole.boxStopStates?.exit.firstCountedBreakAt).toBe(T+5*M);
 expect(await run(g,T+14*M,rising,first)).toEqual(whole);
});
it('roundtrips a separately frozen template without changing old versions, identities, labels or stage slots',()=>{
 const legacy=freezeQualityPlan({...plan(),holdingVetoes:[veto(defaultBoxBreak(),'break'),veto(defaultBoxStop(),'stop'),veto(defaultBoxSecondBreak(),'old')]}),original=JSON.stringify(legacy);
 const canonical=parseHoldingVetoDraft([{choice:BOX_SECOND_EXIT_CHOICE,direction:'<=',threshold:'0',enabled:true,boxStop:defaultBoxSecondExit()}]);
 const next=freezeQualityPlan({...plan(),holdingVetoes:canonical}),study=saveQualityPlanTemplate(newQualityStudy(T),next,'独立二次断裂',T);
 const restored=qualityPlanFromTemplate(activeQualityPlanTemplates(study)[0],'副本');
 expect(planVersionChanges(restored)).toEqual([]);
 expect(qualityPlanVersions(restored).find(v=>v.key==='hard-stop-box-0')?.version).toContain(BOX_SECOND_EXIT_VERSION);
 const reordered=JSON.parse(JSON.stringify(restored,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));
 expect(planVersionChanges(reordered)).toEqual([]);
 const changed=structuredClone(restored);changed.holdingVetoes![0].boxStop!.structure.definition.DBL5_config!.guard_range_closes=3;
 expect(planVersionChanges(changed).map(v=>v.key)).toContain('hard-stop-box-0');
 expect(parseHoldingVetoDraft(holdingVetoDraft(restored.holdingVetoes))).toEqual(restored.holdingVetoes);
 expect(stagedHoldingVetoes({...legacy,vetoStages:[{afterAdditions:1,conditions:[veto()]}]},1)).toHaveLength(4);
 expect(JSON.stringify(legacy)).toBe(original);expect(planVersionChanges(legacy)).toEqual([]);
 expect(boxStopIdentity(defaultBoxSecondBreak())).not.toEqual(boxStopIdentity(defaultBoxSecondExit()));
 for(const [choice,rule] of [[BOX_SECOND_EXIT_CHOICE,defaultBoxSecondBreak()],[BOX_SECOND_BREAK_CHOICE,defaultBoxSecondExit()]] as const){
  expect(()=>parseHoldingVetoDraft([{choice,direction:'<=',threshold:'0',enabled:true,boxStop:rule}])).toThrow('执行版本不符');
 }
 expect(()=>validateBoxStop({...defaultBoxSecondExit(),confirmation:'touch'})).toThrow('原生红叉');
 expect(()=>validatePreEntryConditions({...emptyPreEntryConditions(),hardVetoes:[veto()]})).toThrow('不能用于买前筛选');
});
it('fails on invalid native data instead of clearing or inventing a break',async()=>{
 invalid=true;await expect(reader().read(bar(T+6*M))).rejects.toThrow('不能跳过缺口');
});
it('uses two actual independent renderer red crosses and retains the same native outputs as the original option',async()=>{
 vi.restoreAllMocks();
 const {computeDbl5,dbl5Numeric,DBL5_RETEST_GUARD_VERSION}=await import('@/lib/dbl5m');
 const rule=defaultBoxSecondExit([],DBL5_RETEST_GUARD_VERSION),step=5*M,from=T-Math.ceil(features.featureWindowMs(rule.structure.definition)/step)*step;
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
 expect(boxAdditionBlockedAt(r.states())).toBeUndefined();
 expect(await r.read(bar(expected[1].at-M,123))).toBeUndefined();
 expect(await r.read(bar(expected[1].at,87))).toMatchObject({fillPrice:87,cause:{boxBreakEvidence:{firstBreakAt:expected[0].at,confirmedAt:expected[1].at}}});
});
it('counts the selected hourly native events independently of the five-minute rule',async()=>{
 broken=at=>at===T+60*M||at===T+120*M;
 const r=reader(undefined,T,selectBoxStopTimeframe(defaultBoxSecondExit(),'1h'));
 expect(await r.read(bar(T+59*M))).toBeUndefined();
 expect(await r.read(bar(T+60*M))).toBeUndefined();
 expect(boxAdditionBlockedAt(r.states())).toBeUndefined();
 expect(await r.read(bar(T+119*M))).toBeUndefined();
 expect(await r.read(bar(T+120*M,55))).toMatchObject({fillPrice:55,cause:{boxBreakEvidence:{event:'darvas_1h_guard_broken',firstBreakAt:T+60*M,confirmedAt:T+120*M}}});
});
