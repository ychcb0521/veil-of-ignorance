import {it,expect} from 'vitest';
import {findQualityAdditionTrigger,type AdditionCandidate} from '@/lib/fish/qualityAdditionScan';
import {compileFishProgram} from '@/lib/fish/algorithm';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
import type {TradeSignal} from '@/lib/signalLibrary';
import {additionIdentity,defaultQualityAddition,validateQualityAddition} from '@/lib/fish/qualityAddition';
import {makeQualityBuyFilter} from '@/lib/fish/qualityFilters';
const M=60000,T=Date.UTC(2026,9,29);
const candidate=(id:string,interval:'1m'|'5m',threshold:number):AdditionCandidate=>({plan:compileFishProgram({id,name:id,short:id,definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval},{statistic:'raw',direction:'>',threshold,constraints:[]}),scale:1,threshold,direction:'>',metric:'raw',label:id,featureId:id});
const load:FishReconstructionLoader=async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{const at=from+i*p.step,v=p.step===5*M&&at>=T?120:100;return {openTime:at,open:v,close:v,high:v+1,low:v-1,volume:1,takerBuyVolume:0};});
const base={candidates:[candidate('primary','1m',90)],required:[candidate('required','5m',115)],row:{symbol:'TESTUSDT'} as TradeSignal,entry:T,load,signal:new AbortController().signal};
it('waits for every indicator to close after entry and never uses the forming five-minute constraint',async()=>{
 expect(await findQualityAdditionTrigger({...base,end:T+5*M})).toBeUndefined();
 expect(await findQualityAdditionTrigger({...base,end:T+6*M})).toMatchObject({at:T+5*M,conditions:[{at:T+5*M,reading:100},{at:T+5*M,reading:120}]});
});
it('does not retain an earlier indicator hit after that indicator has ceased to qualify',async()=>{
 const varying:FishReconstructionLoader=async(...args)=>{const bars=await load(...args),p=args[3];return bars.map(b=>p.step===M&&b.openTime>=T+4*M?{...b,close:0}:b);};
 expect(await findQualityAdditionTrigger({...base,end:T+6*M,load:varying})).toBeUndefined();
});
it('surfaces missing constraint bars instead of treating missing data as a passing gate',async()=>{
 const missing:FishReconstructionLoader=async(...args)=>{const bars=await load(...args);return args[3].step===5*M?bars.slice(0,-1):bars;};
 await expect(findQualityAdditionTrigger({...base,end:T+6*M,load:missing})).rejects.toThrow();
});
it('versions all conditions and gain gates while retaining old single-condition identities',()=>{
 const first=makeQualityBuyFilter('mbi:MBI','>',.8),second=makeQualityBuyFilter('mbi:MBI','<',1.5),rule={...defaultQualityAddition(),enabled:true,source:'custom' as const,condition:first};
 expect(additionIdentity(rule)).toEqual(additionIdentity({...rule,conditions:[first]}));expect(additionIdentity(rule)).not.toEqual(additionIdentity({...rule,conditions:[first,second]}));expect(additionIdentity(rule)).not.toEqual(additionIdentity({...rule,minGainPct:5}));
 expect(additionIdentity({...rule,minGainPct:5})).not.toEqual(additionIdentity({...rule,minGainPct:6}));
 for(const minGainPct of [-1,NaN,Infinity])expect(()=>validateQualityAddition({...rule,minGainPct})).toThrow('涨幅门槛');expect(()=>validateQualityAddition({...rule,minGainPct:0})).not.toThrow();
});
