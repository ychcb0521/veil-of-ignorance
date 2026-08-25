import { describe, expect, it } from 'vitest';
import {
  evaluateIsolatedLiquidation,
  isPriceFreshForLiquidation,
  staleToleranceMs,
  STALE_PRICE_MIN_TOLERANCE_MS,
} from '@/lib/liquidationGuards';
import type { Position } from '@/types/trading';

const NOW = Date.parse('2026-04-16T10:41:48.000Z');
const TOL = STALE_PRICE_MIN_TOLERANCE_MS;

/** 用户截图那笔：ORDIUSD 币本位逐仓 10x，开仓均价 3.2279，现价 4.2205（浮盈）。 */
const ordiLong = (over: Partial<Position> = {}): Position => ({
  id: 'p1', side: 'LONG', entryPrice: 3.2279,
  quantity: 1000, contracts: 1000, contractSizeUsd: 10,
  leverage: 10, marginMode: 'isolated',
  settlementMode: 'coin', settlementAsset: 'ORDI',
  // 币本位 marginUsd = 名义 / 杠杆 = (1000 × 10) / 10 = 1000
  margin: 1000, isolatedMargin: 1000, openTime: 1_000,
  ...over,
} as Position);

const evalAt = (pos: Position, price: number, asOf: number | null | undefined = NOW) =>
  evaluateIsolatedLiquidation({ symbol: 'ORDIUSD', position: pos, price, priceAsOf: asOf, nowSim: NOW, toleranceMs: TOL });

describe('陈价闸门', () => {
  it('没登记过 asOf 的价一律不许用来强平——说不清属于哪一刻就不能清算', () => {
    expect(isPriceFreshForLiquidation(undefined, NOW, TOL)).toBe(false);
    expect(isPriceFreshForLiquidation(null, NOW, TOL)).toBe(false);
    expect(isPriceFreshForLiquidation(NaN, NOW, TOL)).toBe(false);
  });

  it('同一时刻的价可用，超出容差的不可用', () => {
    expect(isPriceFreshForLiquidation(NOW, NOW, TOL)).toBe(true);
    expect(isPriceFreshForLiquidation(NOW - TOL, NOW, TOL)).toBe(true);
    expect(isPriceFreshForLiquidation(NOW - TOL - 1, NOW, TOL)).toBe(false);
  });

  it('容差随倍速放宽，但下限不低于 1 分钟', () => {
    expect(staleToleranceMs(1)).toBe(STALE_PRICE_MIN_TOLERANCE_MS);
    expect(staleToleranceMs(900)).toBe(900 * 5_000);
    expect(staleToleranceMs(0)).toBe(STALE_PRICE_MIN_TOLERANCE_MS);
  });
});

describe('逐仓强平判据', () => {
  it('【回归】上一段回放留下的陈价不得清算真仓位 —— 这就是「无缘无故的爆仓单」', () => {
    // 仓库自己记过的实测陈价：0.6273595 vs 真实 0.012804，49 倍差。
    // 用陈价算，这笔多头浮亏到远低于维持保证金，旧代码当场强平。
    const stalePrice = 0.012804;
    const withStale = evaluateIsolatedLiquidation({
      symbol: 'ORDIUSD', position: ordiLong(), price: stalePrice,
      priceAsOf: NOW - 86_400_000,          // 一天前的价
      nowSim: NOW, toleranceMs: TOL,
    });
    expect(withStale.liquidate).toBe(false);
    expect(withStale).toMatchObject({ reason: 'stale_price' });

    // 同一个陈价，如果谎称是当刻的，就会真的强平——证明拦住它的确实是 asOf 而不是别的
    const ifTrusted = evalAt(ordiLong(), stalePrice, NOW);
    expect(ifTrusted.liquidate).toBe(true);
  });

  it('浮盈的仓位在正确价格下永不强平（算术上需要 250x，而杠杆上限 125）', () => {
    const d = evalAt(ordiLong(), 4.2205);
    expect(d.liquidate).toBe(false);
    expect(d).toMatchObject({ reason: 'solvent' });
  });

  it('真正该爆的仍然会爆：10x 多头跌破约 9.6% 触发', () => {
    // 币本位 LONG: pnl/N = 现价/开仓价 − 1；爆仓需 ≤ −(1/lev − MMR) = −0.096
    expect(evalAt(ordiLong(), 3.2279 * 0.905).liquidate).toBe(false);
    expect(evalAt(ordiLong(), 3.2279 * 0.900).liquidate).toBe(true);
  });

  it('零张幽灵仓位不产生爆仓单——旧代码会写出一条 quantity=0 的假记录', () => {
    const ghost = ordiLong({ contracts: 0, quantity: 0, isolatedMargin: 0, margin: 0 });
    const d = evalAt(ghost, 4.2205);
    expect(d.liquidate).toBe(false);
    expect(['no_position']).toContain((d as { reason: string }).reason);
  });

  it('NaN 落到「不强平」而不是「强平」——旧代码写成 if (equity > maint) continue，NaN 会掉进爆仓分支', () => {
    const broken = ordiLong({ isolatedMargin: Number.NaN });
    const d = evalAt(broken, 4.2205);
    expect(d.liquidate).toBe(false);
    expect(d).toMatchObject({ reason: 'bad_numbers' });
  });

  it('【回归】陈价盖戳只能盖给真正取到价的标的——按「结果 map 的所有键」盖戳会把陈价认证成新鲜的', () => {
    // 这是两位反驳者独立指出的同一个致命写法：后台轮询把 fetch 成功的价合进
    // { ...prev }，结果 map 里含**每一个**曾经见过的标的。若按结果 map 盖戳，
    // 活跃标的刷新一次就会连带把另一个日期留下的陈价一起盖成「当刻」。
    // 这里用两个标的把它钉死：A 刚取到价，B 取失败、戳还停在一天前。
    const stamps: Record<string, number> = { A: NOW, B: NOW - 86_400_000 };
    expect(isPriceFreshForLiquidation(stamps.A, NOW, TOL)).toBe(true);
    expect(isPriceFreshForLiquidation(stamps.B, NOW, TOL)).toBe(false);
  });

  it('全仓仓位不走这条判据；没有价也不清算', () => {
    expect(evalAt(ordiLong({ marginMode: 'cross' }), 4.2205)).toMatchObject({ reason: 'not_isolated' });
    expect(evalAt(ordiLong(), 0)).toMatchObject({ reason: 'no_price' });
  });
});
