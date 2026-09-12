import { describe, expect, it } from 'vitest';
import { LEGACY_TAKER_FEE, MAKER_FEE, TAKER_FEE, type TradeRecord } from '@/types/trading';
import { getSettlementFeeParts, type SettlementOrderLike } from '@/lib/tradingSettlement';

const asOrder = (o: Record<string, unknown>) => o as unknown as SettlementOrderLike;
import {
  describeTradeRecordFees,
  feeKindLabel,
  formatFeeRate,
  sumTradeRecordFees,
  tradeRecordFees,
} from '@/lib/tradeFees';

/**
 * 费率与算式钉在币安官方 FAQ「Binance Futures Fee Structure & Fee Calculations」的原例上：
 *   U 本位  市价 1 BTC @ 10,104 → 10,104 × 0.05% = 5.052 USDT；限价 @ 11,104 → 11,104 × 0.02% = 2.2208 USDT
 *   币本位  市价 10 张 × 100 USD @ 10,104 → 0.09897 BTC × 0.050% = 0.000049485 BTC；
 *           限价 @ 11,104 → 0.09 BTC × 0.02% = 0.000018 BTC
 */
describe('币安合约手续费算式', () => {
  it('费率是普通用户档：Maker 0.02%，Taker 0.05%', () => {
    expect(MAKER_FEE).toBe(0.0002);
    expect(TAKER_FEE).toBe(0.0005);
    expect(formatFeeRate(TAKER_FEE)).toBe('0.05%');
    expect(formatFeeRate(MAKER_FEE)).toBe('0.02%');
  });

  it('U 本位：手续费 = 数量 × 成交价 × 费率（币安原例）', () => {
    const taker = getSettlementFeeParts('BTCUSDT', asOrder({ side: 'LONG', quantity: 1, leverage: 20 }), 10_104, false);
    expect(taker.feeUsd).toBeCloseTo(5.052, 9);
    expect(taker.feeRate).toBe(TAKER_FEE);
    const maker = getSettlementFeeParts('BTCUSDT', asOrder({ side: 'LONG', quantity: 1, leverage: 20 }), 11_104, true);
    expect(maker.feeUsd).toBeCloseTo(2.2208, 9);
    expect(maker.feeRate).toBe(MAKER_FEE);
  });

  it('币本位：手续费 = 张数 × 面值 ÷ 成交价 × 费率，以币计（币安原例）', () => {
    const coinOrder = asOrder({ side: 'LONG', quantity: 10, contracts: 10, leverage: 20, settlementMode: 'coin', contractSizeUsd: 100 });
    const taker = getSettlementFeeParts('BTCUSD', coinOrder, 10_104, false);
    expect(taker.feeCoin).toBeCloseTo(0.000049485, 9);
    // 折美元恰好是 张数 × 面值 × 费率，与价无关
    expect(taker.feeUsd).toBeCloseTo(10 * 100 * TAKER_FEE, 9);
    const maker = getSettlementFeeParts('BTCUSD', coinOrder, 11_104, true);
    expect(maker.feeCoin).toBeCloseTo(0.000018, 7);
  });
});

/**
 * HPEUSDT 2026-09-12：主多 62.0584 → 62.0646，11,993.71 枚，平仓价高于开仓价却亏 223.39。
 * 毛盈亏 +74.36；平仓 Taker 费 744,384.81 × 0.04% = 297.75 把它吃掉；
 * 开仓那一笔 744,310.45 × 0.04% = 297.72 在开仓当时就从钱包扣了，记录里没有。
 */
const hpe = (over: Partial<TradeRecord> = {}): TradeRecord => ({
  id: 'hpe', symbol: 'HPEUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE',
  entryPrice: 62.0584, exitPrice: 62.0646, quantity: 11_993.71, leverage: 10,
  pnl: -223.39, fee: 297.75392, slippage: 0,
  openTime: Date.parse('2026-09-12T03:59:00+08:00'), closeTime: Date.parse('2026-09-12T12:18:00+08:00'),
  ...over,
});

describe('tradeRecordFees', () => {
  it('【用户问题】旧记录：平仓费取自记录，开仓费按当年 0.04% Taker 从开仓名义估算', () => {
    const fees = tradeRecordFees(hpe());
    expect(fees.close).toMatchObject({ usd: 297.75392, maker: false, estimated: true });
    expect(fees.close.rate).toBeCloseTo(LEGACY_TAKER_FEE, 9);      // 费 ÷ 平仓名义倒推出来
    expect(fees.open).toMatchObject({ maker: false, rate: LEGACY_TAKER_FEE, estimated: true, coin: null });
    expect(fees.open!.usd).toBeCloseTo(62.0584 * 11_993.71 * 0.0004, 6);   // 297.72
    expect(fees.totalUsd!).toBeCloseTo(595.478, 2);
    expect(fees.netAfterOpenFee!).toBeCloseTo(-223.39 - 297.724, 2);      // 钱包真正的净结果
    expect(fees.liquidationFeeUsd).toBeNull();
    expect(fees.estimated).toBe(true);
  });

  it('新记录：三个数都来自记录，不估算', () => {
    const fees = tradeRecordFees(hpe({
      openFeeUsd: 372.155, openIsMaker: false, openFeeRate: TAKER_FEE,
      fee: 372.19, closeIsMaker: false, closeFeeRate: TAKER_FEE,
    }));
    expect(fees.open).toEqual({ usd: 372.155, coin: null, rate: TAKER_FEE, maker: false, estimated: false });
    expect(fees.close).toEqual({ usd: 372.19, coin: null, rate: TAKER_FEE, maker: false, estimated: false });
    expect(fees.totalUsd).toBeCloseTo(744.345, 9);
    expect(fees.estimated).toBe(false);
  });

  it('Maker 开仓、币本位的币计费用原样带出', () => {
    const fees = tradeRecordFees(hpe({
      settlementMode: 'coin', contracts: 100, contractSizeUsd: 10,
      openFeeUsd: 0.2, openFeeCoin: 0.0032, openIsMaker: true, openFeeRate: MAKER_FEE,
      fee: 0.5, feeCoin: 0.008, closeIsMaker: false, closeFeeRate: TAKER_FEE,
    }));
    expect(fees.open).toMatchObject({ coin: 0.0032, maker: true, rate: MAKER_FEE });
    expect(fees.close).toMatchObject({ coin: 0.008, maker: false });
    expect(feeKindLabel(fees.open!)).toBe('Maker 0.02%');
    expect(feeKindLabel(fees.close)).toBe('Taker 0.05%');
  });

  it('强平记录：平仓费里的强平清算费单独给出；旧强平记录不倒推费率', () => {
    const liq = tradeRecordFees(hpe({
      action: 'LIQUIDATION', exit_method: 'liquidation', liquidationSettlement: 'bankruptcy',
      pnl: -74_431, fee: 4_019.4, closeFeeRate: TAKER_FEE, closeIsMaker: false, liquidationFeeUsd: 3_721.6,
      openFeeUsd: 372.155, openIsMaker: false, openFeeRate: TAKER_FEE,
    }));
    expect(liq.liquidationFeeUsd).toBe(3_721.6);
    expect(liq.close.usd).toBe(4_019.4);
    const legacyLiq = tradeRecordFees(hpe({ action: 'LIQUIDATION', exit_method: 'liquidation', fee: 4_000 }));
    expect(legacyLiq.close.rate).toBeNull();
    expect(legacyLiq.liquidationFeeUsd).toBeNull();
    expect(feeKindLabel(legacyLiq.close)).toBe('Taker（估）');
  });

  it('标签：旧记录倒推的费率带 ≈；估算带（估）', () => {
    const fees = tradeRecordFees(hpe());
    expect(feeKindLabel(fees.open!)).toBe('Taker ≈0.04%');
    expect(feeKindLabel(fees.close)).toBe('Taker ≈0.04%');
  });

  it('缺开仓价 / 数量的记录：开仓费与合计为 null，平仓费照常', () => {
    const fees = tradeRecordFees(hpe({ entryPrice: 0, quantity: 0 }));
    expect(fees.open).toBeNull();
    expect(fees.totalUsd).toBeNull();
    expect(fees.netAfterOpenFee).toBeNull();
    expect(fees.close.usd).toBe(297.75392);
  });

  it('说明文字把币安算式、两笔费用与「盈亏列为什么是这个数」讲清楚', () => {
    const text = describeTradeRecordFees(hpe());
    expect(text).toContain('手续费 = 数量 × 成交价 × 费率');
    expect(text).toContain('744310.45 × 0.04% = 297.72');
    expect(text).toContain('744384.81 × 0.04% = 297.75');
    expect(text).toContain('毛盈亏 +74.36 − 平仓费 297.75 = -223.39');
    expect(text).toContain('净结果为 -521.11');
    expect(text).toContain('估算');
  });

  /**
   * ASTERUSDT 2025-09-18（用户案例）：币本位主多，开 8.1380 → 平 8.2060，名义 1,760,560 USD。
   * 界面上两笔手续费的**美元数完全相等**（各 704.22），一度像是把平仓费算成了开仓费；
   * 其实这正是币安币本位的算式：fee = 张数 × 面值 ÷ 成交价 × 费率，收的是币，
   * 折美元后价格被约掉。差别藏在币数里：开仓 86.54，平仓 85.82。
   */
  const coinLeg = (over: Partial<TradeRecord> = {}): TradeRecord => hpe({
    settlementMode: 'coin', settlementAsset: 'ASTER',
    contracts: 176_056, contractSizeUsd: 10, quantity: 176_056,
    entryPrice: 8.1380, exitPrice: 8.2060,
    fee: 1_760_560 * LEGACY_TAKER_FEE, feeCoin: (1_760_560 / 8.2060) * LEGACY_TAKER_FEE,
    ...over,
  });

  it('【用户案例】币本位：两笔的美元数相同是对的，币数才不同——价越高付的币越少', () => {
    const fees = tradeRecordFees(coinLeg());
    expect(fees.coinSettled).toBe(true);
    expect(fees.asset).toBe('ASTER');
    // 美元：张数 × 面值 × 费率，与成交价无关 ⇒ 开平必然相等
    expect(fees.open!.usd).toBeCloseTo(704.22, 2);
    expect(fees.close.usd).toBeCloseTo(704.22, 2);
    expect(fees.totalUsd).toBeCloseTo(1408.45, 2);
    // 币：名义 ÷ 成交价 × 费率 ⇒ 平仓价更高，付的币更少
    expect(fees.open!.coin).toBeCloseTo(1_760_560 / 8.1380 * 0.0004, 4);   // 86.54
    expect(fees.close.coin).toBeCloseTo(1_760_560 / 8.2060 * 0.0004, 4);   // 85.82
    expect(fees.close.coin!).toBeLessThan(fees.open!.coin!);
    expect(fees.totalCoin).toBeCloseTo(fees.open!.coin! + fees.close.coin!, 9);
  });

  it('币本位平仓价更低时反过来：平仓费的币数更多', () => {
    const fees = tradeRecordFees(coinLeg({ exitPrice: 7.5, feeCoin: (1_760_560 / 7.5) * LEGACY_TAKER_FEE }));
    expect(fees.close.coin!).toBeGreaterThan(fees.open!.coin!);
    expect(fees.close.usd).toBeCloseTo(fees.open!.usd, 6);       // 美元仍然相等
  });

  it('U 本位相反：美元数随成交价走，平仓价更高则平仓费更高', () => {
    const fees = tradeRecordFees(hpe({ exitPrice: 70 }));
    expect(fees.coinSettled).toBe(false);
    expect(fees.asset).toBe('USDT');
    expect(fees.open!.coin).toBeNull();
    expect(fees.open!.usd).toBeCloseTo(62.0584 * 11_993.71 * 0.0004, 6);
    // 旧记录的平仓费取自记录本身；新记录里它 = 数量 × 平仓价 × 费率
    const fresh = tradeRecordFees(hpe({
      exitPrice: 70, fee: 11_993.71 * 70 * TAKER_FEE, closeFeeRate: TAKER_FEE,
      openFeeUsd: 11_993.71 * 62.0584 * TAKER_FEE, openFeeRate: TAKER_FEE, openIsMaker: false,
    }));
    expect(fresh.close.usd).toBeGreaterThan(fresh.open!.usd);
  });

  it('币本位的说明文字讲清「美元相同、币数不同」，并给出两笔的币数', () => {
    const text = describeTradeRecordFees(coinLeg());
    expect(text).toContain('币本位');
    expect(text).toContain('张数 × 面值 ÷ 成交价');
    expect(text).toContain('美元数必然相同');
    expect(text).toContain('币数不同');
    expect(text).toContain('86.54 ASTER');
    expect(text).toContain('85.82 ASTER');
  });

  it('合计：同币种的币本位记录给出币计合计，混着 U 本位就只给美元', () => {
    const coinSum = sumTradeRecordFees([coinLeg(), coinLeg({ id: 'c2' })]);
    expect(coinSum!.asset).toBe('ASTER');
    expect(coinSum!.totalCoin).toBeCloseTo(2 * (1_760_560 / 8.1380 + 1_760_560 / 8.2060) * 0.0004 / 2 * 2, 2);
    const mixed = sumTradeRecordFees([coinLeg(), hpe({ id: 'u1' })]);
    expect(mixed!.totalCoin).toBeNull();
  });

  it('合计按记录去重：同一条记录挂在主力与镜像止盈两条腿上只算一次', () => {
    const rec = hpe();
    const sum = sumTradeRecordFees([rec, rec, hpe({ id: 'other', fee: 10, entryPrice: 1, quantity: 100, exitPrice: 1 })]);
    expect(sum!.totalUsd).toBeCloseTo(297.72418 + 297.75392 + 10 + 100 * LEGACY_TAKER_FEE, 4);
    expect(sum!.estimated).toBe(true);
    expect(sumTradeRecordFees([])).toBeNull();
  });
});
