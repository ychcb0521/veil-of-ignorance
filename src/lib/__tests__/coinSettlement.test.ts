import { describe, it, expect } from 'vitest';
import {
  coinNotionalUsd,
  coinMarginAmount,
  coinFeeAmount,
  coinPnlAmount,
  getCoinMarginedContractSizeUsd,
} from '@/lib/coinMargined';
import { settlementRoePct } from '@/lib/tradingSettlement';
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

describe('币本位 ROE — 必须用币口径（与币安一致），不是线性口径', () => {
  // 价涨 10%、10x：反向 ROE = 杠杆×(平−开)/平 = 90.909%（不是线性的 100%）
  const inverseRoe = lev * (mark - entry) / mark * 100; // 90.909...
  const linearRoe = lev * (mark - entry) / entry * 100; // 100

  it('calcROE(coin) = 90.9%（回归：不能再是 100%）', () => {
    const roe = calcROE(coinPos('LONG'), mark);
    expect(roe).toBeCloseTo(inverseRoe, 6);
    expect(roe).not.toBeCloseTo(linearRoe, 2);
  });

  it('calcROE(coin) 逐仓口径同样走币基准', () => {
    expect(calcROE(coinPos('LONG', 'isolated'), mark)).toBeCloseTo(inverseRoe, 6);
  });

  it('settlementRoePct：币本位按 mark 价给保证金估值 → 90.9%', () => {
    const marginUsdEntry = notionalUsd / lev; // 100，= 开仓 USD 保证金
    const pnlUsd = contracts * M * (1 / entry - 1 / mark) * mark; // ≈100
    expect(settlementRoePct(pnlUsd, marginUsdEntry, entry, mark, true)).toBeCloseTo(inverseRoe, 6);
  });

  it('settlementRoePct：U本位原样 pnl/保证金（线性 100%）', () => {
    expect(settlementRoePct(100, 100, entry, mark, false)).toBeCloseTo(100, 9);
  });
});
