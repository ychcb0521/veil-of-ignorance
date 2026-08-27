import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundPrices } from '@/hooks/useBackgroundPrices';
import { fetchCanonicalTimePriceAt } from '@/lib/canonicalTimePrice';
import { useTradingContext } from '@/contexts/TradingContext';
import type { PendingOrder } from '@/types/trading';

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: vi.fn(),
}));

vi.mock('@/lib/canonicalTimePrice', () => ({
  fetchCanonicalTimePriceAt: vi.fn(),
}));

function Harness() {
  useBackgroundPrices();
  return null;
}

describe('useBackgroundPrices', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchCanonicalTimePriceAt).mockResolvedValue({
      high: 1,
      low: 1,
      close: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('fetches each symbol at its own effective replay time', async () => {
    const setPriceMap = vi.fn((updater: (prev: Record<string, number>) => Record<string, number>) => updater({}));
    const getEffectiveTime = vi.fn((symbol?: string) => {
      if (symbol === 'ALPACAUSDT') return 1_745_653_020_000;
      if (symbol === 'EVAAUSDT') return 1_783_466_400_000;
      return 0;
    });

    vi.mocked(useTradingContext).mockReturnValue({
      sim: { isRunning: true, currentSimulatedTime: 9_999_999_999_999 },
      activeSymbol: 'EVAAUSDT',
      activeSymbols: ['ALPACAUSDT'],
      setPriceMap,
      markPriceAsOf: vi.fn(),
      ordersMap: {},
      positionsMap: {},
      setOrdersMap: vi.fn(),
      setPositionsMap: vi.fn(),
      setBalance: vi.fn(),
      setTradeHistory: vi.fn(),
      tradingMode: 'direct',
      getEffectiveTime,
      recordExecutionTrade: vi.fn(),
      executeReduceOnlyTrigger: vi.fn(),
    } as unknown as ReturnType<typeof useTradingContext>);

    render(<Harness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchCanonicalTimePriceAt).toHaveBeenCalledWith('ALPACAUSDT', 1_745_653_020_000);
    expect(fetchCanonicalTimePriceAt).toHaveBeenCalledWith('EVAAUSDT', 1_783_466_400_000);
    expect(fetchCanonicalTimePriceAt).not.toHaveBeenCalledWith(expect.any(String), 9_999_999_999_999);
  });

  it('matches reduce-only orders only for background symbols through the shared executor', async () => {
    const executeReduceOnlyTrigger = vi.fn(() => ({ ok: true }));
    const makeOrder = (id: string): PendingOrder => ({
      id,
      side: 'SHORT',
      type: 'CONDITIONAL',
      price: 0,
      stopPrice: 1,
      quantity: 1,
      leverage: 5,
      marginMode: 'cross',
      status: 'PENDING',
      createdAt: 100,
      operator: '>=',
      triggerDirection: 'UP',
      reduceOnly: true,
      reduceSymbol: id === 'active-tp' ? 'ACTIVEUSDT' : 'BACKGROUNDUSDT',
      reducePositionSide: 'LONG',
      linkedPositionId: `${id}-position`,
      reduceKind: 'TP',
    });
    const activeOrder = makeOrder('active-tp');
    const backgroundOrder = makeOrder('background-tp');

    vi.mocked(useTradingContext).mockReturnValue({
      sim: { isRunning: true },
      activeSymbol: 'ACTIVEUSDT',
      activeSymbols: ['ACTIVEUSDT', 'BACKGROUNDUSDT'],
      setPriceMap: vi.fn(),
      markPriceAsOf: vi.fn(),
      ordersMap: {
        ACTIVEUSDT: [activeOrder],
        BACKGROUNDUSDT: [backgroundOrder],
      },
      setOrdersMap: vi.fn(),
      setPositionsMap: vi.fn(),
      setBalance: vi.fn(),
      tradingMode: 'direct',
      getEffectiveTime: vi.fn(() => 1_000),
      recordExecutionTrade: vi.fn(),
      executeReduceOnlyTrigger,
    } as unknown as ReturnType<typeof useTradingContext>);

    render(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(executeReduceOnlyTrigger).toHaveBeenCalledTimes(1);
    expect(executeReduceOnlyTrigger).toHaveBeenCalledWith(
      'BACKGROUNDUSDT',
      backgroundOrder,
      1,
      1_000,
    );
    expect(executeReduceOnlyTrigger).not.toHaveBeenCalledWith(
      'ACTIVEUSDT',
      activeOrder,
      expect.any(Number),
      expect.any(Number),
    );
  });

  /**
   * 非当前标的的撮合此前**自己手算**成交:
   *   fee    = calcFee(fillPrice, order.quantity)
   *   margin = order.quantity × fillPrice ÷ leverage
   * 那是线性合约的式子。币本位的 quantity 是**张**,名义 = 张 × 面值(USD),与价无关。
   * 100 张 × 10 USD = 1000 USD 名义,3x 杠杆应收 333.33 USD 保证金;
   * 手算式给出 0.3448 USD —— 少收 966.74 倍,而这个倍数恰好就是「一张等于多少币」。
   * 更糟的是建出来的仓位不带 settlementMode / contracts / contractSizeUsd,
   * 此后每一处 getPositionNotionalUsd 都走 U 本位分支。
   */
  describe('币本位挂单在非当前标的上成交', () => {
    const FACE = 10;
    const CONTRACTS = 100;
    const LEV = 3;
    const TRIGGER = 0.010344;

    const coinOrder = (): PendingOrder => ({
      id: 'bg-coin',
      side: 'LONG',
      type: 'CONDITIONAL',
      price: 0,
      stopPrice: TRIGGER,
      quantity: CONTRACTS,
      contracts: CONTRACTS,
      contractSizeUsd: FACE,
      settlementMode: 'coin',
      settlementAsset: 'NOM',
      leverage: LEV,
      marginMode: 'isolated',
      status: 'PENDING',
      createdAt: 100,
      operator: '<=',
      triggerDirection: 'DOWN',
    } as PendingOrder);

    async function runFill() {
      const setBalance = vi.fn();
      const setPositionsMap = vi.fn();
      const setFilledOrders = vi.fn();
      const recordExecutionTrade = vi.fn();
      vi.mocked(fetchCanonicalTimePriceAt).mockResolvedValue({ high: 0.011, low: 0.0102, close: 0.0105 });
      vi.mocked(useTradingContext).mockReturnValue({
        sim: { isRunning: true },
        activeSymbol: 'ACTIVEUSDT',
        activeSymbols: ['ACTIVEUSDT', 'NOMUSD'],
        setPriceMap: vi.fn(),
        markPriceAsOf: vi.fn(),
        ordersMap: { NOMUSD: [coinOrder()] },
        setOrdersMap: vi.fn(),
        setPositionsMap,
        setBalance,
        setFilledOrders,
        tradingMode: 'direct',
        getEffectiveTime: vi.fn(() => 1_000),
        recordExecutionTrade,
        executeReduceOnlyTrigger: vi.fn(),
      } as unknown as ReturnType<typeof useTradingContext>);

      render(<Harness />);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      return { setBalance, setPositionsMap, setFilledOrders, recordExecutionTrade };
    }

    it('【回归】按 张 × 面值 收保证金,不是按 张 × 价', async () => {
      const { setBalance } = await runFill();
      expect(setBalance).toHaveBeenCalledTimes(1);
      const charged = 1_000_000 - setBalance.mock.calls[0][0](1_000_000);
      // 名义 1000 USD ÷ 3 = 333.333 保证金,+ 1000 × 0.0004 = 0.4 手续费
      expect(charged).toBeCloseTo(1000 / LEV + 1000 * 0.0004, 6);
      // 旧式给出的是 0.3448 + 0.0005 —— 少收将近三个数量级
      expect(charged).toBeGreaterThan(300);
    });

    it('【回归】建出来的仓位带齐结算字段,否则此后全按 U 本位读', async () => {
      const { setPositionsMap } = await runFill();
      const next = setPositionsMap.mock.calls[0][0]({ NOMUSD: [] });
      const pos = next.NOMUSD[0];
      expect(pos.settlementMode).toBe('coin');
      expect(pos.settlementAsset).toBe('NOM');
      expect(pos.contracts).toBe(CONTRACTS);
      expect(pos.contractSizeUsd).toBe(FACE);
      expect(pos.marginCoin).toBeGreaterThan(0);
      // 逐仓保证金也要按 USD 名义,而不是 张 × 价
      expect(pos.isolatedMargin).toBeCloseTo(1000 / LEV, 6);
    });

    it('【回归】成交要落 filled_orders,否则战役页永远看不到这条腿', async () => {
      const { setFilledOrders } = await runFill();
      expect(setFilledOrders).toHaveBeenCalledTimes(1);
      const snap = setFilledOrders.mock.calls[0][0]([])[0];
      expect(snap.id).toBe('bg-coin');
      expect(snap.contracts).toBe(CONTRACTS);
      expect(snap.settlementMode).toBe('coin');
      expect(snap.triggerPrice).toBeCloseTo(TRIGGER, 9);
    });

    it('【回归】执行力资产收到的名义是 USD 名义,不是 张 × 价', async () => {
      const { recordExecutionTrade } = await runFill();
      expect(recordExecutionTrade).toHaveBeenCalledTimes(1);
      const trade = recordExecutionTrade.mock.calls[0][1];
      expect(trade.notionalUsd).toBeCloseTo(1000, 6);
      expect(trade.settlementMode).toBe('coin');
      expect(trade.contracts).toBe(CONTRACTS);
      // 旧式写的是 order.quantity × fillPrice ≈ 1.03
      expect(trade.notional).toBeGreaterThan(900);
    });
  });
});
