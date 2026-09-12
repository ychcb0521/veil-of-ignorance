import { describe, expect, it } from 'vitest';
import { MAKER_FEE, TAKER_FEE, type PendingOrder, type Position } from '@/types/trading';
import {
  executeSettlementFill,
  mergeFilledPosition,
  scaleSettlementPosition,
  settlePositionClose,
} from '@/lib/tradingSettlement';

/**
 * 开仓费此前只从钱包扣、不进任何记录——「平仓价高于开仓价却亏损」的来源。
 * 现在它随仓位走：成交 → 合并 → 部分平仓按比例 → 平仓记录写出每一笔自己的开仓费。
 */
const order = (over: Partial<PendingOrder> = {}): PendingOrder => ({
  id: 'o1', side: 'LONG', type: 'MARKET', price: 0, stopPrice: 0, quantity: 1000, leverage: 10,
  marginMode: 'isolated', status: 'FILLED', createdAt: 0, ...over,
});
const T0 = Date.parse('2026-09-12T04:00:00+08:00');
const MIN = 60_000;

describe('开仓费随仓位走', () => {
  it('市价成交：仓位记下 Taker 开仓费 = 成交价 × 数量 × 0.05%', () => {
    const { fee, position } = executeSettlementFill('HPEUSDT', 62, order(), false, T0, T0);
    expect(position.openFeeUsd).toBe(fee);
    expect(position.openFeeUsd).toBeCloseTo(position.entryPrice * 1000 * TAKER_FEE, 9);
    expect(position.openIsMaker).toBe(false);
    expect(position.openFeeRate).toBe(TAKER_FEE);
    expect(position.openFeeCoin).toBeUndefined();
  });

  it('限价挂单成交：Maker 0.02%，不吃滑点', () => {
    const { position } = executeSettlementFill('HPEUSDT', 62, order({ type: 'LIMIT', price: 62 }), true, T0, T0);
    expect(position.entryPrice).toBe(62);
    expect(position.openFeeUsd).toBeCloseTo(62 * 1000 * MAKER_FEE, 9);
    expect(position.openIsMaker).toBe(true);
    expect(position.openFeeRate).toBe(MAKER_FEE);
  });

  it('币本位：开仓费以币计 = 张数 × 面值 ÷ 成交价 × 费率', () => {
    const { position } = executeSettlementFill(
      'NOMUSD', 0.01,
      order({ quantity: 100, contracts: 100, settlementMode: 'coin', contractSizeUsd: 10, settlementAsset: 'NOM' }),
      true, T0, T0,
    );
    expect(position.openFeeCoin).toBeCloseTo((100 * 10) / 0.01 * MAKER_FEE, 9);
    expect(position.openFeeUsd).toBeCloseTo(100 * 10 * MAKER_FEE, 9);
  });

  it('整笔平仓：记录带上开仓费、平仓费率与 Maker/Taker', () => {
    const { position } = executeSettlementFill('HPEUSDT', 62, order(), false, T0, T0);
    const settled = settlePositionClose('HPEUSDT', position, 62.5, 1000, T0 + MIN)!;
    expect(settled.records).toHaveLength(1);
    const [rec] = settled.records;
    expect(rec.openFeeUsd).toBeCloseTo(position.openFeeUsd!, 12);
    expect(rec.openIsMaker).toBe(false);
    expect(rec.openFeeRate).toBe(TAKER_FEE);
    expect(rec.closeIsMaker).toBe(false);
    expect(rec.closeFeeRate).toBe(TAKER_FEE);
    expect(rec.fee).toBeCloseTo(rec.exitPrice * 1000 * TAKER_FEE, 9);   // fee 仍只是平仓费
    expect(rec.liquidationFeeUsd).toBeUndefined();
  });

  it('合并仓位：每笔成交各带自己的开仓费，整笔平仓时逐条写出，Σ 等于两笔之和', () => {
    const a = executeSettlementFill('HPEUSDT', 60, order({ id: 'a' }), false, T0, T0).position;
    const b = executeSettlementFill('HPEUSDT', 64, order({ id: 'b', type: 'LIMIT', price: 64, quantity: 500 }), true, T0 + MIN, T0 + MIN).position;
    const { survivor } = mergeFilledPosition('HPEUSDT', [a], b);
    expect(survivor.openFeeUsd).toBeCloseTo(a.openFeeUsd! + b.openFeeUsd!, 12);
    expect(survivor.openIsMaker).toBeUndefined();          // 一笔 Taker 一笔 Maker：仓位级说不清，记录层各自带
    expect(survivor.fills?.map(f => f.openFeeUsd)).toEqual([a.openFeeUsd, b.openFeeUsd]);

    const settled = settlePositionClose('HPEUSDT', survivor, 63, 1500, T0 + 2 * MIN)!;
    expect(settled.records).toHaveLength(2);
    // fills[i].id 是仓位 id（executeSettlementFill 给的 uuid），不是委托 id
    const byFill = new Map(settled.records.map(r => [r.fillId, r]));
    expect(byFill.get(a.id)!.openFeeUsd).toBeCloseTo(a.openFeeUsd!, 9);
    expect(byFill.get(a.id)!.openIsMaker).toBe(false);
    expect(byFill.get(b.id)!.openFeeUsd).toBeCloseTo(b.openFeeUsd!, 9);
    expect(byFill.get(b.id)!.openIsMaker).toBe(true);
    expect(byFill.get(b.id)!.openFeeRate).toBe(MAKER_FEE);
    const sum = settled.records.reduce((s, r) => s + (r.openFeeUsd ?? 0), 0);
    expect(sum).toBeCloseTo(a.openFeeUsd! + b.openFeeUsd!, 9);
  });

  it('合并仓位部分平仓：每笔成交的开仓费也按比例缩，留在存活的仓位上', () => {
    const a = executeSettlementFill('HPEUSDT', 60, order({ id: 'a' }), false, T0, T0).position;
    const b = executeSettlementFill('HPEUSDT', 64, order({ id: 'b', quantity: 1000 }), false, T0 + MIN, T0 + MIN).position;
    const { survivor } = mergeFilledPosition('HPEUSDT', [a], b);
    const half = scaleSettlementPosition(survivor, 1000);
    expect(half.fills!.map(f => f.openFeeUsd!)).toEqual([a.openFeeUsd! / 2, b.openFeeUsd! / 2].map(v => expect.closeTo(v, 9)));
    expect(half.openFeeUsd).toBeCloseTo((a.openFeeUsd! + b.openFeeUsd!) / 2, 9);
  });

  it('部分平仓：记录只带走平掉那部分的开仓费，其余留在仓位上；两次相加等于原来的整笔', () => {
    const { position } = executeSettlementFill('HPEUSDT', 62, order(), false, T0, T0);
    const first = settlePositionClose('HPEUSDT', position, 62.5, 400, T0 + MIN)!;
    expect(first.records[0].openFeeUsd).toBeCloseTo(position.openFeeUsd! * 0.4, 9);
    const rest = scaleSettlementPosition(position, first.remainingUnits);
    expect(rest.openFeeUsd).toBeCloseTo(position.openFeeUsd! * 0.6, 9);
    const second = settlePositionClose('HPEUSDT', rest, 63, first.remainingUnits, T0 + 2 * MIN)!;
    expect(first.records[0].openFeeUsd! + second.records[0].openFeeUsd!).toBeCloseTo(position.openFeeUsd!, 9);
  });

  it('旧仓位（没有开仓费字段）：记录里也没有，不凭空造一个数', () => {
    const legacy = {
      id: 'legacy', side: 'LONG', entryPrice: 62, quantity: 1000, leverage: 10, marginMode: 'isolated',
      settlementMode: 'usdt', margin: 6200, isolatedMargin: 6200, openTime: T0,
    } as Position;
    const settled = settlePositionClose('HPEUSDT', legacy, 62.5, 1000, T0 + MIN)!;
    expect(settled.records[0].openFeeUsd).toBeUndefined();
    expect(settled.records[0].openFeeRate).toBeUndefined();
    expect(settled.records[0].closeFeeRate).toBe(TAKER_FEE);   // 平仓这一侧是这次真实收的
  });
});
