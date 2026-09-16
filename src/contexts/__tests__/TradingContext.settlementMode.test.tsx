import React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, profile: null }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(() => ({ upsert: vi.fn(async () => ({ error: null })) })) },
}));

import { TradingProvider, useTradingContext, type PlaceOrderParams } from '@/contexts/TradingContext';
import { AddSizingCalculator } from '@/components/AddSizingCalculator';

/**
 * 下单面板的结算方式，走真实的 TradingProvider：
 * 默认币本位；会话内可以切到 U 本位；刷新 / 重开（新的 Provider 实例）一律回到币本位，
 * 本地残留的旧条目被忽略并清掉，切换也不再落盘。
 * 仓位自己带的 settlementMode 是另一张合约（RUNEUSD 与 RUNEUSDT）——U 本位仓位重开后仍是 U 本位。
 */

const T0 = Date.parse('2026-09-15T00:00:00Z');
const SIM0 = Date.parse('2024-01-15T08:00:00Z');
/** 未登录时 usePersistedState 的前缀是 sim_anon_；旧版本就落在这个键下。 */
const STALE_KEY = 'sim_anon_symbol_settlement_mode';

const wrapper = ({ children }: { children: React.ReactNode }) => <TradingProvider>{children}</TradingProvider>;
const mount = () => renderHook(() => useTradingContext(), { wrapper });

/** 不带 settlementMode：让下单路径去问面板当前的结算方式。 */
const marketLong = (over: Partial<PlaceOrderParams> = {}): PlaceOrderParams => ({
  side: 'LONG', type: 'MARKET', price: 0, stopPrice: 0, quantity: 1, leverage: 10, marginMode: 'isolated',
  priceSelection: 'MARKET', triggerType: 'LAST', currencyUnit: 'BASE', usdtInputMode: 'ORDER_VALUE', inputAmount: 1,
  latestPrice: 100,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('下单面板的结算方式', () => {
  it('新标的默认币本位', () => {
    const { result } = mount();
    expect(result.current.getSymbolSettlementMode('RUNEUSD')).toBe('coin');
    expect(result.current.settlementModeMap).toEqual({});
  });

  it('会话内切到 U 本位即生效，按标的各记各的，还能切回来', () => {
    const { result } = mount();
    act(() => result.current.setSymbolSettlementMode('RUNEUSD', 'usdt'));
    expect(result.current.getSymbolSettlementMode('RUNEUSD')).toBe('usdt');
    expect(result.current.getSymbolSettlementMode('BTCUSD')).toBe('coin');
    expect(result.current.settlementModeMap).toEqual({ RUNEUSD: 'usdt' });
    act(() => result.current.setSymbolSettlementMode('RUNEUSD', 'coin'));
    expect(result.current.getSymbolSettlementMode('RUNEUSD')).toBe('coin');
  });

  it('切换不再落盘：本地没有这个键，也没有影子时间戳', () => {
    const { result } = mount();
    act(() => result.current.setSymbolSettlementMode('RUNEUSD', 'usdt'));
    expect(localStorage.getItem(STALE_KEY)).toBeNull();
    expect(localStorage.getItem(`${STALE_KEY}__syncts`)).toBeNull();
    expect(Object.keys(localStorage).filter(k => k.includes('settlement'))).toEqual([]);
  });

  it('重新挂载（刷新 / 重开）：回到币本位', () => {
    const first = mount();
    act(() => first.result.current.setSymbolSettlementMode('RUNEUSD', 'usdt'));
    expect(first.result.current.getSymbolSettlementMode('RUNEUSD')).toBe('usdt');
    first.unmount();
    const second = mount();
    expect(second.result.current.getSymbolSettlementMode('RUNEUSD')).toBe('coin');
    expect(second.result.current.settlementModeMap).toEqual({});
  });

  it('旧版本残留的本地条目：一律忽略，并在挂载时清掉（含影子时间戳）', () => {
    localStorage.setItem(STALE_KEY, JSON.stringify({ RUNEUSD: 'usdt', BTCUSD: 'usdt' }));
    localStorage.setItem(`${STALE_KEY}__syncts`, String(T0));
    const { result } = mount();
    expect(result.current.getSymbolSettlementMode('RUNEUSD')).toBe('coin');
    expect(result.current.getSymbolSettlementMode('BTCUSD')).toBe('coin');
    expect(localStorage.getItem(STALE_KEY)).toBeNull();
    expect(localStorage.getItem(`${STALE_KEY}__syncts`)).toBeNull();
  });

  it('U 本位下开的仓位重开后仍是 U 本位——面板回落只管面板，不改仓位自己的合约', () => {
    const first = mount();
    act(() => { first.result.current.setPriceMap({ BTCUSDT: 100 }); });
    act(() => {
      first.result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      first.result.current.sim.startSimulation(SIM0);
    });
    act(() => first.result.current.setSymbolSettlementMode('BTCUSDT', 'usdt'));
    act(() => { first.result.current.handlePlaceOrder('BTCUSDT', marketLong()); });
    expect(first.result.current.positionsMap.BTCUSDT[0].settlementMode).toBe('usdt');
    // 停钟再卸载：重开后的仓位对照与时钟无关，别让恢复中的钟在断言之外继续更新状态
    act(() => first.result.current.sim.stopSimulation());
    first.unmount();

    const second = mount();
    expect(second.result.current.positionsMap.BTCUSDT[0].settlementMode).toBe('usdt');
    expect(second.result.current.getSymbolSettlementMode('BTCUSDT')).toBe('coin');
  });

  it('【回归】重开后的加仓计算器按仓位自己的合约（U 本位）折算，不按面板回落后的币本位', () => {
    const first = mount();
    act(() => { first.result.current.setPriceMap({ BTCUSDT: 100 }); });
    act(() => {
      first.result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      first.result.current.sim.startSimulation(SIM0);
    });
    act(() => first.result.current.setSymbolSettlementMode('BTCUSDT', 'usdt'));
    act(() => { first.result.current.handlePlaceOrder('BTCUSDT', marketLong()); });
    expect(first.result.current.positionsMap.BTCUSDT[0].settlementMode).toBe('usdt');
    act(() => first.result.current.sim.stopSimulation());
    first.unmount();

    // 刷新：新的 Provider 实例，面板回到币本位；计算器给这条 U 本位仓位加仓，G 必须以 USD 计
    render(
      <TradingProvider>
        <MemoryRouter>
          <AddSizingCalculator open onClose={() => {}} symbol="BTCUSDT" currentPrice={100} />
        </MemoryRouter>
      </TradingProvider>,
    );
    expect(screen.getByText('G 落袋净额 USD')).toBeInTheDocument();
    expect(screen.queryByText('G 落袋净额 BTC')).toBeNull();
  });
});
