import { describe, expect, it } from 'vitest';
import {
  createReplayTimelineRegistry,
  currentReplayTimeline,
  endReplayTimeline,
  forkReplayTimeline,
  isCoinTimelineClockActive,
  isImplicitReplayFork,
  mergeReplayTimelineRegistries,
  normalizeReplayTimelineRegistry,
  pruneReplayTimelineRegistry,
  recordReplayTimelineStamp,
  replayTimelineScope,
  replayTimelineScopeSymbol,
  snapshotReplayCarried,
  type ReplayTimelineNode,
  type ReplayTimelineRegistry,
} from '@/lib/replayTimeline';

const HOUR = 60 * 60_000;

function fork(
  registry: ReplayTimelineRegistry,
  id: string,
  over: Partial<Parameters<typeof forkReplayTimeline>[1]> = {},
): ReplayTimelineRegistry {
  return forkReplayTimeline(registry, {
    id,
    scope: 'synced',
    cause: 'start',
    direction: 1,
    forkSimTime: 1_000_000,
    realAt: 10,
    carried: {},
    continuing: false,
    ...over,
  });
}

const node = (id: string, over: Partial<ReplayTimelineNode> = {}): ReplayTimelineNode => ({
  id,
  scope: 'synced',
  parentId: null,
  cause: 'start',
  direction: 1,
  forkSimTime: 1_000,
  startedRealAt: 100,
  endSimTime: null,
  endedRealAt: null,
  carried: {},
  lastSimTime: 1_000,
  lastRealAt: 100,
  ...over,
});

describe('时钟与 scope', () => {
  it('同步模式全局一只钟，隔离模式一个币一只', () => {
    expect(replayTimelineScope('synced', 'BTCUSDT')).toBe('synced');
    expect(replayTimelineScope('isolated', 'BTCUSDT')).toBe('coin:BTCUSDT');
    expect(replayTimelineScopeSymbol('coin:BTCUSDT')).toBe('BTCUSDT');
    expect(replayTimelineScopeSymbol('synced')).toBeNull();
  });

  it('【回归】隔离模式在没启动过的币上调倍速造出的占位条目，不算在跑的钟', () => {
    // handleSetSpeed：status 'paused'、time 0、没有任何锚点——那不是一次回放。
    expect(isCoinTimelineClockActive({ status: 'paused', historicalAnchorTime: null, originTime: null })).toBe(false);
    expect(isCoinTimelineClockActive({ status: 'stopped', historicalAnchorTime: 5, originTime: 5 })).toBe(false);
    expect(isCoinTimelineClockActive(null)).toBe(false);
    expect(isCoinTimelineClockActive({ status: 'paused', historicalAnchorTime: 5, originTime: 5 })).toBe(true);
    expect(isCoinTimelineClockActive({ status: 'playing', historicalAnchorTime: 5, originTime: null })).toBe(true);
  });
});

describe('分叉那一刻活进新时间线的东西', () => {
  const positions = {
    BTCUSDT: [
      { id: 'main', fills: [{ id: 'main' }, { id: 'add' }] },
      { id: 'legacy' }, // 旧仓位没有 fills：它自己就是唯一的一笔成交
    ],
    ETHUSDT: [{ id: 'eth-pos' }],
  };
  const orders = { BTCUSDT: [{ id: 'hedge' }], SOLUSDT: [{ id: 'sol-order' }] };

  it('同步时钟记全部标的', () => {
    const carried = snapshotReplayCarried(positions, orders, null);
    expect(carried.BTCUSDT).toEqual({ positionIds: ['main', 'legacy'], fillIds: ['main', 'add', 'legacy'], orderIds: ['hedge'] });
    expect(carried.ETHUSDT.positionIds).toEqual(['eth-pos']);
    expect(carried.SOLUSDT).toEqual({ positionIds: [], fillIds: [], orderIds: ['sol-order'] });
  });

  it('隔离模式只记这只币自己的', () => {
    const carried = snapshotReplayCarried(positions, orders, ['ETHUSDT']);
    expect(Object.keys(carried)).toEqual(['ETHUSDT']);
  });
});

describe('分叉 / 结束 / 盖章', () => {
  it('从停着的钟起步是新的根，哪怕还留着一条没结束的旧指针', () => {
    let registry = fork(createReplayTimelineRegistry(), 'a');
    registry = fork(registry, 'b', { continuing: false });
    expect(registry.nodes.b.parentId).toBeNull();
    expect(registry.current.synced).toBe('b');
  });

  it('在跑的钟上倒回 / 跳转 / 翻转，挂在当前那条下面', () => {
    let registry = fork(createReplayTimelineRegistry(), 'a');
    registry = fork(registry, 'b', { continuing: true, cause: 'direction', direction: -1, forkSimTime: 900_000 });
    expect(registry.nodes.b).toMatchObject({ parentId: 'a', cause: 'direction', direction: -1, forkSimTime: 900_000 });
    // 刚分叉还没盖过章：走到哪 = 分叉时刻
    expect(registry.nodes.b.lastSimTime).toBe(900_000);
    expect(registry.nodes.a.endedRealAt).toBeNull();
  });

  it('当前那条已经结束，continuing 也不会挂上去', () => {
    let registry = fork(createReplayTimelineRegistry(), 'a');
    registry = endReplayTimeline(registry, 'synced', { realAt: 20 });
    registry = fork(registry, 'b', { continuing: true });
    expect(registry.nodes.b.parentId).toBeNull();
  });

  it('结束：写终点、指针置空；终点缺省取最近一次盖章', () => {
    let registry = fork(createReplayTimelineRegistry(), 'a');
    registry = recordReplayTimelineStamp(registry, 'a', 1_500_000, 15);
    registry = endReplayTimeline(registry, 'synced', { realAt: 20 });
    expect(registry.nodes.a).toMatchObject({ endSimTime: 1_500_000, endedRealAt: 20 });
    expect(registry.current.synced).toBeNull();
    expect(currentReplayTimeline(registry, 'synced')).toBeNull();
    // 重复结束不是错误，也不改写终点
    expect(endReplayTimeline(registry, 'synced', { simTime: 9, realAt: 99 })).toBe(registry);
  });

  it('结束时给了此刻的时钟就用它', () => {
    const registry = endReplayTimeline(fork(createReplayTimelineRegistry(), 'a'), 'synced', { simTime: 1_234, realAt: 20 });
    expect(registry.nodes.a.endSimTime).toBe(1_234);
  });

  it('盖章：时钟没动返回同一个对象（调用方据此跳过落盘）', () => {
    const registry = fork(createReplayTimelineRegistry(), 'a');
    expect(recordReplayTimelineStamp(registry, 'a', 1_000_000, 11)).toBe(registry);
    expect(recordReplayTimelineStamp(registry, 'missing', 5, 11)).toBe(registry);
    const next = recordReplayTimelineStamp(registry, 'a', 1_060_000, 11);
    expect(next.nodes.a).toMatchObject({ lastSimTime: 1_060_000, lastRealAt: 11 });
    expect(registry.nodes.a.lastSimTime).toBe(1_000_000); // 纯函数，不改入参
  });
});

describe('兜底分叉判据 isImplicitReplayFork', () => {
  const base = { direction: 1 as const, lastSimTime: 10 * HOUR, lastRealAt: 0 };

  it('正放往前走、回落在 1 分钟容差之内：不分叉', () => {
    expect(isImplicitReplayFork({ ...base, simTime: 11 * HOUR, realAt: 60_000 })).toBe(false);
    expect(isImplicitReplayFork({ ...base, simTime: 10 * HOUR - 59_000, realAt: 60_000 })).toBe(false);
  });

  it('现实里几乎同时的两次读钟：落后的钟造成的回落不算倒回', () => {
    // 3600 倍、预算 5 秒 → 同一刻最多能「回落」5 个模拟小时
    expect(isImplicitReplayFork({ ...base, simTime: 6 * HOUR, realAt: 0 })).toBe(false);
  });

  it('现实隔了几秒以上，任何超过 1 分钟的回落都是时钟被拨回去了', () => {
    expect(isImplicitReplayFork({ ...base, simTime: 10 * HOUR - 2 * 60_000, realAt: 10_000 })).toBe(true);
    expect(isImplicitReplayFork({ ...base, simTime: 8 * HOUR, realAt: 10_000 })).toBe(true);
  });

  it('倒放的「往前走」是模拟时间变小；变大才是回落', () => {
    const reverse = { ...base, direction: -1 as const };
    expect(isImplicitReplayFork({ ...reverse, simTime: 8 * HOUR, realAt: 10_000 })).toBe(false);
    expect(isImplicitReplayFork({ ...reverse, simTime: 12 * HOUR, realAt: 10_000 })).toBe(true);
  });

  it('刷新后第一次盖章按「现实间隔为 0」给足预算：恢复会话的钟落后一个心跳不算倒回', () => {
    expect(isImplicitReplayFork({ ...base, simTime: 9 * HOUR, realAt: 60_000, restored: true })).toBe(false);
    expect(isImplicitReplayFork({ ...base, simTime: 9 * HOUR, realAt: 60_000 })).toBe(true);
  });

  it('没有基准（老节点）不判', () => {
    expect(isImplicitReplayFork({ ...base, lastSimTime: null, simTime: 0, realAt: 60_000 })).toBe(false);
  });
});

describe('分叉时给父时间线盖章 parentSimTime', () => {
  it('在跑的钟上分叉：父线记下分叉那一刻的撮合时钟；从停着的钟起步、或没传就不记', () => {
    let registry = fork(createReplayTimelineRegistry(), 'root', { forkSimTime: 1_000 });
    registry = recordReplayTimelineStamp(registry, 'root', 4_000, 40);
    // 正放到 5_000 翻转倒放：父线的最近一次盖章从 4_000 变成 5_000（它真的走到了那里）
    registry = fork(registry, 'rev', { cause: 'direction', direction: -1, forkSimTime: 4_800, realAt: 50, continuing: true, parentSimTime: 5_000 });
    expect(registry.nodes.root).toMatchObject({ lastSimTime: 5_000, lastRealAt: 50 });
    expect(registry.nodes.rev.parentId).toBe('root');
    // 兜底分叉不传：父线保持原样
    registry = fork(registry, 'implicit', { cause: 'implicit', forkSimTime: 2_000, realAt: 60, continuing: true, parentSimTime: null });
    expect(registry.nodes.rev.lastSimTime).toBe(4_800);
    // 从停着的钟起步：没有父线，传了也没处记
    const fresh = fork(createReplayTimelineRegistry(), 'r2', { parentSimTime: 9_000 });
    expect(fresh.nodes.r2.parentId).toBeNull();
  });
});

describe('修剪 pruneReplayTimelineRegistry', () => {
  const DAY = 24 * HOUR;
  const NOW = 1_000 * DAY;
  const ended = (id: string, endedRealAt: number, over: Partial<ReplayTimelineNode> = {}) =>
    node(id, { startedRealAt: endedRealAt - HOUR, lastRealAt: endedRealAt, endSimTime: 2_000, endedRealAt, ...over });

  it('太老的已结束时间线丢掉；没结束的、被指针指着的及其祖先一律保留', () => {
    const registry: ReplayTimelineRegistry = {
      v: 1,
      nodes: {
        old: ended('old', NOW - 200 * DAY),
        recent: ended('recent', NOW - DAY),
        // 老根，但它的孩子还在跑：祖先跟着保留
        oldRoot: ended('oldRoot', NOW - 300 * DAY),
        live: node('live', { parentId: 'oldRoot', startedRealAt: NOW - 300 * DAY + HOUR }),
        // 老根，被指针指着（结束了指针本该置空，坏数据）：照样保留
        pointed: ended('pointed', NOW - 400 * DAY),
      },
      current: { synced: 'pointed' },
    };
    const pruned = pruneReplayTimelineRegistry(registry, { now: NOW });
    expect(Object.keys(pruned.nodes).sort()).toEqual(['live', 'oldRoot', 'pointed', 'recent']);
    expect(pruned.current).toEqual({ synced: 'pointed' });
  });

  it('太多：按「自己与后代里最近的动静」从旧到新丢，留下的节点永远不失去祖先', () => {
    const registry: ReplayTimelineRegistry = {
      v: 1,
      nodes: {
        // 老根带着一个新孩子：根的新鲜度取孩子的
        root: ended('root', NOW - 10 * DAY),
        child: ended('child', NOW - DAY, { parentId: 'root' }),
        // 三条各自独立的已结束线，动静一个比一个新
        d1: ended('d1', NOW - 9 * DAY),
        d2: ended('d2', NOW - 8 * DAY),
        d3: ended('d3', NOW - 2 * DAY),
      },
      current: {},
    };
    const pruned = pruneReplayTimelineRegistry(registry, { now: NOW, maxNodes: 3 });
    expect(Object.keys(pruned.nodes).sort()).toEqual(['child', 'd3', 'root']);
  });

  it('没什么可修：返回同一个对象（调用方据此跳过落盘）', () => {
    const registry = fork(createReplayTimelineRegistry(), 'a', { realAt: NOW });
    expect(pruneReplayTimelineRegistry(registry, { now: NOW })).toBe(registry);
    expect(pruneReplayTimelineRegistry(createReplayTimelineRegistry(), { now: NOW })).toEqual(createReplayTimelineRegistry());
  });
});

describe('读回任意值 normalizeReplayTimelineRegistry', () => {
  it('坏值给空登记表', () => {
    for (const raw of [null, 'x', 42, [], { nodes: 'x' }]) {
      expect(normalizeReplayTimelineRegistry(raw)).toEqual(createReplayTimelineRegistry());
    }
  });

  it('坏节点丢掉，悬空指针置 null，缺的可选字段补齐', () => {
    const registry = normalizeReplayTimelineRegistry({
      v: 1,
      nodes: {
        good: { scope: 'coin:BTCUSDT', forkSimTime: 5, startedRealAt: 6, direction: -1, cause: 'jump' },
        noScope: { forkSimTime: 5, startedRealAt: 6 },
        badScope: { scope: 'BTCUSDT', forkSimTime: 5, startedRealAt: 6 },
        noFork: { scope: 'synced', startedRealAt: 6 },
      },
      current: { 'coin:BTCUSDT': 'good', synced: 'noFork' },
    });
    expect(Object.keys(registry.nodes)).toEqual(['good']);
    expect(registry.nodes.good).toMatchObject({
      id: 'good', parentId: null, direction: -1, cause: 'jump', endSimTime: null, endedRealAt: null, carried: {},
    });
    expect(registry.current).toEqual({ 'coin:BTCUSDT': 'good', synced: null });
  });
});

describe('云端水化合并 mergeReplayTimelineRegistries', () => {
  it('按节点 id 取并集：两台设备各自分出来的时间线都保留', () => {
    const local = { v: 1, nodes: { a: node('a') }, current: { synced: 'a' } };
    const remote = { v: 1, nodes: { b: node('b', { scope: 'coin:ETHUSDT' }) }, current: { 'coin:ETHUSDT': 'b' } };
    const merged = mergeReplayTimelineRegistries(local, remote);
    expect(Object.keys(merged.nodes)).toEqual(['a', 'b']);
    expect(merged.current).toEqual({ synced: 'a', 'coin:ETHUSDT': 'b' });
  });

  it('同一个节点：最近有动静的那份胜出，结束是终态', () => {
    const local = { v: 1, nodes: { a: node('a', { lastSimTime: 9_000, lastRealAt: 900 }) }, current: { synced: 'a' } };
    const remote = { v: 1, nodes: { a: node('a', { endSimTime: 2_000, endedRealAt: 200, lastRealAt: 150 }) }, current: { synced: null } };
    const merged = mergeReplayTimelineRegistries(local, remote);
    expect(merged.nodes.a).toMatchObject({ lastSimTime: 9_000, lastRealAt: 900, endSimTime: 2_000, endedRealAt: 200 });
    // 本地指针指向的节点在合并后已经结束 → 置空
    expect(merged.current.synced).toBeNull();
  });

  it('指针优先本地：驱动同步时钟的 sim_state 只在本机；本地没登记过的 scope 才采用远端', () => {
    const local = { v: 1, nodes: { a: node('a') }, current: { synced: null } };
    const remote = {
      v: 1,
      nodes: { b: node('b'), c: node('c', { scope: 'coin:SOLUSDT' }) },
      current: { synced: 'b', 'coin:SOLUSDT': 'c' },
    };
    const merged = mergeReplayTimelineRegistries(local, remote);
    expect(merged.current.synced).toBeNull();
    expect(merged.current['coin:SOLUSDT']).toBe('c');
  });

  it('本地是坏值：结果就是整理过的远端', () => {
    const remote = { v: 1, nodes: { b: node('b') }, current: { synced: 'b' } };
    expect(mergeReplayTimelineRegistries('garbage', remote)).toEqual(normalizeReplayTimelineRegistry(remote));
  });
});
