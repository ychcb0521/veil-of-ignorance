import { expect, it, vi } from 'vitest';
import { CDA_DEF, definitionKey } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { readScreenedCda, SCREENED_CDA_STEP as STEP } from '../screenedCda';
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
