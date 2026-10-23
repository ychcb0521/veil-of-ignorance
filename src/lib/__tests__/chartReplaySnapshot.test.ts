import { expect, it } from 'vitest';
import { liveChartCoversSnapshot } from '../chartReplaySnapshot';
const bars = (...times:number[]) => times.map(timestamp=>({timestamp}));
it('recognizes all streamed candles even when more than two arrive per React flush',()=>{
  expect(liveChartCoversSnapshot(bars(1,2,3,4,5,6),bars(1,2,3,4,5,6),[])).toBe(true);
  expect(liveChartCoversSnapshot(bars(1,2,3,4),bars(1,2,3,4,5),[])).toBe(true);
});
it('includes the latest coalesced queue while preserving the native history prefix',()=>{
  expect(liveChartCoversSnapshot(bars(1,2,3,4,5,6),bars(1,2,3),bars(3,4,5,6))).toBe(true);
  expect(liveChartCoversSnapshot(bars(1,2,3,4),bars(1,2),bars(2,3,3,4,5))).toBe(true);
});
it('never accepts a missing candle, different window or incomplete pending queue',()=>{
  expect(liveChartCoversSnapshot(bars(1,2,3,4,5,6),bars(1,2,4,5,6),bars(3))).toBe(false);
  expect(liveChartCoversSnapshot(bars(1,2,3,4,5,6),bars(1,2),bars(4,5,6))).toBe(false);
  expect(liveChartCoversSnapshot(bars(1,2,3,4,5,6),bars(1,2),bars(3,4))).toBe(false);
  expect(liveChartCoversSnapshot(bars(2,3,4),bars(1,2,3,4),[])).toBe(false);
  expect(liveChartCoversSnapshot(bars(1),[],bars(1))).toBe(false);
});
