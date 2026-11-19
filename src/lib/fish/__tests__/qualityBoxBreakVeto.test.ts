import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import * as features from '@/lib/deepDig/features';
import {intervalMs} from '@/lib/deepRsa/marketData';
import {BOX_BREAK_VETO_VERSION,defaultBoxBreakVeto,validateAdditionVetoes,additionVetoIdentity,type QualityAdditionEntryVeto} from '../qualityAdditionVeto';
import {selectBoxStopTimeframe,defaultBoxSecondBreak} from '../qualityBoxStop';
import {createBoxBreakVetoReader} from '../qualityBoxBreakVeto';
import {createVetoHistoryReader} from '../qualityVetoHistory';
import {vetoDraftOf,parseAdditionVetoDraft} from '../qualityEntryVetoDraft';
import {evaluateQualitySample,newQualityStudy,type QualityGroup,type QualitySample} from '../quality';
import {defaultQualityAddition} from '../qualityAddition';
import {findCalculatorAdditions} from '../qualityAdditionCalculator';
import {compileFishProgram} from '../algorithm';
import {createPreEntryGate} from '../preEntryGate';
import {emptyPreEntryConditions,preEntryConditionsVersion} from '../preEntryConditions';
import {freezeQualityPlan,planVersionChanges} from '../qualityPlanVersions';
import {saveQualityPlanTemplate,qualityPlanFromTemplate} from '../qualityPlanTemplates';
import type {ResearchBar} from '@/lib/deepRsa/window';
import type {FishReconstructionLoader} from '../reconstruction';
const M=60000,T=Date.UTC(2026,10,19),signal=new AbortController().signal;
const row={id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const sample:QualitySample={id:'s',enteredAt:T,basis:'signal',importedAt:T,groups:[],source:row};
const bar=(at:number,open=100):ResearchBar=>({openTime:at,open,high:open+1,low:open-1,close:open,volume:1,quoteVolume:100,takerBuyVolume:0,takerBuyQuoteVolume:1});
const def={id:'add',name:'加仓',short:'加仓',definition:'',formula:'raw = B',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
const snapshot={featureId:'add',definitionKey:features.definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:.5,direction:'>' as const,average:1,cbi2:1,startAverage:1,previousAverage:0,cutoffMs:T};
const condition={id:'add',label:'加仓',metric:'raw',direction:'>' as const,threshold:.5,enabled:true,snapshot};
const rule=():QualityAdditionEntryVeto=>({kind:'box-break',enabled:true,boxBreak:defaultBoxBreakVeto()});
const actual=features.evaluateOnBars;
let broken:(at:number)=>boolean,invalid=false;
beforeEach(()=>{
 broken=at=>at===T+5*M||at===T+15*M;invalid=false;
 vi.spyOn(features,'evaluateOnBars').mockImplementation((bars,compiled,params)=>{
  if(!compiled.usesDbl5)return actual(bars,compiled,params);
  const step=intervalMs(features.intervalOf(params));
  return {vars:new Map(),DBL5_details:bars.map(b=>({at:b.openTime+step,data_valid:!invalid,darvas_5m_available:false,darvas_5m_guard:null,darvas_5m_guard_broken:broken(b.openTime+step)}))} as unknown as ReturnType<typeof actual>;
 });
});
afterEach(()=>vi.restoreAllMocks());
const load=(minute:(at:number)=>ResearchBar=bar):FishReconstructionLoader=>async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?minute(a+i*M):bar(a+i*p.step));
const rising=load(at=>({...bar(at,100+Math.max(0,(at-T)/M)*10),...(at===T?{high:106}:{})}));
const group=():QualityGroup=>({id:'g',label:'加仓否决',metric:'raw',snapshot,rule:{metric:'raw',direction:'<',threshold:-1},execution:'intrabar-1m',mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50},addition:{...defaultQualityAddition(),enabled:true,source:'custom',condition,entryVetoes:[rule()]}});
const run=async(g=group(),l=rising,n=20,prior?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>{
 const r=await evaluateQualitySample(sample,g,0,T+n*M,l,signal,prior);
 expect(r.status,r.reason).not.toBe('error');return r;
};
it('latches only post-entry native closes, ignores warmup and wicks, and supports causal out-of-order lane queries',async()=>{
 const post=broken;broken=at=>at<=T||post(at);
 const read=createBoxBreakVetoReader(rule(),{entry:T,row,load:load(),signal});
 expect(await read(T)).toEqual({});expect(await read(T+4*M)).toEqual({});
 expect(await read(T+5*M)).toMatchObject({hit:{kind:'box-break',reading:expect.stringContaining('首次断裂')}});
 expect(await read(T+30*M)).toMatchObject({hit:{kind:'box-break'}});
 expect(await read(T+4*M)).toEqual({});
 const resumed=createBoxBreakVetoReader(rule(),{entry:T,row,load:load(),signal});
 expect(await resumed(T+30*M)).toEqual(await read(T+30*M));
});
it('blocks all later calculator additions without selling on either the first or second break, including resume',async()=>{
 const whole=await run();
 expect(whole.status).toBe('open');expect(whole.additionFills?.map(f=>f.at)).toEqual([1,2,3,4].map(n=>T+n*M));
 expect(whole.additionVetoes).toEqual(expect.arrayContaining([expect.objectContaining({kind:'box-break',at:T+5*M})]));
 expect(whole.additionsBlockedAt).toBeUndefined();
 const prior=await run(group(),rising,8),resumed=await run(group(),rising,20,JSON.parse(JSON.stringify(prior)));
 expect(resumed).toMatchObject({status:whole.status,pnl:whole.pnl,additionFills:whole.additionFills,endTime:whole.endTime});
});
it.each(['primary','attack'] as const)('actually vetoes the %s lane independently after saving and restoring a frozen template',async lane=>{
 const g=group(),round={source:'custom' as const,stricterPct:0,condition,entryVetoes:[rule()]};
 g.addition={...g.addition!,maxRounds:1,rounds:[lane==='primary'?round:{...round,condition:{...condition,threshold:10000},entryVetoes:[]}],alternativeRounds:lane==='attack'?[round]:undefined};
 const late=load(at=>({...bar(at,at<=T?100:150),takerBuyQuoteVolume:at>=T+4*M?1:0,...(at===T?{high:106}:{})}));
 const frozen=freezeQualityPlan(g),saved=saveQualityPlanTemplate(newQualityStudy(T),frozen,'原资产',T),original=JSON.stringify(saved.planTemplates);
 const copy=qualityPlanFromTemplate(saved.planTemplates![0],'副本');
 expect(planVersionChanges(copy)).toEqual([]);
 const result=await run(copy,late);
 expect(result.additionFills).toBeUndefined();expect(result.additionVetoes?.some(v=>v.kind==='box-break')).toBe(true);expect(result.status).toBe('open');
 expect(JSON.stringify(saved.planTemplates)).toBe(original);
 const off=structuredClone(g);off.addition!.rounds!.forEach(r=>r.entryVetoes=[]);off.addition!.alternativeRounds?.forEach(r=>r.entryVetoes=[]);
 expect((await run(off,late)).additionFill?.at).toBe(T+5*M);
});
it.each([false,true])('lets an eligible other lane win the SAME minute when this new veto blocks one lane (blockAttack=%s)',async blockAttack=>{
 const g=group(),round={source:'custom' as const,stricterPct:0,condition,entryVetoes:[] as QualityAdditionEntryVeto[]};
 g.addition={...g.addition!,maxRounds:1,rounds:[{...round,entryVetoes:blockAttack?[]:[rule()]}],alternativeRounds:[{...round,entryVetoes:blockAttack?[rule()]:[]}]};
 const late=load(at=>({...bar(at,at<=T?100:150),takerBuyQuoteVolume:at>=T+4*M?1:0,...(at===T?{high:106}:{})}));
 const r=await run(g,late);
 expect(r.additionFills).toMatchObject([{at:T+5*M,lane:blockAttack?'structure':'attack'}]);
});
it.each(['fixed','entry',undefined] as const)('also blocks single-addition sizing mode %s',async quantityMode=>{
 const g=group();g.addition={...g.addition!,quantityMode,quantity:1,amountMode:'fixed',amountUsdt:100};
 const late=load(at=>({...bar(at,at<=T?100:150),takerBuyQuoteVolume:at>=T+4*M?1:0,...(at===T?{high:106}:{})}));
 expect((await run(g,late)).additionFill).toBeUndefined();
 g.addition.entryVetoes=[];expect((await run(g,late)).additionFill?.at).toBe(T+5*M);
});
it('truncates a later rejected lane when an earlier alternative establishes the stage checkpoint',async()=>{
 const priceDef={...def,formula:'raw = C'},plan=compileFishProgram(priceDef,{statistic:'raw',direction:'>',threshold:0,constraints:[]});
 const candidate=(threshold:number)=>({plan,scale:1,threshold,direction:'>' as const,metric:'raw',label:'price'});
 const prices=Array.from({length:14},(_,i)=>({...bar(T+i*M,100+i*10),...(i===0?{high:106}:{})}));
 const result=await findCalculatorAdditions({candidates:[],roundRules:[{candidates:[candidate(185)],entryVetoes:[rule()],alternative:{candidates:[candidate(115)]}}],
  row,entry:T,entryPrice:100,notional:100,since:T,end:T+14*M,prices,previous:[],mirror:{at:T,price:105,fraction:.5,gainPct:5,atOpen:false},
  repeat:true,maxRounds:1,pauseAfterAdditionCount:1,load:rising,signal});
 expect(result.stageBoundary?.at).toBe(T+3*M);
 expect(result.fills).toMatchObject([{at:T+3*M,lane:'attack'}]);
 expect(result.vetoed).toBeUndefined();
});
it('uses the shared screening gate, keeps its lock across retries and reconstructs it on resume',async()=>{
 const conditions={...emptyPreEntryConditions(),entryVetoes:[rule()]};
 const gate=createPreEntryGate({conditions,start:T,row,load:load(),signal});
 expect((await gate(T+4*M)).blocked).toBeUndefined();
 expect((await gate(T+5*M)).blocked).toContain('箱体断裂');
 gate.restart(T+5*M);
 expect((await gate(T+6*M)).blocked).toContain('箱体断裂');
 const resume=createPreEntryGate({conditions,start:T,row,load:load(),signal});
 expect((await resume(T+30*M)).blocked).toContain('箱体断裂');
});
it('uses the existing verified box-market repair loader when it is provided',async()=>{
 const ordinary=vi.fn(async()=>{throw Error('must use repaired native prices');});
 const repaired=vi.fn(load());
 const wrapped=Object.assign(ordinary,{boxStopMarketLoad:repaired}) as FishReconstructionLoader;
 expect((await createBoxBreakVetoReader(rule(),{entry:T,row,load:wrapped,signal})(T+5*M)).hit?.kind).toBe('box-break');
 expect(ordinary).not.toHaveBeenCalled();expect(repaired).toHaveBeenCalled();
});
it('fails closed on native data gaps or invalid data, without inventing a break',async()=>{
 const gap:FishReconstructionLoader=async(_r,a,b,p)=>(await load()(_r,a,b,p,signal)).slice(1);
 const read=createVetoHistoryReader({rules:[rule()],entry:T,row,load:gap,signal});
 expect(await read(T+5*M)).toMatchObject({pendingKind:'box-break',pending:expect.stringContaining('暂不放行')});
 invalid=true;await expect(createBoxBreakVetoReader(rule(),{entry:T,row,load:load(),signal})(T+5*M)).rejects.toThrow('不能跳过缺口');
 const r=await evaluateQualitySample(sample,group(),0,T+10*M,rising,signal);
 expect(r.status).toBe('error');expect(r.additionFill).toBeUndefined();
});
it('freezes independent parameters, versions and fingerprints while leaving all original assets unchanged',()=>{
 const old=freezeQualityPlan({...group(),addition:{...group().addition!,entryVetoes:[]}}),original=JSON.stringify(old);
 const fresh=freezeQualityPlan(group()),jsonb=JSON.parse(JSON.stringify(fresh,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));
 expect(planVersionChanges(jsonb)).toEqual([]);
 expect(fresh.frozenVersions?.find(v=>v.key==='shared-box-break')?.version).toContain(BOX_BREAK_VETO_VERSION);
 const rules=parseAdditionVetoDraft(vetoDraftOf([rule()]));expect(rules).toEqual([rule()]);
 const changed=structuredClone(fresh);changed.addition!.entryVetoes![0].boxBreak!.rule.structure.definition.DBL5_config!.guard_range_closes=3;
 expect(planVersionChanges(changed).some(v=>v.key==='shared-box-break')).toBe(true);
 expect(JSON.stringify(old)).toBe(original);
 expect(additionVetoIdentity([{...rule(),enabled:false}])).toEqual([]);
 expect(()=>validateAdditionVetoes([{...rule(),historyHours:6}])).toThrow('扫描范围');
 expect(()=>validateAdditionVetoes([{...rule(),boxBreak:{...defaultBoxBreakVeto(),rule:defaultBoxSecondBreak()}}])).toThrow('冻结执行版本');
 expect(()=>parseAdditionVetoDraft(vetoDraftOf([{kind:'box-break',enabled:true}]))).toThrow('冻结执行版本');
});
it('matches the unchanged native renderer event and never emits a sell action',async()=>{
 vi.restoreAllMocks();
 const {computeDbl5,dbl5Numeric}=await import('@/lib/dbl5m');
 const v=rule(),native=v.boxBreak!.rule,step=5*M,from=T-Math.ceil(features.featureWindowMs(native.structure.definition)/step)*step;
 let seed=7,price=10000;
 const random=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
 const bars=Array.from({length:1600},(_,i)=>{
  const phase=i%700,drift=phase<200?0:phase<500?6:(11800-price)*.02,open=price,close=Math.max(100,Math.round(open+drift+(random()-.5)*60));
  const wick=phase>=500&&random()<.08?120:20,high=Math.max(open,close)+Math.round(random()*20),low=Math.max(1,Math.min(open,close)-Math.round(random()*wick));price=close;
  return {...bar(from+i*step,open),close,low,high,DBL5_tick_size:1,DBL5_closed:true};
 });
 const expected=computeDbl5(bars,{symbol:row.symbol,tickSize:1,config:native.structure.definition.DBL5_config,initializationStart:from}).rows.filter(r=>r.at>T&&dbl5Numeric(r,'_DBL5_guard_broken')===1);
 expect(expected.length).toBeGreaterThanOrEqual(2);
 const nativeLoad:FishReconstructionLoader=async(_row,a,b)=>bars.filter(x=>x.openTime>=a&&x.openTime<b);
 const read=createBoxBreakVetoReader(v,{entry:T,row,load:nativeLoad,signal});
 expect(await read(expected[0].at-M)).toEqual({});
 expect(await read(expected[0].at)).toMatchObject({hit:{kind:'box-break'}});
 expect(await read(expected[1].at)).toEqual(await read(expected[0].at));
});
it('restores the new screening veto after JSONB reorders template object fields',()=>{
 const saved=freezeQualityPlan({...group(),addition:undefined,preEntryConditions:{...emptyPreEntryConditions(),entryVetoes:[rule()]}});
 const jsonb=JSON.parse(JSON.stringify(saved,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));
 expect(planVersionChanges(jsonb)).toEqual([]);
 const legacy=structuredClone(saved),entryVersion=legacy.frozenVersions!.find(v=>v.key==='pre-entry-conditions')!;
 entryVersion.version=preEntryConditionsVersion(legacy,true);
 const before=JSON.stringify(legacy);
 expect(planVersionChanges(legacy)).toEqual([]);expect(JSON.stringify(legacy)).toBe(before);
 const edited=structuredClone(jsonb);edited.preEntryConditions.entryVetoes[0].boxBreak.rule.structure.definition.DBL5_config.guard_range_closes=3;
 expect(planVersionChanges(edited).some(v=>v.key==='pre-entry-conditions')).toBe(true);
});
it('keeps hourly native breaks separate from five-minute events',async()=>{
 const hourly=rule();hourly.boxBreak!.rule=selectBoxStopTimeframe(hourly.boxBreak!.rule,'1h');
 broken=at=>at===T+5*M||at===T+60*M;
 const read=createBoxBreakVetoReader(hourly,{entry:T,row,load:load(),signal});
 expect(await read(T+59*M)).toEqual({});expect((await read(T+60*M)).hit?.kind).toBe('box-break');
});
