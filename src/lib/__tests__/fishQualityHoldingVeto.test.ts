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
// 【用户要求】2026-10-26 设了静态回撤 ≥ 5% 卖出，卖出列的静态回撤却超过 5%：改为止损单式，盘中触及按止损价成交
it('stops on a static intraminute wick at the stop price itself, so the recorded drawdown equals the threshold, and records proof',async()=>{
 const g={...group(),holdingVetoes:[makeQualityHoldingVeto('static-drawdown','>=',10)]};
 const path=loader(t=>t===T?bar(t,100,102,90,101):t===T+M?bar(t,88,10000,1,500):bar(t));
 const r=await run(g,path);
 expect(r).toMatchObject({status:'closed',endTime:T,endPrice:expect.closeTo(90),returnPct:expect.closeTo(-10),exitReading:10,exitSnapshot:{cause:{kind:'static-drawdown',threshold:10},previous:{at:T,reading:0}}});
 expect(r.reason).toContain('盘中触及止损价，按止损价卖出');
 // 回撤停在阈值；这一分钟高点与低点的先后不明，不把 102 算作持仓期间的最高
 expect(r.adversePct).toBeCloseTo(-10);expect(r.peakPct).toBeCloseTo(0);
 const evidence=buildQualityCampaignData('u',{sample,plan:g,result:r,detectors:[],observeHours:0,firstEvaluatedAt:T},'sell').campaign.comparison!.sellEvidence!;
 expect(evidence.triggerCause?.kind).toBe('static-drawdown');expect(evidence.holdingVetoes).toHaveLength(1);
 const changed=await run(g,loader(t=>t===T?bar(t,100,102,90,101):bar(t,88,999999,.001,50000)));
 expect(changed).toEqual(r);
});
it('checks dynamic drawdown from prior peaks chronologically and never assumes the current high preceded its low',async()=>{
 const g={...group(),holdingVetoes:[makeQualityHoldingVeto('dynamic-drawdown','>=',20)]};
 const path=loader(t=>t===T?bar(t,100,200,90,195):t===T+M?bar(t,195,195,150,180):bar(t,175));
 // 第一分钟 100→90 只回撤 10%（不假定 200 在 90 之前）；第二分钟从峰值 200 跌到 150，盘中触及 160 即按 160 卖出
 const r=await run(g,path);expect(r).toMatchObject({endTime:T+M,endPrice:expect.closeTo(160),exitReading:20});expect(r.drawdownPct).toBeCloseTo(20);
 const p=advanceQualityHolding({entry:100,peak:100,minimum:100,dynamic:0},bar(T,100,200,90,195));expect(p.dynamic).toBe(10); // not 55%
});
it('uses the earliest of the ordinary rule and any veto, with veto priority only on ties',async()=>{
 const base=group();base.rule!.threshold=95;
 const g={...base,holdingVetoes:[makeQualityHoldingVeto('static-drawdown','>=',20),makeQualityHoldingVeto('dynamic-drawdown','>=',30)]};
 const r=await run(g,loader(t=>t===T?bar(t,100,100,94,94):bar(t,90,90,70,70)));
 expect(r.endTime).toBe(T+M);expect(r.exitSnapshot?.cause).toBeUndefined();
 // 回撤止损在这一分钟盘中就成交，早于要等分钟收完才确认的普通规则
 const tie=await run({...g,holdingVetoes:[makeQualityHoldingVeto('static-drawdown','>=',6)]},loader(t=>t===T?bar(t,100,100,94,94):bar(t,93)));
 expect(tie.endTime).toBe(T);expect(tie.endPrice).toBeCloseTo(94);expect(tie.exitSnapshot?.cause?.kind).toBe('static-drawdown');
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
it('resumes risk paths identically across an intraminute stop',async()=>{
 const g={...group(),holdingVetoes:[makeQualityHoldingVeto('dynamic-drawdown','>=',20)]};
 const path=loader(t=>t===T?bar(t,100,150,100,150):t===T+M?bar(t,150,150,145,145):t===T+2*M?bar(t,145,145,120,130):bar(t,110));
 // 第三分钟从峰值 150 跌到 120，正好触及 20% 止损价 120：按 120 卖出；断点续算与一次算完结果一致
 const prior=await run(g,path,T+2*M);expect(prior.status).toBe('open');
 const resumed=await run(g,path,T+4*M,prior),whole=await run(g,path,T+4*M);
 expect(resumed).toEqual(whole);expect(whole).toMatchObject({status:'closed',endTime:T+2*M,endPrice:expect.closeTo(120)});expect(whole.drawdownPct).toBeCloseTo(20);
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
it('executes an opening gap immediately without waiting for the minute close or using its future extremes',async()=>{
 const g={...group(),holdingVetoes:[makeQualityHoldingVeto('static-drawdown','>=',10)]};
 const path=loader(t=>t===T?bar(t):t===T+M?bar(t,80,200,1,150):bar(t,100));
 const whole=await run(g,path,T+3*M);
 expect(whole).toMatchObject({endTime:T+M,endPrice:80,exitReading:20,peakPct:0,adversePct:expect.closeTo(-20),exitSnapshot:{atOpen:true}});
 expect(whole.reason).toContain('按当分钟开盘价卖出');
 const prior=await run(g,path,T+M);expect(prior.status).toBe('open');
 expect(await run(g,path,T+3*M,prior)).toEqual(whole);
 expect(await run(g,loader(t=>t===T?bar(t):bar(t,80,1000000,.001,999)),T+3*M)).toEqual(whole);
});

it('takes the higher stop when static and dynamic stops fall in the same minute, and catches a new high followed by a close through the trailing stop',async()=>{
 const both={...group(),holdingVetoes:[makeQualityHoldingVeto('static-drawdown','>=',5),makeQualityHoldingVeto('dynamic-drawdown','>=',10)]};
 // 先涨到 120，再一分钟里从 118 砸到 100：动态止损价 108、静态止损价 95，价格先碰到 108
 const r=await run(both,loader(t=>t===T?bar(t,100,120,100,118):t===T+M?bar(t,118,118,100,101):bar(t,101)));
 expect(r).toMatchObject({endTime:T+M,endPrice:expect.closeTo(108),exitSnapshot:{cause:{kind:'dynamic-drawdown'}}});
 expect(r.adversePct).toBeGreaterThan(-5);
 // 同一分钟先创新高 200、再收在 170（高点到收盘的先后确定）：跌破 200×90%=180 时按 180 卖出
 const trail={...group(),holdingVetoes:[makeQualityHoldingVeto('dynamic-drawdown','>=',10)]};
 const t2=await run(trail,loader(t=>t===T?bar(t,100,200,100,170):bar(t,170)));
 expect(t2).toMatchObject({endTime:T,endPrice:expect.closeTo(180)});expect(t2.drawdownPct).toBeCloseTo(10);expect(t2.peakPct).toBeCloseTo(100);
});
it('marks synced plans as stop-price vetoes so old next-open trials stay separate on the sell board', async () => {
  const { syncQualitySellDefinitions, enableQualityComparison } = await import('@/lib/fish/qualityComparison');
  const { newQualityStudy } = await import('@/lib/fish/quality');
  const { qualityVersionedRuleLabel } = await import('@/lib/fish/qualityCampaignArchive');
  const v = makeQualityHoldingVeto('static-drawdown','>=',5);
  const old = { ...group(), holdingVetoes: [v] }, synced = syncQualitySellDefinitions({ ...newQualityStudy(T), sellPlans: [old] }).sellPlans![0];
  expect(synced.vetoFill).toBe('stop');
  expect(qualitySellKey(synced)).not.toBe(qualitySellKey(old));
  expect(qualityResultKey(sample, synced, 0)).not.toBe(qualityResultKey(sample, old, 0));
  expect(qualityVersionedRuleLabel(synced)).toContain('止损价成交'); expect(qualityVersionedRuleLabel(old)).toContain('否决次分钟开盘成交');
  expect(enableQualityComparison(newQualityStudy(T)).sellPlans!.every(p => p.vetoFill === 'stop')).toBe(true);
  // 没有回撤否决的方案，版本号不受影响
  expect(qualitySellKey({ ...group(), vetoFill: 'stop' })).toBe(qualitySellKey(group()));
});
