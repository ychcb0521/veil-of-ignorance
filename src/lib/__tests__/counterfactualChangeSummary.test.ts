import { describe, expect, it } from 'vitest';
import {
  COUNTERFACTUAL_NAME_MAX_LENGTH,
  buildCounterfactualChangeSummary,
  defaultCounterfactualName,
  formatCounterfactualStamp,
} from '@/lib/counterfactualChangeSummary';
import type { CampaignCounterfactualManualLeg } from '@/types/journal';

function leg(over: Partial<CampaignCounterfactualManualLeg> = {}): CampaignCounterfactualManualLeg {
  return {
    id: 'main',
    leg_role: 'main_open',
    direction: 'long',
    open_time: '2026-01-01T00:00:00.000Z',
    close_time: '2026-01-01T01:00:00.000Z',
    entry_price: 100,
    exit_price: 110,
    size_usdt: 1_000,
    leverage: 5,
    enabled: true,
    ...over,
  };
}

describe('buildCounterfactualChangeSummary', () => {
  it('没有任何改动：短句「未改动」，没有逐腿行', () => {
    const baseline = [leg(), leg({ id: 'hedge-a', leg_role: 'hedge_initial_a', direction: 'short', entry_price: 90, exit_price: 90 })];
    const summary = buildCounterfactualChangeSummary(baseline, baseline, baseline);
    expect(summary).toEqual({ short: '未改动', lines: [], legs: [] });
  });

  it('单腿改一个字段：短句 = 角色 + 字段名，逐腿行写出前后值', () => {
    const baseline = [leg(), leg({ id: 'add1', leg_role: 'main_add_1', exit_price: 105 })];
    const run = [baseline[0], { ...baseline[1], exit_price: 120 }];
    const summary = buildCounterfactualChangeSummary(baseline, run, run);
    expect(summary.short).toBe('加仓1 平仓价');
    expect(summary.legs).toEqual([{ id: 'add1', role: 'main_add_1', kind: 'edited', changedFields: ['exit_price'] }]);
    expect(summary.lines).toEqual(['改 加仓1：平仓价 105 → 120']);
  });

  it('多腿改动：计数短句「改2腿·增1腿·删1腿·停1腿」，停用与删除靠编辑器全部腿区分', () => {
    const baseline = [
      leg(),
      leg({ id: 'add1', leg_role: 'main_add_1', exit_price: 105 }),
      leg({ id: 'hedge-a', leg_role: 'hedge_initial_a', direction: 'short', entry_price: 90, exit_price: 90 }),
      leg({ id: 'hedge-b', leg_role: 'hedge_initial_b', direction: 'short', entry_price: 85, exit_price: 85 }),
      leg({ id: 'tp', leg_role: 'mirror_tp', exit_price: 115 }),
    ];
    const editor = [
      { ...baseline[0], size_usdt: 500 },
      { ...baseline[1], exit_price: 120, close_time: '2026-01-01T02:00:00.000Z' },
      { ...baseline[2], enabled: false },
      // hedge-b 被删除：编辑器里没有它
      baseline[4],
      leg({ id: 'manual-1', leg_role: 'hedge_rolling', direction: 'short', entry_price: 95, exit_price: 92, size_usdt: 500 }),
    ];
    const run = editor.filter(item => item.enabled);
    const summary = buildCounterfactualChangeSummary(baseline, editor, run);
    expect(summary.short).toBe('改2腿·增1腿·删1腿·停1腿');
    expect(summary.legs).toEqual([
      { id: 'main', role: 'main_open', kind: 'edited', changedFields: ['size_usdt'] },
      { id: 'add1', role: 'main_add_1', kind: 'edited', changedFields: ['close_time', 'exit_price'] },
      { id: 'hedge-a', role: 'hedge_initial_a', kind: 'disabled', changedFields: [] },
      { id: 'hedge-b', role: 'hedge_initial_b', kind: 'removed', changedFields: [] },
      { id: 'manual-1', role: 'hedge_rolling', kind: 'added', changedFields: [] },
    ]);
    expect(summary.lines[0]).toBe('改 主力开仓：仓位 1000 USDT → 500 USDT');
    expect(summary.lines[1]).toMatch(/^改 加仓1：平仓时间 \d{2}-\d{2} \d{2}:\d{2} → \d{2}-\d{2} \d{2}:\d{2}；平仓价 105 → 120$/);
    expect(summary.lines[2]).toBe('停用 初始对冲 A');
    expect(summary.lines[3]).toBe('删 初始对冲 B');
    expect(summary.lines[4]).toMatch(/^增 滚动对冲：空 \d{2}-\d{2} \d{2}:\d{2} → \d{2}-\d{2} \d{2}:\d{2}，95 → 92，500 USDT$/);
  });

  it('拿不到编辑器全部腿时，基线里缺席的腿按「删除」计', () => {
    const baseline = [leg(), leg({ id: 'hedge-a', leg_role: 'hedge_initial_a', direction: 'short', entry_price: 90, exit_price: 90 })];
    const run = [baseline[0]];
    const summary = buildCounterfactualChangeSummary(baseline, run, run);
    expect(summary.short).toBe('删 初始对冲 A');
    expect(summary.legs).toEqual([{ id: 'hedge-a', role: 'hedge_initial_a', kind: 'removed', changedFields: [] }]);
  });

  it('时间按毫秒比较、数值容忍 1e-9：等价写法不算改动', () => {
    const baseline = [leg()];
    const run = [{ ...baseline[0], open_time: '2026-01-01T08:00:00.000+08:00', exit_price: 110 + 1e-12 }];
    expect(buildCounterfactualChangeSummary(baseline, run, run).short).toBe('未改动');
  });

  it('短句永远不超过 20 字：单腿改了太多字段就退回计数形式', () => {
    const baseline = [leg({ id: 'r', leg_role: 'reentry_hedge' })];
    const run = [{
      ...baseline[0],
      direction: 'short' as const,
      open_time: '2026-01-01T00:30:00.000Z',
      close_time: '2026-01-01T02:00:00.000Z',
      entry_price: 101,
      exit_price: 99,
      size_usdt: 300,
      leverage: 3,
    }];
    const summary = buildCounterfactualChangeSummary(baseline, run, run);
    expect(summary.short).toBe('改1腿');
    expect(summary.short.length).toBeLessThanOrEqual(COUNTERFACTUAL_NAME_MAX_LENGTH);
    expect(summary.legs[0].changedFields).toEqual([
      'direction', 'open_time', 'close_time', 'entry_price', 'exit_price', 'size_usdt', 'leverage',
    ]);
  });
});

describe('defaultCounterfactualName / formatCounterfactualStamp', () => {
  it('默认名 = 短句 + 空格 + MM-DD HH:mm（本地时区），整体截到 20 字', () => {
    const ranAt = new Date(2026, 8, 16, 14, 30);
    expect(formatCounterfactualStamp(ranAt)).toBe('09-16 14:30');
    expect(defaultCounterfactualName({ short: '加仓1 平仓价' }, ranAt)).toBe('加仓1 平仓价 09-16 14:30');
    const long = defaultCounterfactualName({ short: '改2腿·增1腿·删1腿·停1腿' }, ranAt);
    expect(long).toHaveLength(COUNTERFACTUAL_NAME_MAX_LENGTH);
    expect(long.startsWith('改2腿·增1腿·删1腿·停1腿')).toBe(true);
  });

  it('没有摘要时退回「手动调整」；非法时间印「—」', () => {
    const ranAt = new Date(2026, 0, 2, 9, 5);
    expect(defaultCounterfactualName(null, ranAt)).toBe('手动调整 01-02 09:05');
    expect(defaultCounterfactualName({ short: '' }, ranAt)).toBe('手动调整 01-02 09:05');
    expect(formatCounterfactualStamp('not-a-date')).toBe('—');
  });
});
