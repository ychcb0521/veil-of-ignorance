import { describe, expect, it } from 'vitest';
import type { Position } from '@/types/trading';
import { calcLiquidationPrice, calcUnrealizedPnl } from '@/types/trading';
import { mergeFilledPosition } from '@/lib/tradingSettlement';
import { legacyHedgeRiskStamp, positionRiskStamp } from '@/lib/positionRiskModel';

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

describe('合并不抹掉每笔成交所在的回放时间线', () => {
  it('主力与被吞并那笔各留各的章；存活仓位的章仍是最早那笔的', () => {
    const main = linear('main', 10, 100, { openTimelineId: 'tl-main' });
    const add = linear('add', 5, 110, { openTimelineId: 'tl-add', openTime: 9_000 });
    const { survivor } = mergeFilledPosition('BTCUSDT', [main], add);
    expect(survivor.openTimelineId).toBe('tl-main');
    expect(survivor.fills!.map(f => [f.id, f.timelineId])).toEqual([['main', 'tl-main'], ['add', 'tl-add']]);
  });

  it('没有合并、新开一个仓位：它自己的 fills[0] 同样带章', () => {
    const r = mergeFilledPosition('BTCUSDT', [], linear('solo', 10, 100, { openTimelineId: 'tl-solo' }));
    expect(r.positions[0].fills![0].timelineId).toBe('tl-solo');
  });

  it('没盖章的旧仓位合并后，fills 里不凭空多出 timelineId 字段', () => {
    const { survivor } = mergeFilledPosition('BTCUSDT', [linear('old', 10, 100)], linear('new', 5, 110));
    expect(survivor.fills!.every(f => !('timelineId' in f))).toBe(true);
  });
});

/**
 * 【复核 r8】没有合并时报的原因要是**最接近合并**的那一笔的，不是数组里排最前的那一笔的。
 *
 * 第 8 轮复核实测：盘上 [空 更新前, 多 分层 5x, 多 更新前 全仓, 多 分层 10x 逐仓（本该并进去的那笔）]，
 * 一笔 10x 逐仓的豁免成交挡住它的是规则三（口径），但 sameSide 取到的是 5x 那笔，
 * 于是「未与现有仓位合并」的提示说成「杠杆与现有同向仓位不同」，下单面板里规则三那句也不出现。
 * 引擎的结果（不并、不重新定价）本来就对，只是原因报错了。
 */
describe('【复核 r8】没有合并时报最接近那一笔的原因', () => {
  const SYM = 'KAITOUSDT';
  const TIERED = positionRiskStamp(SYM);
  const EXEMPT = legacyHedgeRiskStamp(SYM);
  const usdt = (id: string, over: Partial<Position>): Position => linear(id, 1_000, 1, over);

  it('挡住的是规则三时报 riskModel，与同向仓位在数组里的顺序无关', () => {
    const board = [
      usdt('short-pre', { side: 'SHORT' }),
      usdt('long-tiered-5x', { leverage: 5, ...TIERED }),
      usdt('long-pre-cross', { marginMode: 'cross', isolatedMargin: undefined }),
      usdt('long-tiered-10x', { leverage: 10, ...TIERED }),
    ];
    const fill = usdt('exempt-fill', { leverage: 10, ...EXEMPT });
    const r = mergeFilledPosition(SYM, board, fill);
    expect(r.absorbedFillId).toBeNull();
    expect(r.blockedBy).toBe('riskModel');
    expect(r.positions).toHaveLength(5);
    // 只有目标那笔在盘上时也是 riskModel；倒过来排也一样
    expect(mergeFilledPosition(SYM, [board[3]], fill).blockedBy).toBe('riskModel');
    expect(mergeFilledPosition(SYM, [...board].reverse(), fill).blockedBy).toBe('riskModel');
    // 四种结算 / 保证金口味都一样
    const coinBoard = board.map(p => ({ ...p, settlementMode: 'coin', settlementAsset: 'KAITO', contractSizeUsd: FACE, contracts: p.quantity } as Position));
    const coinFill = { ...fill, settlementMode: 'coin', settlementAsset: 'KAITO', contractSizeUsd: FACE, contracts: fill.quantity } as Position;
    expect(mergeFilledPosition(SYM, coinBoard, coinFill).blockedBy).toBe('riskModel');
  });

  it('没有口径只差的同向仓位时，按 杠杆 > 结算方式 > 保证金模式 报最深的那一个', () => {
    const fill = usdt('exempt-fill', { leverage: 10, ...EXEMPT });
    expect(mergeFilledPosition(SYM, [usdt('a', { leverage: 5, ...TIERED })], fill).blockedBy).toBe('leverage');
    expect(mergeFilledPosition(SYM, [
      usdt('cross', { marginMode: 'cross', isolatedMargin: undefined, leverage: 10 }),
      usdt('lev', { leverage: 5 }),
    ], fill).blockedBy).toBe('leverage');
    expect(mergeFilledPosition(SYM, [usdt('cross', { marginMode: 'cross', isolatedMargin: undefined })], fill).blockedBy).toBe('marginMode');
    // 没有同向仓位：不是「没合并」，是新开
    expect(mergeFilledPosition(SYM, [usdt('short', { side: 'SHORT' })], fill).blockedBy).toBeNull();
  });
});
