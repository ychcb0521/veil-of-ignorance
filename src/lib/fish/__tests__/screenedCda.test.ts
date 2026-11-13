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
