import {it,expect} from 'vitest';
import {ADDITION_VETO_DEFAULTS,ADDITION_VETO_KINDS,ADDITION_VETO_LABELS,type AdditionEntryVetoKind} from '@/lib/fish/qualityAdditionVeto';
import {evaluateQualitySample,type QualityGroup,type QualitySample} from '@/lib/fish/quality';
import {defaultQualityAddition} from '@/lib/fish/qualityAddition';
import {definitionKey} from '@/lib/deepDig/features';
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
function fixture(kind:AdditionEntryVetoKind):FishReconstructionLoader{return async(_r,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{
 const at=from+i*p.step;let open=100,close=100,high=101,low=99;
 if(p.step===F){
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
 if(p.step===M&&at===T)high=106;
 if(p.step===M&&at>=T+M){open=110;close=110;high=111;low=109;}
 if(kind==='fast-drop'&&p.step===M&&at===T-10*M){open=120;high=120;close=100;}
 return {openTime:at,open,close,high,low,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50};
});}
for(const lane of ['primary','attack'] as const)for(const kind of ADDITION_VETO_KINDS)it(lane+' '+kind+' vetoes the real holding addition and screening gate while preserving the saved template',async()=>{
 const rule={...ADDITION_VETO_DEFAULTS[kind],enabled:true,historyHours:6};
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
