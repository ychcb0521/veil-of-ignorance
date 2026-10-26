// 【用户要求】2026-10-26 比较探测：默认算法从 2026-04-01 00:00 起每半天挖一档，先挖 1000 条，持续挖掘；入鱼舱与鱼质量
import { beforeEach, expect, it } from 'vitest';
import { acceptMinedAnchor, currentDefaultRules, miningCards, miningDueAnchor, newMiningState, readMiningState, saveMiningState, MINING_START_MS, MINING_STEP_MS } from '@/lib/fish/mining';
import { fishCatchKey } from '@/lib/fish/records';
import type { TradeSignal } from '@/lib/signalLibrary';

beforeEach(() => localStorage.clear());
const fish = (symbol: string, timeMs: number): TradeSignal => ({ id: `fish-${symbol}-${timeMs}`, symbol, timeMs, timeLabel: '', fallbackZone: '', freshCatch: true,
  fish: { featureId: 'cbi2', featureShort: 'CBI-2', statistic: '结果', algorithmKey: 'cbi2|结果|=|>|0.04|', cutoffMs: timeMs, threshold: .04, direction: '>', average: .1, cbi2: .1, startAverage: .1, previousAverage: 0, scale: 1 } as never });

it('starts at 2026-04-01 00:00 UTC+8, steps half a day and targets 1000 signals by default', () => {
  expect(new Date(MINING_START_MS).toISOString()).toBe('2026-03-31T16:00:00.000Z');
  expect(MINING_STEP_MS).toBe(12 * 3_600_000);
  const s = newMiningState();
  expect(s).toMatchObject({ enabled: false, cursorMs: MINING_START_MS, target: 1000, mined: 0 });
  expect(miningDueAnchor(s, Date.now())).toBeNull(); // 没开始
  const on = { ...s, enabled: true };
  expect(miningDueAnchor(on, MINING_START_MS - 1)).toBeNull(); // 锚点还没到
  expect(miningDueAnchor(on, MINING_START_MS)).toBe(MINING_START_MS);
  expect(miningDueAnchor({ ...on, mined: 1000 }, Date.now())).toBeNull(); // 到目标就停
});
it('freezes the current default rules as enabled union cards', () => {
  const rules = currentDefaultRules();
  expect(rules.map(r => r.featureId)).toEqual(['cbi2', 'state', 'cba', 'drift-speed-z', 'bss']);
  const cards = miningCards(rules);
  expect(cards.every(c => c.enabled && c.pref.direction === '>')).toBe(true);
  expect(cards[1].pref).toMatchObject({ statistic: 'avg_state_2', threshold: '0.6' });
});
it('stores each anchor as cabin records (not fresh), keeps only the first anchor of a continuing signal, and advances the cursor', () => {
  const s = { ...newMiningState(), enabled: true }, A = MINING_START_MS, B = A + MINING_STEP_MS;
  const first = acceptMinedAnchor(s, [fish('AAAUSDT', A - 3600_000), fish('BBBUSDT', A - 600_000)], A, A + 1);
  expect(first.added).toHaveLength(2);
  expect(first.added[0]).toMatchObject({ mined: { anchorMs: A }, fishArchive: { id: `mine-${A}` } });
  expect(first.added[0].freshCatch).toBeUndefined(); expect(first.added[0].id).toContain(`|mine:${A}`);
  expect(first.state).toMatchObject({ cursorMs: B, mined: 2, anchorsDone: 1, lastAnchorMs: A, lastError: '' });
  // 下一档：AAA 还是同一段信号（起点不变）不再收；CCC 是新的
  const second = acceptMinedAnchor(first.state, [fish('AAAUSDT', A - 3600_000), fish('CCCUSDT', B - 300_000)], B, B + 1);
  expect(second.added.map(s => s.symbol)).toEqual(['CCCUSDT']);
  expect(second.state.minedKeys).toEqual([...first.state.minedKeys, fishCatchKey(second.added[0])]);
  expect(second.state).toMatchObject({ cursorMs: B + MINING_STEP_MS, mined: 3, anchorsDone: 2 });
  // 一档里没挖到也照样前进
  expect(acceptMinedAnchor(second.state, [], B + MINING_STEP_MS, 0).state.cursorMs).toBe(B + 2 * MINING_STEP_MS);
});
it('persists per account and falls back to a fresh state on corrupt data', () => {
  const s = { ...newMiningState(), enabled: true, target: 1500, rules: currentDefaultRules() };
  saveMiningState(s); expect(readMiningState()).toMatchObject({ enabled: true, target: 1500 });
  localStorage.setItem(Object.keys(localStorage).find(k => k.includes('fish-mining.v1'))!, '{bad');
  expect(readMiningState()).toMatchObject({ enabled: false, target: 1000 });
});
