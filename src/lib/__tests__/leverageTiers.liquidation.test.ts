import { describe, expect, it } from 'vitest';
import { calcLiquidationPrice, type Position } from '@/types/trading';
import {
  binanceIsolatedLiquidationPriceCoinm,
  binanceIsolatedLiquidationPriceUsdm,
  resolveSymbolTiers,
  usdFaceIsolatedLiquidationPriceCoin,
} from '@/lib/leverageTiers';
import {
  LEGACY_HEDGE_RISK_MODEL,
  LEGACY_MAINTENANCE_MARGIN_RATE,
  TIERED_RISK_MODEL,
  hasRiskProvenance,
  isLegacyHedgeRisk,
  isPreUpdateRisk,
  isTieredRiskPosition,
  mergeRiskBlocked,
  positionMaintenanceMarginUsd,
  positionMaintenanceRateAt,
  positionRiskStamp,
  sharedRiskStamp,
  summarizeRiskModels,
} from '@/lib/positionRiskModel';
import {
  evaluateIsolatedLiquidation,
  evaluateIsolatedLiquidationOnCandle,
  type LiquidationCandle,
} from '@/lib/liquidationGuards';
import { maxSafeLeverageForPosition } from '@/lib/leverageRestatement';
import { firstLiquidationPrice } from '@/lib/positionGroupRisk';
import {
  executeSettlementFill,
  mergeFilledPosition,
  scaleSettlementPosition,
  settlementMarginRatioPct,
} from '@/lib/tradingSettlement';
import { checkOrderPositionLimit } from '@/lib/positionLimit';
import { liquidationNoticeCopy, mergeLiquidationDetails } from '@/lib/liquidationNotice';

/**
 * 期望值全部按币安公开的逐仓强平公式手算（写成分数，便于逐项核对），不从被测代码反推。
 *
 * U 本位：多 LP = (Q·E − WB − cum) / (Q·(1 − mmr))；空 LP = (Q·E + WB + cum) / (Q·(1 + mmr))
 * 币本位：多 LP = N(1 + mmr) / (WB + cum + N/E)；空 LP = N(1 − mmr) / (N/E − WB − cum)
 * 算出来的价位上名义落进别的档位，就换那一档重算。
 */

const kaito = resolveSymbolTiers('KAITOUSDT', 'usdt').tiers;
const btcCoin = resolveSymbolTiers('BTCUSDT', 'coin').tiers;
const kaitoProxy = resolveSymbolTiers('KAITOUSDT', 'coin').tiers;

type Side = 'LONG' | 'SHORT';

/** KAITOUSDT U 本位逐仓仓位，保证金恰为 名义 / 杠杆。 */
const usdmPos = (side: Side, quantity: number, entryPrice: number, leverage: number, over: Partial<Position> = {}): Position => {
  const margin = (quantity * entryPrice) / leverage;
  return {
    id: `u-${side}`, side, entryPrice, quantity, leverage, marginMode: 'isolated',
    settlementMode: 'usdt', settlementAsset: 'USDT',
    margin, isolatedMargin: margin, openTime: 1_000,
    ...positionRiskStamp('KAITOUSDT'),
    ...over,
  };
};

/** 币本位逐仓仓位（marginCoin = N / (E·L)）。 */
const coinPos = (
  symbol: string, side: Side, contracts: number, contractSizeUsd: number, entryPrice: number, leverage: number,
  over: Partial<Position> = {},
): Position => {
  const n = contracts * contractSizeUsd;
  const marginCoin = n / (entryPrice * leverage);
  return {
    id: `c-${side}`, side, entryPrice, quantity: contracts, contracts, contractSizeUsd, leverage,
    marginMode: 'isolated', settlementMode: 'coin', settlementAsset: symbol.replace(/USDT$/, ''),
    margin: marginCoin * entryPrice, isolatedMargin: marginCoin * entryPrice, marginCoin, openTime: 1_000,
    ...positionRiskStamp(symbol),
    ...over,
  };
};

const legacy = (p: Position): Position => {
  const { riskModel: _m, riskSymbol: _s, ...rest } = p;
  return rest;
};

describe('币安逐仓强平价 · U 本位（KAITOUSDT）', () => {
  it('多：10,000 KAITO @1，20x（保证金 500），名义落在第 2 档（1.5%，25）', () => {
    const lp = binanceIsolatedLiquidationPriceUsdm({ side: 'LONG', quantity: 10_000, entryPrice: 1, walletBalance: 500, tiers: kaito });
    expect(lp).toBeCloseTo(9_475 / 9_850, 12); // 0.961929
    expect(calcLiquidationPrice(usdmPos('LONG', 10_000, 1, 20))).toBeCloseTo(9_475 / 9_850, 12);
  });

  it('多·跨档：12,000 KAITO @1，5x——开仓名义在第 3 档，强平处名义 9,720 落回第 2 档，按第 2 档重算', () => {
    const tier3Only = 9_525 / 11_760; // 0.809949，不换档会得到的数
    const expected = 9_575 / 11_820; // 0.810068
    const lp = binanceIsolatedLiquidationPriceUsdm({ side: 'LONG', quantity: 12_000, entryPrice: 1, walletBalance: 2_400, tiers: kaito });
    expect(lp).toBeCloseTo(expected, 12);
    expect(lp).not.toBeCloseTo(tier3Only, 6);
    expect(12_000 * lp).toBeLessThan(10_000); // 确实在第 2 档
    expect(calcLiquidationPrice(usdmPos('LONG', 12_000, 1, 5))).toBeCloseTo(expected, 12);
  });

  it('空：4,000 KAITO @1，20x，第 1 档（1%，0）', () => {
    expect(calcLiquidationPrice(usdmPos('SHORT', 4_000, 1, 20))).toBeCloseTo(4_200 / 4_040, 12);
  });

  it('空·跨档：10,000 KAITO @1，10x——开仓名义恰为第 2 档上限，强平处名义 10,858 进入第 3 档', () => {
    const tier2Only = 11_025 / 10_150; // 1.086207
    const expected = 11_075 / 10_200; // 1.085784
    const lp = binanceIsolatedLiquidationPriceUsdm({ side: 'SHORT', quantity: 10_000, entryPrice: 1, walletBalance: 1_000, tiers: kaito });
    expect(lp).toBeCloseTo(expected, 12);
    expect(lp).not.toBeCloseTo(tier2Only, 6);
    expect(calcLiquidationPrice(usdmPos('SHORT', 10_000, 1, 10))).toBeCloseTo(expected, 12);
  });

  it('保证金足够厚的多单：结果为负，不截到 0（与旧公式同一取向）', () => {
    const lp = binanceIsolatedLiquidationPriceUsdm({ side: 'LONG', quantity: 100, entryPrice: 1, walletBalance: 150, tiers: kaito });
    expect(lp).toBeCloseTo((100 - 150) / (100 * 0.99), 12);
  });

  it('坏输入返回 NaN', () => {
    expect(binanceIsolatedLiquidationPriceUsdm({ side: 'LONG', quantity: 0, entryPrice: 1, walletBalance: 1, tiers: kaito })).toBeNaN();
    expect(binanceIsolatedLiquidationPriceUsdm({ side: 'LONG', quantity: 1, entryPrice: 1, walletBalance: NaN, tiers: kaito })).toBeNaN();
  });
});

describe('币安逐仓强平价 · 币本位（BTCUSD_PERP，档位与 cum 以 BTC 计）', () => {
  it('多：100 张 × 100 USD @50,000，20x（0.01 BTC），第 1 档', () => {
    const pos = coinPos('BTCUSDT', 'LONG', 100, 100, 50_000, 20);
    expect(pos.marginCoin).toBeCloseTo(0.01, 15);
    expect(calcLiquidationPrice(pos)).toBeCloseTo(10_040 / 0.21, 6); // 47,809.52
  });

  it('空：同上做空', () => {
    expect(calcLiquidationPrice(coinPos('BTCUSDT', 'SHORT', 100, 100, 50_000, 20))).toBeCloseTo(9_960 / 0.19, 6); // 52,421.05
  });

  it('多·跨档：2,450 张 @50,000（4.9 BTC，第 1 档），10x；强平处 5.368 BTC 进入第 2 档（0.5%，0.005）', () => {
    const tier1Only = (245_000 * 1.004) / 5.39; // 45,636.36
    const expected = (245_000 * 1.005) / 5.395; // 45,639.48
    const lp = binanceIsolatedLiquidationPriceCoinm({
      side: 'LONG', contracts: 2_450, contractSizeUsd: 100, entryPrice: 50_000, walletBalanceCoin: 0.49, tiers: btcCoin,
    });
    expect(lp).toBeCloseTo(expected, 6);
    expect(lp).not.toBeCloseTo(tier1Only, 1);
    expect(245_000 / lp).toBeGreaterThan(5);
    expect(calcLiquidationPrice(coinPos('BTCUSDT', 'LONG', 2_450, 100, 50_000, 10))).toBeCloseTo(expected, 6);
  });

  it('空·跨档：13,000 张 @50,000（26 BTC，第 4 档），20x；强平处 24.89 BTC 落回第 3 档（1%，0.055）', () => {
    const tier4Only = (1_300_000 * 0.975) / (26 - 1.3 - 0.43); // 52,224.97
    const expected = (1_300_000 * 0.99) / (26 - 1.3 - 0.055); // 52,221.55
    const pos = coinPos('BTCUSDT', 'SHORT', 13_000, 100, 50_000, 20);
    const lp = calcLiquidationPrice(pos);
    expect(lp).toBeCloseTo(expected, 6);
    expect(lp).not.toBeCloseTo(tier4Only, 1);
    // 强平价上：币本位权益 = 维持保证金（以币计）
    const c = 1_300_000 / lp;
    expect(1.3 + c - 26).toBeCloseTo(c * 0.01 - 0.055, 9);
  });

  it('1x 空单（保证金 ≥ 名义）永不强平：NaN，与旧公式一致', () => {
    expect(calcLiquidationPrice(coinPos('BTCUSDT', 'SHORT', 10, 100, 50_000, 1))).toBeNaN();
    expect(binanceIsolatedLiquidationPriceCoinm({
      side: 'SHORT', contracts: 10, contractSizeUsd: 100, entryPrice: 50_000, walletBalanceCoin: 0.02, tiers: btcCoin,
    })).toBe(Infinity);
  });
});

describe('合成币本位（KAITOUSD，按 KAITOUSDT 分层、USD 名义）', () => {
  // 用户那一单：163,578 张 × 10 USD = 1,635,780 USD → 第 9 档（25%，118,100），只能 2x。
  it('多 / 空，2x @1', () => {
    const expectLong = (1_635_780 * 1.25 - 118_100) / (817_890 + 1_635_780);
    const expectShort = (1_635_780 * 0.75 + 118_100) / (1_635_780 - 817_890);
    expect(calcLiquidationPrice(coinPos('KAITOUSDT', 'LONG', 163_578, 10, 1, 2))).toBeCloseTo(expectLong, 12);
    expect(calcLiquidationPrice(coinPos('KAITOUSDT', 'SHORT', 163_578, 10, 1, 2))).toBeCloseTo(expectShort, 12);
    expect(usdFaceIsolatedLiquidationPriceCoin({
      side: 'LONG', contracts: 163_578, contractSizeUsd: 10, entryPrice: 1, walletBalanceCoin: 817_890, tiers: kaitoProxy,
    })).toBeCloseTo(expectLong, 12);
  });

  it('cum = 0 的第 1 档与旧的 0.4% 币本位公式同形', () => {
    // 400 张 × 10 = 4,000 USD，第 1 档 1%：多 LP = N(1+mmr)/(币保证金 + N/E)
    const pos = coinPos('KAITOUSDT', 'LONG', 400, 10, 2, 10);
    expect(calcLiquidationPrice(pos)).toBeCloseTo((4_000 * 1.01) / (200 + 2_000), 12);
  });
});

describe('引擎判据与显示的强平价是同一个数（分层仓位）', () => {
  const candleAt = (low: number, high: number): LiquidationCandle => ({
    low, high, close: (low + high) / 2, startTime: 2_000, endTime: 3_000, settled: true,
  });

  it('U 本位多单（跨档那笔）：低点略低于强平价就爆、略高就不爆，记账价 = 强平价', () => {
    const pos = usdmPos('LONG', 12_000, 1, 5);
    const lp = calcLiquidationPrice(pos);
    const hit = evaluateIsolatedLiquidationOnCandle({ symbol: 'KAITOUSDT', position: pos, candle: candleAt(lp * (1 - 1e-6), 1) });
    const miss = evaluateIsolatedLiquidationOnCandle({ symbol: 'KAITOUSDT', position: pos, candle: candleAt(lp * (1 + 1e-6), 1) });
    expect(hit.liquidate).toBe(true);
    expect(miss).toMatchObject({ liquidate: false, reason: 'solvent' });
    if (hit.liquidate) expect(hit.exitPrice).toBeCloseTo(lp, 12);
  });

  it('币本位空单（跨档那笔）：高点略高于强平价就爆、略低就不爆', () => {
    const pos = coinPos('BTCUSDT', 'SHORT', 13_000, 100, 50_000, 20);
    const lp = calcLiquidationPrice(pos);
    const hit = evaluateIsolatedLiquidationOnCandle({ symbol: 'BTCUSDT', position: pos, candle: candleAt(50_000, lp * (1 + 1e-7)) });
    const miss = evaluateIsolatedLiquidationOnCandle({ symbol: 'BTCUSDT', position: pos, candle: candleAt(50_000, lp * (1 - 1e-7)) });
    expect(hit.liquidate).toBe(true);
    expect(miss).toMatchObject({ liquidate: false, reason: 'solvent' });
  });

  it('合成币本位多单：同样对得上', () => {
    const pos = coinPos('KAITOUSDT', 'LONG', 163_578, 10, 1, 2);
    const lp = calcLiquidationPrice(pos);
    expect(evaluateIsolatedLiquidationOnCandle({ symbol: 'KAITOUSDT', position: pos, candle: candleAt(lp * (1 - 1e-7), 1) }).liquidate).toBe(true);
    expect(evaluateIsolatedLiquidationOnCandle({ symbol: 'KAITOUSDT', position: pos, candle: candleAt(lp * (1 + 1e-7), 1) }).liquidate).toBe(false);
  });
});

describe('旧仓位（没有戳）一律按旧的 0.4% 模型，升级不改它们', () => {
  it('U 本位：LP = (N − 保证金 + N×0.4%) / Q，与分层结果不同', () => {
    const pos = legacy(usdmPos('LONG', 12_000, 1, 5));
    expect(isTieredRiskPosition(pos)).toBe(false);
    expect(calcLiquidationPrice(pos)).toBeCloseTo((12_000 - 2_400 + 48) / 12_000, 12); // 0.804
    expect(calcLiquidationPrice(pos, 'KAITOUSDT')).toBeCloseTo(0.804, 12); // 传了标的也不换模型
    expect(calcLiquidationPrice(usdmPos('LONG', 12_000, 1, 5))).not.toBeCloseTo(0.804, 4);
  });

  it('币本位：LP = N(1+0.4%)/(币保证金 + N/E)', () => {
    const pos = legacy(coinPos('BTCUSDT', 'LONG', 2_450, 100, 50_000, 10));
    expect(calcLiquidationPrice(pos)).toBeCloseTo((245_000 * 1.004) / 5.39, 6);
  });

  it('维持保证金：名义 × 0.4%，与档位无关', () => {
    const u = legacy(usdmPos('LONG', 12_000, 1, 5));
    expect(positionMaintenanceMarginUsd('KAITOUSDT', u, 0.9)).toBeCloseTo(10_800 * LEGACY_MAINTENANCE_MARGIN_RATE, 12);
    const c = legacy(coinPos('KAITOUSDT', 'LONG', 163_578, 10, 1, 2));
    expect(positionMaintenanceMarginUsd('KAITOUSDT', c, 0.5)).toBeCloseTo(1_635_780 * 0.004, 9);
    expect(positionMaintenanceRateAt('KAITOUSDT', u, 0.9)).toMatchObject({ model: 'legacy', rate: 0.004 });
  });

  it('提杠杆的安全上限：旧仓位仍按 0.4%', () => {
    // N_entry / (MM_mark − pnl − 盈余)：MM = 10,800 × 0.4% = 43.2，pnl = −1,200
    expect(maxSafeLeverageForPosition('KAITOUSDT', legacy(usdmPos('LONG', 12_000, 1, 5)), 0.9))
      .toBeCloseTo(12_000 / 1_243.2, 9);
  });
});

describe('positionMaintenanceMarginUsd（分层仓位）', () => {
  it('U 本位：现价名义所在档位', () => {
    // 12,000 × 0.9 = 10,800 → 第 3 档：10,800 × 2% − 75 = 141
    const pos = usdmPos('LONG', 12_000, 1, 5);
    expect(positionMaintenanceMarginUsd('KAITOUSDT', pos, 0.9)).toBeCloseTo(141, 9);
    expect(positionMaintenanceRateAt('KAITOUSDT', pos, 0.9)).toEqual({
      model: 'tiered', rate: 0.02, amount: 75, unit: 'USDT', bracket: 3,
    });
  });

  it('币本位：按现价折成币定档，cum 以币计再折回 USD', () => {
    // 2,450 张 × 100 ÷ 45,000 = 5.44 BTC → 第 2 档：245,000 × 0.5% − 0.005 × 45,000 = 1,000
    const pos = coinPos('BTCUSDT', 'LONG', 2_450, 100, 50_000, 10);
    expect(positionMaintenanceMarginUsd('BTCUSDT', pos, 45_000)).toBeCloseTo(1_000, 9);
    expect(positionMaintenanceMarginUsd('BTCUSDT', pos, 0)).toBeNaN();
    // 定不了档时照实说是分层、档位未知，不冒充旧模型的 0.4%
    expect(positionMaintenanceRateAt('BTCUSDT', pos, 0)).toMatchObject({ model: 'tiered', bracket: null, unit: 'BTC' });
    expect(positionMaintenanceRateAt('BTCUSDT', pos, 45_000)).toMatchObject({ model: 'tiered', bracket: 2, rate: 0.005, unit: 'BTC' });
  });

  it('合成币本位：与价格无关', () => {
    const pos = coinPos('KAITOUSDT', 'LONG', 163_578, 10, 1, 2);
    expect(positionMaintenanceMarginUsd('KAITOUSDT', pos, 0.5)).toBeCloseTo(1_635_780 * 0.25 - 118_100, 6);
    expect(positionMaintenanceMarginUsd('KAITOUSDT', pos, 3)).toBeCloseTo(290_845, 6);
  });

  it('提杠杆的安全上限按分层维持保证金', () => {
    // MM = 141，pnl = −1,200，盈余 0 → 12,000 / 1,341
    expect(maxSafeLeverageForPosition('KAITOUSDT', usdmPos('LONG', 12_000, 1, 5), 0.9)).toBeCloseTo(12_000 / 1_341, 9);
  });

  it('保证金比率可以接收按仓位算好的维持保证金；不传时仍是旧的 0.4%', () => {
    expect(settlementMarginRatioPct(10_800, 2_400, -1_200, 141)).toBeCloseTo((141 / 1_200) * 100, 9);
    expect(settlementMarginRatioPct(10_800, 2_400, -1_200)).toBeCloseTo((43.2 / 1_200) * 100, 9);
  });
});

describe('盖戳与合并', () => {
  /** 本次更新之后下的委托：引擎下单时盖了分层戳。 */
  const order = {
    side: 'LONG' as const, quantity: 1_000, leverage: 10, marginMode: 'isolated' as const, settlementMode: 'usdt' as const,
    riskModel: TIERED_RISK_MODEL,
  };
  /** 更新之前挂出的委托：没有戳。 */
  const { riskModel: _r, ...legacyOrder } = order;

  it('带戳的委托成交：仓位带分层戳与标的', () => {
    const { position } = executeSettlementFill('KAITOUSDT', 1, order, true, 1_000);
    expect(position.riskModel).toBe(TIERED_RISK_MODEL);
    expect(position.riskSymbol).toBe('KAITOUSDT');
    // 不传标的也能算：戳里记着
    expect(calcLiquidationPrice(position)).toBeCloseTo(calcLiquidationPrice(position, 'KAITOUSDT'), 12);
    const coin = executeSettlementFill('BTCUSDT', 50_000, { ...order, quantity: 10, settlementMode: 'coin' }, true, 1_000).position;
    expect(coin).toMatchObject({ riskModel: TIERED_RISK_MODEL, riskSymbol: 'BTCUSDT', contractSizeUsd: 100 });
  });

  it('更新前挂出的委托（没有戳）成交：仓位按旧模型', () => {
    const { position } = executeSettlementFill('KAITOUSDT', 1, legacyOrder, true, 1_000);
    expect(position.riskModel).toBeUndefined();
    expect(position.riskSymbol).toBeUndefined();
    expect(isTieredRiskPosition(position)).toBe(false);
  });

  /**
   * 【回归】旧委托的杠杆 / 规模按旧规则放行，放到新分层下开仓即爆：
   * 初始保证金率 1/L 低于所在档位的维持保证金率。这些单成交时按旧的 0.4% 开仓，
   * 与它们下单时的规则一致；升级本身不得让任何一笔在开仓价上被强平。
   */
  it.each([
    ['LUMIAUSDT', 35, 5_000],       // 旧默认杠杆 35x，新上限 10x、第 1 档 5%
    ['ACTUSDT', 35, 5_000],
    ['KAITOUSDT', 125, 1_000],      // 旧滑块上限 125x，新上限 75x、第 1 档 1%
    ['KAITOUSDT', 20, 240_000],     // 旧通用表允许，新分层 20x 最多 50,000
  ])('%s %sx 名义 %s 的旧委托：成交后在开仓价上不爆', (symbol, leverage, notional) => {
    const stale = { ...legacyOrder, leverage, quantity: notional };
    const { position } = executeSettlementFill(symbol, 1, stale, true, 60_000);
    const atEntry = evaluateIsolatedLiquidation({
      symbol, position, price: 1, priceAsOf: 120_000, nowSim: 120_000, toleranceMs: 60_000, riskSince: 60_000,
    });
    expect(atEntry.liquidate).toBe(false);
    expect(calcLiquidationPrice(position, symbol)).toBeLessThan(1);
    // 同一笔若带着分层戳，开仓价上就爆——这正是旧委托不能盖戳的原因
    const stamped = executeSettlementFill(symbol, 1, { ...stale, riskModel: TIERED_RISK_MODEL }, true, 60_000).position;
    expect(evaluateIsolatedLiquidation({
      symbol, position: stamped, price: 1, priceAsOf: 120_000, nowSim: 120_000, toleranceMs: 60_000, riskSince: 60_000,
    }).liquidate).toBe(true);
  });

  it('合成币本位的旧委托同样按旧模型', () => {
    const { position } = executeSettlementFill(
      'ACTUSDT', 1, { ...legacyOrder, leverage: 35, quantity: 500, settlementMode: 'coin' }, true, 60_000,
    );
    expect(position.riskModel).toBeUndefined();
    expect(evaluateIsolatedLiquidation({
      symbol: 'ACTUSDT', position, price: 1, priceAsOf: 120_000, nowSim: 120_000, toleranceMs: 60_000, riskSince: 60_000,
    }).liquidate).toBe(false);
  });

  it('【复核 r7】分层加仓并进更新前的仓位：存活的仍是更新前的仓位、整仓仍按旧的 0.4%', () => {
    const { position: fill } = executeSettlementFill('KAITOUSDT', 1, order, true, 2_000);
    const old = legacy({ ...fill, id: 'old', openTime: 1_000, fills: undefined });
    const mmBefore = positionMaintenanceMarginUsd('KAITOUSDT', old, 1);
    const merged = mergeFilledPosition('KAITOUSDT', [old], fill);
    // 规则二：并进去了，只剩一个仓位
    expect(merged.absorbedFillId).toBe(fill.id);
    expect(merged.blockedBy).toBeNull();
    expect(merged.positions).toHaveLength(1);
    // 规则一：存活的沿用被加仓那个仓位的来源——仍是更新前的仓位，仍按旧的 0.4%
    expect(merged.survivor.id).toBe('old');
    expect(isPreUpdateRisk(merged.survivor)).toBe(true);
    expect(isTieredRiskPosition(merged.survivor)).toBe(false);
    expect(positionMaintenanceMarginUsd('KAITOUSDT', merged.survivor, 1))
      .toBeCloseTo(merged.survivor.quantity * LEGACY_MAINTENANCE_MARGIN_RATE, 12);
    // 并进来的那一截也按 0.4%：整仓的维持保证金恰是「旧的那一截 + 新的那一截」，没有任何一截被按档位重新定价
    expect(positionMaintenanceMarginUsd('KAITOUSDT', merged.survivor, 1))
      .toBeCloseTo(mmBefore + fill.quantity * LEGACY_MAINTENANCE_MARGIN_RATE, 12);
  });

  /**
   * 【复核 r7 · 回归】加仓既不能换掉旧仓位的模型（r6 的血案），也不能让加仓自己站在旁边单独硬扛（r7 的血案）。
   * KAITOUSDT 20x 逐仓，更新前的多仓 40,000 @1.0、保证金 2,000，标记价 0.96：
   *   旧模型 维持保证金 38,400 × 0.4% = 153.60，权益 2,000 − 1,600 = 400，强平价 0.954，还活着；
   *   若并进一笔 1,000 USDT 的分层加仓**并改按分层**：39,400 × 2.5% − 200 = 785.00 > 权益 449.90，
   *     强平价 0.968 已在标记价之上——41,041 个币下一个价就被整个强平。这一幕现在不会发生（规则一）。
   *   而并进去之后整仓仍按 0.4%：维持保证金 = 合并后的名义 × 0.4%，强平价被这一刀推**远**。
   */
  it('【复核 r7 · 回归】分层加仓并进旧仓位：不换模型、不重新定价，强平价只会被推远', () => {
    const mark = 0.96;
    const old: Position = {
      ...legacy(usdmPos('LONG', 40_000, 1, 20, { id: 'pre-update' })),
      margin: 2_000, isolatedMargin: 2_000,
    };
    const before = {
      mm: positionMaintenanceMarginUsd('KAITOUSDT', old, mark),
      liq: calcLiquidationPrice(old, 'KAITOUSDT'),
      verdict: evaluateIsolatedLiquidation({
        symbol: 'KAITOUSDT', position: old, price: mark, priceAsOf: 120_000, nowSim: 120_000, toleranceMs: 60_000, riskSince: 1_000,
      }),
    };
    expect(before.mm).toBeCloseTo(153.6, 9);
    expect(before.liq).toBeCloseTo(0.954, 9);
    expect(before.verdict.liquidate).toBe(false);

    // 1,000 USDT 的分层加仓（20x 上限 50,000，38,400 + 1,000 过得去）
    const { position: add } = executeSettlementFill(
      'KAITOUSDT', mark, { ...order, quantity: 1_000 / mark, leverage: 20 }, true, 2_000,
    );
    const merged = mergeFilledPosition('KAITOUSDT', [old], { ...add, id: 'add' });
    expect(merged.absorbedFillId).toBe('add');
    expect(merged.positions.map(p => p.id)).toEqual(['pre-update']);

    const after = merged.survivor;
    // 模型没换：仍是更新前的仓位，维持保证金仍是「名义 × 0.4%」
    expect(isPreUpdateRisk(after)).toBe(true);
    expect(positionMaintenanceMarginUsd('KAITOUSDT', after, mark))
      .toBeCloseTo(after.quantity * mark * LEGACY_MAINTENANCE_MARGIN_RATE, 9);
    // 强平价被这一刀推远（多单的强平价变低），而且仍然活着
    const afterLiq = calcLiquidationPrice(after, 'KAITOUSDT');
    expect(afterLiq).toBeLessThan(before.liq);
    expect(evaluateIsolatedLiquidation({
      symbol: 'KAITOUSDT', position: after, price: mark, priceAsOf: 180_000, nowSim: 180_000, toleranceMs: 60_000, riskSince: 1_000,
    }).liquidate).toBe(false);
    // 合并才会出现的那一幕（改按分层后 785 > 权益 449.90）：模型没换，所以不会发生
    const wouldBeTiered = { ...old, quantity: 40_000 + 1_000 / mark, riskModel: TIERED_RISK_MODEL, riskSymbol: 'KAITOUSDT' };
    expect(positionMaintenanceMarginUsd('KAITOUSDT', wouldBeTiered, mark)).toBeCloseTo(785, 6);
    expect(positionMaintenanceMarginUsd('KAITOUSDT', after, mark)).toBeLessThan(200);
  });

  /**
   * 【复核 r7】加到**浮盈**旧仓位上的那一刀：r6 让它单独成仓、只靠自己那点保证金硬扛，
   * 一次 4% 的回撤就把它打掉；规则二把它并回去之后，整仓的强平价远在标记价之下。
   * KAITOUSDT 20x 逐仓，更新前的多仓 40,000 @0.50、保证金 1,000，标记价 0.96（+92%），加 10,000 USDT。
   */
  it('【复核 r7】加到浮盈旧仓位上的一刀被旧仓位的权益扛着：不再有一条 3.81% 就死的新腿', () => {
    const mark = 0.96;
    const old: Position = {
      ...legacy(usdmPos('LONG', 40_000, 0.5, 20, { id: 'winner' })),
      margin: 1_000, isolatedMargin: 1_000,
    };
    const { position: add } = executeSettlementFill(
      'KAITOUSDT', mark, { ...order, quantity: 10_000 / mark, leverage: 20 }, true, 2_000,
    );
    // 单独成仓（r6 的画面）：自己的强平价离标记价只有 3.81%
    const aloneLiq = calcLiquidationPrice({ ...add, id: 'alone' }, 'KAITOUSDT');
    expect((mark - aloneLiq) / mark).toBeLessThan(0.05);
    const merged = mergeFilledPosition('KAITOUSDT', [old], { ...add, id: 'add' });
    expect(merged.blockedBy).toBeNull();
    expect(merged.positions).toHaveLength(1);
    const mergedLiq = calcLiquidationPrice(merged.survivor, 'KAITOUSDT');
    // 并进去之后：整仓的强平价远在下面，回撤 4% 什么都不会发生
    expect(mergedLiq).toBeLessThan(aloneLiq);
    expect((mark - mergedLiq) / mark).toBeGreaterThan(0.3);
    const retrace = mark * 0.96;
    expect(evaluateIsolatedLiquidation({
      symbol: 'KAITOUSDT', position: merged.survivor, price: retrace, priceAsOf: 180_000, nowSim: 180_000, toleranceMs: 60_000, riskSince: 1_000,
    }).liquidate).toBe(false);
    expect(evaluateIsolatedLiquidation({
      symbol: 'KAITOUSDT', position: { ...add, id: 'alone' }, price: retrace, priceAsOf: 180_000, nowSim: 180_000, toleranceMs: 60_000, riskSince: 1_000,
    }).liquidate).toBe(true);
  });

  /**
   * 【复核 r7】合并矩阵，一处定死（positionRiskModel.mergeRiskBlocked 的注释是同一张表）。
   * **有方向**：只有「目标是分层、这一笔按旧 0.4%」那两格不并。
   *   更新前 × 更新前 → 并，仍是更新前（旧委托成交并进旧仓位，豁免的底随之变大）
   *   更新前 × 分层   → 并，仍是更新前（整仓 0.4%，不重新定价；底冻结不变）
   *   更新前 × 豁免   → 并，仍是更新前（同是 0.4%；底冻结不变）
   *   豁免   × 任何   → 并，仍是豁免
   *   分层   × 分层   → 并，仍是分层
   *   分层   × 更新前 → 不并
   *   分层   × 豁免   → 不并
   * 每一格都断言：存活仓位的来源等于**目标**的来源（规则一），
   * 不合并的那几格目标对象逐字节不变、维持保证金与强平价一个数都不动，
   * 而且同一块盘面上的旁观仓位（反方向的、同方向但杠杆不同的）从不因为这一笔成交而改变。
   */
  it('【复核 r7】合并矩阵：只有「分层仓位 ← 旧 0.4% 的一笔」不并；存活的一律沿用目标的模型，旁观仓位一个数都不变', () => {
    const exemptOrder = { ...order, riskModel: LEGACY_HEDGE_RISK_MODEL };
    const make = (kind: 'tiered' | 'exempt' | 'pre', id: string, openTime: number) => {
      const src = kind === 'tiered' ? order : kind === 'exempt' ? exemptOrder : legacyOrder;
      return { ...executeSettlementFill('KAITOUSDT', 1, src, true, openTime).position, id };
    };
    const kinds = ['tiered', 'exempt', 'pre'] as const;
    const expected = { tiered: TIERED_RISK_MODEL, exempt: LEGACY_HEDGE_RISK_MODEL, pre: undefined } as const;
    const blocked = (a: typeof kinds[number], b: typeof kinds[number]) => a === 'tiered' && b !== 'tiered';
    for (const target of kinds) {
      for (const fill of kinds) {
        const targetPos = make(target, 'target', 1_000);
        const fillPos = make(fill, 'fill', 2_000);
        // 旁观者：反方向一笔、同方向但杠杆不同一笔（合并键会挡掉它）
        const otherSide = { ...make('tiered', 'other-side', 500), side: 'SHORT' as const };
        const otherLev = { ...make('pre', 'other-lev', 600), leverage: 7 };
        const snapshot = (p: Position) => ({
          mm: positionMaintenanceMarginUsd('KAITOUSDT', p, 1),
          liq: calcLiquidationPrice(p, 'KAITOUSDT'),
          model: p.riskModel,
        });
        const bystandersBefore = [snapshot(otherSide), snapshot(otherLev)];
        const mmBefore = positionMaintenanceMarginUsd('KAITOUSDT', targetPos, 1);
        const liqBefore = calcLiquidationPrice(targetPos, 'KAITOUSDT');
        const merged = mergeFilledPosition('KAITOUSDT', [targetPos, otherSide, otherLev], fillPos);
        expect(mergeRiskBlocked(targetPos, fillPos), `${target} ← ${fill}`).toBe(blocked(target, fill));

        // 旁观仓位：任何一格都一个数都不变
        const byId = Object.fromEntries(merged.positions.map(p => [p.id, p]));
        expect([snapshot(byId['other-side']), snapshot(byId['other-lev'])], `${target} ← ${fill}`)
          .toEqual(bystandersBefore);

        if (blocked(target, fill)) {
          expect(merged.absorbedFillId, `${target} ← ${fill}`).toBeNull();
          expect(merged.blockedBy).toBe('riskModel');
          expect(byId['target'], `${target} ← ${fill}`).toEqual(targetPos);
          expect(positionMaintenanceMarginUsd('KAITOUSDT', byId['target'], 1)).toBeCloseTo(mmBefore, 12);
          expect(calcLiquidationPrice(byId['target'], 'KAITOUSDT')).toBeCloseTo(liqBefore, 12);
          expect(byId['fill'].riskModel).toBe(expected[fill]);
          continue;
        }
        expect(merged.absorbedFillId, `${target} ← ${fill}`).toBe('fill');
        expect(merged.blockedBy).toBeNull();
        // 【规则一】存活的沿用**目标**的来源，与这一笔是什么来源无关
        expect(merged.survivor.riskModel, `${target} ← ${fill}`).toBe(expected[target]);
        expect(merged.survivor.riskSymbol).toBe(target === 'pre' ? undefined : 'KAITOUSDT');
        // 合并得到的存活仓位就是两笔之和，**按目标的模型**算：非分层的目标整仓仍是 0.4%
        if (target !== 'tiered') {
          expect(positionMaintenanceMarginUsd('KAITOUSDT', merged.survivor, 1), `${target} ← ${fill}`)
            .toBeCloseTo(mmBefore + fillPos.quantity * LEGACY_MAINTENANCE_MARGIN_RATE, 9);
        }
      }
    }
    // 更新前挂出、更新后才成交的旧委托并进更新前的仓位：照旧是更新前的仓位（豁免的底随之变大）
    const grown = mergeFilledPosition('KAITOUSDT', [make('pre', 'target', 1_000)], make('pre', 'fill', 2_000));
    expect(isPreUpdateRisk(grown.survivor)).toBe(true);
    expect(grown.survivor.quantity).toBeCloseTo(2 * make('pre', 'x', 1).quantity, 9);
    // 豁免并进更新前的仓位：存活的仍是更新前的仓位（规则一），底不跟着变大（规则四，另有专门的用例）
    const absorbed = mergeFilledPosition('KAITOUSDT', [make('pre', 'target', 1_000)], make('exempt', 'fill', 2_000));
    expect(isPreUpdateRisk(absorbed.survivor)).toBe(true);
    expect(isLegacyHedgeRisk(absorbed.survivor)).toBe(false);
    // 分层仓位旁边成交的旧委托：照旧自己开一个更新前的仓位（仍是豁免的底），不会被合并成分层的
    const besideTiered = mergeFilledPosition('KAITOUSDT', [make('tiered', 'target', 1_000)], make('pre', 'fill', 2_000));
    expect(besideTiered.blockedBy).toBe('riskModel');
    expect(isPreUpdateRisk(besideTiered.positions.find(p => p.id === 'fill')!)).toBe(true);
  });

  /**
   * 【复核 r7 · 规则四】走一遍真链路：更新前的多仓 200,000 → 分层加仓 10,000 并进来 → 减仓一半。
   * 仓位一路变化，而**对冲豁免的底**只会不变或变小，绝不因为加仓变大（第 5 轮 F5 那个循环）。
   */
  it('【复核 r7 · 规则四】分层加仓并进旧仓位后，对冲豁免的底冻在加仓之前；减仓按比例缩', () => {
    const hedgeBase = (positions: Position[]) => checkOrderPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions, orders: [], markPrice: 1,
      orderNotionalUsd: 1, orderPrice: 1, side: 'SHORT',
    }).legacyHedgeBase;

    const old = legacy(usdmPos('LONG', 200_000, 1, 20, { id: 'pre-update' }));
    expect(hedgeBase([old])).toBeCloseTo(200_000, 6);

    const { position: add } = executeSettlementFill('KAITOUSDT', 1, { ...order, quantity: 10_000, leverage: 20 }, true, 2_000);
    const merged = mergeFilledPosition('KAITOUSDT', [old], { ...add, id: 'add' });
    expect(merged.blockedBy).toBeNull();
    expect(merged.survivor.quantity).toBeCloseTo(210_000, 6);
    expect(merged.survivor.hedgeBaseUnits).toBeCloseTo(200_000, 6);
    expect(hedgeBase([merged.survivor])).toBeCloseTo(200_000, 6);

    // 再加一刀：底还是 200,000（不冻的话这里会变成 220,000，一轮轮接下去）
    const { position: add2 } = executeSettlementFill('KAITOUSDT', 1, { ...order, quantity: 10_000, leverage: 20 }, true, 3_000);
    const merged2 = mergeFilledPosition('KAITOUSDT', [merged.survivor], { ...add2, id: 'add2' });
    expect(merged2.survivor.quantity).toBeCloseTo(220_000, 6);
    expect(hedgeBase([merged2.survivor])).toBeCloseTo(200_000, 6);

    // 减一半：底按比例缩到 100,000（不缩的话按一个早已不存在的旧仓位放行对冲）
    const halved = scaleSettlementPosition(merged2.survivor, 110_000);
    expect(halved.hedgeBaseUnits).toBeCloseTo(100_000, 6);
    expect(hedgeBase([halved])).toBeCloseTo(100_000, 6);

    // 更新前挂出的旧委托成交并进来：这一笔本身是底，底照旧随之变大
    const { position: stale } = executeSettlementFill('KAITOUSDT', 1, { ...legacyOrder, quantity: 10_000, leverage: 20 }, true, 4_000);
    const grown = mergeFilledPosition('KAITOUSDT', [halved], { ...stale, id: 'stale' });
    expect(grown.survivor.hedgeBaseUnits).toBeCloseTo(110_000, 6);
    expect(hedgeBase([grown.survivor])).toBeCloseTo(110_000, 6);
  });

  it('【复核 r5 · 二】豁免对冲不并进分层仓位：大额豁免空单与一笔分层小空单各算各的维持保证金，不会被一起套上分层', () => {
    // KAITOUSDT 5x：分层空 9,000 @1.0；豁免空 230,000 @1.0。若并在一起按分层：239,000 × 10% − 7,700 = 16,200 远超豁免那一截该付的 920
    const tieredShort = { ...executeSettlementFill('KAITOUSDT', 1, { ...order, side: 'SHORT', quantity: 9_000, leverage: 5 }, true, 1_000).position, id: 'tiered-short' };
    const exemptFill = { ...executeSettlementFill('KAITOUSDT', 1, { ...order, side: 'SHORT', quantity: 230_000, leverage: 5, riskModel: LEGACY_HEDGE_RISK_MODEL }, true, 2_000).position, id: 'exempt-short' };
    const merged = mergeFilledPosition('KAITOUSDT', [tieredShort], exemptFill);
    expect(merged.blockedBy).toBe('riskModel');
    const byId = Object.fromEntries(merged.positions.map(p => [p.id, p]));
    expect(positionMaintenanceMarginUsd('KAITOUSDT', byId['exempt-short'], 1)).toBeCloseTo(230_000 * LEGACY_MAINTENANCE_MARGIN_RATE, 9);
    expect(positionMaintenanceMarginUsd('KAITOUSDT', byId['tiered-short'], 1)).toBeCloseTo(9_000 * 0.015 - 25, 9);
    const wouldBe = { ...tieredShort, quantity: 239_000, riskModel: TIERED_RISK_MODEL };
    expect(positionMaintenanceMarginUsd('KAITOUSDT', wouldBe, 1)).toBeCloseTo(239_000 * 0.1 - 7_700, 9);
    expect(mergeRiskBlocked({ riskModel: undefined }, { riskModel: LEGACY_HEDGE_RISK_MODEL })).toBe(false);
    expect(mergeRiskBlocked(null, { riskModel: TIERED_RISK_MODEL })).toBe(false);
    // 有方向：分层的一笔并进按 0.4% 的仓位是允许的，反过来才挡
    expect(mergeRiskBlocked({ riskModel: undefined }, { riskModel: TIERED_RISK_MODEL })).toBe(false);
    expect(mergeRiskBlocked({ riskModel: TIERED_RISK_MODEL }, { riskModel: undefined })).toBe(true);
    expect(mergeRiskBlocked({ riskModel: TIERED_RISK_MODEL }, { riskModel: LEGACY_HEDGE_RISK_MODEL })).toBe(true);
  });

  it('【复核 r5】来源的判别：更新前 = 没有任何 riskModel；豁免单按旧模型算维持保证金，但不是更新前的仓位', () => {
    const { position: exempt } = executeSettlementFill('KAITOUSDT', 1, { ...order, riskModel: LEGACY_HEDGE_RISK_MODEL }, true, 1_000);
    expect(exempt).toMatchObject({ riskModel: LEGACY_HEDGE_RISK_MODEL, riskSymbol: 'KAITOUSDT' });
    expect(isLegacyHedgeRisk(exempt)).toBe(true);
    expect(isPreUpdateRisk(exempt)).toBe(false);
    expect(hasRiskProvenance(exempt)).toBe(true);
    expect(isTieredRiskPosition(exempt)).toBe(false);
    expect(positionMaintenanceMarginUsd('KAITOUSDT', exempt, 1)).toBeCloseTo(1_000 * LEGACY_MAINTENANCE_MARGIN_RATE, 12);
    const { position: pre } = executeSettlementFill('KAITOUSDT', 1, legacyOrder, true, 1_000);
    expect(isPreUpdateRisk(pre)).toBe(true);
    expect(hasRiskProvenance(pre)).toBe(false);
    expect(isPreUpdateRisk({ riskModel: TIERED_RISK_MODEL })).toBe(false);
    expect(summarizeRiskModels([exempt, pre])).toBe('legacy');
  });

  it('加仓并进分层仓位：保持分层', () => {
    const { position: first } = executeSettlementFill('KAITOUSDT', 1, order, true, 1_000);
    const { position: add } = executeSettlementFill('KAITOUSDT', 1.1, order, true, 2_000);
    const merged = mergeFilledPosition('KAITOUSDT', [first], add);
    expect(merged.survivor.id).toBe(first.id);
    expect(merged.survivor.riskModel).toBe(TIERED_RISK_MODEL);
    expect(merged.survivor.riskSymbol).toBe('KAITOUSDT');
  });

  it('合并卡片的合成仓位：全是分层才带戳；成员各自的强平价按各自模型', () => {
    const a = usdmPos('LONG', 12_000, 1, 5);
    const b = legacy(usdmPos('LONG', 12_000, 1, 5));
    expect(sharedRiskStamp([a, a])).toEqual({ riskModel: TIERED_RISK_MODEL, riskSymbol: 'KAITOUSDT' });
    expect(sharedRiskStamp([a, b])).toEqual({});
    expect(sharedRiskStamp([])).toEqual({});
    // 先爆的是分层那笔（0.810068 > 0.804）
    expect(firstLiquidationPrice([a, b], 'LONG', 'KAITOUSDT')).toBeCloseTo(9_575 / 11_820, 12);
  });

  it('summarizeRiskModels', () => {
    const a = usdmPos('LONG', 1, 1, 1);
    const b = legacy(a);
    expect(summarizeRiskModels([a])).toBe('tiered');
    expect(summarizeRiskModels([b])).toBe('legacy');
    expect(summarizeRiskModels([a, b, null])).toBe('mixed');
    expect(summarizeRiskModels([])).toBeUndefined();
  });
});

describe('爆仓弹窗的维持保证金说明', () => {
  const text = (c: ReturnType<typeof liquidationNoticeCopy>) => `${c.lead}${c.emphasis}${c.tail}${c.footnote}`;

  it('分层仓位不再写「维持保证金率 0.4%」', () => {
    const t = text(liquidationNoticeCopy('isolated', 1, 'tiered'));
    expect(t).toContain('币安分层');
    expect(t).not.toContain('0.4%');
  });

  it('混合时两种都说清；缺省仍是旧文案', () => {
    expect(text(liquidationNoticeCopy('cross', 2, 'mixed'))).toMatch(/币安分层.*0\.4%/);
    expect(liquidationNoticeCopy('cross', 1, 'legacy')).toEqual(liquidationNoticeCopy('cross'));
  });

  it('弹窗开着时再爆：模型不同则合并为 mixed；老调用方不带这个字段', () => {
    const a = { lostAmount: 1, liquidatedPositions: 1, scope: 'isolated' as const, maintenance: 'tiered' as const };
    expect(mergeLiquidationDetails(a, { ...a, maintenance: 'legacy' }).maintenance).toBe('mixed');
    expect(mergeLiquidationDetails(a, { lostAmount: 1, liquidatedPositions: 1, scope: 'isolated' }).maintenance).toBe('tiered');
    expect(mergeLiquidationDetails({ lostAmount: 1, liquidatedPositions: 1 }, { lostAmount: 1, liquidatedPositions: 1 }))
      .not.toHaveProperty('maintenance');
  });
});
