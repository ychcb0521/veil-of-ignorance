import { describe, expect, it } from 'vitest';
import {
  buildCampaignTimelineScope,
  collectCampaignTimelineEvidence,
  type CampaignTimelineActivity,
  type CampaignTimelineAnchor,
  type CampaignTimelineOrderLike,
} from '@/lib/campaignTimelineScope';
import type { ReplayTimelineNode, ReplayTimelineRegistry } from '@/lib/replayTimeline';
import type { CampaignEvent, TradeJournal } from '@/types/journal';
import type { CancelledOrderSnapshot, FilledOrderSnapshot, PendingOrder, TradeRecord } from '@/types/trading';

const H = 3_600_000;
const M = 60_000;
/** 现实钱包时钟：2026-09-13 16:00（北京）起算。 */
const real = (h: number, m = 0) => Date.parse('2026-09-13T08:00:00.000Z') + h * H + m * M;
/** 模拟 K 线时钟：TUTUSDT 2026-08-07 19:41（北京）起算。 */
const sim = (h: number, m = 0) => Date.parse('2026-08-07T11:41:00.000Z') + h * H + m * M;
const SYMBOL = 'TUTUSDT';

const node = (id: string, over: Partial<ReplayTimelineNode> = {}): ReplayTimelineNode => ({
  id,
  scope: 'synced',
  parentId: null,
  cause: 'start',
  direction: 1,
  forkSimTime: sim(0),
  startedRealAt: real(0),
  endSimTime: null,
  endedRealAt: null,
  carried: {},
  lastSimTime: null,
  lastRealAt: null,
  ...over,
});
const registry = (...nodes: ReplayTimelineNode[]): ReplayTimelineRegistry => ({
  v: 1,
  nodes: Object.fromEntries(nodes.map(n => [n.id, n])),
  current: {},
});
const carried = (positionIds: string[], orderIds: string[] = [], fillIds = positionIds) => ({
  [SYMBOL]: { positionIds, fillIds, orderIds },
});
const anchor = (timelineId: string | null, realAt: number, simAt: number, kind: CampaignTimelineAnchor['kind'] = 'record-open'): CampaignTimelineAnchor =>
  ({ kind, timelineId, realAt, simAt });
const act = (timelineId: string, simAt: number, realAt: number): CampaignTimelineActivity => ({ timelineId, simAt, realAt });
const order = (over: Partial<CampaignTimelineOrderLike> & { id: string; createdAt: number }): CampaignTimelineOrderLike => over;

describe('本场时间线 O：锚点 + 带着本场仓位的延续', () => {
  it('一个盖了章的锚点都没有 → null（老战役，只有启发式）', () => {
    expect(buildCampaignTimelineScope({
      registry: registry(node('a')),
      symbol: SYMBOL,
      anchors: [anchor(null, real(0), sim(0))],
      activity: [],
      campaignPositionIds: [],
      campaignOpen: false,
    })).toBeNull();
    expect(buildCampaignTimelineScope({
      registry: null, symbol: SYMBOL, anchors: [], activity: [], campaignPositionIds: [], campaignOpen: false,
    })).toBeNull();
  });

  it('锚点全盖了章 → exact；有锚点没章 → mixed；章指向的节点不在登记表 → mixed 且列出', () => {
    const exact = buildCampaignTimelineScope({
      registry: registry(node('a')), symbol: SYMBOL, campaignOpen: false, activity: [], campaignPositionIds: [],
      anchors: [anchor('a', real(0), sim(0)), anchor('a', real(0, 50), sim(30), 'record-close')],
    })!;
    expect(exact.mode).toBe('exact');
    expect(exact.timelineIds).toEqual(['a']);
    const mixed = buildCampaignTimelineScope({
      registry: registry(node('a')), symbol: SYMBOL, campaignOpen: false, activity: [], campaignPositionIds: [],
      anchors: [anchor(null, real(0), sim(0)), anchor('a', real(0, 50), sim(30), 'record-close')],
    })!;
    expect(mixed).toMatchObject({ mode: 'mixed', unstampedAnchors: 1, missingAnchorNodes: [] });
    const missing = buildCampaignTimelineScope({
      registry: registry(node('a')), symbol: SYMBOL, campaignOpen: false, activity: [], campaignPositionIds: [],
      anchors: [anchor('a', real(0), sim(0)), anchor('ghost', real(0, 50), sim(30), 'record-close')],
    })!;
    expect(missing).toMatchObject({ mode: 'mixed', missingAnchorNodes: ['ghost'], timelineIds: ['a'] });
  });

  it('【复核二 F5】进行中的战役：同一次坐下来里带着主力倒回出来的那一遍是本场；已结束的战役不含锚点的那一遍不算', () => {
    const tree = registry(
      node('a', { startedRealAt: real(0, -1), lastSimTime: sim(10) }),      // A 遍走到 sim+10h 才倒回
      node('b', { parentId: 'a', cause: 'jump', forkSimTime: sim(2), startedRealAt: real(0, 30), carried: carried(['main']) }),
    );
    const base = {
      registry: tree, symbol: SYMBOL, activity: [act('b', sim(2, 10), real(0, 40))], campaignPositionIds: ['main'],
      anchors: [anchor('a', real(0), sim(0), 'leg-open')],
    };
    expect(buildCampaignTimelineScope({ ...base, campaignOpen: true })!.timelineIds).toEqual(['a', 'b']);
    expect(buildCampaignTimelineScope({ ...base, campaignOpen: false })!.timelineIds).toEqual(['a']);
  });

  it('【复核五 F1】隔天再倒回另起的一遍不算：与锚点不在同一次坐下来', () => {
    const tree = registry(
      node('a'),
      node('b', { parentId: 'a', cause: 'jump', forkSimTime: sim(0, 15), startedRealAt: real(0, 11), carried: carried(['main']) }),
      node('c', { parentId: 'b', cause: 'jump', forkSimTime: sim(0, 20), startedRealAt: real(23, 5), carried: carried(['main']) }),
    );
    const scope = buildCampaignTimelineScope({
      registry: tree, symbol: SYMBOL, campaignOpen: true, campaignPositionIds: ['main'],
      anchors: [anchor('a', real(0), sim(0), 'leg-open')],
      activity: [act('b', sim(0, 40), real(23, 0))],   // 第二天接着 b 往后打，没有分叉
    })!;
    expect(scope.timelineIds).toEqual(['a', 'b']);
  });

  it('【复核六 / 七】隔天回放同一段（带着仓位）不算本场；第三天往前一跳回到本场停下处接着打的算', () => {
    const tree = registry(
      node('a', { startedRealAt: real(-48) }),
      node('day2', { parentId: 'a', cause: 'jump', forkSimTime: sim(1, 2), startedRealAt: real(-24), carried: carried(['main']) }),
      node('c', { parentId: 'day2', cause: 'jump', forkSimTime: sim(10, 20), startedRealAt: real(0), carried: carried(['main']) }),
      node('rewound', { parentId: 'day2', cause: 'jump', forkSimTime: sim(0, 50), startedRealAt: real(0, 1), carried: carried(['main']) }),
    );
    const base = {
      registry: tree, symbol: SYMBOL, campaignPositionIds: ['main'],
      anchors: [anchor('a', real(-48), sim(0))],
      activity: [act('a', sim(10), real(-48, 6)), act('day2', sim(1, 40), real(-24, 5)), act('c', sim(10, 25), real(0, 1))],
    };
    // 已结束：c 往前一跳（sim+10h20m ≥ a 停在 sim+10h）接上本场；day2 与 rewound 都不算
    expect(buildCampaignTimelineScope({ ...base, campaignOpen: false })!.timelineIds).toEqual(['a', 'c']);
    // 进行中也一样：第三天没有记录新的决策，倒回另起的一遍不与任何锚点同一次坐下来
    expect(buildCampaignTimelineScope({ ...base, campaignOpen: true })!.timelineIds).toEqual(['a', 'c']);
  });

  it('【复核六】当天带着主力倒回出来的一遍隔两天接着打到平仓：本场停在它上面、之后被接上，已结束的战役也算本场；同一次坐下来里再倒回的、之后回到它停下处以下的不算', () => {
    const closeOnDay3 = (day3ForkSim: number) => registry(
      node('a', { startedRealAt: real(0, -1), lastSimTime: sim(8) }),
      // 同一次坐下来倒回：本场停在这里（sim+3h06），第二天另坐下来回放同一段，第三天回来从 sim+15h 接着打到平仓
      node('b', { parentId: 'a', cause: 'jump', forkSimTime: sim(3), startedRealAt: real(0, 9), carried: carried(['main']) }),
      node('day2', { parentId: 'b', cause: 'jump', forkSimTime: sim(2), startedRealAt: real(24), carried: carried(['main']), lastSimTime: sim(28) }),
      node('day3', { parentId: 'day2', cause: 'jump', forkSimTime: day3ForkSim, startedRealAt: real(48, 9), carried: carried(['main']) }),
    );
    const base = {
      symbol: SYMBOL, campaignOpen: false, campaignPositionIds: ['main'],
      anchors: [anchor('a', real(0), sim(0)), anchor('day3', real(48, 30), sim(20), 'record-close')],
      activity: [act('b', sim(3), real(0, 10)), act('b', sim(3, 6), real(0, 12)), act('day2', sim(2), real(24)), act('day2', sim(28), real(24, 15))],
    };
    expect(buildCampaignTimelineScope({ ...base, registry: closeOnDay3(sim(15)) })!.timelineIds).toEqual(['a', 'b', 'day3']);
    // 第三天回到 b 停下处以下：倒回另起一遍，b 是被放弃的时间线
    expect(buildCampaignTimelineScope({ ...base, registry: closeOnDay3(sim(3)) })!.timelineIds).toEqual(['a', 'day3']);
    // 同一次坐下来里又倒回了一次：本场停在后一遍（b2）上，b 不是本场停下的地方
    const twice = registry(
      node('a', { startedRealAt: real(0, -1), lastSimTime: sim(8) }),
      node('b', { parentId: 'a', cause: 'jump', forkSimTime: sim(3), startedRealAt: real(0, 9), carried: carried(['main']) }),
      node('b2', { parentId: 'b', cause: 'jump', forkSimTime: sim(1), startedRealAt: real(0, 20), carried: carried(['main']), lastSimTime: sim(1, 30) }),
      node('day3', { parentId: 'b2', cause: 'jump', forkSimTime: sim(15), startedRealAt: real(48, 9), carried: carried(['main']) }),
    );
    expect(buildCampaignTimelineScope({ ...base, registry: twice })!.timelineIds).toEqual(['a', 'b2', 'day3']);
    // 隔了一次坐下来另起的一遍（day2）没有本场的操作：哪怕第三天从它停下处往前接着打，也不是本场停下的地方
    const fromDay2 = registry(
      node('a', { startedRealAt: real(0, -1), lastSimTime: sim(8) }),
      node('day2', { parentId: 'a', cause: 'jump', forkSimTime: sim(2), startedRealAt: real(24), carried: carried(['main']), lastSimTime: sim(10) }),
      node('day3', { parentId: 'day2', cause: 'jump', forkSimTime: sim(15), startedRealAt: real(48, 9), carried: carried(['main']) }),
    );
    expect(buildCampaignTimelineScope({ ...base, registry: fromDay2 })!.timelineIds).toEqual(['a', 'day3']);
  });

  it('不带本场仓位的孩子不进本场（另一场战役从这里分叉）', () => {
    const tree = registry(
      node('a'),
      node('other', { parentId: 'a', cause: 'jump', forkSimTime: sim(0, 30), startedRealAt: real(0, 10), carried: carried(['someone-else']) }),
    );
    const scope = buildCampaignTimelineScope({
      registry: tree, symbol: SYMBOL, campaignOpen: true, campaignPositionIds: ['main'], activity: [],
      anchors: [anchor('a', real(0), sim(0), 'leg-open')],
    })!;
    expect(scope.timelineIds).toEqual(['a']);
  });
});

describe('逐张判：挂在 O 上 / 活进 O / 取代（用户政策 a）', () => {
  /** A 遍开主力，同一次坐下来倒回出来的 B 遍平掉。 */
  const rewindTree = () => registry(
    node('a', { startedRealAt: real(0, -1) }),
    node('b', {
      parentId: 'a', cause: 'jump', forkSimTime: sim(0, 1), startedRealAt: real(1, 33),
      carried: carried(['main'], ['a-live', 'a-carried-cancelled-late', 'a-carried-cancelled-early', 'a-carried-filled']),
    }),
  );
  const scopeOf = (activity: CampaignTimelineActivity[], campaignOpen = false) => buildCampaignTimelineScope({
    registry: rewindTree(), symbol: SYMBOL, campaignOpen, campaignPositionIds: ['main'],
    anchors: [anchor('a', real(0), sim(0)), anchor('b', real(1, 39), sim(30), 'record-close')],
    activity,
  })!;

  it('挂在 O 上、没被重走 → in；被之后那条线有章为证地重走、又没活进去 → out', () => {
    const scope = scopeOf([act('b', sim(0, 1), real(1, 34))]);        // B 遍 19:42 挂了单：从这里起重走
    expect(scope.verdict(order({ id: 'a-early', createdAt: sim(0, -2), createdTimelineId: 'a', cancelledAt: sim(1, 30), cancelledTimelineId: 'a' }))).toBe('in');
    expect(scope.verdict(order({ id: 'a-dup', createdAt: sim(0, 1) + 20_000, createdTimelineId: 'a', cancelledAt: sim(3), cancelledTimelineId: 'a' }))).toBe('out');
    expect(scope.verdict(order({ id: 'b-dup', createdAt: sim(0, 1), createdTimelineId: 'b', cancelledAt: sim(6), cancelledTimelineId: 'b' }))).toBe('in');
  });

  it('重走只认有章的活动：B 遍的活动都晚于它挂单的时刻 → 没被重走，照算', () => {
    const scope = scopeOf([act('b', sim(21), real(1, 34))]);
    expect(scope.verdict(order({ id: 'a-late', createdAt: sim(1), createdTimelineId: 'a', cancelledAt: sim(1, 10), cancelledTimelineId: 'a' }))).toBe('in');
  });

  it('活进了 B 遍的不被取代：至今挂着 / 带进 B 后在 B 里走回它之后才撤 / 在 B 里成交；B 走回它之前就撤的照样取代', () => {
    const scope = scopeOf([act('b', sim(0, 1), real(1, 34))]);
    expect(scope.verdict(order({ id: 'a-live', createdAt: sim(0, 30), createdTimelineId: 'a' }), { live: true })).toBe('in');
    expect(scope.verdict(order({
      id: 'a-carried-cancelled-late', createdAt: sim(0, 30), createdTimelineId: 'a',
      cancelledAt: sim(2), cancelledTimelineId: 'b',
    }))).toBe('in');
    expect(scope.verdict(order({
      id: 'a-carried-cancelled-early', createdAt: sim(0, 30), createdTimelineId: 'a',
      cancelledAt: sim(0, -1), cancelledTimelineId: 'b',
    }))).toBe('out');
    // 倒回那一刻就触发：成交模拟时刻早于挂单也算活进 B（复核五 F2）
    expect(scope.verdict(order({
      id: 'a-carried-filled', createdAt: sim(0, 30), createdTimelineId: 'a',
      filledAt: sim(0, 0), filledTimelineId: 'b', positionId: 'pos-x',
    }))).toBe('in');
  });

  it('成交开出的仓位被 B 带着（还开着 / 在 B 里平掉）→ 活进 B；仓位不在了的照样取代（复核七 F4）', () => {
    const tree = registry(
      node('a'),
      node('b', { parentId: 'a', cause: 'jump', forkSimTime: sim(1), startedRealAt: real(0, 20), carried: carried(['main', 'pos-hedge', 'fill-merged']) }),
    );
    const scope = buildCampaignTimelineScope({
      registry: tree, symbol: SYMBOL, campaignOpen: true, campaignPositionIds: ['main'],
      anchors: [anchor('a', real(0), sim(0), 'leg-open'), anchor('b', real(0, 20), sim(1, 32), 'leg-open')],
      activity: [act('b', sim(4, 20), real(0, 25))],
    })!;
    const filled = (id: string, positionId: string) => order({
      id, createdAt: sim(2, 52), createdTimelineId: 'a', filledAt: sim(3, 48), filledTimelineId: 'a', positionId,
    });
    expect(scope.verdict(filled('hedge-open', 'pos-hedge'))).toBe('in');
    expect(scope.verdict(filled('hedge-merged', 'fill-merged'))).toBe('in');
    expect(scope.verdict(filled('hedge-gone', 'pos-gone'))).toBe('out');
  });

  it('挂在 O 之外却活进 O 的委托只认同一次坐下来里挂的（倒回之前那一遍）；隔天回放留下、至今挂着的旧单不借这条路混进来', () => {
    const tree = registry(
      node('r0', { startedRealAt: real(0, -5) }),
      node('mine', { parentId: 'r0', cause: 'jump', forkSimTime: sim(0, -2), startedRealAt: real(0, -1), carried: carried([], ['pre-rewind-live', 'stale-live']) }),
      node('foreign', { startedRealAt: real(-72) }),
    );
    const scope = buildCampaignTimelineScope({
      registry: tree, symbol: SYMBOL, campaignOpen: true, campaignPositionIds: ['main'],
      anchors: [anchor('mine', real(0), sim(0), 'leg-open')], activity: [],
    })!;
    expect(scope.verdict(order({ id: 'pre-rewind-live', createdAt: sim(0, 8), createdRealAt: real(0, -2), createdTimelineId: 'r0' }), { live: true })).toBe('in');
    expect(scope.verdict(order({
      id: 'pre-rewind-cancelled', createdAt: sim(0, 6), createdRealAt: real(0, -3), createdTimelineId: 'r0',
      cancelledAt: sim(0, 7), cancelledRealAt: real(0, -2.5), cancelledTimelineId: 'r0',
    }))).toBe('out');
    expect(scope.verdict(order({ id: 'stale-live', createdAt: sim(0, 7), createdRealAt: real(-72), createdTimelineId: 'foreign' }), { live: true })).toBe('out');
  });

  it('倒放的时间线（翻转方向是分叉）：重走判据镜像——从上往下走，最早的活动是它走到过的最高时刻', () => {
    const tree = registry(
      node('a', { lastSimTime: sim(5) }),                 // 正放到 sim+5h 时翻转方向
      node('rev', { parentId: 'a', cause: 'direction', direction: -1, forkSimTime: sim(5), startedRealAt: real(0, 30), carried: carried(['main']) }),
    );
    const scope = buildCampaignTimelineScope({
      registry: tree, symbol: SYMBOL, campaignOpen: true, campaignPositionIds: ['main'],
      anchors: [anchor('a', real(0), sim(0), 'leg-open')],
      // 倒放里最高的一次活动在 sim+4h30（撤了张旧单）、又在 sim+3h 挂了单：有证据的重走从 4h30 起往下
      activity: [act('rev', sim(4, 30), real(0, 35)), act('rev', sim(3), real(0, 40))],
    })!;
    const aOrder = (id: string, createdAt: number) => order({ id, createdAt, createdTimelineId: 'a', cancelledAt: createdAt + M, cancelledTimelineId: 'a' });
    expect(scope.verdict(aOrder('a-4h50', sim(4, 50)))).toBe('in');   // 高于倒放有证据的入口：没被重走
    expect(scope.verdict(aOrder('a-4h', sim(4)))).toBe('out');        // 被倒放重走过
    expect(scope.verdict(aOrder('a-2h', sim(2)))).toBe('out');        // 入口之下一路往下走，同样算重走（与正放的假设镜像）
    // 正放里挂的单、翻转后在倒放里撤：翻转点（5h）已经在它挂单时刻之后，倒放从一开始就看得见它，
    // 撤在 4h30（还没走回 3h30）或 3h10 都算活进了倒放——翻转没有「还没走到」的空档，与倒回不同
    expect(scope.verdict(order({ id: 'a-3h30', createdAt: sim(3, 30), createdTimelineId: 'a', cancelledAt: sim(4, 30), cancelledTimelineId: 'rev' }))).toBe('in');
    expect(scope.verdict(order({ id: 'a-3h30-seen', createdAt: sim(3, 30), createdTimelineId: 'a', cancelledAt: sim(3, 10), cancelledTimelineId: 'rev' }))).toBe('in');
  });

  it('「走到挂单时刻」按挂单那条线的方向：倒放里挂的单，往上一跳（倒放的倒回）还没走下来就撤的没活进去，走下来了才算', () => {
    const tree = registry(
      node('rev', { direction: -1, forkSimTime: sim(6), startedRealAt: real(0, -1), lastSimTime: sim(3) }),   // 倒放从 6h 走到 3h
      node('up', { parentId: 'rev', cause: 'jump', direction: -1, forkSimTime: sim(5), startedRealAt: real(0, 30), carried: carried(['main'], ['rev-4h']) }),
    );
    const scope = buildCampaignTimelineScope({
      registry: tree, symbol: SYMBOL, campaignOpen: true, campaignPositionIds: ['main'],
      anchors: [anchor('rev', real(0), sim(5, 30), 'leg-open')], activity: [act('up', sim(4, 50), real(0, 31))],
    })!;
    expect(scope.timelineIds).toEqual(['rev', 'up']);
    // 倒放里 4h 挂的单：跳回 5h 往下走，4h30 就撤（还在它挂单时刻「之前」）→ 没活进 up；up 有证据从 4h50 起往下重走 → 取代
    expect(scope.verdict(order({ id: 'rev-4h', createdAt: sim(4), createdTimelineId: 'rev', cancelledAt: sim(4, 30), cancelledTimelineId: 'up' }))).toBe('out');
    // 走过 4h 之后才撤：活进了 up
    expect(scope.verdict(order({ id: 'rev-4h', createdAt: sim(4), createdTimelineId: 'rev', cancelledAt: sim(3, 50), cancelledTimelineId: 'up' }))).toBe('in');
  });
});

describe('没盖章的委托 / mixed / defer', () => {
  const bootstrapTree = () => registry(
    node('boot', { cause: 'bootstrap', startedRealAt: real(0, -30), carried: carried(['main'], ['boot-carried', 'boot-carried-cancelled']) }),
    node('s', { parentId: 'boot', cause: 'start', forkSimTime: sim(0), startedRealAt: real(0), carried: carried(['main'], ['start-carried']) }),
    node('foreign', { startedRealAt: real(-72) }),
  );

  it('exact 战役：bootstrap 带进来的没章委托算本场；start 起步带上的旧单 / 什么都没有的 → out', () => {
    const scope = buildCampaignTimelineScope({
      registry: bootstrapTree(), symbol: SYMBOL, campaignOpen: false, campaignPositionIds: ['main'],
      anchors: [anchor('boot', real(0, -20), sim(0)), anchor('s', real(0, 50), sim(30), 'record-close')], activity: [],
    })!;
    expect(scope.mode).toBe('exact');
    expect(scope.verdict(order({ id: 'boot-carried', createdAt: sim(0, 1) }), { live: true })).toBe('in');
    expect(scope.verdict(order({ id: 'boot-carried-cancelled', createdAt: sim(0, 1), cancelledAt: sim(5), cancelledRealAt: real(0, 20), cancelledTimelineId: 's' }))).toBe('in');
    expect(scope.verdict(order({ id: 'start-carried', createdAt: sim(0, 1) }), { live: true })).toBe('out');
    expect(scope.verdict(order({ id: 'aug', createdAt: sim(0, 1), cancelledAt: sim(5) }))).toBe('out');
    // 撤单盖了章（⏹ 停止一键撤的老单）：还是上一次回放留下的
    expect(scope.verdict(order({ id: 'aug-stop', createdAt: sim(0, 2), cancelledAt: sim(30), cancelledRealAt: real(0, 50), cancelledTimelineId: 's' }))).toBe('out');
    expect(scope.verdict(order({ id: 'aug-foreign-end', createdAt: sim(0, 2), cancelledAt: sim(5), cancelledRealAt: real(-72, 5), cancelledTimelineId: 'foreign' }))).toBe('out');
  });

  it('老标签页守卫：没章却挂在本场时间线开始之后（或撤单没章却晚于本场开始）→ defer', () => {
    const scope = buildCampaignTimelineScope({
      registry: bootstrapTree(), symbol: SYMBOL, campaignOpen: false, campaignPositionIds: ['main'],
      anchors: [anchor('boot', real(0, -20), sim(0)), anchor('s', real(0, 50), sim(30), 'record-close')], activity: [],
    })!;
    expect(scope.verdict(order({ id: 'stale-created', createdAt: sim(1), createdRealAt: real(0, 5) }), { live: true })).toBe('defer');
    expect(scope.verdict(order({ id: 'stale-cancelled', createdAt: sim(1), cancelledAt: sim(2), cancelledRealAt: real(0, 6) }))).toBe('defer');
    expect(scope.verdict(order({ id: 'old-created', createdAt: sim(1), createdRealAt: real(-72) }), { live: true })).toBe('out');
  });

  it('mixed 战役：挂在 O 上 in、挂在无关的根上 out、其余（同一棵树的别的枝、没章的）defer', () => {
    const tree = registry(
      node('a', { startedRealAt: real(0, -1) }),
      node('sibling', { parentId: 'a', cause: 'jump', forkSimTime: sim(0, 30), startedRealAt: real(0, 10), carried: carried(['other-pos']) }),
      node('foreign', { startedRealAt: real(-72) }),
    );
    const scope = buildCampaignTimelineScope({
      registry: tree, symbol: SYMBOL, campaignOpen: false, campaignPositionIds: ['main'],
      anchors: [anchor(null, real(0), sim(0)), anchor('a', real(0, 50), sim(30), 'record-close')], activity: [],
    })!;
    expect(scope.mode).toBe('mixed');
    expect(scope.verdict(order({ id: 'on-a', createdAt: sim(1), createdTimelineId: 'a', cancelledAt: sim(2), cancelledTimelineId: 'a' }))).toBe('in');
    expect(scope.verdict(order({ id: 'on-foreign', createdAt: sim(1), createdTimelineId: 'foreign', cancelledAt: sim(2), cancelledTimelineId: 'foreign' }))).toBe('out');
    expect(scope.verdict(order({ id: 'on-sibling', createdAt: sim(1), createdTimelineId: 'sibling', cancelledAt: sim(2), cancelledTimelineId: 'sibling' }))).toBe('defer');
    expect(scope.verdict(order({ id: 'unstamped', createdAt: sim(1), createdRealAt: real(0, 5) }), { live: true })).toBe('defer');
  });

  it('章指向登记表里没有的节点 → defer；锚点节点缺失时其余盖了章的委托也只能 defer', () => {
    const scope = buildCampaignTimelineScope({
      registry: registry(node('a')), symbol: SYMBOL, campaignOpen: false, campaignPositionIds: ['main'],
      anchors: [anchor('a', real(0), sim(0)), anchor('a', real(0, 50), sim(30), 'record-close')], activity: [],
    })!;
    expect(scope.verdict(order({ id: 'ghost-created', createdAt: sim(1), createdTimelineId: 'ghost' }), { live: true })).toBe('defer');
    expect(scope.verdict(order({ id: 'ghost-end', createdAt: sim(1), createdTimelineId: 'a', cancelledAt: sim(2), cancelledTimelineId: 'ghost' }))).toBe('defer');

    const anchorsLost = buildCampaignTimelineScope({
      registry: registry(node('other', { startedRealAt: real(-72) })), symbol: SYMBOL, campaignOpen: false, campaignPositionIds: ['main'],
      anchors: [anchor('lost', real(0), sim(0))], activity: [],
    })!;
    expect(anchorsLost).toMatchObject({ mode: 'mixed', timelineIds: [], missingAnchorNodes: ['lost'] });
    expect(anchorsLost.verdict(order({ id: 'on-other', createdAt: sim(1), createdTimelineId: 'other' }), { live: true })).toBe('defer');
    expect(anchorsLost.verdict(order({ id: 'unstamped', createdAt: sim(1) }), { live: true })).toBe('defer');
  });
});

describe('复审修正：bootstrap 之前的老单、挂着的主力、指针清掉后的 bootstrap、断掉的祖先链', () => {
  it('exact 战役、本场最早的线是 bootstrap 根：上线前几分钟老代码挂了又撤的单（没被带进 bootstrap）→ defer，不是 out；隔了一次坐下来的仍是 out', () => {
    // 老代码跑到 sim−1m 时刷新页面，新代码在 R+5m 补出 bootstrap；本场开 / 平都在它上面 → exact
    const tree = registry(
      node('boot', { cause: 'bootstrap', forkSimTime: sim(0, -1), startedRealAt: real(0, 5), carried: carried(['main']) }),
    );
    const scope = buildCampaignTimelineScope({
      registry: tree, symbol: SYMBOL, campaignOpen: false, campaignPositionIds: ['main'],
      anchors: [anchor('boot', real(0, 6), sim(0)), anchor('boot', real(0, 30), sim(30), 'record-close')], activity: [],
    })!;
    expect(scope.mode).toBe('exact');
    // R+1m 挂、R+2m 撤：bootstrap 快照里没有它，登记表分不出它与残单
    expect(scope.verdict(order({ id: 'pre-boot-hedge', createdAt: sim(-1), createdRealAt: real(0, 1), cancelledAt: sim(0, -30), cancelledRealAt: real(0, 2) }))).toBe('defer');
    // 只有撤单时刻的也一样
    expect(scope.verdict(order({ id: 'pre-boot-no-created-real', createdAt: sim(-1), cancelledAt: sim(0, -30), cancelledRealAt: real(0, 2) }))).toBe('defer');
    // 隔了一次坐下来（3 小时前）挂的：还是上一次回放留下的
    expect(scope.verdict(order({ id: 'earlier-sitting', createdAt: sim(-1), createdRealAt: real(-3), cancelledAt: sim(0, -30), cancelledRealAt: real(-3, 1) }))).toBe('out');
    // 本场最早的线是 start 根（新代码起步）时没有这条豁免：同一次坐下来里更早的没章单是老标签页 / 上一次回放的
    const startTree = registry(node('s', { startedRealAt: real(0, 5), carried: carried(['main']) }));
    const startScope = buildCampaignTimelineScope({
      registry: startTree, symbol: SYMBOL, campaignOpen: false, campaignPositionIds: ['main'],
      anchors: [anchor('s', real(0, 6), sim(0)), anchor('s', real(0, 30), sim(30), 'record-close')], activity: [],
    })!;
    expect(startScope.verdict(order({ id: 'pre-start', createdAt: sim(-1), createdRealAt: real(0, 1), cancelledAt: sim(0, -30), cancelledRealAt: real(0, 2) }))).toBe('out');
  });

  it('主力还是一张挂着的条件单：带着这张单倒回的那一遍带着本场，倒回那遍挂的前置对冲是本场的', () => {
    const tree = registry(
      node('a'),
      node('b', { parentId: 'a', cause: 'jump', forkSimTime: sim(0, 1), startedRealAt: real(0, 30), carried: carried([], ['cond-main']) }),
    );
    const scope = buildCampaignTimelineScope({
      registry: tree, symbol: SYMBOL, campaignOpen: true, campaignPositionIds: ['cond-main'],
      anchors: [anchor('a', real(0), sim(0), 'leg-open')], activity: [],
    })!;
    expect(scope.timelineIds).toEqual(['a', 'b']);
    expect(scope.verdict(order({ id: 'b-prehedge', createdAt: sim(0, 5), createdRealAt: real(0, 40), createdTimelineId: 'b' }), { live: true })).toBe('in');
  });

  it('还开着的本场仓位每笔成交的真实时刻是锚点时刻：主力没平、只靠成交撑着的那次坐下来里带着主力倒回的一遍进本场', () => {
    const tree = registry(
      node('a', { lastSimTime: sim(2) }),
      node('b', { parentId: 'a', cause: 'jump', forkSimTime: sim(0, 1), startedRealAt: real(0, 30), carried: carried(['main']) }),
    );
    const { anchors, campaignPositionIds } = collectCampaignTimelineEvidence({
      symbol: SYMBOL, selectedRecords: [], tradeHistory: [], campaignEvents: [], pendingOrders: [], cancelledOrders: [], filledOrders: [],
      legs: [{
        id: 'retro', user_id: 'u', trade_record_id: 'main', campaign_id: 'c', leg_role: 'main_open', source: 'retroactive_from_record',
        symbol: SYMBOL, direction: 'long', pre_simulated_time: new Date(sim(0)).toISOString(), pre_real_time: new Date(real(0)).toISOString(),
      } as TradeJournal],
      openPositions: [{ id: 'main', openedRealAt: real(0), fills: [{ id: 'main', timelineId: 'a', openTime: sim(0) }] }],
    });
    expect(anchors).toEqual([{ kind: 'position-fill', timelineId: 'a', realAt: real(0), simAt: sim(0) }]);
    const scope = buildCampaignTimelineScope({ registry: tree, symbol: SYMBOL, campaignOpen: true, campaignPositionIds, anchors, activity: [] })!;
    expect(scope.timelineIds).toEqual(['a', 'b']);
    expect(scope.verdict(order({ id: 'b-hedge', createdAt: sim(0, 5), createdRealAt: real(0, 40), createdTimelineId: 'b' }), { live: true })).toBe('in');
    // 每笔成交各自的真实时刻优先；平仓事件的 operation_time 也是本场的操作时刻
    const perFill = collectCampaignTimelineEvidence({
      symbol: SYMBOL, selectedRecords: [], tradeHistory: [], pendingOrders: [], cancelledOrders: [], filledOrders: [], legs: [],
      campaignEvents: [{
        id: 'evt', timestamp: new Date(sim(30)).toISOString(), event_type: 'main_fully_closed', leg_role: 'main_open', journal_id: null,
        trade_record_id: 'main', pending_order_id: null, price: null, size_usdt: null, notes: null, recorded_at: new Date(sim(30)).toISOString(),
        operation_time: new Date(real(1, 39)).toISOString(), timeline_id: 'b',
      }],
      openPositions: [{ id: 'main', openedRealAt: real(0), fills: [{ id: 'main', timelineId: 'a', openTime: sim(0) }, { id: 'add', timelineId: 'b', openTime: sim(1), openedRealAt: real(0, 45) }] }],
    });
    expect(perFill.anchors).toEqual([
      { kind: 'event', timelineId: 'b', realAt: real(1, 39), simAt: sim(30) },
      { kind: 'position-fill', timelineId: 'a', realAt: real(0), simAt: sim(0) },
      { kind: 'position-fill', timelineId: 'b', realAt: real(0, 45), simAt: sim(1) },
    ]);
  });

  it('跑到一半指针被清掉再补出来的 bootstrap：它带着的没章旧单，更早那条本场时间线（start 根）早就带着 → 仍是 out', () => {
    const tree = registry(
      node('n', { carried: carried(['main'], ['aug']), endSimTime: sim(1), endedRealAt: real(0, 10) }),   // 远端的结束合并进来
      node('b2', { cause: 'bootstrap', forkSimTime: sim(1), startedRealAt: real(0, 11), carried: carried(['main'], ['aug']) }),
    );
    const scope = buildCampaignTimelineScope({
      registry: tree, symbol: SYMBOL, campaignOpen: false, campaignPositionIds: ['main'],
      anchors: [anchor('n', real(0), sim(0)), anchor('b2', real(0, 50), sim(5), 'record-close')], activity: [],
    })!;
    expect(scope).toMatchObject({ mode: 'exact', timelineIds: ['b2', 'n'] });
    expect(scope.verdict(order({ id: 'aug', createdAt: sim(0, 1), cancelledAt: sim(5), cancelledRealAt: real(0, 50), cancelledTimelineId: 'b2' }))).toBe('out');
    // 真正的「新代码第一次看见在跑的钟」：本场里没有比它更早的线，带进来的照算
    const firstBoot = buildCampaignTimelineScope({
      registry: registry(node('b2', { cause: 'bootstrap', forkSimTime: sim(1), startedRealAt: real(0, 11), carried: carried(['main'], ['aug']) })),
      symbol: SYMBOL, campaignOpen: false, campaignPositionIds: ['main'],
      anchors: [anchor('b2', real(0, 20), sim(2)), anchor('b2', real(0, 50), sim(5), 'record-close')], activity: [],
    })!;
    expect(firstBoot.verdict(order({ id: 'aug', createdAt: sim(0, 1), cancelledAt: sim(5), cancelledRealAt: real(0, 50), cancelledTimelineId: 'b2' }))).toBe('in');
  });

  it('mixed 战役、锚点节点缺失且它的孩子们的祖先链都断在它上面：同一棵树的别的枝判不了 → defer，不是 out', () => {
    // a → c（跳转，带着主力）→ b（跳转，带着主力）；a 还没同步过来
    const tree = registry(
      node('c', { parentId: 'a', cause: 'jump', forkSimTime: sim(0, 30), startedRealAt: real(0, 10), carried: carried(['main']) }),
      node('b', { parentId: 'c', cause: 'jump', forkSimTime: sim(0, 40), startedRealAt: real(0, 20), carried: carried(['main']) }),
    );
    const scope = buildCampaignTimelineScope({
      registry: tree, symbol: SYMBOL, campaignOpen: false, campaignPositionIds: ['main'],
      anchors: [anchor('a', real(0), sim(0)), anchor('b', real(0, 50), sim(30), 'record-close')], activity: [],
    })!;
    expect(scope).toMatchObject({ mode: 'mixed', missingAnchorNodes: ['a'] });
    expect(scope.verdict(order({ id: 'on-c', createdAt: sim(0, 35), createdTimelineId: 'c', cancelledAt: sim(0, 36), cancelledTimelineId: 'c' }))).toBe('defer');
    // 祖先链完整、确实是另一棵树的仍是 out
    const withForeign = buildCampaignTimelineScope({
      registry: registry(node('b', { startedRealAt: real(0, 20), carried: carried(['main']) }), node('foreign', { startedRealAt: real(-72) })),
      symbol: SYMBOL, campaignOpen: false, campaignPositionIds: ['main'],
      anchors: [anchor(null, real(0), sim(0)), anchor('b', real(0, 50), sim(30), 'record-close')], activity: [],
    })!;
    expect(withForeign.verdict(order({ id: 'on-foreign', createdAt: sim(1), createdTimelineId: 'foreign', cancelledAt: sim(2), cancelledTimelineId: 'foreign' }))).toBe('out');
  });

  it('翻转方向前父线盖了一章（分叉时的撮合时钟）：倒放里的活动上限不再随父线上一次无关的盖章而变', () => {
    // 与登记表实际写出来的一致：父线 a 在翻转点 5h 有 lastSimTime（forkReplayTimeline 的 parentSimTime）
    const build = (extraStamp: number | null) => buildCampaignTimelineScope({
      registry: registry(
        node('a', { lastSimTime: sim(5) }),
        node('rev', { parentId: 'a', cause: 'direction', direction: -1, forkSimTime: sim(5), startedRealAt: real(0, 30), carried: carried(['main']) }),
      ),
      symbol: SYMBOL, campaignOpen: true, campaignPositionIds: ['main'],
      anchors: [anchor('a', real(0), sim(0), 'leg-open')],
      activity: [act('rev', sim(4, 30), real(0, 35)), ...(extraStamp == null ? [] : [act('a', extraStamp, real(0, 29))])],
    })!;
    const h = order({ id: 'h', createdAt: sim(4), createdTimelineId: 'a', cancelledAt: sim(4, 10), cancelledTimelineId: 'a' });
    // 倒放从 4h30 起有证据往下重走：a 上 4h 挂、4h10 撤（翻转前）的单被取代——不论 a 上有没有别的盖章
    expect(build(null).verdict(h)).toBe('out');
    expect(build(sim(4, 50)).verdict(h)).toBe('out');
    // 翻转后在倒放里撤的：活进了倒放，照算
    const carriedIn = order({ id: 'h2', createdAt: sim(4), createdTimelineId: 'a', cancelledAt: sim(4, 30), cancelledTimelineId: 'rev' });
    expect(build(null).verdict(carriedIn)).toBe('in');
    expect(build(sim(4, 50)).verdict(carriedIn)).toBe('in');
  });
});

describe('collectCampaignTimelineEvidence：锚点 / 活动 / 本场仓位 id', () => {
  const record = (over: Partial<TradeRecord>): TradeRecord => ({
    id: 'rec', positionId: 'pos', fillId: 'pos', symbol: SYMBOL, side: 'LONG', type: 'MARKET', action: 'CLOSE',
    entryPrice: 1, exitPrice: 1.1, quantity: 1, leverage: 5, pnl: 0, fee: 0, slippage: 0,
    openTime: sim(0), closeTime: sim(30), ...over,
  } as TradeRecord);
  const leg = (over: Partial<TradeJournal>): TradeJournal => ({
    id: 'leg', user_id: 'u', trade_record_id: 'rec', campaign_id: 'c', leg_role: 'main_open', source: 'live',
    symbol: SYMBOL, direction: 'long', pre_simulated_time: new Date(sim(0)).toISOString(), pre_real_time: new Date(real(0)).toISOString(),
    ...over,
  } as TradeJournal);
  const event = (over: Partial<CampaignEvent>): CampaignEvent => ({
    id: 'evt', timestamp: new Date(sim(30)).toISOString(), event_type: 'main_fully_closed', leg_role: 'main_open',
    journal_id: 'leg', trade_record_id: 'rec', pending_order_id: null, price: null, size_usdt: null, notes: null,
    recorded_at: new Date(sim(30)).toISOString(), ...over,
  });

  it('成交的开 / 平各一个锚点，没章的照样列出；资金费不算；实时腿的记录决策是锚点；事件只在带章时算', () => {
    const { anchors, campaignPositionIds } = collectCampaignTimelineEvidence({
      symbol: SYMBOL,
      selectedRecords: [
        record({ openedTimelineId: 'a', closedTimelineId: 'b', openedRealAt: real(0), closedRealAt: real(1, 39) }),
        record({ id: 'funding', action: 'FUNDING', type: 'FUNDING', closedTimelineId: 'a' } as Partial<TradeRecord>),
      ],
      tradeHistory: [],
      legs: [leg({ pre_timeline_id: 'a' }), leg({ id: 'retro', source: 'retroactive_from_record', pre_timeline_id: undefined })],
      campaignEvents: [event({ timeline_id: 'b' }), event({ id: 'note', event_type: 'note', timeline_id: null })],
      openPositions: [], pendingOrders: [], cancelledOrders: [], filledOrders: [],
    });
    expect(anchors.map(a => [a.kind, a.timelineId])).toEqual([
      ['record-open', 'a'], ['record-close', 'b'], ['leg-open', 'a'], ['event', 'b'],
    ]);
    expect(Array.from(campaignPositionIds)).toEqual(['pos', 'rec']);
  });

  it('本地成交被清掉：腿的平仓操作从关联事件上取章，事件没章就是没盖章的锚点', () => {
    const closed = leg({
      id: 'closed-leg', trade_record_id: 'gone', source: 'retroactive_from_record',
      post_simulated_close_time: new Date(sim(30)).toISOString(), post_real_close_time: new Date(real(1, 39)).toISOString(),
    });
    const withEvent = collectCampaignTimelineEvidence({
      symbol: SYMBOL, selectedRecords: [], tradeHistory: [], legs: [closed],
      campaignEvents: [event({ journal_id: 'closed-leg', trade_record_id: 'gone', timeline_id: 'b' })],
      openPositions: [], pendingOrders: [], cancelledOrders: [], filledOrders: [],
    });
    expect(withEvent.anchors.map(a => [a.kind, a.timelineId])).toEqual([['leg-close', 'b'], ['event', 'b']]);
    const without = collectCampaignTimelineEvidence({
      symbol: SYMBOL, selectedRecords: [], tradeHistory: [], legs: [closed], campaignEvents: [],
      openPositions: [], pendingOrders: [], cancelledOrders: [], filledOrders: [],
    });
    expect(without.anchors).toEqual([{ kind: 'leg-close', timelineId: null, realAt: real(1, 39), simAt: sim(30) }]);
  });

  it('还开着的本场仓位：每笔成交的章是锚点，成交 id 进本场仓位集合；实时腿存的委托 id 经成交快照解析到仓位', () => {
    const filled: FilledOrderSnapshot = {
      id: 'cond-order', symbol: SYMBOL, side: 'LONG', type: 'CONDITIONAL', price: 1, triggerPrice: 1, quantity: 1, leverage: 5,
      createdAt: sim(0), filledAt: sim(0, 5), positionId: 'pos-from-order', createdTimelineId: 'a', filledTimelineId: 'a',
    };
    const { anchors, campaignPositionIds, activity } = collectCampaignTimelineEvidence({
      symbol: SYMBOL, selectedRecords: [], tradeHistory: [], campaignEvents: [],
      legs: [leg({ trade_record_id: 'cond-order', pre_timeline_id: 'a' })],
      openPositions: [
        { id: 'pos-from-order', fills: [{ id: 'pos-from-order', openTime: sim(0, 5), timelineId: 'a' }, { id: 'add', openTime: sim(2), timelineId: 'b' }] },
        { id: 'someone-else', openTimelineId: 'a' },
      ],
      pendingOrders: [], cancelledOrders: [], filledOrders: [filled],
    });
    expect(anchors.map(a => [a.kind, a.timelineId])).toEqual([['leg-open', 'a'], ['position-fill', 'a'], ['position-fill', 'b']]);
    expect(Array.from(campaignPositionIds).sort()).toEqual(['add', 'cond-order', 'pos-from-order']);
    expect(activity).toEqual([
      { timelineId: 'a', simAt: sim(0), realAt: null },
      { timelineId: 'a', simAt: sim(0, 5), realAt: null },
    ]);
  });

  it('活动：这个标的上所有盖了章的写入（挂 / 撤 / 成交、开 / 平），别的标的与资金费不算', () => {
    const pending: PendingOrder = {
      id: 'p', side: 'SHORT', type: 'LIMIT', price: 1, stopPrice: 0, quantity: 1, leverage: 5, marginMode: 'isolated', status: 'NEW',
      createdAt: sim(1), createdRealAt: real(0, 1), createdTimelineId: 'a',
    };
    const cancelled: CancelledOrderSnapshot = {
      id: 'c', symbol: SYMBOL, side: 'SHORT', type: 'LIMIT', price: 1, quantity: 1, leverage: 5,
      createdAt: sim(2), cancelledAt: sim(3), createdRealAt: real(0, 2), cancelledRealAt: real(0, 3), createdTimelineId: 'a', cancelledTimelineId: 'b',
    };
    const other: CancelledOrderSnapshot = { ...cancelled, id: 'eth', symbol: 'ETHUSDT' };
    const { activity } = collectCampaignTimelineEvidence({
      symbol: SYMBOL, selectedRecords: [], legs: [], campaignEvents: [], openPositions: [], filledOrders: [],
      tradeHistory: [
        record({ id: 'r', openedTimelineId: 'a', closedTimelineId: 'b', openedRealAt: real(0), closedRealAt: real(1) }),
        record({ id: 'f', action: 'FUNDING', type: 'FUNDING', closedTimelineId: 'b', closedRealAt: real(0, 30) } as Partial<TradeRecord>),
        record({ id: 'eth', symbol: 'ETHUSDT', openedTimelineId: 'a' }),
      ],
      pendingOrders: [pending], cancelledOrders: [cancelled, other],
    });
    expect(activity).toEqual([
      { timelineId: 'a', simAt: sim(1), realAt: real(0, 1) },
      { timelineId: 'a', simAt: sim(2), realAt: real(0, 2) },
      { timelineId: 'b', simAt: sim(3), realAt: real(0, 3) },
      { timelineId: 'a', simAt: sim(0), realAt: real(0) },
      { timelineId: 'b', simAt: sim(30), realAt: real(1) },
    ]);
  });
});
