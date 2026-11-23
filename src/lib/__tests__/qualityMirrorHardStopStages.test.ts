import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import * as features from '@/lib/deepDig/features';
import {evaluateQualitySample,type QualitySample,type QualityGroup,qualityResultKey} from '@/lib/fish/quality';
import {replayParallelCandidate} from '@/lib/fish/parallelUniverse';
import {defaultBoxBreak,defaultBoxStop,defaultBoxSecondExit,defaultBoxSecondBreak} from '@/lib/fish/qualityBoxStop';
import {mirrorHardStopStage as stage,MIRROR_HARD_STOP_STAGES_VERSION as V} from '@/lib/fish/qualityMirrorHardStopStages';
import {holdingVetoDraft,parseHoldingVetoDraft,makeQualityHoldingVeto} from '@/lib/fish/qualityFilters';
import {freezeQualityPlan,planVersionChanges,qualityPlanVersions} from '@/lib/fish/qualityPlanVersions';
import {holdingVetoIdentity,validateHoldingVeto,type QualityHoldingVeto} from '@/lib/fish/qualityVeto';
import {emptyPreEntryConditions,validatePreEntryConditions} from '@/lib/fish/preEntryConditions';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
import type {ResearchBar} from '@/lib/deepRsa/window';
const M=60000,T=Date.UTC(2026,10,19),signal=new AbortController().signal;
const row={id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const sample:QualitySample={id:'s',enteredAt:T,basis:'signal',importedAt:T,groups:[],source:row};
const bar=(at:number,open=100,high=open,low=open,close=open):ResearchBar=>({openTime:at,open,high,low,close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50});
const def={id:'cda',name:'CDA 示例',short:'CDA',definition:'',formula:'CDA = C - 120',interval:'1m' as const,scale:1,unit:'',positive:'1',control:'0'};
const box=(scope:'before'|'after',rule=scope==='before'?defaultBoxBreak():defaultBoxSecondExit()):QualityHoldingVeto=>({id:scope,label:'防守线',enabled:true,kind:'box-stop',direction:'<=',threshold:0,boxStop:rule,mirrorStage:stage(scope)});
const risk=(scope:'before'|'after',threshold=5):QualityHoldingVeto=>({id:'risk-'+scope,label:'静态回撤',kind:'static-drawdown',enabled:true,direction:'>=',threshold,mirrorStage:stage(scope)});
const cda=(scope:'before'|'after',threshold=-15):QualityHoldingVeto=>{const v=makeQualityHoldingVeto('cda:CDA','<',threshold,true,[def]);return {...v,id:'cda-'+scope,snapshot:{...v.snapshot!,definitionKey:features.definitionKey(def),interval:'1m'},mirrorStage:stage(scope)};};
const group=(conditions:QualityHoldingVeto[]=[box('before'),box('after')]):QualityGroup=>({id:'g',label:'两阶段',metric:'结果',snapshot:{featureId:'price',definitionKey:features.definitionKey({...def,formula:'C'}),interval:'1m',statistic:'结果',scale:1,threshold:0,direction:'<',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T},vetoFill:'stop',holdingVetoes:conditions,mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50}});
const loader=(minute:(t:number)=>ResearchBar):FishReconstructionLoader=>async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?minute(a+i*M):bar(a+i*p.step,100,101,99));
const path=(mirrorMinute=3)=>loader(t=>t===T+mirrorMinute*M?bar(t,100,106,99,104):bar(t));
const run=async(g=group(),minutes=20,l=path(),prior?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>{const r=await evaluateQualitySample(sample,g,0,T+minutes*M,l,signal,prior);expect(r.status,r.reason).not.toBe('error');return r;};
const actual=features.evaluateOnBars;
beforeEach(()=>{vi.spyOn(features,'evaluateOnBars').mockImplementation((bars,compiled,params,cache)=>compiled.usesDbl5?({vars:new Map(),DBL5_details:bars.map(b=>({at:b.openTime+5*M,data_valid:true,darvas_5m_guard:95,darvas_5m_available:true,darvas_5m_guard_broken:[T+5*M,T+15*M,T+25*M].includes(b.openTime+5*M),active:{D:96}}))} as unknown as ReturnType<typeof actual>):actual(bars,compiled,params,cache));});
afterEach(()=>vi.restoreAllMocks());
it('镜像前保持第一次断裂即退出，尚未发生减仓就由前段保护',async()=>{
 const r=await run(group(),20,path(9));expect(r).toMatchObject({status:'closed',endTime:T+5*M,exitSnapshot:{cause:{id:'before',mirrorStage:{version:V,stage:'before'}}}});expect(r.mirrorFill).toBeUndefined();
});
it('平行推演把镜像前箱体断裂记为标记，镜像后保护仍按原逻辑退出',async()=>{
 const plan=group([box('before'),risk('after')]);
 const load=loader(t=>t===T+9*M?bar(t,100,106,99,104):t===T+10*M?bar(t,100,100,90,100):bar(t));
 const result=await replayParallelCandidate(row.symbol,2,
  continuation=>evaluateQualitySample(sample,plan,0,T+20*M,load,signal,undefined,undefined,undefined,continuation));
 expect(result.marker).toMatchObject({observedAt:T+5*M,cause:{id:'before'}});
 expect(result.simulation).toMatchObject({status:'closed',endTime:T+10*M,mirrorFill:{at:T+9*M},exitSnapshot:{cause:{id:'risk-after'}}});
 expect(result.proposedSignal).toBeUndefined();
});
it('减仓后停用前段一次退出，后段首次只观察、第二次全仓退出',async()=>{
 const g=group(),l=path(),first=await run(g,12,l);
 expect(first).toMatchObject({status:'open',mirrorFill:{at:T+3*M},boxStopStates:{after:{breakCount:1,firstCountedBreakAt:T+5*M}}});expect(first.additionsBlockedAt).toBeUndefined();
 const whole=await run(g,20,l);expect(whole).toMatchObject({status:'closed',endTime:T+15*M,exitSnapshot:{cause:{id:'after',mirrorStage:{stage:'after'},boxBreakEvidence:{breakCount:2,firstBreakAt:T+5*M}}}});
 expect(await run(g,20,l,JSON.parse(JSON.stringify(first)))).toEqual(whole);
 expect(await run(g,20,l,await run(g,2,l))).toEqual(whole);
});
it('镜像前留空跳过时仍可运行后段，减仓前的断裂不计入后段',async()=>{
 const g=group([box('after')]),l=path(9),first=await run(g,20,l);
 expect(first).toMatchObject({status:'open',mirrorFill:{at:T+9*M},boxStopStates:{after:{breakCount:1,firstCountedBreakAt:T+15*M}}});
 const full=await run(g,30,l);expect(full).toMatchObject({status:'closed',endTime:T+25*M,exitSnapshot:{cause:{id:'after',boxBreakEvidence:{breakCount:2,firstBreakAt:T+15*M}}}});
 expect(await run(g,30,l,JSON.parse(JSON.stringify(first)))).toEqual(full);
});
it('镜像不启用或不成交时始终使用前段，不放行后段',async()=>{
 const g=group();g.mirrorTakeProfit!.enabled=false;
 expect(await run(g)).toMatchObject({status:'closed',endTime:T+5*M,exitSnapshot:{cause:{id:'before'}}});
 expect(await run(group(),20,path(100))).toMatchObject({status:'closed',endTime:T+5*M,exitSnapshot:{cause:{id:'before'}}});
});
it('CDA 前后参数独立：前段在成交后关闭，后段从首个有效读数启动',async()=>{
 expect(await run(group([cda('before'),cda('after')]))).toMatchObject({status:'closed',endTime:T,exitSnapshot:{cause:{id:'cda-before'}}});
 expect(await run(group([cda('before',-50),cda('after')]))).toMatchObject({status:'closed',endTime:T+4*M,exitSnapshot:{cause:{id:'cda-after',mirrorStageBoundary:T+4*M}}});
});
it('后段价格止损不回放前段已经结束的低点，但新触价仍立即止损',async()=>{
 const l=loader(t=>t===T?bar(t,100,100,90,100):t===T+3*M?bar(t,100,106,99,104):bar(t));
 const g=group([box('before'),risk('after')]);expect(await run(g,12,l)).toMatchObject({status:'open'});
 const late=loader(t=>t===T+3*M?bar(t,100,106,99,104):t===T+4*M?bar(t,100,100,90,100):bar(t));
 expect(await run(g,12,late)).toMatchObject({status:'closed',endTime:T+4*M,endPrice:95,exitSnapshot:{cause:{mirrorStage:{stage:'after'}}}});
});
it('开盘减仓明确成交时，前段盘中止损停止，按后段自己的阈值退出',async()=>{
 const l=loader(t=>t===T+3*M?bar(t,108,110,89,100):bar(t));
 expect(await run(group([risk('before',5),risk('after',10)]),12,l)).toMatchObject({status:'closed',endTime:T+3*M,endPrice:90,mirrorFill:{atOpen:true,price:108},exitSnapshot:{cause:{id:'risk-after'}}});
});
it('开盘减仓取消前段未发生的 K 触价；盘中高低先后不明时前段保护优先',async()=>{
 const r=defaultBoxStop();r.structure.kSource='guard';
 const g=group([box('before',r)]),opening=loader(t=>t===T+3*M?bar(t,108,110,90,100):bar(t));
 expect(await run(g,12,opening)).toMatchObject({status:'open',mirrorFill:{atOpen:true}});
 const ambiguous=loader(t=>t===T+3*M?bar(t,100,106,90,100):bar(t));
 const stopped=await run(g,12,ambiguous);expect(stopped).toMatchObject({status:'closed',endTime:T+3*M,endPrice:95});expect(stopped.mirrorFill).toBeUndefined();
});
it('镜像已盘中成交后，不用该分钟的收盘再触发前段收盘保护',async()=>{
 const r=defaultBoxStop();r.structure.kSource='guard';r.confirmation='close-1m';r.closes=1;
 const l=loader(t=>t===T+3*M?bar(t,100,106,90,94):bar(t));
 expect(await run(group([box('before',r),box('after')]),12,l)).toMatchObject({status:'open',boxStopStates:{before:{count:0},after:{breakCount:1}}});
});
it('后段滚动跌幅从本阶段起算，不包含镜像前跌幅',async()=>{
 const drop:QualityHoldingVeto={id:'drop',kind:'drop-5m',label:'5分钟跌幅',enabled:true,direction:'>=',threshold:5,mirrorStage:stage('after')};
 const l=loader(t=>t===T?bar(t,100,100,90,90):t===T+3*M?bar(t,100,106,99,104):bar(t));
 expect(await run(group([drop]),12,l)).toMatchObject({status:'open'});
});
it('旧全程条件保持全程；新阶段的身份、参数、版本与模板分别冻结',async()=>{
 const old=box('before');delete old.mirrorStage;const legacy=freezeQualityPlan(group([old])),before=JSON.stringify(legacy);
 expect(await run(legacy)).toMatchObject({status:'closed',endTime:T+5*M});
 const staged=freezeQualityPlan(group()),restored=parseHoldingVetoDraft(holdingVetoDraft(staged.holdingVetoes),features.BUILTIN_FEATURES);
 expect(restored.map(v=>v.mirrorStage?.stage)).toEqual(['before','after']);expect(new Set(restored.map(v=>v.id)).size).toBe(2);
 expect(qualityPlanVersions(staged).find(v=>v.key==='hard-stop-mirror-stages')?.version).toContain(V);
 expect(qualityResultKey(sample,legacy,0)).not.toBe(qualityResultKey(sample,staged,0));expect(holdingVetoIdentity([old])).not.toEqual(holdingVetoIdentity([box('before')]));
 const reordered=JSON.parse(JSON.stringify(staged,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));expect(planVersionChanges(reordered)).toEqual([]);
 expect(JSON.stringify(legacy)).toBe(before);
});
it('错误版本、重复门槛和买前套用拒绝运行，跨持仓加仓锁不伪装为前段',()=>{
 expect(()=>validateHoldingVeto({...box('after'),mirrorStage:{version:'future' as typeof V,stage:'after'}})).toThrow();
 expect(()=>validateHoldingVeto({...box('after'),activation:'holding-post-mirror-protection-v1'})).toThrow();
 expect(()=>validateHoldingVeto(box('before',defaultBoxSecondBreak()))).toThrow();
 expect(()=>validatePreEntryConditions({...emptyPreEntryConditions(),hardVetoes:[box('before')]})).toThrow();
});
