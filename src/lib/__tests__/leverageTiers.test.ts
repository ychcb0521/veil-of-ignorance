import { describe, expect, it } from 'vitest';
import data from '@/data/binanceLeverageTiers.json';
import {
  LEVERAGE_TIER_DATA,
  LEVERAGE_TIER_SNAPSHOT_DATE,
  listedCoinContractSizeUsd,
} from '@/lib/leverageTierData';
import {
  clampLeverageToTiers,
  exceedsTopCap,
  fallbackUsdmTiers,
  formatTierAmount,
  maintenanceMargin,
  maxLeverageForNotional,
  maxPositionAtLeverage,
  resolveSymbolTiers,
  tierAmountFromUsdNotional,
  tierFor,
  usdNotionalFromTierAmount,
} from '@/lib/leverageTiers';
import { getCoinMarginedContractSizeUsd, getSettlementAsset } from '@/lib/coinMargined';

/**
 * 币安分层快照（2026-09-16）。KAITOUSDT 的整张表按调研时的公开数据逐行核对：
 * 0–5k 75x 1% 0 | 5k–10k 50x 1.5% 25 | 10k–25k 25x 2% 75 | 25k–50k 20x 2.5% 200 |
 * 50k–125k 10x 5% 1,450 | 125k–250k 5x 10% 7,700 | 250k–500k 4x 12.5% 13,950 |
 * 500k–1M 3x 16.67% 34,800 | 1M–7.5M 2x 25% 118,100 | 7.5M–12.5M 1x 50% 1,993,100
 */
const KAITO_ROWS = [
  [0, 5_000, 75, 0.01, 0],
  [5_000, 10_000, 50, 0.015, 25],
  [10_000, 25_000, 25, 0.02, 75],
  [25_000, 50_000, 20, 0.025, 200],
  [50_000, 125_000, 10, 0.05, 1_450],
  [125_000, 250_000, 5, 0.1, 7_700],
  [250_000, 500_000, 4, 0.125, 13_950],
  [500_000, 1_000_000, 3, 0.1667, 34_800],
  [1_000_000, 7_500_000, 2, 0.25, 118_100],
  [7_500_000, 12_500_000, 1, 0.5, 1_993_100],
];

describe('快照文件', () => {
  it('字典编码完整：1032 个 U 本位、35 个币本位标的，下标都指向存在的表', () => {
    expect(Object.keys(data.usdm.symbols)).toHaveLength(1032);
    expect(Object.keys(data.coinm.symbols)).toHaveLength(35);
    for (const i of Object.values(data.usdm.symbols)) expect(data.usdm.tables[i]).toBeDefined();
    for (const i of Object.values(data.coinm.symbols)) expect(data.coinm.tables[i]).toBeDefined();
    expect(LEVERAGE_TIER_SNAPSHOT_DATE).toBe('2026-09-16');
  });

  it('兜底表是使用最多的那张（113 个合约）', () => {
    const usage = new Map<number, number>();
    for (const i of Object.values(data.usdm.symbols)) usage.set(i, (usage.get(i) ?? 0) + 1);
    const [top] = [...usage.entries()].sort((a, b) => b[1] - a[1]);
    expect(top[0]).toBe(data.fallbackUsdmTable);
    expect(top[1]).toBe(113);
    expect(fallbackUsdmTiers()[0].maxLeverage).toBe(50);
  });

  it('每一个档位边界（逐合约共 7,338 个）维持保证金都连续：cum 就是累进扣除额', () => {
    let boundaries = 0;
    const failures: string[] = [];
    for (const kind of ['usdm', 'coinm'] as const) {
      const set = LEVERAGE_TIER_DATA[kind];
      for (const [symbol, index] of Object.entries(set.symbols)) {
        const rows = set.tables[index];
        expect(rows[0][0]).toBe(0);
        for (let i = 1; i < rows.length; i++) {
          boundaries++;
          const [floor, , maxLev, mmr, cum] = rows[i];
          const [, prevCap, prevMaxLev, prevMmr, prevCum] = rows[i - 1];
          if (floor !== prevCap) failures.push(`${symbol} #${i + 1} 下沿 ≠ 上一档上限`);
          if (maxLev > prevMaxLev) failures.push(`${symbol} #${i + 1} 杠杆回升`);
          if (mmr < prevMmr) failures.push(`${symbol} #${i + 1} 费率回落`);
          // 维持保证金在边界两侧相等（按两个档位各算一次）
          const left = floor * prevMmr - prevCum;
          const right = floor * mmr - cum;
          if (Math.abs(left - right) > Math.max(1e-6, Math.abs(left) * 1e-9)) {
            failures.push(`${symbol} #${i + 1} 不连续 ${left} vs ${right}`);
          }
          // cum 等于累进（按档计税式）扣除：cumₙ = cumₙ₋₁ + floorₙ × (mmrₙ − mmrₙ₋₁)
          const progressive = prevCum + floor * (mmr - prevMmr);
          if (Math.abs(progressive - cum) > Math.max(1e-6, Math.abs(cum) * 1e-9)) {
            failures.push(`${symbol} #${i + 1} cum ${cum} ≠ ${progressive}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
    expect(boundaries).toBe(7_338);
  });

  it('维持保证金函数在每个边界两侧取值一致（按函数本身验，而不只是按原始数据）', () => {
    for (const kind of ['usdm', 'coinm'] as const) {
      const set = LEVERAGE_TIER_DATA[kind];
      for (let t = 0; t < set.tables.length; t++) {
        const tiers = set.tables[t].map(([floor, cap, maxLeverage, maintenanceMarginRate, maintenanceAmount], i) => ({
          bracket: i + 1, floor, cap, maxLeverage, maintenanceMarginRate, maintenanceAmount,
        }));
        for (const tier of tiers.slice(0, -1)) {
          const eps = tier.cap * 1e-9;
          const below = maintenanceMargin(tiers, tier.cap - eps);
          const at = maintenanceMargin(tiers, tier.cap);
          const above = maintenanceMargin(tiers, tier.cap + eps);
          // 连续时两侧只差「斜率 × eps」（费率 < 1，所以 < eps）；断档的话差的是整段扣除额。
          const tol = Math.max(1e-6, eps, Math.abs(at) * 1e-12);
          expect(Math.abs(at - below)).toBeLessThan(tol);
          expect(Math.abs(above - at)).toBeLessThan(tol);
        }
      }
    }
  });
});

describe('resolveSymbolTiers', () => {
  it('KAITOUSDT（U 本位）：币安自己的 10 档，USDT 计，最高 75x', () => {
    const r = resolveSymbolTiers('KAITOUSDT', 'usdt');
    expect(r.source).toBe('usdm');
    expect(r.unit).toBe('USDT');
    expect(r.measure).toBe('quote');
    expect(r.maxLeverage).toBe(75);
    expect(r.topCap).toBe(12_500_000);
    expect(r.note).toBeNull();
    expect(r.binanceSymbol).toBe('KAITOUSDT');
    expect(r.tiers.map(t => [t.floor, t.cap, t.maxLeverage, t.maintenanceMarginRate, t.maintenanceAmount]))
      .toEqual(KAITO_ROWS);
    expect(r.tiers.map(t => t.bracket)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('BTCUSDT：最高 150x，12 档，第 1 档 0–300,000 维持保证金率 0.4%', () => {
    const r = resolveSymbolTiers('BTCUSDT');
    expect(r.source).toBe('usdm');
    expect(r.maxLeverage).toBe(150);
    expect(r.tiers).toHaveLength(12);
    expect(r.tiers[0]).toMatchObject({ cap: 300_000, maintenanceMarginRate: 0.004, maintenanceAmount: 0 });
    expect(r.topCap).toBe(1_800_000_000);
  });

  it('BTCUSD_PERP（币本位）：以 BTC 计，第 1 档 0–5 BTC 125x，面值 100', () => {
    for (const symbol of ['BTCUSDT', 'BTCUSD_PERP', 'btcusdt']) {
      const r = resolveSymbolTiers(symbol, 'coin');
      expect(r.source).toBe('coinm');
      expect(r.unit).toBe('BTC');
      expect(r.measure).toBe('coin');
      expect(r.binanceSymbol).toBe('BTCUSD_PERP');
      expect(r.contractSizeUsd).toBe(100);
      expect(r.maxLeverage).toBe(125);
      expect(r.tiers[0]).toMatchObject({ floor: 0, cap: 5, maxLeverage: 125, maintenanceMarginRate: 0.004 });
      expect(r.tiers[1]).toMatchObject({ cap: 10, maxLeverage: 100, maintenanceAmount: 0.005 });
      expect(r.topCap).toBe(3_500);
    }
  });

  it('直接给交割合约名：基础币与面值按交易对取', () => {
    const r = resolveSymbolTiers('BTCUSD_260925', 'coin');
    expect(r.source).toBe('coinm');
    expect(r.binanceSymbol).toBe('BTCUSD_260925');
    expect(r.unit).toBe('BTC');
    expect(r.contractSizeUsd).toBe(100);
  });

  it('ETHUSD（币本位）：面值 10，第 1 档 0–15 ETH 100x', () => {
    const r = resolveSymbolTiers('ETHUSDT', 'coin');
    expect(r.source).toBe('coinm');
    expect(r.unit).toBe('ETH');
    expect(r.contractSizeUsd).toBe(10);
    expect(r.tiers[0]).toMatchObject({ cap: 15, maxLeverage: 100 });
  });

  it('KAITOUSD（合成币本位）：借 KAITOUSDT 的分层，按 USD 名义比，并说明原因', () => {
    const r = resolveSymbolTiers('KAITOUSDT', 'coin');
    expect(r.source).toBe('usdm-proxy');
    expect(r.unit).toBe('USD');
    expect(r.measure).toBe('usd-face');
    expect(r.binanceSymbol).toBe('KAITOUSDT');
    expect(r.contractSizeUsd).toBe(10);
    expect(r.maxLeverage).toBe(75);
    expect(r.note).toBe('币安无 KAITO 币本位合约，按 U 本位 KAITOUSDT 分层折算');
    expect(r.tiers).toBe(resolveSymbolTiers('KAITOUSDT', 'usdt').tiers);
  });

  it('查不到的标的：兜底表，并说明是兜底', () => {
    const u = resolveSymbolTiers('ZZNOTLISTEDUSDT', 'usdt');
    expect(u.source).toBe('fallback');
    expect(u.unit).toBe('USDT');
    expect(u.tiers).toBe(fallbackUsdmTiers());
    expect(u.maxLeverage).toBe(50);
    expect(u.note).toContain('快照中没有 ZZNOTLISTEDUSDT');
    expect(u.binanceSymbol).toBeNull();

    const c = resolveSymbolTiers('ZZNOTLISTEDUSDT', 'coin');
    expect(c.source).toBe('fallback');
    expect(c.unit).toBe('USD');
    expect(c.measure).toBe('usd-face');
    expect(c.contractSizeUsd).toBe(10);
    expect(c.note).toContain('币安无 ZZNOTLISTED 币本位合约');
  });

  it('结果有缓存，且不可修改', () => {
    const a = resolveSymbolTiers('KAITOUSDT', 'usdt');
    expect(resolveSymbolTiers('kaitousdt', 'usdt')).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.tiers)).toBe(true);
    expect(Object.isFrozen(a.tiers[0])).toBe(true);
  });
});

describe('币本位面值取自快照', () => {
  it('BTC 100、ETH 10、合成的 KAITO 仍是 10', () => {
    expect(listedCoinContractSizeUsd('BTC')).toBe(100);
    expect(listedCoinContractSizeUsd('ETH')).toBe(10);
    expect(listedCoinContractSizeUsd('KAITO')).toBeNull();
    expect(getCoinMarginedContractSizeUsd('BTCUSDT')).toBe(100);
    expect(getCoinMarginedContractSizeUsd('ETHUSDT')).toBe(10);
    expect(getCoinMarginedContractSizeUsd('KAITOUSDT')).toBe(10);
  });
});

describe('maxPositionAtLeverage：杠杆 L 下最多能持有的名义', () => {
  const tiers = resolveSymbolTiers('KAITOUSDT').tiers;
  it.each([
    [75, 5_000],
    [50, 10_000],
    [15, 50_000],
    [10, 125_000],
    [3, 1_000_000],
    [2, 7_500_000],
    [1, 12_500_000],
    [76, 0],
    [125, 0],
  ])('KAITOUSDT %sx → %s', (lev, cap) => {
    expect(maxPositionAtLeverage(tiers, lev)).toBe(cap);
  });

  it('BTCUSDT 15x → 100,000,000；50x → 12,000,000；BTCUSD 币本位 125x → 5 BTC', () => {
    expect(maxPositionAtLeverage(resolveSymbolTiers('BTCUSDT').tiers, 15)).toBe(100_000_000);
    expect(maxPositionAtLeverage(resolveSymbolTiers('BTCUSDT').tiers, 50)).toBe(12_000_000);
    expect(maxPositionAtLeverage(resolveSymbolTiers('BTCUSDT', 'coin').tiers, 125)).toBe(5);
  });
});

describe('maxLeverageForNotional：这个名义最高能用多少倍', () => {
  const tiers = resolveSymbolTiers('KAITOUSDT').tiers;
  it('用户那一单：163,578 张 × 10 = 1,635,780 → 最高 2x', () => {
    expect(maxLeverageForNotional(tiers, 163_578 * 10)).toBe(2);
    expect(maxLeverageForNotional(resolveSymbolTiers('KAITOUSDT', 'coin').tiers, 1_635_780)).toBe(2);
  });

  it('超过最高一档（12,500,000）任何杠杆都不能开', () => {
    expect(maxLeverageForNotional(tiers, 13_000_000)).toBe(0);
    expect(exceedsTopCap(tiers, 13_000_000)).toBe(true);
    expect(maxLeverageForNotional(tiers, 12_500_000)).toBe(1);
    expect(exceedsTopCap(tiers, 12_500_000)).toBe(false);
  });

  it('边界算低一档：恰好 5,000 仍是 75x，50,000 是 20x；0 与负数算第 1 档', () => {
    expect(maxLeverageForNotional(tiers, 5_000)).toBe(75);
    expect(maxLeverageForNotional(tiers, 5_000.01)).toBe(50);
    expect(maxLeverageForNotional(tiers, 50_000)).toBe(20);
    expect(maxLeverageForNotional(tiers, 0)).toBe(75);
    expect(tierFor(tiers, -1).bracket).toBe(1);
    // 浮点噪声不跳档
    expect(maxLeverageForNotional(tiers, 50_000 * (1 + 1e-15))).toBe(20);
  });

  it('与 maxPositionAtLeverage 互为反读：cap(L) 处的名义恰好允许 L', () => {
    for (const lev of [75, 50, 25, 20, 15, 10, 5, 4, 3, 2, 1]) {
      const cap = maxPositionAtLeverage(tiers, lev);
      expect(maxLeverageForNotional(tiers, cap)).toBeGreaterThanOrEqual(lev);
      expect(maxLeverageForNotional(tiers, cap + 0.01)).toBeLessThan(lev);
    }
  });
});

describe('maintenanceMargin / tierFor', () => {
  const tiers = resolveSymbolTiers('KAITOUSDT').tiers;
  it('名义 × 档位费率 − 速算扣除额', () => {
    expect(maintenanceMargin(tiers, 4_000)).toBeCloseTo(40, 9);
    expect(maintenanceMargin(tiers, 12_000)).toBeCloseTo(12_000 * 0.02 - 75, 9);
    expect(maintenanceMargin(tiers, 1_635_780)).toBeCloseTo(1_635_780 * 0.25 - 118_100, 6);
    expect(maintenanceMargin(tiers, 0)).toBe(0);
    expect(tierFor(tiers, 1_635_780).bracket).toBe(9);
  });

  it('超过最高上限时沿用最高一档的费率继续算', () => {
    expect(tierFor(tiers, 20_000_000).bracket).toBe(10);
    expect(maintenanceMargin(tiers, 20_000_000)).toBeCloseTo(20_000_000 * 0.5 - 1_993_100, 6);
  });

  it('币本位（BTC）：以币计', () => {
    const btc = resolveSymbolTiers('BTCUSDT', 'coin').tiers;
    expect(maintenanceMargin(btc, 7)).toBeCloseTo(7 * 0.005 - 0.005, 12);
    expect(maintenanceMargin(btc, 300)).toBeCloseTo(300 * 0.05 - 4.18, 12);
  });
});

describe('单位换算与展示', () => {
  it('只有真币本位按标记价折成币', () => {
    const btcCoin = resolveSymbolTiers('BTCUSDT', 'coin');
    expect(tierAmountFromUsdNotional(btcCoin, 250_000, 50_000)).toBe(5);
    expect(usdNotionalFromTierAmount(btcCoin, 5, 50_000)).toBe(250_000);
    expect(tierAmountFromUsdNotional(btcCoin, 250_000, 0)).toBeNaN();
    const proxy = resolveSymbolTiers('KAITOUSDT', 'coin');
    expect(tierAmountFromUsdNotional(proxy, 1_635_780, 1.09)).toBe(1_635_780);
    const usdt = resolveSymbolTiers('KAITOUSDT', 'usdt');
    expect(tierAmountFromUsdNotional(usdt, 50_000, 1.09)).toBe(50_000);
  });

  it('formatTierAmount', () => {
    expect(formatTierAmount(50_000, 'USD')).toBe('50,000 USD');
    expect(formatTierAmount(12_500_000, 'USDT')).toBe('12,500,000 USDT');
    expect(formatTierAmount(5, 'BTC')).toBe('5 BTC');
    expect(formatTierAmount(0.005, 'BTC')).toBe('0.005 BTC');
  });

  it('clampLeverageToTiers：夹到 1..该合约最高杠杆', () => {
    const kaito = resolveSymbolTiers('KAITOUSDT');
    expect(clampLeverageToTiers(kaito, 125)).toBe(75);
    expect(clampLeverageToTiers(kaito, 0)).toBe(1);
    expect(clampLeverageToTiers(kaito, NaN)).toBe(1);
    expect(clampLeverageToTiers(kaito, 14.6)).toBe(15);
    expect(clampLeverageToTiers(resolveSymbolTiers('BTCUSDT'), 150)).toBe(150);
  });
});

describe('基础币只去掉一个计价后缀', () => {
  /**
   * 【回归】getSettlementAsset 曾经连续去掉 USDT、USDC、BUSD、USD 四个后缀：
   * USDCUSDT → USDC → '' → 兜底成 BTC，于是 USDC 的币本位借了 BTCUSD_PERP 的分层（以 BTC 计、面值 100）。
   */
  it('USDCUSDT / BUSDUSDT / FDUSDUSDT 的基础币是它们自己', () => {
    expect(getSettlementAsset('USDCUSDT')).toBe('USDC');
    expect(getSettlementAsset('BUSDUSDT')).toBe('BUSD');
    expect(getSettlementAsset('FDUSDUSDT')).toBe('FDUSD');
    // 其余写法不变
    expect(getSettlementAsset('BTCUSDT')).toBe('BTC');
    expect(getSettlementAsset('BTCUSD_PERP')).toBe('BTC');
    expect(getSettlementAsset('KAITOUSD')).toBe('KAITO');
    expect(getSettlementAsset('ETHUSDC')).toBe('ETH');
    expect(getSettlementAsset('BNBBUSD')).toBe('BNB');
    expect(getSettlementAsset('')).toBe('BTC');
  });

  /**
   * 【复核 r6】基础币以 B 结尾的币本位合约名同时以 BUSD 与 USD 结尾（BNBUSD、ARBUSD、TRBUSD……）：
   * 按最长的后缀切会得到 'BN'，查不到 BNBUSD_PERP，BNB 币本位于是悄悄借了通用 U 本位表（50x），
   * 而它自己只有 20x。留得多的那一种切法在快照里查得到，就取它。
   */
  it('BNBUSD / ARBUSD：基础币是 BNB / ARB，不是 BN / AR', () => {
    expect(getSettlementAsset('BNBUSD')).toBe('BNB');
    expect(getSettlementAsset('BNBUSD_PERP')).toBe('BNB');
    expect(getSettlementAsset('ARBUSD')).toBe('ARB');
    expect(getSettlementAsset('TRBUSD')).toBe('TRB');
    // BUSD 计价的老交易对不受影响：BTCB 不在快照里，仍按 BUSD 切
    expect(getSettlementAsset('BTCBUSD')).toBe('BTC');
    // 快照里真实存在的合约名一个都没变（BNBUSD_PERP 这一个正是被修好的那一个）
    expect(resolveSymbolTiers('BNBUSD', 'coin')).toMatchObject({
      source: 'coinm', binanceSymbol: 'BNBUSD_PERP', maxLeverage: 20, unit: 'BNB',
    });
    expect(resolveSymbolTiers('BNBUSD', 'coin').tiers).toEqual(resolveSymbolTiers('BNBUSDT', 'coin').tiers);
    expect(getCoinMarginedContractSizeUsd('BNBUSD')).toBe(getCoinMarginedContractSizeUsd('BNBUSDT'));
  });

  it('USDCUSDT 币本位：币安没有 USDC 币本位合约，借 U 本位 USDCUSDT 的分层，面值 10', () => {
    const r = resolveSymbolTiers('USDCUSDT', 'coin');
    expect(r).toMatchObject({ source: 'usdm-proxy', unit: 'USD', binanceSymbol: 'USDCUSDT', contractSizeUsd: 10 });
    expect(r.note).toBe('币安无 USDC 币本位合约，按 U 本位 USDCUSDT 分层折算');
    expect(getCoinMarginedContractSizeUsd('USDCUSDT')).toBe(10);
  });
});
