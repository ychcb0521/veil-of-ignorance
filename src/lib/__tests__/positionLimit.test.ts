import { describe, expect, it } from 'vitest';
import type { PendingOrder, Position } from '@/types/trading';
import {
  DEFAULT_SYMBOL_LEVERAGE,
  checkLeverageChange,
  checkOrderPositionLimit,
  checkPlacementPositionLimit,
  checkPositionLimit,
  clampLeverageAcrossSettlements,
  clampSymbolLeverage,
  doomedAtTrigger,
  effectiveSymbolLeverage,
  exposureInTierUnit,
  isMarketableLimitPrice,
  isTriggerRecheckedOrder,
  isTriggeredOpenOrder,
  leverageFloorOf,
  limitFillsOnPath,
  newlyDoomedTriggerOrders,
  orderFillsOnPath,
  orderValuationPrice,
  orderWaypointPrice,
  placementAftermath,
  placementCheckPrice,
  placementFloatsWithMark,
  placementOrderNotionalUsd,
  placementOrderValuation,
  placementSizingRemainingUsd,
  placementUnitPriceUsd,
  placementUsesLegacyHedge,
  positionLimitDetail,
  pricePath,
  recheckPrice,
  recheckedAtFill,
  remainingOpenUsd,
  restingTriggerCheck,
  restingTriggerScenarios,
  sizingRemainingOpenUsd,
  symbolExposureUsd,
  triggerCheckLead,
  triggerFiresOnPath,
  triggerRiskMessage,
  triggerWaypoints,
  triggeredCheckPrice,
  twapSliceTrigger,
} from '@/lib/positionLimit';
import { formatPrice } from '@/lib/formatters';
import { maxPositionAtLeverage, resolveSymbolTiers } from '@/lib/leverageTiers';
import { planLeverageChange } from '@/lib/leverageRestatement';

/**
 * 币安「当前杠杆倍数最高可持有头寸」的唯一判定。
 * 用户的原始案例：币本位 KAITOUSD 163,578 张（1,500,000 KAITO ≈ 1,635,780 USD）、15x 市价开仓。
 * 币安没有 KAITO 币本位合约 → 借 U 本位 KAITOUSDT 的分层，按 USD 面值比：
 * 15x 最高 50,000；1,635,780 落在 1,000,000–7,500,000 那一档，最高 2x。
 */

let seq = 0;
const coinPos = (side: 'LONG' | 'SHORT', contracts: number, over: Partial<Position> = {}): Position => ({
  id: `p${++seq}`, side, quantity: contracts, contracts, contractSizeUsd: 10,
  settlementMode: 'coin', settlementAsset: 'KAITO', entryPrice: 1, leverage: 15,
  marginMode: 'isolated', margin: (contracts * 10) / 15, isolatedMargin: (contracts * 10) / 15,
  marginCoin: (contracts * 10) / 15, openTime: 1,
  ...over,
} as Position);

const usdtPos = (side: 'LONG' | 'SHORT', quantity: number, entryPrice = 1, over: Partial<Position> = {}): Position => ({
  id: `u${++seq}`, side, quantity, entryPrice, leverage: 15, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT',
  margin: (quantity * entryPrice) / 15, isolatedMargin: (quantity * entryPrice) / 15, openTime: 1,
  ...over,
} as Position);

const coinOrder = (contracts: number, over: Partial<PendingOrder> = {}): PendingOrder => ({
  id: `o${++seq}`, side: 'LONG', type: 'LIMIT', price: 1, stopPrice: 0, quantity: contracts, contracts,
  contractSizeUsd: 10, settlementMode: 'coin', settlementAsset: 'KAITO', leverage: 15,
  marginMode: 'isolated', status: 'NEW', createdAt: 0,
  ...over,
} as PendingOrder);

const kaitoCoin = (over: Partial<Parameters<typeof checkOrderPositionLimit>[0]> = {}) => checkOrderPositionLimit({
  symbol: 'KAITOUSD', settlement: 'coin', leverage: 15, positions: [], orders: [], markPrice: 1.0905,
  orderNotionalUsd: 0,
  ...over,
});

describe('用户的原始案例：KAITOUSD 163,578 张', () => {
  it('15x 拦下：最高可持有 50,000 USD，这个规模最高 2x', () => {
    const r = kaitoCoin({ orderNotionalUsd: 163_578 * 10 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('exceeds-cap');
    expect(r.cap).toBe(50_000);
    expect(r.unit).toBe('USD');
    expect(r.maxLeverageForResult).toBe(2);
    expect(r.exposureAfter).toBe(1_635_780);
    expect(r.message).toBe(
      '持仓和当前委托价值超过当前杠杆倍数最高可持有头寸：15x 最高 50,000 USD。按这个规模最高可用 2x，请调低杠杆或减少数量。',
    );
    expect(r.note).toBe('币安无 KAITO 币本位合约，按 U 本位 KAITOUSDT 分层折算');
  });

  it('2x 放行（2x 最高 7,500,000）', () => {
    const r = kaitoCoin({ leverage: 2, orderNotionalUsd: 1_635_780 });
    expect(r.ok).toBe(true);
    expect(r.cap).toBe(7_500_000);
    expect(r.message).toBeNull();
  });

  it('3x 仍然拦（3x 最高 1,000,000）', () => {
    const r = kaitoCoin({ leverage: 3, orderNotionalUsd: 1_635_780 });
    expect(r.ok).toBe(false);
    expect(r.cap).toBe(1_000_000);
    expect(r.maxLeverageForResult).toBe(2);
  });

  it('合成币本位按 USD 面值比，与价格无关——同一单在任何标记价下结论一样', () => {
    for (const mark of [0.28, 1.0905, 5]) {
      const r = kaitoCoin({ markPrice: mark, orderNotionalUsd: 1_635_780 });
      expect(r.exposureAfter).toBe(1_635_780);
      expect(r.ok).toBe(false);
    }
  });

  it('补充说明把加法摆出来，并写明分层来源与快照日期', () => {
    const r = kaitoCoin({ positions: [coinPos('LONG', 1_000)], orderNotionalUsd: 1_635_780 });
    expect(positionLimitDetail(r)).toBe(
      '持仓和当前委托 10,000 USD + 本单 1,635,780 USD = 1,645,780 USD（币安 KAITOUSDT 分层，快照 2026-09-16）',
    );
  });
});

describe('判的是下单之后的总量', () => {
  it('双向持仓多空按绝对值相加，共用一个上限', () => {
    const positions = [coinPos('LONG', 2_000), coinPos('SHORT', 2_000)];   // 各 20,000 USD
    expect(exposureInTierUnit({ symbol: 'KAITOUSD', settlement: 'coin', positions, orders: [], markPrice: 1 }))
      .toBe(40_000);
    // 40,000 + 15,000 = 55,000 > 50,000
    const blocked = kaitoCoin({ positions, orderNotionalUsd: 15_000 });
    expect(blocked.ok).toBe(false);
    expect(blocked.maxLeverageForResult).toBe(10);
    // 40,000 + 10,000 = 50,000：上限本身可以开
    expect(kaitoCoin({ positions, orderNotionalUsd: 10_000 }).ok).toBe(true);
    // 单看任何一边都过得去——拆成对冲并不能绕开上限
    expect(kaitoCoin({ positions: [positions[0]], orderNotionalUsd: 15_000 }).ok).toBe(true);
  });

  it('当前委托计入；只减仓单不计', () => {
    const resting = coinOrder(4_000);                                     // 40,000 USD
    expect(kaitoCoin({ orders: [resting], orderNotionalUsd: 15_000 }).ok).toBe(false);
    const reduce = coinOrder(4_000, { reduceOnly: true });
    expect(kaitoCoin({ orders: [reduce], orderNotionalUsd: 15_000 }).ok).toBe(true);
  });

  it('TWAP 只算还没成交的部分（成交的切片已经在持仓里）', () => {
    const twap = coinOrder(4_000, { type: 'TWAP', price: 0, twapTotalQty: 4_000, twapFilledQty: 3_000 });
    expect(symbolExposureUsd('KAITOUSD', [coinPos('LONG', 3_000)], [twap], 1)).toBe(40_000);
    const done = { ...twap, twapFilledQty: 4_000 };
    expect(symbolExposureUsd('KAITOUSD', [], [done], 1)).toBe(0);
  });

  it('条件单触发时把它自己（和同一批刚成交的单）排除出挂单', () => {
    const cond = coinOrder(4_000, { type: 'CONDITIONAL', price: 0, stopPrice: 1.2, status: 'PENDING' });
    const sibling = coinOrder(500, { type: 'CONDITIONAL', price: 0, stopPrice: 1.2, status: 'PENDING' });
    const all = [cond, sibling];
    expect(symbolExposureUsd('KAITOUSD', [], all, 1)).toBe(45_000);
    expect(symbolExposureUsd('KAITOUSD', [], all, 1, { excludeOrderIds: [cond.id] })).toBe(5_000);
    expect(symbolExposureUsd('KAITOUSD', [], all, 1, { excludeOrderIds: [cond.id, sibling.id] })).toBe(0);
  });

  it('U 本位与币本位是两张合约：各算各的敞口', () => {
    const positions = [usdtPos('LONG', 45_000), coinPos('LONG', 1_000)];
    expect(exposureInTierUnit({ symbol: 'KAITOUSDT', settlement: 'usdt', positions, orders: [], markPrice: 1 }))
      .toBe(45_000);
    expect(exposureInTierUnit({ symbol: 'KAITOUSDT', settlement: 'coin', positions, orders: [], markPrice: 1 }))
      .toBe(10_000);
    // 缺省（planLeverageChange 的旧口径）两种都算
    expect(symbolExposureUsd('KAITOUSDT', positions, [], 1)).toBe(55_000);
  });

  it('U 本位持仓按标记价估值，挂单按委托价；已经穿价的限价单按标记价', () => {
    const positions = [usdtPos('LONG', 9_000, 1.0)];
    const order = { ...coinOrder(0), settlementMode: 'usdt', contracts: undefined, quantity: 1_000, price: 1 } as PendingOrder;
    expect(exposureInTierUnit({ symbol: 'KAITOUSDT', settlement: 'usdt', positions, orders: [order], markPrice: 1.2 }))
      .toBeCloseTo(9_000 * 1.2 + 1_000, 9);
    // 买价 2 ≥ 现价 1.2：下一根就按 2 成交，成交后是按标记价估值的持仓
    const marketable = { ...order, price: 2 } as PendingOrder;
    expect(exposureInTierUnit({ symbol: 'KAITOUSDT', settlement: 'usdt', positions, orders: [marketable], markPrice: 1.2 }))
      .toBeCloseTo(9_000 * 1.2 + 1_000 * 1.2, 9);
  });
});

describe('其余几条规则', () => {
  it('只减仓 / 平仓永不拦（与币安刻意不同）', () => {
    const r = checkPositionLimit({
      symbol: 'KAITOUSD', settlement: 'coin', leverage: 75,
      exposureBefore: 20_000_000, orderNotional: 1_000_000, reduceOnly: true,
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('reduce-only');
  });

  it('超过最高一档上限：任何杠杆都不可开', () => {
    const r = kaitoCoin({ leverage: 1, orderNotionalUsd: 13_000_000 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('exceeds-top-cap');
    expect(r.maxLeverageForResult).toBe(0);
    expect(r.message).toBe('超过该合约最大可持有头寸 12,500,000 USD（任何杠杆都不可开）');
    expect(kaitoCoin({ leverage: 1, orderNotionalUsd: 12_500_000 }).ok).toBe(true);
  });

  it('杠杆超过合约最高杠杆：直接拒绝', () => {
    const r = kaitoCoin({ leverage: 76, orderNotionalUsd: 10 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('leverage-above-max');
    expect(r.cap).toBe(0);
    expect(r.message).toBe('76x 超过该合约最高杠杆 75x，请调低杠杆倍数至 75x 以下');
  });

  it('真币本位（BTCUSD）以 BTC 计：张数 × 面值 ÷ 标记价', () => {
    const btc = (contracts: number): Position => coinPos('LONG', contracts, {
      contractSizeUsd: 100, settlementAsset: 'BTC', entryPrice: 10_000,
    });
    const r = checkOrderPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 125,
      positions: [btc(500)], orders: [], markPrice: 10_000,
      orderNotionalUsd: 100 * 100,                                         // 100 张 = 1 BTC
    });
    expect(r.unit).toBe('BTC');
    expect(r.exposureBefore).toBe(5);
    expect(r.exposureAfter).toBe(6);
    expect(r.cap).toBe(5);
    expect(r.ok).toBe(false);
    expect(r.maxLeverageForResult).toBe(100);
    expect(r.message).toContain('125x 最高 5 BTC');
    // 同样的张数，价格翻倍后折成的币数减半，就过得去了
    const later = checkOrderPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 125,
      positions: [btc(500)], orders: [], markPrice: 20_000, orderNotionalUsd: 10_000,
    });
    expect(later.exposureAfter).toBe(3);
    expect(later.ok).toBe(true);
  });

  it('真币本位取不到标记价时不下结论（引擎本来就拒绝无价下单）', () => {
    const r = checkOrderPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 125,
      positions: [], orders: [], markPrice: 0, orderNotionalUsd: 1_000_000,
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('no-price');
    expect(remainingOpenUsd(r, 0)).toBe(Infinity);
  });
});

describe('可开：分层还剩多少', () => {
  it('合成币本位直接是 USD', () => {
    const r = kaitoCoin({ positions: [coinPos('LONG', 2_000)] });
    expect(r.remaining).toBe(30_000);
    expect(remainingOpenUsd(r, 1.0905)).toBe(30_000);
  });

  it('真币本位按标记价把剩余币数折回 USD', () => {
    const r = checkOrderPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 100,
      positions: [coinPos('LONG', 600, { contractSizeUsd: 100, entryPrice: 10_000 })],
      orders: [], markPrice: 10_000, orderNotionalUsd: 0,
    });
    expect(r.cap).toBe(10);
    expect(r.remaining).toBe(4);
    expect(remainingOpenUsd(r, 10_000)).toBe(40_000);
  });

  it('已经超过上限时剩余为 0', () => {
    const r = kaitoCoin({ positions: [coinPos('LONG', 6_000)] });
    expect(r.remaining).toBe(0);
    expect(remainingOpenUsd(r, 1)).toBe(0);
  });
});

describe('杠杆的夹取与改杠杆的判定', () => {
  it('夹到合约（当前结算方式）的最高杠杆', () => {
    expect(clampSymbolLeverage('KAITOUSDT', 'usdt', 125)).toBe(75);
    expect(clampSymbolLeverage('KAITOUSDT', 'coin', 125)).toBe(75);
    expect(clampSymbolLeverage('BTCUSDT', 'usdt', 150)).toBe(150);
    expect(clampSymbolLeverage('BTCUSDT', 'coin', 150)).toBe(125);
    expect(clampSymbolLeverage('LUMIAUSDT', 'usdt', 35)).toBe(10);
    expect(clampSymbolLeverage('KAITOUSDT', 'usdt', 0)).toBe(1);
  });

  it('改杠杆：当前结算方式之外、手上有敞口的那张合约也要过', () => {
    // 面板在币本位，U 本位 KAITOUSDT 上有 30,000 的持仓：提到 25x（最高 25,000）必须拒绝
    const r = checkLeverageChange({
      symbol: 'KAITOUSDT', settlement: 'coin', leverage: 25,
      positions: [usdtPos('LONG', 30_000)], orders: [], markPrice: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.unit).toBe('USDT');
    expect(r.message).toBe('另有 U 本位持仓或委托：请调低杠杆倍数至 20x 以下：持仓和当前委托价值 30,000 USDT 超过 25x 最高可持有头寸 25,000 USDT');
    // 20x 过得去，返回的是面板那种结算方式（币本位）的结果
    const ok = checkLeverageChange({
      symbol: 'KAITOUSDT', settlement: 'coin', leverage: 20,
      positions: [usdtPos('LONG', 30_000)], orders: [], markPrice: 1,
    });
    expect(ok.ok).toBe(true);
    expect(ok.unit).toBe('USD');
  });

  it('【一致性】杠杆对话框的拒绝 ⟺ 下单面板的判定 ⟺ 敞口 > maxPositionAtLeverage', () => {
    const tiers = resolveSymbolTiers('KAITOUSD', 'coin').tiers;
    const exposures = [1, 4_999, 5_000, 5_010, 25_000, 25_010, 50_000, 50_010, 999_990, 1_000_000, 1_000_010, 7_500_000];
    for (const usd of exposures) {
      // 1x 的旧仓位：保证金 = 名义，离强平远，下限 1x——只剩分层这一道闸
      const pos = coinPos('LONG', usd / 10, { leverage: 1, margin: usd, isolatedMargin: usd, marginCoin: usd });
      for (const L of [1, 2, 3, 4, 5, 10, 11, 20, 21, 25, 26, 50, 51, 75]) {
        const plan = planLeverageChange({
          symbol: 'KAITOUSD', positions: [pos], orders: [], markPrice: 1,
          currentLeverage: L === 1 ? 2 : 1, nextLeverage: L, settlementMode: 'coin',
        });
        const panel = checkOrderPositionLimit({
          symbol: 'KAITOUSD', settlement: 'coin', leverage: L, positions: [pos], orders: [],
          markPrice: 1, orderNotionalUsd: 0,
        });
        const independent = usd <= maxPositionAtLeverage(tiers, L);
        expect(plan.refusal?.code === 'tier-cap', `usd=${usd} L=${L}`).toBe(!independent);
        expect(panel.ok, `usd=${usd} L=${L}`).toBe(independent);
      }
    }
  });
});

describe('引擎下单时这一单的名义', () => {
  it('分段订单按各子单委托价求和；币本位按张数 × 面值', () => {
    expect(placementOrderNotionalUsd('KAITOUSDT', {
      type: 'SCALED', quantity: 100, stopPrice: 0, settlementMode: 'usdt',
      scaledCount: 5, scaledStartPrice: 1, scaledEndPrice: 2,
    }, 1.5)).toBeCloseTo(20 * (1 + 1.25 + 1.5 + 1.75 + 2), 9);
    expect(placementOrderNotionalUsd('KAITOUSD', {
      type: 'SCALED', quantity: 10, contracts: 10, contractSizeUsd: 10, stopPrice: 0, settlementMode: 'coin',
      scaledCount: 4, scaledStartPrice: 1, scaledEndPrice: 2,
    }, 1.5)).toBe(4 * 3 * 10);
  });

  it('跟踪委托按激活价，没有激活价按参照价；其余按参照价', () => {
    const trailing = { type: 'TRAILING_STOP' as const, quantity: 100, settlementMode: 'usdt' as const };
    expect(placementOrderNotionalUsd('KAITOUSDT', { ...trailing, stopPrice: 2 }, 1)).toBe(200);
    expect(placementOrderNotionalUsd('KAITOUSDT', { ...trailing, stopPrice: 0 }, 1.5)).toBe(150);
    expect(placementOrderNotionalUsd('KAITOUSDT', { type: 'MARKET', quantity: 100, stopPrice: 0 }, 1.1)).toBeCloseTo(110, 9);
    expect(placementOrderNotionalUsd('KAITOUSD', {
      type: 'CONDITIONAL', quantity: 163_578, contracts: 163_578, contractSizeUsd: 10, stopPrice: 9, settlementMode: 'coin',
    }, 9)).toBe(1_635_780);
  });

  it('触发后才下单的开仓类型', () => {
    expect(isTriggeredOpenOrder({ type: 'CONDITIONAL' })).toBe(true);
    expect(isTriggeredOpenOrder({ type: 'TRAILING_STOP' })).toBe(true);
    expect(isTriggeredOpenOrder({ type: 'MARKET_TP_SL' })).toBe(true);
    expect(isTriggeredOpenOrder({ type: 'CONDITIONAL', reduceOnly: true })).toBe(false);
    expect(isTriggeredOpenOrder({ type: 'LIMIT' })).toBe(false);
    expect(isTriggeredOpenOrder({ type: 'TWAP' })).toBe(false);
  });
});

describe('改杠杆：两种结算方式都有敞口时，各按各的最高杠杆', () => {
  it('持仓卡按 U 本位（BNBUSDT 75x）提到 40x，但手上还有币本位 BNB（BNBUSD 最高 20x）：拒绝并说明是哪一张', () => {
    const coinBnb = {
      id: 'bc', side: 'LONG', quantity: 60, contracts: 60, contractSizeUsd: 10, entryPrice: 600, leverage: 10,
      marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'BNB', margin: 60, isolatedMargin: 60,
      marginCoin: 0.1, openTime: 1,
    } as Position;
    const usdtBnb = {
      id: 'bu', side: 'LONG', quantity: 10, entryPrice: 600, leverage: 10, marginMode: 'isolated',
      settlementMode: 'usdt', settlementAsset: 'USDT', margin: 600, isolatedMargin: 600, openTime: 1,
    } as Position;
    const r = checkLeverageChange({
      symbol: 'BNBUSDT', settlement: 'usdt', leverage: 40, positions: [usdtBnb, coinBnb], orders: [], markPrice: 600,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('leverage-above-max');
    expect(r.message).toBe('另有币本位持仓或委托：40x 超过该合约最高杠杆 20x，请调低杠杆倍数至 20x 以下');
    // 20x 两张都过
    expect(checkLeverageChange({
      symbol: 'BNBUSDT', settlement: 'usdt', leverage: 20, positions: [usdtBnb, coinBnb], orders: [], markPrice: 600,
    }).ok).toBe(true);
  });
});

describe('现有敞口自己就已超过上限：说清出路，不再一律叫人「调低杠杆或减少数量」', () => {
  const tiered = { riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT' } as const;

  it('【复核】15x 开 45,000 USDT、涨到 1.2（54,000）：再小的对冲单也开不出去，逐仓又不能降杠杆 → 只能减仓或撤单', () => {
    const pos = usdtPos('LONG', 45_000, 1.0, tiered);
    const r = checkOrderPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions: [pos], orders: [],
      markPrice: 1.2, orderNotionalUsd: 6,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('exposure-over-cap');
    expect(r.leverageFloor).toBe(15);
    expect(r.maxLeverageForExposure).toBe(10);
    expect(r.message).toBe(
      '现有持仓和当前委托价值 54,000 USDT 已超过当前杠杆倍数最高可持有头寸：15x 最高 50,000 USDT，'
      + '这个杠杆下再小的单也开不出去。逐仓有持仓时不能降杠杆（当前最低 15x），'
      + '只能先减仓或撤单，把总量降到 50,000 USDT 以下再开新单。',
    );
    expect(r.message).not.toContain('请调低杠杆');
  });

  it('【复核】更新前按 35x 开的 20,000 KAITO（新规则 35x 最多 10,000）：点明是旧规则留下的仓位', () => {
    const legacy = usdtPos('LONG', 20_000, 1.0, { leverage: 35 });
    const r = checkOrderPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 35, positions: [legacy], orders: [],
      markPrice: 1, orderNotionalUsd: 100,
    });
    expect(r.reason).toBe('exposure-over-cap');
    expect(r.legacyExposure).toBe(true);
    expect(r.message).toBe(
      '现有持仓和当前委托价值 20,000 USDT（含更新前按旧规则开的仓位）已超过当前杠杆倍数最高可持有头寸：'
      + '35x 最高 10,000 USDT，这个杠杆下再小的单也开不出去。逐仓有持仓时不能降杠杆（当前最低 35x），'
      + '只能先减仓或撤单，把总量降到 10,000 USDT 以下再开新单。',
    );
  });

  it('只有挂单、没有持仓：降杠杆是走得通的，照币安的话说', () => {
    const r = kaitoCoin({ orders: [coinOrder(6_000)], orderNotionalUsd: 10 });   // 60,000 USD，15x 最高 50,000
    expect(r.reason).toBe('exposure-over-cap');
    expect(r.leverageFloor).toBe(1);
    expect(r.message).toBe(
      '现有持仓和当前委托价值 60,000 USD 已超过当前杠杆倍数最高可持有头寸：15x 最高 50,000 USD，'
      + '这个杠杆下再小的单也开不出去。请调低杠杆倍数至 10x 以下，或先减仓、撤单。',
    );
  });

  it('持仓的杠杆低于当前杠杆时，降到持仓的杠杆也是出路（下限不挡）', () => {
    const pos = coinPos('LONG', 3_000, { leverage: 10, riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSD' });
    const r = kaitoCoin({ leverage: 25, positions: [pos], orderNotionalUsd: 10 });   // 30,000 > 25x 的 25,000
    expect(r.reason).toBe('exposure-over-cap');
    expect(r.message).toContain('请调低杠杆倍数至 20x 以下，或先减仓、撤单。');
  });

  it('现有敞口超过最高一档：任何杠杆都不行', () => {
    const r = kaitoCoin({ leverage: 1, orders: [coinOrder(1_300_000, { leverage: 1 })], orderNotionalUsd: 10 });
    expect(r.reason).toBe('exposure-over-cap');
    expect(r.maxLeverageForExposure).toBe(0);
    expect(r.message).toBe(
      '现有持仓和当前委托价值 13,000,000 USD 已超过该合约最大可持有头寸 12,500,000 USD（任何杠杆都不可开）：'
      + '请先减仓或撤单，把总量降到 12,500,000 USD 以下再开新单。',
    );
  });

  it('是这一单把总量顶过上限的：原文案不变；只减仓仍然放行', () => {
    const r = kaitoCoin({ positions: [coinPos('LONG', 4_000)], orderNotionalUsd: 15_000 });
    expect(r.reason).toBe('exceeds-cap');
    expect(r.message).toContain('请调低杠杆或减少数量');
    const reduce = checkOrderPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions: [usdtPos('LONG', 60_000)], orders: [],
      markPrice: 1, orderNotionalUsd: 100, reduceOnly: true,
    });
    expect(reduce).toMatchObject({ ok: true, reason: 'reduce-only' });
  });

  it('杠杆下限 = 所有未平仓位里最高的杠杆（两种结算方式一起算，与改杠杆的下限同一口径）', () => {
    expect(leverageFloorOf([])).toBe(1);
    expect(leverageFloorOf([usdtPos('LONG', 1, 1, { leverage: 20 }), coinPos('SHORT', 1, { leverage: 35 })])).toBe(35);
    expect(leverageFloorOf([usdtPos('LONG', 0, 1, { leverage: 50 })])).toBe(1);   // 已平的不算
  });

  it('改杠杆：现有敞口在最低可选杠杆上也放不下时，拒绝理由说「调整杠杆解决不了」', () => {
    const legacy = usdtPos('LONG', 20_000, 1.0, { leverage: 35 });
    const r = checkLeverageChange({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 40, positions: [legacy], orders: [], markPrice: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toBe(
      '调整杠杆解决不了：现有持仓和当前委托价值 20,000 USDT（含更新前按旧规则开的仓位）已超过当前杠杆倍数最高可持有头寸：'
      + '35x 最高 10,000 USDT，这个杠杆下再小的单也开不出去。逐仓有持仓时不能降杠杆（当前最低 35x），'
      + '只能先减仓或撤单，把总量降到 10,000 USDT 以下再开新单。',
    );
    expect(r.message).not.toContain('请调低杠杆倍数至 25x');
  });
});

describe('【复核】触发类开仓单：下单时还要按触发价判一道', () => {
  const btcLong = (contracts: number) => coinPos('LONG', contracts, {
    contractSizeUsd: 100, settlementAsset: 'BTC', entryPrice: 60_000, leverage: 20,
  });

  it('BTCUSD 60,000、20x（最高 150 BTC）：多 50,000 张 + 空头条件单 35,000 张 @54,000 → 下单时就拒', () => {
    // 与引擎下单同一组参数：这一单的估值价就是它自己的触发价
    const r = checkPlacementPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 20, positions: [btcLong(50_000)], orders: [],
      markPrice: 60_000, orderNotionalUsd: 3_500_000, orderPrice: 54_000, triggerPrice: 54_000,
    });
    expect(r.atMark.ok).toBe(true);                                   // 5,000,000 / 60,000 + 3,500,000 / 54,000 = 148.15 BTC
    expect(r.atMark.exposureAfter).toBeCloseTo(83.3333 + 64.8148, 3);
    expect(r.atTrigger?.ok).toBe(false);                              // 8,500,000 / 54,000 = 157.41 BTC
    expect(r.atTrigger?.exposureAfter).toBeCloseTo(157.4074, 3);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('exceeds-cap');
    expect(r.message).toBe(
      `按触发价 ${formatPrice(54_000)} 估值：持仓和当前委托价值超过当前杠杆倍数最高可持有头寸：20x 最高 150 BTC。`
      + '按这个规模最高可用 10x，请调低杠杆或减少数量。',
    );
  });

  it('U 本位镜像：空 24,000 KAITO @1.0、20x，多头条件单 24,000 @1.05 → 下单时就拒（49,200 / 50,400）', () => {
    const short = usdtPos('SHORT', 24_000, 1.0, { leverage: 20 });
    const r = checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions: [short], orders: [],
      markPrice: 1.0, orderNotionalUsd: 24_000 * 1.05, triggerPrice: 1.05,
    });
    expect(r.atMark).toMatchObject({ ok: true });
    expect(r.atMark.exposureAfter).toBeCloseTo(49_200, 6);
    expect(r.atTrigger?.exposureAfter).toBeCloseTo(50_400, 6);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('按触发价 1.05');
    expect(r.message).toContain('20x 最高 50,000 USDT');
  });

  it('两道都过才放行；没有触发价（普通单 / 没填激活价的跟踪委托）只判现价这一道', () => {
    const short = usdtPos('SHORT', 24_000, 1.0, { leverage: 20 });
    const ok = checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions: [short], orders: [],
      markPrice: 1.0, orderNotionalUsd: 24_000 * 0.95, triggerPrice: 0.95,
    });
    expect(ok.ok).toBe(true);
    expect(ok.atTrigger?.ok).toBe(true);
    expect(ok.message).toBeNull();
    const plain = checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions: [short], orders: [],
      markPrice: 1.0, orderNotionalUsd: 24_000,
    });
    expect(plain.atTrigger).toBeNull();
    expect(plain.ok).toBe(true);
    expect(plain.cap).toBe(50_000);
  });

  it('现价那一道先不过时报现价那一道（不加触发价前缀）', () => {
    const r = checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions: [], orders: [],
      markPrice: 1.0, orderNotionalUsd: 60_000, triggerPrice: 1.2,
    });
    expect(r.ok).toBe(false);
    expect(r.message?.startsWith('持仓和当前委托价值超过')).toBe(true);
  });

  it('「可开」取两道余量的较小者（触发价那一道按触发价折回 USD）', () => {
    const r = checkPlacementPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 20, positions: [btcLong(50_000)], orders: [],
      markPrice: 60_000, orderNotionalUsd: 0, triggerPrice: 54_000,
    });
    // 现价：150 − 83.33 = 66.67 BTC × 60,000 = 4,000,000 USD（再留 0.2% 余量）
    // 触发价：150 − 92.59 = 57.41 BTC × 54,000 = 3,100,000 USD
    const live = { orderAtMarket: false, hasOpenPositions: true };
    expect(placementSizingRemainingUsd(r, 60_000, live)).toBeCloseTo(3_100_000, 3);
    const noTrigger = checkPlacementPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 20, positions: [btcLong(50_000)], orders: [],
      markPrice: 60_000, orderNotionalUsd: 0,
    });
    expect(placementSizingRemainingUsd(noTrigger, 60_000, live)).toBeCloseTo(4_000_000 - 9_000_000 * 0.002, 3);
  });

  it('触发那一刻按哪个价再判：条件单 = 触发价，跟踪委托 = 激活价，旧止盈止损开仓单按引擎的成交价；其余没有', () => {
    expect(triggeredCheckPrice({ type: 'CONDITIONAL', price: 0.9, stopPrice: 1.2 })).toBe(1.2);
    expect(triggeredCheckPrice({ type: 'CONDITIONAL', price: 0, stopPrice: 0 })).toBe(0);
    expect(triggeredCheckPrice({ type: 'TRAILING_STOP', price: 0, stopPrice: 1.1 })).toBe(1.1);
    expect(triggeredCheckPrice({ type: 'TRAILING_STOP', price: 0, stopPrice: 0 })).toBe(0);
    expect(triggeredCheckPrice({ type: 'MARKET_TP_SL', price: 0, stopPrice: 1.3 })).toBe(1.3);
    expect(triggeredCheckPrice({ type: 'LIMIT_TP_SL', price: 0.8, stopPrice: 1.3 })).toBe(0.8);
    expect(triggeredCheckPrice({ type: 'LIMIT', price: 0.8, stopPrice: 0 })).toBe(0);
    expect(triggeredCheckPrice({ type: 'CONDITIONAL', price: 0, stopPrice: 1.2, reduceOnly: true })).toBe(0);
  });
});

// ───────────────────────── 复核第三轮 ─────────────────────────

const btcCoin = (side: 'LONG' | 'SHORT', contracts: number, over: Partial<Position> = {}): Position => coinPos(side, contracts, {
  contractSizeUsd: 100, settlementAsset: 'BTC', entryPrice: 100_000, leverage: 125, ...over,
});
const btcOrder = (contracts: number, over: Partial<PendingOrder> = {}): PendingOrder => coinOrder(contracts, {
  contractSizeUsd: 100, settlementAsset: 'BTC', leverage: 125, price: 90_000, ...over,
});

describe('【复核 r3】真币本位：挂单与这一单按各自的价折币，只有持仓按标记价', () => {
  it('估值价：限价 = 委托价，条件单 = 触发价（不读残留的委托价），跟踪委托 = 激活价，TWAP / 市价 = 标记价', () => {
    expect(orderValuationPrice({ type: 'LIMIT', price: 90, stopPrice: 0 }, 100)).toBe(90);
    expect(orderValuationPrice({ type: 'CONDITIONAL', price: 0.0113, stopPrice: 120 }, 100)).toBe(120);
    expect(orderValuationPrice({ type: 'TRAILING_STOP', price: 0, stopPrice: 110 }, 100)).toBe(110);
    expect(orderValuationPrice({ type: 'TRAILING_STOP', price: 0, stopPrice: 0 }, 100)).toBe(100);
    expect(orderValuationPrice({ type: 'TWAP', price: 0, stopPrice: 0 }, 100)).toBe(100);
    expect(orderValuationPrice({ type: 'MARKET_TP_SL', price: 0, stopPrice: 130 }, 100)).toBe(130);
    expect(orderValuationPrice({ type: 'TWAP', price: 0, stopPrice: 0 }, 0)).toBe(0);
  });

  it('BTCUSD 标记价 100,000：挂着 4,500 张 @90,000 的买入限价单 = 5 BTC（按标记价折只有 4.5）；持仓 100 张按标记价 = 0.1 BTC', () => {
    const ctx = {
      symbol: 'BTCUSDT', settlement: 'coin' as const, markPrice: 100_000,
      positions: [btcCoin('SHORT', 100)], orders: [btcOrder(4_500)],
    };
    expect(exposureInTierUnit(ctx)).toBeCloseTo(0.1 + 5, 9);
    // 价格在 95,000（还没到 90,000）：持仓按 95,000 估值，限价单仍按自己的委托价
    expect(exposureInTierUnit({ ...ctx, markPrice: 95_000 })).toBeCloseTo(10_000 / 95_000 + 5, 9);
    // 价格走到 80,000：90,000 的买单已经成交，是按 80,000 估值的持仓（450,000 ÷ 80,000 = 5.625）
    expect(exposureInTierUnit({ ...ctx, markPrice: 80_000 })).toBeCloseTo(0.125 + 5.625, 9);
  });

  it('【复现】125x（最高 5 BTC）、限价 90,000：100% 只给 450,000 USD = 4,500 张；4,990 张下单就拒；4,500 张成交后正好 5 BTC，不会卡死', () => {
    const place = (usd: number) => checkPlacementPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 125, positions: [], orders: [],
      markPrice: 100_000, orderNotionalUsd: usd, orderPrice: 90_000, side: 'LONG',
    });
    const live = { orderAtMarket: false, hasOpenPositions: false };
    // 限价单、没有持仓：估值不随现价漂，不留余量
    expect(placementSizingRemainingUsd(place(0), 100_000, live)).toBeCloseTo(450_000, 6);
    // 按标记价折的旧口径会给 499,000（4,990 张），成交后 5.544 BTC
    const tooMany = place(4_990 * 100);
    expect(tooMany.ok).toBe(false);
    expect(tooMany.exposureAfter).toBeCloseTo(5.5444, 3);
    expect(place(4_500 * 100).ok).toBe(true);

    // 成交在 90,000：仓位按标记价 90,000 估值 = 5 BTC，恰好在 125x 的上限上
    const filled = [btcCoin('LONG', 4_500, { entryPrice: 90_000 })];
    const after = checkOrderPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 125, positions: filled, orders: [], markPrice: 90_000, orderNotionalUsd: 0,
    });
    expect(after.exposureBefore).toBeCloseTo(5, 9);
    expect(after.ok).toBe(true);
    expect(after.reason).toBe('ok');
    const change = checkLeverageChange({ symbol: 'BTCUSDT', settlement: 'coin', leverage: 125, positions: filled, orders: [], markPrice: 90_000 });
    expect(change.ok).toBe(true);
  });

  it('只有挂单时，没有标记价也能判改杠杆：20 BTC 的限价单不能提到 125x', () => {
    const orders = [btcOrder(20_000, { price: 100_000, leverage: 20 })];
    const plan = planLeverageChange({
      symbol: 'BTCUSDT', positions: [], orders, markPrice: 0, currentLeverage: 20, nextLeverage: 125, settlementMode: 'coin',
    });
    expect(plan.ok).toBe(false);
    expect(plan.refusal?.code).toBe('tier-cap');
    expect(plan.tierExposure).toBeCloseTo(20, 9);
  });

  it('分段订单：每笔子单按自己的价折币，估值价 = 名义 ÷ 币数合计', () => {
    const v = placementOrderValuation('BTCUSDT', {
      type: 'SCALED', quantity: 300, stopPrice: 0, settlementMode: 'coin', contracts: 300, contractSizeUsd: 100,
      scaledCount: 3, scaledStartPrice: 80_000, scaledEndPrice: 100_000,
    }, 100_000);
    const coins = 10_000 / 80_000 + 10_000 / 90_000 + 10_000 / 100_000;
    expect(v.usd).toBe(30_000);
    expect(v.usd / v.price).toBeCloseTo(coins, 12);
  });

  it('「可开」的 0.2% 余量：真币本位也只在按现价成交或已有持仓时留；合成币本位从不留', () => {
    const btc = (orderPrice: number) => checkOrderPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 125, positions: [], orders: [], markPrice: 100_000,
      orderNotionalUsd: 0, orderPrice,
    });
    expect(sizingRemainingOpenUsd(btc(90_000), 100_000, { orderAtMarket: false, hasOpenPositions: false })).toBeCloseTo(450_000, 6);
    expect(sizingRemainingOpenUsd(btc(90_000), 100_000, { orderAtMarket: false, hasOpenPositions: true }))
      .toBeCloseTo(450_000 - 450_000 * 0.002, 6);
    expect(sizingRemainingOpenUsd(btc(100_000), 100_000, { orderAtMarket: true, hasOpenPositions: false }))
      .toBeCloseTo(500_000 - 500_000 * 0.002, 6);
    const kaito = kaitoCoin({ positions: [coinPos('LONG', 1_000)] });
    expect(sizingRemainingOpenUsd(kaito, 1.0905, { orderAtMarket: true, hasOpenPositions: true })).toBe(40_000);
  });
});

describe('【复核 r3】已挂的带戳触发单：这一步之后触发时会被拒，就预警（不拦）', () => {
  const stamped = { riskModel: 'binance-tiers-v1' as const };
  const shortPos = (qty: number, leverage = 15) => usdtPos('SHORT', qty, 1.0, { leverage, ...stamped });
  const longStop = (qty: number, over: Partial<PendingOrder> = {}): PendingOrder => ({
    id: `c${++seq}`, side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 1.2, quantity: qty, leverage: 15,
    marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'PENDING', createdAt: 0,
    ...stamped, ...over,
  } as PendingOrder);

  it('KAITOUSDT 15x：空 20,000 + 多头条件单 20,000 @1.2（触发时 48,000，放得下）；再市价空 5,000 → 触发时 54,000，被拒', () => {
    const positions = [shortPos(20_000)];
    const stop = longStop(20_000);
    const orders = [stop];
    expect(isTriggerRecheckedOrder(stop)).toBe(true);
    expect(restingTriggerCheck('KAITOUSDT', stop, { positions, orders })).toMatchObject({ ok: true, price: 1.2 });
    expect(doomedAtTrigger('KAITOUSDT', stop, positions, orders)).toBeNull();

    const added = placementAftermath(
      { type: 'MARKET', side: 'SHORT', leverage: 15, quantity: 5_000, stopPrice: 0, settlementMode: 'usdt' },
      { markPrice: 1.0, immediate: true },
    );
    expect(added.positions).toHaveLength(1);
    // 下单那一刻的判定本身放行（49,000 ≤ 50,000）——币安也不拦
    expect(checkOrderPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions, orders, markPrice: 1.0,
      orderNotionalUsd: 5_000, side: 'SHORT',
    }).ok).toBe(true);
    const risks = newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders, added });
    expect(risks).toHaveLength(1);
    expect(risks[0].order.id).toBe(stop.id);
    expect(risks[0].check.exposureAfter).toBeCloseTo(54_000, 6);
    const text = triggerRiskMessage(risks, '这张单下出去后')!;
    expect(text.title).toBe(`这张单下出去后，已挂的做多条件单 ${formatPrice(1.2)} 触发时会因超出当前杠杆最高可持有头寸被拒`);
    expect(text.description).toContain('= 54,000 USDT');
    expect(text.description).toContain('超过 15x 最高 50,000 USDT');
    expect(text.description).toContain('币安不在这一步拦');
    // 这一单是限价单时：价格从 1.0 走到 1.2 的路上会成交的（卖价 0.9 已经穿价、卖价 1.1 在路上），到 1.2 时是按 1.2 估值的持仓
    // → 24,000 + 6,000 + 24,000 = 54,000；路上不会成交的（卖价 1.3）仍是挂单，按委托价 → 24,000 + 24,000 + 6,500 = 54,500
    const asLimit = (price: number) => placementAftermath(
      { type: 'LIMIT', side: 'SHORT', leverage: 15, quantity: 5_000, price, stopPrice: 0, settlementMode: 'usdt' },
      { markPrice: 1.0, immediate: false },
    );
    for (const [price, exposure] of [[0.9, 54_000], [1.1, 54_000], [1.3, 54_500]] as const) {
      expect(newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders, added: asLimit(price), markPrice: 1.0 })[0].check.exposureAfter)
        .toBeCloseTo(exposure, 6);
    }
    // 小一点的单不影响：空 1,000 → 触发时 25,200 + 24,000 = 49,200
    const small = placementAftermath(
      { type: 'MARKET', side: 'SHORT', leverage: 15, quantity: 1_000, stopPrice: 0, settlementMode: 'usdt' },
      { markPrice: 1.0, immediate: true },
    );
    expect(newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders, added: small })).toEqual([]);
  });

  it('改杠杆：空 10,000 @20x + 多头止损对冲 11,000 @1.2；提到 25x 放行，但触发时 25,200 > 25,000', () => {
    const positions = [shortPos(10_000, 20)];
    const orders = [longStop(11_000, { leverage: 20 })];
    expect(checkLeverageChange({ symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 25, positions, orders, markPrice: 1.0 }).ok).toBe(true);
    const risks = newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders, leverage: 25 });
    expect(risks).toHaveLength(1);
    expect(risks[0].check.leverage).toBe(25);
    expect(risks[0].check.exposureAfter).toBeCloseTo(25_200, 6);
    expect(triggerRiskMessage(risks, '杠杆调到 25x 后')!.title)
      .toBe(`杠杆调到 25x 后，已挂的做多条件单 ${formatPrice(1.2)} 触发时会因超出当前杠杆最高可持有头寸被拒`);
    expect(newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders, leverage: 20 })).toEqual([]);
  });

  it('只看会被再判的单：更新前挂的（没有戳）、只减仓、没有激活价的跟踪委托不预警；已经注定被拒的不重复说，由委托列表标出', () => {
    const positions = [shortPos(20_000)];
    const legacy = longStop(20_000, { riskModel: undefined });
    const reduce = longStop(20_000, { reduceOnly: true });
    const trailingNoActivation = longStop(20_000, { type: 'TRAILING_STOP', stopPrice: 0 });
    expect([legacy, reduce, trailingNoActivation].map(isTriggerRecheckedOrder)).toEqual([false, false, false]);
    const added = placementAftermath(
      { type: 'MARKET', side: 'SHORT', leverage: 15, quantity: 5_000, stopPrice: 0, settlementMode: 'usdt' },
      { markPrice: 1.0, immediate: true },
    );
    expect(newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders: [legacy, reduce, trailingNoActivation], added })).toEqual([]);

    const doomed = longStop(22_000);                                     // 24,000 + 26,400 = 50,400 已经超了
    expect(doomedAtTrigger('KAITOUSDT', doomed, positions, [doomed])).toMatchObject({ ok: false, price: 1.2 });
    expect(newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders: [doomed], added })).toEqual([]);
  });

  it('跟踪委托按激活价预判，文案写激活价', () => {
    const positions = [shortPos(20_000)];
    const trailing = longStop(20_000, { type: 'TRAILING_STOP', stopPrice: 1.2, callbackRate: 0.01 });
    const added = placementAftermath(
      { type: 'MARKET', side: 'SHORT', leverage: 15, quantity: 5_000, stopPrice: 0, settlementMode: 'usdt' },
      { markPrice: 1.0, immediate: true },
    );
    const risks = newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders: [trailing], added });
    expect(triggerRiskMessage(risks, '这张单下出去后')!.title)
      .toBe(`这张单下出去后，已挂的做多跟踪委托（激活价 ${formatPrice(1.2)}）触发时会因超出当前杠杆最高可持有头寸被拒`);
  });

  it('分段订单下出去后按各子单的委托价算作挂单', () => {
    const added = placementAftermath(
      { type: 'SCALED', side: 'SHORT', leverage: 15, quantity: 3_000, stopPrice: 0, settlementMode: 'usdt', scaledCount: 3, scaledStartPrice: 1.0, scaledEndPrice: 1.2 },
      { markPrice: 1.0, immediate: false },
    );
    expect(added.orders.map(o => [o.type, o.price, o.quantity])).toEqual([['LIMIT', 1.0, 1_000], ['LIMIT', 1.1, 1_000], ['LIMIT', 1.2, 1_000]]);
    expect(symbolExposureUsd('KAITOUSDT', [], added.orders, 1.0)).toBeCloseTo(3_300, 9);
  });
});

describe('【复核 r3】更新前按旧规则开的仓位超过新上限：反向对冲不受限，往旧仓位那一侧加仓照常受限', () => {
  /** KAITOUSD 币本位旧多仓 20,000 张 = 200,000 USD @20x（旧通用表放行；新规则 20x 最高 50,000）。 */
  const legacyLong = () => coinPos('LONG', 20_000, { leverage: 20 });
  const order = (side: 'LONG' | 'SHORT', contracts: number, over: Partial<Parameters<typeof checkOrderPositionLimit>[0]> = {}) =>
    checkOrderPositionLimit({
      symbol: 'KAITOUSD', settlement: 'coin', leverage: 20, positions: [legacyLong()], orders: [], markPrice: 1,
      orderNotionalUsd: contracts * 10, side, ...over,
    });

  it('反向对冲 1,000 张放行（legacy-hedge）；对冲到旧仓位的全部名义 20,000 张也放行', () => {
    const hedge = order('SHORT', 1_000);
    expect(hedge.ok).toBe(true);
    expect(hedge.reason).toBe('legacy-hedge');
    expect(hedge.message).toBeNull();
    expect(hedge.legacyHedgeBase).toBe(200_000);
    expect(hedge.legacyHedgeRoom).toBe(200_000);
    expect(order('SHORT', 20_000)).toMatchObject({ ok: true, reason: 'legacy-hedge' });
  });

  it('对冲超过旧仓位名义就不放行，文案给出豁免额度；已有的反向持仓与挂单要从额度里扣掉', () => {
    const over = order('SHORT', 20_001);
    expect(over.ok).toBe(false);
    expect(over.reason).toBe('exposure-over-cap');
    expect(over.message).toContain('这一单是反向对冲更新前的仓位，不受此限的额度最多 200,000 USD');
    // 已经对冲了 15,000 张（新仓位）、还挂着 4,000 张空单：只剩 1,000 张
    const hedged = [legacyLong(), coinPos('SHORT', 15_000, { leverage: 20, riskModel: 'binance-tiers-v1' })];
    const resting = [coinOrder(4_000, { side: 'SHORT', leverage: 20 })];
    const room = order('SHORT', 1_000, { positions: hedged, orders: resting });
    expect(room).toMatchObject({ ok: true, reason: 'legacy-hedge', legacyHedgeRoom: 10_000 });
    expect(order('SHORT', 1_001, { positions: hedged, orders: resting }).ok).toBe(false);
    // 「可开」：开空这一侧还剩 10,000 USD，开多为 0
    expect(remainingOpenUsd(room, 1)).toBe(10_000);
    expect(remainingOpenUsd(order('LONG', 0, { positions: hedged, orders: resting }), 1)).toBe(0);
  });

  it('往旧仓位那一侧加仓照常受上限约束，文案指出反向对冲不受此限', () => {
    const add = order('LONG', 1);
    expect(add.ok).toBe(false);
    expect(add.reason).toBe('exposure-over-cap');
    expect(add.message).toContain('（含更新前按旧规则开的仓位）');
    expect(add.message).toContain('反向开仓对冲更新前的仓位不受此限，最多 200,000 USD。');
  });

  it('带分层戳的仓位没有豁免；改杠杆（没有方向）也没有', () => {
    const stampedLong = coinPos('LONG', 20_000, { leverage: 20, riskModel: 'binance-tiers-v1' });
    const r = order('SHORT', 1_000, { positions: [stampedLong] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('exposure-over-cap');
    expect(r.message).not.toContain('反向');
    const change = checkLeverageChange({ symbol: 'KAITOUSD', settlement: 'coin', leverage: 20, positions: [legacyLong()], orders: [], markPrice: 1 });
    expect(change.ok).toBe(false);
    // 没有方向的判定（旧调用口径）不放行
    expect(checkOrderPositionLimit({
      symbol: 'KAITOUSD', settlement: 'coin', leverage: 20, positions: [legacyLong()], orders: [], markPrice: 1, orderNotionalUsd: 10_000,
    }).ok).toBe(false);
  });

  it('触发类对冲单下单时两道都按豁免判；触发那一刻（排除它自己）同样放行', () => {
    const placement = checkPlacementPositionLimit({
      symbol: 'KAITOUSD', settlement: 'coin', leverage: 20, positions: [legacyLong()], orders: [], markPrice: 1,
      orderNotionalUsd: 50_000, orderPrice: 0.9, side: 'SHORT', triggerPrice: 0.9,
    });
    expect(placement.ok).toBe(true);
    expect(placement.atTrigger?.reason).toBe('legacy-hedge');
    const resting = coinOrder(5_000, {
      side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 0.9, leverage: 20, riskModel: 'binance-tiers-v1',
    });
    expect(restingTriggerCheck('KAITOUSD', resting, { positions: [legacyLong()], orders: [resting] })).toMatchObject({ ok: true, reason: 'legacy-hedge' });
  });

  it('没有方向时的旧签名 checkPositionLimit 结果照旧', () => {
    const r = checkPositionLimit({
      symbol: 'KAITOUSD', settlement: 'coin', leverage: 20, exposureBefore: 200_000, orderNotional: 10_000,
    });
    expect(r).toMatchObject({ ok: false, reason: 'exposure-over-cap', side: null });
    expect(Number.isNaN(r.legacyHedgeRoom)).toBe(true);
  });
});

describe('【复核 r3】杠杆的保存与读取', () => {
  it('没存过取 35x 再夹；存过的按各自的结算方式夹', () => {
    expect(DEFAULT_SYMBOL_LEVERAGE).toBe(35);
    expect(effectiveSymbolLeverage(undefined, 'KAITOUSDT', 'usdt')).toBe(35);
    expect(effectiveSymbolLeverage(null, 'LUMIAUSDT', 'usdt')).toBe(10);
    expect(effectiveSymbolLeverage(125, 'KAITOUSDT', 'coin')).toBe(75);
    expect(effectiveSymbolLeverage(50, 'BNBUSDT', 'coin')).toBe(20);
    expect(effectiveSymbolLeverage(50, 'BNBUSDT', 'usdt')).toBe(50);
  });

  it('偏好里的默认杠杆夹到两张合约里较高的上限（BNB 75x / 20x → 50x 原样存），读的时候各自再夹', () => {
    expect(clampLeverageAcrossSettlements('BNBUSDT', 50)).toBe(50);
    expect(clampLeverageAcrossSettlements('BTCUSDT', 150)).toBe(150);
    expect(clampLeverageAcrossSettlements('NOMUSD', 50)).toBe(10);
    expect(clampLeverageAcrossSettlements('KAITOUSDT', 0)).toBe(1);
  });
});

describe('【复核 r3】同一轮里两张 TWAP：前一张刚成交的那一片不重复计算', () => {
  const twap = (id: string, total: number, filled: number): PendingOrder => ({
    id, side: 'LONG', type: 'TWAP', price: 0, stopPrice: 0, quantity: total, leverage: 15, marginMode: 'isolated',
    settlementMode: 'usdt', settlementAsset: 'USDT', status: 'ACTIVE', createdAt: 0,
    twapTotalQty: total, twapFilledQty: filled, riskModel: 'binance-tiers-v1',
  } as PendingOrder);

  it('KAITOUSDT 15x：A 这一轮刚成交 1,000（持仓已是 25,000，列表里 A 还是旧版本）；B 的最后一片按 A 的新版本判 = 50,000，放行', () => {
    const a = twap('A', 25_000, 0);
    const b = twap('B', 25_000, 24_000);
    const aAfter = { ...a, twapFilledQty: 1_000 };
    const positions = [usdtPos('LONG', 25_000, 1, { riskModel: 'binance-tiers-v1' })];
    const slice = { ...b, quantity: 1_000 };
    const withOverride = twapSliceTrigger(b, slice, 1, { updated: [aAfter], removedIds: [] });
    expect(withOverride).toEqual({ price: 1, settledOrderIds: ['B'], fill: slice, orderOverrides: [aAfter] });
    const judge = (trigger: ReturnType<typeof twapSliceTrigger>) => checkOrderPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions, orders: [a, b], markPrice: 1,
      excludeOrderIds: trigger.settledOrderIds, orderOverrides: trigger.orderOverrides, orderNotionalUsd: 1_000,
      orderPrice: 1, side: 'LONG',
    });
    expect(judge(withOverride)).toMatchObject({ ok: true, exposureAfter: 50_000 });
    // 不带前一张的新版本：A 那一片按持仓与挂单各算一遍 → 51,000，被误拒
    expect(judge(twapSliceTrigger(b, slice, 1))).toMatchObject({ ok: false, exposureAfter: 51_000 });
    // 这一轮被停掉的 TWAP 整张排除
    expect(twapSliceTrigger(b, slice, 1, { removedIds: ['A'] }).settledOrderIds).toEqual(['B', 'A']);
  });
});

describe('【复核 v1】旧仓位对冲豁免按仓位大小比：这一单与同侧挂单也按标记价估值', () => {
  /** KAITOUSDT 更新前的空仓 200,000 KAITO @20x（新规则 20x 最高 50,000 USDT），标记价 1.0。 */
  const legacyShort = () => usdtPos('SHORT', 200_000, 1, { leverage: 20 });
  const usdt = (over: Partial<Parameters<typeof checkOrderPositionLimit>[0]> = {}) => checkOrderPositionLimit({
    symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions: [legacyShort()], orders: [], markPrice: 1,
    orderNotionalUsd: 0, side: 'LONG', ...over,
  });

  it('U 本位：买入限价 @0.8 最多对冲 200,000 个币（与旧仓位同样大），250,000 个币不再按 200,000 USDT 放行', () => {
    expect(usdt({ orderNotionalUsd: 200_000 * 0.8, orderPrice: 0.8 })).toMatchObject({ ok: true, reason: 'legacy-hedge' });
    expect(usdt({ orderNotionalUsd: 200_001 * 0.8, orderPrice: 0.8 }).ok).toBe(false);
    const over = usdt({ orderNotionalUsd: 250_000 * 0.8, orderPrice: 0.8 });
    expect(over.ok).toBe(false);
    expect(over.message).toContain('这一单是反向对冲更新前的仓位，不受此限的额度最多 200,000 USDT');
    // 「可开」按这一单的委托价折回：200,000 个币 × 0.8
    expect(remainingOpenUsd(usdt({ orderPrice: 0.8 }), 1)).toBeCloseTo(160_000, 6);
    expect(sizingRemainingOpenUsd(usdt({ orderPrice: 0.8 }), 1, { orderAtMarket: false, hasOpenPositions: true }))
      .toBeCloseTo(160_000 * 0.998, 6);
    // 已挂的同侧限价单同样按标记价计进已用额度：挂着 100,000 个币 @0.8，只剩 100,000 个币
    const resting = { ...coinOrder(0), id: 'rest', side: 'LONG', type: 'LIMIT', price: 0.8, quantity: 100_000, contracts: undefined,
      contractSizeUsd: undefined, settlementMode: 'usdt', settlementAsset: 'USDT', leverage: 20 } as PendingOrder;
    expect(usdt({ orders: [resting], orderNotionalUsd: 100_000 * 0.8, orderPrice: 0.8 }).ok).toBe(true);
    expect(usdt({ orders: [resting], orderNotionalUsd: 100_001 * 0.8, orderPrice: 0.8 }).ok).toBe(false);
  });

  it('真币本位：BTCUSD 旧多仓 20,000 张（标记价 100,000 = 20 BTC）、125x；卖出限价 @110,000 最多 20,000 张', () => {
    const legacy = coinPos('LONG', 20_000, { leverage: 125, contractSizeUsd: 100, settlementAsset: 'BTC' });
    const btc = (contracts: number) => checkOrderPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 125, positions: [legacy], orders: [], markPrice: 100_000,
      orderNotionalUsd: contracts * 100, orderPrice: 110_000, side: 'SHORT',
    });
    expect(btc(20_000)).toMatchObject({ ok: true, reason: 'legacy-hedge', unit: 'BTC' });
    expect(btc(20_001).ok).toBe(false);
    expect(btc(22_000).ok).toBe(false);
    // 可开：20 BTC 按标记价折回 = 20,000 张 × 100
    expect(remainingOpenUsd(btc(0), 100_000)).toBeCloseTo(2_000_000, 3);
  });

  it('止损对冲条件单与旧仓位一样大：下单时两道都放行；多一个币就不放行', () => {
    const place = (qty: number) => checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions: [legacyShort()], orders: [], markPrice: 1,
      orderNotionalUsd: qty * 1.2, orderPrice: 1.2, side: 'LONG', triggerPrice: 1.2,
    });
    const r = place(200_000);
    expect(r.ok).toBe(true);
    expect(r.atMark.reason).toBe('legacy-hedge');
    expect(r.atTrigger?.reason).toBe('legacy-hedge');
    expect(place(200_001).ok).toBe(false);
  });
});

describe('【复核 v1】只靠对冲豁免放行的单按旧模型开仓', () => {
  const legacyLong = () => coinPos('LONG', 20_000, { leverage: 20 });
  const place = (contracts: number, positions: Position[] = [legacyLong()]) => checkPlacementPositionLimit({
    symbol: 'KAITOUSD', settlement: 'coin', leverage: 20, positions, orders: [], markPrice: 1,
    orderNotionalUsd: contracts * 10, orderPrice: 1, side: 'SHORT',
  });

  it('placementUsesLegacyHedge：任何一道靠豁免放行才算；被拒、正常放行都不算', () => {
    expect(placementUsesLegacyHedge(place(20_000))).toBe(true);
    expect(placementUsesLegacyHedge(place(20_001))).toBe(false);
    // 带戳的仓位没有豁免；10 张正常放行
    const stamped = [coinPos('LONG', 100, { leverage: 20, riskModel: 'binance-tiers-v1' })];
    expect(place(10, stamped).reason).toBe('ok');
    expect(placementUsesLegacyHedge(place(10, stamped))).toBe(false);
    // 两道都正常放行：不算
    const normal = checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20,
      positions: [usdtPos('LONG', 30_000, 1, { leverage: 20 })], orders: [], markPrice: 1,
      orderNotionalUsd: 22_000 * 0.9, orderPrice: 0.9, side: 'SHORT', triggerPrice: 0.9,
    });
    // 现价：30,000 + 19,800 = 49,800 ≤ 50,000；触发价：27,000 + 19,800 = 46,800 ≤ 50,000
    expect([normal.atMark.reason, normal.atTrigger?.reason]).toEqual(['ok', 'ok']);
    expect(placementUsesLegacyHedge(normal)).toBe(false);
    // 现价那一道正常、触发价那一道才靠豁免：同样算（触发那一刻开出的仓位要按旧模型）
    const atTriggerOnly = checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20,
      positions: [usdtPos('SHORT', 30_000, 1, { leverage: 20 })], orders: [], markPrice: 1,
      orderNotionalUsd: 16_000 * 1.25, orderPrice: 1.25, side: 'LONG', triggerPrice: 1.25,
    });
    // 现价：30,000 + 20,000 = 50,000；触发价 1.25：37,500 + 20,000 = 57,500 → 豁免（16,000 个币 ≤ 旧仓位 30,000 个币）
    expect([atTriggerOnly.atMark.reason, atTriggerOnly.atTrigger?.reason]).toEqual(['ok', 'legacy-hedge']);
    expect(placementUsesLegacyHedge(atTriggerOnly)).toBe(true);
  });

  it('【复核 r5】placementAftermath：legacy 的单带豁免标记（按旧模型开；不是更新前的单，触发时再判）', () => {
    const draft = { type: 'CONDITIONAL' as const, side: 'SHORT' as const, leverage: 20, quantity: 100, stopPrice: 0.9, settlementMode: 'usdt' as const };
    const stamped = placementAftermath(draft, { markPrice: 1, immediate: false });
    expect(stamped.orders[0].riskModel).toBe('binance-tiers-v1');
    const legacy = placementAftermath(draft, { markPrice: 1, immediate: false, legacy: true });
    expect(legacy.orders[0].riskModel).toBe('legacy-hedge-v1');
    expect(isTriggerRecheckedOrder(legacy.orders[0])).toBe(true);
    const filled = placementAftermath({ ...draft, type: 'MARKET' }, { markPrice: 1, immediate: true, legacy: true });
    expect(filled.positions[0].riskModel).toBe('legacy-hedge-v1');
  });
});

// ───────────────────────── 复核第七轮：豁免的底冻结 ─────────────────────────

/**
 * 【复核 r7 · 规则四】分层加仓现在会并进更新前的仓位（规则二），仓位因此变大——
 * 但**对冲豁免的底不跟着变大**。底单独冻在 hedgeBaseUnits 上（positionRiskModel.hedgeExemptBaseUnits），
 * 合并时只有「更新前的成交」才把它做大，部分平仓按比例缩。
 *
 * 不冻的话就是第 5 轮那个 F5 循环：旧多仓 200,000 加一刀 10,000 的分层加仓 → 底变成 210,000 →
 * 反向能多开 10,000 的超限裸仓位；再加一刀，再多 10,000，一轮轮接下去。
 */
describe('【复核 r7】对冲豁免的底冻结：分层加仓并进旧仓位不会把额度做大', () => {
  const legacyLong = (qty: number, over: Partial<Position> = {}) => usdtPos('LONG', qty, 1, { leverage: 20, ...over });
  const check = (positions: Position[], side: 'LONG' | 'SHORT', qty: number, orders: PendingOrder[] = []) => checkOrderPositionLimit({
    symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions, orders, markPrice: 1,
    orderNotionalUsd: qty, orderPrice: 1, side,
  });

  it('合并之后仓位 210,000、底仍是 200,000：对冲还是最多 200,000', () => {
    // 合并前
    expect(check([legacyLong(200_000)], 'SHORT', 200_000)).toMatchObject({ ok: true, reason: 'legacy-hedge', legacyHedgeBase: 200_000 });
    // 合并后（mergeFilledPosition 写下 hedgeBaseUnits = 合并前的量）
    const merged = [legacyLong(210_000, { hedgeBaseUnits: 200_000 })];
    expect(check(merged, 'SHORT', 200_000)).toMatchObject({ ok: true, reason: 'legacy-hedge', legacyHedgeBase: 200_000 });
    expect(check(merged, 'SHORT', 200_001).ok).toBe(false);
    // 不冻的话这 10,000 就是白捡的额度
    expect(check([legacyLong(210_000)], 'SHORT', 210_000)).toMatchObject({ ok: true, legacyHedgeBase: 210_000 });
  });

  it('底按标记价折，与仓位一样随价走：标记价 0.8 时 200,000 个币的底 = 160,000', () => {
    const merged = [legacyLong(210_000, { hedgeBaseUnits: 200_000 })];
    const at = (markPrice: number) => checkOrderPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions: merged, orders: [], markPrice,
      orderNotionalUsd: 160_000 * 0.8, orderPrice: 0.8, side: 'SHORT',
    });
    expect(at(0.8)).toMatchObject({ ok: true, reason: 'legacy-hedge' });
    expect(at(0.8).legacyHedgeBase).toBeCloseTo(160_000, 6);
  });

  it('底不会超过仓位当前的量：先加仓再减仓，缩过的底自然更小', () => {
    // 减仓到 105,000（一半）之后底按比例缩到 100,000
    expect(check([legacyLong(105_000, { hedgeBaseUnits: 100_000 })], 'SHORT', 100_000))
      .toMatchObject({ ok: true, reason: 'legacy-hedge', legacyHedgeBase: 100_000 });
    expect(check([legacyLong(105_000, { hedgeBaseUnits: 100_000 })], 'SHORT', 100_001).ok).toBe(false);
    // 记着的底大过仓位本身（不应发生）时按仓位封顶，绝不放大
    expect(check([legacyLong(50_000, { hedgeBaseUnits: 999_999 })], 'SHORT', 50_001).ok).toBe(false);
  });

  it('没有这个字段的仓位（升级前就在的）整仓都是底：与改动前一模一样', () => {
    expect(check([legacyLong(200_000)], 'SHORT', 200_000)).toMatchObject({ ok: true, legacyHedgeBase: 200_000 });
    // 带戳的仓位一概不是底，冻结的量写多少都没用
    const tiered = usdtPos('LONG', 200_000, 1, { leverage: 20, riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT', hedgeBaseUnits: 200_000 });
    expect(check([tiered], 'SHORT', 1).legacyHedgeBase).toBe(0);
  });
});

// ───────────────────────── 复核第五轮 ─────────────────────────

describe('【复核 r5】来源显式记下：只有更新前的仓位是豁免的底，豁免单占额度、不当底', () => {
  /** KAITOUSDT 20x（最高 50,000 USDT），标记价 1.0。 */
  const legacyLong = (qty: number) => usdtPos('LONG', qty, 1, { leverage: 20 });
  const exemptShort = (qty: number) => usdtPos('SHORT', qty, 1, { leverage: 20, riskModel: 'legacy-hedge-v1', riskSymbol: 'KAITOUSDT' });
  const check = (positions: Position[], side: 'LONG' | 'SHORT', qty: number, orders: PendingOrder[] = []) => checkOrderPositionLimit({
    symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions, orders, markPrice: 1,
    orderNotionalUsd: qty, orderPrice: 1, side,
  });

  it('旧多仓减到 100,000 之后：往旧仓位那一侧加回去仍被拒（豁免空单不当底），空单也不能再加', () => {
    const positions = [legacyLong(100_000), exemptShort(200_000)];
    const addBack = check(positions, 'LONG', 100_000);
    expect(addBack.ok).toBe(false);
    expect(addBack.reason).toBe('exposure-over-cap');
    expect(addBack.legacyHedgeBase).toBe(0);
    const moreHedge = check(positions, 'SHORT', 1);
    expect(moreHedge.ok).toBe(false);
    expect(moreHedge.legacyHedgeBase).toBe(100_000);
    expect(moreHedge.legacyHedgeRoom).toBe(-100_000);
    // 同样的两个仓位若都当成更新前的，额度就是 200,000 − 100,000 = 100,000（这正是要堵住的循环）
    const bothLegacy = check([legacyLong(100_000), usdtPos('SHORT', 200_000, 1, { leverage: 20 })], 'LONG', 100_000);
    expect(bothLegacy).toMatchObject({ ok: true, reason: 'legacy-hedge' });
  });

  it('旧多仓平掉之后：豁免空单是个超上限的普通仓位，任何一侧都开不出新单', () => {
    const positions = [exemptShort(200_000)];
    for (const side of ['LONG', 'SHORT'] as const) {
      const r = check(positions, side, 1);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('exposure-over-cap');
      expect(r.legacyExposure).toBe(false);
      expect(r.message).not.toContain('含更新前按旧规则开的仓位');
    }
    expect(check(positions, 'LONG', 200_000).legacyHedgeBase).toBe(0);
  });

  it('额度扣掉这一侧已经靠豁免开出 / 挂出的对冲：旧多 200,000 + 豁免空 150,000 → 再空 50,000 放行，50,001 不放行', () => {
    const positions = [legacyLong(200_000), exemptShort(150_000)];
    expect(check(positions, 'SHORT', 50_000)).toMatchObject({ ok: true, reason: 'legacy-hedge', legacyHedgeRoom: 50_000 });
    expect(check(positions, 'SHORT', 50_001).ok).toBe(false);
    // 挂着的豁免条件单同样占额度
    const exemptStop = {
      ...coinOrder(0), id: 'exempt-stop', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 1, quantity: 50_000,
      contracts: undefined, contractSizeUsd: undefined, settlementMode: 'usdt', settlementAsset: 'USDT', leverage: 20,
      riskModel: 'legacy-hedge-v1',
    } as PendingOrder;
    expect(check(positions, 'SHORT', 1, [exemptStop]).ok).toBe(false);
  });

  it('挂着的豁免触发单到触发那一刻再判：旧仓位还在就按豁免放行；旧仓位平掉后大单被拒、放得下的小单正常放行', () => {
    const exemptStop = (qty: number) => ({
      ...coinOrder(0), id: `exempt-${qty}`, side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 0.9, quantity: qty,
      contracts: undefined, contractSizeUsd: undefined, settlementMode: 'usdt', settlementAsset: 'USDT', leverage: 20,
      riskModel: 'legacy-hedge-v1',
    } as PendingOrder);
    const big = exemptStop(200_000);
    expect(isTriggerRecheckedOrder(big)).toBe(true);
    expect(restingTriggerCheck('KAITOUSDT', big, { positions: [legacyLong(200_000)], orders: [big], markPrice: 1 }))
      .toMatchObject({ ok: true, reason: 'legacy-hedge', price: 0.9 });
    const orphan = restingTriggerCheck('KAITOUSDT', big, { positions: [], orders: [big], markPrice: 1 })!;
    expect(orphan.ok).toBe(false);
    expect(orphan.exposureAfter).toBeCloseTo(180_000, 6);
    expect(doomedAtTrigger('KAITOUSDT', big, [], [big], 1)).not.toBeNull();
    const small = exemptStop(50_000);
    expect(restingTriggerCheck('KAITOUSDT', small, { positions: [], orders: [small], markPrice: 1 }))
      .toMatchObject({ ok: true, reason: 'ok' });
    // 更新前挂出的（没有任何 riskModel）照旧不再判
    expect(isTriggerRecheckedOrder({ ...big, riskModel: undefined })).toBe(false);
  });

  it('成交 / 触发那一刻要不要再判：触发类开仓单都交给闸门；限价单只有豁免单交；只减仓不交', () => {
    const limit = { ...coinOrder(1), type: 'LIMIT' } as PendingOrder;
    expect(recheckedAtFill(limit)).toBe(false);
    expect(recheckedAtFill({ ...limit, riskModel: 'binance-tiers-v1' })).toBe(false);
    expect(recheckedAtFill({ ...limit, riskModel: 'legacy-hedge-v1' })).toBe(true);
    expect(recheckedAtFill({ ...limit, type: 'POST_ONLY', riskModel: 'legacy-hedge-v1' })).toBe(true);
    expect(recheckedAtFill({ ...limit, type: 'CONDITIONAL', stopPrice: 1 })).toBe(true);
    expect(recheckedAtFill({ ...limit, type: 'TRAILING_STOP', stopPrice: 1, riskModel: 'binance-tiers-v1' })).toBe(true);
    expect(recheckedAtFill({ ...limit, riskModel: 'legacy-hedge-v1', reduceOnly: true })).toBe(false);
    expect(recheckedAtFill(null)).toBe(false);
  });
});

describe('【复核 r5】「价格走到 P 那一刻」：路上会成交的限价单算作 P 上的持仓', () => {
  it('路上会成交的定义：买单委托价 ≥ min(现价, P)，卖单委托价 ≤ max(现价, P)；已经穿价的也算', () => {
    const buy = (price: number) => ({ type: 'LIMIT' as const, side: 'LONG' as const, price });
    const sell = (price: number) => ({ type: 'LIMIT' as const, side: 'SHORT' as const, price });
    // 从 100 跌到 90
    expect(limitFillsOnPath(buy(95), 100, 90)).toBe(true);
    expect(limitFillsOnPath(buy(90), 100, 90)).toBe(true);
    expect(limitFillsOnPath(buy(85), 100, 90)).toBe(false);
    expect(limitFillsOnPath(buy(105), 100, 90)).toBe(true);        // 已经穿价
    expect(limitFillsOnPath(sell(98), 100, 90)).toBe(true);        // 已经穿价
    expect(limitFillsOnPath(sell(105), 100, 90)).toBe(false);
    // 从 100 涨到 110
    expect(limitFillsOnPath(sell(105), 100, 110)).toBe(true);
    expect(limitFillsOnPath(sell(115), 100, 110)).toBe(false);
    expect(limitFillsOnPath(buy(95), 100, 110)).toBe(false);
    // 只减仓、条件单、没有价的不算
    expect(limitFillsOnPath({ ...buy(95), reduceOnly: true }, 100, 90)).toBe(false);
    expect(limitFillsOnPath({ type: 'CONDITIONAL', side: 'LONG', price: 95 }, 100, 90)).toBe(false);
    expect(limitFillsOnPath(buy(0), 100, 90)).toBe(false);
    expect(isMarketableLimitPrice('LONG', 100, 100)).toBe(true);
    expect(isMarketableLimitPrice('LONG', 99.9, 100)).toBe(false);
    expect(isMarketableLimitPrice('SHORT', 100.1, 100)).toBe(false);
    expect(isMarketableLimitPrice('SHORT', 0, 100)).toBe(false);
  });

  it('【F1 复现】BTCUSD 125x（最高 5 BTC）：多 1,000 张 + 空头对冲 2,200 张 @90,000；回调买入限价 1,415 张 @98,000 → 跌到 90,000 时已成交，对冲注定被拒，下单前就预警', () => {
    const positions = [btcCoin('LONG', 1_000, { riskModel: 'binance-tiers-v1' })];
    const hedge = btcOrder(2_200, { id: 'hedge', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 90_000, riskModel: 'binance-tiers-v1' });
    const add = placementAftermath(
      { type: 'LIMIT', side: 'LONG', leverage: 125, quantity: 1_415, contracts: 1_415, contractSizeUsd: 100, price: 98_000, stopPrice: 0, settlementMode: 'coin' },
      { markPrice: 100_000, immediate: false },
    );
    expect(restingTriggerCheck('BTCUSDT', hedge, { positions, orders: [hedge], markPrice: 100_000 })?.ok).toBe(true);
    const after = restingTriggerCheck('BTCUSDT', hedge, { positions, orders: [hedge, ...add.orders], markPrice: 100_000 })!;
    expect(after.ok).toBe(false);
    // 持仓 (1,000 + 1,415) × 100 ÷ 90,000 + 对冲 2,200 × 100 ÷ 90,000 = 5.1278 BTC（限价单按自己的价只有 4.9994）
    expect(after.exposureAfter).toBeCloseTo((2_415 * 100 + 220_000) / 90_000, 9);
    const risks = newlyDoomedTriggerOrders({ symbol: 'BTCUSDT', positions, orders: [hedge], added: add, markPrice: 100_000 });
    expect(risks.map(r => r.order.id)).toEqual(['hedge']);
    // 先挂加仓、再挂对冲：对冲的下单判定（触发价那一道）就拒
    const hedgeFirstGate = checkPlacementPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 125, positions, orders: add.orders, markPrice: 100_000,
      orderNotionalUsd: 220_000, orderPrice: 90_000, side: 'SHORT', triggerPrice: 90_000,
    });
    expect(hedgeFirstGate.atMark.ok).toBe(true);
    expect(hedgeFirstGate.ok).toBe(false);
    expect(hedgeFirstGate.message).toContain(`按触发价 ${formatPrice(90_000)} 估值`);
  });

  it('【F1 复现】KAITOUSDT 15x：空 10,000 + 多头对冲 22,272 @1.15；卖出限价加仓 12,272 @1.05 → 涨到 1.15 时已成交，对冲注定被拒', () => {
    const positions = [usdtPos('SHORT', 10_000, 1, { riskModel: 'binance-tiers-v1' })];
    const hedge = {
      ...coinOrder(0), id: 'hedge', side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 1.15, quantity: 22_272,
      contracts: undefined, contractSizeUsd: undefined, settlementMode: 'usdt', settlementAsset: 'USDT', riskModel: 'binance-tiers-v1',
    } as PendingOrder;
    const add = placementAftermath(
      { type: 'LIMIT', side: 'SHORT', leverage: 15, quantity: 12_272, price: 1.05, stopPrice: 0, settlementMode: 'usdt' },
      { markPrice: 1, immediate: false },
    );
    const risks = newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders: [hedge], added: add, markPrice: 1 });
    expect(risks).toHaveLength(1);
    expect(risks[0].check.exposureAfter).toBeCloseTo(22_272 * 1.15 * 2, 6);
  });

  it('路的起点是现价：已经穿价的卖单（95,000 < 现价 100,000）下一根就成交，跌到 80,000 时是按 80,000 估值的空仓', () => {
    // BTCUSD 125x：多 1,000 张 + 卖出限价 1,000 张 @95,000 + 空头条件单 2,100 张 @80,000
    // 到 80,000：1.25 + 1.25 + 2.625 = 5.125 BTC > 5；若把卖单当作还挂在 95,000：1.25 + 1.0526 + 2.625 = 4.93
    const positions = [btcCoin('LONG', 1_000, { riskModel: 'binance-tiers-v1' })];
    const sellLimit = btcOrder(1_000, { id: 'crossed-sell', side: 'SHORT', price: 95_000, riskModel: 'binance-tiers-v1' });
    const stop = btcOrder(2_100, { id: 'stop', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 80_000, riskModel: 'binance-tiers-v1' });
    const orders = [sellLimit, stop];
    const fromMark = doomedAtTrigger('BTCUSDT', stop, positions, orders, 100_000);
    expect(fromMark?.exposureAfter).toBeCloseTo(5.125, 9);
    const notCrossed = restingTriggerCheck('BTCUSDT', stop, { positions, orders })!;
    expect(notCrossed.ok).toBe(true);
    expect(notCrossed.exposureAfter).toBeCloseTo(1.25 + 100_000 / 95_000 + 2.625, 9);
  });

  it('checkAdded：后挂的单也要检查——突破加仓 @1.2 与 S₁ 0.9 上补挂的对冲一起算', () => {
    // 【F2 复现】KAITOUSDT 15x 多 10,000；加仓条件单 14,714.28 @1.2 + 空头对冲 24,714.28 @0.9：加仓到 1.2 触发时 51,900 > 50,000
    const positions = [usdtPos('LONG', 10_000, 1, { riskModel: 'binance-tiers-v1' })];
    const addStop = placementAftermath(
      { type: 'CONDITIONAL', side: 'LONG', leverage: 15, quantity: 14_714.28, stopPrice: 1.2, settlementMode: 'usdt' },
      { markPrice: 1, immediate: false },
    );
    const hedge = placementAftermath(
      { type: 'CONDITIONAL', side: 'SHORT', leverage: 15, quantity: 24_714.28, stopPrice: 0.9, settlementMode: 'usdt' },
      { markPrice: 1, immediate: false },
    );
    const added = { positions: [], orders: [...addStop.orders, ...hedge.orders] };
    // 不带 checkAdded：直接走过去那一种是下单闸门的事，这里只说「另一侧先成交再折回来」——先跌到 0.9 对冲成交，再涨到 1.2 加仓被拒
    const via = newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders: [], added, markPrice: 1 });
    expect(via.map(r => [r.order.side, r.added, r.check.via])).toEqual([['LONG', true, 0.9]]);
    expect(via[0].check.exposureAfter).toBeCloseTo(12_000 + 24_714.28 * 1.2 + 14_714.28 * 1.2, 6);
    const risks = newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders: [], added, markPrice: 1, checkAdded: true });
    expect(risks.map(r => [r.order.side, r.check.via])).toEqual([['LONG', null]]);
    expect(risks[0].check.exposureAfter).toBeCloseTo(24_714.28 * 1.2 + 24_714.28 * 0.9, 6);
    const text = triggerRiskMessage(via, '这张单下出去后')!;
    expect(text.title).toBe(`这张单下出去后，这张单自己（做多条件单 ${formatPrice(1.2)}，价格先到 ${formatPrice(0.9)} 再回来时）触发时也会因超出当前杠杆最高可持有头寸被拒`);
  });
});

describe('【复核 r5】限价单的估值：挂着的按委托价、再按成交那一刻判一道；穿价的按现价、留余量', () => {
  const btc = (positions: Position[], contracts: number, price: number, side: 'LONG' | 'SHORT' = 'LONG') => {
    const draft = { type: 'LIMIT' as const, side, quantity: contracts, contracts, contractSizeUsd: 100, price, stopPrice: 0, settlementMode: 'coin' as const };
    const valuation = placementOrderValuation('BTCUSDT', draft, price, 100_000);
    const gate = placementCheckPrice(draft, 100_000);
    return {
      valuation,
      gate,
      result: checkPlacementPositionLimit({
        symbol: 'BTCUSDT', settlement: 'coin', leverage: 125, positions, orders: [], markPrice: 100_000,
        orderNotionalUsd: valuation.usd, orderPrice: valuation.price, side,
        triggerPrice: gate.price, triggerKind: gate.kind,
      }),
      floats: placementFloatsWithMark({ draft, atMarket: false, markPrice: 100_000 }),
    };
  };

  it('【F3 复现】BTCUSD 125x、多 2,000 张、买入限价 90,000：100% = 2,500 张（成交后正好 5 BTC），不是 2,691 张', () => {
    const positions = [btcCoin('LONG', 2_000, { riskModel: 'binance-tiers-v1' })];
    const { gate, result, floats } = btc(positions, 0, 90_000);
    expect(gate).toEqual({ price: 90_000, kind: 'limit' });
    expect(floats).toBe(false);
    // 现价那一道（持仓按 100,000 估值、留余量）：2,691 张；成交那一刻（持仓按 90,000 估值）：2,500 张
    expect(sizingRemainingOpenUsd(result.atMark, 100_000, { orderAtMarket: floats, hasOpenPositions: true })).toBeCloseTo(269_100, 6);
    const usd = placementSizingRemainingUsd(result, 100_000, { orderAtMarket: floats, hasOpenPositions: true });
    expect(usd).toBeCloseTo(250_000, 6);
    expect(Math.floor(usd / 100 + 1e-9)).toBe(2_500);
    expect(btc(positions, 2_500, 90_000).result.ok).toBe(true);
    const tooMany = btc(positions, 2_501, 90_000).result;
    expect(tooMany.ok).toBe(false);
    expect(tooMany.atMark.ok).toBe(true);
    expect(tooMany.message).toContain(`按委托价 ${formatPrice(90_000)} 成交那一刻估值：`);
    // 2,500 张成交在 90,000：仓位 4,500 张 = 5 BTC，还能对冲（没有卡死）
    const filled = [btcCoin('LONG', 4_500, { riskModel: 'binance-tiers-v1', entryPrice: 90_000 })];
    expect(checkOrderPositionLimit({
      symbol: 'BTCUSDT', settlement: 'coin', leverage: 125, positions: filled, orders: [], markPrice: 90_000, orderNotionalUsd: 0,
    })).toMatchObject({ ok: true, exposureBefore: 5 });
  });

  it('【F3 复现】U 本位：空 20,000 @15x、卖出限价 1.1 → 100% = 25,454.54 个币（成交后 50,000），不是 27,181', () => {
    const positions = [usdtPos('SHORT', 20_000, 1, { riskModel: 'binance-tiers-v1' })];
    const draft = { type: 'LIMIT' as const, side: 'SHORT' as const, quantity: 0, price: 1.1, stopPrice: 0, settlementMode: 'usdt' as const };
    const gate = placementCheckPrice(draft, 1);
    expect(gate).toEqual({ price: 1.1, kind: 'limit' });
    const r = checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions, orders: [], markPrice: 1,
      orderNotionalUsd: 0, orderPrice: 1.1, side: 'SHORT', triggerPrice: gate.price, triggerKind: gate.kind,
    });
    const usd = placementSizingRemainingUsd(r, 1, { orderAtMarket: false, hasOpenPositions: true });
    expect(usd / 1.1).toBeCloseTo(28_000 / 1.1, 6);
    expect((20_000 + usd / 1.1) * 1.1).toBeCloseTo(50_000, 6);
  });

  it('【F4 复现】BTCUSD 125x、没有持仓、买入限价 100,100（穿价）：按现价估值、留余量 → 4,990 张，成交后 4.99 BTC', () => {
    const { valuation, gate, result, floats } = btc([], 1, 100_100);
    expect(valuation.price).toBe(100_000);
    expect(gate.price).toBe(0);
    expect(floats).toBe(true);
    const usd = placementSizingRemainingUsd(result, 100_000, { orderAtMarket: floats, hasOpenPositions: false });
    expect(Math.floor(usd / 100 + 1e-9)).toBe(4_990);
    expect((4_990 * 100) / 100_000).toBeLessThanOrEqual(5);
    // 旧口径按委托价 100,100 折币：5,005 张 → 成交后按现价 5.005 BTC
    expect(btc([], 5_005, 100_100).result.ok).toBe(false);
  });

  it('【F4 复现】U 本位卖出限价 0.95（现价 1.0，穿价）：按现价估值 → 49,900 个币，不是 52,631', () => {
    const draft = { type: 'LIMIT' as const, side: 'SHORT' as const, quantity: 1, price: 0.95, stopPrice: 0, settlementMode: 'usdt' as const };
    const unit = placementUnitPriceUsd('KAITOUSDT', draft, 0.95, false, 1);
    expect(unit).toEqual({ unitUsd: 1, atMarket: true });
    expect(placementOrderValuation('KAITOUSDT', draft, 0.95, 1)).toEqual({ usd: 1, price: 1 });
    expect(placementCheckPrice(draft, 1).price).toBe(0);
    const r = checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions: [], orders: [], markPrice: 1,
      orderNotionalUsd: 0, orderPrice: 1, side: 'SHORT',
    });
    const floats = placementFloatsWithMark({ draft, atMarket: unit.atMarket, markPrice: 1 });
    expect(placementSizingRemainingUsd(r, 1, { orderAtMarket: floats, hasOpenPositions: false }) / unit.unitUsd).toBeCloseTo(49_900, 6);
    // 同一个价对买单是挂着的：按委托价、不留余量
    const buy = { ...draft, side: 'LONG' as const };
    expect(placementUnitPriceUsd('KAITOUSDT', buy, 0.95, false, 1)).toEqual({ unitUsd: 0.95, atMarket: false });
    expect(placementCheckPrice(buy, 1)).toEqual({ price: 0.95, kind: 'limit' });
    expect(placementFloatsWithMark({ draft: buy, atMarket: false, markPrice: 1 })).toBe(false);
  });

  it('余量：离现价不到 0.2% 的限价单、挂着的穿价 / 贴价限价单都算「跟着现价漂」', () => {
    const near = { type: 'LIMIT' as const, side: 'LONG' as const, quantity: 1, price: 0.999, stopPrice: 0, settlementMode: 'usdt' as const };
    expect(placementFloatsWithMark({ draft: near, atMarket: false, markPrice: 1 })).toBe(true);
    expect(placementFloatsWithMark({ draft: { ...near, price: 0.99 }, atMarket: false, markPrice: 1 })).toBe(false);
    const cond = { type: 'CONDITIONAL' as const, side: 'LONG' as const, quantity: 1, stopPrice: 1.2, settlementMode: 'usdt' as const };
    expect(placementFloatsWithMark({ draft: cond, atMarket: false, markPrice: 1 })).toBe(false);
    const restingNear = { ...coinOrder(1), side: 'SHORT', price: 0.9995 } as PendingOrder;
    expect(placementFloatsWithMark({ draft: cond, atMarket: false, markPrice: 1, orders: [restingNear] })).toBe(true);
    expect(placementFloatsWithMark({ draft: cond, atMarket: false, markPrice: 1, orders: [{ ...restingNear, reduceOnly: true }] })).toBe(false);
    expect(placementFloatsWithMark({ draft: cond, atMarket: true, markPrice: 1 })).toBe(true);
  });

  it('分段订单：第二道取没穿价的子单里离现价最远的那笔；「可开」按子单均价折回（卖单 1.0→1.5：币数 × 1.5 ≤ 50,000）', () => {
    const draft = {
      type: 'SCALED' as const, side: 'SHORT' as const, quantity: 1, stopPrice: 0, settlementMode: 'usdt' as const,
      scaledCount: 5, scaledStartPrice: 1.0, scaledEndPrice: 1.5,
    };
    expect(placementCheckPrice(draft, 1)).toEqual({ price: 1.5, kind: 'limit' });
    // 买单时五笔都在现价之上：全都穿价，没有第二道，估值全按现价
    expect(placementCheckPrice({ ...draft, side: 'LONG' }, 1).price).toBe(0);
    expect(placementOrderValuation('KAITOUSDT', { ...draft, side: 'LONG', quantity: 5 }, 1, 1)).toEqual({ usd: 5, price: 1 });
    // 买单 0.8→1.2：离现价最远的没穿价子单是 0.8
    expect(placementCheckPrice({ ...draft, side: 'LONG', scaledStartPrice: 0.8, scaledEndPrice: 1.2 }, 1).price).toBe(0.8);
    const valuation = placementOrderValuation('KAITOUSDT', draft, 1, 1);
    expect(valuation.price).toBeCloseTo(1.25, 12);
    const r = checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions: [], orders: [], markPrice: 1,
      orderNotionalUsd: 0, orderPrice: valuation.price, side: 'SHORT', triggerPrice: 1.5, triggerKind: 'limit',
    });
    const usd = placementSizingRemainingUsd(r, 1, { orderAtMarket: false, hasOpenPositions: false });
    expect(usd / valuation.price).toBeCloseTo(50_000 / 1.5, 6);
    // 下单判定：33,333 个币放行，34,000 个币在 1.5 那一道被拒
    const place = (coins: number) => checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions: [], orders: [], markPrice: 1,
      orderNotionalUsd: coins * valuation.price, orderPrice: valuation.price, side: 'SHORT', triggerPrice: 1.5, triggerKind: 'limit',
    });
    expect(place(33_333).ok).toBe(true);
    expect(place(34_000)).toMatchObject({ ok: false });
    expect(place(34_000).atMark.ok).toBe(true);
  });
});

// ───────────────────────── 复核第五轮 · 二 ─────────────────────────

describe('【复核 r5 · 二】走过的区间：路上会成交的限价单、会触发的条件单；先到另一侧再折回来', () => {
  const buy = (price: number) => ({ type: 'LIMIT' as const, side: 'LONG' as const, price, stopPrice: 0 });
  const sell = (price: number) => ({ type: 'LIMIT' as const, side: 'SHORT' as const, price, stopPrice: 0 });
  const cond = (stopPrice: number, over: Partial<PendingOrder> = {}) => ({ type: 'CONDITIONAL' as const, side: 'LONG' as const, price: 0, stopPrice, ...over });

  it('pricePath：从起点出发、经过 via、到终点，区间取最低与最高；价取不到为 null', () => {
    expect(pricePath(100, 90)).toEqual({ lo: 90, hi: 100 });
    expect(pricePath(100, 90, [110])).toEqual({ lo: 90, hi: 110 });
    expect(pricePath(100, 90, [0, NaN])).toEqual({ lo: 90, hi: 100 });
    expect(pricePath(0, 90)).toBeNull();
    // 先到 110 再跌到 90：卖价 105 的限价单在路上成交了
    expect(limitFillsOnPath(sell(105), 100, 90)).toBe(false);
    expect(limitFillsOnPath(sell(105), 100, 90, [110])).toBe(true);
  });

  it('条件单：触发价落在走过的区间里就算已经触发；只减仓、跟踪委托不算；旧止盈止损开仓单按各自的规则', () => {
    expect(triggerFiresOnPath(cond(95), 100, 90)).toBe(true);
    expect(triggerFiresOnPath(cond(90), 100, 90)).toBe(true);
    expect(triggerFiresOnPath(cond(105), 100, 90)).toBe(false);
    expect(triggerFiresOnPath(cond(105), 100, 90, [110])).toBe(true);
    expect(triggerFiresOnPath(cond(95, { reduceOnly: true }), 100, 90)).toBe(false);
    expect(triggerFiresOnPath({ ...cond(95), type: 'TRAILING_STOP' }, 100, 90)).toBe(false);
    expect(triggerFiresOnPath({ ...cond(95), type: 'MARKET_TP_SL' }, 100, 90)).toBe(true);
    // 旧限价止盈止损开仓单：触发价在区间里，委托价也够得着才算
    expect(triggerFiresOnPath({ type: 'LIMIT_TP_SL', side: 'LONG', price: 93, stopPrice: 95 }, 100, 90)).toBe(true);
    expect(triggerFiresOnPath({ type: 'LIMIT_TP_SL', side: 'LONG', price: 85, stopPrice: 95 }, 100, 90)).toBe(false);
    // 限价单不是触发单；orderFillsOnPath 两种都算
    expect(triggerFiresOnPath(buy(95), 100, 90)).toBe(false);
    expect(orderFillsOnPath(buy(95), 100, 90)).toBe(true);
    expect(orderFillsOnPath(cond(95), 100, 90)).toBe(true);
  });

  it('路标：限价单 = 委托价，条件单 = 触发价；跟踪委托、TWAP、只减仓单没有；只取现价另一侧的，按离现价远近排序', () => {
    expect(orderWaypointPrice({ ...buy(0.95) } as PendingOrder)).toBe(0.95);
    expect(orderWaypointPrice({ ...cond(1.2) } as PendingOrder)).toBe(1.2);
    expect(orderWaypointPrice({ ...cond(1.2), type: 'MARKET_TP_SL' } as PendingOrder)).toBe(1.2);
    expect(orderWaypointPrice({ ...cond(1.2), type: 'TRAILING_STOP' } as PendingOrder)).toBe(0);
    expect(orderWaypointPrice({ ...cond(0), type: 'TWAP' } as PendingOrder)).toBe(0);
    expect(orderWaypointPrice({ ...sell(1.1), reduceOnly: true } as PendingOrder)).toBe(0);
    const hedge = usdtOrder('hedge', 'SHORT', 'CONDITIONAL', 1_000, { stopPrice: 0.9, riskModel: 'binance-tiers-v1' });
    const others = [
      usdtOrder('far', 'LONG', 'CONDITIONAL', 1, { stopPrice: 1.2 }),
      usdtOrder('near', 'SHORT', 'LIMIT', 1, { price: 1.1 }),
      usdtOrder('same-side', 'LONG', 'CONDITIONAL', 1, { stopPrice: 0.95 }),
      usdtOrder('trail', 'LONG', 'TRAILING_STOP', 1, { stopPrice: 1.3 }),
      usdtOrder('tp', 'SHORT', 'CONDITIONAL', 1, { stopPrice: 1.4, reduceOnly: true }),
    ];
    expect(triggerWaypoints(hedge, [hedge, ...others], 1)).toEqual([1.1, 1.2]);
    // 现价取不到 / 判定价就是现价 / 不会被再判的单：没有路标
    expect(triggerWaypoints(hedge, others, 0)).toEqual([]);
    expect(triggerWaypoints(hedge, others, 0.9)).toEqual([]);
    expect(triggerWaypoints({ ...hedge, riskModel: undefined }, others, 1)).toEqual([]);
  });

  it('【复现】落在路上的条件加仓：空 10,000 + 卖出条件单 13,023.26 @1.05 + 多头对冲 23,023.26 @1.1——涨到 1.1 时加仓已是持仓 → 50,651.15，被拒', () => {
    const positions = [usdtPos('SHORT', 10_000, 1, { riskModel: 'binance-tiers-v1' })];
    const add = usdtOrder('add', 'SHORT', 'CONDITIONAL', 13_023.26, { stopPrice: 1.05, riskModel: 'binance-tiers-v1' });
    const hedge = usdtOrder('hedge', 'LONG', 'CONDITIONAL', 23_023.26, { stopPrice: 1.1, riskModel: 'binance-tiers-v1' });
    const fromMark = restingTriggerCheck('KAITOUSDT', hedge, { positions, orders: [add, hedge], markPrice: 1 })!;
    expect(fromMark.ok).toBe(false);
    expect(fromMark.exposureAfter).toBeCloseTo(1.1 * (10_000 + 13_023.26) + 1.1 * 23_023.26, 6);
    expect(fromMark).toMatchObject({ kind: 'trigger', via: null, price: 1.1 });
    // 不知道路的起点：只算已经在 1.1 上的——加仓按自己的触发价 1.05 算作挂单
    const noPath = restingTriggerCheck('KAITOUSDT', hedge, { positions, orders: [add, hedge] })!;
    expect(noPath.exposureAfter).toBeCloseTo(11_000 + 13_023.26 * 1.05 + 1.1 * 23_023.26, 6);
    // 委托列表的标记与预警都用这一种走法
    expect(doomedAtTrigger('KAITOUSDT', hedge, positions, [add, hedge], 1)?.via).toBeNull();
  });

  it('更新前挂出的单在路上成交 / 触发，开出来就是更新前的仓位：算进豁免的底', () => {
    // KAITOUSDT 20x：没有持仓；更新前挂出的买入限价 200,000 @0.95、买入条件单 100,000 @0.92；带戳的空头条件单 250,000 @0.9
    const oldLimit = usdtOrder('old-limit', 'LONG', 'LIMIT', 200_000, { price: 0.95, leverage: 20 });
    const oldStop = usdtOrder('old-stop', 'LONG', 'CONDITIONAL', 100_000, { stopPrice: 0.92, leverage: 20 });
    const hedge = usdtOrder('hedge', 'SHORT', 'CONDITIONAL', 250_000, { stopPrice: 0.9, leverage: 20, riskModel: 'binance-tiers-v1' });
    const r = restingTriggerCheck('KAITOUSDT', hedge, { positions: [], orders: [oldLimit, oldStop, hedge], markPrice: 1 })!;
    // 到 0.9：两张旧单都已成交，是 300,000 × 0.9 = 270,000 的更新前仓位；对冲 225,000 不超过它
    expect(r).toMatchObject({ ok: true, reason: 'legacy-hedge' });
    expect(r.legacyHedgeBase).toBeCloseTo(270_000, 6);
    // 旧单都还没成交的走法（价格还没下来）：没有底，按普通分层判
    const stamped = { ...oldLimit, riskModel: 'binance-tiers-v1' as const };
    expect(restingTriggerCheck('KAITOUSDT', hedge, { positions: [], orders: [stamped, oldStop, hedge], markPrice: 1 })!.legacyHedgeBase).toBeCloseTo(90_000, 6);
  });
});

describe('【复核 r5 · 二】两种先后：先到另一侧的挂单、再折回来', () => {
  const stamped = { riskModel: 'binance-tiers-v1' as const };

  it('突破加仓在上、止损对冲在下：委托列表按「先突破再跌回来」标出对冲，按「先跌再涨回来」标出加仓', () => {
    const positions = [usdtPos('LONG', 10_000, 1, stamped)];
    const add = usdtOrder('add', 'LONG', 'CONDITIONAL', 14_000, { stopPrice: 1.2, ...stamped });
    const hedge = usdtOrder('hedge', 'SHORT', 'CONDITIONAL', 24_000, { stopPrice: 0.9, ...stamped });
    const orders = [add, hedge];
    // 直接走：加仓 12,000 + 21,600 + 16,800 = 50,400 → 已经放不下；对冲 9,000 + 16,800 + 21,600 = 47,400 放得下
    expect(restingTriggerScenarios('KAITOUSDT', hedge, { positions, orders, markPrice: 1 }).map(r => [r.via, r.ok]))
      .toEqual([[null, true], [1.2, true]]);
    const small = { ...add, quantity: 12_000 };
    const scenarios = restingTriggerScenarios('KAITOUSDT', small, { positions, orders: [small, hedge], markPrice: 1 });
    // 直接涨到 1.2：12,000 + 21,600 + 14,400 = 48,000；先跌到 0.9 对冲成交：12,000 + 28,800 + 14,400 = 55,200
    expect(scenarios.map(r => [r.via, r.ok])).toEqual([[null, true], [0.9, false]]);
    expect(scenarios[1].exposureAfter).toBeCloseTo(55_200, 6);
    const doom = doomedAtTrigger('KAITOUSDT', small, positions, [small, hedge], 1)!;
    expect(doom.via).toBe(0.9);
    expect(triggerCheckLead(doom)).toBe(`价格先到 ${formatPrice(0.9)} 再回到触发价 ${formatPrice(1.2)} 上`);
  });

  it('下单预警：已挂的对冲在「先到这一单的触发价再折回来」时被拒，按这种走法说', () => {
    // BTCUSD 125x：多 1,000 张 + 空头对冲 2,350 张 @95,000（直接走：3,350 × 100 ÷ 95,000 = 3.53 BTC）；
    // 再挂突破加仓 1,621 张 @110,000：先突破再跌回 95,000 → 4,971 × 100 ÷ 95,000 = 5.23 BTC > 5
    const positions = [btcCoin('LONG', 1_000, stamped)];
    const hedge = btcOrder(2_350, { id: 'hedge', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 95_000, ...stamped });
    const add = placementAftermath(
      { type: 'CONDITIONAL', side: 'LONG', leverage: 125, quantity: 1_621, contracts: 1_621, contractSizeUsd: 100, stopPrice: 110_000, settlementMode: 'coin' },
      { markPrice: 100_000, immediate: false },
    );
    const risks = newlyDoomedTriggerOrders({ symbol: 'BTCUSDT', positions, orders: [hedge], added: add, markPrice: 100_000 });
    expect(risks.map(r => [r.order.id, r.added ?? false, r.check.via])).toEqual([['hedge', false, 110_000]]);
    expect(risks[0].check.exposureAfter).toBeCloseTo((4_971 * 100) / 95_000, 9);
    const text = triggerRiskMessage(risks, '这张单下出去后')!;
    expect(text.title).toBe(`这张单下出去后，已挂的做空条件单 ${formatPrice(95_000)}（价格先到 ${formatPrice(110_000)} 再回来时）触发时会因超出当前杠杆最高可持有头寸被拒`);
    expect(text.description).toContain('币安不在这一步拦');
    // 不给现价就不知道哪边是另一侧：只判直接走
    expect(newlyDoomedTriggerOrders({ symbol: 'BTCUSDT', positions, orders: [hedge], added: add })).toEqual([]);
  });

  it('【复现】只在「先到另一侧」那一种下放不下的单：这一步让直接走过去也放不下时照样预警', () => {
    // 多 20,000 + 空头对冲 20,000 @0.9 + 做多条件单 2,000 @1.2
    // 做多条件单：直接涨到 1.2 → 24,000 + 18,000 + 2,400 = 44,400；先跌到 0.9 对冲成交 → 24,000 + 24,000 + 2,400 = 50,400（委托列表早就标着）
    const positions = [usdtPos('LONG', 20_000, 1, stamped)];
    const hedge = usdtOrder('hedge', 'SHORT', 'CONDITIONAL', 20_000, { stopPrice: 0.9, ...stamped });
    const breakout = usdtOrder('breakout', 'LONG', 'CONDITIONAL', 2_000, { stopPrice: 1.2, ...stamped });
    const orders = [hedge, breakout];
    expect(restingTriggerScenarios('KAITOUSDT', breakout, { positions, orders, markPrice: 1 }).map(r => [r.via, r.ok]))
      .toEqual([[null, true], [0.9, false]]);
    // 市价再多 6,000（现价下 46,000 放得下）：直接涨到 1.2 也变成 51,600 → 新弄坏的是直接走的那一种，要说
    const more = placementAftermath({ type: 'MARKET', side: 'LONG', leverage: 15, quantity: 6_000, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true });
    const risks = newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders, added: more, markPrice: 1 });
    expect(risks.map(r => [r.order.id, r.check.via])).toEqual([['breakout', null]]);
    expect(risks[0].check.exposureAfter).toBeCloseTo(51_600, 6);
    // 多 4,000：直接走 49,200 仍放得下，先跌再涨那一种本来就放不下 → 不说
    const less = placementAftermath({ type: 'MARKET', side: 'LONG', leverage: 15, quantity: 4_000, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true });
    expect(newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders, added: less, markPrice: 1 })).toEqual([]);
  });

  it('直接走过去就已经放不下的单不重复说（改杠杆也一样）', () => {
    const positions = [usdtPos('LONG', 10_000, 1, stamped)];
    const add = usdtOrder('add', 'LONG', 'CONDITIONAL', 14_000, { stopPrice: 1.2, ...stamped });
    const hedge = usdtOrder('hedge', 'SHORT', 'CONDITIONAL', 24_000, { stopPrice: 0.9, ...stamped });
    // 加仓在「先跌到 0.9」那一种下早就放不下：再下一小单不重复预警
    const tiny = placementAftermath({ type: 'MARKET', side: 'LONG', leverage: 15, quantity: 10, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true });
    expect(newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders: [add, hedge], added: tiny, markPrice: 1 })
      .map(r => r.order.id)).toEqual([]);
  });
});

describe('【复核 r5 · 二】已经穿价的挂单：路的起点是现价（现价 ≠ 判定价）', () => {
  const stamped = { riskModel: 'binance-tiers-v1' as const };
  /** KAITOUSDT 15x、现价 1.0：带戳的买入限价 20,000 @1.1（高于现价，下一根就成交）。 */
  const crossedBuy = () => usdtOrder('crossed-buy', 'LONG', 'LIMIT', 20_000, { price: 1.1, ...stamped });

  it('下单第二道：做多条件单 22,000 @1.2——涨到 1.2 时穿价的买单已是按 1.2 估值的持仓（24,000 + 26,400 > 50,000），被拒', () => {
    const place = (qty: number) => checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions: [], orders: [crossedBuy()], markPrice: 1,
      orderNotionalUsd: qty * 1.2, orderPrice: 1.2, side: 'LONG', triggerPrice: 1.2,
    });
    const r = place(22_000);
    // 现价那一道：穿价的买单按现价 20,000 + 这一单 26,400 = 46,400
    expect(r.atMark).toMatchObject({ ok: true });
    expect(r.atMark.exposureAfter).toBeCloseTo(46_400, 6);
    expect(r.ok).toBe(false);
    expect(r.atTrigger!.exposureAfter).toBeCloseTo(50_400, 6);
    expect(place(21_666).ok).toBe(true);
  });

  it('委托列表与预警：多头条件单 22,000 @1.2 只在知道现价时才看得出注定被拒；之前就被拒的不再预警', () => {
    const stop = usdtOrder('stop', 'LONG', 'CONDITIONAL', 22_000, { stopPrice: 1.2, ...stamped });
    const orders = [crossedBuy(), stop];
    expect(doomedAtTrigger('KAITOUSDT', stop, [], orders)).toBeNull();
    const doom = doomedAtTrigger('KAITOUSDT', stop, [], orders, 1)!;
    expect(doom.exposureAfter).toBeCloseTo(50_400, 6);
    const tiny = placementAftermath({ type: 'MARKET', side: 'LONG', leverage: 15, quantity: 100, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true });
    expect(newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions: [], orders, added: tiny, markPrice: 1 })).toEqual([]);
    // 小一点的条件单：之前放得下，这一小单之后才放不下 → 预警
    const fits = { ...stop, quantity: 21_600 };
    const risks = newlyDoomedTriggerOrders({
      symbol: 'KAITOUSDT', positions: [], orders: [crossedBuy(), fits],
      added: placementAftermath({ type: 'MARKET', side: 'LONG', leverage: 15, quantity: 1_000, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true }),
      markPrice: 1,
    });
    expect(risks.map(r => r.order.id)).toEqual(['stop']);
  });

  it('预警的「这一步之前」同样从现价出发：真币本位 BTCUSD 穿价买单 2,000 张 @105,000 到 120,000 时按 120,000 折币（1.6667 BTC，不是按委托价的 1.9048）', () => {
    const coin = (id: string, type: PendingOrder['type'], contracts: number, over: Partial<PendingOrder>) => ({
      id, side: 'LONG', type, price: 0, stopPrice: 0, quantity: contracts, contracts, contractSizeUsd: 100, leverage: 125,
      marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'BTC', status: type === 'CONDITIONAL' ? 'PENDING' : 'NEW',
      createdAt: 0, ...stamped, ...over,
    } as PendingOrder);
    const orders = [coin('crossed-buy', 'LIMIT', 2_000, { price: 105_000 }), coin('stop', 'CONDITIONAL', 3_900, { stopPrice: 120_000 })];
    // 之前：1.6667 + 3.25 = 4.9167 ≤ 5，放得下；再多 200 张（到 120,000 时 0.1667 BTC）→ 5.0833
    expect(doomedAtTrigger('BTCUSDT', orders[1], [], orders, 100_000)).toBeNull();
    const added = placementAftermath(
      { type: 'MARKET', side: 'LONG', leverage: 125, quantity: 200, contracts: 200, contractSizeUsd: 100, stopPrice: 0, settlementMode: 'coin' },
      { markPrice: 100_000, immediate: true },
    );
    const risks = newlyDoomedTriggerOrders({ symbol: 'BTCUSDT', positions: [], orders, added, markPrice: 100_000 });
    expect(risks.map(r => r.order.id)).toEqual(['stop']);
    expect(risks[0].check.exposureAfter).toBeCloseTo(6_100 / 1_200, 9);
  });

  it('余量：挂着穿价超过 0.2% 的限价单、按标记价估值的挂单（TWAP 余量、没有激活价的跟踪委托）都算跟着现价漂', () => {
    const draft = { type: 'CONDITIONAL' as const, side: 'LONG' as const, quantity: 1, stopPrice: 1.2, settlementMode: 'usdt' as const };
    const floats = (orders: PendingOrder[]) => placementFloatsWithMark({ draft, atMarket: false, markPrice: 1, orders });
    expect(floats([crossedBuy()])).toBe(true);
    expect(floats([{ ...crossedBuy(), price: 0.95 }])).toBe(false);
    expect(floats([{ ...crossedBuy(), side: 'SHORT', price: 0.95 }])).toBe(true);
    const twap = usdtOrder('twap', 'LONG', 'TWAP', 1_000, { twapTotalQty: 1_000, twapFilledQty: 400 });
    expect(floats([twap])).toBe(true);
    expect(floats([{ ...twap, twapFilledQty: 1_000 }])).toBe(false);
    expect(floats([{ ...twap, reduceOnly: true }])).toBe(false);
    const trailing = usdtOrder('trail', 'LONG', 'TRAILING_STOP', 1_000, { stopPrice: 0, callbackRate: 0.01 });
    expect(floats([trailing])).toBe(true);
    expect(floats([{ ...trailing, stopPrice: 1.3 }])).toBe(false);
    // 这一单自己是 TWAP / 没有激活价的跟踪委托
    expect(placementFloatsWithMark({ draft: { ...draft, type: 'TWAP', stopPrice: 0 }, atMarket: false, markPrice: 1 })).toBe(true);
    expect(placementFloatsWithMark({ draft: { ...draft, type: 'TRAILING_STOP', stopPrice: 0 }, atMarket: false, markPrice: 1 })).toBe(true);
    // 引擎口径：没有持仓、挂着一张没有激活价的跟踪委托 20,000，买入限价 @0.9 的 100% 留了余量，按 1.0001 估值也放得下
    const r = checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions: [], orders: [{ ...trailing, quantity: 20_000 }], markPrice: 1,
      orderNotionalUsd: 0, orderPrice: 0.9, side: 'LONG', triggerPrice: 0.9, triggerKind: 'limit',
    });
    const live = { orderAtMarket: floats([{ ...trailing, quantity: 20_000 }]), hasOpenPositions: false };
    const usd = placementSizingRemainingUsd(r, 1, live);
    const engine = checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions: [], orders: [{ ...trailing, quantity: 20_000 }], markPrice: 1.0001,
      orderNotionalUsd: usd, orderPrice: 0.9, side: 'LONG', triggerPrice: 0.9, triggerKind: 'limit',
    });
    expect(engine.ok).toBe(true);
  });
});

describe('【复核 r5 · 二】靠对冲豁免挂出的限价单：成交那一刻再判，委托列表与预警也看得见', () => {
  it('recheckPrice：豁免限价 / 只做 Maker 单按委托价（kind limit）；分层限价单、更新前的限价单、只减仓不算', () => {
    const limit = usdtOrder('l', 'SHORT', 'LIMIT', 1, { price: 1.1 });
    expect(recheckPrice({ ...limit, riskModel: 'legacy-hedge-v1' })).toEqual({ price: 1.1, kind: 'limit' });
    expect(recheckPrice({ ...limit, type: 'POST_ONLY', riskModel: 'legacy-hedge-v1' })).toEqual({ price: 1.1, kind: 'limit' });
    expect(recheckPrice({ ...limit, riskModel: 'binance-tiers-v1' })).toBeNull();
    expect(recheckPrice(limit)).toBeNull();
    expect(recheckPrice({ ...limit, riskModel: 'legacy-hedge-v1', reduceOnly: true })).toBeNull();
    expect(recheckPrice({ ...limit, riskModel: 'legacy-hedge-v1', price: 0 })).toBeNull();
    expect(recheckPrice({ ...limit, type: 'CONDITIONAL', price: 0, stopPrice: 0.9, riskModel: 'binance-tiers-v1' })).toEqual({ price: 0.9, kind: 'trigger' });
    expect(isTriggerRecheckedOrder({ ...limit, riskModel: 'legacy-hedge-v1' })).toBe(true);
    expect(recheckedAtFill({ ...limit, riskModel: 'legacy-hedge-v1' })).toBe(true);
  });

  it('【复现】旧多 200,000 @20x + 豁免空头限价 200,000 @1.1：旧多还在时放得下；旧多平掉后「成交时将超限」', () => {
    const legacyLong = usdtPos('LONG', 200_000, 1, { leverage: 20 });
    const hedge = usdtOrder('exempt-limit', 'SHORT', 'LIMIT', 200_000, { price: 1.1, leverage: 20, riskModel: 'legacy-hedge-v1' });
    expect(doomedAtTrigger('KAITOUSDT', hedge, [legacyLong], [hedge], 1)).toBeNull();
    const doom = doomedAtTrigger('KAITOUSDT', hedge, [], [hedge], 1)!;
    expect(doom).toMatchObject({ ok: false, kind: 'limit', price: 1.1, via: null });
    expect(doom.exposureAfter).toBeCloseTo(220_000, 6);
    expect(triggerCheckLead(doom)).toBe(`委托价 ${formatPrice(1.1)} 成交时`);
    // 文案：成交时
    const text = triggerRiskMessage([{ order: hedge, check: doom }], '这张单下出去后')!;
    expect(text.title).toBe(`这张单下出去后，已挂的做空限价单 ${formatPrice(1.1)} 成交时会因超出当前杠杆最高可持有头寸被拒`);
    expect(text.description).toContain('按委托价估值');
    expect(text.description).toContain('靠对冲豁免挂出的限价单成交时才再判');
    // 触发单与限价单混在一起
    const stop = usdtOrder('stop', 'SHORT', 'CONDITIONAL', 1, { stopPrice: 0.9, riskModel: 'binance-tiers-v1' });
    expect(triggerRiskMessage([{ order: hedge, check: doom }, { order: stop, check: { ...doom, kind: 'trigger', price: 0.9 } }], '杠杆调到 25x 后')!.title)
      .toBe(`杠杆调到 25x 后，已挂的做空限价单 ${formatPrice(1.1)}、做空条件单 ${formatPrice(0.9)} 触发 / 成交时会因超出当前杠杆最高可持有头寸被拒`);
  });
});

function usdtOrder(
  id: string, side: 'LONG' | 'SHORT', type: PendingOrder['type'], quantity: number, over: Partial<PendingOrder> = {},
): PendingOrder {
  return {
    id, side, type, price: 0, stopPrice: 0, quantity, leverage: 15, marginMode: 'isolated',
    settlementMode: 'usdt', settlementAsset: 'USDT', status: type === 'CONDITIONAL' ? 'PENDING' : 'NEW', createdAt: 0,
    ...over,
  } as PendingOrder;
}
