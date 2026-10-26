// 【用户要求】2026-10-26 比较探测：默认算法从 2026-04-01 00:00 起每半天挖一档，先挖 1000 条，持续挖掘；入鱼舱与鱼质量
import { beforeEach, expect, it } from 'vitest';
import { acceptMinedAnchor, currentDefaultRules, mergeMiningStates, miningCards, miningDueAnchor, newMiningState, readMiningState, reconcileMiningWithFish, saveMiningState, MINING_START_MS, MINING_STEP_MS, type FishMiningState } from '@/lib/fish/mining';
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

// 【用户要求】2026-10-26「自动挖掘可以记住上次挖掘到那个时间点了。下次点开时，能够按照时间顺序接上」
it('merging two copies never moves progress backwards: farther cursor wins, mined keys union, settings from the newer save', () => {
  const A = MINING_START_MS, step = MINING_STEP_MS;
  const stale: FishMiningState = { ...newMiningState(), enabled: true, cursorMs: A + step, anchorsDone: 1, mined: 1, minedKeys: ['k1'], lastAnchorMs: A, savedAt: 100, target: 1000 };
  const ahead: FishMiningState = { ...newMiningState(), enabled: false, cursorMs: A + 9 * step, anchorsDone: 9, mined: 3, minedKeys: ['k1', 'k2', 'k3'], lastAnchorMs: A + 8 * step, savedAt: 50, target: 1000 };
  const merged = mergeMiningStates(ahead, stale) as FishMiningState;
  expect(merged).toMatchObject({ cursorMs: A + 9 * step, anchorsDone: 9, lastAnchorMs: A + 8 * step, mined: 3, enabled: true, savedAt: 100 });
  expect(merged.minedKeys).toEqual(['k1', 'k2', 'k3']);
  expect((mergeMiningStates(stale, ahead) as FishMiningState).cursorMs).toBe(A + 9 * step);
  // 坏的一边不影响另一边
  expect(mergeMiningStates('{bad', ahead)).toMatchObject({ cursorMs: A + 9 * step });
});
it('reconciles a lost or rolled-back state from the mined fish in the cabin: resumes right after the last mined anchor', () => {
  const A = MINING_START_MS, step = MINING_STEP_MS;
  const first = acceptMinedAnchor({ ...newMiningState(), enabled: true }, [fish('AAAUSDT', A - 1000)], A, A + 1);
  const later = acceptMinedAnchor({ ...first.state, cursorMs: A + 5 * step }, [fish('BBBUSDT', A + 5 * step - 1000)], A + 5 * step, A + 5 * step + 1);
  const cabin = [...first.added, ...later.added, fish('MANUALUSDT', A)];
  const lost = { ...newMiningState(), enabled: true };
  const fixed = reconcileMiningWithFish(lost, cabin);
  expect(fixed).toMatchObject({ cursorMs: A + 6 * step, anchorsDone: 6, mined: 2, lastAnchorMs: A + 5 * step, enabled: true });
  expect(fixed.minedKeys).toEqual([...first.added, ...later.added].map(fishCatchKey));
  // 已经接上了就原样返回（不重复存、不倒退）
  expect(reconcileMiningWithFish(fixed, cabin)).toBe(fixed);
  const ahead = { ...fixed, cursorMs: A + 20 * step };
  expect(reconcileMiningWithFish(ahead, cabin)).toBe(ahead);
  expect(reconcileMiningWithFish(lost, [fish('MANUALUSDT', A)])).toBe(lost);
});
it('saving stamps savedAt so a later save wins the settings on merge', () => {
  saveMiningState({ ...newMiningState(), enabled: true }, 1234);
  expect(readMiningState().savedAt).toBe(1234);
});
