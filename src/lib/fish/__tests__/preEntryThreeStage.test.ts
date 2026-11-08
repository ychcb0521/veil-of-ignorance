import {preEntryWindowLoader} from '../preEntryWindowLoader';
import { expect, it } from 'vitest';
import { computeDbl5, DBL5_STEP, type Dbl5Bar, type Dbl5Row } from '@/lib/dbl5m';
import { definitionKey } from '@/lib/deepDig/features';
import { nativeGuardEvent, createPreEntryGuardReader } from '../preEntryGuardEvent';
import { emptyPreEntryThreeStage, retryPreEntryThreeStage, threeStageFingerprint, validatePreEntryThreeStage, copyAdditionMarketConditions, copyOrdinaryMarketSeller } from '../preEntryThreeStage';
import { freezeQualityPlan, planVersionChanges } from '../qualityPlanVersions';
import type { QualityGroup } from '../quality';
import type { FishReconstructionLoader } from '../reconstruction';
import { decideThreeStage } from '../preEntryThreeStageScan';
import { withTuringInitialization } from '../qualityInitialization';
import { collectPreEntryMonitor, type PreEntryRecord } from '../preEntryMonitor';
import { PRE_ENTRY_THREE_STAGE_VERSION } from '../preEntryThreeStage';

const T=Date.UTC(2026,0,5),F=DBL5_STEP;
it('freezes a distinct v7 fingerprint without altering the original v6 observation basis or frozen parameters',()=>{
 const original=emptyPreEntryThreeStage(),before=structuredClone(original),hash=threeStageFingerprint(original),copy=retryPreEntryThreeStage(original);
 expect(copy).toMatchObject({version:'pre-entry-three-stage-v7',observationBasis:'retry-origin-v2',admission:{guardEnabled:true,algorithms:[]}});expect(threeStageFingerprint(copy)).not.toBe(hash);expect(original).toEqual(before);expect(threeStageFingerprint(original)).toBe(hash);
 expect(()=>validatePreEntryThreeStage({...copy,version:'pre-entry-three-stage-v6'})).toThrow();expect(()=>validatePreEntryThreeStage({...original,observationBasis:'retry-origin-v2'})).toThrow();
});
const row=(patch:Partial<Dbl5Row>={}):Dbl5Row=>({at:T+F,data_valid:true,darvas_5m_guard:100,darvas_5m_guard_regime:'range',darvas_5m_guard_segment:0,darvas_5m_guard_broken:false,box_id:'a',tick_size:'1',algorithm_version:'dbl-5-v2',effective_parameters:{n:3},initialization_start:T-F,initialization_id:'test',data_checksum:'sum',...patch} as Dbl5Row);
it.each([
  [null,100,'range','range','first'],
  [100,105,'range','range','raise'],
  [100,95,'range','range','lower'],
  [100,100,'range','trend','type-change'],
  [100,100,'trend','range','type-change'],
] as const)('recognizes only native price or type changes (%s → %s)',(before,after,oldRegime,regime,kind)=>{
  const previous=row({at:T,darvas_5m_guard:before,darvas_5m_guard_regime:before==null?null:oldRegime});
  expect(nativeGuardEvent(previous,row({darvas_5m_guard:after,darvas_5m_guard_regime:regime}),T)).toMatchObject({kind,at:T+F,price:after});
});
it('rejects old extension, box renumbering, disappearance, warmup and invalid data',()=>{
  for(const current of [row(),row({box_id:'other'}),row({darvas_5m_guard:null}),row({data_valid:false})])expect(nativeGuardEvent(row({at:T}),current,T)).toBeUndefined();
  expect(nativeGuardEvent(undefined,row(),T+F)).toBeUndefined();
});
it('detects rebuilding at the same price and preserves the native break evidence',()=>{
  const e=nativeGuardEvent(row({at:T}),row({darvas_5m_guard_segment:1,darvas_5m_guard_broken:true}),T);
  expect(e).toMatchObject({kind:'rebuild',price:100,broken:true,segment:1});
  expect(decideThreeStage(T+F,{status:'pass'},{status:'blocked',reason:'原生断裂'},{event:e})).toMatchObject({state:'second-blocked'});
});
it('requires all gates at this exact event; a later recovery cannot spend an old event',()=>{
  const event=nativeGuardEvent(undefined,row(),T)!;
  expect(decideThreeStage(T+F,{status:'blocked',reason:'方向'},{status:'pass'},{event}).state).toBe('first-blocked');
  expect(decideThreeStage(T+F+60000,{status:'pass'},{status:'pass'},{}).state).toBe('waiting-guard');
  expect(decideThreeStage(T+F,{status:'pass'},{status:'pending',reason:'未知'},{event}).state).toBe('waiting-data');
  expect(decideThreeStage(T+F,{status:'pass'},{status:'pass'},{event},true).state).toBe('waiting-data');
});
const plan=():QualityGroup=>({id:'v5',label:'三阶',metric:'raw',snapshot:{featureId:'test',definitionKey:definitionKey({formula:'raw=C',positive:'1',control:'0',interval:'5m'}),statistic:'raw',interval:'5m',scale:1,threshold:0,cutoffMs:T,average:0,cbi2:0,startAverage:0,previousAverage:0},preEntryThreeStage:emptyPreEntryThreeStage()});
it('freezes all new parameters and survives JSONB object reordering without touching old identities',()=>{
  const p=freezeQualityPlan(plan()),before=structuredClone(p),fingerprint=threeStageFingerprint(p.preEntryThreeStage!);
  const reorder=(v:unknown):unknown=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
  const reordered=reorder(p) as QualityGroup;
  expect(threeStageFingerprint(reordered.preEntryThreeStage!)).toBe(fingerprint);expect(planVersionChanges(reordered)).toEqual([]);
  reordered.preEntryThreeStage!.guard.rule.structure.definition.DBL5_config!.guard_range_atr=2;
  expect(planVersionChanges(reordered).map(c=>c.key)).toContain('pre-entry-three-stage');
  expect(p).toEqual(before);
});
it('preserves closed-only addition prerequisites, rejects cost/stage dependencies and ordinary seller overlays',()=>{
  const p=plan(),filter={id:'f',label:'方向',metric:'raw',snapshot:p.snapshot,enabled:true,direction:'>' as const,threshold:100};
  const result=copyAdditionMarketConditions({source:'structure',stricterPct:0,prerequisites:[filter]});
  expect(result.required[0]).toMatchObject({timing:'closed',threshold:100});expect(result.required[0].id).not.toBe(filter.id);
  expect(()=>copyAdditionMarketConditions({source:'structure',stricterPct:0,minGainPct:2})).toThrow('成本');
  expect(copyAdditionMarketConditions({source:'detector',stricterPct:5}).detectors).toMatchObject([{match:'any',stricterPct:5}]);
  expect(()=>copyOrdinaryMarketSeller({...p,rule:{metric:'raw',direction:'<',threshold:0},combo:{switchPct:2,beforeLabel:'a',after:{label:'b',metric:'raw',snapshot:p.snapshot,rule:{metric:'raw',direction:'<',threshold:1}}}})).toThrow('不能完整');
});
it('keeps position-only conditions unavailable and prevents a hidden trend-only admission restriction',()=>{
  const c=emptyPreEntryThreeStage();
  c.hardVetoes=[{id:'x',label:'profit',kind:'payoff-ratio',enabled:true,direction:'>=',threshold:10}];
  expect(()=>validatePreEntryThreeStage(c)).toThrow('没有实际仓位');
  c.hardVetoes=[];c.guard.rule.structure.guardTrendOnly=true;expect(()=>validatePreEntryThreeStage(c)).toThrow('完整原生');
});
function walk(n=350):Dbl5Bar[]{
  let x=7,price=10000;const random=()=>((x=(x*1103515245+12345)%2147483648)/2147483648);
  return Array.from({length:n},(_,i)=>{
    const drift=i<100?0:i<230?6:(11200-price)*.02,open=price,close=Math.max(100,Math.round(open+drift+(random()-.5)*60));
    const high=Math.max(open,close)+Math.round(random()*20),low=Math.max(1,Math.min(open,close)-Math.round(random()*40));price=close;
    return {openTime:T+i*F,open,high,low,close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50,DBL5_tick_size:1};
  });
}
it('reads actual native checkpoints causally and reproduces exactly the original line updates',async()=>{
  const bars=walk(),start=T+150*F,config=emptyPreEntryThreeStage();
  const expected=computeDbl5(bars,{symbol:'TURING:TURING 1',tickSize:1}).rows;
  let observed=start;
  const raw:FishReconstructionLoader=async(_row,from,to)=>{
    expect(to).toBeLessThanOrEqual(observed);
    return bars.filter(b=>b.openTime>=from&&b.openTime<to);
  };
  const load=withTuringInitialization(raw,'TURING:TURING 1',T);
  const reader=createPreEntryGuardReader({config,start,row:{id:'s',symbol:'TURING:TURING 1',timeMs:start,timeLabel:'',fallbackZone:''},load,signal:new AbortController().signal});
  let events=0;
  for(let i=150;i<bars.length;i++){
    observed=T+(i+1)*F;
    const result=await reader(observed),native=expected[i],event=nativeGuardEvent(expected[i-1],native,start);
    expect(result.line??null).toBe(native.darvas_5m_guard);
    expect(result.event?.kind).toBe(event?.kind);
    if(result.event){events++;expect(result.event).toMatchObject({at:observed,price:native.darvas_5m_guard,regime:native.darvas_5m_guard_regime});}
    expect((await reader(observed+60000)).event).toBeUndefined();
  }
  expect(events).toBeGreaterThan(0);
});
it('the complete v5 scanner admits at exactly the original native first event, without mocking the guard',async()=>{
  const bars=walk(230),start=T+150*F,rows=computeDbl5(bars,{symbol:'TURING:TURING 1',tickSize:1}).rows;
  const expected=rows.find((r,i)=>nativeGuardEvent(rows[i-1],r,start));
  expect(expected).toBeDefined();
  const p=plan();p.initialization='turing-origin-v1';
  const load:FishReconstructionLoader=async(_source,from,to,program)=>Array.from({length:(to-from)/program.step},(_,i)=>{
    const at=from+i*program.step,k=Math.floor((at-T)/F),b=bars[k];
    if(!b)throw Error('fixture range');
    if(program.step===F)return b;
    const n=(at-b.openTime)/60000,open=b.open+(b.close-b.open)*n/5,close=b.open+(b.close-b.open)*(n+1)/5;
    return {...b,openTime:at,open,close};
  });
  let record:PreEntryRecord={id:'r',roundId:'round',planId:p.id,status:'queued',startTime:start,cursor:start,readings:[],updatedAt:T,sample:{id:'sample',enteredAt:start,basis:'signal',importedAt:T,groups:[],source:{id:'source',symbol:'TURING:TURING 1',timeMs:start,timeLabel:'',fallbackZone:''}}};
  await collectPreEntryMonitor({round:{id:'round',engine:PRE_ENTRY_THREE_STAGE_VERSION,plans:[freezeQualityPlan(p)],filters:[],hours:0,state:'running',startedAt:T,updatedAt:T},records:[record],onRecord:r=>record=r},load,T+230*F,new AbortController().signal,()=>undefined,{start:async()=>T});
  expect(record).toMatchObject({status:'matched',matchedAt:expected!.at,threeStage:{event:{price:expected!.darvas_5m_guard,regime:expected!.darvas_5m_guard_regime}}});
});

it('batches finite-window native data while reproducing every original guard reading and event',async()=>{
 const bars=walk(350),start=T+150*F,end=T+bars.length*F,config=emptyPreEntryThreeStage(),row={id:'s',symbol:'TURING:TURING 1',timeMs:end,timeLabel:'',fallbackZone:''};
 const requests:{from:number;to:number}[]=[];
 const raw:FishReconstructionLoader=async(_row,from,to)=>{requests.push({from,to});return bars.filter(b=>b.openTime>=from&&b.openTime<to);};
 const load=withTuringInitialization(raw,row.symbol,T);
 const batched=createPreEntryGuardReader({config,start,row,load:preEntryWindowLoader(load,end),signal:new AbortController().signal});
 const original=createPreEntryGuardReader({config,start,row,load:withTuringInitialization(async(_row,from,to)=>bars.filter(b=>b.openTime>=from&&b.openTime<to),row.symbol,T),signal:new AbortController().signal});
 for(let i=150;i<bars.length;i++){
   const at=T+(i+1)*F;
   expect(await batched(at)).toEqual(await original(at));
   expect((await batched(at+60000)).event).toBeUndefined();
 }
 expect(requests.length).toBeLessThan(6);expect(requests.every(r=>r.to<=end)).toBe(true);
});
it('does not let a future data failure hide an earlier native guard observation',async()=>{
 const bars=walk(350),start=T+150*F,end=T+bars.length*F,config=emptyPreEntryThreeStage(),row={id:'s',symbol:'TURING:TURING 1',timeMs:end,timeLabel:'',fallbackZone:''};
 const raw:FishReconstructionLoader=async(_row,from,to)=>{if(to>T+170*F)throw Error('后续行情缺口');return bars.filter(b=>b.openTime>=from&&b.openTime<to);};
 const reader=createPreEntryGuardReader({config,start,row,load:preEntryWindowLoader(withTuringInitialization(raw,row.symbol,T),end),signal:new AbortController().signal});
 const original=createPreEntryGuardReader({config,start,row,load:withTuringInitialization(raw,row.symbol,T),signal:new AbortController().signal});
 expect(await reader(start+F)).toEqual(await original(start+F));
});
