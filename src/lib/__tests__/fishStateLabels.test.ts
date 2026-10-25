import { expect, it } from 'vitest';
import { fishMetricLabel, fishSourceLabel, fishCaughtBy, fishAlgorithmShort, collapseVisibleFish } from '@/lib/fish/records';
import { composeFishEmail } from '@/lib/fish/notify';
import { definitionKey, STATE_DEF } from '@/lib/deepDig/features';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { FishSnapshot } from '@/lib/fish/algorithm';
const snapshot = (statistic: string): FishSnapshot => ({featureId:'state',featureShort:'S',statistic,average:.71,cbi2:.71,startAverage:.71,previousAverage:.69,cutoffMs:1,threshold:.7});
const fish = (statistic: string): TradeSignal => ({id:statistic,symbol:'SUSDT',timeMs:1,timeLabel:'',fallbackZone:'',fish:snapshot(statistic)});
it('keeps raw S and average S separate in saved fish, filters and email sources', () => {
  const raw=fish('state'), avg=fish('avg_state_2'), before=JSON.stringify([raw,avg]);
  expect(fishCaughtBy(raw)).toEqual(['S 原值']);
  expect(fishCaughtBy(avg)).toEqual(['S·avg₂']);
  expect(fishAlgorithmShort(raw)).toBe('S 原值');
  expect(collapseVisibleFish([raw,avg])).toHaveLength(2);
  const both={...raw,fish:{...raw.fish!,algorithms:[raw.fish!,avg.fish!],combination:'or' as const,hitAlgorithms:[1,2]}};
  expect(fishCaughtBy(both)).toEqual(['S 原值','S·avg₂']);
  expect(fishAlgorithmShort(both)).toBe('S 原值 ∪ S·avg₂');
  expect(fishCaughtBy({...both,fish:{...both.fish,hitAlgorithms:[2]}})).toEqual(['S·avg₂']);
  expect(fishCaughtBy({...both,fish:{...both.fish,combination:'and'}})).toEqual(['S 原值','S·avg₂']);
  const email=composeFishEmail([both]);
  for(const body of [email.message,email.message_html]){
    expect(body).toContain('S 原值');expect(body).toContain('S·avg₂');
    expect(body).not.toMatch(/https?:|href=|渔|无知之幕|veil-of-ignorance/i);
  }
  expect(JSON.stringify([raw,avg])).toBe(before);
});
it('identifies legacy S only from its saved series, formula or external average', () => {
  expect(fishSourceLabel({featureId:'state',statistic:'结果',definitionKey:definitionKey({...STATE_DEF,formula:'state = C\navg_state_2 = avg(state,24)'})})).toBe('S·avg₂');
  expect(fishSourceLabel({featureId:'state',statistic:'结果',definitionKey:definitionKey({...STATE_DEF,formula:'state = C'})})).toBe('S 原值');
  expect(fishSourceLabel({featureShort:'S',algorithmKey:'state|avg_state_2|=|>|0.6|x'})).toBe('S·avg₂');
  expect(fishSourceLabel({featureShort:'S',statistic:'state',H:24})).toBe('S·avg(24h)');
  expect(fishSourceLabel({featureId:'state',statistic:'结果',definitionKey:'broken'})).toBe('S（序列不详）');
  expect(fishSourceLabel({featureId:'state',statistic:'momentum'})).toBe('S [momentum]');
  expect(fishSourceLabel({featureId:'state2',featureShort:'S2',statistic:'state'})).toBe('S2 [state]');
  expect(fishSourceLabel({featureId:'custom',featureShort:'S',statistic:'state'})).toBe('S [state]');
});

it('process metrics preserve exact series names, saved result formulas and legacy external averaging',()=>{
 const def={...STATE_DEF,formula:'state = C\navg_state = avg(state,24)\navg_state_2 = avg(avg_state,24)'};
 const saved=definitionKey(def);
 expect(fishMetricLabel({featureId:'state',statistic:'state'})).toBe('state（原始值）');
 for(const statistic of ['avg_state','avg_state_2'])expect(fishMetricLabel({statistic,definitionKey:saved})).toBe(statistic);
 expect(fishMetricLabel({statistic:'结果',definitionKey:saved})).toBe('avg_state_2');
 expect(fishMetricLabel({algorithmKey:'cba|avg_CBA_2|=|>|8|x'})).toBe('avg_CBA_2');
 expect(fishMetricLabel({statistic:'state',H:24})).toBe('avg(state, 24h)（旧版外层均值）');
 expect(fishMetricLabel({statistic:'结果',definitionKey:'broken'})).toBe('结果（指标未记录）');
 expect(fishMetricLabel({statistic:'结果',definitionKey:definitionKey({...def,formula:'state = C\nstate'})})).toBe('state');
});
