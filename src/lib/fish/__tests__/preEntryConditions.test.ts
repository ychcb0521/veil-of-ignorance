import { expect, it, vi } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { collectPreEntryMonitor, PRE_ENTRY_ZERO_TRADE_VERSION, type PreEntryRecord, type PreEntryRound } from '../preEntryMonitor';
import { emptyPreEntryConditions, PRE_ENTRY_CONDITIONS_VERSION, validatePreEntryConditions } from '../preEntryConditions';
import { freezeQualityPlan, planVersionChanges } from '../qualityPlanVersions';
import type { QualityGroup } from '../quality';
import type { QualityHoldingVeto } from '../qualityVeto';
import type { FishReconstructionLoader } from '../reconstruction';
import { withTuringInitialization } from '../qualityInitialization';

const M=60000,T=Date.UTC(2026,2,29,5);
const plan=():QualityGroup=>({id:'entry',label:'入选',metric:'raw',execution:'intrabar-1m',rule:{metric:'raw',direction:'>',threshold:105},preEntryConditions:emptyPreEntryConditions(),
  snapshot:{featureId:'price',definitionKey:definitionKey({formula:'raw=C',positive:'1',control:'0',interval:'5m'}),statistic:'raw',interval:'5m',scale:1,threshold:0,cutoffMs:T,average:0,cbi2:0,startAverage:0,previousAverage:0}});
const sample={id:'sample',enteredAt:T,basis:'signal' as const,importedAt:T,groups:[],source:{id:'source',symbol:'TURING:TURING 1',timeMs:T,timeLabel:'',fallbackZone:''}};
const priceVeto=(kind:QualityHoldingVeto['kind'],threshold=5):QualityHoldingVeto=>({id:kind,label:kind,kind,direction:'>=',threshold,enabled:true});
const loader=(closes:number[],zeroFirst=false):FishReconstructionLoader=>async(_s,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{
  const openTime=from+i*p.step,k=(openTime-T)/M,close=p.step===M&&k>=0?closes[k]??closes.at(-1)!:100,open=p.step===M&&k>0?closes[k-1]??closes.at(-1)!:100;
  const volume=zeroFirst&&k===0?0:1;
  return {openTime,open,close,high:Math.max(open,close),low:Math.min(open,close),volume,quoteVolume:volume*100,takerBuyVolume:volume/2,takerBuyQuoteVolume:volume*50};
});
async function run(p:QualityGroup,load=loader([110,111,112]),engine:PreEntryRound['engine']=PRE_ENTRY_CONDITIONS_VERSION,old?:PreEntryRecord,aborter=new AbortController(),onRecord?:(r:PreEntryRecord)=>void){
  let record:PreEntryRecord=old??{id:'r',roundId:'round',planId:p.id,sample,status:'queued',startTime:T,cursor:T,readings:[],updatedAt:T};
  try {
    await collectPreEntryMonitor({round:{id:'round',engine,plans:[freezeQualityPlan(p)],filters:[],hours:0,state:'running',startedAt:T,updatedAt:T},records:[record],onRecord:r=>{record=r;onRecord?.(r);}},load,T+4*M,aborter.signal,vi.fn());
  } catch(error) { if(!aborter.signal.aborted)throw error; }
  return record;
}
it('a same-minute indicator veto wins; a later clear minute may be admitted',async()=>{
  const p=plan();p.preEntryConditions!.sellVetoes=[{...priceVeto('indicator',111),label:'价格排除',direction:'<',metric:'raw',snapshot:p.snapshot}];
  const r=await run(p);
  expect(r).toMatchObject({status:'matched',matchedAt:T+2*M,lastVeto:{at:T+M}});
  expect(r.readings).toContainEqual({key:'sellVetoes:indicator',value:111,at:T+2*M});
});
it('combines separate sell/hard exclusions with AND admission rather than treating either as a buy signal',async()=>{
  const p=plan();p.preEntryConditions!.sellVetoes=[{...priceVeto('indicator',111),direction:'<',metric:'raw',snapshot:p.snapshot}];
  p.preEntryConditions!.hardVetoes=[{...priceVeto('indicator',111),direction:'>=',metric:'raw',snapshot:p.snapshot}];
  expect(await run(p)).toMatchObject({status:'unmatched'});
});
it('a rolling drop blocks only while its rolling condition holds',async()=>{
  const p=plan();p.rule!.threshold=80;p.preEntryConditions!.hardVetoes=[priceVeto('drop-1m')];
  expect(await run(p,loader([90,100,100,100]))).toMatchObject({status:'matched',matchedAt:T+2*M,lastVeto:{at:T+M,count:1}});
});
it.each(['static-drawdown','dynamic-drawdown'] as const)('keeps the original maximum %s observation even after recovery',async kind=>{
  const p=plan();p.rule!.threshold=80;p.preEntryConditions!.hardVetoes=[priceVeto(kind)];
  expect(await run(p,loader([90,100,110,120]))).toMatchObject({status:'unmatched',lastVeto:{at:T+4*M}});
});
it('keeps the historical fast-drop veto active for the remainder of this round',async()=>{
  const p=plan();p.rule!.threshold=80;p.preEntryConditions!.entryVetoes=[{kind:'fast-drop',enabled:true,windows:[{minutes:1,pct:5}]}];
  expect(await run(p,loader([90,100,110,120]))).toMatchObject({status:'unmatched'});
});
it('leaves old v3 execution unchanged even if a copied plan carries additional settings',async()=>{
  const p=plan();p.rule!.threshold=80;p.preEntryConditions!.hardVetoes=[priceVeto('static-drawdown')];
  const original=structuredClone(p);
  expect(await run(p,loader([90,100,110,120]),PRE_ENTRY_ZERO_TRADE_VERSION)).toMatchObject({status:'matched',matchedAt:T});
  expect(p).toEqual(original);
});
it('retains zero-trade waiting and rejects a later real data gap',async()=>{
  const p=plan();p.preEntryConditions!.hardVetoes=[priceVeto('drop-1m',50)];
  expect(await run(p,loader([110,111,112],true))).toMatchObject({status:'matched',matchedAt:T+2*M,zeroTradeWait:{count:1}});
  p.rule!.threshold=111;
  const read=loader([110,111,112]);
  const r=await run(p,async(...args)=>(await read(...args)).filter(b=>b.openTime!==T+M));
  expect(r.status).toBe('error');expect(r.matchedAt).toBeUndefined();
});
it('rebuilds the same veto path on resume without duplicating its recorded observations',async()=>{
  const clock=vi.spyOn(performance,'now');let time=0;clock.mockImplementation(()=>time+=200);
  try {
    const p=plan();p.rule!.threshold=80;p.preEntryConditions!.hardVetoes=[priceVeto('drop-1m')];
    const load=loader([90,100,110]),aborter=new AbortController();
    const paused=await run(p,load,PRE_ENTRY_CONDITIONS_VERSION,undefined,aborter,r=>{if(r.status==='scanning'&&r.cursor===T+M)aborter.abort();});
    expect(paused.status).toBe('paused');
    const resumed=await run(p,load,PRE_ENTRY_CONDITIONS_VERSION,paused);
    const whole=await run(p,load);
    expect(resumed.matchedAt).toBe(whole.matchedAt);expect(resumed.lastVeto).toEqual(whole.lastVeto);
  } finally {clock.mockRestore();}
});
it('freezes the additional conditions and rejects position-only or unknown versions',()=>{
  const p=plan();p.preEntryConditions!.hardVetoes=[priceVeto('drop-5m',10)];
  const frozen=freezeQualityPlan(p);
  expect(planVersionChanges(frozen)).toEqual([]);
  frozen.preEntryConditions!.hardVetoes[0].threshold=11;
  expect(planVersionChanges(frozen).map(c=>c.key)).toContain('pre-entry-conditions');
  expect(()=>validatePreEntryConditions({...emptyPreEntryConditions(),hardVetoes:[priceVeto('payoff-ratio',100)]})).toThrow('没有实际持仓');
  expect(()=>validatePreEntryConditions({...emptyPreEntryConditions(),version:'unknown' as never})).toThrow('版本不可用');
});

it('waits for an initializing exclusion indicator instead of treating unknown as no veto',async()=>{
  const p=plan();p.rule!.threshold=80;
  p.preEntryConditions!.sellVetoes=[{...priceVeto('indicator',200),direction:'>',metric:'raw',snapshot:{...p.snapshot,definitionKey:definitionKey({formula:'raw=prev(C)',positive:'1',control:'0',interval:'5m'})}}];
  const record=await run(p,withTuringInitialization(loader([110,111,112]),sample.source.symbol,T));
  expect(record.status).toBe('unmatched');expect(record.matchedAt).toBeUndefined();
});
