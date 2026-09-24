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
import { executeSettlementFill } from '@/lib/tradingSettlement';
import { recheckedAtFill } from '@/lib/positionLimit';
import { calcLiquidationPrice, type PendingOrder } from '@/types/trading';

/**
 * 持仓限制模式走真实的 TradingProvider：默认无限制、按 usePersistedState 存（sim_anon_position_limit_mode）、
 * 引擎的每一道闸门（下单、成交、改杠杆、读杠杆）都按那一刻的模式。
 */

const T0 = Date.parse('2026-09-24T00:00:00Z');
const SIM0 = Date.parse('2025-03-01T08:00:00Z');
const KEY = (k: string) => `sim_anon_${k}`;
const wrapper = ({ children }: { children: React.ReactNode }) => <TradingProvider>{children}</TradingProvider>;

function mount(symbol: string, price: number) {
  const view = renderHook(() => useTradingContext(), { wrapper });
  act(() => { view.result.current.setPriceMap({ [symbol]: price }); });
  act(() => {
    view.result.current.forkReplayTimeline(symbol, 'start', SIM0);
    view.result.current.sim.startSimulation(SIM0);
  });
  return view;
}

const stop = (view: { result: { current: ReturnType<typeof useTradingContext> }; unmount: () => void }) => {
  act(() => view.result.current.sim.stopSimulation());
  view.unmount();
};

/** ORDIUSD（合成币本位，面值 10 USD）20x 市价单，数量是张。 */
const ordiMarket = (contracts: number, over: Partial<PlaceOrderParams> = {}): PlaceOrderParams => ({
  side: 'LONG', type: 'MARKET', price: 0, stopPrice: 0, quantity: contracts, contracts, leverage: 20,
  marginMode: 'isolated', priceSelection: 'MARKET', triggerType: 'LAST', currencyUnit: 'BASE',
  usdtInputMode: 'ORDER_VALUE', inputAmount: contracts, settlementMode: 'coin', settlementAsset: 'ORDI',
  contractSizeUsd: 10, latestPrice: 30,
  ...over,
});

/** 用户截图里挂着的那张 13,370 USD 条件单（本次更新之后下的，带分层戳）。 */
const ordiConditional = (over: Record<string, unknown> = {}) => ({
  id: 'ordi-cond', side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 33, quantity: 1_337, contracts: 1_337,
  contractSizeUsd: 10, leverage: 20, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'ORDI',
  status: 'PENDING', createdAt: SIM0 - 30_000, triggerDirection: 'UP', operator: '>=',
  riskModel: 'binance-tiers-v1', lotSizeRule: 'binance-lot-size-v1',
  ...over,
} as unknown as PendingOrder);

const errorTitles = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map(call => String(call[0]));

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

describe('持仓限制模式：保存与默认', () => {
  it('从没选过：无限制；选了币安标准就存进 sim_anon_position_limit_mode，重新打开还是它', () => {
    const first = renderHook(() => useTradingContext(), { wrapper });
    expect(first.result.current.positionLimitMode).toBe('unlimited');
    expect(first.result.current.getPositionLimitMode()).toBe('unlimited');
    act(() => first.result.current.setPositionLimitMode('binance'));
    expect(first.result.current.positionLimitMode).toBe('binance');
    // 引擎回调读的 ref 在切换的那一刻就变
    expect(first.result.current.getPositionLimitMode()).toBe('binance');
    expect(localStorage.getItem(KEY('position_limit_mode'))).toBe(JSON.stringify('binance'));
    first.unmount();

    const second = renderHook(() => useTradingContext(), { wrapper });
    expect(second.result.current.positionLimitMode).toBe('binance');
    act(() => second.result.current.setPositionLimitMode('unlimited'));
    expect(localStorage.getItem(KEY('position_limit_mode'))).toBe(JSON.stringify('unlimited'));
    second.unmount();
  });

  it('写坏的旧值读成无限制', () => {
    localStorage.setItem(KEY('position_limit_mode'), JSON.stringify('something-else'));
    const view = renderHook(() => useTradingContext(), { wrapper });
    expect(view.result.current.positionLimitMode).toBe('unlimited');
    view.unmount();
  });
});

describe('杠杆的读写跟着模式走', () => {
  it('保存的 150x：无限制下 ORDIUSDT 读 150x，切到币安标准读 50x（保存值不改写），切回来又是 150x', () => {
    localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ ORDIUSDT: 150 }));
    const view = mount('ORDIUSDT', 30);
    act(() => view.result.current.setSymbolSettlementMode('ORDIUSDT', 'usdt'));
    expect(view.result.current.getSymbolLeverage('ORDIUSDT')).toBe(150);
    act(() => view.result.current.setPositionLimitMode('binance'));
    expect(view.result.current.getSymbolLeverage('ORDIUSDT')).toBe(50);
    expect(JSON.parse(localStorage.getItem(KEY('symbol_leverage')) ?? '{}').ORDIUSDT).toBe(150);
    act(() => view.result.current.setPositionLimitMode('unlimited'));
    expect(view.result.current.getSymbolLeverage('ORDIUSDT')).toBe(150);
    // 无限制下写入夹到 150x，不夹到合约上限
    act(() => view.result.current.setSymbolLeverage('LUMIAUSDT', 120, 'usdt'));
    expect(JSON.parse(localStorage.getItem(KEY('symbol_leverage')) ?? '{}').LUMIAUSDT).toBe(120);
    act(() => view.result.current.setSymbolLeverage('LUMIAUSDT', 999, 'usdt'));
    expect(JSON.parse(localStorage.getItem(KEY('symbol_leverage')) ?? '{}').LUMIAUSDT).toBe(150);
    stop(view);
  });
});

describe('引擎下单：用户截图里的 ORDI（20x、已挂 13,370 USD 条件单、再市价 13,990 USD）', () => {
  const seed = (mode: 'unlimited' | 'binance') => {
    localStorage.setItem(KEY('position_limit_mode'), JSON.stringify(mode));
    localStorage.setItem(KEY('orders_map'), JSON.stringify({ ORDIUSD: [ordiConditional()] }));
    localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ ORDIUSD: 20 }));
    return mount('ORDIUSD', 30);
  };

  it('币安标准：拒绝，说「20x 最高 25,000 USD」，不建仓', () => {
    const view = seed('binance');
    const error = vi.spyOn(toast, 'error');
    let placed: unknown = 'untouched';
    act(() => { placed = view.result.current.handlePlaceOrder('ORDIUSD', ordiMarket(1_399)); });
    expect(placed).toBeNull();
    expect(errorTitles(error).some(t => t.includes('持仓和当前委托价值超过当前杠杆倍数最高可持有头寸：20x 最高 25,000 USD'))).toBe(true);
    expect(view.result.current.positionsMap.ORDIUSD ?? []).toHaveLength(0);
    stop(view);
  });

  it('无限制：照常成交，开出的仓位按 0.4%（unlimited-v1）；没有任何「将超限」预警', () => {
    const view = seed('unlimited');
    const error = vi.spyOn(toast, 'error');
    const warning = vi.spyOn(toast, 'warning');
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder('ORDIUSD', ordiMarket(1_399)); });
    expect(placed).not.toBeNull();
    expect(error).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
    const [pos] = view.result.current.positionsMap.ORDIUSD ?? [];
    expect(pos.contracts).toBe(1_399);
    expect(pos.riskModel).toBe('unlimited-v1');
    stop(view);
  });

  it('无限制：150x、远超单笔市价上限的 ORDIUSDT 市价单（30,000 ORDI，币安上限 20,000）照常成交', () => {
    localStorage.setItem(KEY('position_limit_mode'), JSON.stringify('unlimited'));
    const view = mount('ORDIUSDT', 30);
    const order: PlaceOrderParams = {
      ...ordiMarket(0), quantity: 30_000, contracts: undefined, inputAmount: 30_000, leverage: 150,
      settlementMode: 'usdt', settlementAsset: 'USDT', contractSizeUsd: undefined,
    };
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder('ORDIUSDT', order); });
    expect(placed).not.toBeNull();
    expect(view.result.current.positionsMap.ORDIUSDT?.[0]?.leverage).toBe(150);
    expect(view.result.current.positionsMap.ORDIUSDT?.[0]?.riskModel).toBe('unlimited-v1');
    stop(view);

    // 币安标准：1x 下分层放得下（最高 12,500,000），单笔市价上限照样拦（21,000 > 20,000 ORDI）
    localStorage.clear();
    localStorage.setItem(KEY('position_limit_mode'), JSON.stringify('binance'));
    const binance = mount('ORDIUSDT', 30);
    const error = vi.spyOn(toast, 'error');
    act(() => {
      placed = binance.result.current.handlePlaceOrder('ORDIUSDT', { ...order, quantity: 21_000, inputAmount: 21_000, leverage: 1 });
    });
    expect(placed).toBeNull();
    expect(errorTitles(error).some(t => t.includes('单笔市价单最多 20,000 ORDI'))).toBe(true);
    stop(binance);
  });

  it('无限制下挂出的委托带着「无限制模式下挂出」的标记（切到币安标准之后成交那一刻按币安判）', () => {
    const view = seed('unlimited');
    act(() => {
      view.result.current.handlePlaceOrder('ORDIUSD', ordiMarket(1_399, { type: 'LIMIT', priceSelection: 'LIMIT', price: 28 }));
    });
    const limit = (view.result.current.ordersMap.ORDIUSD ?? []).find(o => o.type === 'LIMIT')!;
    expect(limit.limitModeAtPlacement).toBe('unlimited');
    expect(limit.riskModel).toBe('binance-tiers-v1');
    expect(recheckedAtFill(limit)).toBe(true);
    stop(view);
  });
});

describe('成交闸门（settleFillDebit）按成交那一刻的模式', () => {
  const seed = (mode: 'unlimited' | 'binance', orders: PendingOrder[]) => {
    localStorage.setItem(KEY('position_limit_mode'), JSON.stringify(mode));
    localStorage.setItem(KEY('positions_map'), JSON.stringify({
      ORDIUSD: [{
        id: 'held', side: 'LONG', quantity: 1_399, contracts: 1_399, contractSizeUsd: 10, entryPrice: 30, leverage: 20,
        marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'ORDI', margin: 699.5, isolatedMargin: 699.5,
        marginCoin: 699.5 / 30, openTime: SIM0 - 60_000, riskModel: 'unlimited-v1', riskSymbol: 'ORDIUSD',
      }],
    }));
    localStorage.setItem(KEY('orders_map'), JSON.stringify({ ORDIUSD: orders }));
    return mount('ORDIUSD', 30);
  };

  it('无限制：条件单触发时不再判上限，开出的仓位保持 unlimited-v1（不被改盖分层戳）', () => {
    const view = seed('unlimited', [ordiConditional()]);
    const cond = view.result.current.ordersMap.ORDIUSD[0];
    const { fee, margin, position } = executeSettlementFill('ORDIUSD', 33, cond, false, SIM0, undefined, null, 'order', 'unlimited');
    let settled: boolean | null = null;
    act(() => { settled = view.result.current.settleFillDebit('ORDIUSD', cond, margin, fee, SIM0, { price: 33, position }); });
    expect(settled).toBe(true);
    expect(position.riskModel).toBe('unlimited-v1');
    stop(view);
  });

  it('币安标准：同一张条件单触发时 13,990 + 13,370 超过 25,000 → 撤单留痕', () => {
    const view = seed('binance', [ordiConditional()]);
    const error = vi.spyOn(toast, 'error');
    const cond = view.result.current.ordersMap.ORDIUSD[0];
    const { fee, margin, position } = executeSettlementFill('ORDIUSD', 33, cond, false, SIM0, undefined, null, 'order', 'binance');
    let settled: boolean | null = null;
    act(() => { settled = view.result.current.settleFillDebit('ORDIUSD', cond, margin, fee, SIM0, { price: 33, position }); });
    expect(settled).toBe(false);
    expect(errorTitles(error)).toContain('触发时超过杠杆分层上限，委托已撤销');
    stop(view);
  });

  it('币安标准：无限制模式下挂出的限价单在成交那一刻判，放不下就撤（说清是无限制模式下挂出的）', () => {
    const limit = ordiConditional({ id: 'ordi-limit', type: 'LIMIT', price: 30, stopPrice: 0, limitModeAtPlacement: 'unlimited' });
    const view = seed('binance', [limit]);
    const error = vi.spyOn(toast, 'error');
    const stored = view.result.current.ordersMap.ORDIUSD[0];
    const { fee, margin, position } = executeSettlementFill('ORDIUSD', 30, stored, true, SIM0, undefined, null, 'order', 'binance');
    let settled: boolean | null = null;
    act(() => { settled = view.result.current.settleFillDebit('ORDIUSD', stored, margin, fee, SIM0, { price: 30, position }); });
    expect(settled).toBe(false);
    expect(errorTitles(error)).toContain('成交时超过杠杆分层上限，委托已撤销');
    const description = String((error.mock.calls.at(-1)?.[1] as { description?: string })?.description);
    expect(description).toContain('这张单是在无限制模式下挂出的');
    stop(view);
  });
});

describe('改杠杆（applySymbolLeverage）：无限制下有持仓也能降，追加的保证金从余额扣', () => {
  it('ORDIUSD 20x 持仓降到 10x：余额少 699.5；币安标准下同一步被「只能升不能降」拒绝', () => {
    const seedHeld = (mode: 'unlimited' | 'binance') => {
      localStorage.setItem(KEY('position_limit_mode'), JSON.stringify(mode));
      localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ ORDIUSD: 20 }));
      localStorage.setItem(KEY('positions_map'), JSON.stringify({
        ORDIUSD: [{
          id: 'held', side: 'LONG', quantity: 1_399, contracts: 1_399, contractSizeUsd: 10, entryPrice: 30, leverage: 20,
          marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'ORDI', margin: 699.5, isolatedMargin: 699.5,
          marginCoin: 699.5 / 30, openTime: SIM0 - 60_000, riskModel: 'unlimited-v1', riskSymbol: 'ORDIUSD',
        }],
      }));
      return mount('ORDIUSD', 30);
    };
    const view = seedHeld('unlimited');
    const before = view.result.current.balance;
    let plan: ReturnType<typeof view.result.current.applySymbolLeverage> = null!;
    act(() => { plan = view.result.current.applySymbolLeverage('ORDIUSD', 10, 'coin'); });
    expect(plan.ok).toBe(true);
    expect(plan.totalReleaseUsd).toBeCloseTo(-699.5, 6);
    expect(view.result.current.balance).toBeCloseTo(before - 699.5, 6);
    expect(view.result.current.positionsMap.ORDIUSD[0].leverage).toBe(10);
    expect(view.result.current.getSymbolLeverage('ORDIUSD')).toBe(10);
    stop(view);

    localStorage.clear();
    const binance = seedHeld('binance');
    act(() => { plan = binance.result.current.applySymbolLeverage('ORDIUSD', 10, 'coin'); });
    expect(plan.ok).toBe(false);
    expect(plan.refusal?.code).toBe('below-floor');
    stop(binance);
  });
});

/** U 本位市价单（数量是币）。 */
const usdtMarket = (qty: number, leverage: number, over: Partial<PlaceOrderParams> = {}): PlaceOrderParams => ({
  side: 'LONG', type: 'MARKET', price: 0, stopPrice: 0, quantity: qty, leverage,
  marginMode: 'isolated', priceSelection: 'MARKET', triggerType: 'LAST', currencyUnit: 'BASE',
  usdtInputMode: 'ORDER_VALUE', inputAmount: qty, settlementMode: 'usdt', settlementAsset: 'USDT',
  ...over,
});
const usdtHeld = (id: string, side: 'LONG' | 'SHORT', quantity: number, entryPrice: number, leverage: number, riskModel?: string, symbol = 'KAITOUSDT') => ({
  id, side, quantity, entryPrice, leverage, marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT',
  margin: (quantity * entryPrice) / leverage, isolatedMargin: (quantity * entryPrice) / leverage, openTime: SIM0 - 60_000,
  ...(riskModel ? { riskModel, riskSymbol: symbol } : {}),
});

/**
 * 【复核】进无限制时，有持仓的标的杠杆不跟着「解夹」：币安标准下 LUMIAUSDT 没设过杠杆读 10x（默认 35x 夹到合约上限），
 * 仓位按 10x 开；无限制模式把上限放到 150x，同一个保存值读成 35x——下一笔加仓按 35x 成交、另开一张卡。
 * 进无限制（手动切过来，或从没选过、按默认进来的老用户第一次打开）时把这样的标的钉在仓位的杠杆上。
 */
describe('进无限制时，有持仓标的的杠杆保持不变（positionLimit.leveragePinsForUnlimited）', () => {
  it('从没选过的老用户：LUMIAUSDT 分层多仓 10x、没设过杠杆——读 10x，再加仓并进同一个仓位；「无限制」记下来', () => {
    localStorage.setItem(KEY('positions_map'), JSON.stringify({ LUMIAUSDT: [usdtHeld('held', 'LONG', 10_000, 1, 10, 'binance-tiers-v1', 'LUMIAUSDT')] }));
    const view = mount('LUMIAUSDT', 1);
    expect(view.result.current.positionLimitMode).toBe('unlimited');
    expect(localStorage.getItem(KEY('position_limit_mode'))).toBe(JSON.stringify('unlimited'));
    expect(JSON.parse(localStorage.getItem(KEY('symbol_leverage')) ?? '{}').LUMIAUSDT).toBe(10);
    act(() => view.result.current.setSymbolSettlementMode('LUMIAUSDT', 'usdt'));
    const lev = view.result.current.getSymbolLeverage('LUMIAUSDT');
    expect(lev).toBe(10);
    act(() => { view.result.current.handlePlaceOrder('LUMIAUSDT', usdtMarket(1_000, lev)); });
    expect(view.result.current.positionsMap.LUMIAUSDT.map(p => p.leverage)).toEqual([10]);
    stop(view);
  });

  it('更新前按 35x 开的旧仓位（币安标准下被夹成 10x）：无限制下读 35x 正好对上仓位，不钉', () => {
    localStorage.setItem(KEY('positions_map'), JSON.stringify({ LUMIAUSDT: [usdtHeld('old', 'LONG', 10_000, 1, 35, undefined, 'LUMIAUSDT')] }));
    const view = mount('LUMIAUSDT', 1);
    expect(JSON.parse(localStorage.getItem(KEY('symbol_leverage')) ?? '{}').LUMIAUSDT).toBeUndefined();
    expect(view.result.current.getSymbolLeverage('LUMIAUSDT')).toBe(35);
    stop(view);
  });

  it('手动从币安标准切到无限制：KAITOUSDT 存着旧滑块的 125x、分层仓位按 75x 开——切过去仍是 75x；没有仓位的标的照保存值', () => {
    localStorage.setItem(KEY('position_limit_mode'), JSON.stringify('binance'));
    localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ KAITOUSDT: 125, LUMIAUSDT: 120 }));
    localStorage.setItem(KEY('positions_map'), JSON.stringify({ KAITOUSDT: [usdtHeld('held', 'LONG', 1_000, 1, 75, 'binance-tiers-v1')] }));
    const view = mount('KAITOUSDT', 1);
    act(() => view.result.current.setSymbolSettlementMode('KAITOUSDT', 'usdt'));
    act(() => view.result.current.setSymbolSettlementMode('LUMIAUSDT', 'usdt'));
    expect(view.result.current.getSymbolLeverage('KAITOUSDT')).toBe(75);
    expect(view.result.current.getSymbolLeverage('LUMIAUSDT')).toBe(10);
    act(() => view.result.current.setPositionLimitMode('unlimited'));
    expect(view.result.current.getSymbolLeverage('KAITOUSDT')).toBe(75);
    expect(view.result.current.getSymbolLeverage('LUMIAUSDT')).toBe(120);
    // 切回币安标准不钉、不改保存值（超过合约上限的按上限生效并提示，见 leverageClampNotice）
    act(() => view.result.current.setPositionLimitMode('binance'));
    expect(JSON.parse(localStorage.getItem(KEY('symbol_leverage')) ?? '{}')).toEqual({ KAITOUSDT: 75, LUMIAUSDT: 120 });
    stop(view);
  });
});

/**
 * 【复核】设计第 3 条：加仓并进现有仓位的模型。无限制模式下往币安标准下开的分层仓位上加仓，照样并进去、整仓仍按分层——
 * 不另开一条只靠自己那点保证金的新腿（KAITOUSDT：分层多 40,000 @0.50、5x，标记价 0.96，加 10,000 USDT）。
 */
describe('无限制模式下加仓并进分层仓位', () => {
  it('两种模式下都是一个仓位、仍按分层；强平价一样', () => {
    const liqs: number[] = [];
    for (const mode of ['binance', 'unlimited'] as const) {
      localStorage.clear();
      localStorage.setItem(KEY('position_limit_mode'), JSON.stringify(mode));
      localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ KAITOUSDT: 5 }));
      localStorage.setItem(KEY('positions_map'), JSON.stringify({ KAITOUSDT: [usdtHeld('held', 'LONG', 40_000, 0.5, 5, 'binance-tiers-v1')] }));
      const view = mount('KAITOUSDT', 0.96);
      act(() => view.result.current.setSymbolSettlementMode('KAITOUSDT', 'usdt'));
      const warn = vi.spyOn(toast, 'warning');
      act(() => { view.result.current.handlePlaceOrder('KAITOUSDT', usdtMarket(10_000 / 0.96, 5)); });
      const open = view.result.current.positionsMap.KAITOUSDT;
      expect(open).toHaveLength(1);
      expect(open[0].id).toBe('held');
      expect(open[0].riskModel).toBe('binance-tiers-v1');
      expect(warn.mock.calls.find(c => String(c[0]) === '未与现有仓位合并')).toBeUndefined();
      liqs.push(calcLiquidationPrice(open[0], 'KAITOUSDT'));
      stop(view);
      warn.mockRestore();
    }
    expect(liqs[1]).toBeCloseTo(liqs[0], 8);
    expect(liqs[0]).toBeLessThan(0.6);
  });
});

/**
 * 【复核】币安标准下，对冲豁免的底是无限制模式下开的仓位时，成交闸门与「未与现有仓位合并」提示按底的来源说，
 * 与同一条提示里「反向对冲无限制模式下开的仓位」同一个称呼，不再说「更新前仓位」。
 */
describe('对冲豁免的底是无限制模式下开的仓位：文案按底的来源说', () => {
  it('触发那一刻豁免已不成立（底只剩 20,000）：撤单提示说「靠对冲无限制模式下开的仓位的豁免挂出的」', () => {
    const hedge = {
      id: 'hedge', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 0.9, quantity: 150_000, leverage: 20,
      marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'PENDING', createdAt: SIM0 - 30_000,
      triggerDirection: 'DOWN', operator: '<=', riskModel: 'legacy-hedge-v1', lotSizeRule: 'binance-lot-size-v1',
      hedgeBaseKinds: ['unlimited'],
    } as unknown as PendingOrder;
    localStorage.setItem(KEY('position_limit_mode'), JSON.stringify('binance'));
    localStorage.setItem(KEY('positions_map'), JSON.stringify({ KAITOUSDT: [usdtHeld('base', 'LONG', 20_000, 1, 20, 'unlimited-v1')] }));
    localStorage.setItem(KEY('orders_map'), JSON.stringify({ KAITOUSDT: [hedge] }));
    const view = mount('KAITOUSDT', 0.9);
    const error = vi.spyOn(toast, 'error');
    const stored = view.result.current.ordersMap.KAITOUSDT[0];
    const { fee, margin, position } = executeSettlementFill('KAITOUSDT', 0.9, stored, false, SIM0, undefined, null, 'order', 'binance');
    let settled: boolean | null = null;
    act(() => { settled = view.result.current.settleFillDebit('KAITOUSDT', stored, margin, fee, SIM0, { price: 0.9, position }); });
    expect(settled).toBe(false);
    const description = String((error.mock.calls.at(-1)?.[1] as { description?: string })?.description);
    expect(description).toContain('这张单是靠对冲无限制模式下开的仓位的豁免挂出的，这一刻豁免已不成立');
    expect(description).toContain('反向对冲无限制模式下开的仓位');
    expect(description).not.toContain('更新前仓位');
    stop(view);
  });

  it('豁免对冲并不进分层空仓：「未与现有仓位合并」说「靠对冲无限制模式下开的仓位的豁免开的」', () => {
    localStorage.setItem(KEY('position_limit_mode'), JSON.stringify('binance'));
    localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ KAITOUSDT: 20 }));
    localStorage.setItem(KEY('positions_map'), JSON.stringify({
      KAITOUSDT: [usdtHeld('base', 'LONG', 240_000, 1, 20, 'unlimited-v1'), usdtHeld('tiered-short', 'SHORT', 9_000, 1.1, 20, 'binance-tiers-v1')],
    }));
    const view = mount('KAITOUSDT', 1.1);
    act(() => view.result.current.setSymbolSettlementMode('KAITOUSDT', 'usdt'));
    const warn = vi.spyOn(toast, 'warning');
    let placed: { id: string } | null = null;
    act(() => { placed = view.result.current.handlePlaceOrder('KAITOUSDT', usdtMarket(200_000, 20, { side: 'SHORT', latestPrice: 1.1 })); });
    expect(placed).not.toBeNull();
    const notice = warn.mock.calls.find(c => String(c[0]) === '未与现有仓位合并');
    const description = String((notice?.[1] as { description?: string })?.description);
    expect(description).toContain('（靠对冲无限制模式下开的仓位的豁免开的）');
    expect(description).not.toContain('更新前');
    stop(view);
  });

  it('挂出去的豁免对冲单记下底的来源（hedgeBaseKinds），底平掉之后撤单提示仍说得对；只对冲更新前仓位的单不写这个字段', () => {
    const conditionalShort = (qty: number) => usdtMarket(qty, 20, {
      side: 'SHORT', type: 'CONDITIONAL', priceSelection: 'MARKET', stopPrice: 0.9, latestPrice: 1,
    });
    for (const [riskModel, expected] of [['unlimited-v1', ['unlimited']], [undefined, undefined]] as const) {
      localStorage.clear();
      localStorage.setItem(KEY('position_limit_mode'), JSON.stringify('binance'));
      localStorage.setItem(KEY('symbol_leverage'), JSON.stringify({ KAITOUSDT: 20 }));
      localStorage.setItem(KEY('positions_map'), JSON.stringify({ KAITOUSDT: [usdtHeld('base', 'LONG', 200_000, 1, 20, riskModel)] }));
      const view = mount('KAITOUSDT', 1);
      act(() => view.result.current.setSymbolSettlementMode('KAITOUSDT', 'usdt'));
      act(() => { view.result.current.handlePlaceOrder('KAITOUSDT', conditionalShort(150_000)); });
      const [order] = view.result.current.ordersMap.KAITOUSDT ?? [];
      expect(order?.riskModel).toBe('legacy-hedge-v1');
      expect(order?.hedgeBaseKinds).toEqual(expected);
      stop(view);
    }
  });
});
