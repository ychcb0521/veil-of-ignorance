import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import * as features from '@/lib/deepDig/features';
import {evaluateQualitySample,newQualityStudy,qualityResultKey,type QualityGroup,type QualitySample} from '@/lib/fish/quality';
import {createBoxStopReader,defaultBoxBreak,defaultBoxSecondBreak,defaultBoxSecondExit,defaultBoxStop} from '@/lib/fish/qualityBoxStop';
import {defaultQualityAddition} from '@/lib/fish/qualityAddition';
import {POST_MIRROR_PROTECTION_VERSION as V,postMirrorProtectionAt} from '@/lib/fish/qualityPostMirrorProtection';
import {holdingVetoDraft,parseHoldingVetoDraft,makeQualityHoldingVeto,makeQualityBuyFilter} from '@/lib/fish/qualityFilters';
import {defaultStructureAddition} from '@/lib/fish/qualityAdditionStructure';
import {holdingVetoIdentity,validateHoldingVeto,type QualityHoldingVeto} from '@/lib/fish/qualityVeto';
import {freezeQualityPlan,qualityPlanVersions,planVersionChanges} from '@/lib/fish/qualityPlanVersions';
import {saveQualityPlanTemplate,qualityPlanFromTemplate} from '@/lib/fish/qualityPlanTemplates';
import {emptyPreEntryConditions,validatePreEntryConditions} from '@/lib/fish/preEntryConditions';
import {stagedHoldingVetoes} from '@/lib/fish/qualityVetoStages';
import {prepareQualityRouterDraft} from '@/lib/fish/qualityRouterDraft';
import {QUALITY_ROUTER_VERSION,type QualityPlanRouter} from '@/lib/fish/qualityPlanRouter';
import {computeDbl5} from '@/lib/dbl5m';
import {sample as nativeFixture,T as NATIVE_T} from './fixtures/dblBars';
import type {ResearchBar} from '@/lib/deepRsa/window';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';

const M=60000,T=Date.UTC(2026,9,20),signal=new AbortController().signal;
const row={id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const sample:QualitySample={id:'s',enteredAt:T,basis:'signal',importedAt:T,groups:[],source:row};
const bar=(at:number,open=100,high=open,low=open,close=open):ResearchBar=>({openTime:at,open,high,low,close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50});
const def={id:'cda',name:'CDA 示例读数',short:'CDA',definition:'',formula:'CDA = C - 120',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
const cda=(gated=true):QualityHoldingVeto=>({...makeQualityHoldingVeto('cda:CDA','<',-15,true,[def]),snapshot:{...makeQualityHoldingVeto('cda:CDA','<',-15,true,[def]).snapshot!,definitionKey:features.definitionKey(def),interval:'1m'},...(gated?{activation:V}:{})});
const box=(rule=defaultBoxBreak(),gated=true):QualityHoldingVeto=>({id:gated?'gated-box':'old-box',label:'防守线',enabled:true,kind:'box-stop',direction:'<=',threshold:0,boxStop:rule,...(gated?{activation:V}:{})});
const guard=()=>{const r=defaultBoxStop();return {...r,structure:{...r.structure,kSource:'guard' as const},update:'follow' as const};};
const plan=(vetoes:QualityHoldingVeto[]=[cda()]):QualityGroup=>({id:'g',label:'示例',metric:'结果',snapshot:{featureId:'price',definitionKey:features.definitionKey({...def,formula:'C'}),interval:'1m',statistic:'结果',scale:1,threshold:0,direction:'<',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T},vetoFill:'stop',holdingVetoes:vetoes,mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50}});
const load=(minute:(at:number)=>ResearchBar=bar):FishReconstructionLoader=>async(_row,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?minute(a+i*M):bar(a+i*p.step));
const path=load(at=>at===T+3*M?bar(at,100,106,99,104):bar(at));
const run=async(g=plan(),minutes=8,l=path,previous?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>{
 const r=await evaluateQualitySample(sample,g,0,T+minutes*M,l,signal,previous);expect(r.status,r.reason).not.toBe('error');return r;
};
const actual=features.evaluateOnBars;
let broken:(at:number)=>boolean,line:number;
beforeEach(()=>{
 broken=at=>at===T+5*M||at===T+15*M||at===T+25*M;line=95;
 vi.spyOn(features,'evaluateOnBars').mockImplementation((bars,compiled,params,cache)=>{
  if(!compiled.usesDbl5)return actual(bars,compiled,params,cache);
  return {vars:new Map(),DBL5_details:bars.map(b=>({at:b.openTime+5*M,data_valid:true,darvas_5m_guard:line,darvas_5m_available:true,darvas_5m_guard_broken:broken(b.openTime+5*M),active:{D:line+1}}))} as unknown as ReturnType<typeof actual>;
 });
});
afterEach(()=>vi.restoreAllMocks());

it('CDA 原约束仍在减仓前终止，新约束只在减仓成交后确认',async()=>{
 const old=await run(plan([cda(false)])),gated=await run();
 expect(old).toMatchObject({status:'closed',endTime:T});expect(old.mirrorFill).toBeUndefined();
 expect(gated).toMatchObject({status:'closed',endTime:T+4*M,mirrorFill:{at:T+3*M,atOpen:false},exitSnapshot:{cause:{activation:V,activationAt:T+4*M,kind:'indicator',threshold:-15}}});
 expect(gated.exitSnapshot?.previous).toBeUndefined();
});
it.each([false,true])('未启用镜像或未成交时不启动，也不提前请求 CDA 预热（镜像启用=%s）',async enabled=>{
 const g=plan();g.mirrorTakeProfit!.enabled=enabled;
 const l=vi.fn(load()),r=await run(g,8,l);
 expect(r.status).toBe('open');expect(r.mirrorFill).toBeUndefined();
 expect(l.mock.calls.some(c=>c[3].def.id==='cda')).toBe(false);
});
it('启动前的 CDA 达标不锁存，启动后的当前读数不达标就继续持仓',async()=>{
 const l=load(at=>at>=T+3*M?bar(at,at===T+3*M?100:110,110,100,110):bar(at));
 const r=await run(plan(),8,l);expect(r.status).toBe('open');expect(r.mirrorFill?.at).toBe(T+3*M);
});
it.each([2,4])('CDA 在减仓前后暂停并经 JSON 恢复，与连续运行一致（暂停=%s分钟）',async minutes=>{
 const g=plan(),part=await run(g,minutes);expect(await run(g,8,path,JSON.parse(JSON.stringify(part)))).toEqual(await run(g));
});
it('5m CDA 在启动的首根形成中 K 线上因果复原，不丢失本周期前几分钟',async()=>{
 const v=cda();v.snapshot={...v.snapshot!,definitionKey:features.definitionKey({...def,interval:'5m'}),interval:'5m'};
 expect(await run(plan([v]))).toMatchObject({status:'closed',endTime:T+4*M,exitSnapshot:{cause:{activation:V}}});
});
it('DBL-5 只忽略启动前红叉，原红叉选项不变，启动后按原生确认开盘退出',async()=>{
 const l=load(at=>at===T+9*M?bar(at,100,106,99,104):bar(at));
 expect(await run(plan([box(defaultBoxBreak(),false)]),18,l)).toMatchObject({status:'closed',endTime:T+5*M});
 const g=plan([box()]),whole=await run(g,18,l);
 expect(whole).toMatchObject({status:'closed',endTime:T+15*M,exitSnapshot:{cause:{activation:V,activationAt:T+10*M,boxBreakEvidence:{confirmedAt:T+15*M}}}});
 expect(await run(g,18,l,JSON.parse(JSON.stringify(await run(g,12,l))))).toEqual(whole);
});
it('盘中减仓不借用同根最低价提前触发防守线 K，下一分钟才保护',async()=>{
 const l=load(at=>at===T+3*M?bar(at,100,106,90,104):at===T+4*M?bar(at,94):bar(at));
 const g=plan([box(guard())]),r=await run(g,8,l);
 expect(r).toMatchObject({status:'closed',endTime:T+4*M,endPrice:94,mirrorFill:{at:T+3*M},exitSnapshot:{cause:{activationAt:T+4*M,boxStopEvidence:{line:95}}}});
 expect(await run(plan([box(guard(),false)]),8,l)).toMatchObject({status:'closed',endTime:T+3*M,endPrice:95});
});
it('镜像在开盘成交后，当分钟后续触及 K 能卖出余仓；100%镜像不会重复卖出',async()=>{
 const l=load(at=>at===T+3*M?bar(at,108,110,90,100):bar(at));
 expect(await run(plan([box(guard())]),8,l)).toMatchObject({status:'closed',endTime:T+3*M,endPrice:95,mirrorFill:{price:108,atOpen:true},exitSnapshot:{cause:{activationAt:T+3*M}}});
 const g=plan([box(guard())]);g.mirrorTakeProfit!.sellPct=100;
 expect(await run(g,8,l)).toMatchObject({status:'closed',endPrice:108,exitSnapshot:{cause:{kind:'mirror-take-profit'}}});
});
it('启动前收盘不累计，新 K 条件从启动后独立累计确认根数',async()=>{
 line=110;const r={...guard(),update:'fixed' as const,confirmation:'close-1m' as const,closes:2};
 const l=load(at=>at===T+3*M?bar(at,100,106,99,100):bar(at));
 expect(await run(plan([box(r)]),8,l)).toMatchObject({status:'closed',endTime:T+6*M,mirrorFill:{at:T+3*M}});
});
it.each([['首次停加仓',defaultBoxSecondBreak,true],['首次只计数',defaultBoxSecondExit,false]] as const)('二次断裂从镜像成交后开始计数，预先红叉不凑成第二次（%s）',async(_label,makeRule,locks)=>{
 const l=load(at=>at===T+9*M?bar(at,100,106,99,104):bar(at));
 const g=plan([box(makeRule())]),r=await run(g,28,l);
 expect(r).toMatchObject({status:'closed',endTime:T+25*M,exitSnapshot:{cause:{boxBreakEvidence:{firstBreakAt:T+15*M,breakCount:2}}}});
 expect(r.additionsBlockedAt).toBe(locks?T+15*M:undefined);
 expect(await run(g,28,l,await run(g,20,l))).toEqual(r);
 expect(await run(plan([box(makeRule(),false)]),28,l)).toMatchObject({status:'closed',endTime:T+15*M});
 const waiting=await run({...g,mirrorTakeProfit:{...g.mirrorTakeProfit!,enabled:false}},28,l);
 expect(waiting.status).toBe('open');expect(waiting.additionsBlockedAt).toBeUndefined();
 expect(waiting.boxStopStates?.['gated-box'].breakCount).toBeUndefined();
});
it.each([['primary',true],['attack',true],['primary',false],['attack',false]] as const)('镜像后首次断裂按所选口径处理 %s 加仓，暂停恢复保留锁和计数（停加仓=%s）',async(lane,locks)=>{
 const addDef={...def,id:'add',formula:'raw = B'},condition=makeQualityBuyFilter('add:raw','>',.5,true,[addDef]);
 condition.snapshot={...condition.snapshot,definitionKey:features.definitionKey(addDef),interval:'1m'};
 const round={source:'custom' as const,stricterPct:0,condition};
 const g=plan([box(locks?defaultBoxSecondBreak():defaultBoxSecondExit())]);
 g.addition={...defaultQualityAddition(),enabled:true,source:'custom',condition,maxRounds:30,
  rounds:Array.from({length:30},()=>lane==='primary'?round:{...round,condition:{...condition,threshold:1000}}),
  ...(lane==='attack'?{alternativeRounds:Array.from({length:30},()=>round)}:{})};
 const minuteLoad=load(at=>{const n=(at-T)/M;return n===9?bar(at,100,106,99,104):bar(at,n>9?100+(n-9)*10:100);});
 const l:FishReconstructionLoader=async(...args)=>{const bars=await minuteLoad(...args);return args[3].step===M?bars:bars.map(b=>({...b,high:b.open+1,low:b.open-1}));};
 const before=await run(g,14,l);expect(before.additionsBlockedAt).toBeUndefined();
 expect(before.boxStopStates?.['gated-box'].breakCount).toBeUndefined();
 expect(before.mirrorFill?.at).toBe(T+9*M);expect(before.additionFills!.length).toBeGreaterThan(0);
 if(lane==='attack')expect(before.additionFills!.every(f=>f.lane==='attack')).toBe(true);
 const first=await run(g,20,l);expect(first.status).toBe('open');expect(first.additionsBlockedAt).toBe(locks?T+15*M:undefined);
 expect(first.boxStopStates?.['gated-box'].breakCount).toBe(1);
 if(locks)expect(first.additionFills!.every(f=>f.at<T+15*M)).toBe(true);
 else{expect(first.additionFills!.some(f=>f.at>=T+15*M)).toBe(true);expect(first.boxStopStates?.['gated-box'].firstBreakAt).toBeUndefined();expect(first.boxStopStates?.['gated-box'].firstCountedBreakAt).toBe(T+15*M);}
 expect(await run(g,20,l,JSON.parse(JSON.stringify(before)))).toEqual(first);
 const exited=await run(g,28,l);expect(exited).toMatchObject({status:'closed',endTime:T+25*M,exitSnapshot:{cause:{boxBreakEvidence:{breakCount:2}}}});
 expect(await run(g,28,l,JSON.parse(JSON.stringify(first)))).toEqual(exited);
});
it('新约束等待时，原硬止损与普通卖出仍可先独立终止',async()=>{
 const stop:QualityHoldingVeto={id:'static',label:'静态',enabled:true,kind:'static-drawdown',direction:'>=',threshold:5};
 const l=load(at=>at===T+M?bar(at,100,100,90,90):bar(at));
 expect(await run(plan([cda(),stop]),8,l)).toMatchObject({status:'closed',endTime:T+M,endPrice:95});
 const g=plan();g.rule={metric:'结果',direction:'<',threshold:95};g.execution='intrabar-1m';
 expect(await run(g,8,l)).toMatchObject({status:'closed',endTime:T+2*M});
});
it('原条件和新增条件可同存，保存、恢复、再次解析后各自身份与公式保持不变',()=>{
 const old=cda(false),gated=cda(),oldBox=box(defaultBoxBreak(),false),gatedBox=box();
 const all=[old,gated,oldBox,gatedBox],draft=holdingVetoDraft(all),parsed=parseHoldingVetoDraft(draft,[def]);
 expect(parsed).toHaveLength(4);expect(new Set(parsed.map(v=>v.id)).size).toBe(4);
 expect(parsed.filter(v=>v.activation)).toHaveLength(2);
 const restored=parseHoldingVetoDraft(holdingVetoDraft(JSON.parse(JSON.stringify(parsed))),[def]);
 expect(restored).toEqual(parsed);expect(holdingVetoIdentity([old])).not.toEqual(holdingVetoIdentity([gated]));
 expect(parsed.find(v=>v.kind==='indicator'&&!v.activation)?.snapshot).toEqual(old.snapshot);
 expect(qualityResultKey(sample,plan([old]),0)).not.toBe(qualityResultKey(sample,plan([gated]),0));
});
it('新版本与参数冻结到副本，旧模板版本、内容和指纹不被重写',()=>{
 const original=freezeQualityPlan(plan([cda(false)])),before=JSON.stringify(original),updated=freezeQualityPlan({...structuredClone(original),holdingVetoes:[cda()]});
 expect(qualityPlanVersions(original).some(v=>v.key==='hard-stop-after-mirror')).toBe(false);
 expect(qualityPlanVersions(updated).find(v=>v.key==='hard-stop-after-mirror')?.version).toContain(V);
 const study=saveQualityPlanTemplate(newQualityStudy(T),updated,'镜像之后');
 const copy=qualityPlanFromTemplate(JSON.parse(JSON.stringify(study.planTemplates![0])),'副本');
 expect(copy.holdingVetoes).toEqual(updated.holdingVetoes);expect(planVersionChanges(copy)).toEqual([]);
 expect(planVersionChanges({...copy,holdingVetoes:[cda(false)]}).length).toBeGreaterThan(0);
 expect(JSON.stringify(original)).toBe(before);
});
it('阶段叠加可同时保留全程保护与镜像后保护，结构和进攻分支同步冻结',()=>{
 const old=cda(false),gated=cda(),base=plan([old]);
 expect(stagedHoldingVetoes({...base,vetoStages:[{afterAdditions:1,conditions:[gated]}]},1)).toEqual([old,gated]);
 const prerequisite=makeQualityBuyFilter('state:state','>',.65,true,features.BUILTIN_FEATURES);
 base.addition={enabled:true,source:'structure',stricterPct:10,quantityMode:'calculator',maxRounds:2,repeat:true,structure:defaultStructureAddition(),rounds:[0,1].map(()=>({source:'structure',stricterPct:10,structure:defaultStructureAddition(),prerequisites:[prerequisite]}))};
 const router:QualityPlanRouter={version:QUALITY_ROUTER_VERSION,afterAdditions:2,threshold:.9,structure:{...base,id:'s'},attack:{...structuredClone(base),id:'a'}};
 const edited=prepareQualityRouterDraft(router,{...router.structure,holdingVetoes:[gated]},router.attack,.9);
 expect(edited.attack.holdingVetoes).toEqual([gated]);expect(router.attack.holdingVetoes).toEqual([old]);
});
it('未识别版本和买前筛选拒绝套用；只认有效成交记录',()=>{
 expect(()=>validateHoldingVeto({...cda(),activation:'future' as typeof V})).toThrow();
 expect(()=>validateHoldingVeto({...cda(),kind:'drop-1m'})).toThrow();
 expect(()=>validatePreEntryConditions({...emptyPreEntryConditions(),hardVetoes:[cda()]})).toThrow('实际持仓');
 expect(postMirrorProtectionAt()).toBeUndefined();
 expect(postMirrorProtectionAt({at:T,price:100,fraction:0,gainPct:5,atOpen:false})).toBeUndefined();
});
it('新增门槛经 JSONB 对象字段重排后，参数、版本清单和运行身份仍一致',()=>{
 const frozen=freezeQualityPlan(plan([box(),cda()]));
 const reorder=(v:unknown):unknown=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
 const restored=reorder(frozen) as QualityGroup;
 expect(planVersionChanges(restored)).toEqual([]);
 expect(qualityResultKey(sample,restored,0)).toBe(qualityResultKey(sample,frozen,0));
});
it('原生 DBL-5 防守线价格输出保持一致，新版本只增加启动边界',async()=>{
 vi.restoreAllMocks();
 const fixtures=nativeFixture(),byTime=new Map(fixtures.map(b=>[b.openTime,b]));
 const at=(t:number):ResearchBar=>({...byTime.get(t)??bar(t),DBL5_tick_size:1} as ResearchBar);
 const entry=NATIVE_T+15*5*M,history=Array.from({length:288},(_,i)=>at(entry-(288-i)*5*M));
 const native=computeDbl5(history,{symbol:'TESTUSDT',tickSize:1}).rows.at(-1)!.darvas_5m_guard;
 expect(native).toBeGreaterThan(0);
 const l:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>at(a+i*p.step));
 let activation:number|undefined;
 const rule=guard();rule.structure.buffer=0;
 const r=createBoxStopReader({vetoes:[box(rule)],row,entry,since:entry,load:l,signal,activationAt:()=>activation});
 const minute=bar(entry,200,200,1,200);
 expect(await r.read(minute)).toBeUndefined();expect(r.states()['gated-box'].line).toBeUndefined();
 activation=entry;
 expect((await r.read(minute))?.fillPrice).toBe(native);
});
