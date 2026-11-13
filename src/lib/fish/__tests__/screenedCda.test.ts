import { expect, it, vi } from 'vitest';
import { CDA_DEF, definitionKey } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { readScreenedCda, SCREENED_CDA_GUARD_RULE, SCREENED_CDA_STEP as STEP } from '../screenedCda';
import type { FishReconstructionLoader } from '../reconstruction';

it('reads only closed 5m CDA raw values, skips exactly -10 and freezes the first qualifying value', async () => {
  const start = Date.UTC(2026, 10, 12), source = {id:'one',symbol:'TESTUSDT',timeMs:start,timeLabel:'',fallbackZone:''};
  const definition = {...CDA_DEF, interval:'5m' as const, formula:'CDA = C - 100\navg_CDA = avg(CDA, 1)'};
  const snapshot = {featureId:'cda',definitionKey:definitionKey(definition),interval:'5m' as const,threshold:-10,
    cutoffMs:0,average:0,cbi2:0,startAverage:0,previousAverage:0};
  const load: FishReconstructionLoader = vi.fn(async (row, from, cut, plan) => {
    expect(row.timeMs).toBe(cut);
    expect(plan.step).toBe(STEP);
    return Array.from({length:(cut-from)/STEP},(_,i):ResearchBar => {
      const openTime=from+i*STEP, close=openTime<start?100:openTime===start?90:openTime===start+STEP?89.5:70;
      return {openTime,open:close,high:close,low:close,close,volume:1,takerBuyVolume:null};
    });
  });
  const signal = new AbortController().signal;
  expect(await readScreenedCda(source,start,start+STEP-1,snapshot,load,signal)).toEqual({through:start});
  expect(load).not.toHaveBeenCalled();
  expect(await readScreenedCda(source,start,start+2*STEP-1,snapshot,load,signal)).toEqual({through:start+STEP});
  expect(await readScreenedCda(source,start,start+3*STEP,snapshot,load,signal)).toEqual({
    through:start+2*STEP,trigger:{at:start+2*STEP,value:-10.5,closePrice:89.5},
  });
});

it.each(['cda-first','guard-first','same-close'] as const)('sells at the first native confirmation, including after reload: %s', async order => {
  const T = Date.UTC(2026, 10, 12);
  const source = { id: 'dual', symbol: 'TESTUSDT', timeMs: T, timeLabel: '', fallbackZone: '' };
  const definition = { ...CDA_DEF, interval: '5m' as const, formula: 'CDA = B - 50\navg_CDA = avg(CDA, 1)' };
  const snapshot = { featureId: 'cda', definitionKey: definitionKey(definition), interval: '5m' as const, threshold: -10,
    cutoffMs: 0, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0 };
  const structure = [
    ...Array.from({length:16}, () => [106,102,104]),
    [114,106,111],[112,104,107],[112,105,109],[111,106,109],[113,107,110],
    [113,109,112],[113,105,110],[113,108,111],[121,112,118],[119,114,117],
    [119,115,117],[119,116,118],[119,115,117],[116,90,93],[116,90,93],
  ];
  const cdaIndex = order === 'cda-first' ? 25 : order === 'guard-first' ? 33 : 30;
  const load: FishReconstructionLoader = async (_row, from, to) =>
    Array.from({length:(to-from)/STEP}, (_, i) => {
      const openTime = from + i*STEP, index = (openTime-T)/STEP;
      const [high,low,close] = structure[index] ?? (index<0 ? [106,102,104] : [116,91,94]);
      return {openTime,open:close,high,low,close,volume:1,takerBuyVolume:.5,quoteVolume:100,
        takerBuyQuoteVolume:index===cdaIndex?38:index===24?40:46,DBL5_tick_size:1};
    });
  const signal = new AbortController().signal, observeAfter = T+23*STEP;
  const soldAt = T+(Math.min(cdaIndex,30)+1)*STEP;
  const beforeSale = soldAt - STEP;
  const partial = await readScreenedCda(source,observeAfter,beforeSale,snapshot,load,signal,{observeAfter});
  expect(partial.trigger).toBeUndefined();
  const restored = JSON.parse(JSON.stringify(partial.progress));
  const result = await readScreenedCda(source,partial.through,soldAt,snapshot,load,signal,{observeAfter,progress:restored});
  expect(result).toMatchObject({through:soldAt,trigger:{at:soldAt,value:order==='guard-first'?-4:-12,closePrice:order==='cda-first'?117:93,
    evidence:{version:SCREENED_CDA_GUARD_RULE,reason:order==='cda-first'?'cda':order==='guard-first'?'guard':'both'}}});
});

it.each(['mirror-then-stop','same-minute-stop','gap-below-stop'] as const)('settles the screened price rules in order: %s', async scenario => {
  const T = Date.UTC(2026, 10, 13);
  const M = 60_000;
  const source = { id:'price-risk',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:'' };
  const definition = { ...CDA_DEF, interval:'5m' as const, formula:'CDA = C - C\\navg_CDA = avg(CDA, 1)' };
  const snapshot = { featureId:'cda',definitionKey:definitionKey(definition),interval:'5m' as const,threshold:-10,
    cutoffMs:0,average:0,cbi2:0,startAverage:0,previousAverage:0 };
  const load: FishReconstructionLoader = async (_row, from, end, plan) =>
    Array.from({length:(end-from)/plan.step}, (_, i) => {
      const openTime=from+i*plan.step;
      const first=plan.step===M && openTime===T;
      const second=plan.step===M && openTime===T+M;
      const open=second&&scenario==='gap-below-stop'?91:100;
      const high=first?102:101;
      const low=first&&scenario==='same-minute-stop'?94:second?90:99;
      return {openTime,open,high,low,close:100,volume:1,takerBuyVolume:.5,DBL5_tick_size:1};
    });
  const signal = new AbortController().signal;
  const {readScreenedPositionExit}=await import('../screenedPriceExit');
  const {buildInstantCampaignData,freezeInstantCampaign}=await import('../instantCampaign');
  const {computeCampaignRealizedPnl}=await import('@/lib/campaignRealizedPnl');
  const {buildCampaignCardData}=await import('@/lib/campaignListCache');
  const task={id:'fish-instant-risk',source,after:T,observeAfter:T};
  const first=await readScreenedPositionExit(task,T+M,snapshot,load,signal);
  if(scenario==='same-minute-stop'){
    expect(first.trigger).toMatchObject({closePrice:95,evidence:{reason:'static-stop'}});
    expect(first.trigger?.mirror).toBeUndefined();
    return;
  }
  expect(first.trigger).toBeUndefined();
  expect(first.risk?.mirror).toMatchObject({price:102,fraction:.715});
  const result=await readScreenedPositionExit({...task,risk:JSON.parse(JSON.stringify(first.risk))},T+2*M,snapshot,load,signal);
  const exit=scenario==='gap-below-stop'?91:95;
  expect(result.trigger).toMatchObject({at:T+M,closePrice:exit,mirror:{price:102,fraction:.715},evidence:{reason:'static-stop'}});
  const frozen=await freezeInstantCampaign({id:task.id,recordId:'risk',source,buyAt:T,sell:result.trigger!,detectors:[]},load,signal);
  expect(frozen.staticDrawdown).toBeCloseTo(100-exit);
  const data=buildInstantCampaignData('fixture',frozen);
  const {campaign,legs,tradeRecords}=data;
  expect(tradeRecords).toHaveLength(2);
  expect(tradeRecords[0].quantity).toBeCloseTo(1.43);
  expect(tradeRecords[1].quantity).toBeCloseTo(.57);
  const pnl=1.43*2+.57*(exit-100);
  expect(campaign.final_realized_pnl).toBeCloseTo(pnl);
  expect(computeCampaignRealizedPnl(campaign,legs,tradeRecords,{}).total).toBeCloseTo(pnl);
  const card=buildCampaignCardData(data);
  expect(card.initialExpectedMaxLoss).toBe(10);
  expect(card.profitCaptureRatio).toBeCloseTo(pnl/10*100);
});
