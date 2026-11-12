import {it,expect} from 'vitest';
import {ADDITION_VETO_DEFAULTS,ADDITION_VETO_KINDS,guardDistanceConfig,type AdditionEntryVetoKind} from '@/lib/fish/qualityAdditionVeto';
import {evaluateQualitySample,type QualityGroup,type QualitySample} from '@/lib/fish/quality';
import {defaultQualityAddition} from '@/lib/fish/qualityAddition';
import {definitionKey} from '@/lib/deepDig/features';
import {sample as dblBars} from '@/lib/__tests__/fixtures/dblBars';
import {computeDbl5} from '@/lib/dbl5m';
import {createPreEntryGate} from '@/lib/fish/preEntryGate';
import {emptyPreEntryConditions} from '@/lib/fish/preEntryConditions';
import {freezeQualityPlan,planVersionChanges} from '@/lib/fish/qualityPlanVersions';
import {saveQualityPlanTemplate,qualityPlanFromTemplate} from '@/lib/fish/qualityPlanTemplates';
import {newQualityStudy} from '@/lib/fish/quality';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
const M=60000,F=5*M,T=Date.UTC(2026,10,9,12);
const def={id:'shared-audit',name:'审计价格',short:'价格',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
const snapshot={featureId:def.id,definitionKey:definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:90,direction:'>' as const,average:100,cbi2:100,startAverage:100,previousAverage:99,cutoffMs:T};
const signal={id:'audit',symbol:'AUDITUSDT',timeMs:T,timeLabel:'',fallbackZone:'',fish:snapshot};
const row:QualitySample={id:'audit',enteredAt:T,basis:'signal',importedAt:T,groups:[],source:signal};
const structureBars = new Map(dblBars().map((bar,i)=>[T+(i-14)*F,{...bar,openTime:T+(i-14)*F,volume:1}]));
function fixture(kind:AdditionEntryVetoKind):FishReconstructionLoader{return async(_r,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{
 const at=from+i*p.step;let open=100,close=100,high=101,low=99;
 if(p.step===F){
  if(kind==='guard-distance')return structureBars.get(at)??{openTime:at,open,close,high,low,volume:1,takerBuyVolume:.5,DBL5_tick_size:1};
  if(kind==='volatility'){open=close=100+(Math.abs(at/F)%2);high=close+1;low=close-1;}
  if(kind==='upper-wick'&&at===T-F)high=150;
  if((kind==='lower-wick'||kind==='lower-spike')&&at===T-F)low=50;
  if((kind==='pullback'||kind==='pullback-atr')&&at===T-24*F)high=150;
  if(kind==='double-drop'){close=at<T-6*F?120:at<T-4*F?100:at<T-2*F?119:100;open=close;high=close+1;low=close-1;}
  if(kind==='stall-turn'){
   const seq=[101,102,103,104,105,106,107,108,109,110,111,112,112,112,112,111,110],k=(at-T)/F;
   const price=(n:number)=>n< -17?100:n<0?seq[n+17]:110;
   open=price(k-1);close=price(k);high=Math.max(open,close);low=Math.min(open,close);
  }
  if(kind==='pullback-new-high'&&at>=T-F){open=100;high=100;close=96;low=96;}
 }
 if(p.step===M&&at===T){
  high=106;
  if(kind==='guard-distance'){close=110;high=111;}
 }
 if(p.step===M&&at>=T+M){open=110;close=110;high=111;low=109;}
 if(kind==='fast-drop'&&p.step===M&&at===T-10*M){open=120;high=120;close=100;}
 return {openTime:at,open,close,high,low,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50};
});}
for(const lane of ['primary','attack'] as const)for(const kind of ADDITION_VETO_KINDS)it(lane+' '+kind+' vetoes the real holding addition and screening gate while preserving the saved template',async()=>{
 const rule={...ADDITION_VETO_DEFAULTS[kind],enabled:true,...(kind==='guard-distance'?{atr:.5,guardDistance:guardDistanceConfig()}:{historyHours:6})};
 const base:QualityGroup={id:'g',label:'原始资产',metric:'raw',snapshot,execution:'intrabar-1m',mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50},rule:{metric:'raw',direction:'<',threshold:0},addition:{...defaultQualityAddition(),maxRounds:1,enabled:true,source:'custom',condition:{id:'add',label:'价格',metric:'raw',direction:'>',threshold:90,enabled:true,snapshot},entryVetoes:[rule]}};
 if(lane==='attack'){const attack={source:'custom' as const,stricterPct:10,condition:base.addition!.condition,entryVetoes:[rule]};base.addition={...base.addition!,entryVetoes:[],rounds:[{...attack,condition:{...attack.condition!,threshold:1000},entryVetoes:[]}],alternativeRounds:[attack],attackFromRound:1};}
 const plan=freezeQualityPlan(base),saved=saveQualityPlanTemplate(newQualityStudy(T),plan,'资产-'+kind,T),original=JSON.stringify(saved.planTemplates),copy=qualityPlanFromTemplate({...saved.planTemplates![0],plan:saved.planTemplates![0].plan!},'独立副本');
 expect(planVersionChanges(copy)).toEqual([]);
 const load=fixture(kind),calculate=(g:QualityGroup)=>evaluateQualitySample(row,g,0,T+4*M,load,new AbortController().signal);
 const baseline=await calculate({...base,addition:{...base.addition!,entryVetoes:[],rounds:base.addition!.rounds?.map(r=>({...r,entryVetoes:[]})),alternativeRounds:base.addition!.alternativeRounds?.map(r=>({...r,entryVetoes:[]}))}});
 expect(baseline.additionFills?.length??(baseline.additionFill?1:0)).toBeGreaterThan(0);
 const actual=await calculate(copy);
 expect(actual.additionFills?.length??(actual.additionFill?1:0)).toBe(0);
 expect(actual.additionVetoes?.some(v=>v.kind===kind)).toBe(true);
 const gate=createPreEntryGate({conditions:{...emptyPreEntryConditions(),entryVetoes:[rule]},start:T,row:signal,load,signal:new AbortController().signal});
 expect((await gate(T+M)).blocked).toBeTruthy();
 expect(JSON.stringify(saved.planTemplates)).toBe(original);
});

it('uses the native closed guard and ATR with a strict one-sided threshold', async () => {
 const guardDistance=guardDistanceConfig(),rule={...ADDITION_VETO_DEFAULTS['guard-distance'],enabled:true,guardDistance};
 const load=fixture('guard-distance'),signalController=new AbortController();
 const gate=createPreEntryGate({conditions:{...emptyPreEntryConditions(),entryVetoes:[rule]},start:T,row:signal,load,signal:signalController.signal});
 const nativeBars=Array.from({length:288},(_,i)=>T-24*60*M+i*F).map(openTime=>structureBars.get(openTime)??{
  openTime,open:100,high:101,low:99,close:100,volume:1,takerBuyVolume:.5,DBL5_tick_size:1
 });
 const native=computeDbl5(nativeBars,{symbol:signal.symbol,config:guardDistance.parameters}).rows.at(-1)!;
 expect(native.darvas_5m_guard).toBeGreaterThan(0);
 expect(native.darvas_5m_guard_atr).toBeGreaterThan(0);
 const exact=native.darvas_5m_guard!+3*native.darvas_5m_guard_atr!;
 const minute=(at:number,close:number)=>({openTime:at-M,open:close,high:close,low:close,close,volume:1,takerBuyVolume:.5});
 expect((await gate(T+M,minute(T+M,exact))).blocked).toBeUndefined();
 expect((await gate(T+2*M,minute(T+2*M,exact+.01))).blocked).toMatch(/1 分钟收盘价.*防守线 v1.*ATR\(14\).*超过阈值 3 ATR/);
 expect((await gate(T+3*M,minute(T+3*M,10))).blocked).toBeUndefined();
 const unformed=createPreEntryGate({conditions:{...emptyPreEntryConditions(),entryVetoes:[rule]},start:T,row:signal,load,signal:signalController.signal,availableStart:T});
 expect(await unformed(T+M,minute(T+M,200))).toMatchObject({pending:expect.stringContaining('等待有效防守线')});
});
