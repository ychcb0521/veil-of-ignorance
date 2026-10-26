// 【用户要求】2026-10-26「如果交易战役是从鱼质量那里点进去的，那么返回的时候，也要返回到鱼质量的对应的开始的位置」
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ancestorScrolls, applyAncestorScrolls, armQualityReturn, finishQualityReturn, pendingQualityReturn, saveQualityReturn, QUALITY_RETURN_KEY, type QualityReturnUi } from '@/lib/fish/qualityReturn';

const ui: QualityReturnUi = { open: true, query: 'BTC', month: '2026-10', algorithm: '', origin: 'library', phase: 'detect', sort: 'symbol', ascending: true, tableTop: 330 };
beforeEach(() => { sessionStorage.clear(); finishQualityReturn(); window.history.replaceState({ key: 'entry-a', idx: 3 }, ''); });
afterEach(() => finishQualityReturn());

it('restores once, only when coming back to the same history entry', () => {
  saveQualityReturn({ ui, scroll: [10, 20] }, Date.now());
  // 另开一次交易页（新的浏览记录）：不恢复，也不消耗
  window.history.replaceState({ key: 'entry-b', idx: 5 }, '');
  expect(armQualityReturn()).toBe(false);
  expect(sessionStorage.getItem(QUALITY_RETURN_KEY)).not.toBeNull();
  // 回到离开时那条记录
  window.history.replaceState({ key: 'entry-a', idx: 3 }, '');
  expect(armQualityReturn()).toBe(true);
  expect(armQualityReturn()).toBe(true); // StrictMode 下重复调用仍为真
  expect(pendingQualityReturn()).toMatchObject({ ui: { phase: 'detect', query: 'BTC', tableTop: 330 }, scroll: [10, 20], entry: 'entry-a' });
  expect(sessionStorage.getItem(QUALITY_RETURN_KEY)).toBeNull();
  finishQualityReturn();
  expect(armQualityReturn()).toBe(false);
});
it('ignores stale or broken records', () => {
  saveQualityReturn({ ui, scroll: [] }, Date.now() - 7 * 3_600_000);
  expect(armQualityReturn()).toBe(false);
  sessionStorage.setItem(QUALITY_RETURN_KEY, '{bad');
  expect(armQualityReturn()).toBe(false);
});
it('records and reapplies the scroll offsets of every ancestor', () => {
  const outer = document.createElement('div'), inner = document.createElement('div'), leaf = document.createElement('section');
  outer.appendChild(inner); inner.appendChild(leaf); document.body.appendChild(outer);
  inner.scrollTop = 0; outer.scrollTop = 0;
  expect(ancestorScrolls(leaf).slice(0, 2)).toEqual([0, 0]);
  // jsdom 里 scrollTop 可写；能写到位就算稳住
  Object.defineProperty(inner, 'scrollTop', { value: 0, writable: true, configurable: true });
  Object.defineProperty(outer, 'scrollTop', { value: 0, writable: true, configurable: true });
  expect(applyAncestorScrolls(leaf, [40, 15])).toBe(true);
  expect(inner.scrollTop).toBe(40); expect(outer.scrollTop).toBe(15);
  outer.remove();
});
