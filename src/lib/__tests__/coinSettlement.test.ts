import { describe, it, expect } from 'vitest';
import {
  coinNotionalUsd,
  coinMarginAmount,
  coinFeeAmount,
  coinPnlAmount,
  getCoinMarginedContractSizeUsd,
} from '@/lib/coinMargined';
import { settlementRoePct, settlementMarginRatioPct } from '@/lib/tradingSettlement';
import {
  calcUnrealizedPnl,
  calcLiquidationPrice,
  calcROE,
  MAINTENANCE_MARGIN_RATE,
  TAKER_FEE,
  type Position,
} from '@/types/trading';

// 基准用例：BTCUSD_PERP，做多 10 张，开仓 50000，平仓/现价 55000，10x。
// 反向合约：每张面值 100 USD，盈亏结算成币。
const M = getCoinMarginedContractSizeUsd('BTCUSDT'); // 100
const contracts = 10;
const entry = 50000;
const mark = 55000;
const lev = 10;
const notionalUsd = contracts * M; // 1000，恒定（不随价格变）

function coinPos(side: 'LONG' | 'SHORT', marginMode: 'cross' | 'isolated' = 'cross'): Position {
  const marginCoin = notionalUsd / (entry * lev); // 0.002
  return {
    id: 'p', side, entryPrice: entry, quantity: contracts, leverage: lev,
    marginMode, settlementMode: 'coin', settlementAsset: 'BTC',
    contractSizeUsd: M, contracts, margin: marginCoin * entry, marginCoin,
    isolatedMargin: marginMode === 'isolated' ? marginCoin * entry : undefined,
    openTime: 0,
  } as Position;
}

describe('币本位（反向合约）核心公式', () => {
  it('名义价值(USD) 恒定 = 张数 × 面值', () => {
    expect(coinNotionalUsd(contracts, M)).toBe(1000);
  });

  it('保证金(币) = USD名义 /(价 × 杠杆)', () => {
    expect(coinMarginAmount(contracts, entry, lev, M)).toBeCloseTo(0.002, 12);
  });

  it('做多/做空盈亏(币) = 张数 × 面值 × (1/开 − 1/平)', () => {
    expect(coinPnlAmount('LONG', contracts, entry, mark, M)).toBeCloseTo(
      contracts * M * (1 / entry - 1 / mark), 15,
    );
    expect(coinPnlAmount('SHORT', contracts, entry, mark, M)).toBeCloseTo(
      contracts * M * (1 / mark - 1 / entry), 15,
    );
    // 做多价涨为盈
    expect(coinPnlAmount('LONG', contracts, entry, mark, M)).toBeGreaterThan(0);
  });

  it('手续费(币) = 费率 × 币名义；折 USD = 费率 × USD名义', () => {
    const feeCoin = coinFeeAmount(contracts, entry, TAKER_FEE, M);
    expect(feeCoin * entry).toBeCloseTo(TAKER_FEE * notionalUsd, 12); // 0.4
  });

  it('calcUnrealizedPnl(coin) 返回 USD = 币盈亏 × 现价', () => {
    const pnlUsd = calcUnrealizedPnl(coinPos('LONG'), mark);
    expect(pnlUsd).toBeCloseTo(contracts * M * (1 / entry - 1 / mark) * mark, 9); // ≈100
  });

  it('强平价(多) = N(1+MMR)/(币保证金 + N/开)', () => {
    const marginCoin = notionalUsd / (entry * lev);
    const expLiq = (notionalUsd * (1 + MAINTENANCE_MARGIN_RATE)) / (marginCoin + notionalUsd / entry);
    expect(calcLiquidationPrice(coinPos('LONG'))).toBeCloseTo(expLiq, 6);
    expect(calcLiquidationPrice(coinPos('LONG'))).toBeLessThan(entry); // 多头强平在开仓价之下
  });

  it('强平价(空) = N(1−MMR)/(N/开 − 币保证金)，且在开仓价之上', () => {
    const marginCoin = notionalUsd / (entry * lev);
    const expLiq = (notionalUsd * (1 - MAINTENANCE_MARGIN_RATE)) / (notionalUsd / entry - marginCoin);
    expect(calcLiquidationPrice(coinPos('SHORT'))).toBeCloseTo(expLiq, 6);
    expect(calcLiquidationPrice(coinPos('SHORT'))).toBeGreaterThan(entry);
  });
});

describe('ROE 分母 = 固定初始保证金（名义@开仓/杠杆），U本位/币本位统一同一口径', () => {
  // 初始保证金(USD) = 名义@开仓/杠杆 = (张数×面值)/杠杆，固定、不随价格变、不含追加。
  const initialMarginUsd = notionalUsd / lev; // 1000/10 = 100
  // 统一口径下，币本位 ROE = pnl(USD)/初始保证金 = 杠杆×(平−开)/开（与线性同一式）。
  const fixedRoe = lev * (mark - entry) / entry * 100; // 100

  it('calcROE(coin)：用固定初始保证金做分母（= 杠杆×(平−开)/开）', () => {
    expect(calcROE(coinPos('LONG'), mark)).toBeCloseTo(fixedRoe, 6);
  });

  it('calcROE(coin) 逐仓同口径（追加保证金不进分母）', () => {
    expect(calcROE(coinPos('LONG', 'isolated'), mark)).toBeCloseTo(fixedRoe, 6);
  });

  it('settlementRoePct = pnl / 初始保证金（U本位/币本位同一函数）', () => {
    const pnlUsd = contracts * M * (1 / entry - 1 / mark) * mark; // 币本位 pnl(USD)
    expect(settlementRoePct(pnlUsd, initialMarginUsd)).toBeCloseTo(fixedRoe, 6);
    expect(settlementRoePct(100, 100)).toBeCloseTo(100, 9); // U本位示例
  });
});

describe('保证金比率 = 维持保证金/保证金余额（与币安一致，亏损越大越逼近 100%）', () => {
  // 截图实测（ACT 5x 逐仓，MMR=0.4%）：
  // U本位 多 109,601,052.1701 张，开仓 0.045670
  const qty = 109601052.1701;
  const entryU = 0.045670;
  const marginU = 1001100; // 开仓 USD 保证金
  const ratioU = (markP: number) => {
    const notional = qty * markP;
    const pnl = qty * (markP - entryU);
    return settlementMarginRatioPct(notional, marginU, pnl);
  };

  it('U本位：mark 0.039750 → ≈4.95%（旧错误公式是 8.09%）', () => {
    expect(ratioU(0.039750)).toBeCloseTo(4.95, 1);
  });

  it('U本位：价越跌、亏越多 → 比率越高（方向必须对）', () => {
    expect(ratioU(0.041140)).toBeCloseTo(3.57, 1);
    expect(ratioU(0.039750)).toBeGreaterThan(ratioU(0.041140));
  });

  it('币本位：保证金按现价估值后 → ≈1.42%（旧错误公式是 30.10%）', () => {
    // 空 500000 张 @0.045570，面值 10，标记 0.040967
    const notionalUsd2 = 500000 * 10;            // 5,000,000 恒定
    const marginCoin = notionalUsd2 / (0.045570 * 5);
    const markP = 0.040967;
    const marginValuedAtMark = marginCoin * markP;
    const pnlUsd = 500000 * 10 * (1 / markP - 1 / 0.045570) * markP; // 空：币盈亏×标记
    expect(settlementMarginRatioPct(notionalUsd2, marginValuedAtMark, pnlUsd)).toBeCloseTo(1.42, 1);
  });

  it('保证金余额 ≤ 0（已触及强平）→ 返回 100', () => {
    expect(settlementMarginRatioPct(5_000_000, 1000, -2000)).toBe(100);
  });
});
