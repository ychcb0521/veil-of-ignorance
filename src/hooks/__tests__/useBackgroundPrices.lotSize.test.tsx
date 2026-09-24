import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, profile: null }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(() => ({ upsert: vi.fn(async () => ({ error: null })) })) },
}));
vi.mock('@/lib/canonicalTimePrice', () => ({
  fetchCanonicalTimePriceAt: vi.fn(),
}));

import { TradingProvider, useTradingContext } from '@/contexts/TradingContext';
import { useBackgroundPrices } from '@/hooks/useBackgroundPrices';
import { fetchCanonicalTimePriceAt } from '@/lib/canonicalTimePrice';
import { toast } from '@/lib/notificationCenter';

/**
 * 后台标的（不在图表上的那个）同样按单笔市价上限在触发时再判：走真实的 TradingProvider 与 useBackgroundPrices，
 * 触发之后超过上限的单撤掉留痕、消息中心说清，止损不会悄悄没了。
 * 场景：快照刷新后上限变小 / 合成币本位的张数上限随价变小——挂着的单到触发时放不下。
 */

const T0 = Date.parse('2026-09-23T00:00:00Z');
const SIM0 = Date.parse('2025-03-01T08:00:00Z');
const SYMBOL = 'KAITOUSDT';
const KEY = (k: string) => `sim_anon_${k}`;

const wrapper = ({ children }: { children: React.ReactNode }) => <TradingProvider>{children}</TradingProvider>;

const coinPosition = {
  id: 'long', side: 'LONG', entryPrice: 1.1, quantity: 40_000, contracts: 40_000, contractSizeUsd: 10, leverage: 2,
  openLeverage: 2, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'KAITO', margin: 200_000,
  isolatedMargin: 200_000, marginCoin: 181_818.18, openTime: SIM0 - 60_000, riskModel: 'binance-tiers-v1', riskSymbol: SYMBOL,
};
const coinOrder = {
  price: 0, contractSizeUsd: 10, leverage: 2, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'KAITO',
  status: 'PENDING', createdAt: SIM0 - 30_000, triggerDirection: 'DOWN', operator: '<=', lotSizeRule: 'binance-lot-size-v1',
};

function mountWith(positions: unknown[], orders: unknown[]) {
  localStorage.setItem(KEY('positions_map'), JSON.stringify(positions.length ? { [SYMBOL]: positions } : {}));
  localStorage.setItem(KEY('orders_map'), JSON.stringify({ [SYMBOL]: orders }));
  const view = renderHook(() => { useBackgroundPrices(); return useTradingContext(); }, { wrapper });
  act(() => {
    view.result.current.forkReplayTimeline(SYMBOL, 'start', SIM0);
    view.result.current.sim.startSimulation(SIM0);
  });
  return view;
}

async function poll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
}


/**
 * 这些用例写的全是「币安标准」持仓限制模式的规则（分层上限、单笔上限、分层维持保证金）；
 * 持仓限制模式默认是无限制（lib/positionLimitMode），所以每次清空存储之后显式选回币安标准。
 */
function resetStorageBinance() {
  localStorage.clear();
  localStorage.setItem(KEY('position_limit_mode'), JSON.stringify('binance'));
}

beforeEach(() => {
  resetStorageBinance();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(T0);
  // 这一根 K 线穿过 1.0：两张单都在 1.0 上触发，合成币本位在 1.0 上一笔最多 20,000 张
  vi.mocked(fetchCanonicalTimePriceAt).mockResolvedValue({ high: 1.02, low: 0.99, close: 1.0 } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('后台标的：触发时超过单笔市价上限', () => {
  it('开仓条件单（23,000 张 @1.0）：撤单留痕、不建仓，消息中心说「触发时超过单笔市价上限」', async () => {
    const view = mountWith([], [{ ...coinOrder, id: 'bg-cond', side: 'LONG', type: 'CONDITIONAL', stopPrice: 1.0, quantity: 23_000, contracts: 23_000, riskModel: 'binance-tiers-v1' }]);
    const error = vi.spyOn(toast, 'error');
    await poll();
    expect(error.mock.calls.map(c => String(c[0]))).toContain('触发时超过单笔市价上限，委托已撤销');
    expect(view.result.current.ordersMap[SYMBOL] ?? []).toHaveLength(0);
    expect((view.result.current.positionsMap[SYMBOL] ?? []).filter(p => (p.contracts ?? 0) > 0)).toHaveLength(0);
    const cancelled = JSON.parse(localStorage.getItem(KEY('cancelled_orders')) ?? '[]') as { id: string }[];
    expect(cancelled.map(c => c.id)).toContain('bg-cond');
    act(() => view.result.current.sim.stopSimulation());
    view.unmount();
  });

  it('按成数（50%）的止损（20,001 张 @1.0）：撤单留痕，说清仓位此刻没有这张止损的保护；仓位原样', async () => {
    const view = mountWith([coinPosition], [{
      ...coinOrder, id: 'bg-sl', side: 'SHORT', type: 'CONDITIONAL', stopPrice: 1.0, quantity: 20_001, contracts: 20_001,
      conditionalExecType: 'MARKET', reduceOnly: true, reduceSymbol: SYMBOL, reducePositionSide: 'LONG',
      linkedPositionId: 'long', reduceKind: 'SL', reducePercentage: 50,
    }]);
    const error = vi.spyOn(toast, 'error');
    await poll();
    const call = error.mock.calls.find(c => String(c[0]) === '止损触发时超过单笔市价上限，委托已撤销');
    expect(call).toBeDefined();
    expect(String((call?.[1] as { description?: string })?.description)).toContain('这个仓位此刻没有这张止损的保护');
    expect(view.result.current.ordersMap[SYMBOL] ?? []).toHaveLength(0);
    expect((view.result.current.positionsMap[SYMBOL] ?? []).map(p => p.contracts)).toEqual([40_000]);
    act(() => view.result.current.sim.stopSimulation());
    view.unmount();
  });

  it('100% 的止损（40,000 张，平掉整个仓位）：不受单笔上限约束，照常触发平光', async () => {
    const view = mountWith([coinPosition], [{
      ...coinOrder, id: 'bg-sl-all', side: 'SHORT', type: 'CONDITIONAL', stopPrice: 1.0, quantity: 40_000, contracts: 40_000,
      conditionalExecType: 'MARKET', reduceOnly: true, reduceSymbol: SYMBOL, reducePositionSide: 'LONG',
      linkedPositionId: 'long', reduceKind: 'SL', reducePercentage: 100,
    }]);
    const error = vi.spyOn(toast, 'error');
    await poll();
    expect(error.mock.calls.map(c => String(c[0]))).not.toContain('止损触发时超过单笔市价上限，委托已撤销');
    expect((view.result.current.positionsMap[SYMBOL] ?? []).filter(p => (p.contracts ?? 0) > 0)).toHaveLength(0);
    act(() => view.result.current.sim.stopSimulation());
    view.unmount();
  });
});

/**
 * 后台成交按**成交那一刻**的持仓限制模式定仓位的维持保证金模型（useBackgroundPrices 把 getPositionLimitMode() 传给
 * executeSettlementFill）：无限制模式下开出的仓位盖 'unlimited-v1'、按 0.4%；漏传就按币安标准盖分层戳——
 * 23,000 张 20x 在分层下一开出来就被强平。同一张单在币安标准下触发时超单笔上限被撤（见上面第一条）。
 */
describe('后台标的：无限制模式下触发成交', () => {
  it('开仓条件单（23,000 张 @1.0，超过币安单笔上限）：照常成交，开出的仓位按 0.4%（unlimited-v1）', async () => {
    localStorage.setItem(KEY('position_limit_mode'), JSON.stringify('unlimited'));
    const view = mountWith([], [{ ...coinOrder, id: 'bg-cond-u', side: 'LONG', type: 'CONDITIONAL', stopPrice: 1.0, quantity: 23_000, contracts: 23_000, riskModel: 'binance-tiers-v1', limitModeAtPlacement: 'unlimited' }]);
    const error = vi.spyOn(toast, 'error');
    await poll();
    expect(error.mock.calls.map(c => String(c[0]))).not.toContain('触发时超过单笔市价上限，委托已撤销');
    const opened = (view.result.current.positionsMap[SYMBOL] ?? []).filter(p => (p.contracts ?? 0) > 0);
    expect(opened.map(p => [p.contracts, p.riskModel])).toEqual([[23_000, 'unlimited-v1']]);
    act(() => view.result.current.sim.stopSimulation());
    view.unmount();
  });

  it('币安标准下同一类单（放得下的 10,000 张）：开出的仓位沿用委托的分层戳', async () => {
    const view = mountWith([], [{ ...coinOrder, id: 'bg-cond-b', side: 'LONG', type: 'CONDITIONAL', stopPrice: 1.0, quantity: 10_000, contracts: 10_000, riskModel: 'binance-tiers-v1' }]);
    await poll();
    const opened = (view.result.current.positionsMap[SYMBOL] ?? []).filter(p => (p.contracts ?? 0) > 0);
    expect(opened.map(p => [p.contracts, p.riskModel])).toEqual([[10_000, 'binance-tiers-v1']]);
    act(() => view.result.current.sim.stopSimulation());
    view.unmount();
  });
});
