import { describe, expect, it } from 'vitest';
import type { Position } from '@/types/trading';
import { calcLiquidationPrice, calcUnrealizedPnl } from '@/types/trading';
import { mergeFilledPosition } from '@/lib/tradingSettlement';

const FACE = 10;
/** 币本位仓位。coins = 张 × 面值 ÷ 开仓价。 */
const coin = (id: string, contracts: number, entryPrice: number, over: Partial<Position> = {}): Position => ({
  id, side: 'LONG', quantity: contracts, contracts, contractSizeUsd: FACE,
  settlementMode: 'coin', settlementAsset: 'COAI', entryPrice,
  leverage: 10, marginMode: 'isolated', openTime: 1_000,
  margin: contracts * FACE / 10,
  isolatedMargin: contracts * FACE / 10,
  marginCoin: (contracts * FACE / 10) / entryPrice,
  ...over,
} as Position);

const linear = (id: string, qty: number, entryPrice: number, over: Partial<Position> = {}): Position => ({
  id, side: 'LONG', quantity: qty, entryPrice, leverage: 10, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT', openTime: 1_000,
  margin: qty * entryPrice / 10, isolatedMargin: qty * entryPrice / 10,
  ...over,
} as Position);

describe('同标的同方向合并成一个仓位', () => {
  /**
   * 事故 COAIUSDT 2026-06-13（币本位，10x 逐仓）：
   *   主力 @0.538058 自身强平 0.491100
   *   加仓 @0.604447 自身强平 0.551695
   *   价格到 0.542220 —— 低于加仓自己的强平价、却远高于主力的，
   *   **加仓被单独打掉，主力活着**。
   *   合并后加权开仓价 0.581748、强平价 0.530977，0.542220 根本不该触发。
   *
   * 注意反向合约的强平价是 E·L(1+mmr)/(L+1)，不是线性的 E(1−1/L+mmr)——
   * 两者在 10x 上差 0.9%，用错公式会得到 0.546420 / 0.525900 那一组数。
   */
  const MAIN = coin('main', 53_790, 0.538058, { openTime: 1_000 });
  const ADD = coin('add', 116_304, 0.604447, { openTime: 9_000 });

  it('【回归】合并后 0.542220 不再触发强平', () => {
    const before = calcLiquidationPrice(ADD);
    expect(before).toBeGreaterThan(0.542220);          // 加仓自己会被打掉

    const { survivor } = mergeFilledPosition('COAIUSD', [MAIN], ADD);
    const after = calcLiquidationPrice(survivor);
    expect(after).toBeLessThan(0.542220);              // 合并后不会
    expect(after).toBeCloseTo(0.530977, 5);
  });

  it('【回归】加权开仓价按币量加权——币本位按张数加权是错的', () => {
    const { survivor } = mergeFilledPosition('COAIUSD', [MAIN], ADD);
    expect(survivor.entryPrice).toBeCloseTo(0.581748, 6);
    // 按张数(名义)加权会给出 0.580737，那个数在每个价位上都对不上
    const byNotional = (53_790 * 0.538058 + 116_304 * 0.604447) / (53_790 + 116_304);
    expect(survivor.entryPrice).not.toBeCloseTo(byNotional, 5);
  });

  it('【判据】合并后的盈亏必须在**任意**价格上等于两腿之和', () => {
    const { survivor } = mergeFilledPosition('COAIUSD', [MAIN], ADD);
    for (const px of [0.40, 0.50, 0.538058, 0.62, 0.75]) {
      const sep = calcUnrealizedPnl(MAIN, px) + calcUnrealizedPnl(ADD, px);
      expect(calcUnrealizedPnl(survivor, px)).toBeCloseTo(sep, 6);
    }
  });

  it('U 本位同样成立，且退化为数量加权算术平均', () => {
    const a = linear('a', 1_000, 0.5), b = linear('b', 2_000, 0.6);
    const { survivor } = mergeFilledPosition('XUSDT', [a], b);
    expect(survivor.entryPrice).toBeCloseTo((1_000 * 0.5 + 2_000 * 0.6) / 3_000, 9);
    for (const px of [0.4, 0.55, 0.8]) {
      expect(calcUnrealizedPnl(survivor, px))
        .toBeCloseTo(calcUnrealizedPnl(a, px) + calcUnrealizedPnl(b, px), 9);
    }
  });

  it('张数、保证金、逐仓保证金、币计保证金全部相加', () => {
    const { survivor } = mergeFilledPosition('COAIUSD', [MAIN], ADD);
    expect(survivor.contracts).toBe(53_790 + 116_304);
    expect(survivor.margin).toBeCloseTo(MAIN.margin + ADD.margin, 9);
    expect(survivor.isolatedMargin).toBeCloseTo(MAIN.isolatedMargin! + ADD.isolatedMargin!, 9);
    expect(survivor.marginCoin).toBeCloseTo(MAIN.marginCoin! + ADD.marginCoin!, 9);
  });

  it('【回归】存活的是**最早**那笔的 id，开仓时刻取最早', () => {
    // 挂在它上面的减仓单、日志的 trade_record_id 都指着这个 id。
    const r = mergeFilledPosition('COAIUSD', [MAIN], ADD);
    expect(r.survivor.id).toBe('main');
    expect(r.absorbedFillId).toBe('add');
    expect(r.survivor.openTime).toBe(1_000);
    expect(r.positions).toHaveLength(1);
  });

  it('【回归】每一笔成交都留在 fills 里，且 fills[0].id === position.id', () => {
    const { survivor } = mergeFilledPosition('COAIUSD', [MAIN], ADD);
    expect(survivor.fills?.map(f => f.id)).toEqual(['main', 'add']);
    expect(survivor.fills![0].id).toBe(survivor.id);
    expect(survivor.fills![1].entryPrice).toBeCloseTo(0.604447, 9);
    expect(survivor.fills![1].openTime).toBe(9_000);
  });

  it('【回归】开仓时刻绝不落到 0——0 会把战役的委托归属窗口变成 [1970, 平仓]', () => {
    const noTime = coin('x', 100, 0.5, { openTime: 0 });
    const { survivor } = mergeFilledPosition('COAIUSD', [MAIN], noTime);
    expect(survivor.openTime).toBe(1_000);
  });
});

describe('不该合并的情形', () => {
  const LONG = coin('L', 1_000, 0.5);

  it('【回归】多单与空单永远不合并——那是主力与对冲，合并等于抹掉对冲', () => {
    const short = coin('S', 1_000, 0.5, { side: 'SHORT' });
    const r = mergeFilledPosition('COAIUSD', [LONG], short);
    expect(r.absorbedFillId).toBeNull();
    expect(r.positions).toHaveLength(2);
    expect(r.blockedBy).toBeNull();          // 方向不同不算「被挡住」，本就是两笔
  });

  it('保证金模式不同不合并——强平公式在这上面分两支', () => {
    const cross = coin('C', 1_000, 0.6, { marginMode: 'cross' });
    const r = mergeFilledPosition('COAIUSD', [LONG], cross);
    expect(r.absorbedFillId).toBeNull();
    expect(r.blockedBy).toBe('marginMode');
  });

  it('杠杆不同不合并，并说明原因——取最大会凭空造出可撤保证金', () => {
    // 1000@10x + 1000@5x 的初始保证金地板是 300；按「取最大」只有 200，
    // 用户会以为有 100 可以撤出来，撤完等于事后把 5x 那腿加到了 10x。
    const other = coin('O', 1_000, 0.6, { leverage: 5 });
    const r = mergeFilledPosition('COAIUSD', [LONG], other);
    expect(r.absorbedFillId).toBeNull();
    expect(r.blockedBy).toBe('leverage');
  });

  it('结算方式不同不合并——quantity 一个是币、一个是张', () => {
    const usdt = linear('U', 1_000, 0.6);
    const r = mergeFilledPosition('COAIUSD', [LONG], usdt);
    expect(r.absorbedFillId).toBeNull();
    expect(r.blockedBy).toBe('settlement');
  });

  it('没有同向仓位时就是新开一笔，blockedBy 为 null', () => {
    const r = mergeFilledPosition('COAIUSD', [], LONG);
    expect(r.absorbedFillId).toBeNull();
    expect(r.blockedBy).toBeNull();
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0].fills).toHaveLength(1);
  });

  it('已经归零的幽灵仓位不参与合并', () => {
    const ghost = coin('G', 0, 0.5);
    const r = mergeFilledPosition('COAIUSD', [ghost], LONG);
    expect(r.absorbedFillId).toBeNull();
    expect(r.positions).toHaveLength(1);
  });
});
