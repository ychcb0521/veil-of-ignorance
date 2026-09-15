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
import { REPLAY_STAMP_PERSIST_THROTTLE_MS, type ReplayTimelineRegistry } from '@/lib/replayTimeline';
import type { CancelledOrderSnapshot } from '@/types/trading';

/**
 * 回放时间线的「写」这一侧，走真实的 TradingProvider：
 * 哪些入口分叉、哪些不分叉，结束排在收尾之后，以及下单 / 撤单 / 平仓盖上的是哪一枚章。
 * Index 里的调用点（开始、跳转、停止、切模式）另有源码守卫：replayTimelineCallSites.test.ts。
 */

const T0 = Date.parse('2026-09-15T00:00:00Z');
const SIM0 = Date.parse('2024-01-15T08:00:00Z');
const MIN = 60_000;

const wrapper = ({ children }: { children: React.ReactNode }) => <TradingProvider>{children}</TradingProvider>;
const mount = () => renderHook(() => useTradingContext(), { wrapper });

/**
 * 登记表落盘：分叉 / 结束推迟在微任务里，盖章攒到节流窗口结束才落。这里把两者都冲掉；
 * 推进假定时器会把 Date 一起拨走，冲完拨回原处，免得之后盖的章 / 结束的时刻跟着挪。
 */
async function flush() {
  const now = Date.now();
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(REPLAY_STAMP_PERSIST_THROTTLE_MS); });
  vi.setSystemTime(now);
}

function storedRegistry(): ReplayTimelineRegistry {
  return JSON.parse(localStorage.getItem('sim_anon_replay_timelines_v1') ?? '{"v":1,"nodes":{},"current":{}}');
}

const marketLong = (over: Partial<PlaceOrderParams> = {}): PlaceOrderParams => ({
  side: 'LONG', type: 'MARKET', price: 0, stopPrice: 0, quantity: 1, leverage: 10, marginMode: 'isolated',
  priceSelection: 'MARKET', triggerType: 'LAST', currencyUnit: 'BASE', usdtInputMode: 'ORDER_VALUE', inputAmount: 1,
  settlementMode: 'usdt', latestPrice: 100,
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

describe('回放时间线：分叉与不分叉的入口', () => {
  it('钟停着：拿不到时间线，也不补 bootstrap', async () => {
    const { result } = mount();
    expect(result.current.getTimelineId('BTCUSDT')).toBeNull();
    expect(result.current.stampClock('BTCUSDT')).toBeNull();
    await flush();
    expect(Object.keys(storedRegistry().nodes)).toHaveLength(0);
  });

  it('同步模式：从停着的钟起步是根；在跑的钟上重新开始挂在当前那条下面', async () => {
    const { result } = mount();
    let root = '';
    act(() => {
      root = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0, 1);
      result.current.sim.startSimulation(SIM0);
    });
    // 同步模式全局一只钟：别的标的拿到的是同一条
    expect(result.current.getTimelineId('ETHUSDT')).toBe(root);

    let rewind = '';
    act(() => {
      rewind = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0 - 60 * MIN, 1);
      result.current.sim.startSimulation(SIM0 - 60 * MIN);
    });
    await flush();
    const registry = storedRegistry();
    expect(registry.nodes[root]).toMatchObject({ scope: 'synced', parentId: null, cause: 'start', forkSimTime: SIM0 });
    expect(registry.nodes[rewind]).toMatchObject({ parentId: root, cause: 'start', forkSimTime: SIM0 - 60 * MIN });
    expect(registry.current.synced).toBe(rewind);
    // 分叉那一刻父线走到哪，给父线盖一章（Date 没动：还在 SIM0）
    expect(registry.nodes[root]).toMatchObject({ lastSimTime: SIM0, lastRealAt: T0 });
  });

  it('切模式（Index.handleSetTimeMode 的顺序）：离开同步模式时钟真的停了，切回来不补 bootstrap，挂着的旧单不借它混进本场', async () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ BTCUSDT: 100 }); });
    let root = '';
    act(() => {
      root = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      result.current.sim.startSimulation(SIM0);
    });
    act(() => {
      result.current.handlePlaceOrder('BTCUSDT', marketLong({ type: 'LIMIT', price: 90, priceSelection: 'LIMIT' }));
    });
    expect(result.current.ordersMap.BTCUSDT[0].createdTimelineId).toBe(root);
    // 结束全部时间线 → 停钟 → 换模式
    act(() => {
      result.current.endReplayTimeline('all');
      result.current.sim.stopSimulation();
      result.current.setTimeMode('isolated');
    });
    await flush();
    expect(storedRegistry().nodes[root].endedRealAt).toBe(T0);
    expect(result.current.sim.status).toBe('stopped');
    act(() => { result.current.setTimeMode('synced'); });
    await flush();
    const registry = storedRegistry();
    expect(Object.keys(registry.nodes)).toEqual([root]);
    expect(registry.current.synced).toBeNull();
    expect(result.current.getTimelineId('BTCUSDT')).toBeNull();
  });

  it('对照：钟不停就切回同步模式，登记表只能给一只「在跑却没有时间线」的钟补无父的 bootstrap 根——这就是 Index 必须停钟的原因', async () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ BTCUSDT: 100 }); });
    let root = '';
    act(() => {
      root = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      result.current.sim.startSimulation(SIM0);
    });
    act(() => {
      result.current.handlePlaceOrder('BTCUSDT', marketLong({ type: 'LIMIT', price: 90, priceSelection: 'LIMIT' }));
    });
    const order = result.current.ordersMap.BTCUSDT[0];
    act(() => {
      result.current.endReplayTimeline('all');
      result.current.setTimeMode('isolated');
    });
    act(() => { result.current.setTimeMode('synced'); });
    await flush();
    const registry = storedRegistry();
    const boot = registry.current.synced!;
    expect(boot).not.toBe(root);
    expect(registry.nodes[boot]).toMatchObject({ cause: 'bootstrap', parentId: null });
    expect(registry.nodes[boot].carried.BTCUSDT.orderIds).toEqual([order.id]);
  });

  it('暂停、恢复、改倍速都不分叉', async () => {
    const { result } = mount();
    let id = '';
    act(() => {
      id = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      result.current.sim.startSimulation(SIM0);
    });
    act(() => result.current.sim.pauseSimulation());
    expect(result.current.stampClock('BTCUSDT')).toBe(id);
    act(() => result.current.sim.resumeSimulation());
    act(() => result.current.sim.setSpeed(3600));
    vi.setSystemTime(T0 + 1_000);
    expect(result.current.stampClock('BTCUSDT')).toBe(id);
    await flush();
    expect(Object.keys(storedRegistry().nodes)).toEqual([id]);
  });

  it('翻转方向：在跑的钟分出 direction 时间线（倒放起点对齐 K 线开盘）；停着的钟不分', async () => {
    const { result } = mount();
    act(() => result.current.setTimeDirection(-1));
    act(() => result.current.setTimeDirection(1));
    await flush();
    expect(Object.keys(storedRegistry().nodes)).toHaveLength(0);

    let root = '';
    const start = SIM0 + 30_000; // 1m K 线走到一半
    act(() => {
      root = result.current.forkReplayTimeline('BTCUSDT', 'start', start);
      result.current.sim.startSimulation(start);
    });
    act(() => result.current.setTimeDirection(-1));
    await flush();
    const registry = storedRegistry();
    const child = registry.current.synced!;
    expect(child).not.toBe(root);
    expect(registry.nodes[child]).toMatchObject({ parentId: root, cause: 'direction', direction: -1, forkSimTime: SIM0 });
    expect(result.current.reverseCapTime).toBe(SIM0);
    // 父线记下翻转那一刻的撮合时钟（没对齐的原值）：读取侧拿它当父线的活动上限
    expect(registry.nodes[root]).toMatchObject({ lastSimTime: start, lastRealAt: T0 });
  });

  it('翻转方向前父线走了一段：父线的最近一次盖章更新到翻转点，不停在上一次无关的盖章上', async () => {
    const { result } = mount();
    let root = '';
    act(() => {
      root = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      result.current.sim.startSimulation(SIM0);
      result.current.sim.setSpeed(3600);
    });
    vi.setSystemTime(T0 + 1_000);
    expect(result.current.stampClock('BTCUSDT')).toBe(root);   // 走到 SIM0+1h 时盖过一章
    vi.setSystemTime(T0 + 10_000);                              // 走到 SIM0+10h 翻转
    act(() => result.current.setTimeDirection(-1));
    await flush();
    const registry = storedRegistry();
    expect(registry.nodes[root]).toMatchObject({ lastSimTime: SIM0 + 600 * MIN, lastRealAt: T0 + 10_000 });
    expect(registry.nodes[registry.current.synced!]).toMatchObject({ parentId: root, forkSimTime: SIM0 + 600 * MIN });
  });

  it('隔离模式：调倍速造出的占位条目不登记；真正在跑的币补 bootstrap 根并记下已开着的仓位与挂单', async () => {
    const { result } = mount();
    act(() => {
      result.current.setTimeMode('isolated');
      result.current.setCoinTimelines({
        ETHUSDT: { status: 'paused', time: 0, speed: 60, historicalAnchorTime: null, realStartTime: null, originTime: null },
      });
    });
    await flush();
    expect(result.current.getTimelineId('ETHUSDT')).toBeNull();
    expect(Object.keys(storedRegistry().nodes)).toHaveLength(0);

    act(() => {
      result.current.setPositionsMap({
        BTCUSDT: [{
          id: 'pos-1', side: 'LONG', entryPrice: 100, quantity: 2, leverage: 10, marginMode: 'isolated', margin: 20,
          fills: [
            { id: 'pos-1', openTime: SIM0, entryPrice: 100, units: 1 },
            { id: 'fill-2', openTime: SIM0, entryPrice: 100, units: 1 },
          ],
        }],
      });
      result.current.setOrdersMap({
        BTCUSDT: [{
          id: 'hedge-1', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 90, quantity: 1, leverage: 10,
          marginMode: 'isolated', status: 'PENDING', createdAt: SIM0,
        }],
      });
    });
    act(() => {
      result.current.setCoinTimelines(prev => ({
        ...prev,
        BTCUSDT: { status: 'playing', time: SIM0, speed: 1, historicalAnchorTime: SIM0, realStartTime: T0, originTime: SIM0 },
      }));
    });
    await flush();
    const registry = storedRegistry();
    const id = registry.current['coin:BTCUSDT']!;
    expect(registry.nodes[id]).toMatchObject({ scope: 'coin:BTCUSDT', cause: 'bootstrap', parentId: null, forkSimTime: SIM0 });
    expect(registry.nodes[id].carried).toEqual({
      BTCUSDT: { positionIds: ['pos-1'], fillIds: ['pos-1', 'fill-2'], orderIds: ['hedge-1'] },
    });
    expect(registry.current['coin:ETHUSDT']).toBeUndefined();
    expect(result.current.getTimelineId('BTCUSDT')).toBe(id);
  });

  it('隔离模式翻转方向：每只在跑的钟各分一条 direction 时间线，停着的与调倍速造出的占位条目不分', async () => {
    const { result } = mount();
    act(() => {
      result.current.setTimeMode('isolated');
      result.current.setCoinTimelines({
        // 播放中、1m K 线走到一半：分叉时刻按翻转前的钟现算再对齐开盘
        BTCUSDT: { status: 'playing', time: SIM0 + 30_000, speed: 1, historicalAnchorTime: SIM0 + 30_000, realStartTime: T0, originTime: SIM0 },
        // 暂停中：分叉时刻就是冻结的时刻（对齐开盘）
        ETHUSDT: { status: 'paused', time: SIM0 + 90_000, speed: 1, historicalAnchorTime: SIM0 + 90_000, realStartTime: null, originTime: SIM0 },
        SOLUSDT: { status: 'stopped', time: 0, speed: 1, historicalAnchorTime: null, realStartTime: null, originTime: null },
        // handleSetSpeed 在没启动过的币上造出的占位条目
        DOGEUSDT: { status: 'paused', time: 0, speed: 60, historicalAnchorTime: null, realStartTime: null, originTime: null },
      });
    });
    await flush();
    const before = storedRegistry();
    const btcRoot = before.current['coin:BTCUSDT']!;
    const ethRoot = before.current['coin:ETHUSDT']!;
    expect(before.nodes[btcRoot].cause).toBe('bootstrap');
    expect(before.current['coin:SOLUSDT']).toBeUndefined();
    expect(before.current['coin:DOGEUSDT']).toBeUndefined();

    act(() => result.current.setTimeDirection(-1));
    await flush();
    const after = storedRegistry();
    expect(Object.keys(after.nodes)).toHaveLength(4);
    expect(after.nodes[after.current['coin:BTCUSDT']!]).toMatchObject({
      scope: 'coin:BTCUSDT', parentId: btcRoot, cause: 'direction', direction: -1, forkSimTime: SIM0,
    });
    expect(after.nodes[after.current['coin:ETHUSDT']!]).toMatchObject({
      scope: 'coin:ETHUSDT', parentId: ethRoot, cause: 'direction', direction: -1, forkSimTime: SIM0 + 60_000,
    });
    expect(after.current['coin:SOLUSDT']).toBeUndefined();
    expect(after.current['coin:DOGEUSDT']).toBeUndefined();
    // 隔离模式一个币一只钟：翻转后各币拿到的是各自的新时间线
    expect(result.current.getTimelineId('BTCUSDT')).toBe(after.current['coin:BTCUSDT']);
    expect(result.current.getTimelineId('ETHUSDT')).toBe(after.current['coin:ETHUSDT']);
    expect(result.current.getTimelineId('DOGEUSDT')).toBeNull();
  });

  it('刷新恢复会话：沿用登记表里的指针不分叉；恢复的钟落后最近一次盖章也不算倒回', async () => {
    const first = mount();
    let root = '';
    act(() => {
      root = first.result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      first.result.current.sim.startSimulation(SIM0);
      first.result.current.sim.setSpeed(3600);
    });
    // 3600 倍下现实 10 秒 = 模拟 10 小时
    vi.setSystemTime(T0 + 10_000);
    expect(first.result.current.stampClock('BTCUSDT')).toBe(root);
    await flush();
    expect(storedRegistry().nodes[root].lastSimTime).toBe(SIM0 + 600 * MIN);
    first.unmount();

    // 心跳落盘的钟比最近一次盖章落后半个心跳（3600 倍下 = 30 模拟分钟）；
    // 现实又过了 50 秒才重新打开页面——不给恢复会话留余量的话，这会被判成倒回。
    vi.setSystemTime(T0 + 60_000);
    localStorage.removeItem('__tm_live_time');
    localStorage.setItem('sim_anon_sim_state', JSON.stringify({
      status: 'playing', historicalAnchorTime: SIM0 + 570 * MIN, realStartTime: T0 + 10_000,
      currentSimulatedTime: SIM0 + 570 * MIN, speed: 3600, direction: 1, symbol: 'BTCUSDT', interval: '1m',
    }));
    const second = mount();
    expect(second.result.current.sim.status).toBe('playing');
    expect(second.result.current.getTimelineId('BTCUSDT')).toBe(root);
    expect(second.result.current.stampClock('BTCUSDT')).toBe(root);
    await flush();
    const registry = storedRegistry();
    expect(Object.keys(registry.nodes)).toEqual([root]);
    expect(registry.nodes[root].lastSimTime).toBe(SIM0 + 570 * MIN);
  });

  it('盖章攒着落盘：节流窗口内不落盘，窗口一到落最新的；分叉立刻落盘并把攒着的章一起带出去', async () => {
    const { result } = mount();
    let root = '';
    act(() => {
      root = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      result.current.sim.startSimulation(SIM0);
      result.current.sim.setSpeed(3600);
    });
    await flush();
    vi.setSystemTime(T0 + 1_000);
    expect(result.current.stampClock('BTCUSDT')).toBe(root);
    await act(async () => { await Promise.resolve(); });
    expect(storedRegistry().nodes[root].lastSimTime).toBe(SIM0);            // 微任务过了，章还攒着
    await act(async () => { await vi.advanceTimersByTimeAsync(REPLAY_STAMP_PERSIST_THROTTLE_MS - 1); });
    expect(storedRegistry().nodes[root].lastSimTime).toBe(SIM0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(storedRegistry().nodes[root].lastSimTime).toBe(SIM0 + 60 * MIN);  // 窗口一到落盘

    vi.setSystemTime(T0 + 2_000);
    expect(result.current.stampClock('BTCUSDT')).toBe(root);                // 又进一个节流窗口
    let rewind = '';
    act(() => {
      rewind = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      result.current.sim.startSimulation(SIM0);
    });
    await act(async () => { await Promise.resolve(); });
    // 分叉走微任务立刻落盘，ref 里攒着的章（与父线分叉时的章同一个时刻）一起出去
    expect(storedRegistry().current.synced).toBe(rewind);
    expect(storedRegistry().nodes[root].lastSimTime).toBe(SIM0 + 120 * MIN);
  });

  it('【兜底】钟被拨回去却没有任何显式分叉：下一次盖章补一条 implicit 时间线', async () => {
    const { result } = mount();
    let root = '';
    act(() => {
      root = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      result.current.sim.startSimulation(SIM0);
    });
    expect(result.current.stampClock('BTCUSDT')).toBe(root);
    // 一条没接分叉的改钟路径：现实过了 10 秒，同步时钟被直接拨回 3 小时
    vi.setSystemTime(T0 + 10_000);
    act(() => result.current.sim.startSimulation(SIM0 - 180 * MIN));
    const next = result.current.stampClock('BTCUSDT');
    expect(next).not.toBe(root);
    await flush();
    expect(storedRegistry().nodes[next!]).toMatchObject({ cause: 'implicit', parentId: root, forkSimTime: SIM0 - 180 * MIN });
  });
});

describe('回放时间线：写入时盖章', () => {
  it('开仓盖开仓那条、倒回后平仓盖倒回那条；结束之后指针置空，停钟后不再盖章', async () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ BTCUSDT: 100 }); });
    let root = '';
    act(() => {
      root = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      result.current.sim.startSimulation(SIM0);
    });
    act(() => { result.current.handlePlaceOrder('BTCUSDT', marketLong()); });
    const position = result.current.positionsMap.BTCUSDT[0];
    expect(position.openTimelineId).toBe(root);
    expect(position.fills![0].timelineId).toBe(root);

    let rewind = '';
    act(() => {
      rewind = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0 - 60 * MIN);
      result.current.sim.startSimulation(SIM0 - 60 * MIN);
    });
    // 仓位活进了倒回之后的时间线
    await flush();
    expect(storedRegistry().nodes[rewind].carried.BTCUSDT.positionIds).toEqual([position.id]);

    act(() => { result.current.handleClosePosition('BTCUSDT', 0); });
    act(() => {
      result.current.endReplayTimeline('synced');
      result.current.sim.stopSimulation();
    });
    await flush();
    expect(result.current.tradeHistory[0]).toMatchObject({ openedTimelineId: root, closedTimelineId: rewind });
    const registry = storedRegistry();
    expect(registry.nodes[rewind]).toMatchObject({ endedRealAt: T0, endSimTime: SIM0 - 60 * MIN });
    expect(registry.current.synced).toBeNull();
    expect(result.current.stampClock('BTCUSDT')).toBeNull();
  });

  it('挂单带挂单章；倒回后撤单，撤单快照带挂单 / 撤单两枚章', async () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ BTCUSDT: 100 }); });
    let root = '';
    act(() => {
      root = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      result.current.sim.startSimulation(SIM0);
    });
    act(() => {
      result.current.handlePlaceOrder('BTCUSDT', marketLong({ type: 'LIMIT', price: 90, priceSelection: 'LIMIT' }));
    });
    const order = result.current.ordersMap.BTCUSDT[0];
    expect(order.createdTimelineId).toBe(root);

    let jump = '';
    act(() => {
      jump = result.current.forkReplayTimeline('BTCUSDT', 'jump', SIM0 - 60 * MIN);
      result.current.sim.startSimulation(SIM0 - 60 * MIN);
    });
    act(() => { result.current.handleCancelOrder('BTCUSDT', order.id); });
    await flush();
    const cancelled = JSON.parse(localStorage.getItem('sim_anon_cancelled_orders') ?? '[]') as CancelledOrderSnapshot[];
    expect(cancelled[0]).toMatchObject({ id: order.id, createdTimelineId: root, cancelledTimelineId: jump });
    expect(storedRegistry().nodes[jump]).toMatchObject({ parentId: root, cause: 'jump' });
    expect(storedRegistry().nodes[jump].carried.BTCUSDT.orderIds).toEqual([order.id]);
  });

  it('随单止盈止损盖成交那一刻的章；倒回后触发，成交快照与平仓记录盖倒回那条', async () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ BTCUSDT: 100 }); });
    let root = '';
    act(() => {
      root = result.current.forkReplayTimeline('BTCUSDT', 'start', SIM0);
      result.current.sim.startSimulation(SIM0);
    });
    act(() => {
      result.current.handlePlaceOrder('BTCUSDT', marketLong({ tpTriggerPrice: 120, slTriggerPrice: 80, tpSlPercentage: 100 }));
    });
    const position = result.current.positionsMap.BTCUSDT[0];
    const protective = result.current.ordersMap.BTCUSDT;
    expect(protective.map(o => [o.reduceKind, o.linkedPositionId, o.createdTimelineId])).toEqual([
      ['TP', position.id, root],
      ['SL', position.id, root],
    ]);

    let rewind = '';
    act(() => {
      rewind = result.current.forkReplayTimeline('BTCUSDT', 'jump', SIM0 - 60 * MIN);
      result.current.sim.startSimulation(SIM0 - 60 * MIN);
    });
    const tp = protective.find(o => o.reduceKind === 'TP')!;
    // 用断言初始化：直接标注 `| null` 再赋 null 会被控制流收窄成 null，回调里的赋值 TS 看不见
    let execution = null as ReturnType<typeof result.current.executeReduceOnlyTrigger> | null;
    act(() => { execution = result.current.executeReduceOnlyTrigger('BTCUSDT', tp, 120); });
    expect(execution?.ok).toBe(true);
    await flush();

    const snapshot = result.current.filledOrders.find(s => s.id === tp.id);
    expect(snapshot).toMatchObject({ createdTimelineId: root, filledTimelineId: rewind, positionId: position.id });
    expect(snapshot?.createdRealAt).toBe(T0);
    expect(snapshot?.filledRealAt).toBe(T0);
    const record = result.current.tradeHistory.find(r => r.action === 'CLOSE');
    expect(record).toMatchObject({ openedTimelineId: root, closedTimelineId: rewind });
  });

  it('钟停着下的限价单没有章：撤单快照两枚章都是空', async () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ BTCUSDT: 100 }); });
    act(() => {
      result.current.handlePlaceOrder('BTCUSDT', marketLong({ type: 'LIMIT', price: 90, priceSelection: 'LIMIT' }));
    });
    const order = result.current.ordersMap.BTCUSDT[0];
    expect(order.createdTimelineId).toBeNull();
    act(() => { result.current.handleCancelOrder('BTCUSDT', order.id); });
    await flush();
    const cancelled = JSON.parse(localStorage.getItem('sim_anon_cancelled_orders') ?? '[]') as CancelledOrderSnapshot[];
    expect(cancelled[0]).toMatchObject({ id: order.id, createdTimelineId: null, cancelledTimelineId: null });
    expect(Object.keys(storedRegistry().nodes)).toHaveLength(0);
  });
});
