import { expect, it } from 'vitest';
import { fishSourceLabel, fishCaughtBy, fishAlgorithmShort, collapseVisibleFish } from '@/lib/fish/records';
import { composeFishEmail } from '@/lib/fish/notify';
import { definitionKey, STATE_DEF } from '@/lib/deepDig/features';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { FishSnapshot } from '@/lib/fish/algorithm';
const snapshot = (statistic: string): FishSnapshot => ({featureId:'state',featureShort:'S',statistic,average:.71,cbi2:.71,startAverage:.71,previousAverage:.69,cutoffMs:1,threshold:.7});
const fish = (statistic: string): TradeSignal => ({id:statistic,symbol:'SUSDT',timeMs:1,timeLabel:'',fallbackZone:'',fish:snapshot(statistic)});
it('keeps raw S and average S separate in saved fish, filters and email sources', () => {
  const raw=fish('state'), avg=fish('avg_state_2'), before=JSON.stringify([raw,avg]);
  expect(fishCaughtBy(raw)).toEqual(['S 原值']);
  expect(fishCaughtBy(avg)).toEqual(['avg_S']);
  expect(fishAlgorithmShort(raw)).toBe('S 原值');
  expect(collapseVisibleFish([raw,avg])).toHaveLength(2);
  const both={...raw,fish:{...raw.fish!,algorithms:[raw.fish!,avg.fish!],combination:'or' as const,hitAlgorithms:[1,2]}};
  expect(fishCaughtBy(both)).toEqual(['S 原值','avg_S']);
  expect(fishAlgorithmShort(both)).toBe('S 原值 ∪ avg_S');
  expect(fishCaughtBy({...both,fish:{...both.fish,hitAlgorithms:[2]}})).toEqual(['avg_S']);
  expect(fishCaughtBy({...both,fish:{...both.fish,combination:'and'}})).toEqual(['S 原值','avg_S']);
  const email=composeFishEmail([both]);
  for(const body of [email.message,email.message_html]){
    expect(body).toContain('S 原值');expect(body).toContain('avg_S');
    expect(body).not.toMatch(/https?:|href=|渔|无知之幕|veil-of-ignorance/i);
  }
  expect(JSON.stringify([raw,avg])).toBe(before);
});
it('identifies legacy S only from its saved series, formula or external average', () => {
  expect(fishSourceLabel({featureId:'state',statistic:'结果',definitionKey:definitionKey({...STATE_DEF,formula:'state = C\navg_state_2 = avg(state,24)'})})).toBe('avg_S');
  expect(fishSourceLabel({featureId:'state',statistic:'结果',definitionKey:definitionKey({...STATE_DEF,formula:'state = C'})})).toBe('S 原值');
  expect(fishSourceLabel({featureShort:'S',algorithmKey:'state|avg_state_2|=|>|0.6|x'})).toBe('avg_S');
  expect(fishSourceLabel({featureShort:'S',statistic:'state',H:24})).toBe('avg_S');
  expect(fishSourceLabel({featureId:'state',statistic:'结果',definitionKey:'broken'})).toBe('S（序列不详）');
  expect(fishSourceLabel({featureId:'state',statistic:'momentum'})).toBe('S [momentum]');
  expect(fishSourceLabel({featureId:'state2',featureShort:'S2',statistic:'state'})).toBe('S2');
  expect(fishSourceLabel({featureId:'custom',featureShort:'S',statistic:'state'})).toBe('S');
});
