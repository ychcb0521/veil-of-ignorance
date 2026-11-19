import {it,expect} from 'vitest';
import {definitionKey} from '@/lib/deepDig/features';
import {evaluateQualitySample,type QualityGroup,type QualitySample} from '@/lib/fish/quality';
import {makeQualityHoldingVeto,holdingVetoDraft,parseHoldingVetoDraft} from '@/lib/fish/qualityFilters';
import {LIMITED_STATIC_DRAWDOWN_CHOICE,LIMITED_STATIC_DRAWDOWN_VETO_VERSION,LIMITED_PAYOFF_RISK_VERSION,holdingVetoIdentity,holdingVetoName,validateHoldingVeto,payoffStopL0Pct} from '@/lib/fish/qualityVeto';
import {initialLimitedDrawdownPct,initialPayoffRiskThreshold,withLimitedPayoffRisk,qualityStaticDrawdownReason} from '@/lib/fish/qualityStaticDrawdownSell';
import {freezeQualityPlan,planVersionChanges} from '@/lib/fish/qualityPlanVersions';
import {mirrorHardStopStage} from '@/lib/fish/qualityMirrorHardStopStages';
import {defaultQualityAddition} from '@/lib/fish/qualityAddition';
import {qualityPayoffRatio} from '@/lib/fish/qualityPresentation';
import type {ResearchBar} from '@/lib/deepRsa/window';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
const M=60000,T=Date.UTC(2026,9,20),sample:QualitySample={id:'limited',enteredAt:T,basis:'signal',importedAt:T,groups:[],source:{id:'limited',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:''}};
const def={id:'custom',name:'价格',short:'价格',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'5m' as const};
const plan=():QualityGroup=>({id:'p',label:'p',metric:'raw',execution:'intrabar-1m',snapshot:{featureId:'custom',definitionKey:definitionKey(def),statistic:'raw',interval:'5m',scale:1,threshold:0,direction:'<',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T},rule:{metric:'raw',direction:'<',threshold:0}});
const bar=(t:number,open=100,high=open,low=open,close=open):ResearchBar=>({openTime:t,open,high,low,close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50});
const loader=(f:(t:number)=>ResearchBar):FishReconstructionLoader=>async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?f(a+i*M):bar(a+i*p.step));
const limited=(threshold:number)=>makeQualityHoldingVeto(LIMITED_STATIC_DRAWDOWN_CHOICE,'>=',threshold),free=(threshold:number)=>makeQualityHoldingVeto('static-drawdown','>=',threshold);
const run=(g:QualityGroup,load:FishReconstructionLoader,end=T+4*M,prior?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>evaluateQualitySample(sample,g,0,end,load,new AbortController().signal,prior);
it.each([false,true])('限制静态回撤按首仓价独立全仓退出，跳空=%s，续算保留原因与版本',async gap=>{
 const g={...plan(),rule:undefined,holdingVetoes:[limited(3),free(8)]},load=loader(t=>t===T?bar(t):t===T+M?gap?bar(t,95,99,94,98):bar(t,100,100,96,99):bar(t,98));
 const prior=await run(g,load,T+M),whole=await run(g,load),resumed=await run(g,load,T+4*M,prior);
 expect(whole).toMatchObject({status:'closed',endTime:T+M,endPrice:gap?95:97,exitSnapshot:{cause:{kind:'static-drawdown',label:'限制静态最大回撤',limitedStaticVersion:LIMITED_STATIC_DRAWDOWN_VETO_VERSION,threshold:3}}});expect(!!whole.exitSnapshot?.atOpen).toBe(gap);expect(resumed).toEqual(whole);
 expect(qualityStaticDrawdownReason(whole)).toContain('限制静态最大回撤');expect(initialLimitedDrawdownPct(g)).toBe(3);
});
it('镜像前限制停止生效，镜像后限制从实际成交后检查；初始风险仍为前段阈值',async()=>{
 const before={...limited(3),mirrorStage:mirrorHardStopStage('before')},after={...limited(5),mirrorStage:mirrorHardStopStage('after')},g={...plan(),rule:undefined,mirrorTakeProfit:{enabled:true,gainPct:10,sellPct:50},holdingVetoes:[before,after]};
 const load=loader(t=>t===T?bar(t,100,111,99,110):t===T+M?bar(t,110,110,96,100):bar(t,100,100,94,94));
 const prior=await run(g,load,T+2*M);expect(prior.status).toBe('open');expect(prior.mirrorFill).toBeDefined();
 const whole=await run(g,load);expect(whole).toMatchObject({status:'closed',endTime:T+2*M,endPrice:95,exitSnapshot:{cause:{limitedStaticVersion:LIMITED_STATIC_DRAWDOWN_VETO_VERSION,threshold:5,mirrorStage:{stage:'after'}}}});
 const resumed=await run(g,load,T+4*M,prior),{drawdownPct:wholeDrawdown,...wholeRest}=whole,{drawdownPct:resumedDrawdown,...resumedRest}=resumed;expect(resumedRest).toEqual(wholeRest);expect(resumedDrawdown).toBeCloseTo(wholeDrawdown!,10);expect(initialPayoffRiskThreshold(g)).toBe(3);
});
it('初始限制优先作 R 基准，后段限制不计入；旧自由回撤仍保持原分母',()=>{
 const g={...plan(),holdingVetoes:[limited(5),free(3),{...limited(1),mirrorStage:mirrorHardStopStage('after')}]};
 expect(initialLimitedDrawdownPct(g)).toBe(5);expect(payoffStopL0Pct(g.holdingVetoes)).toBe(5);
 expect(qualityPayoffRatio(g,{key:'r',sampleId:'s',groupId:'p',status:'closed',evaluatedAt:0,pnl:10,initialNotional:100}).value).toBe(2);
 expect(initialLimitedDrawdownPct({...g,holdingVetoes:[free(3)]})).toBeUndefined();expect(payoffStopL0Pct([free(3),free(5)])).toBe(3);
});
it('仅加仓后新增限制时，盈亏比执行仍冻结首仓原有风险',()=>{
 const g=withLimitedPayoffRisk({...plan(),addition:{...defaultQualityAddition(),enabled:true},holdingVetoes:[free(5),makeQualityHoldingVeto('payoff-ratio','>=',10)],vetoStages:[{afterAdditions:1,conditions:[limited(3)]}]});
 expect(g.payoffRiskVersion).toBe(LIMITED_PAYOFF_RISK_VERSION);expect(initialPayoffRiskThreshold(g)).toBe(5);
});
it('没有新限制项的旧方案保持原来的逐阶段风险回退，不因已有标签转换',()=>{
 const old={...plan(),payoffRiskVersion:LIMITED_PAYOFF_RISK_VERSION,holdingVetoes:[free(5)],vetoStages:[{afterAdditions:1,conditions:[free(3)]}]},before=JSON.stringify(old);
 expect(initialPayoffRiskThreshold(old)).toBeUndefined();expect(initialLimitedDrawdownPct(old)).toBeUndefined();expect(JSON.stringify(old)).toBe(before);
});
it('保存恢复区分两类静态回撤，显式冻结新版本，旧参数和指纹不改',()=>{
 const old=freezeQualityPlan({...plan(),holdingVetoes:[free(3)]}),before=JSON.stringify(old),next=freezeQualityPlan({...plan(),holdingVetoes:[limited(3)]});
 expect(parseHoldingVetoDraft(holdingVetoDraft(next.holdingVetoes))).toEqual(next.holdingVetoes);expect(holdingVetoIdentity(next.holdingVetoes)).not.toEqual(holdingVetoIdentity(old.holdingVetoes));
 expect(next.frozenVersions!.find(v=>v.key==='hard-stop-limited-static')!.version).toContain(LIMITED_STATIC_DRAWDOWN_VETO_VERSION);expect(planVersionChanges(next)).toEqual([]);
 const changed=structuredClone(next);delete changed.holdingVetoes![0].limitedStaticVersion;expect(planVersionChanges(changed).length).toBeGreaterThan(0);expect(planVersionChanges(old)).toEqual([]);expect(JSON.stringify(old)).toBe(before);expect(holdingVetoName(old.holdingVetoes![0])).toBe('自由静态最大回撤');
});
it('限制阈值拒绝空值、非有限值、0、100%及未知版本',()=>{
 for(const threshold of [NaN,Infinity,0,-1,100])expect(()=>limited(threshold)).toThrow();expect(()=>validateHoldingVeto({...limited(3),limitedStaticVersion:'wrong'} as never)).toThrow();expect(()=>limited(3.123456789012345)).not.toThrow();
});
