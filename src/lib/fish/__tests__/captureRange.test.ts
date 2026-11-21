import { expect, it } from 'vitest';
import { CBI2_DEF } from '@/lib/deepDig/features';
import { compileFishPreference } from '../scanPlan';
import { classifyFishProgram, evaluateFishProgram } from '../algorithm';
import { captureLimit, captureLimitSubset } from '../thresholdRange';
import { libraryCondition } from '../libraryConditions';

const def = { ...CBI2_DEF, id:'range-test', formula:'read = C\nread', scale:10 };
const planFor = (threshold:string) => compileFishPreference(def,{threshold,direction:'>',constraints:[]});

it('uses displayed units and detects a new episode entering from either boundary', () => {
  const plan = planFor('[10,20]');
  const bars = Array.from({length:plan.N}, (_,i) => ({
    openTime:i*plan.step, open:3, high:4, low:0, close:3, volume:1,
    quoteVolume:100, takerBuyQuoteVolume:50, takerBuyVolume:null,
  }));
  [0.5,1,1.5,2,2.5,2,1].forEach((close,i)=>{bars[bars.length-7+i].close=close;});
  const values=evaluateFishProgram(bars,plan);
  expect(Array.from(values.main.slice(-7))).toEqual([0,1,1,1,0,1,1]);
  const record=classifyFishProgram('AAA',bars,values,bars.length*plan.step,plan).signal!;
  expect(record.timeMs).toBe(bars.at(-2)!.openTime+plan.step);
  expect(record.fish?.range).toEqual({min:10,max:20});
  expect(libraryCondition(record.fish!).rule).toBe('[10, 20]');
  expect(libraryCondition({algorithmKey:plan.algorithmKey}).rule).toBe('[10, 20]');
  expect(planFor('[10,30]').algorithmKey).not.toBe(plan.algorithmKey);
  expect(planFor('10').algorithmKey).not.toBe(plan.algorithmKey);
});
it('validates one-sided, equal, negative and invalid bounds and retains strict legacy endpoints',()=>{
  for(const value of ['[-3,0]','[,0]','[0,]','[0,0]']) expect(()=>planFor(value)).not.toThrow();
  for(const value of ['[,]','[1,-1]','[0,Infinity]','[x,0]']) expect(()=>planFor(value)).toThrow();
  expect(captureLimit('[-3,-1]','<')).toMatchObject({direction:'<',threshold:-1,range:{min:-3,max:-1}});
  const subset=(base:string,target:string)=>captureLimitSubset(captureLimit(base,'>'),captureLimit(target,'>'));
  expect(subset('10','[10,20]')).toBe(false);
  expect(subset('9','[10,20]')).toBe(true);
  expect(subset('[10,20]','[15,20]')).toBe(true);
  expect(subset('[10,20]','[15,21]')).toBe(false);
  expect(subset('[10,20]','[15,]')).toBe(false);
});
