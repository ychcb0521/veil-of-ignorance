import { describe, expect, it } from 'vitest';
import {
  canExecuteReplayOrderAt,
  explicitRiskRebaseFor,
  planForwardReplayStep,
  replayEventIsAfterOrigin,
  replayOrderOrigin,
  type ReplayExecutionTimeline,
} from '@/lib/replayExecution';

const MINUTE = 60_000;
const APRIL = Date.UTC(2026, 3, 21, 8, 15);
const JUNE = Date.UTC(2026, 5, 23, 0, 21);
const key = 'BELUSDT|60000|1|timeline-1';
const bars = (start: number, count: number, interval = MINUTE) =>
  Array.from({ length: count }, (_, index) => ({ time: start + index * interval }));
const settledTimes = (data: { time: number }[], step: ReturnType<typeof planForwardReplayStep>) =>
  data.slice(step.settledStart, step.settledEnd).map((bar) => bar.time);

describe('forward replay execution cursor', () => {
  it('keeps the currently forming 5m candle across pause and resume, then settles it exactly once', () => {
    const intervalMs = 5 * MINUTE;
    const data = bars(JUNE, 5, intervalMs);
    const input = { key, data, intervalMs };
    const pausedTime = JUNE + 2 * MINUTE;
    const first = planForwardReplayStep({ ...input, cursor: null, simTime: pausedTime });
    expect(settledTimes(data, first)).toEqual([]);
    expect(first.formingIndex).toBe(0);

    // Wall-clock time spent paused is irrelevant; resuming retains sim time.
    const resumed = planForwardReplayStep({ ...input, cursor: first.cursor, simTime: pausedTime });
    expect(settledTimes(data, resumed)).toEqual([]);
    expect(resumed.formingIndex).toBe(0);
    const next = planForwardReplayStep({ ...input, cursor: resumed.cursor, simTime: JUNE + intervalMs });
    expect(settledTimes(data, next)).toEqual([JUNE]);
    expect(next.formingIndex).toBe(1);
    const sameFrame = planForwardReplayStep({ ...input, cursor: next.cursor, simTime: JUNE + intervalMs });
    expect(settledTimes(data, sameFrame)).toEqual([]);
  });

  it('never executes an old April window or its late historical append against a restored June clock', () => {
    const oldWindow = bars(APRIL, 20);
    const seeded = planForwardReplayStep({ cursor: null, key, data: oldWindow, simTime: JUNE, intervalMs: MINUTE });
    expect(settledTimes(oldWindow, seeded)).toEqual([]);
    expect(seeded.formingIndex).toBe(-1);
    expect(seeded.cursor.through).toBe(JUNE);

    const oldAppend = bars(APRIL, 40);
    const late = planForwardReplayStep({ cursor: seeded.cursor, key, data: oldAppend, simTime: JUNE + MINUTE, intervalMs: MINUTE });
    expect(settledTimes(oldAppend, late)).toEqual([]);
    expect(late.formingIndex).toBe(-1);
    expect(late.cursor.through).toBe(JUNE);

    const refreshed = [...oldAppend, ...bars(JUNE, 3)];
    const current = planForwardReplayStep({ cursor: late.cursor, key, data: refreshed, simTime: JUNE + MINUTE, intervalMs: MINUTE });
    expect(settledTimes(refreshed, current)).toEqual([JUNE]);
    expect(refreshed[current.formingIndex].time).toBe(JUNE + MINUTE);
  });

  it('finds unseen candles by timestamp after history is prepended, without replaying any old bars', () => {
    const original = bars(JUNE, 5);
    const first = planForwardReplayStep({ cursor: null, key, data: original, simTime: JUNE + MINUTE + MINUTE / 2, intervalMs: MINUTE });
    const expanded = [...bars(JUNE - 100 * MINUTE, 100), ...original];
    const next = planForwardReplayStep({ cursor: first.cursor, key, data: expanded, simTime: JUNE + 2 * MINUTE + MINUTE / 2, intervalMs: MINUTE });
    expect(settledTimes(expanded, next)).toEqual([JUNE + MINUTE]);
    expect(expanded[next.formingIndex].time).toBe(JUNE + 2 * MINUTE);
  });

  it('catches up every unseen closed candle once when streaming data arrives after the clock', () => {
    const shortWindow = bars(JUNE, 2);
    const first = planForwardReplayStep({ cursor: null, key, data: shortWindow, simTime: JUNE + MINUTE / 2, intervalMs: MINUTE });
    const exhausted = planForwardReplayStep({ cursor: first.cursor, key, data: shortWindow, simTime: JUNE + 5 * MINUTE + MINUTE / 2, intervalMs: MINUTE });
    expect(settledTimes(shortWindow, exhausted)).toEqual([JUNE, JUNE + MINUTE]);
    expect(exhausted.formingIndex).toBe(-1);
    expect(exhausted.cursor.through).toBe(JUNE + 2 * MINUTE);

    const streamed = bars(JUNE, 8);
    const catchUp = planForwardReplayStep({ cursor: exhausted.cursor, key, data: streamed, simTime: JUNE + 5 * MINUTE + MINUTE / 2, intervalMs: MINUTE });
    expect(settledTimes(streamed, catchUp)).toEqual([JUNE + 2 * MINUTE, JUNE + 3 * MINUTE, JUNE + 4 * MINUTE]);
    expect(catchUp.formingIndex).toBe(5);
    const next = planForwardReplayStep({ cursor: catchUp.cursor, key, data: streamed, simTime: JUNE + 7 * MINUTE, intervalMs: MINUTE });
    expect(settledTimes(streamed, next)).toEqual([JUNE + 5 * MINUTE, JUNE + 6 * MINUTE]);
  });

  it('seeds a replacement dataset generation at the live clock, not the previous cursor offset or date', () => {
    const previous = planForwardReplayStep({ cursor: null, key, data: bars(APRIL, 10), simTime: APRIL + MINUTE / 2, intervalMs: MINUTE });
    const replacement = bars(JUNE, 10);
    const next = planForwardReplayStep({ cursor: previous.cursor, key: 'BELUSDT|60000|2|timeline-1', data: replacement, simTime: JUNE + 5 * MINUTE + MINUTE / 2, intervalMs: MINUTE });
    expect(settledTimes(replacement, next)).toEqual([]);
    expect(next.formingIndex).toBe(5);
    expect(next.cursor.through).toBe(JUNE + 5 * MINUTE + MINUTE / 2);
  });

  it('rejects an unexpected clock regression on the same timeline without moving its watermark backwards', () => {
    const data = bars(JUNE, 10);
    const first = planForwardReplayStep({ cursor: null, key, data, simTime: JUNE + 5 * MINUTE, intervalMs: MINUTE });
    const regressed = planForwardReplayStep({ cursor: first.cursor, key, data, simTime: JUNE + MINUTE, intervalMs: MINUTE });
    expect(regressed.regressed).toBe(true);
    expect(settledTimes(data, regressed)).toEqual([]);
    expect(regressed.formingIndex).toBe(-1);
    expect(regressed.cursor.through).toBe(first.cursor.through);
    const restored = planForwardReplayStep({ cursor: regressed.cursor, key, data, simTime: JUNE + 6 * MINUTE, intervalMs: MINUTE });
    expect(settledTimes(data, restored)).toEqual([JUNE + 5 * MINUTE]);
  });

  it('allows an explicit replay timeline fork to seed an earlier clock without executing old closed bars', () => {
    const data = bars(JUNE, 10);
    const first = planForwardReplayStep({ cursor: null, key, data, simTime: JUNE + 5 * MINUTE, intervalMs: MINUTE });
    const forked = planForwardReplayStep({ cursor: first.cursor, key: 'BELUSDT|60000|1|timeline-2', data, simTime: JUNE + MINUTE / 2, intervalMs: MINUTE });
    expect(forked.regressed).toBe(false);
    expect(settledTimes(data, forked)).toEqual([]);
    expect(forked.formingIndex).toBe(0);
    expect(forked.cursor.through).toBe(JUNE + MINUTE / 2);
  });
});

describe('replayEventIsAfterOrigin', () => {
  it('rejects historical execution before a forward order origin, including the BEL April/June inversion', () => {
    expect(replayEventIsAfterOrigin(APRIL, JUNE, 1)).toBe(false);
    expect(replayEventIsAfterOrigin(JUNE, JUNE, 1)).toBe(true);
    expect(replayEventIsAfterOrigin(JUNE + MINUTE, JUNE, 1)).toBe(true);
  });

  it('uses the opposite chronological comparison for intentionally reversed playback', () => {
    expect(replayEventIsAfterOrigin(JUNE + MINUTE, JUNE, -1)).toBe(false);
    expect(replayEventIsAfterOrigin(JUNE, JUNE, -1)).toBe(true);
    expect(replayEventIsAfterOrigin(JUNE - MINUTE, JUNE, -1)).toBe(true);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid execution or origin timestamp %s', (invalid) => {
    for (const direction of [1, -1] as const) {
      expect(replayEventIsAfterOrigin(invalid, JUNE, direction)).toBe(false);
      expect(replayEventIsAfterOrigin(JUNE, invalid, direction)).toBe(false);
    }
  });
});

/**
 * 【用户要求】委托与强平的时序校验。实盘 BELUSDT：6 月 22 / 23 日开的仓与挂的滚动对冲，
 * 被 4 月 21 日的 K 线触发并强平（平仓价 0.013350）——旧行情被当成新行情执行，没人拦「委托还没挂出就成交」。
 */
describe('委托在时间线上从哪一刻起生效（replayOrderOrigin / canExecuteReplayOrderAt）', () => {
  const timeline = (over: Partial<ReplayExecutionTimeline> = {}): ReplayExecutionTimeline => ({
    id: 'june', cause: 'start', direction: 1, forkSimTime: JUNE - 60 * MINUTE, carried: {}, ...over,
  });
  const hedge = { id: 'bel-hedge', createdAt: JUNE, createdTimelineId: 'june' };

  it('在本线挂的委托：挂单时刻之前的行情一概不算数，之后的照常', () => {
    expect(replayOrderOrigin(timeline(), 'BELUSDT', hedge)).toBe(JUNE);
    expect(canExecuteReplayOrderAt(timeline(), 'BELUSDT', hedge, APRIL)).toBe(false);          // 4 月的旧 K 线
    expect(canExecuteReplayOrderAt(timeline(), 'BELUSDT', hedge, JUNE - 1)).toBe(false);       // 暂停前发出的取价
    expect(canExecuteReplayOrderAt(timeline(), 'BELUSDT', hedge, JUNE)).toBe(true);
    expect(canExecuteReplayOrderAt(timeline(), 'BELUSDT', hedge, JUNE + MINUTE)).toBe(true);
  });

  it('【BEL】时钟自己倒回 4 月（implicit）或补的根（bootstrap）：不是用户的操作，6 月挂的单不会被搬到 4 月成交', () => {
    for (const cause of ['implicit', 'bootstrap'] as const) {
      const regressed = timeline({ id: 'regressed', cause, forkSimTime: APRIL, carried: { BELUSDT: { orderIds: ['bel-hedge'] } } });
      expect(replayOrderOrigin(regressed, 'BELUSDT', hedge)).toBe(JUNE);
      expect(canExecuteReplayOrderAt(regressed, 'BELUSDT', hedge, APRIL + MINUTE)).toBe(false);
      // 时钟走回挂单时刻之后，它照常生效
      expect(canExecuteReplayOrderAt(regressed, 'BELUSDT', hedge, JUNE + MINUTE)).toBe(true);
    }
  });

  it('用户显式跳回更早的日期、带着挂单：从跳转那一刻起生效，不必等时钟走回原来的挂单时刻', () => {
    for (const cause of ['start', 'jump'] as const) {
      const jumped = timeline({ id: 'april', cause, forkSimTime: APRIL, carried: { BELUSDT: { orderIds: ['bel-hedge'] } } });
      expect(replayOrderOrigin(jumped, 'BELUSDT', hedge)).toBe(APRIL);
      expect(canExecuteReplayOrderAt(jumped, 'BELUSDT', hedge, APRIL - MINUTE)).toBe(false);   // 跳转点之前的行情仍不算
      expect(canExecuteReplayOrderAt(jumped, 'BELUSDT', hedge, APRIL + MINUTE)).toBe(true);
    }
    // 名单按标的记：别的币带过来的不算数；不在名单里的（对不上）仍按挂单时刻
    const other = timeline({ id: 'april', cause: 'jump', forkSimTime: APRIL, carried: { ETHUSDT: { orderIds: ['bel-hedge'] } } });
    expect(canExecuteReplayOrderAt(other, 'BELUSDT', hedge, APRIL + MINUTE)).toBe(false);
  });

  it('翻转方向带过来的委托：倒放时只认翻转点及更早的行情；倒放时新挂的只认挂单时刻及更早的', () => {
    const reversed = timeline({ id: 'rev', cause: 'direction', direction: -1, forkSimTime: JUNE + 30 * MINUTE, carried: { BELUSDT: { orderIds: ['bel-hedge'] } } });
    expect(replayOrderOrigin(reversed, 'BELUSDT', hedge)).toBe(JUNE + 30 * MINUTE);
    expect(canExecuteReplayOrderAt(reversed, 'BELUSDT', hedge, JUNE + 10 * MINUTE)).toBe(true);
    expect(canExecuteReplayOrderAt(reversed, 'BELUSDT', hedge, JUNE + 31 * MINUTE)).toBe(false);
    const placedInReverse = { id: 'new', createdAt: JUNE + 20 * MINUTE, createdTimelineId: 'rev' };
    expect(canExecuteReplayOrderAt(reversed, 'BELUSDT', placedInReverse, JUNE + 25 * MINUTE)).toBe(false);
    expect(canExecuteReplayOrderAt(reversed, 'BELUSDT', placedInReverse, JUNE + 15 * MINUTE)).toBe(true);
  });

  it('钟没在跑（没有时间线）：按挂单时刻与给定方向判；行情时刻无效一律不成交', () => {
    expect(canExecuteReplayOrderAt(null, 'BELUSDT', hedge, JUNE + MINUTE)).toBe(true);
    expect(canExecuteReplayOrderAt(null, 'BELUSDT', hedge, APRIL)).toBe(false);
    expect(canExecuteReplayOrderAt(null, 'BELUSDT', hedge, JUNE - MINUTE, -1)).toBe(true);
    expect(canExecuteReplayOrderAt(timeline(), 'BELUSDT', hedge, Number.NaN)).toBe(false);
    expect(canExecuteReplayOrderAt(timeline(), 'BELUSDT', hedge, 0)).toBe(false);
  });

  it('钟停着时挂的单没有挂单时刻（记的是 0）：显式开始带进来的从开始那一刻起生效；否则无从比较，不变成死单', () => {
    const unstamped = { id: 'idle', createdAt: 0, createdTimelineId: null };
    const started = timeline({ id: 'run', cause: 'start', forkSimTime: JUNE, carried: { BELUSDT: { orderIds: ['idle'] } } });
    expect(canExecuteReplayOrderAt(started, 'BELUSDT', unstamped, JUNE - MINUTE)).toBe(false);
    expect(canExecuteReplayOrderAt(started, 'BELUSDT', unstamped, JUNE + MINUTE)).toBe(true);
    const bootstrap = timeline({ id: 'boot', cause: 'bootstrap', forkSimTime: JUNE });
    expect(canExecuteReplayOrderAt(bootstrap, 'BELUSDT', unstamped, JUNE + MINUTE)).toBe(true);
    expect(canExecuteReplayOrderAt(bootstrap, 'BELUSDT', unstamped, Number.NaN)).toBe(false);
  });
});

describe('显式时间操作带过来的仓位，风险从哪一刻起算（explicitRiskRebaseFor）', () => {
  const main = { id: 'bel-main', openTime: JUNE, fills: [{ id: 'bel-main', openTime: JUNE }] };
  const carried = { BELUSDT: { positionIds: ['bel-main'], fillIds: ['bel-main'], orderIds: [] } };
  const timeline = (over: Partial<ReplayExecutionTimeline> = {}): ReplayExecutionTimeline => ({
    id: 'april', cause: 'jump', direction: 1, forkSimTime: APRIL, carried, ...over,
  });

  it('【BEL】时钟自己倒退 / 补根 / 没有时间线：不重置——风险起点留在 6 月的开仓时刻，4 月的行情判不到它', () => {
    expect(explicitRiskRebaseFor(timeline({ cause: 'implicit' }), 'BELUSDT', main)).toBeNull();
    expect(explicitRiskRebaseFor(timeline({ cause: 'bootstrap' }), 'BELUSDT', main)).toBeNull();
    expect(explicitRiskRebaseFor(null, 'BELUSDT', main)).toBeNull();
  });

  it('显式跳回更早的日期：带过来的仓位从跳转那一刻起承担风险（否则时钟到不了 6 月，永久免死）', () => {
    expect(explicitRiskRebaseFor(timeline(), 'BELUSDT', main)).toEqual({ rebaseAt: APRIL });
    expect(explicitRiskRebaseFor(timeline({ cause: 'start' }), 'BELUSDT', main)).toEqual({ rebaseAt: APRIL });
    // 不在名单里的仓位（分叉之后才开的）不重置
    expect(explicitRiskRebaseFor(timeline(), 'BELUSDT', { id: 'later', openTime: APRIL + MINUTE, fills: [{ id: 'later', openTime: APRIL + MINUTE }] })).toBeNull();
    expect(explicitRiskRebaseFor(timeline(), 'ETHUSDT', main)).toBeNull();
  });

  it('跳转之后又加了仓：起点跟到加仓那一刻（加仓改变强平价）；刷新页面重算也是同一个数', () => {
    const added = { ...main, fills: [...main.fills, { id: 'add-1', openTime: APRIL + 10 * MINUTE }] };
    expect(explicitRiskRebaseFor(timeline(), 'BELUSDT', added)).toEqual({ rebaseAt: APRIL + 10 * MINUTE });
    expect(explicitRiskRebaseFor(timeline(), 'BELUSDT', added)).toEqual({ rebaseAt: APRIL + 10 * MINUTE });
    // 向后跳（5 月的仓带到 6 月）再加仓：同理取加仓时刻，而不是退回跳转点
    const forward = timeline({ id: 'june', forkSimTime: JUNE });
    expect(explicitRiskRebaseFor(forward, 'BELUSDT', { ...main, openTime: APRIL, fills: [{ id: 'bel-main', openTime: APRIL }, { id: 'add-2', openTime: JUNE + 5 * MINUTE }] }))
      .toEqual({ rebaseAt: JUNE + 5 * MINUTE });
  });

  it('翻转方向：倒放里「最晚」是时刻最小的那一笔；老仓位没有逐笔成交、老节点没有逐笔名单时按仓位认', () => {
    const reversed = timeline({ id: 'rev', cause: 'direction', direction: -1, forkSimTime: JUNE + 30 * MINUTE });
    expect(explicitRiskRebaseFor(reversed, 'BELUSDT', main)).toEqual({ rebaseAt: JUNE + 30 * MINUTE });
    const addedInReverse = { ...main, fills: [...main.fills, { id: 'add-r', openTime: JUNE + 20 * MINUTE }] };
    expect(explicitRiskRebaseFor(reversed, 'BELUSDT', addedInReverse)).toEqual({ rebaseAt: JUNE + 20 * MINUTE });
    const legacyPosition = { id: 'bel-main', openTime: JUNE };
    expect(explicitRiskRebaseFor(timeline(), 'BELUSDT', legacyPosition)).toEqual({ rebaseAt: APRIL });
    const legacyNode = timeline({ carried: { BELUSDT: { positionIds: ['bel-main'] } } });
    expect(explicitRiskRebaseFor(legacyNode, 'BELUSDT', main)).toEqual({ rebaseAt: APRIL });
    expect(explicitRiskRebaseFor(timeline({ forkSimTime: Number.NaN }), 'BELUSDT', main)).toBeNull();
  });
});
