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
import { toast } from '@/lib/notificationCenter';
import type { PendingOrder } from '@/types/trading';

/**
 * 引擎自己的单笔数量上限闸门（币安 -4005 Quantity greater than max quantity），走真实的 TradingProvider：
 * 下单时拒、触发 / 执行时再判（撤单留痕、消息中心说清，不悄悄丢掉保护），豁免强平与平掉整个仓位的止盈止损。
 */

const T0 = Date.parse('2026-09-23T00:00:00Z');
const SIM0 = Date.parse('2025-03-01T08:00:00Z');
const SYMBOL = 'KAITOUSDT';
const KEY = (k: string) => `sim_anon_${k}`;

const wrapper = ({ children }: { children: React.ReactNode }) => <TradingProvider>{children}</TradingProvider>;
type View = { result: { current: ReturnType<typeof useTradingContext> }; unmount: () => void };

function mount(price = 1, symbol = SYMBOL): View {
  const view = renderHook(() => useTradingContext(), { wrapper });
  act(() => { view.result.current.setPriceMap({ [symbol]: price }); });
  act(() => {
    view.result.current.forkReplayTimeline(symbol, 'start', SIM0);
    view.result.current.sim.startSimulation(SIM0);
  });
  return view;
}

function seedAndMount({ positions = [], orders = [], price = 1, symbol = SYMBOL }: {
  positions?: unknown[]; orders?: unknown[]; price?: number; symbol?: string;
}): View {
  localStorage.setItem(KEY('positions_map'), JSON.stringify(positions.length ? { [symbol]: positions } : {}));
  localStorage.setItem(KEY('orders_map'), JSON.stringify(orders.length ? { [symbol]: orders } : {}));
  return mount(price, symbol);
}

const stop = (view: View) => {
  act(() => view.result.current.sim.stopSimulation());
  view.unmount();
};

/** U 本位单，数量是币。 */
const usdtOrder = (quantity: number, over: Partial<PlaceOrderParams> = {}): PlaceOrderParams => ({
  side: 'LONG', type: 'MARKET', price: 0, stopPrice: 0, quantity, leverage: 2, marginMode: 'isolated',
  priceSelection: 'MARKET', triggerType: 'LAST', currencyUnit: 'BASE', usdtInputMode: 'ORDER_VALUE',
  inputAmount: quantity, settlementMode: 'usdt', settlementAsset: 'USDT', latestPrice: 1,
  ...over,
});

/** 币本位单，数量是张（KAITO 没有币安币本位合约：合成的 KAITOUSD，面值 10）。 */
const coinOrder = (contracts: number, over: Partial<PlaceOrderParams> = {}): PlaceOrderParams => ({
  side: 'LONG', type: 'MARKET', price: 0, stopPrice: 0, quantity: contracts, contracts, leverage: 2,
  marginMode: 'isolated', priceSelection: 'MARKET', triggerType: 'LAST', currencyUnit: 'BASE',
  usdtInputMode: 'ORDER_VALUE', inputAmount: contracts, settlementMode: 'coin', settlementAsset: 'KAITO',
  contractSizeUsd: 10, latestPrice: 1.0905,
  ...over,
});

const storedUsdtPosition = (id: string, quantity: number, entryPrice = 1, leverage = 10) => {
  const margin = (quantity * entryPrice) / leverage;
  return {
    id, side: 'LONG', quantity, entryPrice, leverage, openLeverage: leverage, marginMode: 'isolated',
    settlementMode: 'usdt', settlementAsset: 'USDT', margin, isolatedMargin: margin, openTime: SIM0 - 60_000,
  };
};

const errorCalls = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map(call => ({
  title: String(call[0]),
  description: String((call[1] as { description?: string } | undefined)?.description ?? ''),
}));
const openPositions = (view: View, symbol = SYMBOL) =>
  (view.result.current.positionsMap[symbol] ?? []).filter(p => (p.contracts ?? p.quantity) > 0);
const cancelledIds = () => (JSON.parse(localStorage.getItem(KEY('cancelled_orders')) ?? '[]') as { id: string }[]).map(c => c.id);

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

describe('下单时：超过单笔上限就下不出去', () => {
  it('U 本位市价单：250,000 KAITO 被拒（写明上限与出路）、不建仓不扣钱；200,000 恰好放行', () => {
    const view = mount(1);
    const error = vi.spyOn(toast, 'error');
    const before = view.result.current.balance;
    let placed: unknown = 'untouched';
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(250_000)); });
    expect(placed).toBeNull();
    expect(openPositions(view)).toHaveLength(0);
    expect(view.result.current.balance).toBe(before);
    expect(errorCalls(error).at(-1)).toEqual({
      title: '单笔市价单最多 200,000 KAITO，这一单 250,000 KAITO',
      description: '币安 KAITOUSDT 的市价单单笔上限（快照 2026-09-23）。请拆成几笔市价单，或改用限价单（限价单单笔最多 2,000,000 KAITO）。',
    });

    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(200_000)); });
    expect(placed).not.toBeNull();
    expect(openPositions(view).map(p => p.quantity)).toEqual([200_000]);
    stop(view);
  });

  it('下单面板「平仓」档的反向市价单同样受限（它反向开一笔新仓位）', () => {
    const view = mount(1);
    let placed: unknown = 'untouched';
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(200_001, { side: 'SHORT' })); });
    expect(placed).toBeNull();
    stop(view);
  });

  it('币安上线的币本位（BTCUSD_PERP）按张：60,001 张被拒', () => {
    const view = mount(60_000, 'BTCUSDT');
    const error = vi.spyOn(toast, 'error');
    let placed: unknown = 'untouched';
    act(() => {
      placed = view.result.current.handlePlaceOrder('BTCUSDT', coinOrder(60_001, {
        settlementAsset: 'BTC', contractSizeUsd: 100, latestPrice: 60_000,
      }));
    });
    expect(placed).toBeNull();
    expect(errorCalls(error).at(-1)?.title).toBe('单笔市价单最多 60,000 张，这一单 60,001 张');
    stop(view);
  });

  it('合成币本位 KAITOUSD @1.0905：21,811 张被拒（借 KAITOUSDT 的 200,000 KAITO 按价折张），21,810 张放行', () => {
    const view = mount(1.0905);
    const error = vi.spyOn(toast, 'error');
    let placed: unknown = 'untouched';
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, coinOrder(21_811)); });
    expect(placed).toBeNull();
    const last = errorCalls(error).at(-1)!;
    expect(last.title).toBe('单笔市价单最多 21,810 张，这一单 21,811 张');
    expect(last.description).toContain('币安无 KAITO 币本位合约，按 U 本位 KAITOUSDT 的市价单单笔上限 200,000 KAITO，按价 1.0905、面值 10 USD 折成张');
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, coinOrder(21_810)); });
    expect(placed).not.toBeNull();
    expect(openPositions(view).map(p => p.contracts)).toEqual([21_810]);
    stop(view);
  });

  it('条件委托按触发价判：合成币本位触发价 1.2 上 23,000 张放得下（24,000），0.9 上 20,000 张放不下（18,000）；挂出的单带戳', () => {
    const view = mount(1.0905);
    const error = vi.spyOn(toast, 'error');
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, coinOrder(23_000, { type: 'CONDITIONAL', stopPrice: 1.2 })); });
    expect(placed).not.toBeNull();
    const order = (view.result.current.ordersMap[SYMBOL] ?? []).find(o => o.id === placed!.id);
    expect(order?.lotSizeRule).toBe('binance-lot-size-v1');

    let refused: unknown = 'untouched';
    act(() => { refused = view.result.current.handlePlaceOrder(SYMBOL, coinOrder(20_000, { side: 'SHORT', type: 'CONDITIONAL', stopPrice: 0.9 })); });
    expect(refused).toBeNull();
    expect(errorCalls(error).at(-1)?.title).toBe('单笔市价单最多 18,000 张，这一单 20,000 张');
    stop(view);
  });

  it('最优价的 TWAP / 分段订单整笔立即吃单：按一笔市价单判全量，不按一片 / 一张子单放行', () => {
    const view = mount(0.1);
    const error = vi.spyOn(toast, 'error');
    let placed: unknown = 'untouched';
    act(() => {
      placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(1_000_000, {
        type: 'TWAP', priceSelection: 'BEST', leverage: 1, latestPrice: 0.1, twapDuration: 60, twapInterval: 5,
      }));
    });
    expect(placed).toBeNull();
    expect(errorCalls(error).at(-1)?.title).toBe('单笔市价单最多 200,000 KAITO，这一单 1,000,000 KAITO');
    act(() => {
      placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(3_000_000, {
        type: 'SCALED', priceSelection: 'BEST', leverage: 1, latestPrice: 0.1,
        scaledCount: 5, scaledStartPrice: 0.09, scaledEndPrice: 0.1,
      }));
    });
    expect(placed).toBeNull();
    expect(errorCalls(error).at(-1)?.title).toBe('单笔市价单最多 200,000 KAITO，这一单 3,000,000 KAITO');
    expect(openPositions(view)).toHaveLength(0);
    stop(view);
  });

  it('合成币本位的卖出跟踪委托按「激活价 × (1 − 回调幅度)」判：激活价 1.1、回调 1% 的 22,000 张挂不出去（1.089 上最多 21,780 张）', () => {
    const view = mount(1.0905);
    const error = vi.spyOn(toast, 'error');
    let placed: unknown = 'untouched';
    act(() => {
      placed = view.result.current.handlePlaceOrder(SYMBOL, coinOrder(22_000, {
        side: 'SHORT', type: 'TRAILING_STOP', stopPrice: 1.1, callbackRate: 0.01,
      }));
    });
    expect(placed).toBeNull();
    expect(errorCalls(error).at(-1)?.title).toBe('单笔市价单最多 21,780 张，这一单 22,000 张');
    act(() => {
      placed = view.result.current.handlePlaceOrder(SYMBOL, coinOrder(21_780, {
        side: 'SHORT', type: 'TRAILING_STOP', stopPrice: 1.1, callbackRate: 0.01,
      }));
    });
    expect(placed).not.toBeNull();
    // 挂得出去就不会在触发时被单笔上限拒：最差的成交价（峰值恰好停在激活价上回撤 1%）也放得下
    const trailing = (view.result.current.ordersMap[SYMBOL] ?? []).find(o => o.type === 'TRAILING_STOP')!;
    expect(trailing.lotSizeRule).toBe('binance-lot-size-v1');
    let settled: boolean | null = null;
    act(() => { settled = view.result.current.settleFillDebit(SYMBOL, trailing, 108_900, 109, SIM0, { price: 1.1 * (1 - 0.01) }); });
    expect(settled).toBe(true);
    expect(errorCalls(error).map(c => c.title)).not.toContain('触发时超过单笔市价上限，委托已撤销');
    stop(view);
  });

  it('调用方传 trailingExecType: LIMIT 的跟踪委托：引擎存的一律是市价执行，按市价上限判——250,000 KAITO 挂不出去，出路是拆成几张跟踪委托', () => {
    const view = mount(1);
    const error = vi.spyOn(toast, 'error');
    let placed: unknown = 'untouched';
    act(() => {
      placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(250_000, {
        type: 'TRAILING_STOP', trailingExecType: 'LIMIT', stopPrice: 1.1, callbackRate: 0.01,
      }));
    });
    expect(placed).toBeNull();
    expect(view.result.current.ordersMap[SYMBOL] ?? []).toHaveLength(0);
    expect(errorCalls(error).at(-1)).toEqual({
      title: '单笔市价单最多 200,000 KAITO，这一单 250,000 KAITO',
      description: '币安 KAITOUSDT 的市价单单笔上限（快照 2026-09-23）。请拆成几张跟踪委托（每张不超过上限）。',
    });
    stop(view);
  });

  it('跟踪委托（触发后市价）超过上限被拒', () => {
    const view = mount(1);
    let placed: unknown = 'untouched';
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, usdtOrder(250_000, { type: 'TRAILING_STOP', stopPrice: 1.1, callbackRate: 0.01 })); });
    expect(placed).toBeNull();
    expect(view.result.current.ordersMap[SYMBOL] ?? []).toHaveLength(0);
    stop(view);
  });

  it('TWAP：每一片不得超过上限——4,400,000 分 20 片（每片 220,000）被拒，4,000,000（每片 200,000）挂出', () => {
    const view = mount(0.1);
    const error = vi.spyOn(toast, 'error');
    const twap = (quantity: number) => usdtOrder(quantity, { type: 'TWAP', leverage: 1, latestPrice: 0.1, twapDuration: 60, twapInterval: 3 });
    let placed: unknown = 'untouched';
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, twap(4_400_000)); });
    expect(placed).toBeNull();
    expect(errorCalls(error).at(-1)?.title).toBe('TWAP 每一片（共 20 片）：单笔市价单最多 200,000 KAITO，这一片 220,000 KAITO');
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, twap(4_000_000)); });
    expect(placed).not.toBeNull();
    const [order] = view.result.current.ordersMap[SYMBOL] ?? [];
    expect(order).toMatchObject({ type: 'TWAP', twapTotalQty: 4_000_000, lotSizeRule: 'binance-lot-size-v1' });
    stop(view);
  });

  it('分段订单：每张子单按限价上限（LOT_SIZE 2,000,000）判', () => {
    const view = mount(0.1);
    const error = vi.spyOn(toast, 'error');
    const scaled = (quantity: number) => usdtOrder(quantity, {
      type: 'SCALED', priceSelection: 'LIMIT', leverage: 2, latestPrice: 0.1,
      scaledCount: 5, scaledStartPrice: 0.09, scaledEndPrice: 0.1,
    });
    let placed: unknown = 'untouched';
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, scaled(11_000_000)); });
    expect(placed).toBeNull();
    expect(errorCalls(error).at(-1)?.title).toBe('分段订单第 1 张子单：单笔限价单最多 2,000,000 KAITO，这张子单 2,200,000 KAITO');
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, scaled(10_000_000)); });
    expect(placed).not.toBeNull();
    expect((view.result.current.ordersMap[SYMBOL] ?? []).map(o => o.quantity)).toEqual(Array(5).fill(2_000_000));
    stop(view);
  });

  it('限价单按 LOT_SIZE：2,000,001 被拒；250,000（超过市价上限、没超过限价上限）挂出', () => {
    const view = mount(1);
    const error = vi.spyOn(toast, 'error');
    const limit = (quantity: number) => usdtOrder(quantity, { type: 'LIMIT', priceSelection: 'LIMIT', price: 0.5 });
    let placed: unknown = 'untouched';
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, limit(2_000_001)); });
    expect(placed).toBeNull();
    expect(errorCalls(error).at(-1)).toEqual({
      title: '单笔限价单最多 2,000,000 KAITO，这一单 2,000,001 KAITO',
      description: '币安 KAITOUSDT 的限价单单笔上限（快照 2026-09-23）。请拆成几笔下单。',
    });
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, limit(250_000)); });
    expect(placed).not.toBeNull();
    stop(view);
  });

  it('随单止盈止损：成数不足 100% 的那一截按市价上限判；100%（平掉整个仓位）不受限', () => {
    const view = mount(1);
    const error = vi.spyOn(toast, 'error');
    const limit = (pct: number) => usdtOrder(1_000_000, {
      type: 'LIMIT', priceSelection: 'LIMIT', price: 0.9, slTriggerPrice: 0.8, tpSlPercentage: pct,
    });
    let placed: unknown = 'untouched';
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, limit(50)); });
    expect(placed).toBeNull();
    expect(errorCalls(error).at(-1)?.title).toBe('随单止损（50% 仓位）：单笔市价单最多 200,000 KAITO，这一单 500,000 KAITO');
    act(() => { placed = view.result.current.handlePlaceOrder(SYMBOL, limit(100)); });
    expect(placed).not.toBeNull();
    stop(view);
  });
});

describe('触发 / 执行时再判：撤单留痕、消息中心说清', () => {
  /** 合成币本位 KAITOUSD 的条件单（直接写进 orders_map）。 */
  const storedCoinConditional = (id: string, contracts: number, stopPrice: number, over: Record<string, unknown> = {}) => ({
    id, side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice, quantity: contracts, contracts, contractSizeUsd: 10,
    leverage: 2, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'KAITO', status: 'PENDING',
    createdAt: SIM0 - 30_000, triggerDirection: 'DOWN', operator: '<=', riskModel: 'binance-tiers-v1',
    ...over,
  } as unknown as PendingOrder);

  it('带戳的条件单：触发这一刻的价上超过单笔上限 → 撤单留痕、返回 false；没有戳（更新前挂出的）照常成交', () => {
    const stamped = storedCoinConditional('stamped', 23_000, 1.0, { lotSizeRule: 'binance-lot-size-v1' });
    const legacy = storedCoinConditional('legacy', 23_000, 1.0);
    const view = seedAndMount({ orders: [stamped, legacy], price: 1.0 });
    const error = vi.spyOn(toast, 'error');
    let settled: boolean | null = null;
    // 1.0 上只能 20,000 张
    act(() => { settled = view.result.current.settleFillDebit(SYMBOL, stamped, 115_000, 115, SIM0, { price: 1.0 }); });
    expect(settled).toBe(false);
    expect(errorCalls(error).at(-1)).toEqual({
      title: '触发时超过单笔市价上限，委托已撤销',
      // 出路是拆成几张条件单重新挂，不是「改用限价单」（止损方向的限价单会立刻成交）
      description: `${SYMBOL}：单笔市价单最多 20,000 张，这一单 23,000 张。币安无 KAITO 币本位合约，按 U 本位 KAITOUSDT 的市价单单笔上限 200,000 KAITO，按价 1.0000、面值 10 USD 折成张（快照 2026-09-23）。请拆成几张条件单重新挂（每张不超过上限）。`,
    });
    expect(cancelledIds()).toContain('stamped');

    act(() => { settled = view.result.current.settleFillDebit(SYMBOL, legacy, 115_000, 115, SIM0, { price: 1.0 }); });
    expect(settled).toBe(true);
    stop(view);
  });

  it('TWAP 的一片：按这一片判（整张 TWAP 撤单留痕）', () => {
    const twap = {
      id: 'twap', side: 'LONG', type: 'TWAP', price: 0, stopPrice: 0, quantity: 4_400_000, leverage: 1, marginMode: 'isolated',
      settlementMode: 'usdt', settlementAsset: 'USDT', status: 'ACTIVE', createdAt: SIM0, twapTotalQty: 4_400_000, twapFilledQty: 0,
      twapInterval: 180_000, twapNextExecTime: SIM0, twapEndTime: SIM0 + 3_600_000,
      riskModel: 'binance-tiers-v1', lotSizeRule: 'binance-lot-size-v1',
    } as unknown as PendingOrder;
    const view = seedAndMount({ orders: [twap], price: 0.1 });
    const error = vi.spyOn(toast, 'error');
    let settled: boolean | null = null;
    act(() => {
      settled = view.result.current.settleFillDebit(SYMBOL, twap, 22_000, 11, SIM0, { price: 0.1, fill: { ...twap, quantity: 220_000 } });
    });
    expect(settled).toBe(false);
    expect(errorCalls(error).at(-1)?.title).toBe('TWAP 执行这一片时超过单笔市价上限，委托已撤销');
    expect(cancelledIds()).toContain('twap');
    stop(view);
  });

  /** 分两笔市价单开出 40,000 张的 KAITOUSD 多仓（单笔上限在 1.0905 上 21,810 张）。 */
  function openLargeCoinLong(): View {
    const view = mount(1.0905);
    act(() => { view.result.current.handlePlaceOrder(SYMBOL, coinOrder(20_000)); });
    act(() => { view.result.current.handlePlaceOrder(SYMBOL, coinOrder(20_000)); });
    expect(openPositions(view).map(p => p.contracts)).toEqual([40_000]);
    return view;
  }

  it('按成数（50%）挂的止损：挂出时按触发价 1.0 放得下（20,000 张）；价格跳空到 0.95 触发时放不下 → 撤单留痕，说清仓位此刻没有这张止损的保护', () => {
    const view = openLargeCoinLong();
    const error = vi.spyOn(toast, 'error');
    const [pos] = openPositions(view);
    act(() => { view.result.current.handlePlaceTpSl(SYMBOL, pos, 1.3, 1.0, 50); });
    const protective = view.result.current.ordersMap[SYMBOL] ?? [];
    expect(protective.map(o => [o.reduceKind, o.quantity, o.lotSizeRule])).toEqual([
      ['TP', 20_000, 'binance-lot-size-v1'],
      ['SL', 20_000, 'binance-lot-size-v1'],
    ]);
    const sl = protective.find(o => o.reduceKind === 'SL')!;
    let execution: ReturnType<ReturnType<typeof useTradingContext>['executeReduceOnlyTrigger']> | null = null;
    act(() => { execution = view.result.current.executeReduceOnlyTrigger(SYMBOL, sl, 0.95, SIM0); });
    expect(execution).toEqual({ ok: false, reason: 'lot_size_rejected' });
    // 不悄悄丢：单撤了、留了痕、说了话；仓位原样，止盈那一张还在
    expect((view.result.current.ordersMap[SYMBOL] ?? []).map(o => o.reduceKind)).toEqual(['TP']);
    expect(cancelledIds()).toContain(sl.id);
    expect(openPositions(view).map(p => p.contracts)).toEqual([40_000]);
    const last = errorCalls(error).at(-1)!;
    expect(last.title).toBe('止损触发时超过单笔市价上限，委托已撤销');
    expect(last.description).toContain(`${SYMBOL}：单笔市价单最多 19,000 张，这一单 20,000 张`);
    expect(last.description).toContain('这个仓位此刻没有这张止损的保护');
    expect(last.description).toContain('平掉整个仓位（100%）的止盈止损不受单笔上限约束');
    stop(view);
  });

  it('100% 的止损（平掉整个仓位，相当于 closePosition）：仓位比单笔上限大也照常挂出、照常触发平光', () => {
    const view = openLargeCoinLong();
    const [pos] = openPositions(view);
    act(() => { view.result.current.handlePlaceTpSl(SYMBOL, pos, null, 1.0, 100); });
    const [sl] = view.result.current.ordersMap[SYMBOL] ?? [];
    expect(sl).toMatchObject({ reduceKind: 'SL', quantity: 40_000, reducePercentage: 100 });
    let execution: { ok: boolean } | null = null;
    act(() => { execution = view.result.current.executeReduceOnlyTrigger(SYMBOL, sl, 0.95, SIM0); });
    expect(execution?.ok).toBe(true);
    expect(openPositions(view)).toHaveLength(0);
    stop(view);
  });

  it('更新前挂出的（没有戳）按成数的止损：触发时不再判，照常平掉那一截', () => {
    const view = openLargeCoinLong();
    const [pos] = openPositions(view);
    act(() => { view.result.current.handlePlaceTpSl(SYMBOL, pos, null, 1.0, 50); });
    const [stamped] = view.result.current.ordersMap[SYMBOL] ?? [];
    const legacy = { ...stamped, lotSizeRule: undefined };
    act(() => { view.result.current.setOrdersMap(prev => ({ ...prev, [SYMBOL]: [legacy] })); });
    let execution: { ok: boolean } | null = null;
    act(() => { execution = view.result.current.executeReduceOnlyTrigger(SYMBOL, legacy, 0.95, SIM0); });
    expect(execution?.ok).toBe(true);
    expect(openPositions(view).map(p => p.contracts)).toEqual([20_000]);
    stop(view);
  });

  it('持仓卡上按成数挂止盈止损：那一截超过上限就不挂（写明怎么办）；100% 照挂', () => {
    const view = seedAndMount({ positions: [storedUsdtPosition('big', 400_000)], price: 1 });
    const error = vi.spyOn(toast, 'error');
    const [pos] = openPositions(view);
    act(() => { view.result.current.handlePlaceTpSl(SYMBOL, pos, null, 0.9, 60); });
    expect(view.result.current.ordersMap[SYMBOL] ?? []).toHaveLength(0);
    const last = errorCalls(error).at(-1)!;
    expect(last.title).toBe('止损（60% 仓位）：单笔市价单最多 200,000 KAITO，这一单 240,000 KAITO');
    expect(last.description).toBe('币安 KAITOUSDT 的市价单单笔上限（快照 2026-09-23）。按成数挂的止盈止损触发后是一笔市价单：把成数调小到不超过上限，或选 100%（平掉整个仓位的止盈止损不受单笔上限约束）。');
    act(() => { view.result.current.handlePlaceTpSl(SYMBOL, pos, null, 0.9, 100); });
    expect((view.result.current.ordersMap[SYMBOL] ?? []).map(o => o.quantity)).toEqual([400_000]);
    stop(view);
  });

  it('连最小的一格（10%）都超过上限（2,500,000 KAITO 的 10% = 250,000）：只说只能选 100%，不叫人把成数调小', () => {
    const view = seedAndMount({ positions: [storedUsdtPosition('huge', 2_500_000)], price: 1 });
    const error = vi.spyOn(toast, 'error');
    const [pos] = openPositions(view);
    act(() => { view.result.current.handlePlaceTpSl(SYMBOL, pos, null, 0.9, 10); });
    expect(view.result.current.ordersMap[SYMBOL] ?? []).toHaveLength(0);
    const last = errorCalls(error).at(-1)!;
    expect(last.title).toBe('止损（10% 仓位）：单笔市价单最多 200,000 KAITO，这一单 250,000 KAITO');
    expect(last.description).toBe('币安 KAITOUSDT 的市价单单笔上限（快照 2026-09-23）。按成数挂的止盈止损触发后是一笔市价单，'
      + '连最小的一格（10%）都超过上限：只能选 100%（平掉整个仓位的止盈止损不受单笔上限约束）。');
    stop(view);
  });
});

describe('豁免：不拦强平、不动现有仓位', () => {
  it('比单笔上限大的逐仓仓位（300,000 KAITO）照常被强平；挂载时仓位原样', () => {
    const view = seedAndMount({ positions: [storedUsdtPosition('big', 300_000)], price: 1 });
    expect(openPositions(view).map(p => p.quantity)).toEqual([300_000]);
    for (const [start, low] of [[SIM0, 1], [SIM0 + 60_000, 0.85]] as const) {
      act(() => {
        view.result.current.liquidateIsolatedOnCandle(SYMBOL, { high: 1, low, close: low, startTime: start, endTime: start + 60_000 });
      });
    }
    expect(openPositions(view)).toHaveLength(0);
    const liquidations = view.result.current.tradeHistory.filter(t => t.action === 'LIQUIDATION');
    expect(liquidations).toHaveLength(1);
    expect(liquidations[0].quantity).toBe(300_000);
    stop(view);
  });

  it('引擎的整仓平仓（一键平仓、停止回放的收尾）不受单笔上限约束', () => {
    const view = seedAndMount({ positions: [storedUsdtPosition('big', 300_000)], price: 1 });
    act(() => { view.result.current.handleClosePosition(SYMBOL, 0, 1); });
    expect(openPositions(view)).toHaveLength(0);
    stop(view);
  });
});

describe('持仓卡的市价平仓', () => {
  it('按成数市价平仓不再有 1% 的下限：CYPH 250,000（一笔最多 2,000）按 0.8% 平掉的就是 2,000，不是 1% 的 2,500', () => {
    const view = seedAndMount({ symbol: 'CYPHUSDT', positions: [storedUsdtPosition('big', 250_000)], price: 1 });
    const success = vi.spyOn(toast, 'success');
    act(() => { view.result.current.handleClosePosition('CYPHUSDT', 0, 2_000 / 250_000); });
    expect(openPositions(view, 'CYPHUSDT').map(p => p.quantity)).toEqual([248_000]);
    const closes = view.result.current.tradeHistory.filter(t => t.symbol === 'CYPHUSDT');
    expect(closes.at(-1)?.quantity).toBeCloseTo(2_000, 6);
    // 提示里的成数就是真正平掉的成数：0.8%，不是四舍五入出来的 1%
    const description = String((success.mock.calls.at(-1)?.[1] as { description?: string } | undefined)?.description ?? '');
    expect(description).toContain('(0.8%)');
    stop(view);
  });
});
