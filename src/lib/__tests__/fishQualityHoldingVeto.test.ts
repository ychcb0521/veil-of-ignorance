import { expect,it } from 'vitest';
import { definitionKey, STATE_DEF } from '@/lib/deepDig/features';
import { evaluateQualitySample, qualityResultKey, type QualityGroup, type QualitySample } from '@/lib/fish/quality';
import { makeQualityHoldingVeto, makeQualityBuyFilter, qualityFilterChoices } from '@/lib/fish/qualityFilters';
import { advanceQualityHolding, holdingVetoIdentity } from '@/lib/fish/qualityVeto';
import { qualitySellKey } from '@/lib/fish/qualityCampaignArchive';
import { buildQualityCampaignData } from '@/lib/fish/qualityCampaigns';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';
const M=60000,T=Date.UTC(2026,9,20),signal=()=>new AbortController().signal;
const sample:QualitySample={id:'a',enteredAt:T,basis:'signal',importedAt:T,groups:[],source:{id:'a',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:''}};
const def={id:'custom',name:'自定义价格',short:'价格',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'5m' as const};
const group=():QualityGroup=>({id:'g',label:'主规则',metric:'raw',execution:'intrabar-1m',snapshot:{featureId:'custom',definitionKey:definitionKey(def),statistic:'raw',interval:'5m',scale:1,threshold:0,direction:'<',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T},rule:{metric:'raw',direction:'<',threshold:0}});
const bar=(t:number,open=100,high=open,low=open,close=open):ResearchBar=>({openTime:t,open,high,low,close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50});
const loader=(f:(t:number)=>ResearchBar):FishReconstructionLoader=>async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?f(a+i*M):bar(a+i*p.step));
const run=(g:QualityGroup,l:FishReconstructionLoader,now=T+8*M,prior?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>evaluateQualitySample(sample,g,0,now,l,signal(),prior);
it('stops on a static intraminute wick even if the minute closes above the threshold, uses only next open, and records proof',async()=>{
 const g={...group(),holdingVetoes:[makeQualityHoldingVeto('static-drawdown','>=',10)]};
 const path=loader(t=>t===T?bar(t,100,102,90,101):t===T+M?bar(t,88,10000,1,500):bar(t));
 const r=await run(g,path);
 expect(r).toMatchObject({status:'closed',endTime:T+M,endPrice:88,returnPct:expect.closeTo(-12),exitReading:10,exitSnapshot:{cause:{kind:'static-drawdown',threshold:10},previous:{at:T,reading:0}}});
 expect(r.adversePct).toBeCloseTo(-12);expect(r.peakPct).toBeCloseTo(2);
 const evidence=buildQualityCampaignData('u',{sample,plan:g,result:r,detectors:[],observeHours:0,firstEvaluatedAt:T},'sell').campaign.comparison!.sellEvidence!;
 expect(evidence.triggerCause?.kind).toBe('static-drawdown');expect(evidence.holdingVetoes).toHaveLength(1);
 const changed=await run(g,loader(t=>t===T?bar(t,100,102,90,101):bar(t,88,999999,.001,50000)));
 expect(changed).toEqual(r);
});
it('checks dynamic drawdown from prior peaks chronologically and never assumes the current high preceded its low',async()=>{
 const g={...group(),holdingVetoes:[makeQualityHoldingVeto('dynamic-drawdown','>=',20)]};
 const path=loader(t=>t===T?bar(t,100,200,90,195):t===T+M?bar(t,195,195,150,180):bar(t,175));
 const r=await run(g,path);expect(r).toMatchObject({endTime:T+2*M,endPrice:175,exitReading:25});expect(r.drawdownPct).toBeCloseTo(25);
 const p=advanceQualityHolding({entry:100,peak:100,minimum:100,dynamic:0},bar(T,100,200,90,195));expect(p.dynamic).toBe(10); // not 55%
});
it('uses the earliest of the ordinary rule and any veto, with veto priority only on ties',async()=>{
 const base=group();base.rule!.threshold=95;
 const g={...base,holdingVetoes:[makeQualityHoldingVeto('static-drawdown','>=',20),makeQualityHoldingVeto('dynamic-drawdown','>=',30)]};
 const r=await run(g,loader(t=>t===T?bar(t,100,100,94,94):bar(t,90,90,70,70)));
 expect(r.endTime).toBe(T+M);expect(r.exitSnapshot?.cause).toBeUndefined();
 const tie=await run({...g,holdingVetoes:[makeQualityHoldingVeto('static-drawdown','>=',6)]},loader(t=>t===T?bar(t,100,100,94,94):bar(t,93)));
 expect(tie.endTime).toBe(T+M);expect(tie.exitSnapshot?.cause?.kind).toBe('static-drawdown');
});
it('supports custom account indicator vetoes and inclusive/exclusive thresholds',async()=>{
 const g={...group(),holdingVetoes:[makeQualityHoldingVeto('custom:raw','<=',95,true,[def])]};
 const r=await run(g,loader(t=>t===T?bar(t,100,100,95,95):bar(t,99)));
 expect(r).toMatchObject({endTime:T+M,exitReading:95,exitSnapshot:{cause:{kind:'indicator',direction:'<='}}});
 expect((await run({...g,holdingVetoes:[{...g.holdingVetoes[0],direction:'<' as const}]},loader(t=>bar(t,100,100,95,95)))).status).toBe('open');
});
it('does not apply disabled conditions and rejects invalid enabled risk thresholds',async()=>{
 const v=makeQualityHoldingVeto('static-drawdown','>=',10,false),g={...group(),holdingVetoes:[v]};
 expect((await run(g,loader(t=>bar(t,100,100,50,100)))).status).toBe('open');
 for(const threshold of [0,-1,101,NaN])expect(()=>makeQualityHoldingVeto('static-drawdown','>=',threshold)).toThrow();
 expect((await run({...g,holdingVetoes:[{...v,enabled:true,threshold:NaN}]},loader(t=>bar(t)))).status).toBe('error');
});
it('resumes risk paths identically, including a last-minute pending trigger and a gap at execution',async()=>{
 const g={...group(),holdingVetoes:[makeQualityHoldingVeto('dynamic-drawdown','>=',20)]};
 const path=loader(t=>t===T?bar(t,100,150,100,150):t===T+M?bar(t,150,150,145,145):t===T+2*M?bar(t,145,145,120,130):bar(t,110));
 const prior=await run(g,path,T+2*M),pending=await run(g,path,T+3*M,prior);
 expect(pending.status).toBe('open');expect(pending.pendingExit?.cause?.kind).toBe('dynamic-drawdown');
 const resumed=await run(g,path,T+4*M,pending),whole=await run(g,path,T+4*M);
 expect(resumed).toEqual(whole);expect(whole.endPrice).toBe(110);expect(whole.drawdownPct).toBeCloseTo((150-110)/150*100);
});
it('does not use pre-entry extremes and does not cross missing samples',async()=>{
 const s={...sample,enteredAt:T+2*M},g={...group(),holdingVetoes:[makeQualityHoldingVeto('static-drawdown','>=',10)]};
 const path=loader(t=>t<T+2*M?bar(t,100,1000,1,100):bar(t));
 expect((await evaluateQualitySample(s,g,0,T+5*M,path,signal())).status).toBe('open');
 const missing:FishReconstructionLoader=async(...a)=>(await path(...a)).filter(b=>a[3].step!==M||b.openTime!==T+3*M);
 expect((await run(g,missing)).status).toBe('error');
});
it('versions veto experiments while preserving old results and ignores disabled conditions and condition order',()=>{
 const g=group(),v=makeQualityHoldingVeto('static-drawdown','>=',10),d=makeQualityHoldingVeto('dynamic-drawdown','>=',20);
 expect(qualityResultKey(sample,g,0)).toBe(qualityResultKey(sample,{...g,holdingVetoes:[{...v,enabled:false}]},0));
 expect(qualityResultKey(sample,g,0)).not.toBe(qualityResultKey(sample,{...g,holdingVetoes:[v]},0));
 expect(qualitySellKey(g)).not.toBe(qualitySellKey({...g,holdingVetoes:[v]}));
 expect(holdingVetoIdentity([v,d])).toEqual(holdingVetoIdentity([d,v]));
 expect(qualityResultKey(sample,{...g,holdingVetoes:[v]},0)).not.toBe(qualityResultKey(sample,{...g,holdingVetoes:[{...v,threshold:11}]},0));
});
it('offers account-defined variables and freezes the account formula rather than a built-in fallback',()=>{
 const changed={...STATE_DEF,formula:'state = C * 2',interval:'5m' as const};
 expect(qualityFilterChoices([def]).map(c=>c.key)).toContain('custom:raw');
 expect(makeQualityBuyFilter('state:state','>',.7,true,[changed]).snapshot.definitionKey).toContain('state = C * 2');
 expect(makeQualityHoldingVeto('custom:raw','>=',99,true,[def]).snapshot?.definitionKey).toContain('raw = C');
});
