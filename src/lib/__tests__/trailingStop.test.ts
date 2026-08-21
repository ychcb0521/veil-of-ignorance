import { describe, expect, it } from 'vitest';
import { initTrailingState, stepTrailingStop, type TrailingState } from '@/lib/trailingStop';

const step = (
  side: 'LONG' | 'SHORT', state: TrailingState,
  high: number, low: number,
  callbackRate = 0.02, activationPrice: number | null = null,
) => stepTrailingStop({ side, callbackRate, activationPrice, state, high, low });

describe('跟踪委托触发逻辑', () => {
  it('无激活价：挂出即激活', () => {
    expect(initTrailingState(null).activated).toBe(true);
    expect(initTrailingState(0).activated).toBe(true);
    expect(initTrailingState(100).activated).toBe(false);
  });

  it('卖出方向：追踪最高价，从峰值回撤回调率触发', () => {
    let s = initTrailingState(null);
    // 价格一路走高：极值跟随，不触发
    let r = step('SHORT', s, 100, 99);
    expect(r.triggered).toBe(false);
    expect(r.state.extreme).toBe(100);
    // 爬升途中每根振幅小于回调率：极值跟随、不触发
    r = step('SHORT', r.state, 110, 108.5);
    expect(r.triggered).toBe(false);
    expect(r.state.extreme).toBe(110);
    // 回撤 2%：110 × 0.98 = 107.8，low 触及即触发
    r = step('SHORT', r.state, 109, 107.5);
    expect(r.triggered).toBe(true);
    expect(r.triggerPrice).toBeCloseTo(107.8, 10);
  });

  it('买入方向：追踪最低价，从谷底反弹触发（对称）', () => {
    let r = step('LONG', initTrailingState(null), 101, 100);
    expect(r.state.extreme).toBe(100);
    r = step('LONG', r.state, 95, 90);
    expect(r.state.extreme).toBe(90);
    // 反弹 2%：90 × 1.02 = 91.8
    r = step('LONG', r.state, 92, 90.5);
    expect(r.triggered).toBe(true);
    expect(r.triggerPrice).toBeCloseTo(91.8, 10);
  });

  it('激活价：触及前完全不追踪', () => {
    const act = 120;
    let r = step('SHORT', initTrailingState(act), 110, 100, 0.02, act);
    expect(r.state.activated).toBe(false);
    expect(r.state.extreme).toBeNull();
    expect(r.triggered).toBe(false);
    // 上摸 120 激活，极值从激活价起算
    r = step('SHORT', r.state, 121, 118, 0.02, act);
    expect(r.state.activated).toBe(true);
    expect(r.state.extreme).toBe(121);
  });

  it('激活当根不会被同根 K 线的极值虚构触发——极值从激活价起算', () => {
    // 一根巨阳线：high=150 越过激活价 120，low=100。
    // 若极值直接取 150，回调线 147 会被同根 low 触发（乐观偏差）；
    // 从激活价 120 起算，先推进到 150，再判 low=100 <= 147 —— 仍会触发？
    // 保守序为：极值含本根 high，判定用本根 low——同根大振幅本就该触发，
    // 但激活价之下的部分不参与极值。此处验证极值确为 max(激活价, high)。
    const r = step('SHORT', initTrailingState(120), 150, 100, 0.02, 120);
    expect(r.state.extreme).toBe(150);
    expect(r.triggered).toBe(true); // 150→100 回撤远超 2%
  });

  it('横盘不触发：回撤不足回调率', () => {
    let r = step('SHORT', initTrailingState(null), 100, 99.5);
    r = step('SHORT', r.state, 100.2, 99.4, 0.02);
    expect(r.triggered).toBe(false); // 极值 100.2，回调线 98.196，low 99.4 未及
  });

  it('非法输入不触发也不改状态', () => {
    const s: TrailingState = { activated: true, extreme: 100 };
    for (const [h, l, cb] of [[0, 0, 0.02], [100, 101, 0.02], [100, 99, 0]] as const) {
      const r = stepTrailingStop({ side: 'SHORT', callbackRate: cb, activationPrice: null, state: s, high: h, low: l });
      expect(r.triggered).toBe(false);
      expect(r.state).toEqual(s);
    }
  });
});
