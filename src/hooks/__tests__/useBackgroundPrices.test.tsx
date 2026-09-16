import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundPrices } from '@/hooks/useBackgroundPrices';
import { fetchCanonicalTimePriceAt } from '@/lib/canonicalTimePrice';
import { useTradingContext } from '@/contexts/TradingContext';
import type { AddSizingSnapshot, PendingOrder, Position } from '@/types/trading';

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
      applyAttachedTpSl: vi.fn(),
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
      applyAttachedTpSl: vi.fn(),
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
      createdTimelineId: 'tl-placed',
      operator: '<=',
      triggerDirection: 'DOWN',
    } as PendingOrder);

    async function runFill(
      affordable = true,
      order: PendingOrder = coinOrder(),
      /**
       * 成交复判的入口与「成交前的持仓」：给了 held，setPositionsMap 就像真的即时包装那样当场跑 updater，
       * 复判才读得到合并之前的那一份。
       */
      extra: { judgePlannedAddFill?: ReturnType<typeof vi.fn>; held?: Position[] } = {},
    ) {
      const setBalance = vi.fn();
      const setPositionsMap = extra.held
        ? vi.fn((updater: (prev: Record<string, Position[]>) => Record<string, Position[]>) => updater({ NOMUSD: extra.held! }))
        : vi.fn();
      const setFilledOrders = vi.fn();
      const recordExecutionTrade = vi.fn();
      // 每个标的各有自己的钟：返回值随标的不同，才能验出「用错了钟」。
      const stampClock = vi.fn((symbol?: string) => (symbol === 'NOMUSD' ? 'tl-nom' : 'tl-active'));
      // 显式给出真实签名：vi.fn(() => bool) 会把入参推成空元组，
      // 于是 mock.calls[0] 取不到 margin/fee，断言反而变成空转。
      const settleFillDebit = vi.fn(
        (_symbol: string, _order: PendingOrder, _marginUsd: number, _feeUsd: number, _cancelledAt: number) => affordable,
      );
      vi.mocked(fetchCanonicalTimePriceAt).mockResolvedValue({ high: 0.011, low: 0.0102, close: 0.0105 });
      vi.mocked(useTradingContext).mockReturnValue({
        sim: { isRunning: true },
        activeSymbol: 'ACTIVEUSDT',
        activeSymbols: ['ACTIVEUSDT', 'NOMUSD'],
        setPriceMap: vi.fn(),
        markPriceAsOf: vi.fn(),
        ordersMap: { NOMUSD: [order] },
        setOrdersMap: vi.fn(),
        setPositionsMap,
        setBalance,
        setFilledOrders,
        settleFillDebit,
        tradingMode: 'direct',
        getEffectiveTime: vi.fn(() => 1_000),
        stampClock,
        recordExecutionTrade,
        executeReduceOnlyTrigger: vi.fn(),
        applyAttachedTpSl: vi.fn(),
        applyMergeSideEffects: vi.fn(),
        ...(extra.judgePlannedAddFill ? { judgePlannedAddFill: extra.judgePlannedAddFill } : {}),
      } as unknown as ReturnType<typeof useTradingContext>);

      render(<Harness />);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      return { setBalance, setPositionsMap, setFilledOrders, recordExecutionTrade, settleFillDebit, stampClock };
    }

    it('成交盖的是**后台标的自己那只钟**的时间线章：快照两枚、仓位与每笔成交各一枚', async () => {
      const { setFilledOrders, setPositionsMap, stampClock } = await runFill();
      expect(stampClock).toHaveBeenCalledWith('NOMUSD');
      expect(stampClock).not.toHaveBeenCalledWith('ACTIVEUSDT');
      const snap = setFilledOrders.mock.calls[0][0]([])[0];
      expect(snap.createdTimelineId).toBe('tl-placed');
      expect(snap.filledTimelineId).toBe('tl-nom');
      const pos = setPositionsMap.mock.calls[0][0]({ NOMUSD: [] }).NOMUSD[0];
      expect(pos.openTimelineId).toBe('tl-nom');
      expect(pos.fills[0].timelineId).toBe('tl-nom');
    });

    it('【回归】按 张 × 面值 收保证金,不是按 张 × 价', async () => {
      const { settleFillDebit } = await runFill();
      expect(settleFillDebit).toHaveBeenCalledTimes(1);
      const [, , marginUsd, feeUsd] = settleFillDebit.mock.calls[0];
      // 名义 1000 USD ÷ 3 = 333.333 保证金；手续费 = 名义 × 费率（币安口径）。
      // 这张是 CONDITIONAL：触发后按市价成交 → Taker 0.05% = 0.5。
      expect(marginUsd).toBeCloseTo(1000 / LEV, 6);
      expect(feeUsd).toBeCloseTo(1000 * 0.0005, 6);
      // 旧式给出的是 0.3448 + 0.0005 —— 少收将近三个数量级
      expect(marginUsd).toBeGreaterThan(300);
    });

    it('【回归】付不起就不建仓、不落成交、不计执行力资产', async () => {
      const { setPositionsMap, setFilledOrders, recordExecutionTrade } = await runFill(false);
      expect(setPositionsMap).not.toHaveBeenCalled();
      expect(setFilledOrders).not.toHaveBeenCalled();
      expect(recordExecutionTrade).not.toHaveBeenCalled();
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

    it('【回归 · 二审】带着加仓计划的挂单在后台成交：成交快照与仓位都带上计划，与盘面撮合一致；没有计划的快照不多这个字段', async () => {
      const plan: AddSizingSnapshot = {
        at: 1, plan: 'A', side: 'LONG', settlement: 'coin', s1: 0.0101, s2Ref: TRIGGER, s2Fill: TRIGGER, slippagePct: 0,
        s2AtOrder: TRIGGER, x1: 1_000, sBar: 0.0095, g: 0, gUnit: 'NOM', addCoinsMax: 100_000, contracts: 100, orderKind: 'limit',
      };
      const { setFilledOrders, setPositionsMap } = await runFill(true, { ...coinOrder(), addSizingSnapshot: plan });
      expect(setFilledOrders.mock.calls[0][0]([])[0].addSizingSnapshot).toEqual(plan);
      expect(setPositionsMap.mock.calls[0][0]({ NOMUSD: [] }).NOMUSD[0].addSizingSnapshot).toEqual(plan);
    });

    /**
     * 【回归 · 三审】后台标的上的条件委托触发后按市价成交（Taker，在触发价上加滑点）：带着计划就按实际成交价复判，
     * 参考价取触发价、持仓取合并之前的那一份——与盘面的条件单触发、市价单同一个入口。挂单价原价成交的限价单不判。
     */
    it('【回归 · 三审】带着计划的条件委托在后台触发：按触发价复判一次（合并前的持仓）；限价单成交不判', async () => {
      const plan: AddSizingSnapshot = {
        at: 1, plan: 'A', side: 'LONG', settlement: 'coin', s1: 0.0101, s2Ref: TRIGGER, s2Fill: TRIGGER * 1.0001, slippagePct: 0.01,
        s2AtOrder: TRIGGER, x1: 1_000, sBar: 0.0095, g: 0, gUnit: 'NOM', addCoinsMax: 100_000, contracts: 100, orderKind: 'conditional',
      };
      const held = [{
        id: 'held', side: 'LONG', entryPrice: 0.0095, quantity: 50, contracts: 50, contractSizeUsd: FACE, settlementMode: 'coin',
        settlementAsset: 'NOM', leverage: LEV, marginMode: 'isolated', margin: 100, openTime: 10,
      } as Position];
      const judgePlannedAddFill = vi.fn();
      const { setPositionsMap } = await runFill(true, { ...coinOrder(), addSizingSnapshot: plan }, { judgePlannedAddFill, held });
      expect(judgePlannedAddFill).toHaveBeenCalledTimes(1);
      const [symbol, heldBefore, position, referencePrice, snapshot] = judgePlannedAddFill.mock.calls[0];
      expect(symbol).toBe('NOMUSD');
      expect(heldBefore).toEqual(held);
      expect(referencePrice).toBeCloseTo(TRIGGER, 12);
      expect(snapshot).toBe(plan);
      // 成交价是触发价加滑点（Taker），不是触发价本身
      expect(position.entryPrice).toBeGreaterThan(TRIGGER);
      expect(position.addSizingSnapshot).toEqual(plan);
      expect(setPositionsMap).toHaveBeenCalledTimes(1);

      // 限价单（Maker，挂单价原价成交）不走复判
      cleanup();
      vi.mocked(fetchCanonicalTimePriceAt).mockResolvedValue({ high: 0.011, low: 0.0102, close: 0.0105 });
      const judgeLimit = vi.fn();
      const limitOrder = { ...coinOrder(), id: 'bg-limit', type: 'LIMIT', price: 0.0103, stopPrice: 0, addSizingSnapshot: { ...plan, orderKind: 'limit' } } as PendingOrder;
      const limitRun = await runFill(true, limitOrder, { judgePlannedAddFill: judgeLimit, held });
      // 限价单确实成交了（建了仓），只是不复判
      expect(limitRun.setPositionsMap).toHaveBeenCalledTimes(1);
      expect(judgeLimit).not.toHaveBeenCalled();
    });

    it('没有计划的后台成交：快照里没有 addSizingSnapshot 这个键', async () => {
      const { setFilledOrders } = await runFill();
      expect('addSizingSnapshot' in setFilledOrders.mock.calls[0][0]([])[0]).toBe(false);
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

  /**
   * 隔离模式一个币一只钟。没启动过的币（同步模式切过来时留下的挂单、从没点过开始的币）没有时间：
   * getEffectiveTime 对它退回全局 sim 的时刻——那只钟在隔离模式下只是「有没有币在跑」的开关。
   * 原来照样拿它撮合：成交没有回放时间线可盖（stampClock 看的是 coin:<symbol> 那只钟，停着 → null），
   * 委托的挂单章却指向已结束的同步时间线，读取侧只能把这笔成交判成另一条线上的。
   */
  describe('隔离模式：没有自己的钟的币不撮合', () => {
    const leftover = (): PendingOrder => ({
      id: 'bbb-limit', side: 'LONG', type: 'LIMIT', price: 90, stopPrice: 0, quantity: 1, leverage: 5,
      marginMode: 'isolated', status: 'NEW', createdAt: 100, createdTimelineId: 'tl-synced-ended',
    } as PendingOrder);
    const running = { status: 'playing', time: 1_000, speed: 1, historicalAnchorTime: 1_000, realStartTime: 1, originTime: 1_000 };

    function mountIsolated(bbbClock: Record<string, unknown> | null) {
      const setPositionsMap = vi.fn();
      const setFilledOrders = vi.fn();
      const stampClock = vi.fn(() => null);
      vi.mocked(fetchCanonicalTimePriceAt).mockResolvedValue({ high: 100, low: 80, close: 90 });
      vi.mocked(useTradingContext).mockReturnValue({
        sim: { isRunning: true, currentSimulatedTime: 1_000 },
        activeSymbol: 'AAAUSDT',
        activeSymbols: ['AAAUSDT', 'BBBUSDT'],
        setPriceMap: vi.fn(),
        markPriceAsOf: vi.fn(),
        ordersMap: { BBBUSDT: [leftover()] },
        setOrdersMap: vi.fn(),
        setPositionsMap,
        setBalance: vi.fn(),
        setFilledOrders,
        settleFillDebit: vi.fn(() => true),
        tradingMode: 'direct',
        timeMode: 'isolated',
        coinTimelines: { AAAUSDT: running, ...(bbbClock ? { BBBUSDT: bbbClock } : {}) },
        getEffectiveTime: vi.fn(() => 1_000),
        stampClock,
        recordExecutionTrade: vi.fn(),
        executeReduceOnlyTrigger: vi.fn(),
        applyAttachedTpSl: vi.fn(),
      } as unknown as ReturnType<typeof useTradingContext>);
      render(<Harness />);
      return { setPositionsMap, setFilledOrders, stampClock };
    }

    it('【回归】BBB 没有自己的钟：价照取，单不撮合，也不去取一枚空章', async () => {
      const { setPositionsMap, setFilledOrders, stampClock } = mountIsolated(null);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(fetchCanonicalTimePriceAt).toHaveBeenCalledWith('BBBUSDT', 1_000);
      expect(setPositionsMap).not.toHaveBeenCalled();
      expect(setFilledOrders).not.toHaveBeenCalled();
      expect(stampClock).not.toHaveBeenCalled();
    });

    it('调倍速造出的占位条目（没有锚点）同样不算在跑', async () => {
      const { setPositionsMap } = mountIsolated({ status: 'paused', time: 0, speed: 60, historicalAnchorTime: null, realStartTime: null, originTime: null });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(setPositionsMap).not.toHaveBeenCalled();
    });

    it('BBB 的钟在跑（暂停也算）：照常撮合、照常盖章', async () => {
      const { setPositionsMap, stampClock } = mountIsolated({ status: 'paused', time: 1_000, speed: 1, historicalAnchorTime: 1_000, realStartTime: null, originTime: 1_000 });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(setPositionsMap).toHaveBeenCalledTimes(1);
      expect(stampClock).toHaveBeenCalledWith('BBBUSDT');
    });
  });

  /**
   * 这一组用「会变的模拟时间」驱动。
   * 其余用例把 currentSimulatedTime 写成常量，effect 不会重装定时器——
   * 正是这一点让「定时器每 250ms 被清掉重装、永远等不到第 1000ms」藏了下来。
   */
  describe('【回归】播放中模拟时间每 250ms 前进，1 秒轮询仍必须触发', () => {
    function mountWithTickingClock() {
      let simTime = 1_700_000_000_000;
      const getEffectiveTime = vi.fn((_symbol?: string) => simTime);
      const build = () => ({
        sim: { isRunning: true, currentSimulatedTime: simTime },
        activeSymbol: 'BTCUSDT',
        activeSymbols: ['ETHUSDT'],
        setPriceMap: vi.fn((u: (p: Record<string, number>) => Record<string, number>) => u({})),
        markPriceAsOf: vi.fn(),
        ordersMap: {},
        positionsMap: {},
        setOrdersMap: vi.fn(),
        setPositionsMap: vi.fn(),
        setBalance: vi.fn(),
        setTradeHistory: vi.fn(),
        tradingMode: 'direct',
        // 每次重渲染都换一个新函数身份，复刻 getEffectiveTime 随 sim 时间重建的真实情形
        getEffectiveTime: ((s: string) => getEffectiveTime(s)) as unknown as typeof getEffectiveTime,
        recordExecutionTrade: vi.fn(),
        executeReduceOnlyTrigger: vi.fn(),
        applyAttachedTpSl: vi.fn(),
      });
      vi.mocked(useTradingContext).mockImplementation(() => build() as unknown as ReturnType<typeof useTradingContext>);
      const view = render(<Harness />);
      return {
        /** 推进 ms 毫秒，其间每 250ms 让模拟时间前进并重渲染（= RAF 的 React flush）。 */
        advance: async (ms: number) => {
          for (let elapsed = 0; elapsed < ms; elapsed += 250) {
            await act(async () => {
              simTime += 250 * 60;   // 60 倍速
              view.rerender(<Harness />);
              await vi.advanceTimersByTimeAsync(250);
            });
          }
        },
      };
    }

    it('时间在走时，1 秒后后台标的仍被取价（旧实现一次都取不到）', async () => {
      const { advance } = mountWithTickingClock();
      await advance(1000);
      expect(fetchCanonicalTimePriceAt).toHaveBeenCalledWith('ETHUSDT', expect.any(Number));
    });

    it('连跑 3 秒至少取到 3 轮，说明定时器没有被反复重装', async () => {
      const { advance } = mountWithTickingClock();
      await advance(3000);
      const ethCalls = vi.mocked(fetchCanonicalTimePriceAt).mock.calls.filter(c => c[0] === 'ETHUSDT');
      expect(ethCalls.length).toBeGreaterThanOrEqual(3);
    });
  });
});
