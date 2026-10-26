// 【用户要求】2026-10-26 鱼质量「卖出比较」列表按住 Shift 连续选择
import { expect, it } from 'vitest';
import { rangeSelect } from '@/lib/listRangeSelect';

const order = ['a', 'b', 'c', 'd', 'e'];
it('without shift (or without a usable anchor) toggles just the clicked row', () => {
  expect(rangeSelect(order, new Set(['a']), 'a', 'c', true, false).sort()).toEqual(['a', 'c']);
  expect(rangeSelect(order, new Set(['a', 'c']), null, 'c', false, true)).toEqual(['a']);
  expect(rangeSelect(order, new Set(), 'gone', 'b', true, true)).toEqual(['b']);
});
it('with shift sets every row between the anchor and the clicked row (both ends, either direction) to the clicked row’s new state', () => {
  expect(rangeSelect(order, new Set(), 'b', 'd', true, true).sort()).toEqual(['b', 'c', 'd']);
  expect(rangeSelect(order, new Set(), 'd', 'b', true, true).sort()).toEqual(['b', 'c', 'd']);
  expect(rangeSelect(order, new Set(order), 'a', 'c', false, true).sort()).toEqual(['d', 'e']);
  // 区间外已选的不受影响
  expect(rangeSelect(order, new Set(['e']), 'a', 'b', true, true).sort()).toEqual(['a', 'b', 'e']);
});
