import { describe, expect, it } from 'vitest';
import raw from '@/data/binanceLeverageTiers.json';
import type { PendingOrder, Position } from '@/types/trading';
import { calcLiquidationPrice } from '@/types/trading';
import {
  DEFAULT_POSITION_LIMIT_MODE,
  UNLIMITED_MAX_LEVERAGE,
  isUnlimitedLimitMode,
  normalizePositionLimitMode,
  symbolMaxLeverageFor,
} from '@/lib/positionLimitMode';
import {
  checkLeverageChange,
  checkOrderPositionLimit,
  checkPlacementPositionLimit,
  clampLeverageAcrossSettlements,
  clampSymbolLeverage,
  doomedAtTrigger,
  effectiveSymbolLeverage,
  leveragePinsForUnlimited,
  maxLeverageAcrossSettlements,
  newlyDoomedTriggerOrders,
  placementAftermath,
  placementSizingRemainingUsd,
  placementUsesLegacyHedge,
  recheckPrice,
  recheckedAtFill,
} from '@/lib/positionLimit';
import {
  cardCloseLotSize,
  checkLotSize,
  lotSizeCapLabel,
  lotSizeRefusalAtExecution,
  pendingLotSizeRisk,
  placementLotSize,
} from '@/lib/marketLotSize';
import {
  UNLIMITED_RISK_MODEL,
  hedgeExemptBaseUnits,
  isHedgeBaseRisk,
  mergeRiskBlocked,
  mergedHedgeBaseUnits,
  positionMaintenanceMarginUsd,
  positionRiskStampForFill,
  summarizeRiskModels,
} from '@/lib/positionRiskModel';
import { planLeverageChange } from '@/lib/leverageRestatement';
import { resolveSymbolTiers } from '@/lib/leverageTiers';
import { binanceSwitchRiskText, ordersRefusedUnderBinance } from '@/lib/positionLimitModeSwitch';
import { addTierHeadroom } from '@/lib/addTierHeadroom';
import { executeSettlementFill, mergeFilledPosition } from '@/lib/tradingSettlement';

/**
 * 持仓限制模式（lib/positionLimitMode）在纯函数库里的闸门：
 * 无限制 = 任何币种 1–150x、不设持仓上限与单笔上限、新仓按 0.4%；缺省（不传）= 币安标准，口径与改动前相同。
 */

const TIERED = { riskModel: 'binance-tiers-v1' as const, riskSymbol: 'ORDIUSD' };

/** 用户截图里的场景：ORDIUSD（币安无 ORDI 币本位，按 ORDIUSDT 分层折 USD 面值）20x，挂着 13,370 USD 的条件单。 */
const ordiConditional = (over: Partial<PendingOrder> = {}): PendingOrder => ({
  id: 'ordi-cond', side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 33, quantity: 1_337, contracts: 1_337,
  contractSizeUsd: 10, leverage: 20, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'ORDI',
  status: 'PENDING', createdAt: 1, ...TIERED, lotSizeRule: 'binance-lot-size-v1',
  ...over,
} as PendingOrder);

const ordiPlacement = (mode?: 'unlimited' | 'binance') => checkPlacementPositionLimit({
  symbol: 'ORDIUSD',
  settlement: 'coin',
  leverage: 20,
  positions: [],
  orders: [ordiConditional()],
  markPrice: 30,
  orderNotionalUsd: 13_990,
  orderPrice: 30,
  side: 'LONG',
  mode,
});

const usdtPosition = (over: Partial<Position> = {}): Position => ({
  id: 'p1', side: 'LONG', entryPrice: 1, quantity: 200_000, leverage: 20, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT', margin: 10_000, isolatedMargin: 10_000, openTime: 1,
  ...over,
} as Position);

describe('持仓限制模式：常量与收口', () => {
  it('默认无限制；读回来只认 binance，其余一律无限制；纯函数缺省按币安标准', () => {
    expect(DEFAULT_POSITION_LIMIT_MODE).toBe('unlimited');
    expect(normalizePositionLimitMode('binance')).toBe('binance');
    expect(normalizePositionLimitMode('unlimited')).toBe('unlimited');
    expect(normalizePositionLimitMode(undefined)).toBe('unlimited');
    expect(normalizePositionLimitMode('garbage')).toBe('unlimited');
    expect(isUnlimitedLimitMode('unlimited')).toBe(true);
    expect(isUnlimitedLimitMode(undefined)).toBe(false);
    expect(isUnlimitedLimitMode('binance')).toBe(false);
  });

  it('150x 是币安全部合约里最高的那一档：无限制模式下没有哪个币种比币安更严', () => {
    const data = raw as unknown as { usdm: { tables: number[][][] }; coinm: { tables: number[][][] } };
    const highest = Math.max(...[...data.usdm.tables, ...data.coinm.tables].flat().map(row => row[2]));
    expect(UNLIMITED_MAX_LEVERAGE).toBe(150);
    expect(highest).toBe(UNLIMITED_MAX_LEVERAGE);
  });
});

describe('杠杆：无限制 1–150x，币安标准按合约分层', () => {
  it('最高杠杆：ORDIUSDT 50x / LUMIAUSDT 10x / BTCUSD 125x；无限制一律 150x（含合成币本位 ORDIUSD）', () => {
    expect(symbolMaxLeverageFor('ORDIUSDT', 'usdt')).toBe(50);
    expect(symbolMaxLeverageFor('ORDIUSD', 'coin', 'binance')).toBe(50);
    expect(symbolMaxLeverageFor('LUMIAUSDT', 'usdt', 'binance')).toBe(10);
    expect(symbolMaxLeverageFor('BTCUSD', 'coin', 'binance')).toBe(125);
    for (const [symbol, settlement] of [['ORDIUSDT', 'usdt'], ['ORDIUSD', 'coin'], ['LUMIAUSDT', 'usdt'], ['BTCUSD', 'coin']] as const) {
      expect(symbolMaxLeverageFor(symbol, settlement, 'unlimited')).toBe(150);
    }
  });

  it('夹值：保存的 150x 在无限制下照原值生效，在币安标准下夹到合约上限；默认 35x 在 LUMIA 上不再被夹', () => {
    expect(effectiveSymbolLeverage(150, 'ORDIUSDT', 'usdt', 'unlimited')).toBe(150);
    expect(effectiveSymbolLeverage(150, 'ORDIUSDT', 'usdt', 'binance')).toBe(50);
    expect(effectiveSymbolLeverage(150, 'ORDIUSDT', 'usdt')).toBe(50);
    expect(effectiveSymbolLeverage(undefined, 'LUMIAUSDT', 'usdt', 'unlimited')).toBe(35);
    expect(effectiveSymbolLeverage(undefined, 'LUMIAUSDT', 'usdt')).toBe(10);
    expect(clampSymbolLeverage('LUMIAUSDT', 'usdt', 200, 'unlimited')).toBe(150);
    expect(clampSymbolLeverage('LUMIAUSDT', 'usdt', 0, 'unlimited')).toBe(1);
    expect(maxLeverageAcrossSettlements('BNBUSDT', 'unlimited')).toBe(150);
    expect(maxLeverageAcrossSettlements('BNBUSDT')).toBe(75);
    expect(clampLeverageAcrossSettlements('LUMIAUSDT', 50, 'unlimited')).toBe(50);
    expect(clampLeverageAcrossSettlements('LUMIAUSDT', 50)).toBe(10);
  });
});

describe('持仓上限：用户截图里的 ORDI（20x、已挂 13,370 USD 条件单、再下 13,990 USD）', () => {
  it('币安标准：13,370 + 13,990 = 27,360 超过 20x 最高 25,000 USD，拒绝（红框那句话）', () => {
    const r = ordiPlacement('binance');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('exceeds-cap');
    expect(r.exposureBefore).toBe(13_370);
    expect(r.cap).toBe(25_000);
    expect(r.message).toContain('持仓和当前委托价值超过当前杠杆倍数最高可持有头寸：20x 最高 25,000 USD');
    // 缺省同样按币安标准
    expect(ordiPlacement().message).toBe(r.message);
  });

  it('无限制：放行（理由 unlimited），没有上限、没有第二道，「可开」只受余额约束', () => {
    const r = ordiPlacement('unlimited');
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('unlimited');
    expect(r.message).toBeNull();
    expect(r.cap).toBe(Infinity);
    expect(r.topCap).toBe(Infinity);
    expect(r.maxLeverage).toBe(150);
    expect(r.atTrigger).toBeNull();
    expect(placementUsesLegacyHedge(r)).toBe(false);
    expect(placementSizingRemainingUsd(r, 30, { orderAtMarket: true, hasOpenPositions: true })).toBe(Infinity);
  });

  it('无限制也只放行 1–150x：151x 与 0x 照样拒绝，并说清是模式的范围', () => {
    const at = (leverage: number) => checkOrderPositionLimit({
      symbol: 'ORDIUSDT', settlement: 'usdt', leverage, positions: [], orders: [], markPrice: 30,
      orderNotionalUsd: 1_000, side: 'LONG', mode: 'unlimited',
    });
    expect(at(150).ok).toBe(true);
    expect(at(151).ok).toBe(false);
    expect(at(151).reason).toBe('leverage-above-max');
    expect(at(151).message).toBe('151x 超出无限制模式的杠杆范围 1–150x，请调整杠杆倍数');
    expect(at(0).ok).toBe(false);
  });

  it('改杠杆：无限制下 LUMIAUSDT 带着远超分层的敞口也能提到 150x', () => {
    const big = usdtPosition({ quantity: 5_000_000, leverage: 10, margin: 500_000, isolatedMargin: 500_000 });
    expect(checkLeverageChange({
      symbol: 'LUMIAUSDT', settlement: 'usdt', leverage: 150, positions: [big], orders: [], markPrice: 1, mode: 'unlimited',
    }).ok).toBe(true);
    expect(checkLeverageChange({
      symbol: 'LUMIAUSDT', settlement: 'usdt', leverage: 10, positions: [big], orders: [], markPrice: 1,
    }).ok).toBe(false);
  });
});

describe('触发 / 成交那一刻：按此刻的模式判', () => {
  it('无限制：不再判也不预警（recheckPrice / doomedAtTrigger / newlyDoomedTriggerOrders）', () => {
    const cond = ordiConditional();
    expect(recheckPrice(cond)).toEqual({ price: 33, kind: 'trigger' });
    expect(recheckPrice(cond, 'unlimited')).toBeNull();
    // 币安标准下已挂 13,370，再放一张 13,990 的持仓进来：条件单到时注定被拒
    const held = { ...usdtPosition(), settlementMode: 'coin', contracts: 1_399, quantity: 1_399, contractSizeUsd: 10 } as Position;
    expect(doomedAtTrigger('ORDIUSD', cond, [held], [cond], 30)?.ok).toBe(false);
    expect(doomedAtTrigger('ORDIUSD', cond, [held], [cond], 30, 'unlimited')).toBeNull();
    const added = placementAftermath(
      { type: 'MARKET', side: 'LONG', leverage: 20, quantity: 1_399, contracts: 1_399, contractSizeUsd: 10, settlementMode: 'coin', stopPrice: 0 },
      { markPrice: 30, immediate: true },
    );
    expect(newlyDoomedTriggerOrders({ symbol: 'ORDIUSD', positions: [], orders: [cond], added, markPrice: 30 })).toHaveLength(1);
    expect(newlyDoomedTriggerOrders({ symbol: 'ORDIUSD', positions: [], orders: [cond], added, markPrice: 30, mode: 'unlimited' })).toEqual([]);
  });

  it('币安标准：无限制模式下挂出的限价单（含分段子单）在成交那一刻判；币安标准下挂出的普通限价单照旧不判', () => {
    const limit = ordiConditional({ type: 'LIMIT', price: 28, stopPrice: 0 });
    expect(recheckedAtFill(limit)).toBe(false);
    expect(recheckPrice(limit)).toBeNull();
    const placedUnlimited = { ...limit, limitModeAtPlacement: 'unlimited' as const };
    expect(recheckedAtFill(placedUnlimited)).toBe(true);
    expect(recheckPrice(placedUnlimited)).toEqual({ price: 28, kind: 'limit' });
    // 此刻若仍是无限制：不预判
    expect(recheckPrice(placedUnlimited, 'unlimited')).toBeNull();
    // 只减仓单永远不判
    expect(recheckedAtFill({ ...placedUnlimited, reduceOnly: true })).toBe(false);
  });
});

describe('单笔上限（MARKET_LOT_SIZE / LOT_SIZE）：无限制不设', () => {
  it('ORDIUSDT 市价 30,000 ORDI：币安标准被拒（上限 20,000），无限制放行、没有上限小字', () => {
    const draft = { type: 'MARKET' as const, quantity: 30_000, settlementMode: 'usdt' as const };
    const binance = placementLotSize('ORDIUSDT', draft, 30);
    expect(binance.refusal?.title).toContain('单笔市价单最多 20,000 ORDI');
    expect(lotSizeCapLabel(binance.main)).toBe('单笔市价上限 20,000 ORDI');
    const unlimited = placementLotSize('ORDIUSDT', draft, 30, 'unlimited');
    expect(unlimited.refusal).toBeNull();
    expect(unlimited.main.maxUnits).toBeNull();
    expect(lotSizeCapLabel(unlimited.main)).toBeNull();
    expect(checkLotSize({ symbol: 'ORDIUSDT', settlement: 'usdt', kind: 'limit', units: 9e9, mode: 'unlimited' }).ok).toBe(true);
  });

  it('触发 / 执行时、委托列表的标记、持仓卡的市价平仓：无限制一律不判', () => {
    const stop = {
      ...ordiConditional({ type: 'CONDITIONAL', side: 'SHORT', stopPrice: 25 }),
      settlementMode: 'usdt', contracts: undefined, quantity: 30_000,
    } as PendingOrder;
    expect(lotSizeRefusalAtExecution('ORDIUSDT', stop, 25)).not.toBeNull();
    expect(lotSizeRefusalAtExecution('ORDIUSDT', stop, 25, 30_000, 'triggered', 'unlimited')).toBeNull();
    expect(pendingLotSizeRisk('ORDIUSDT', stop, 30)).not.toBeNull();
    expect(pendingLotSizeRisk('ORDIUSDT', stop, 30, 'unlimited')).toBeNull();
    const leg = usdtPosition({ quantity: 50_000, entryPrice: 30 });
    const binance = cardCloseLotSize('ORDIUSDT', [leg], 1, 30);
    expect(binance.ok).toBe(false);
    expect(binance.maxFraction).toBeLessThan(1);
    const unlimited = cardCloseLotSize('ORDIUSDT', [leg], 1, 30, 'market-close', 'unlimited');
    expect(unlimited).toEqual({ ok: true, orders: [], refusal: null, maxFraction: 1 });
  });
});

describe('维持保证金：无限制模式开的仓位按 0.4%（unlimited-v1）', () => {
  const order = {
    side: 'LONG', type: 'MARKET', price: 0, stopPrice: 0, quantity: 1_000_000, leverage: 150,
    marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', ...TIERED, riskSymbol: undefined,
  } as unknown as PendingOrder;

  it('成交时按模式盖戳：无限制 → unlimited-v1（与委托的来源无关）；缺省 / 币安标准沿用委托的来源', () => {
    expect(positionRiskStampForFill('ORDIUSDT', order, 'unlimited')).toEqual({ riskModel: UNLIMITED_RISK_MODEL, riskSymbol: 'ORDIUSDT' });
    expect(positionRiskStampForFill('ORDIUSDT', order)).toEqual({ riskModel: 'binance-tiers-v1', riskSymbol: 'ORDIUSDT' });
    expect(positionRiskStampForFill('ORDIUSDT', { riskModel: undefined }, 'binance')).toEqual({});
    const { position } = executeSettlementFill('ORDIUSDT', 20, order, false, 0, undefined, null, 'manual', 'unlimited');
    expect(position.riskModel).toBe('unlimited-v1');
    expect(executeSettlementFill('ORDIUSDT', 20, order, false, 0, undefined, null, 'manual').position.riskModel).toBe('binance-tiers-v1');
  });

  it('150x、2,000 万 USDT 的 ORDI 多仓：按 0.4% 维持保证金 80,000 < 保证金 133,333，不会一开出来就被强平；分层的话在最高一档之上照样算得出（不 NaN、不抛错）', () => {
    const { position } = executeSettlementFill('ORDIUSDT', 20, order, false, 0, undefined, null, 'manual', 'unlimited');
    const notional = 20 * 1_000_000;
    const mm = positionMaintenanceMarginUsd('ORDIUSDT', position, 20);
    expect(mm).toBeCloseTo(notional * 0.004, 6);
    expect(mm).toBeLessThan(Number(position.isolatedMargin));
    // 强平价走旧的 0.4% 公式：与不带戳的同一个仓位一样
    const { riskModel: _r, riskSymbol: _s, ...plain } = position;
    expect(calcLiquidationPrice(position, 'ORDIUSDT')).toBeCloseTo(calcLiquidationPrice(plain as Position, 'ORDIUSDT'), 9);
    // 同样的名义若是分层仓位（超过 ORDIUSDT 最高一档 12,500,000）：沿用最高一档的费率与速算扣除额
    const tiered = { ...position, riskModel: 'binance-tiers-v1' as const, riskSymbol: 'ORDIUSDT' };
    const tieredMm = positionMaintenanceMarginUsd('ORDIUSDT', tiered, 20);
    expect(Number.isFinite(tieredMm)).toBe(true);
    expect(tieredMm).toBeCloseTo(notional * 0.5 - 1_934_025, 4);
    expect(Number.isFinite(calcLiquidationPrice(tiered, 'ORDIUSDT'))).toBe(true);
    expect(summarizeRiskModels([position, tiered])).toBe('mixed');
    expect(summarizeRiskModels([position])).toBe('legacy');
  });

  it('合并：无限制的一笔并进分层仓位（整仓仍按分层，不换模型）；分层 / 无限制的一笔并进无限制仓位，整仓仍按 0.4%', () => {
    const tieredHeld = usdtPosition({ id: 'tiered', riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT', quantity: 9_000, margin: 450, isolatedMargin: 450 });
    const unlimitedFill = usdtPosition({ id: 'fill', riskModel: 'unlimited-v1', riskSymbol: 'KAITOUSDT', quantity: 230_000, margin: 11_500, isolatedMargin: 11_500 });
    // 加仓并进现有仓位的模型（设计第 3 条）：不另开一条只靠自己那点保证金的新腿
    expect(mergeRiskBlocked(tieredHeld, unlimitedFill)).toBe(false);
    const intoTiered = mergeFilledPosition('KAITOUSDT', [tieredHeld], unlimitedFill);
    expect(intoTiered.blockedBy).toBeNull();
    expect(intoTiered.positions).toHaveLength(1);
    expect(intoTiered.survivor.id).toBe('tiered');
    expect(intoTiered.survivor.riskModel).toBe('binance-tiers-v1');
    expect(intoTiered.survivor.quantity).toBe(239_000);
    // 分层仓位不是底，并进无限制的一笔之后照样不是
    expect(intoTiered.survivor.hedgeBaseUnits).toBeUndefined();
    // 规则三照旧：更新前的旧委托 / 对冲豁免的一笔不并进分层仓位
    expect(mergeRiskBlocked(tieredHeld, { riskModel: undefined })).toBe(true);
    expect(mergeRiskBlocked(tieredHeld, { riskModel: 'legacy-hedge-v1' })).toBe(true);

    const unlimitedHeld = { ...unlimitedFill, id: 'held', quantity: 100_000, margin: 5_000, isolatedMargin: 5_000 };
    const tieredFill = { ...tieredHeld, id: 'tfill', quantity: 10_000, margin: 500, isolatedMargin: 500 };
    expect(mergeRiskBlocked(unlimitedHeld, tieredFill)).toBe(false);
    const merged = mergeFilledPosition('KAITOUSDT', [unlimitedHeld], tieredFill);
    expect(merged.survivor.riskModel).toBe('unlimited-v1');
    expect(merged.survivor.quantity).toBe(110_000);
    // 规则四：分层加仓不把底做大；无限制的一笔并进无限制仓位，底随之变大
    expect(merged.survivor.hedgeBaseUnits).toBe(100_000);
    expect(mergedHedgeBaseUnits(unlimitedHeld, 100_000, unlimitedFill, 230_000)).toBe(330_000);
  });

  it('无限制的一笔并进分层仓位、总名义超过最高一档：维持保证金按最高一档的费率与速算额，强平价有定义，不抛错', () => {
    const tieredHeld = usdtPosition({ id: 'tiered', riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT', quantity: 9_000, margin: 1_800, isolatedMargin: 1_800, leverage: 5 });
    // KAITOUSDT 最高一档 12,500,000：并进 20,000,000 之后远超
    const hugeFill = usdtPosition({ id: 'huge', riskModel: 'unlimited-v1', riskSymbol: 'KAITOUSDT', quantity: 20_000_000, margin: 4_000_000, isolatedMargin: 4_000_000, leverage: 5 });
    const merged = mergeFilledPosition('KAITOUSDT', [tieredHeld], hugeFill);
    expect(merged.survivor.riskModel).toBe('binance-tiers-v1');
    const tiers = resolveSymbolTiers('KAITOUSDT', 'usdt').tiers;
    const top = tiers[tiers.length - 1];
    expect(20_009_000).toBeGreaterThan(top.cap);
    const mm = positionMaintenanceMarginUsd('KAITOUSDT', merged.survivor, 1);
    expect(Number.isFinite(mm)).toBe(true);
    expect(mm).toBeCloseTo(20_009_000 * top.maintenanceMarginRate - top.maintenanceAmount, 6);
    expect(() => calcLiquidationPrice(merged.survivor, 'KAITOUSDT')).not.toThrow();
    const liq = calcLiquidationPrice(merged.survivor, 'KAITOUSDT');
    expect(Number.isFinite(liq)).toBe(true);
  });
});

describe('切到币安标准之后：无限制模式开的仓位与更新前的仓位同等对待', () => {
  const held = usdtPosition({ riskModel: 'unlimited-v1', riskSymbol: 'KAITOUSDT' });
  const check = (side: 'LONG' | 'SHORT', usd: number) => checkOrderPositionLimit({
    symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions: [held], orders: [], markPrice: 1,
    orderNotionalUsd: usd, side,
  });

  it('是对冲豁免的底：反向对冲不受上限约束（200,000 超过 20x 的 50,000），往它那一侧加仓被拒，文案说「无限制模式下开的仓位」', () => {
    expect(isHedgeBaseRisk(held)).toBe(true);
    expect(hedgeExemptBaseUnits(held, 200_000)).toBe(200_000);
    const hedge = check('SHORT', 150_000);
    expect(hedge.ok).toBe(true);
    expect(hedge.reason).toBe('legacy-hedge');
    const add = check('LONG', 1_000);
    expect(add.ok).toBe(false);
    expect(add.message).toContain('（含无限制模式下开的仓位）');
    expect(add.message).toContain('反向开仓对冲无限制模式下开的仓位不受此限，最多 200,000 USDT。');
    expect(add.message).not.toContain('更新前');
  });

  it('更新前的仓位与无限制模式开的仓位都在：两种一起说', () => {
    const legacy = usdtPosition({ id: 'legacy', quantity: 100_000, margin: 5_000, isolatedMargin: 5_000 });
    const r = checkOrderPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 20, positions: [held, legacy], orders: [], markPrice: 1,
      orderNotionalUsd: 1_000, side: 'LONG',
    });
    expect(r.message).toContain('（含更新前按旧规则或无限制模式下开的仓位）');
    expect(r.message).toContain('反向开仓对冲更新前或无限制模式下开的仓位不受此限');
  });
});

describe('改杠杆（planLeverageChange）', () => {
  const isolated = (leverage: number, over: Partial<Position> = {}) => {
    const notional = 100_000;
    return usdtPosition({
      quantity: notional, leverage, margin: notional / leverage, isolatedMargin: notional / leverage,
      riskModel: 'unlimited-v1', riskSymbol: 'LUMIAUSDT', ...over,
    });
  };

  it('无限制：没有持仓时滑块上限 150x，LUMIAUSDT 可以直接提到 150x；不判分层上限', () => {
    const plan = planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [], orders: [], markPrice: 1, currentLeverage: 10, nextLeverage: 150,
      settlementMode: 'usdt', limitMode: 'unlimited',
    });
    expect(plan.ok).toBe(true);
    expect(plan.to).toBe(150);
    expect(plan.symbolMaxLeverage).toBe(150);
    expect(plan.tierCap).toBe(Infinity);
    expect(planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [], orders: [], markPrice: 1, currentLeverage: 10, nextLeverage: 150, settlementMode: 'usdt',
    }).to).toBe(10);
  });

  it('无限制：有持仓也能降杠杆——从可用余额追加保证金；余额补不上就拒；提到当场强平照样拒', () => {
    const pos = isolated(50);
    const lower = (availableBalance: number) => planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [pos], orders: [], markPrice: 1, currentLeverage: 50, nextLeverage: 20,
      settlementMode: 'usdt', limitMode: 'unlimited', availableBalance,
    });
    const ok = lower(10_000);
    expect(ok.ok).toBe(true);
    // 100,000 × (1/50 − 1/20) = −3,000
    expect(ok.totalReleaseUsd).toBeCloseTo(-3_000, 6);
    expect(ok.legs[0].marginAfter).toBeCloseTo(5_000, 6);
    const poor = lower(2_999);
    expect(poor.ok).toBe(false);
    expect(poor.refusal?.code).toBe('insufficient-balance');
    // 与对话框同一种写法：千分位、带单位
    expect(poor.refusal?.message).toBe('降到 20x 要追加保证金 3,000.00 USDT，可用余额只有 2,999.00 USDT：请先减仓，或少降一些');
    // 币安标准：同一步被「只能升不能降」挡住
    expect(planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [pos], orders: [], markPrice: 1, currentLeverage: 50, nextLeverage: 20, settlementMode: 'usdt',
    }).refusal?.code).toBe('below-floor');
    // 亏到只剩一点保证金的仓位，提到 150x 会当场强平
    const underwater = isolated(20);
    const up = planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [underwater], orders: [], markPrice: 0.96, currentLeverage: 20, nextLeverage: 150,
      settlementMode: 'usdt', limitMode: 'unlimited', availableBalance: 1e9,
    });
    expect(up.ok).toBe(false);
    expect(up.refusal?.code).toBe('would-liquidate');
  });

  it('币安标准：无限制模式下按 50x 开的 LUMIA 仓位（合约最高 10x）——平仓前无法调整，文案说是无限制模式下开的', () => {
    const plan = planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [isolated(50)], orders: [], markPrice: 1, currentLeverage: 10, nextLeverage: 9,
      settlementMode: 'usdt',
    });
    expect(plan.refusal?.code).toBe('below-floor');
    expect(plan.refusal?.message).toContain('现有仓位按 50x 开（高于该合约现在的最高杠杆 10x，是无限制模式下开的）');
    const legacy = planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [isolated(50, { riskModel: undefined })], orders: [], markPrice: 1,
      currentLeverage: 10, nextLeverage: 9, settlementMode: 'usdt',
    });
    expect(legacy.refusal?.message).toContain('是更新前按旧规则开的');
  });
});

describe('加仓计算器的分层余量', () => {
  it('无限制：没有分层上限（null），只受 Plan B 约束', () => {
    const input = {
      symbol: 'ORDIUSD', settlement: 'coin' as const, side: 'LONG' as const, storedLeverage: 20,
      positions: [], orders: [ordiConditional()], markPrice: 30, orderKind: 'market' as const, orderPrice: 0,
      fillPrice: 30, contractFaceUsd: 10,
    };
    const binance = addTierHeadroom(input);
    expect(binance).not.toBeNull();
    expect(binance?.usd).toBeLessThan(13_990);
    expect(addTierHeadroom({ ...input, mode: 'unlimited' })).toBeNull();
  });
});

describe('进无限制时钉住有仓位标的的杠杆（leveragePinsForUnlimited）', () => {
  const held = (symbol: string, leverage: number, over: Partial<Position> = {}) => usdtPosition({ id: `${symbol}-${leverage}`, leverage, ...over });
  const pins = (leverageMap: Record<string, number>, positionsMap: Record<string, Position[]>, ordersMap: Record<string, PendingOrder[]> = {}) =>
    leveragePinsForUnlimited({ leverageMap, positionsMap, ordersMap, settlementOf: () => 'usdt' });

  it('默认 35x 被夹成 10x、仓位按 10x 开 → 钉 10x；旧滑块 125x 被夹成 75x、仓位按 75x 开 → 钉 75x', () => {
    expect(pins({}, { LUMIAUSDT: [held('LUMIAUSDT', 10)] })).toEqual({ LUMIAUSDT: 10 });
    expect(pins({ KAITOUSDT: 125 }, { KAITOUSDT: [held('KAITOUSDT', 75)] })).toEqual({ KAITOUSDT: 75 });
  });

  it('不钉：币安的夹值没在起作用（KAITOUSDT 存 20x）；更新前按 35x 开的旧仓位（无限制下读 35x 正好对上）；什么都没有的标的', () => {
    expect(pins({ KAITOUSDT: 20 }, { KAITOUSDT: [held('KAITOUSDT', 20)] })).toEqual({});
    expect(pins({}, { LUMIAUSDT: [held('LUMIAUSDT', 35)] })).toEqual({});
    expect(pins({ LUMIAUSDT: 120 }, { LUMIAUSDT: [] })).toEqual({});
  });

  it('没有持仓时看开仓挂单（只减仓单不算）；仓位杠杆不一时钉在切换前读出来的值', () => {
    const order = { ...ordiConditional(), leverage: 10, settlementMode: 'usdt' } as PendingOrder;
    expect(pins({}, {}, { LUMIAUSDT: [order] })).toEqual({ LUMIAUSDT: 10 });
    expect(pins({}, {}, { LUMIAUSDT: [{ ...order, reduceOnly: true }] })).toEqual({});
    expect(pins({}, { LUMIAUSDT: [held('LUMIAUSDT', 10), held('LUMIAUSDT', 35, { id: 'b' })] })).toEqual({ LUMIAUSDT: 10 });
  });
});

describe('切到币安标准时会被撤的委托（ordersRefusedUnderBinance）', () => {
  it('ORDI：两张 20x 条件单 13,370 + 13,990 USD，触发时后一张超过 25,000 → 1 张（不是保护单）', () => {
    const second = ordiConditional({ id: 'ordi-cond-2', stopPrice: 34, quantity: 1_399, contracts: 1_399 });
    const risk = ordersRefusedUnderBinance({ ORDIUSD: [ordiConditional(), second] }, {}, { ORDIUSD: 30 });
    expect(risk.total).toBeGreaterThanOrEqual(1);
    expect(risk.protective).toBe(0);
    expect(risk.symbols).toEqual(['ORDIUSD']);
    expect(binanceSwitchRiskText(risk)).toContain('ORDIUSD 有');
    expect(binanceSwitchRiskText({ total: 0, protective: 0, symbols: [] })).toBeNull();
  });
});
