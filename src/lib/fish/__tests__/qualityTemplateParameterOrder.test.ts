import {it,expect} from 'vitest';
import {createBoxStopReader,defaultBoxBreak,defaultBoxStop,freezeBoxStop} from '../qualityBoxStop';
import {holdingVetoIdentity,type QualityHoldingVeto} from '../qualityVeto';
import {shortFishHash} from '../algorithm';
import {freezeQualityPlan,planVersionChanges,qualityPlanVersions} from '../qualityPlanVersions';
import {qualityPlanFromTemplate} from '../qualityPlanTemplates';
import type {QualityGroup} from '../quality';
import {sample as nativeBars,T} from '../../__tests__/fixtures/dblBars';
import type {FishReconstructionLoader} from '../reconstruction';
import type {ResearchBar} from '@/lib/deepRsa/window';
import {BUILTIN_FEATURES} from '@/lib/deepDig/features';
import {buildFusionTemplatePlan} from '../qualityBuiltinTemplates';
const jsonb=<T,>(v:T):T=>{
 if(Array.isArray(v))return v.map(item=>jsonb(item)) as T;
 if(v&&typeof v==='object'){
  const object=v as Record<string,unknown>;
  return Object.fromEntries(Object.keys(object).sort((a,b)=>a.length-b.length||(a<b?-1:a>b?1:0)).map(k=>[k,jsonb(object[k])])) as T;
 }
 return v;
};
const fixture=()=>{
 const b=defaultBoxStop(); b.structure.kSource='guard'; b.structure.buffer=1; b.update='follow';
 const vetoes:QualityHoldingVeto[]=[
  {id:'b',label:'',kind:'box-stop',enabled:true,direction:'<=',threshold:0,boxStop:defaultBoxBreak()},
  {id:'s',label:'',kind:'box-stop',enabled:true,direction:'<=',threshold:0,boxStop:freezeBoxStop(b)},
  ...(['static-drawdown','payoff-ratio','drop-5m','drop-1m','dynamic-drawdown'] as const).map((kind,i)=>({id:kind,label:'',kind,direction:'>=' as const,threshold:[5,5000,10,5,30][i],enabled:true}))];
 return freezeQualityPlan({id:'plan',label:'只重建截图中的硬性终止条件，非完整账号模板',snapshot:{},holdingVetoes:vetoes,vetoFill:'stop'} as QualityGroup);
};
const hash=(v:QualityHoldingVeto[])=>shortFishHash(JSON.stringify(holdingVetoIdentity(v)));
it('reproduces both reported fingerprints using only a JSONB object key reorder',()=>{
 const plan=fixture();
 expect(hash(plan.holdingVetoes!)).toBe('1qppj3w2xvf5m');
 expect(hash(jsonb(plan).holdingVetoes)).toBe('48pg8o14syjp6');
 expect(jsonb(jsonb(plan))).toEqual(jsonb(plan));
});
it('reads the original frozen template after cloud reload without changing any saved content',()=>{
 const original=fixture(), cloud=jsonb(original), before=JSON.stringify(cloud);
 expect(qualityPlanVersions(cloud).find(v=>v.key==='hard-stop-params')!.version).toBe('参数 #48pg8o14syjp6');
 expect(planVersionChanges(cloud)).toEqual([]);
 const restored=qualityPlanFromTemplate({id:'template',name:'原模板',savedAt:1,updatedAt:1,plan:cloud},'copy');
 expect(restored).toEqual({...cloud,id:'copy',label:'原模板'});
 expect(restored.frozenVersions).toEqual(original.frozenVersions);
 expect(JSON.stringify(cloud)).toBe(before);
});
it('also accepts a cloud-order frozen manifest read back from insertion-order data',()=>{
 const original=fixture(), cloud=jsonb(original);
 const cloudFrozen=freezeQualityPlan(cloud);
 expect(planVersionChanges({...original,frozenVersions:cloudFrozen.frozenVersions})).toEqual([]);
});
it.each([
 ['threshold',(p:QualityGroup)=>{p.holdingVetoes![2].threshold=6;}],
 ['guard parameter',(p:QualityGroup)=>{p.holdingVetoes![0].boxStop!.structure.definition.DBL5_config!.guard_range_atr=2;}],
 ['buffer',(p:QualityGroup)=>{p.holdingVetoes![1].boxStop!.structure.buffer=2;}],
 ['confirmation',(p:QualityGroup)=>{p.holdingVetoes![1].boxStop!.confirmation='close-5m';}],
 ['update',(p:QualityGroup)=>{p.holdingVetoes![1].boxStop!.update='raise-only';}],
 ['enabled',(p:QualityGroup)=>{p.holdingVetoes![0].enabled=false;}],
] as const)('continues to reject real changes to %s',(name,change)=>{
 const cloud=jsonb(fixture());change(cloud);
 expect(planVersionChanges(cloud).some(c=>c.key==='hard-stop-params')).toBe(true);
 expect(()=>qualityPlanFromTemplate({id:'t',name,plan:cloud,savedAt:1,updatedAt:1},'copy')).toThrow('算法版本');
});
it('keeps engine version changes blocked alongside a harmless parameter reorder',()=>{
 const cloud=jsonb(fixture());
 cloud.frozenVersions=cloud.frozenVersions.map(v=>v.key==='hard-stop'?{...v,version:'holding-veto-v2'}:v);
 expect(planVersionChanges(cloud).map(c=>c.key)).toEqual(['hard-stop']);
});
it('restores both routed branches while retaining their original frozen manifests',()=>{
 const routed=buildFusionTemplatePlan(BUILTIN_FEATURES,'router','原分流模板');
 for(const branch of ['structure','attack'] as const)routed.router![branch].holdingVetoes=structuredClone(fixture().holdingVetoes);
 const original=freezeQualityPlan(routed),cloud=jsonb(original);
 expect(planVersionChanges(cloud)).toEqual([]);
 cloud.router!.structure.holdingVetoes![1].boxStop!.structure.buffer=2;
 cloud.router!.attack.holdingVetoes![1].boxStop!.structure.buffer=2;
 expect(planVersionChanges(cloud).some(c=>c.key==='structure:hard-stop-params')).toBe(true);
});
it('produces the same native guard stop and fill after the cloud roundtrip',async()=>{
 const original=fixture(),cloud=jsonb(original),entry=T+15*300000;
 const byTime=new Map(nativeBars().map(b=>[b.openTime,b]));
 const at=(t:number):ResearchBar=>({...byTime.get(t)??{openTime:t,open:100,high:100,low:100,close:100,volume:10,takerBuyVolume:5,quoteVolume:1000,takerBuyQuoteVolume:500},DBL5_tick_size:1} as ResearchBar);
 const load:FishReconstructionLoader=async(_row,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>at(a+i*p.step));
 const row={id:'row',symbol:'TESTUSDT',timeMs:entry,timeLabel:'',fallbackZone:''};
 const replay=async(plan:QualityGroup)=>{
  const reader=createBoxStopReader({vetoes:[plan.holdingVetoes![1]],row,entry,since:entry,load,signal:new AbortController().signal});
  const hit=await reader.read({openTime:entry,open:200,high:200,low:1,close:200,volume:10,takerBuyVolume:5});
  expect(hit?.fillPrice).toBeGreaterThan(0);
  return {hit,states:reader.states()};
 };
 expect(await replay(cloud)).toEqual(await replay(original));
});
