import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, profile: null }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(() => ({ upsert: vi.fn(async () => ({ error: null })) })) },
}));

import { TradingProvider, useTradingContext, type PlaceOrderParams } from '@/contexts/TradingContext';
import { __resetNotificationCenterForTests, getNotificationSnapshot, toast } from '@/lib/notificationCenter';
import { formatPrice } from '@/lib/formatters';
import { calcLiquidationPrice, type PendingOrder } from '@/types/trading';
import { planLeverageChange } from '@/lib/leverageRestatement';
import { executeSettlementFill, isPositionOpen, mergeFilledPosition } from '@/lib/tradingSettlement';
import { checkOrderPositionLimit, doomedAtTrigger, recheckedAtFill, twapSliceTrigger } from '@/lib/positionLimit';
import { addTierHeadroom } from '@/lib/addTierHeadroom';
import { positionMaintenanceMarginUsd } from '@/lib/positionRiskModel';

/**
 * 引擎自己的分层闸门（-2027），走真实的 TradingProvider：
 * 面板把按钮置灰只是第一道；绕过面板直接调 handlePlaceOrder 也必须下不出去，
 * 条件单在触发那一刻再判一次，保存的杠杆读出来就按合约夹过。
 */

const T0 = Date.parse('2026-09-17T00:00:00Z');
const SIM0 = Date.parse('2025-03-01T08:00:00Z');
const SYMBOL = 'KAITOUSDT';
/** 未登录时 usePersistedState 的前缀是 sim_anon_。 */
const KEY = (k: string) => `sim_anon_${k}`;

const wrapper = ({ children }: { children: React.ReactNode }) => <TradingProvider>{children}</TradingProvider>;

function mount(price = 1.0905, symbol = SYMBOL) {
  const view = renderHook(() => useTradingContext(), { wrapper });
  act(() => { view.result.current.setPriceMap({ [symbol]: price }); });
  act(() => {
    view.result.current.forkReplayTimeline(symbol, 'start', SIM0);
    view.result.current.sim.startSimulation(SIM0);
  });
  return view;
}

/** 币本位（默认结算方式）市价单，数量是张。 */
const coinMarket = (contracts: number, over: Partial<PlaceOrderParams> = {}): PlaceOrderParams => ({
  side: 'LONG', type: 'MARKET', price: 0, stopPrice: 0, quantity: contracts, contracts, leverage: 15,
  marginMode: 'isolated', priceSelection: 'MARKET', triggerType: 'LAST', currencyUnit: 'BASE',
  usdtInputMode: 'ORDER_VALUE', inputAmount: contracts, settlementMode: 'coin', settlementAsset: 'KAITO',
  contractSizeUsd: 10, latestPrice: 1.0905,
  ...over,
});

/** U 本位单，数量是币。 */
const usdtOrder = (quantity: number, over: Partial<PlaceOrderParams> = {}): PlaceOrderParams => ({
  side: 'LONG', type: 'MARKET', price: 0, stopPrice: 0, quantity, leverage: 15, marginMode: 'isolated',
  priceSelection: 'MARKET', triggerType: 'LAST', currencyUnit: 'BASE', usdtInputMode: 'ORDER_VALUE',
  inputAmount: quantity, settlementMode: 'usdt', settlementAsset: 'USDT', latestPrice: 1,
  ...over,
});

const errorTitles = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map(call => String(call[0]));
const openPositions = (ctx: ReturnType<typeof useTradingContext>) =>
  (ctx.positionsMap[SYMBOL] ?? []).filter(p => (p.contracts ?? p.quantity) > 0);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('引擎下单：绕过面板也过不去', () => {
  it('【用户案例】KAITOUSD 163,578 张 @15x：拒绝，不建仓、不扣钱', () => {
    const { result, unmount } = mount();
    const error = vi.spyOn(toast, 'error');
    const before = result.current.balance;
    let placed: unknown = 'untouched';
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, coinMarket(163_578)); });
    expect(placed).toBeNull();
    expect(openPositions(result.current)).toHaveLength(0);
    expect(result.current.balance).toBe(before);
    expect(errorTitles(error)).toContain(
      '持仓和当前委托价值超过当前杠杆倍数最高可持有头寸：15x 最高 50,000 USD。按这个规模最高可用 2x，请调低杠杆或减少数量。',
    );
    const description = String((error.mock.calls.at(-1)?.[1] as { description?: string })?.description);
    expect(description).toContain('= 1,635,780 USD');
    expect(description).toContain('币安 KAITOUSDT 分层，快照 2026-09-16');
    act(() => result.current.sim.stopSimulation());
    unmount();
  });

  it('【用户案例】同样的规模 @2x：分几笔市价单开出（每笔不超过单笔市价上限），并成一个仓位、带分层风险模型的戳', () => {
    const { result, unmount } = mount();
    /**
     * 单笔市价上限（lib/marketLotSize）上线之后，163,578 张不能一笔市价下出去：
     * 币安无 KAITO 币本位合约，借 KAITOUSDT 的 200,000 KAITO，在 1.0905 上折 21,810 张。
     * 分层（@2x 最高 7,500,000）照样放得下这个规模——分 8 笔下，每一笔都过分层与单笔上限。
     */
    const pieces = [...Array(7).fill(21_810), 163_578 - 7 * 21_810];
    for (const contracts of pieces) {
      let placed: { id: string } | null = null;
      act(() => { placed = result.current.handlePlaceOrder(SYMBOL, coinMarket(contracts, { leverage: 2 })); });
      expect(placed).not.toBeNull();
    }
    const [pos] = openPositions(result.current);
    expect(pos.contracts).toBe(163_578);
    expect(pos.leverage).toBe(2);
    expect(pos.riskModel).toBe('binance-tiers-v1');
    act(() => result.current.sim.stopSimulation());
    unmount();
  });

  it('双向持仓多空相加：多 30,000 之后，空 25,000 被拒、空 20,000 放行', () => {
    const { result, unmount } = mount();
    const error = vi.spyOn(toast, 'error');
    act(() => { result.current.handlePlaceOrder(SYMBOL, coinMarket(3_000)); });
    expect(openPositions(result.current)).toHaveLength(1);

    let placed: unknown = 'untouched';
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, coinMarket(2_500, { side: 'SHORT' })); });
    expect(placed).toBeNull();
    expect(errorTitles(error).some(t => t.includes('15x 最高 50,000 USD'))).toBe(true);

    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, coinMarket(2_000, { side: 'SHORT' })); });
    expect(placed).not.toBeNull();
    expect(openPositions(result.current).map(p => p.side).sort()).toEqual(['LONG', 'SHORT']);
    act(() => result.current.sim.stopSimulation());
    unmount();
  });

  it('当前委托计入：挂着 40,000 的限价单时市价 15,000 被拒，撤掉之后放行', () => {
    const { result, unmount } = mount();
    let resting: { id: string } | null = null;
    act(() => {
      resting = result.current.handlePlaceOrder(SYMBOL, coinMarket(4_000, {
        type: 'LIMIT', price: 1.0, priceSelection: 'LIMIT',
      }));
    });
    expect(resting).not.toBeNull();
    expect(result.current.ordersMap[SYMBOL]).toHaveLength(1);

    let placed: unknown = 'untouched';
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, coinMarket(1_500)); });
    expect(placed).toBeNull();

    act(() => { result.current.handleCancelOrder(SYMBOL, resting!.id); });
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, coinMarket(1_500)); });
    expect(placed).not.toBeNull();
    act(() => result.current.sim.stopSimulation());
    unmount();
  });

  it('条件单下单时也判：一张 60,000 的条件单挂不出去', () => {
    const { result, unmount } = mount();
    let placed: unknown = 'untouched';
    act(() => {
      placed = result.current.handlePlaceOrder(SYMBOL, coinMarket(6_000, { type: 'CONDITIONAL', stopPrice: 1.3 }));
    });
    expect(placed).toBeNull();
    expect(result.current.ordersMap[SYMBOL] ?? []).toHaveLength(0);
    act(() => result.current.sim.stopSimulation());
    unmount();
  });

  it('杠杆超过合约最高杠杆的单直接拒绝', () => {
    const { result, unmount } = mount();
    const error = vi.spyOn(toast, 'error');
    let placed: unknown = 'untouched';
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, coinMarket(10, { leverage: 125 })); });
    expect(placed).toBeNull();
    expect(errorTitles(error)).toContain('125x 超过该合约最高杠杆 75x，请调低杠杆倍数至 75x 以下');
    act(() => result.current.sim.stopSimulation());
    unmount();
  });
});

describe('条件单在触发那一刻再判一次', () => {
  /**
   * U 本位，15x 最高 50,000 USDT。先挂空头条件单 34,000 个、触发价 1.2（此时没有持仓：两道都过），
   * 再市价开多 9,000 个 @1.0（9,000 + 挂单 40,800 = 49,800 → 放行）：
   *   触发时：9,000 × 1.2 + 40,800 = 51,600 → 拒绝（挂单之后开的仓，到触发价上把总量推过了上限）
   * 下单那一刻就注定过不去的单（先有持仓、再挂这张条件单）现在下单时就被拒，见下方【复核】。
   */
  function setup(conditionalQty: number) {
    const view = mount(1.0);
    act(() => view.result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    let placed: { id: string } | null = null;
    act(() => {
      placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(conditionalQty, {
        side: 'SHORT', type: 'CONDITIONAL', stopPrice: 1.2,
      }));
    });
    expect(placed).not.toBeNull();
    let opened: { id: string } | null = null;
    act(() => { opened = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(9_000)); });
    expect(opened).not.toBeNull();
    const order = (view.result.current.ordersMap[SYMBOL] ?? []).find(o => o.id === placed!.id) as PendingOrder;
    expect(order.type).toBe('CONDITIONAL');
    return { ...view, order };
  }

  it('触发时超限：撤单留痕，不扣钱', () => {
    const { result, unmount, order } = setup(34_000);
    const error = vi.spyOn(toast, 'error');
    const before = result.current.balance;
    let settled: boolean | null = null;
    act(() => { settled = result.current.settleFillDebit(SYMBOL, order, 2_720, 20.4, SIM0 + 60_000, { price: 1.2 }); });
    expect(settled).toBe(false);
    expect(result.current.balance).toBe(before);
    expect(errorTitles(error)).toContain('触发时超过杠杆分层上限，委托已撤销');
    const description = String((error.mock.calls.at(-1)?.[1] as { description?: string })?.description);
    expect(description).toContain('15x 最高 50,000 USDT');
    expect(description).toContain('= 51,600 USDT');
    const cancelled = JSON.parse(localStorage.getItem(KEY('cancelled_orders')) ?? '[]') as { id: string }[];
    expect(cancelled.map(c => c.id)).toContain(order.id);
    act(() => result.current.sim.stopSimulation());
    unmount();
  });

  it('触发时仍在上限之内：照常扣款', () => {
    const { result, unmount, order } = setup(30_000);
    const before = result.current.balance;
    let settled: boolean | null = null;
    // 9,000 × 1.2 + 30,000 × 1.2 = 46,800
    act(() => { settled = result.current.settleFillDebit(SYMBOL, order, 2_400, 18, SIM0 + 60_000, { price: 1.2 }); });
    expect(settled).toBe(true);
    expect(result.current.balance).toBeCloseTo(before - 2_418, 6);
    act(() => result.current.sim.stopSimulation());
    unmount();
  });

  it('挂在盘口的限价单成交时不再判（不带 trigger）', () => {
    const { result, unmount, order } = setup(34_000);
    let settled: boolean | null = null;
    act(() => { settled = result.current.settleFillDebit(SYMBOL, order, 2_720, 20.4, SIM0 + 60_000); });
    expect(settled).toBe(true);
    act(() => result.current.sim.stopSimulation());
    unmount();
  });
});

describe('保存的杠杆读出来就按合约夹过', () => {
  it('KAITO 保存的 125x 读成 75x；BTC 保存的 150x 在币本位读成 125x、U 本位仍是 150x', () => {
    localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ KAITOUSDT: 125, BTCUSDT: 150 }));
    const { result, unmount } = renderHook(() => useTradingContext(), { wrapper });
    expect(result.current.getSymbolLeverage('KAITOUSDT')).toBe(75);
    expect(result.current.leverageMap.KAITOUSDT).toBe(125);          // 保存值不改写
    expect(result.current.getSymbolLeverage('BTCUSDT')).toBe(125);   // 默认币本位：BTCUSD 最高 125x
    act(() => result.current.setSymbolSettlementMode('BTCUSDT', 'usdt'));
    expect(result.current.getSymbolLeverage('BTCUSDT')).toBe(150);
    act(() => result.current.setSymbolSettlementMode('KAITOUSDT', 'usdt'));
    expect(result.current.getSymbolLeverage('KAITOUSDT')).toBe(75);
    unmount();
  });

  it('没保存过的默认 35x 同样要夹（LUMIA 只到 10x）；写入时也夹', () => {
    const { result, unmount } = renderHook(() => useTradingContext(), { wrapper });
    expect(result.current.getSymbolLeverage('LUMIAUSDT')).toBe(10);
    expect(result.current.getSymbolLeverage('KAITOUSDT')).toBe(35);
    act(() => result.current.setSymbolLeverage('KAITOUSDT', 200));
    expect(result.current.leverageMap.KAITOUSDT).toBe(75);
    act(() => result.current.setSymbolLeverage('KAITOUSDT', v => v - 5));
    expect(result.current.leverageMap.KAITOUSDT).toBe(70);
    unmount();
  });
});

describe('改杠杆与下单同一个判定', () => {
  it('持仓 45,000 @15x：提到 25x 被拒（25x 最高 25,000），提到 20x 放行', () => {
    const { result, unmount } = mount();
    act(() => result.current.setSymbolLeverage(SYMBOL, 15));
    act(() => { result.current.handlePlaceOrder(SYMBOL, coinMarket(4_500)); });
    expect(openPositions(result.current)).toHaveLength(1);

    let plan: ReturnType<typeof result.current.applySymbolLeverage> = null!;
    act(() => { plan = result.current.applySymbolLeverage(SYMBOL, 25); });
    expect(plan.ok).toBe(false);
    expect(plan.refusal?.code).toBe('tier-cap');
    expect(plan.refusal?.message).toBe(
      '请调低杠杆倍数至 20x 以下：持仓和当前委托价值 45,000 USD 超过 25x 最高可持有头寸 25,000 USD',
    );
    expect(result.current.getSymbolLeverage(SYMBOL)).toBe(15);

    act(() => { plan = result.current.applySymbolLeverage(SYMBOL, 20); });
    expect(plan.ok).toBe(true);
    expect(result.current.getSymbolLeverage(SYMBOL)).toBe(20);
    expect(openPositions(result.current)[0].leverage).toBe(20);
    act(() => result.current.sim.stopSimulation());
    unmount();
  });

  it('滑块之外传进来的 125x 被夹到合约最高 75x', () => {
    const { result, unmount } = mount();
    act(() => result.current.setSymbolLeverage(SYMBOL, 15));
    let plan: ReturnType<typeof result.current.applySymbolLeverage> | null = null;
    act(() => { plan = result.current.applySymbolLeverage(SYMBOL, 125); });
    expect(plan!.to).toBe(75);
    expect(plan!.symbolMaxLeverage).toBe(75);
    expect(result.current.getSymbolLeverage(SYMBOL)).toBe(75);
    act(() => result.current.sim.stopSimulation());
    unmount();
  });
});

describe('持仓卡的杠杆对话框与引擎读同一张分层（结算方式随对话框传进引擎）', () => {
  /**
   * 下单面板每次刷新都回到币本位，而持仓卡上是 U 本位仓位：对话框按仓位的结算方式预览，
   * 引擎必须按同一种结算方式夹值、判定、写回保存的杠杆。20 个同时有币本位永续的币
   * 两边上限不同（BNB 75x / 20x、SOL 100x / 50x、BTC 150x / 125x）。
   */
  const usdtLong = (id: string, quantity: number, entryPrice: number, leverage: number) => {
    const margin = (quantity * entryPrice) / leverage;
    return {
      id, side: 'LONG', quantity, entryPrice, leverage, openLeverage: leverage, marginMode: 'isolated',
      settlementMode: 'usdt', settlementAsset: 'USDT', margin, isolatedMargin: margin, openTime: SIM0,
      riskModel: 'binance-tiers-v1', riskSymbol: id.split(':')[0],
    };
  };

  function seed(symbol: string, quantity: number, entryPrice: number, leverage: number) {
    localStorage.setItem(KEY('positions_map'), JSON.stringify({ [symbol]: [usdtLong(`${symbol}:1`, quantity, entryPrice, leverage)] }));
    localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ [symbol]: leverage }));
    const view = renderHook(() => useTradingContext(), { wrapper });
    act(() => { view.result.current.setPriceMap({ [symbol]: entryPrice }); });
    // 面板停在默认的币本位（刷新之后就是这样）
    expect(view.result.current.getSymbolSettlementMode(symbol)).toBe('coin');
    return view;
  }

  /** 与 PositionPanel 打开对话框时的算法一字不差。 */
  const dialogPlan = (ctx: ReturnType<typeof useTradingContext>, symbol: string, next: number) => {
    const legs = ctx.positionsMap[symbol] ?? [];
    return planLeverageChange({
      symbol, positions: legs, orders: ctx.ordersMap[symbol] ?? [], markPrice: ctx.priceMap[symbol] ?? 0,
      currentLeverage: Math.max(...legs.map(p => p.leverage)), nextLeverage: next,
      settlementMode: legs[0]?.settlementMode,
    });
  };

  it('BNBUSDT U 本位 30x → 40x：对话框放行，引擎也提到 40x，保存值不被夹成币本位的 20x', () => {
    const { result, unmount } = seed('BNBUSDT', 10, 600, 30);
    const preview = dialogPlan(result.current, 'BNBUSDT', 40);
    expect(preview).toMatchObject({ ok: true, to: 40, symbolMaxLeverage: 75 });
    let plan: ReturnType<typeof result.current.applySymbolLeverage> = null!;
    act(() => { plan = result.current.applySymbolLeverage('BNBUSDT', 40, 'usdt'); });
    expect(plan).toMatchObject({ ok: true, to: preview.to, symbolMaxLeverage: 75 });
    expect(result.current.positionsMap.BNBUSDT[0].leverage).toBe(40);
    expect(result.current.leverageMap.BNBUSDT).toBe(40);
    unmount();
  });

  it('BTCUSDT U 本位 100x → 150x：引擎应用的就是对话框确认的 150x', () => {
    const { result, unmount } = seed('BTCUSDT', 0.1, 60_000, 100);
    const preview = dialogPlan(result.current, 'BTCUSDT', 150);
    expect(preview).toMatchObject({ ok: true, to: 150 });
    let plan: ReturnType<typeof result.current.applySymbolLeverage> = null!;
    act(() => { plan = result.current.applySymbolLeverage('BTCUSDT', 150, 'usdt'); });
    expect(plan.to).toBe(150);
    expect(result.current.positionsMap.BTCUSDT[0].leverage).toBe(150);
    unmount();
  });

  it('SOLUSDT 30x → 60x → 80x：两次都与对话框一致（不再被夹到 50x、也不再误报「只能提高」）', () => {
    const { result, unmount } = seed('SOLUSDT', 50, 150, 30);
    for (const next of [60, 80]) {
      const preview = dialogPlan(result.current, 'SOLUSDT', next);
      expect(preview).toMatchObject({ ok: true, to: next });
      let plan: ReturnType<typeof result.current.applySymbolLeverage> = null!;
      act(() => { plan = result.current.applySymbolLeverage('SOLUSDT', next, 'usdt'); });
      expect(plan).toMatchObject({ ok: true, to: next, refusal: null });
      expect(result.current.positionsMap.SOLUSDT[0].leverage).toBe(next);
    }
    unmount();
  });

  it('不传结算方式时仍按下单面板当前的结算方式（下单面板自己的调用口径）', () => {
    const { result, unmount } = seed('SOLUSDT', 50, 150, 30);
    let plan: ReturnType<typeof result.current.applySymbolLeverage> = null!;
    act(() => { plan = result.current.applySymbolLeverage('SOLUSDT', 60); });
    expect(plan).toMatchObject({ to: 50, symbolMaxLeverage: 50 });
    unmount();
  });
});

describe('更新前挂出的委托：成交后仍按旧的 0.4% 模型，升级不让它们开出来就爆', () => {
  const legacyLimit = (leverage: number, quantity: number): PendingOrder => ({
    id: `legacy-${leverage}-${quantity}`, side: 'LONG', type: 'LIMIT', price: 1, stopPrice: 0, quantity, leverage,
    marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'NEW', createdAt: SIM0 - 60_000,
  } as PendingOrder);

  function fillResting(order: PendingOrder) {
    localStorage.setItem(KEY('orders_map'), JSON.stringify({ [SYMBOL]: [order] }));
    const view = mount(1.0);
    const { result } = view;
    const stored = (result.current.ordersMap[SYMBOL] ?? [])[0];
    const fillAt = SIM0 + 60_000;
    // 与 Index / useBackgroundPrices 的挂单成交路径相同：executeSettlementFill → settleFillDebit（不带 trigger）
    const { fee, margin, position } = executeSettlementFill(SYMBOL, 1, stored, true, fillAt);
    let settled: boolean | null = null;
    act(() => { settled = result.current.settleFillDebit(SYMBOL, stored, margin, fee, fillAt); });
    expect(settled).toBe(true);
    act(() => {
      result.current.setOrdersMap(prev => ({ ...prev, [SYMBOL]: [] }));
      result.current.setPositionsMap(prev => ({ ...prev, [SYMBOL]: [position] }));
    });
    // 完全不动的 K 线（第一根只用来建立「上一次看到哪」，第二根才是成交之后的价）
    for (const start of [fillAt, fillAt + 60_000]) {
      act(() => {
        result.current.liquidateIsolatedOnCandle(SYMBOL, {
          high: 1, low: 1, close: 1, startTime: start, endTime: start + 60_000,
        });
      });
    }
    return { ...view, position };
  }

  it('KAITOUSDT 125x 的旧限价单（新上限 75x）：成交后不带分层戳，平盘 K 线不爆', () => {
    const { result, unmount, position } = fillResting(legacyLimit(125, 1_000));
    expect(result.current.tradeHistory.filter(t => t.action === 'LIQUIDATION')).toHaveLength(0);
    expect(openPositions(result.current)).toHaveLength(1);
    expect(position.riskModel).toBeUndefined();
    act(() => result.current.sim.stopSimulation());
    unmount();
  });

  it('KAITOUSDT 240,000 @20x 的旧限价单（新规则下 20x 最多 50,000）：同样不爆', () => {
    const { result, unmount, position } = fillResting(legacyLimit(20, 240_000));
    expect(result.current.tradeHistory.filter(t => t.action === 'LIQUIDATION')).toHaveLength(0);
    expect(openPositions(result.current)).toHaveLength(1);
    expect(position.riskModel).toBeUndefined();
    act(() => result.current.sim.stopSimulation());
    unmount();
  });
});

describe('引擎下出去的每一种委托都带分层戳（成交后开分层仓位）', () => {
  it('限价 / 条件 / 分段子单 / 跟踪 / TWAP', () => {
    const { result, unmount } = mount(1.0);
    act(() => result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    const place = (order: PlaceOrderParams) => act(() => { result.current.handlePlaceOrder(SYMBOL, order); });
    place(usdtOrder(100, { type: 'LIMIT', price: 0.9, priceSelection: 'LIMIT' }));
    place(usdtOrder(100, { type: 'CONDITIONAL', stopPrice: 1.2 }));
    place(usdtOrder(100, { type: 'SCALED', scaledCount: 3, scaledStartPrice: 0.8, scaledEndPrice: 0.9 }));
    place(usdtOrder(100, { type: 'TRAILING_STOP', stopPrice: 1.1, callbackRate: 0.01 }));
    place(usdtOrder(100, { type: 'TWAP', twapDuration: 60, twapInterval: 5 }));
    const orders = result.current.ordersMap[SYMBOL] ?? [];
    expect(orders.map(o => o.type).sort()).toEqual(['CONDITIONAL', 'LIMIT', 'LIMIT', 'LIMIT', 'LIMIT', 'TRAILING_STOP', 'TWAP']);
    expect(orders.every(o => o.riskModel === 'binance-tiers-v1')).toBe(true);
    act(() => result.current.sim.stopSimulation());
    unmount();
  });
});

describe('旧版本留下的超上限挂单可以被拉回合约上限', () => {
  it('KAITOUSDT 保存 125x、挂着 125x 的旧限价单：在 75x 上确认即把挂单重述到 75x', () => {
    localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ [SYMBOL]: 125 }));
    localStorage.setItem(KEY('orders_map'), JSON.stringify({
      [SYMBOL]: [{
        id: 'old-125', side: 'LONG', type: 'LIMIT', price: 0.9, stopPrice: 0, quantity: 100, leverage: 125,
        marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'NEW', createdAt: 1,
      }],
    }));
    const { result, unmount } = renderHook(() => useTradingContext(), { wrapper });
    act(() => { result.current.setPriceMap({ [SYMBOL]: 1 }); });
    act(() => result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    expect(result.current.getSymbolLeverage(SYMBOL)).toBe(75);
    let plan: ReturnType<typeof result.current.applySymbolLeverage> = null!;
    act(() => { plan = result.current.applySymbolLeverage(SYMBOL, 75, 'usdt'); });
    expect(plan).toMatchObject({ ok: true, to: 75, restatedOrderIds: ['old-125'] });
    expect(result.current.ordersMap[SYMBOL][0].leverage).toBe(75);
    expect(result.current.leverageMap[SYMBOL]).toBe(75);
    unmount();
  });
});

// ───────────────────────── 复核第二轮 ─────────────────────────

const TIERED = { riskModel: 'binance-tiers-v1', riskSymbol: SYMBOL } as const;

/** U 本位逐仓仓位（直接写进 positions_map，模拟更新前 / 更新后开的仓）。 */
const storedUsdtPosition = (id: string, side: 'LONG' | 'SHORT', quantity: number, entryPrice: number, leverage: number, over: Record<string, unknown> = {}) => {
  const margin = (quantity * entryPrice) / leverage;
  return {
    id, side, quantity, entryPrice, leverage, openLeverage: leverage, marginMode: 'isolated',
    settlementMode: 'usdt', settlementAsset: 'USDT', margin, isolatedMargin: margin, openTime: SIM0 - 60_000,
    ...over,
  };
};

/** U 本位条件单（直接写进 orders_map）。不传 riskModel 就是更新前挂出的旧单。 */
const storedConditional = (id: string, side: 'LONG' | 'SHORT', quantity: number, stopPrice: number, leverage: number, over: Record<string, unknown> = {}) => ({
  id, side, type: 'CONDITIONAL', price: 0, stopPrice, quantity, leverage, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT', status: 'PENDING', createdAt: SIM0 - 30_000,
  triggerDirection: 'DOWN', operator: '<=',
  ...over,
} as unknown as PendingOrder);

function seedAndMount(
  { positions = [], orders = [], leverage, symbol = SYMBOL, price = 1 }:
  { positions?: unknown[]; orders?: PendingOrder[]; leverage?: number; symbol?: string; price?: number },
) {
  localStorage.setItem(KEY('positions_map'), JSON.stringify(positions.length ? { [symbol]: positions } : {}));
  localStorage.setItem(KEY('orders_map'), JSON.stringify(orders.length ? { [symbol]: orders } : {}));
  if (leverage != null) localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ [symbol]: leverage }));
  const view = mount(price, symbol);
  act(() => view.result.current.setSymbolSettlementMode(symbol, 'usdt'));
  return view;
}

const stoppedUnmount = (view: { result: { current: ReturnType<typeof useTradingContext> }; unmount: () => void }) => {
  act(() => view.result.current.sim.stopSimulation());
  view.unmount();
};

describe('【复核】更新前挂出的条件单：触发时不按新分层再判（与成交后的旧模型同一条规则）', () => {
  /** 更新前：多 30,000 @1.0 20x，外加一张没有戳的空头对冲条件单 30,000 @0.9、20x（旧通用表都放行）。 */
  const setup = (orderOver: Record<string, unknown> = {}, positionOver: Record<string, unknown> = {}) => {
    const hedge = storedConditional('legacy-hedge', 'SHORT', 30_000, 0.9, 20, orderOver);
    const view = seedAndMount({
      positions: [storedUsdtPosition('legacy-long', 'LONG', 30_000, 1.0, 20, positionOver)],
      orders: [hedge], leverage: 20, price: 0.9,
    });
    return { ...view, hedge };
  };

  it('没有戳的对冲单在 0.9 触发：照常成交扣款，多仓不会被撂在那里没有对冲', () => {
    const view = setup();
    const error = vi.spyOn(toast, 'error');
    const before = view.result.current.balance;
    let settled: boolean | null = null;
    act(() => { settled = view.result.current.settleFillDebit(SYMBOL, view.hedge, 1_350, 13.5, SIM0, { price: 0.9 }); });
    expect(settled).toBe(true);
    expect(view.result.current.balance).toBeCloseTo(before - 1_363.5, 6);
    expect(errorTitles(error)).not.toContain('触发时超过杠杆分层上限，委托已撤销');
    const cancelled = JSON.parse(localStorage.getItem(KEY('cancelled_orders')) ?? '[]') as { id: string }[];
    expect(cancelled.map(c => c.id)).not.toContain('legacy-hedge');
    stoppedUnmount(view);
  });

  it('同一张单若是更新后下的（带戳）、对着的也是更新后开的仓位：触发时照判，超限撤单留痕', () => {
    const view = setup({ riskModel: 'binance-tiers-v1' }, TIERED);
    const error = vi.spyOn(toast, 'error');
    let settled: boolean | null = null;
    act(() => { settled = view.result.current.settleFillDebit(SYMBOL, view.hedge, 1_350, 13.5, SIM0, { price: 0.9 }); });
    expect(settled).toBe(false);
    expect(errorTitles(error)).toContain('触发时超过杠杆分层上限，委托已撤销');
    stoppedUnmount(view);
  });

  it('【复核 r3】带戳的对冲单对着的是更新前的仓位：触发时按对冲豁免放行（反向总量不超过旧仓位的名义）', () => {
    const view = setup({ riskModel: 'binance-tiers-v1' });
    let settled: boolean | null = null;
    act(() => { settled = view.result.current.settleFillDebit(SYMBOL, view.hedge, 1_350, 13.5, SIM0, { price: 0.9 }); });
    expect(settled).toBe(true);
    stoppedUnmount(view);
  });

  it('LUMIAUSDT（最高 10x）上旧默认 35x 的条件单：触发时不因「35x 超过最高杠杆」被撤', () => {
    const order = storedConditional('legacy-lumia', 'LONG', 100, 0.09, 35, { settlementMode: 'usdt' });
    const view = seedAndMount({ orders: [order], symbol: 'LUMIAUSDT', price: 0.09, leverage: 35 });
    let settled: boolean | null = null;
    act(() => { settled = view.result.current.settleFillDebit('LUMIAUSDT', order, 0.26, 0.005, SIM0, { price: 0.09 }); });
    expect(settled).toBe(true);
    stoppedUnmount(view);
  });
});

describe('【复核】同一批刚成交的单按 settledOrderIds 排除，不与刚记进持仓的那笔重复计算', () => {
  /**
   * 15x 最高 50,000。B（20,000 @1.0）这一批里已经成交、仓位已记进持仓，但还没从挂单列表移走；
   * A（25,000 @1.0）随后触发：20,000 + 25,000 = 45,000 过得去；把 B 再按挂单算一遍就是 65,000。
   */
  const setup = () => {
    const a = storedConditional('A', 'LONG', 25_000, 1.0, 15, TIERED);
    const b = storedConditional('B', 'LONG', 20_000, 1.0, 15, TIERED);
    return {
      ...seedAndMount({
        positions: [storedUsdtPosition('from-B', 'LONG', 20_000, 1.0, 15, TIERED)],
        orders: [a, b], leverage: 15, price: 1.0,
      }),
      a,
    };
  };

  it('带上 settledOrderIds：放行', () => {
    const view = setup();
    let settled: boolean | null = null;
    act(() => {
      settled = view.result.current.settleFillDebit(SYMBOL, view.a, 1_666, 12.5, SIM0, { price: 1.0, settledOrderIds: ['B'] });
    });
    expect(settled).toBe(true);
    stoppedUnmount(view);
  });

  it('不带（只排除自己）：B 被重复计算而被撤——证明上面那条确实靠的是 settledOrderIds', () => {
    const view = setup();
    let settled: boolean | null = null;
    act(() => { settled = view.result.current.settleFillDebit(SYMBOL, view.a, 1_666, 12.5, SIM0, { price: 1.0 }); });
    expect(settled).toBe(false);
    stoppedUnmount(view);
  });
});

describe('【复核】TWAP 每一片都是一笔新市价单：执行时按「持仓 + 这一片」再判', () => {
  /** 15x 开出的 TWAP：共 45,000，已成交 42,000（已并进持仓），下一片 1,000。 */
  const twap = (over: Record<string, unknown> = {}) => ({
    id: 'twap-1', side: 'LONG', type: 'TWAP', price: 0, stopPrice: 0, quantity: 45_000, leverage: 15,
    marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'ACTIVE', createdAt: SIM0 - 600_000,
    twapTotalQty: 45_000, twapFilledQty: 42_000, twapInterval: 60_000, twapNextExecTime: SIM0, twapEndTime: SIM0 + 600_000,
    ...over,
  } as unknown as PendingOrder);
  const slice = (order: PendingOrder) => ({ ...order, quantity: 1_000 }) as PendingOrder;
  const setup = (price: number, over: Record<string, unknown> = TIERED) => {
    const order = twap(over);
    return {
      ...seedAndMount({
        positions: [storedUsdtPosition('twap-pos', 'LONG', 42_000, 1.0, 15, over)],
        orders: [order], leverage: 15, price,
      }),
      order,
    };
  };

  it('twapSliceTrigger：按这一片估值、排除这张 TWAP 自己的余量', () => {
    const order = twap();
    expect(twapSliceTrigger(order, slice(order), 1.2))
      .toEqual({ price: 1.2, settledOrderIds: ['twap-1'], fill: slice(order), orderOverrides: [] });
  });

  it('涨到 1.2：持仓 50,400 + 这一片 1,200 超过 50,000 → 这一片被拒，整张 TWAP 撤掉留痕', () => {
    const view = setup(1.2);
    const error = vi.spyOn(toast, 'error');
    let settled: boolean | null = null;
    act(() => {
      settled = view.result.current.settleFillDebit(SYMBOL, view.order, 80, 0.6, SIM0, twapSliceTrigger(view.order, slice(view.order), 1.2));
    });
    expect(settled).toBe(false);
    expect(errorTitles(error)).toContain('触发时超过杠杆分层上限，委托已撤销');
    const description = String((error.mock.calls.at(-1)?.[1] as { description?: string })?.description);
    expect(description).toContain('50,400 USDT + 本单 1,200 USDT');
    const cancelled = JSON.parse(localStorage.getItem(KEY('cancelled_orders')) ?? '[]') as { id: string; quantity: number }[];
    expect(cancelled.find(c => c.id === 'twap-1')?.quantity).toBe(45_000);   // 留痕的是整张 TWAP
    stoppedUnmount(view);
  });

  it('1.15：持仓 48,300 + 这一片 1,150 = 49,450 → 放行（不按整张 TWAP 估值，也不把它自己的余量再算一遍）', () => {
    const view = setup(1.15);
    let settled: boolean | null = null;
    act(() => {
      settled = view.result.current.settleFillDebit(SYMBOL, view.order, 76, 0.6, SIM0, twapSliceTrigger(view.order, slice(view.order), 1.15));
    });
    expect(settled).toBe(true);
    stoppedUnmount(view);
  });

  it('更新前挂出的 TWAP（没有戳）：切片不判', () => {
    const view = setup(1.2, {});
    let settled: boolean | null = null;
    act(() => {
      settled = view.result.current.settleFillDebit(SYMBOL, view.order, 80, 0.6, SIM0, twapSliceTrigger(view.order, slice(view.order), 1.2));
    });
    expect(settled).toBe(true);
    stoppedUnmount(view);
  });
});

describe('【复核】条件单下单时按触发价再判：注定在触发时被撤的对冲单当场就挂不出去', () => {
  it('U 本位：空 24,000 @1.0、20x，多头条件单 24,000 @1.05 → 拒绝（触发时 50,400）', () => {
    const view = mount(1.0);
    act(() => view.result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    const error = vi.spyOn(toast, 'error');
    act(() => { view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(24_000, { side: 'SHORT', leverage: 20 })); });
    expect(openPositions(view.result.current)).toHaveLength(1);
    let placed: unknown = 'untouched';
    act(() => {
      placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(24_000, {
        side: 'LONG', type: 'CONDITIONAL', stopPrice: 1.05, leverage: 20,
      }));
    });
    expect(placed).toBeNull();
    expect(view.result.current.ordersMap[SYMBOL] ?? []).toHaveLength(0);
    const title = errorTitles(error).at(-1) ?? '';
    expect(title.startsWith('按触发价 1.05')).toBe(true);
    expect(title).toContain('20x 最高 50,000 USDT');
    const description = String((error.mock.calls.at(-1)?.[1] as { description?: string })?.description);
    expect(description).toContain('= 50,400 USDT');
    // 触发价在下方（空仓的价值在下跌时变小）：两道都过，照常挂出
    act(() => {
      placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(24_000, {
        side: 'LONG', type: 'CONDITIONAL', stopPrice: 0.95, leverage: 20,
      }));
    });
    expect(placed).not.toBeNull();
    stoppedUnmount(view);
  });

  it('币本位 BTCUSD 60,000、20x：多 50,000 张后，空头条件单 35,000 张 @54,000 → 拒绝（触发时 157.41 BTC）', () => {
    const view = mount(60_000, 'BTCUSDT');
    const btc = (contracts: number, over: Partial<PlaceOrderParams> = {}): PlaceOrderParams => ({
      ...coinMarket(contracts, { leverage: 20, settlementAsset: 'BTC', contractSizeUsd: 100, latestPrice: 60_000 }),
      ...over,
    });
    const error = vi.spyOn(toast, 'error');
    act(() => { view.result.current.handlePlaceOrder('BTCUSDT', btc(50_000)); });
    expect((view.result.current.positionsMap.BTCUSDT ?? []).length).toBe(1);
    let placed: unknown = 'untouched';
    act(() => {
      placed = view.result.current.handlePlaceOrder('BTCUSDT', btc(35_000, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 54_000 }));
    });
    expect(placed).toBeNull();
    expect(errorTitles(error).at(-1)).toContain('20x 最高 150 BTC');
    expect(errorTitles(error).at(-1)?.startsWith('按触发价')).toBe(true);
    act(() => {
      placed = view.result.current.handlePlaceOrder('BTCUSDT', btc(30_000, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 54_000 }));
    });
    expect(placed).not.toBeNull();   // (5,000,000 + 3,000,000) / 54,000 = 148.1 BTC
    stoppedUnmount(view);
  });
});

describe('【复核】现有敞口自己就超过上限：引擎的拒绝理由说清只能减仓', () => {
  it('15x 开 45,000、涨到 1.2 之后 5 个币的对冲单被拒：不叫人降杠杆（逐仓降不下去）', () => {
    const view = mount(1.0);
    act(() => view.result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    act(() => view.result.current.setSymbolLeverage(SYMBOL, 15));
    act(() => { view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(45_000)); });
    act(() => { view.result.current.setPriceMap({ [SYMBOL]: 1.2 }); });
    const error = vi.spyOn(toast, 'error');
    let placed: unknown = 'untouched';
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(5, { side: 'SHORT', latestPrice: 1.2 })); });
    expect(placed).toBeNull();
    const title = errorTitles(error).at(-1) ?? '';
    expect(title).toContain('现有持仓和当前委托价值 54,000 USDT 已超过');
    expect(title).toContain('逐仓有持仓时不能降杠杆（当前最低 15x）');
    expect(title).not.toContain('请调低杠杆');
    // 对话框给的是同一个结论
    let plan: ReturnType<typeof view.result.current.applySymbolLeverage> = null!;
    act(() => { plan = view.result.current.applySymbolLeverage(SYMBOL, 5, 'usdt'); });
    expect(plan.refusal?.code).toBe('below-floor');
    expect(plan.refusal?.message).toContain('只能先减仓或撤单，把总量降到 50,000 USDT 以下再开新单');
    stoppedUnmount(view);
  });

  it('【复核 r3】更新前按 35x 开的 20,000 KAITO：往它那一侧加仓被拒并点明是旧仓位、指出反向对冲不受限；反向对冲照常下得出去', () => {
    const view = seedAndMount({ positions: [storedUsdtPosition('legacy', 'LONG', 20_000, 1.0, 35)], leverage: 35 });
    const error = vi.spyOn(toast, 'error');
    let placed: unknown = 'untouched';
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(100, { side: 'LONG', leverage: 35 })); });
    expect(placed).toBeNull();
    const title = errorTitles(error).at(-1) ?? '';
    expect(title).toContain('（含更新前按旧规则开的仓位）');
    expect(title).toContain('35x 最高 10,000 USDT');
    expect(title).toContain('只能先减仓或撤单');
    expect(title).toContain('反向开仓对冲更新前的仓位不受此限，最多 20,000 USDT。');
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(100, { side: 'SHORT', leverage: 35 })); });
    expect(placed).not.toBeNull();
    expect(openPositions(view.result.current).map(p => p.side).sort()).toEqual(['LONG', 'SHORT']);
    let plan: ReturnType<typeof view.result.current.applySymbolLeverage> = null!;
    act(() => { plan = view.result.current.applySymbolLeverage(SYMBOL, 40, 'usdt'); });
    expect(plan.refusal?.code).toBe('exposure-over-cap');
    expect(plan.refusal?.message).not.toContain('请调低杠杆倍数至 25x');
    stoppedUnmount(view);
  });
});

describe('【复核】全仓强平的维持保证金逐笔按各自的风险模型算', () => {
  /**
   * KAITOUSDT 全仓多 2,000,000 @1.0、2x（保证金 1,000,000），钱包里没有余钱。跌到 0.58：
   *   权益 = 1,000,000 − 840,000 = 160,000
   *   分层维持保证金 = 1,160,000 × 25% − 118,100 = 171,900 → 爆
   *   旧 0.4%        = 1,160,000 × 0.4%         =   4,640 → 不爆
   */
  const crossLong = (over: Record<string, unknown>) => ({
    ...storedUsdtPosition('cross-1', 'LONG', 2_000_000, 1.0, 2, over),
    marginMode: 'cross', isolatedMargin: undefined,
  });

  function run(over: Record<string, unknown>) {
    localStorage.setItem(KEY('balance'), JSON.stringify(0));
    localStorage.setItem(KEY('positions_map'), JSON.stringify({ [SYMBOL]: [crossLong(over)] }));
    const view = mount(1.0);
    act(() => {
      view.result.current.markPriceAsOf(SYMBOL, SIM0, 0.58);
      view.result.current.setPriceMap({ [SYMBOL]: 0.58 });
    });
    const liquidations = view.result.current.tradeHistory.filter(t => t.action === 'LIQUIDATION');
    const details = view.result.current.liquidationDetails;
    stoppedUnmount(view);
    return Object.assign(liquidations, { details });
  }

  it('分层仓位：按档位的维持保证金判，爆仓；爆仓弹窗的维持保证金说明是「分层」', () => {
    const liquidations = run(TIERED);
    expect(liquidations.length).toBeGreaterThan(0);
    expect(liquidations.details).toMatchObject({ scope: 'cross', maintenance: 'tiered' });
  });

  it('更新前的仓位：仍按 0.4%，不爆', () => {
    expect(run({})).toHaveLength(0);
  });
});

// ───────────────────────── 复核第三轮 ─────────────────────────

describe('【复核 r3】真币本位的限价单按委托价折币：100% 的单成交后不会把仓位卡死在上限之外', () => {
  const btc = (contracts: number, over: Partial<PlaceOrderParams> = {}): PlaceOrderParams => ({
    ...coinMarket(contracts, { leverage: 125, settlementAsset: 'BTC', contractSizeUsd: 100, latestPrice: 100_000 }),
    ...over,
  });

  it('BTCUSD 125x（最高 5 BTC）、现价 100,000：买入限价 4,990 张 @90,000 被拒；4,500 张挂出，成交后正好 5 BTC，改杠杆不报卡死', () => {
    const view = mount(100_000, 'BTCUSDT');
    const { result } = view;
    act(() => result.current.setSymbolLeverage('BTCUSDT', 125));
    const error = vi.spyOn(toast, 'error');
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder('BTCUSDT', btc(4_990, { type: 'LIMIT', price: 90_000, priceSelection: 'LIMIT' })); });
    expect(placed).toBeNull();
    expect(errorTitles(error).at(-1)).toContain('125x 最高 5 BTC');
    const description = String((error.mock.calls.at(-1)?.[1] as { description?: string })?.description);
    expect(description).toContain('本单 5.54444444 BTC');

    act(() => { placed = result.current.handlePlaceOrder('BTCUSDT', btc(4_500, { type: 'LIMIT', price: 90_000, priceSelection: 'LIMIT' })); });
    expect(placed).not.toBeNull();
    const order = result.current.ordersMap.BTCUSDT[0];
    // 与 Index 的挂单成交路径相同：executeSettlementFill → settleFillDebit（不带 trigger）→ 建仓
    const fillAt = SIM0 + 60_000;
    const { fee, margin, position } = executeSettlementFill('BTCUSDT', 90_000, order, true, fillAt);
    let settled: boolean | null = null;
    act(() => { settled = result.current.settleFillDebit('BTCUSDT', order, margin, fee, fillAt); });
    expect(settled).toBe(true);
    act(() => {
      result.current.setOrdersMap(prev => ({ ...prev, BTCUSDT: [] }));
      result.current.setPositionsMap(prev => ({ ...prev, BTCUSDT: [position] }));
      result.current.setPriceMap({ BTCUSDT: 90_000 });
    });
    expect(position.riskModel).toBe('binance-tiers-v1');
    // 停在 125x：不是「现有敞口已超过上限、只能减仓」的死局
    let plan: ReturnType<typeof result.current.applySymbolLeverage> = null!;
    act(() => { plan = result.current.applySymbolLeverage('BTCUSDT', 125, 'coin'); });
    expect(plan.refusal?.code).toBe('no-change');
    expect(plan.tierExposure).toBeCloseTo(5, 9);
    stoppedUnmount(view);
  });
});

describe('【复核 r3】已挂的带戳条件单会在触发时被拒：下单与改杠杆都不拦，消息中心记一条', () => {
  const warnings = () => getNotificationSnapshot().entries.filter(e => e.level === 'warning');
  beforeEach(() => { __resetNotificationCenterForTests(); });
  afterEach(() => { __resetNotificationCenterForTests(); });

  it('KAITOUSDT 15x：空 20,000、多头条件单 20,000 @1.2；再市价空 5,000 → 照常成交，记一条预警；到 1.2 时那张条件单确实被撤', () => {
    const view = mount(1.0);
    const { result } = view;
    act(() => result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    act(() => result.current.setSymbolLeverage(SYMBOL, 15));
    act(() => { result.current.handlePlaceOrder(SYMBOL, usdtOrder(20_000, { side: 'SHORT' })); });
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(20_000, { side: 'LONG', type: 'CONDITIONAL', stopPrice: 1.2 })); });
    expect(placed).not.toBeNull();
    expect(warnings()).toHaveLength(0);

    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(5_000, { side: 'SHORT' })); });
    expect(placed).not.toBeNull();                                   // 币安不拦这一单
    expect(openPositions(result.current).find(p => p.side === 'SHORT')?.quantity).toBe(25_000);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].title)
      .toBe(`${SYMBOL}：这张单下出去后，已挂的做多条件单 ${formatPrice(1.2)} 触发时会因超出当前杠杆最高可持有头寸被拒`);
    expect(warnings()[0].description).toContain('= 54,000 USDT');

    // 不影响这张条件单的单子不预警
    act(() => { result.current.handlePlaceOrder(SYMBOL, usdtOrder(1, { side: 'LONG', type: 'LIMIT', price: 0.5, priceSelection: 'LIMIT' })); });
    expect(warnings()).toHaveLength(1);

    const stop = result.current.ordersMap[SYMBOL].find(o => o.type === 'CONDITIONAL')!;
    let settled: boolean | null = null;
    act(() => { settled = result.current.settleFillDebit(SYMBOL, stop, 1_600, 12, SIM0 + 60_000, { price: 1.2 }); });
    expect(settled).toBe(false);
    stoppedUnmount(view);
  });

  it('改杠杆：空 10,000 @20x + 多头止损对冲 11,000 @1.2；提到 25x 照常生效，记一条预警', () => {
    const view = mount(1.0);
    const { result } = view;
    act(() => result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    act(() => result.current.setSymbolLeverage(SYMBOL, 20));
    act(() => { result.current.handlePlaceOrder(SYMBOL, usdtOrder(10_000, { side: 'SHORT', leverage: 20 })); });
    act(() => { result.current.handlePlaceOrder(SYMBOL, usdtOrder(11_000, { side: 'LONG', type: 'CONDITIONAL', stopPrice: 1.2, leverage: 20 })); });
    expect(result.current.ordersMap[SYMBOL]).toHaveLength(1);
    let plan: ReturnType<typeof result.current.applySymbolLeverage> = null!;
    act(() => { plan = result.current.applySymbolLeverage(SYMBOL, 25, 'usdt'); });
    expect(plan).toMatchObject({ ok: true, to: 25 });
    expect(result.current.ordersMap[SYMBOL][0].leverage).toBe(25);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].title)
      .toBe(`${SYMBOL}：杠杆调到 25x 后，已挂的做多条件单 ${formatPrice(1.2)} 触发时会因超出当前杠杆最高可持有头寸被拒`);
    expect(warnings()[0].description).toContain('超过 25x 最高 25,000 USDT');
    stoppedUnmount(view);
  });
});

describe('【复核 r3】更新前的仓位超过新上限（币本位 KAITOUSD）：对冲照常下得出去，同侧加仓仍受限', () => {
  it('旧多仓 20,000 张 = 200,000 USD @20x、保存的杠杆 20x：空 1,000 张放行并开出对冲仓；多 1,000 张被拒', () => {
    const legacy = {
      id: 'legacy-coin', side: 'LONG', quantity: 20_000, contracts: 20_000, contractSizeUsd: 10,
      settlementMode: 'coin', settlementAsset: 'KAITO', entryPrice: 1, leverage: 20, openLeverage: 20,
      marginMode: 'isolated', margin: 10_000, isolatedMargin: 10_000, marginCoin: 10_000, openTime: SIM0 - 60_000,
    };
    localStorage.setItem(KEY('positions_map'), JSON.stringify({ [SYMBOL]: [legacy] }));
    localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ [SYMBOL]: 20 }));
    const view = mount(1.0);
    const { result } = view;
    expect(result.current.getSymbolSettlementMode(SYMBOL)).toBe('coin');
    const error = vi.spyOn(toast, 'error');
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, coinMarket(1_000, { side: 'SHORT', leverage: 20, latestPrice: 1 })); });
    expect(placed).not.toBeNull();
    const hedge = openPositions(result.current).find(p => p.side === 'SHORT')!;
    expect(hedge.contracts).toBe(1_000);
    // 只靠对冲豁免放行（现有敞口已超上限）：带豁免标记、按旧模型开（与它对冲的旧仓位同一个维持保证金模型）
    expect(hedge.riskModel).toBe('legacy-hedge-v1');

    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, coinMarket(1_000, { leverage: 20, latestPrice: 1 })); });
    expect(placed).toBeNull();
    const title = errorTitles(error).at(-1) ?? '';
    expect(title).toContain('现有持仓和当前委托价值 210,000 USD（含更新前按旧规则开的仓位）已超过');
    expect(title).toContain('反向开仓对冲更新前的仓位不受此限，最多 190,000 USD。');
    // 对冲超过旧仓位的名义（再空 19,001 张）同样不放行
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, coinMarket(19_001, { side: 'SHORT', leverage: 20, latestPrice: 1 })); });
    expect(placed).toBeNull();
    expect(errorTitles(error).at(-1)).toContain('这一单是反向对冲更新前的仓位，不受此限的额度最多 190,000 USD');
    stoppedUnmount(view);
  });
});

describe('【复核 r3】杠杆的保存：偏好的默认杠杆按两张合约里较高的上限存，读时各自夹', () => {
  it('BNBUSDT 写 50x（\'any\'）：币本位读 20x、U 本位读 50x；按结算方式写入照旧夹到那一张的上限', () => {
    const { result, unmount } = renderHook(() => useTradingContext(), { wrapper });
    act(() => result.current.setSymbolLeverage('BNBUSDT', 50, 'any'));
    expect(result.current.leverageMap.BNBUSDT).toBe(50);
    expect(result.current.getSymbolLeverage('BNBUSDT')).toBe(20);
    act(() => result.current.setSymbolSettlementMode('BNBUSDT', 'usdt'));
    expect(result.current.getSymbolLeverage('BNBUSDT')).toBe(50);
    act(() => result.current.setSymbolLeverage('BNBUSDT', 90, 'any'));
    expect(result.current.leverageMap.BNBUSDT).toBe(75);
    act(() => result.current.setSymbolLeverage('BNBUSDT', 60, 'coin'));
    expect(result.current.leverageMap.BNBUSDT).toBe(20);
    unmount();
  });

  it('保存的 125x（KAITO 最高 75x）、没有挂单：在 75x 上确认是「杠杆未变」，不改写保存值', () => {
    localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ [SYMBOL]: 125 }));
    const { result, unmount } = renderHook(() => useTradingContext(), { wrapper });
    act(() => { result.current.setPriceMap({ [SYMBOL]: 1 }); });
    let plan: ReturnType<typeof result.current.applySymbolLeverage> = null!;
    act(() => { plan = result.current.applySymbolLeverage(SYMBOL, 75, 'usdt'); });
    expect(plan.ok).toBe(false);
    expect(plan.refusal?.code).toBe('no-change');
    expect(plan.from).toBe(75);
    expect(result.current.leverageMap[SYMBOL]).toBe(125);
    unmount();
  });
});

describe('【复核 r3】逐仓强平的弹窗：维持保证金按被强平仓位的模型说明', () => {
  function liquidate(over: Record<string, unknown>) {
    const pos = storedUsdtPosition('iso-1', 'LONG', 60_000, 1.0, 10, over);
    localStorage.clear();
    localStorage.setItem(KEY('positions_map'), JSON.stringify({ [SYMBOL]: [pos] }));
    const view = mount(1.0);
    for (const [start, low] of [[SIM0, 1], [SIM0 + 60_000, 0.85]] as const) {
      act(() => {
        view.result.current.liquidateIsolatedOnCandle(SYMBOL, {
          high: 1, low, close: low, startTime: start, endTime: start + 60_000,
        });
      });
    }
    const details = view.result.current.liquidationDetails;
    const count = view.result.current.tradeHistory.filter(t => t.action === 'LIQUIDATION').length;
    stoppedUnmount(view);
    return { details, count };
  }

  it('分层仓位 → tiered；更新前的仓位 → legacy', () => {
    const tiered = liquidate(TIERED);
    expect(tiered.count).toBe(1);
    expect(tiered.details).toMatchObject({ scope: 'isolated', maintenance: 'tiered' });
    const legacy = liquidate({});
    expect(legacy.count).toBe(1);
    expect(legacy.details).toMatchObject({ scope: 'isolated', maintenance: 'legacy' });
  });
});

describe('【复核 r3】同一轮里两张 TWAP：引擎按前一张的新版本判后一张的切片', () => {
  /** 15x 最高 50,000：持仓 25,000（A 这一轮刚成交 1,000 已并进来），A 余 25,000（列表里还是旧版本），B 余 1,000。 */
  const twap = (id: string, filled: number) => ({
    id, side: 'LONG', type: 'TWAP', price: 0, stopPrice: 0, quantity: 25_000, leverage: 15,
    marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'ACTIVE', createdAt: SIM0 - 600_000,
    twapTotalQty: 25_000, twapFilledQty: filled, twapInterval: 60_000, twapNextExecTime: SIM0, twapEndTime: SIM0 + 600_000,
    ...TIERED,
  } as unknown as PendingOrder);

  it('带上前一张的新版本：25,000 + 24,000 + 1,000 = 50,000 放行；不带就按 51,000 误拒', () => {
    const a = twap('A', 0);
    const b = twap('B', 24_000);
    const aAfter = { ...a, twapFilledQty: 1_000 };
    const slice = { ...b, quantity: 1_000 } as PendingOrder;
    const run = (trigger: ReturnType<typeof twapSliceTrigger>) => {
      localStorage.clear();
      const view = seedAndMount({
        positions: [storedUsdtPosition('twap-pos', 'LONG', 25_000, 1.0, 15, TIERED)],
        orders: [a, b], leverage: 15, price: 1.0,
      });
      let settled: boolean | null = null;
      act(() => { settled = view.result.current.settleFillDebit(SYMBOL, b, 66, 0.5, SIM0, trigger); });
      stoppedUnmount(view);
      return settled;
    };
    expect(run(twapSliceTrigger(b, slice, 1.0, { updated: [aAfter] }))).toBe(true);
    expect(run(twapSliceTrigger(b, slice, 1.0))).toBe(false);
  });
});

// ───────────────────────── 修复验证第一轮 ─────────────────────────

describe('【复核 v1】只靠旧仓位对冲豁免放行的单：按旧模型开仓，价格不动不会被强平', () => {
  /** 价格原地不动的两根 K 线（±0.01%），接在开仓之后。 */
  const flatCandles = (view: { result: { current: ReturnType<typeof useTradingContext> } }, symbol: string, px: number) => {
    for (const start of [SIM0 + 60_000, SIM0 + 120_000]) {
      act(() => {
        view.result.current.liquidateIsolatedOnCandle(symbol, {
          high: px * 1.0001, low: px * 0.9999, close: px, startTime: start, endTime: start + 60_000,
        });
      });
    }
  };
  const liquidations = (ctx: ReturnType<typeof useTradingContext>) => ctx.tradeHistory.filter(t => t.action === 'LIQUIDATION');
  const openOn = (ctx: ReturnType<typeof useTradingContext>, symbol: string) =>
    (ctx.positionsMap[symbol] ?? []).filter(p => (p.contracts ?? p.quantity) > 0);

  it('KAITOUSD 旧多 20,000 张 @20x：市价空 20,000 张照常下出，空仓带豁免标记（旧模型），两根平 K 线后仍在', () => {
    const legacy = {
      id: 'legacy-coin', side: 'LONG', quantity: 20_000, contracts: 20_000, contractSizeUsd: 10,
      settlementMode: 'coin', settlementAsset: 'KAITO', entryPrice: 1, leverage: 20, openLeverage: 20,
      marginMode: 'isolated', margin: 10_000, isolatedMargin: 10_000, marginCoin: 10_000, openTime: SIM0 - 60_000,
    };
    localStorage.setItem(KEY('positions_map'), JSON.stringify({ [SYMBOL]: [legacy] }));
    localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ [SYMBOL]: 20 }));
    const view = mount(1.0);
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, coinMarket(20_000, { side: 'SHORT', leverage: 20, latestPrice: 1 })); });
    expect(placed).not.toBeNull();
    const hedge = openOn(view.result.current, SYMBOL).find(p => p.side === 'SHORT')!;
    expect(hedge.contracts).toBe(20_000);
    expect(hedge.riskModel).toBe('legacy-hedge-v1');
    flatCandles(view, SYMBOL, 1.0);
    expect(liquidations(view.result.current)).toHaveLength(0);
    expect(openOn(view.result.current, SYMBOL).map(p => p.side).sort()).toEqual(['LONG', 'SHORT']);
    stoppedUnmount(view);
  });

  it('API3USDT 旧多 40,000 @35x：市价空 40,000 照常下出、带豁免标记，两根平 K 线后仍在（带分层戳的话维持保证金 2,700 > 保证金 1,142.86）', () => {
    const view = seedAndMount({
      positions: [storedUsdtPosition('legacy-api3', 'LONG', 40_000, 1.0, 35)], symbol: 'API3USDT', leverage: 35,
    });
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder('API3USDT', usdtOrder(40_000, { side: 'SHORT', leverage: 35 })); });
    expect(placed).not.toBeNull();
    const hedge = openOn(view.result.current, 'API3USDT').find(p => p.side === 'SHORT')!;
    expect(hedge.quantity).toBe(40_000);
    expect(hedge.riskModel).toBe('legacy-hedge-v1');
    flatCandles(view, 'API3USDT', 1.0);
    expect(liquidations(view.result.current)).toHaveLength(0);
    expect(openOn(view.result.current, 'API3USDT')).toHaveLength(2);
    stoppedUnmount(view);
  });

  it('对照组：同样的空 40,000 @35x 若带着分层戳，一根平 K 线就被强平（这正是豁免单不能盖戳的原因）', () => {
    const view = seedAndMount({
      positions: [
        storedUsdtPosition('legacy-api3', 'LONG', 40_000, 1.0, 35),
        storedUsdtPosition('stamped-short', 'SHORT', 40_000, 1.0, 35, { riskModel: 'binance-tiers-v1', riskSymbol: 'API3USDT' }),
      ],
      symbol: 'API3USDT', leverage: 35,
    });
    flatCandles(view, 'API3USDT', 1.0);
    expect(liquidations(view.result.current).map(t => t.side)).toEqual(['SHORT']);
    stoppedUnmount(view);
  });

  it('没有旧仓位、正常放行的单照旧带戳：API3USDT 开空 100', () => {
    const view = seedAndMount({ positions: [], symbol: 'API3USDT', leverage: 35 });
    act(() => { view.result.current.handlePlaceOrder('API3USDT', usdtOrder(100, { side: 'SHORT', leverage: 35 })); });
    expect(openOn(view.result.current, 'API3USDT')[0].riskModel).toBe('binance-tiers-v1');
    stoppedUnmount(view);
  });

  it('条件单对冲（KAITOUSDT 旧多 200,000 @20x，空 200,000 @0.9）：挂出的委托带豁免标记；触发时旧仓位还在，豁免仍成立，这一笔按旧模型开、不爆', () => {
    const view = seedAndMount({ positions: [storedUsdtPosition('legacy-long', 'LONG', 200_000, 1.0, 20)], leverage: 20 });
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(200_000, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 0.9, leverage: 20 })); });
    expect(placed).not.toBeNull();
    const order = view.result.current.ordersMap[SYMBOL][0];
    expect(order.riskModel).toBe('legacy-hedge-v1');
    const { fee, margin, position } = executeSettlementFill(SYMBOL, 0.9, order, false, SIM0 + 30_000);
    let settled: boolean | null = null;
    act(() => { settled = view.result.current.settleFillDebit(SYMBOL, order, margin, fee, SIM0 + 30_000, { price: 0.9, position }); });
    expect(settled).toBe(true);
    expect(position).toMatchObject({ riskModel: 'legacy-hedge-v1', riskSymbol: SYMBOL });
    act(() => {
      view.result.current.setOrdersMap(prev => ({ ...prev, [SYMBOL]: [] }));
      view.result.current.setPositionsMap(prev => ({ ...prev, [SYMBOL]: [...(prev[SYMBOL] ?? []), position] }));
    });
    flatCandles(view, SYMBOL, 0.9);
    // 旧多仓 20x 在 0.9 自己会爆（跌了 10%），这里只看对冲这一边
    expect(liquidations(view.result.current).filter(t => t.side === 'SHORT')).toHaveLength(0);
    expect(openOn(view.result.current, SYMBOL).some(p => p.side === 'SHORT')).toBe(true);
    stoppedUnmount(view);
  });

  it('带戳的条件单触发时只靠豁免放行（后来提过杠杆等）：这一笔改盖豁免标记、按旧模型开，平 K 线后仍在；正常放行的照旧带戳', () => {
    // 旧多 200,000 @1.0 20x；带戳的空头对冲 200,000 @0.9（旧代码按豁免放行时盖了戳）。
    // 带戳成交的话：180,000 × 10% − 7,700 = 10,300 > 保证金 9,000，一根平 K 线就爆。
    const hedge = storedConditional('stamped-hedge', 'SHORT', 200_000, 0.9, 20, { riskModel: 'binance-tiers-v1' });
    const small = storedConditional('stamped-small', 'SHORT', 10_000, 0.9, 20, { riskModel: 'binance-tiers-v1' });
    const view = seedAndMount({
      positions: [storedUsdtPosition('legacy-long', 'LONG', 30_000, 1.0, 20)], orders: [small], leverage: 20, price: 0.9,
    });
    // 30,000 × 0.9 + 9,000 = 36,000 ≤ 50,000：正常放行，戳留着
    const smallFill = executeSettlementFill(SYMBOL, 0.9, small, false, SIM0 + 30_000);
    let settled: boolean | null = null;
    act(() => { settled = view.result.current.settleFillDebit(SYMBOL, small, smallFill.margin, smallFill.fee, SIM0 + 30_000, { price: 0.9, position: smallFill.position }); });
    expect(settled).toBe(true);
    expect(smallFill.position.riskModel).toBe('binance-tiers-v1');
    stoppedUnmount(view);

    localStorage.clear();
    const big = seedAndMount({
      positions: [storedUsdtPosition('legacy-long', 'LONG', 200_000, 1.0, 20)], orders: [hedge], leverage: 20, price: 0.9,
    });
    const fill = executeSettlementFill(SYMBOL, 0.9, hedge, false, SIM0 + 30_000);
    expect(fill.position.riskModel).toBe('binance-tiers-v1');
    act(() => { settled = big.result.current.settleFillDebit(SYMBOL, hedge, fill.margin, fill.fee, SIM0 + 30_000, { price: 0.9, position: fill.position }); });
    expect(settled).toBe(true);
    expect(fill.position.riskModel).toBe('legacy-hedge-v1');
    expect(fill.position.riskSymbol).toBe(SYMBOL);
    act(() => {
      big.result.current.setOrdersMap(prev => ({ ...prev, [SYMBOL]: [] }));
      big.result.current.setPositionsMap(prev => ({ ...prev, [SYMBOL]: [...(prev[SYMBOL] ?? []), fill.position] }));
    });
    flatCandles(big, SYMBOL, 0.9);
    // 旧多仓 20x 在 0.9 自己会爆（跌了 10%），这里只看对冲这一边
    expect(liquidations(big.result.current).filter(t => t.side === 'SHORT')).toHaveLength(0);
    expect(openOn(big.result.current, SYMBOL).some(p => p.side === 'SHORT')).toBe(true);
    stoppedUnmount(big);
  });

  it('U 本位：旧空 200,000 KAITO @20x，买入限价 250,000 @0.8 被拒（豁免按标记价比大小），200,000 @0.8 挂出并带豁免标记', () => {
    const view = seedAndMount({ positions: [storedUsdtPosition('legacy-short', 'SHORT', 200_000, 1.0, 20)], leverage: 20 });
    const error = vi.spyOn(toast, 'error');
    const limit = (qty: number) => usdtOrder(qty, { side: 'LONG', type: 'LIMIT', price: 0.8, priceSelection: 'LIMIT', leverage: 20 });
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, limit(250_000)); });
    expect(placed).toBeNull();
    expect(errorTitles(error).at(-1)).toContain('这一单是反向对冲更新前的仓位，不受此限的额度最多 200,000 USDT');
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, limit(200_000)); });
    expect(placed).not.toBeNull();
    expect(view.result.current.ordersMap[SYMBOL][0].riskModel).toBe('legacy-hedge-v1');
    stoppedUnmount(view);
  });
});

describe('【复核 v1】加仓计算器给的量：加完之后计划的对冲照样挂得上（引擎）', () => {
  const warnings = () => getNotificationSnapshot().entries.filter(e => e.level === 'warning');
  beforeEach(() => { __resetNotificationCenterForTests(); });
  afterEach(() => { __resetNotificationCenterForTests(); });
  const room = (ctx: ReturnType<typeof useTradingContext>, side: 'LONG' | 'SHORT', hedge: { price: number; mainCoins: number; existingCoins: number }) => addTierHeadroom({
    symbol: SYMBOL, settlement: 'usdt', side, storedLeverage: ctx.leverageMap[SYMBOL],
    positions: ctx.positionsMap[SYMBOL], orders: ctx.ordersMap[SYMBOL], markPrice: 1,
    orderKind: 'market', orderPrice: 1, fillPrice: 1.0001, contractFaceUsd: null, hedge,
  })!;
  /** 面板按两位小数向下取整预填。 */
  const floor2 = (v: number) => Math.floor(v * 100) / 100;

  it('KAITOUSDT 15x、多 10,000、S₁ = 0.9 还没有对冲：按计算器加仓后，合计对冲 X₁ + X₂ @0.9 下得出去', () => {
    const view = mount(1.0);
    const { result } = view;
    act(() => result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    act(() => result.current.setSymbolLeverage(SYMBOL, 15));
    act(() => { result.current.handlePlaceOrder(SYMBOL, usdtOrder(10_000)); });
    const r = room(result.current, 'LONG', { price: 0.9, mainCoins: 10_000, existingCoins: 0 });
    expect(r.coins).toBeCloseTo(30_900 / 1.9, 3);
    const add = floor2(r.coins);
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(add)); });
    expect(placed).not.toBeNull();
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(10_000 + add, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 0.9 })); });
    expect(placed).not.toBeNull();
    expect(result.current.ordersMap[SYMBOL]).toHaveLength(1);
    stoppedUnmount(view);
  });

  it('多 10,000 @0.8 + 已挂空头对冲 10,000 @0.9（现价 1.0）：计算器给约 16,263（不是 30,900），加完之后补挂 X₂ 的对冲下得出去', () => {
    const view = seedAndMount({
      positions: [storedUsdtPosition('main', 'LONG', 10_000, 0.8, 15, TIERED)],
      orders: [storedConditional('hedge', 'SHORT', 10_000, 0.9, 15, TIERED)],
      leverage: 15,
    });
    const { result } = view;
    const r = room(result.current, 'LONG', { price: 0.9, mainCoins: 10_000, existingCoins: 10_000 });
    expect(r.alone.coins).toBeCloseTo(30_900, 6);
    expect(r.coins).toBeGreaterThan(16_000);
    expect(r.coins).toBeLessThan(16_320);
    const add = floor2(r.coins);
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(add)); });
    expect(placed).not.toBeNull();
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(add, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 0.9 })); });
    expect(placed).not.toBeNull();
    stoppedUnmount(view);
  });

  it('空 20,000 + 带戳的多头止损对冲 20,000 @1.2：计算器给 833 而不是 5,900；加完不预警，补挂 X₂ 也下得出去，原对冲到 1.2 仍能成交', () => {
    const view = mount(1.0);
    const { result } = view;
    act(() => result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    act(() => result.current.setSymbolLeverage(SYMBOL, 15));
    act(() => { result.current.handlePlaceOrder(SYMBOL, usdtOrder(20_000, { side: 'SHORT' })); });
    act(() => { result.current.handlePlaceOrder(SYMBOL, usdtOrder(20_000, { side: 'LONG', type: 'CONDITIONAL', stopPrice: 1.2 })); });
    const r = room(result.current, 'SHORT', { price: 1.2, mainCoins: 20_000, existingCoins: 20_000 });
    expect(r.alone.coins).toBeCloseTo(5_900, 6);
    expect(r.coins).toBeCloseTo(2_000 / 2.4, 3);
    const add = floor2(r.coins);
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(add, { side: 'SHORT' })); });
    expect(placed).not.toBeNull();
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(add, { side: 'LONG', type: 'CONDITIONAL', stopPrice: 1.2 })); });
    expect(placed).not.toBeNull();
    expect(warnings()).toHaveLength(0);
    const original = result.current.ordersMap[SYMBOL].find(o => o.quantity === 20_000)!;
    let settled: boolean | null = null;
    act(() => { settled = result.current.settleFillDebit(SYMBOL, original, 1_600, 12, SIM0 + 60_000, { price: 1.2 }); });
    expect(settled).toBe(true);
    stoppedUnmount(view);
  });
});

// ───────────────────────── 复核第五轮 ─────────────────────────

type Ctx = ReturnType<typeof useTradingContext>;
type View = { result: { current: Ctx }; unmount: () => void };

/**
 * 按 Index 的撮合路径让一张挂单成交：executeSettlementFill → settleFillDebit（触发类与豁免单带上成交价与仓位）
 * → 并进持仓、从挂单里移走。返回闸门的结论与开出的仓位。
 */
function fillResting(view: View, symbol: string, orderId: string, price: number, time: number) {
  const order = (view.result.current.ordersMap[symbol] ?? []).find(o => o.id === orderId)!;
  expect(order).toBeDefined();
  act(() => { view.result.current.setPriceMap({ [symbol]: price }); });
  const isMaker = order.type === 'LIMIT' || order.type === 'POST_ONLY';
  const { fee, margin, position } = executeSettlementFill(symbol, price, order, isMaker, time);
  let settled: boolean | null = null;
  act(() => {
    settled = view.result.current.settleFillDebit(
      symbol, order, margin, fee, time,
      order.type === 'CONDITIONAL' || recheckedAtFill(order) ? { price, settledOrderIds: [order.id], position } : undefined,
    );
  });
  act(() => {
    view.result.current.setOrdersMap(prev => ({ ...prev, [symbol]: (prev[symbol] ?? []).filter(o => o.id !== orderId) }));
    if (settled) {
      view.result.current.setPositionsMap(prev => ({
        ...prev,
        [symbol]: mergeFilledPosition(symbol, (prev[symbol] ?? []).filter(isPositionOpen), position).positions,
      }));
    }
  });
  return { settled: settled as boolean | null, position };
}

/** 这一刻（价格 price）这个合约的持仓与挂单在不在当前杠杆的上限之内。 */
const withinCap = (ctx: Ctx, symbol: string, settlement: 'usdt' | 'coin', leverage: number, price: number) => checkOrderPositionLimit({
  symbol, settlement, leverage, positions: ctx.positionsMap[symbol] ?? [], orders: ctx.ordersMap[symbol] ?? [],
  markPrice: price, orderNotionalUsd: 0,
});

const cancelledIds = () => (JSON.parse(localStorage.getItem(KEY('cancelled_orders')) ?? '[]') as Array<{ id: string }>).map(c => c.id);
const noticeEntries = (level: string) => getNotificationSnapshot().entries.filter(e => e.level === level);

describe('【复核 r5】豁免单带显式标记：不当底、占额度，挂着的到时再判（引擎）', () => {
  beforeEach(() => { __resetNotificationCenterForTests(); });
  afterEach(() => { __resetNotificationCenterForTests(); });
  const legacyLong = () => storedUsdtPosition('legacy-long', 'LONG', 200_000, 1.0, 20);
  const legacyIndex = (ctx: Ctx) => (ctx.positionsMap[SYMBOL] ?? []).findIndex(p => p.id === 'legacy-long');

  it('旧多 200,000 @20x：市价空 200,000 对冲（豁免）→ 旧多平掉一半后，多 100,000 加回去被拒，空 1 也被拒', () => {
    const view = seedAndMount({ positions: [legacyLong()], leverage: 20 });
    const error = vi.spyOn(toast, 'error');
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(200_000, { side: 'SHORT', leverage: 20 })); });
    expect(placed).not.toBeNull();
    expect(openPositions(view.result.current).find(p => p.side === 'SHORT')?.riskModel).toBe('legacy-hedge-v1');
    act(() => { view.result.current.handleClosePosition(SYMBOL, legacyIndex(view.result.current), 0.5); });
    expect(openPositions(view.result.current).find(p => p.side === 'LONG')?.quantity).toBeCloseTo(100_000, 6);

    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(100_000, { leverage: 20 })); });
    expect(placed).toBeNull();
    expect(errorTitles(error).at(-1)).toContain('现有持仓和当前委托价值 300,000 USDT（含更新前按旧规则开的仓位）已超过');
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(1, { side: 'SHORT', leverage: 20 })); });
    expect(placed).toBeNull();
    expect(openPositions(view.result.current).find(p => p.side === 'LONG')?.quantity).toBeCloseTo(100_000, 6);
    stoppedUnmount(view);
  });

  it('旧多平掉之后：豁免空单不能给多单当底，多 200,000 被拒（不会开出一个超上限的新仓位）', () => {
    const view = seedAndMount({ positions: [legacyLong()], leverage: 20 });
    act(() => { view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(200_000, { side: 'SHORT', leverage: 20 })); });
    act(() => { view.result.current.handleClosePosition(SYMBOL, legacyIndex(view.result.current), 1); });
    expect(openPositions(view.result.current).map(p => p.side)).toEqual(['SHORT']);
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(200_000, { leverage: 20 })); });
    expect(placed).toBeNull();
    expect(openPositions(view.result.current).map(p => p.side)).toEqual(['SHORT']);
    stoppedUnmount(view);
  });

  it('【F6】豁免条件单挂着、旧多先平掉：到 0.9 触发时被拒并撤单留痕，不会开出裸空 200,000', () => {
    const view = seedAndMount({ positions: [legacyLong()], leverage: 20 });
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(200_000, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 0.9, leverage: 20 })); });
    expect(placed).not.toBeNull();
    const order = view.result.current.ordersMap[SYMBOL][0];
    expect(order.riskModel).toBe('legacy-hedge-v1');
    act(() => { view.result.current.handleClosePosition(SYMBOL, legacyIndex(view.result.current), 1); });
    expect(openPositions(view.result.current)).toHaveLength(0);
    // 委托列表的「触发时将超限」此刻就标出来
    expect(doomedAtTrigger(SYMBOL, order, view.result.current.positionsMap[SYMBOL], view.result.current.ordersMap[SYMBOL], 1)).not.toBeNull();

    const { settled } = fillResting(view, SYMBOL, order.id, 0.9, SIM0 + 60_000);
    expect(settled).toBe(false);
    expect(openPositions(view.result.current)).toHaveLength(0);
    expect(view.result.current.ordersMap[SYMBOL] ?? []).toHaveLength(0);
    expect(cancelledIds()).toContain(order.id);
    const refusal = noticeEntries('error').at(-1)!;
    expect(refusal.title).toBe('触发时超过杠杆分层上限，委托已撤销');
    expect(refusal.description).toContain('这一刻豁免已不成立');
    expect(refusal.description).toContain('20x 最高 50,000 USDT');
    stoppedUnmount(view);
  });

  it('豁免条件单挂着、旧多平掉后到时放得下（空 50,000 @0.9 = 45,000）：正常成交，开出的是分层仓位', () => {
    const view = seedAndMount({ positions: [storedUsdtPosition('legacy-long', 'LONG', 200_000, 1.0, 20)], leverage: 20 });
    // 这一单本身放得下，但现有敞口已超上限：只靠豁免放行
    act(() => { view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(50_000, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 0.9, leverage: 20 })); });
    const order = view.result.current.ordersMap[SYMBOL][0];
    expect(order.riskModel).toBe('legacy-hedge-v1');
    act(() => { view.result.current.handleClosePosition(SYMBOL, 0, 1); });
    const { settled, position } = fillResting(view, SYMBOL, order.id, 0.9, SIM0 + 60_000);
    expect(settled).toBe(true);
    expect(position).toMatchObject({ riskModel: 'binance-tiers-v1', riskSymbol: SYMBOL });
    expect(openPositions(view.result.current)[0].riskModel).toBe('binance-tiers-v1');
    stoppedUnmount(view);
  });

  it('豁免条件单挂着、旧多还在：到 0.9 触发照常按豁免成交，这一笔带豁免标记（旧模型）', () => {
    const view = seedAndMount({ positions: [legacyLong()], leverage: 20 });
    act(() => { view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(200_000, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 0.9, leverage: 20 })); });
    const order = view.result.current.ordersMap[SYMBOL][0];
    const { settled, position } = fillResting(view, SYMBOL, order.id, 0.9, SIM0 + 60_000);
    expect(settled).toBe(true);
    expect(position.riskModel).toBe('legacy-hedge-v1');
    stoppedUnmount(view);
  });

  it('【F6】豁免限价单挂着（买 200,000 @0.8 对冲旧空）、旧空先平掉：成交那一刻被拒并撤单留痕', () => {
    const view = seedAndMount({ positions: [storedUsdtPosition('legacy-short', 'SHORT', 200_000, 1.0, 20)], leverage: 20 });
    let placed: { id: string } | null = null;
    act(() => {
      placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(200_000, { side: 'LONG', type: 'LIMIT', price: 0.8, priceSelection: 'LIMIT', leverage: 20 }));
    });
    expect(placed).not.toBeNull();
    const order = view.result.current.ordersMap[SYMBOL][0];
    expect(order.riskModel).toBe('legacy-hedge-v1');
    expect(recheckedAtFill(order)).toBe(true);
    act(() => { view.result.current.handleClosePosition(SYMBOL, 0, 1); });
    const { settled } = fillResting(view, SYMBOL, order.id, 0.8, SIM0 + 60_000);
    expect(settled).toBe(false);
    expect(openPositions(view.result.current)).toHaveLength(0);
    expect(cancelledIds()).toContain(order.id);
    const refusal = noticeEntries('error').at(-1)!;
    expect(refusal.title).toBe('成交时超过杠杆分层上限，委托已撤销');
    expect(refusal.description).toContain('这一刻豁免已不成立');
    stoppedUnmount(view);
  });

  it('普通的分层限价单成交时不再判（与币安一致）：闸门不拿到成交价', () => {
    const view = seedAndMount({ positions: [], leverage: 20 });
    act(() => { view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(10_000, { type: 'LIMIT', price: 0.9, priceSelection: 'LIMIT', leverage: 20 })); });
    const order = view.result.current.ordersMap[SYMBOL][0];
    expect(order.riskModel).toBe('binance-tiers-v1');
    expect(recheckedAtFill(order)).toBe(false);
    stoppedUnmount(view);
  });

  it('【复现】豁免对冲不并进分层仓位：旧多 240,000 + 分层空 9,000（20x、现价 1.1），市价空 200,000（KAITOUSDT 单笔市价上限）靠豁免开出，单独成仓、按旧模型，消息中心说明', () => {
    const view = seedAndMount({
      positions: [
        storedUsdtPosition('legacy-long', 'LONG', 240_000, 1.0, 20),
        storedUsdtPosition('tiered-short', 'SHORT', 9_000, 1.1, 20, TIERED),
      ],
      leverage: 20,
      price: 1.1,
    });
    const warn = vi.spyOn(toast, 'warning');
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(200_000, { side: 'SHORT', leverage: 20, latestPrice: 1.1 })); });
    expect(placed).not.toBeNull();
    const shorts = openPositions(view.result.current).filter(p => p.side === 'SHORT');
    expect(shorts.map(p => [p.riskModel, Math.round(p.quantity)]).sort())
      .toEqual([['binance-tiers-v1', 9_000], ['legacy-hedge-v1', 200_000]]);
    const notice = warn.mock.calls.find(c => String(c[0]) === '未与现有仓位合并');
    expect(String((notice?.[1] as { description?: string })?.description)).toContain('靠对冲更新前仓位的豁免开的');
    stoppedUnmount(view);
  });

  it('【复核 r7】分层加仓并进更新前的仓位：旧多 30,000 @20x 上市价再多 10,000 → 一个仓位、整仓仍按旧模型、豁免的底冻在 30,000', () => {
    const view = seedAndMount({ positions: [storedUsdtPosition('legacy-small', 'LONG', 30_000, 1.0, 20)], leverage: 20 });
    const warn = vi.spyOn(toast, 'warning');
    const before = openPositions(view.result.current)[0];
    const liqBefore = calcLiquidationPrice(before, SYMBOL);
    act(() => { view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(10_000, { leverage: 20 })); });
    const longs = openPositions(view.result.current).filter(p => p.side === 'LONG');
    // 规则二：并成一个仓位；规则一：存活的沿用旧仓位的来源（没有戳 = 更新前的仓位）
    expect(longs).toHaveLength(1);
    expect(longs[0].id).toBe('legacy-small');
    expect(longs[0].riskModel).toBeUndefined();
    expect(Math.round(longs[0].quantity)).toBe(40_000);
    // 加权开仓价（这一刀按含滑点的成交价，所以只略高于 1.0）
    expect(longs[0].entryPrice).toBeCloseTo(before.entryPrice, 3);
    /**
     * 整仓仍按旧的 0.4%，不会有第二条只靠自己那点保证金硬扛的腿。
     * 同价同杠杆加仓时旧模型的强平价与开仓价成正比（LP = E·f(L, 0.4%)），所以比的是**比值**：
     * 比值不变 = 模型没换（换成分层的话这个比值会随名义跳档）。加仓价低于现价时 E 降、强平价才跟着被推远。
     */
    expect(calcLiquidationPrice(longs[0], SYMBOL) / longs[0].entryPrice)
      .toBeCloseTo(liqBefore / before.entryPrice, 12);
    expect(positionMaintenanceMarginUsd(SYMBOL, longs[0], 1))
      .toBeCloseTo(longs[0].quantity * 1 * 0.004, 9);
    // 合并了就没有「未与现有仓位合并」这条提示
    expect(warn.mock.calls.find(c => String(c[0]) === '未与现有仓位合并')).toBeUndefined();
    // 【规则四】豁免的底冻在加仓之前：仓位已经 40,000，反向仍然只有 30,000 的额度
    expect(longs[0].hedgeBaseUnits).toBeCloseTo(30_000, 6);
    let hedged: { id: string } | null = null;
    act(() => { hedged = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(30_000, { side: 'SHORT', leverage: 20 })); });
    expect(hedged).not.toBeNull();
    expect(openPositions(view.result.current).find(p => p.side === 'SHORT')?.riskModel).toBe('legacy-hedge-v1');
    let tooBig: { id: string } | null = null;
    act(() => { tooBig = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(1_000, { side: 'SHORT', leverage: 20 })); });
    expect(tooBig).toBeNull();
    stoppedUnmount(view);
  });
});

describe('【复核 r5】计算器给的量：挂上加仓与补挂的对冲，价格走过两道触发，没有拒单、没有超限（引擎）', () => {
  beforeEach(() => { __resetNotificationCenterForTests(); });
  afterEach(() => { __resetNotificationCenterForTests(); });
  const floor2 = (v: number) => Math.floor(v * 100) / 100;

  it('【F1】U 本位回调限价加仓：空 10,000 @15x、卖出限价 @1.05、S₁ 1.15', () => {
    const view = mount(1.0);
    const { result } = view;
    act(() => result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    act(() => result.current.setSymbolLeverage(SYMBOL, 15));
    act(() => { result.current.handlePlaceOrder(SYMBOL, usdtOrder(10_000, { side: 'SHORT' })); });
    const r = addTierHeadroom({
      symbol: SYMBOL, settlement: 'usdt', side: 'SHORT', storedLeverage: result.current.leverageMap[SYMBOL],
      positions: result.current.positionsMap[SYMBOL], orders: result.current.ordersMap[SYMBOL], markPrice: 1,
      orderKind: 'limit', orderPrice: 1.05, fillPrice: 1.05, contractFaceUsd: null,
      hedge: { price: 1.15, mainCoins: 10_000, existingCoins: 0 },
    })!;
    expect(r.coins).toBeCloseTo(50_000 / 2.3 - 10_000, 3);
    const add = floor2(r.coins);
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(add, { side: 'SHORT', type: 'LIMIT', price: 1.05, priceSelection: 'LIMIT' })); });
    expect(placed).not.toBeNull();
    const addId = placed!.id;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(10_000 + add, { side: 'LONG', type: 'CONDITIONAL', stopPrice: 1.15 })); });
    expect(placed).not.toBeNull();
    const hedgeId = placed!.id;
    expect(noticeEntries('warning')).toHaveLength(0);
    const hedge = result.current.ordersMap[SYMBOL].find(o => o.id === hedgeId)!;
    expect(doomedAtTrigger(SYMBOL, hedge, result.current.positionsMap[SYMBOL], result.current.ordersMap[SYMBOL], 1)).toBeNull();

    expect(fillResting(view, SYMBOL, addId, 1.05, SIM0 + 60_000).settled).toBe(true);
    expect(withinCap(result.current, SYMBOL, 'usdt', 15, 1.05)).toMatchObject({ ok: true, reason: 'ok' });
    expect(fillResting(view, SYMBOL, hedgeId, 1.15, SIM0 + 120_000).settled).toBe(true);
    const atS1 = withinCap(result.current, SYMBOL, 'usdt', 15, 1.15);
    expect(atS1).toMatchObject({ ok: true, reason: 'ok' });
    expect(atS1.exposureBefore).toBeLessThanOrEqual(50_000);
    expect(noticeEntries('error')).toHaveLength(0);
    stoppedUnmount(view);
  });

  it('【F1】真币本位回调限价加仓：BTCUSD 125x、多 1,000 张、买入限价 @98,000、S₁ 90,000', () => {
    const btc = 'BTCUSDT';
    const view = mount(100_000, btc);
    const { result } = view;
    act(() => result.current.setSymbolLeverage(btc, 125, 'coin'));
    const btcOrder = (contracts: number, over: Partial<PlaceOrderParams> = {}) => coinMarket(contracts, {
      leverage: 125, contractSizeUsd: 100, settlementAsset: 'BTC', latestPrice: 100_000, ...over,
    });
    act(() => { result.current.handlePlaceOrder(btc, btcOrder(1_000)); });
    expect(openPositions({ ...result.current, positionsMap: { [SYMBOL]: result.current.positionsMap[btc] } } as Ctx)).toHaveLength(1);
    const main = result.current.positionsMap[btc][0];
    const mainCoins = (1_000 * 100) / main.entryPrice;
    const r = addTierHeadroom({
      symbol: btc, settlement: 'coin', side: 'LONG', storedLeverage: result.current.leverageMap[btc],
      positions: result.current.positionsMap[btc], orders: result.current.ordersMap[btc], markPrice: 100_000,
      orderKind: 'limit', orderPrice: 98_000, fillPrice: 98_000, contractFaceUsd: 100,
      hedge: { price: 90_000, mainCoins, existingCoins: 0 },
    })!;
    expect(r.contracts!).toBeLessThan(1_415);
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder(btc, btcOrder(r.contracts!, { type: 'LIMIT', price: 98_000, priceSelection: 'LIMIT' })); });
    expect(placed).not.toBeNull();
    const addId = placed!.id;
    act(() => { placed = result.current.handlePlaceOrder(btc, btcOrder(r.hedge!.contracts!, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 90_000 })); });
    expect(placed).not.toBeNull();
    const hedgeId = placed!.id;
    expect(noticeEntries('warning')).toHaveLength(0);

    expect(fillResting(view, btc, addId, 98_000, SIM0 + 60_000).settled).toBe(true);
    expect(withinCap(result.current, btc, 'coin', 125, 98_000)).toMatchObject({ ok: true, reason: 'ok' });
    expect(fillResting(view, btc, hedgeId, 90_000, SIM0 + 120_000).settled).toBe(true);
    const atS1 = withinCap(result.current, btc, 'coin', 125, 90_000);
    expect(atS1).toMatchObject({ ok: true, reason: 'ok' });
    expect(atS1.exposureBefore).toBeLessThanOrEqual(5);
    expect(noticeEntries('error')).toHaveLength(0);
    stoppedUnmount(view);
  });

  /** U 本位 KAITOUSDT 15x、多 10,000：按计算器给的量挂上突破加仓 @1.2 与 S₁ 0.9 上的对冲，按给定的先后走两道触发。 */
  function breakoutPlan(sequence: 'add-first' | 'hedge-first') {
    const view = mount(1.0);
    const { result } = view;
    act(() => result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    act(() => result.current.setSymbolLeverage(SYMBOL, 15));
    act(() => { result.current.handlePlaceOrder(SYMBOL, usdtOrder(10_000)); });
    const r = addTierHeadroom({
      symbol: SYMBOL, settlement: 'usdt', side: 'LONG', storedLeverage: result.current.leverageMap[SYMBOL],
      positions: result.current.positionsMap[SYMBOL], orders: result.current.ordersMap[SYMBOL], markPrice: 1,
      orderKind: 'conditional', orderPrice: 1.2, fillPrice: 1.2, contractFaceUsd: null,
      hedge: { price: 0.9, mainCoins: 10_000, existingCoins: 0 },
    })!;
    // 两种先后里「先跌到 0.9、对冲成交，再涨到 1.2」更紧：12,000 + 1.2 × (10,000 + X) + 1.2X ≤ 50,000
    expect(r.coins).toBeCloseTo(26_000 / 2.4, 3);
    const add = floor2(r.coins);
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(add, { type: 'CONDITIONAL', stopPrice: 1.2 })); });
    expect(placed).not.toBeNull();
    const addId = placed!.id;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(10_000 + add, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 0.9 })); });
    expect(placed).not.toBeNull();
    const hedgeId = placed!.id;
    expect(noticeEntries('warning')).toHaveLength(0);
    for (const order of result.current.ordersMap[SYMBOL]) {
      expect(doomedAtTrigger(SYMBOL, order, result.current.positionsMap[SYMBOL], result.current.ordersMap[SYMBOL], 1)).toBeNull();
    }
    const steps = sequence === 'add-first'
      ? [[addId, 1.2], [hedgeId, 0.9]] as const
      : [[hedgeId, 0.9], [addId, 1.2]] as const;
    steps.forEach(([id, price], i) => {
      expect(fillResting(view, SYMBOL, id, price, SIM0 + 60_000 * (i + 1)).settled).toBe(true);
      expect(withinCap(result.current, SYMBOL, 'usdt', 15, price)).toMatchObject({ ok: true, reason: 'ok' });
    });
    expect(openPositions(result.current).map(p => [p.side, Math.round(p.quantity)]).sort())
      .toEqual([['LONG', Math.round(10_000 + add)], ['SHORT', Math.round(10_000 + add)]]);
    expect(noticeEntries('error')).toHaveLength(0);
    stoppedUnmount(view);
  }

  it('【F2】突破加仓：多 10,000 @15x、加仓条件单 @1.2、S₁ 0.9——挂上不预警；先突破再跌回 0.9，两道触发都成交', () => {
    breakoutPlan('add-first');
  });

  it('【复现】突破加仓的另一种先后：先跌到 0.9、对冲成交（锁住），再涨到 1.2 加仓也成交——不会剩下净空', () => {
    breakoutPlan('hedge-first');
  });

  it('【复现】只算「先突破」的 13,809.52：先跌到 0.9 对冲成交，再涨到 1.2 加仓被撤，账户净空；挂对冲时就预警这一种先后', () => {
    const view = mount(1.0);
    const { result } = view;
    act(() => result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    act(() => result.current.setSymbolLeverage(SYMBOL, 15));
    act(() => { result.current.handlePlaceOrder(SYMBOL, usdtOrder(10_000)); });
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(13_809.52, { type: 'CONDITIONAL', stopPrice: 1.2 })); });
    const addId = placed!.id;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(23_809.52, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 0.9 })); });
    expect(placed).not.toBeNull();
    const hedgeId = placed!.id;
    expect(noticeEntries('warning').map(w => w.title)).toEqual([
      `${SYMBOL}：这张单下出去后，已挂的做多条件单 ${formatPrice(1.2)}（价格先到 ${formatPrice(0.9)} 再回来时）触发时会因超出当前杠杆最高可持有头寸被拒`,
    ]);
    const add = result.current.ordersMap[SYMBOL].find(o => o.id === addId)!;
    expect(doomedAtTrigger(SYMBOL, add, result.current.positionsMap[SYMBOL], result.current.ordersMap[SYMBOL], 1)?.via).toBe(0.9);
    expect(fillResting(view, SYMBOL, hedgeId, 0.9, SIM0 + 60_000).settled).toBe(true);
    expect(fillResting(view, SYMBOL, addId, 1.2, SIM0 + 120_000).settled).toBe(false);
    expect(cancelledIds()).toContain(addId);
    expect(openPositions(result.current).map(p => [p.side, Math.round(p.quantity)]).sort())
      .toEqual([['LONG', 10_000], ['SHORT', 23_810]]);
    stoppedUnmount(view);
  });

  it('【复现】真币本位突破加仓：BTCUSD 125x、多 1,000 张、加仓条件单 @110,000、S₁ 95,000——计算器的量两种先后都成交；1,621 张挂上对冲时就预警', () => {
    const btc = 'BTCUSDT';
    const run = (units: number | null, sequence: 'add-first' | 'hedge-first') => {
      __resetNotificationCenterForTests();
      localStorage.clear();
      const view = mount(100_000, btc);
      const { result } = view;
      act(() => result.current.setSymbolLeverage(btc, 125, 'coin'));
      const btcOrder = (contracts: number, over: Partial<PlaceOrderParams> = {}) => coinMarket(contracts, {
        leverage: 125, contractSizeUsd: 100, settlementAsset: 'BTC', latestPrice: 100_000, ...over,
      });
      act(() => { result.current.handlePlaceOrder(btc, btcOrder(1_000)); });
      const main = result.current.positionsMap[btc][0];
      const mainCoins = (1_000 * 100) / main.entryPrice;
      const r = addTierHeadroom({
        symbol: btc, settlement: 'coin', side: 'LONG', storedLeverage: result.current.leverageMap[btc],
        positions: result.current.positionsMap[btc], orders: result.current.ordersMap[btc], markPrice: 100_000,
        orderKind: 'conditional', orderPrice: 110_000, fillPrice: 110_000, contractFaceUsd: 100,
        hedge: { price: 95_000, mainCoins, existingCoins: 0 },
      })!;
      expect(r.contracts!).toBeLessThanOrEqual(1_502);
      const addUnits = units ?? r.contracts!;
      const hedgeUnits = Math.ceil(((mainCoins + (addUnits * 100) / 110_000) * 95_000) / 100 - 1e-9);
      let placed: { id: string } | null = null;
      act(() => { placed = result.current.handlePlaceOrder(btc, btcOrder(addUnits, { type: 'CONDITIONAL', stopPrice: 110_000 })); });
      const addId = placed!.id;
      act(() => { placed = result.current.handlePlaceOrder(btc, btcOrder(hedgeUnits, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 95_000 })); });
      expect(placed).not.toBeNull();
      const hedgeId = placed!.id;
      const warnings = noticeEntries('warning').map(w => w.title);
      const steps = sequence === 'add-first'
        ? [[addId, 110_000], [hedgeId, 95_000]] as const
        : [[hedgeId, 95_000], [addId, 110_000]] as const;
      const settled = steps.map(([id, price], i) => fillResting(view, btc, id, price, SIM0 + 60_000 * (i + 1)).settled);
      const capOk = withinCap(result.current, btc, 'coin', 125, steps[1][1]).ok;
      stoppedUnmount(view);
      return { warnings, settled, capOk, hedgeUnits };
    };
    for (const sequence of ['add-first', 'hedge-first'] as const) {
      const planned = run(null, sequence);
      expect(planned.warnings).toEqual([]);
      expect(planned.settled).toEqual([true, true]);
      expect(planned.capOk).toBe(true);
    }
    const greedy = run(1_621, 'add-first');
    expect(greedy.hedgeUnits).toBe(2_350);
    expect(greedy.warnings).toEqual([
      `${btc}：这张单下出去后，这张单自己（做空条件单 ${formatPrice(95_000)}，价格先到 ${formatPrice(110_000)} 再回来时）触发时也会因超出当前杠杆最高可持有头寸被拒`,
    ]);
    expect(greedy.settled).toEqual([true, false]);
  });

  it('【复现】U 本位空仓跌破加仓：KAITOUSDT 5x、空 100,000、卖出条件单 @0.8、S₁ 1.05——计算器给 19,047.62，两种先后都成交；旧口径的 21,621.62 挂对冲时就预警、先跌破之后对冲被撤', () => {
    const run = (units: number | null, sequence: 'add-first' | 'hedge-first') => {
      __resetNotificationCenterForTests();
      localStorage.clear();
      const view = mount(1.0);
      const { result } = view;
      act(() => result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
      act(() => result.current.setSymbolLeverage(SYMBOL, 5));
      act(() => { result.current.handlePlaceOrder(SYMBOL, usdtOrder(100_000, { side: 'SHORT', leverage: 5 })); });
      const r = addTierHeadroom({
        symbol: SYMBOL, settlement: 'usdt', side: 'SHORT', storedLeverage: result.current.leverageMap[SYMBOL],
        positions: result.current.positionsMap[SYMBOL], orders: result.current.ordersMap[SYMBOL], markPrice: 1,
        orderKind: 'conditional', orderPrice: 0.8, fillPrice: 0.8, contractFaceUsd: null,
        hedge: { price: 1.05, mainCoins: 100_000, existingCoins: 0 },
      })!;
      // 先跌破、加仓成交，再涨到 1.05：1.05 × (100,000 + X) × 2 ≤ 250,000
      expect(r.coins).toBeCloseTo(250_000 / 2.1 - 100_000, 3);
      const add = units ?? floor2(r.coins);
      let placed: { id: string } | null = null;
      act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(add, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 0.8, leverage: 5 })); });
      expect(placed).not.toBeNull();
      const addId = placed!.id;
      act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(100_000 + add, { side: 'LONG', type: 'CONDITIONAL', stopPrice: 1.05, leverage: 5 })); });
      expect(placed).not.toBeNull();
      const hedgeId = placed!.id;
      const warnings = noticeEntries('warning').map(w => w.title);
      const steps = sequence === 'add-first'
        ? [[addId, 0.8], [hedgeId, 1.05]] as const
        : [[hedgeId, 1.05], [addId, 0.8]] as const;
      const settled: Array<boolean | null> = [];
      const capOk: boolean[] = [];
      steps.forEach(([id, price], i) => {
        settled.push(fillResting(view, SYMBOL, id, price, SIM0 + 60_000 * (i + 1)).settled);
        capOk.push(withinCap(result.current, SYMBOL, 'usdt', 5, price).ok);
      });
      const sides = openPositions(result.current).map(p => [p.side, Math.round(p.quantity)]).sort();
      const cancelled = cancelledIds();
      stoppedUnmount(view);
      return { warnings, settled, capOk, sides, cancelled, addId, hedgeId };
    };
    for (const sequence of ['add-first', 'hedge-first'] as const) {
      const planned = run(null, sequence);
      expect(planned.warnings).toEqual([]);
      expect(planned.settled).toEqual([true, true]);
      expect(planned.capOk).toEqual([true, true]);
    }
    const greedy = run(21_621.62, 'add-first');
    expect(greedy.warnings).toEqual([
      `${SYMBOL}：这张单下出去后，这张单自己（做多条件单 ${formatPrice(1.05)}，价格先到 ${formatPrice(0.8)} 再回来时）触发时也会因超出当前杠杆最高可持有头寸被拒`,
    ]);
    // 先跌破、加仓成交；涨到 1.05 时对冲被撤：留下的是没有对冲的空 121,621.62
    expect(greedy.settled).toEqual([true, false]);
    expect(greedy.cancelled).toContain(greedy.hedgeId);
    expect(greedy.sides).toEqual([['SHORT', 121_622]]);
  });

  it('【F2】旧口径的 14,714.28：先挂加仓、再挂对冲时消息中心预警加仓单到 1.2 会被拒，到时确实被撤并留痕', () => {
    const view = mount(1.0);
    const { result } = view;
    act(() => result.current.setSymbolSettlementMode(SYMBOL, 'usdt'));
    act(() => result.current.setSymbolLeverage(SYMBOL, 15));
    act(() => { result.current.handlePlaceOrder(SYMBOL, usdtOrder(10_000)); });
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(14_714.28, { type: 'CONDITIONAL', stopPrice: 1.2 })); });
    const addId = placed!.id;
    act(() => { placed = result.current.handlePlaceOrder(SYMBOL, usdtOrder(24_714.28, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 0.9 })); });
    expect(placed).not.toBeNull();
    expect(noticeEntries('warning').map(w => w.title))
      .toEqual([`${SYMBOL}：这张单下出去后，已挂的做多条件单 ${formatPrice(1.2)} 触发时会因超出当前杠杆最高可持有头寸被拒`]);
    expect(fillResting(view, SYMBOL, addId, 1.2, SIM0 + 60_000).settled).toBe(false);
    expect(cancelledIds()).toContain(addId);
    stoppedUnmount(view);
  });
});

describe('【复核 r5】限价单：成交之后仓位不超上限（引擎）', () => {
  it('【F3】BTCUSD 125x、多 2,000 张：买入限价 2,501 张 @90,000 被拒（按委托价成交那一刻），2,500 张放行、成交后 5 BTC', () => {
    const btc = 'BTCUSDT';
    const view = mount(100_000, btc);
    const { result } = view;
    act(() => result.current.setSymbolLeverage(btc, 125, 'coin'));
    const btcOrder = (contracts: number, over: Partial<PlaceOrderParams> = {}) => coinMarket(contracts, {
      leverage: 125, contractSizeUsd: 100, settlementAsset: 'BTC', latestPrice: 100_000, ...over,
    });
    act(() => { result.current.handlePlaceOrder(btc, btcOrder(2_000)); });
    const error = vi.spyOn(toast, 'error');
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder(btc, btcOrder(2_501, { type: 'LIMIT', price: 90_000, priceSelection: 'LIMIT' })); });
    expect(placed).toBeNull();
    expect(errorTitles(error).at(-1)).toContain(`按委托价 ${formatPrice(90_000)} 成交那一刻估值：`);
    act(() => { placed = result.current.handlePlaceOrder(btc, btcOrder(2_500, { type: 'LIMIT', price: 90_000, priceSelection: 'LIMIT' })); });
    expect(placed).not.toBeNull();
    expect(fillResting(view, btc, placed!.id, 90_000, SIM0 + 60_000).settled).toBe(true);
    const after = withinCap(result.current, btc, 'coin', 125, 90_000);
    expect(after).toMatchObject({ ok: true, reason: 'ok' });
    expect(after.exposureBefore).toBeCloseTo(5, 9);
    let plan: ReturnType<typeof result.current.applySymbolLeverage> = null!;
    act(() => { plan = result.current.applySymbolLeverage(btc, 125, 'coin'); });
    expect(plan.refusal?.code).toBe('no-change');
    stoppedUnmount(view);
  });

  it('【F4】BTCUSD 125x、没有持仓：穿价的买入限价 5,005 张 @100,100 被拒（按现价估值 5.005 BTC），4,990 张放行、下一根成交后 4.99 BTC', () => {
    const btc = 'BTCUSDT';
    const view = mount(100_000, btc);
    const { result } = view;
    act(() => result.current.setSymbolLeverage(btc, 125, 'coin'));
    const limit = (contracts: number) => coinMarket(contracts, {
      leverage: 125, contractSizeUsd: 100, settlementAsset: 'BTC', latestPrice: 100_000,
      type: 'LIMIT', price: 100_100, priceSelection: 'LIMIT',
    });
    let placed: { id: string } | null = null;
    act(() => { placed = result.current.handlePlaceOrder(btc, limit(5_005)); });
    expect(placed).toBeNull();
    act(() => { placed = result.current.handlePlaceOrder(btc, limit(4_990)); });
    expect(placed).not.toBeNull();
    // 下一根 K 线按委托价成交；成交后持仓按标记价估值
    expect(fillResting(view, btc, placed!.id, 100_100, SIM0 + 60_000).settled).toBe(true);
    act(() => { result.current.setPriceMap({ [btc]: 100_000 }); });
    expect(withinCap(result.current, btc, 'coin', 125, 100_000)).toMatchObject({ ok: true, reason: 'ok' });
    stoppedUnmount(view);
  });

  it('【F4】U 本位：穿价的卖出限价 @0.95（现价 1.0）按现价估值——50,001 个币被拒，50,000 放行', () => {
    const view = seedAndMount({ positions: [], leverage: 15 });
    const sell = (qty: number) => usdtOrder(qty, { side: 'SHORT', type: 'LIMIT', price: 0.95, priceSelection: 'LIMIT' });
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, sell(50_001)); });
    expect(placed).toBeNull();
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, sell(50_000)); });
    expect(placed).not.toBeNull();
    stoppedUnmount(view);
  });
});
