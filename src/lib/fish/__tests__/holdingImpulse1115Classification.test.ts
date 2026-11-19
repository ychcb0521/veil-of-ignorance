import {expect,it,vi} from 'vitest';
import {DBL5_STEP} from '@/lib/dbl5m';
import {Dbl5GuardPlusEngine} from '@/lib/dbl5GuardPlus';
import {bar,impulse,warm,TICK,START} from '@/lib/__tests__/fixtures/dbl5GuardPlusBars';
import {classificationExamples} from '@/lib/__tests__/fixtures/impulse1115ClassificationBars';
import {IMPULSE_1115_CLASSIFICATION_DEF,definitionKey} from '@/lib/deepDig/features';
import {defaultHoldingImpulse1115Rule,readHoldingImpulse1115Classification,holdingImpulse1115Identity} from '../holdingImpulse1115Classification';
import {evaluateQualitySample,newQualityStudy,qualityResultKey,type QualityGroup,type QualitySample} from '../quality';
import {freezeQualityPlan,planVersionChanges} from '../qualityPlanVersions';
import {saveQualityPlanTemplate,qualityPlanFromTemplate} from '../qualityPlanTemplates';
import {qualitySellKey} from '../qualityCampaignArchive';
import {routerResultFingerprint} from '../qualityPlanRouter';
import {buildQualityCampaignData} from '../qualityCampaignProjection';
import {qualityCampaignSheets} from '../qualityCampaignExport';
import type {FishReconstructionLoader} from '../reconstruction';
const M=60_000,STEP=DBL5_STEP,entry=START+21*STEP,signal=new AbortController().signal;
const row={id:'source',symbol:'TESTUSDT',timeMs:entry,timeLabel:'',fallbackZone:''};
const sample:QualitySample={id:'sample',enteredAt:entry,basis:'signal',importedAt:entry,groups:[],source:row};
const def={id:'fixed',name:'原卖出规则',short:'原卖出规则',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
const snapshot={featureId:def.id,definitionKey:definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:0,direction:'<' as const,average:100,cbi2:100,startAverage:100,previousAverage:100,cutoffMs:entry};
const base:QualityGroup={id:'plan',label:'原监测方案',metric:'raw',snapshot,rule:{metric:'raw',direction:'<',threshold:0}};
const rule=()=>defaultHoldingImpulse1115Rule({...IMPULSE_1115_CLASSIFICATION_DEF,DBL5_initialization_start:START});
function fixture(which=5){
 const seed=[...warm(),impulse()],native=new Dbl5GuardPlusEngine({symbol:'TESTUSDT',tickSize:TICK});
 const early=seed.map(b=>native.push(b)).at(-1)!.plus.early_impulse_event!;
 const convert=(x:number)=>Math.round((early.impulse_guard_value+(x-100)*early.frozen_atr)*100)/100;
 const tail=classificationExamples[which].bars.map((b,i)=>bar(21+i,convert(b.open),convert(b.high),convert(b.low),convert(b.close)));
 const bars=[...seed,...tail];
 const nativeCalls:{from:number;to:number}[]=[];
 const load=vi.fn(async(_row,from:number,to:number,plan)=>{
  if(plan.step===STEP){nativeCalls.push({from,to});return bars.filter(b=>b.openTime>=from&&b.openTime<to);}
  return Array.from({length:(to-from)/M},(_,i)=>({openTime:from+i*M,open:100,high:101,low:99,close:100,
   volume:1,quoteVolume:100,takerBuyVolume:0,takerBuyQuoteVolume:1}));
 }) as unknown as FishReconstructionLoader;
 return {load,bars,nativeCalls,end:bars.at(-1)!.openTime+STEP};
}
for(const [i,example] of classificationExamples.entries())it('实际持仓监测输出：'+example.name,async()=>{
 const {load,end}=fixture(i),group={...base,impulse1115Classification:rule()};
 const old=await evaluateQualitySample(sample,base,0,end,load,signal);
 const result=await evaluateQualitySample(sample,group,0,end,load,signal);
 expect(result.impulse1115Classification).toMatchObject({status:'ready',through:end,row:{current:{mainClass:example.mainClass,case:example.value}}});
 const {key:oldKey,...oldTrade}=old,{key:newKey,impulse1115Classification:reading,...newTrade}=result;
 expect(newTrade).toEqual(oldTrade);
 expect(newKey).toBe(oldKey);
});
it('暂停恢复只加载新的5m行情，并与完整运行的分类及交易结果一致',async()=>{
 const {load,nativeCalls,end}=fixture(),group={...base,impulse1115Classification:rule()};
 const partial=await evaluateQualitySample(sample,group,0,entry+2*STEP,load,signal);
 const preserved=JSON.parse(JSON.stringify(partial));
 nativeCalls.length=0;
 const resumed=await evaluateQualitySample(sample,group,0,end,load,signal,preserved);
 expect(nativeCalls[0].from).toBe(entry+2*STEP);
 const full=await evaluateQualitySample(sample,group,0,end,load,signal);
 expect(resumed.impulse1115Classification).toEqual(full.impulse1115Classification);
 expect(resumed.impulse1115Classification?.row?.current?.history).toEqual(full.impulse1115Classification?.row?.current?.history);
 expect(partial.impulse1115Classification?.row?.current?.case).toBeNull();
 expect(resumed.status).toBe(full.status);
});
it('未启用时不增加原生请求，保留旧结果和方案身份；分类取数失败也不改变交易结论',async()=>{
 const {load,nativeCalls,end}=fixture();
 const before=JSON.stringify(base),oldKey=qualityResultKey(sample,base,0),oldSell=qualitySellKey(base);
 const old=await evaluateQualitySample(sample,base,0,end,load,signal);
 expect(nativeCalls).toHaveLength(0);expect(old).not.toHaveProperty('impulse1115Classification');
 const unavailable=vi.fn(async(r,from,to,plan,s)=>{
  if(plan.step===STEP)throw Error('分类行情缺失');return load(r,from,to,plan,s);
 }) as unknown as FishReconstructionLoader;
 const result=await evaluateQualitySample(sample,{...base,impulse1115Classification:rule()},0,end,unavailable,signal);
 expect(result.impulse1115Classification).toMatchObject({status:'waiting',message:'分类行情缺失'});
 expect(result.status).toBe(old.status);expect(result.endPrice).toBe(old.endPrice);expect(result.pnl).toBe(old.pnl);
 expect(JSON.stringify(base)).toBe(before);expect(qualityResultKey(sample,base,0)).toBe(oldKey);expect(qualitySellKey(base)).toBe(oldSell);
});
it('实盘执行时钟路径不等待附加分类取数，也不产生新的战役身份',async()=>{
 const {load,nativeCalls,end}=fixture(),group={...base,impulse1115Classification:rule()};
 const result=await evaluateQualitySample(sample,group,0,end,load,signal,undefined,100,end);
 expect(nativeCalls).toHaveLength(0);
 expect(result.key).toBe(qualityResultKey(sample,base,0));
 expect(qualitySellKey(group)).toBe(qualitySellKey(base));
 const original={version:'router-v1',afterAdditions:1,threshold:.6,structure:freezeQualityPlan(base),attack:freezeQualityPlan({...base,id:'attack'})} as never;
 const observed={...original as object,structure:freezeQualityPlan(group),attack:freezeQualityPlan({...base,id:'attack',impulse1115Classification:rule()})} as never;
 expect(routerResultFingerprint(observed)).toBe(routerResultFingerprint(original));
});
it('只观察而未设置卖出规则时仍输出分类，但不改变原先待设卖出的状态',async()=>{
 const {load,end}=fixture();
 const result=await evaluateQualitySample(sample,{...base,rule:undefined,impulse1115Classification:rule()},0,end,load,signal);
 expect(result.status).toBe('waiting');
 expect(result.impulse1115Classification?.row?.current?.case).toBe(6);
 expect(result.additionFill).toBeUndefined();expect(result.mirrorFill).toBeUndefined();
});
it('只读已收盘5m，反抽失败或修复确认不会提前使用下一根数据',async()=>{
 const {load,end}=fixture();
 const before=await readHoldingImpulse1115Classification(rule(),{row,entry,at:end-1,load,signal});
 expect(before.row?.current?.case).not.toBe(6);expect(before.through).toBe(end-STEP);
 const after=await readHoldingImpulse1115Classification(rule(),{row,entry,at:end,load,signal,previous:before});
 expect(after.row?.current?.case).toBe(6);
});
it('逐方案冻结参数、模板恢复及版本清单，不向旧模板自动加入配置',()=>{
 const configured=freezeQualityPlan({...base,impulse1115Classification:rule()}),original=freezeQualityPlan(base);
 expect(planVersionChanges(configured)).toEqual([]);
 expect(configured.frozenVersions?.some(v=>v.key==='holding-impulse-1115-classification')).toBe(true);
 expect(original.frozenVersions?.some(v=>v.key==='holding-impulse-1115-classification')).toBe(false);
 const before=JSON.stringify(original);
 const study=saveQualityPlanTemplate(newQualityStudy(),configured,'带分类的新副本',1);
 const saved=study.planTemplates![0];
 const restored=qualityPlanFromTemplate(JSON.parse(JSON.stringify(saved)),'恢复副本');
 expect(restored.impulse1115Classification).toEqual(configured.impulse1115Classification);
 expect(restored.impulse1115Classification).not.toBe(configured.impulse1115Classification);
 const changed=structuredClone(rule());changed.definition.DBL5C_parameters={breakCloses:3};
 expect(holdingImpulse1115Identity(changed)).not.toEqual(holdingImpulse1115Identity(rule()));
 expect(qualityResultKey(sample,{...base,impulse1115Classification:changed},0)).toBe(qualityResultKey(sample,configured,0));
 expect(JSON.stringify(original)).toBe(before);
});
it('战役详情和导出读取冻结的监测分类及历史，不把同一笔持仓变成新战役',async()=>{
 const {load,end}=fixture(),group={...base,impulse1115Classification:rule()};
 const observed=await evaluateQualitySample(sample,group,0,end,load,signal);
 const original=await evaluateQualitySample(sample,base,0,end,load,signal);
 const campaign=(plan:QualityGroup,result:typeof observed)=>buildQualityCampaignData('owner',{
  sample,plan,result,detectors:[],observeHours:0,firstEvaluatedAt:entry,
 },'sell').campaign;
 const old=campaign(base,original),frozen=campaign(group,observed);
 expect(frozen.id).toBe(old.id);
 expect(frozen.comparison?.sellEvidence?.impulse1115Classification).toEqual(observed.impulse1115Classification);
 expect(frozen.comparison?.monitorPlan?.impulse1115Classification).toEqual(group.impulse1115Classification);
 const rows=qualityCampaignSheets(frozen).find(s=>s.name==='急拉线持仓分类')!.rows;
 expect(rows.some(r=>r.includes('修复确认'))).toBe(true);
 group.impulse1115Classification.definition.DBL5C_parameters={breakCloses:8};
 expect(frozen.comparison?.monitorPlan?.impulse1115Classification?.definition.DBL5C_parameters?.breakCloses).toBe(2);
});
