import { expect, it } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { createQualityAdvantageReader, QUALITY_ADVANTAGE_VERSION, type QualityAdvantageRule } from '../qualityAdvantage';
import { defaultStructureAddition } from '../qualityAdditionStructure';
import type { FishReconstructionLoader } from '../reconstruction';
import type { FishSnapshot } from '../algorithm';
import type { TradeSignal } from '@/lib/signalLibrary';
const STEP=300000,T=Date.UTC(2026,9,29);
const def={id:'state',name:'状态',short:'状态',definition:'',formula:'state = C / 100',interval:'5m' as const,scale:1,unit:'',positive:'1',control:'0'};
const snapshot={featureId:'state',definitionKey:definitionKey(def),statistic:'state',interval:'5m',scale:1} as FishSnapshot;
const rule:QualityAdvantageRule={version:QUALITY_ADVANTAGE_VERSION,state:{snapshot,metric:'state'},structure:defaultStructureAddition(),screenWeak:true,beforeFirst:true,afterAddition:true,confirmations:2};
it('reads only closed bars and remains causal when a later soft scan precedes an earlier addition query',async()=>{
 let decision=T+4*STEP;
 const load:FishReconstructionLoader=async(_row,from,to,p)=>{
  expect(to).toBeLessThanOrEqual(Math.floor(decision/STEP)*STEP);
  return Array.from({length:(to-from)/p.step},(_,i)=>{const openTime=from+i*p.step,close=openTime<T?70:60-(openTime-T)/STEP*10;return {openTime,open:close,close,high:close+1,low:close-1,volume:10,takerBuyVolume:5};});
 };
 const read=createQualityAdvantageReader(rule,{row:{symbol:'BTCUSDT'} as TradeSignal,entry:T,end:T+8*STEP,load,signal:new AbortController().signal});
 const late=await read(decision);expect(late.grade).toBe('W');expect(late.closes).toEqual([50,40,30]);
 decision=T+2*STEP;
 const early=await read(decision);expect(early.grade).toBe('W');expect(early.closes).toEqual([70,60,50]);expect(early.states).toEqual([.7,.6,.5]);
 expect(await read(decision+60000)).toEqual(early);
});
it('falls back on missing auxiliary transport but propagates cancellation',async()=>{
 const controller=new AbortController();
 const read=createQualityAdvantageReader(rule,{row:{symbol:'BTCUSDT'} as TradeSignal,entry:T,end:T+5*STEP,load:async()=>{throw Error('缺辅助行情');},signal:controller.signal});
 expect(await read(T+STEP)).toMatchObject({grade:'U',reason:'缺辅助行情'});
 controller.abort();await expect(read(T+2*STEP)).rejects.toThrow('已暂停');
});
