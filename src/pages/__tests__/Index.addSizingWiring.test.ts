import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Index.tsx 里加仓计划的接线。整页没有任何测试能渲染（K 线、回放引擎、云同步全挂在上面），
 * 所以这几处按源码钉住——删掉哪一处，这里就红：
 *   · 两处成交快照（条件单触发、挂单撮合）都把委托上的 addSizingSnapshot 带到 FilledOrderSnapshot 上；
 *   · 条件单触发后按市价成交：建仓之后、合并之前按触发价复判（持仓取合并前那一份）；
 *   · 停止回放（隔离 / 同步）、合并时间轴、开始回放 / 跳到信号时刻（分叉出新的一场）时清掉计算器没下出去的计划；
 *   · 顶栏把引擎成交基准价、价格精度、数量精度交给计算器。
 * 行为本身在 useBackgroundPrices / TradingContext / addSizingFillGuard 的测试里跑真实代码；这里只守接线。
 */
const index = readFileSync(join(process.cwd(), 'src', 'pages', 'Index.tsx'), 'utf8');

/** 从 start 开始、到第一个 end 为止的一段源码（含 end）；找不到就让测试红。 */
function slice(from: string, start: string, end: string, offset = 0): string {
  const at = from.indexOf(start, offset);
  expect(at, `找不到「${start}」`).toBeGreaterThan(-1);
  const stop = from.indexOf(end, at + start.length);
  expect(stop, `「${start}」之后找不到「${end}」`).toBeGreaterThan(-1);
  return from.slice(at, stop + end.length);
}

describe('Index.tsx 的加仓计划接线', () => {
  it('每一处成交快照（upsertOrderSnapshot）都带上委托上的加仓计划', () => {
    const calls: string[] = [];
    let offset = 0;
    for (;;) {
      const at = index.indexOf('upsertOrderSnapshot(prev, {', offset);
      if (at < 0) break;
      calls.push(slice(index, 'upsertOrderSnapshot(prev, {', '}));', at));
      offset = at + 1;
    }
    // 条件单触发一处、挂单撮合一处
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('...(order.addSizingSnapshot ? { addSizingSnapshot: order.addSizingSnapshot } : {})');
    expect(calls[1]).toContain('...(matchedOrder.addSizingSnapshot ? { addSizingSnapshot: matchedOrder.addSizingSnapshot } : {})');
  });

  it('条件单触发：建仓 → 在 updater 里记下合并前的持仓 → 合并 → 按触发价复判（带着委托上的计划）', () => {
    const body = slice(index, 'const createTriggeredConditionalPosition = useCallback(', 'const runConditionalMatchingForSymbol');
    const fill = body.indexOf('executeSettlementFill(symbol, entryPrice, order, false,');
    const captured = body.indexOf('heldBeforeOut.current = existing;');
    const merged = body.indexOf('mergeFilledPosition(symbol, existing, position)');
    const judged = body.indexOf('judgePlannedAddFill(symbol, heldBeforeOut.current, position, entryPrice, order.addSizingSnapshot);');
    expect(fill).toBeGreaterThan(-1);
    expect(captured).toBeGreaterThan(fill);
    expect(merged).toBeGreaterThan(captured);
    expect(judged).toBeGreaterThan(merged);
    // 付不起被撤的单子不复判：复判在保证金结算之后
    expect(judged).toBeGreaterThan(body.indexOf('if (!settleFillDebit(symbol, order, margin, fee, openTime))'));
    // 依赖数组里有它，否则回调拿到的是旧的入口
    expect(body).toMatch(/\[[^\]]*judgePlannedAddFill[^\]]*\],\s*\);\s*const runConditionalMatchingForSymbol$/);
  });

  it('停止回放（隔离 / 同步）与合并时间轴：收尾平仓 / 撤单之后清掉计算器的计划，不漏到下一场', () => {
    const stopAll = slice(index, 'const handleStopAllAndSwitchToSynced = useCallback(', 'const handleStop = useCallback(');
    expect(stopAll.indexOf('clearAddSizingPlan();')).toBeGreaterThan(stopAll.indexOf('endReplayTimeline("all");'));
    const stop = slice(index, 'const handleStop = useCallback(', 'const handlePlaceOrderForActiveSymbol');
    const isolated = stop.indexOf('clearAddSizingPlan(activeSymbol);');
    const synced = stop.indexOf('clearAddSizingPlan();');
    expect(isolated).toBeGreaterThan(stop.indexOf('endReplayTimeline(replayTimelineScope("isolated", activeSymbol));'));
    expect(synced).toBeGreaterThan(stop.indexOf('endReplayTimeline("synced");'));
  });

  it('开始回放与跳到信号时刻（分叉出新的一场）：紧跟分叉清掉计划——隔离模式只清这个币，同步模式全清', () => {
    const start = slice(index, 'const handleStart = useCallback(', 'const handleJumpToSignal = useCallback(');
    const startFork = start.indexOf('forkReplayTimeline(activeSymbol, "start", startTs, timeDirection);');
    expect(startFork).toBeGreaterThan(-1);
    expect(start.indexOf('clearAddSizingPlan(timeMode === "isolated" ? activeSymbol : undefined);')).toBeGreaterThan(startFork);
    const jump = slice(index, 'const handleJumpToSignal = useCallback(', 'const handleSetTimeMode = useCallback(');
    const jumpFork = jump.indexOf('forkReplayTimeline(normalized, "jump", startTs, timeDirection);');
    expect(jumpFork).toBeGreaterThan(-1);
    const jumpClear = jump.indexOf('clearAddSizingPlan(timeMode === "isolated" ? normalized : undefined);');
    expect(jumpClear).toBeGreaterThan(jumpFork);
    // 取数失败的跳转不留痕迹：清计划在所有提前返回之后
    expect(jumpClear).toBeGreaterThan(jump.lastIndexOf('return { ok: false'));
  });

  it('顶栏把引擎成交基准价（与下单同一个式子）、价格精度、数量精度交给计算器', () => {
    const controls = slice(index, '<SessionModeControls', '/>');
    expect(controls).toContain('activeFillBasePrice={latestChartPriceRef.current || priceMap[activeSymbol] || currentPrice}');
    expect(controls).toContain('activePricePrecision={chartPricePrecision}');
    expect(controls).toContain('activeQuantityPrecision={quantityPrecision}');
  });
});
