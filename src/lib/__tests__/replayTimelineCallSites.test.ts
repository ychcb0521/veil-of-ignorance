import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/** 从 `from` 处的 `{` 起，取到它配对的 `}`。 */
function blockAt(source: string, from: number): string {
  const open = source.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error('unbalanced');
}

function handlerBody(source: string, name: string): string {
  const at = source.indexOf(`const ${name} = useCallback`);
  expect(at, `找不到 ${name}`).toBeGreaterThan(-1);
  return blockAt(source, at);
}

/**
 * 回放时间线的分叉 / 结束调用点守卫（Index.tsx 太大，挂不起组件测试）。
 *
 * 规矩只有三条，但每条错一次就会把章盖错，而且无声：
 *   1. 开始、信号跳转分叉；暂停、恢复、改倍速、切标的、切周期、刷新恢复**不**分叉。
 *   2. 分叉在改钟之前——要看「分叉之前这只钟在不在跑」决定挂在当前那条下面还是另起一个根。
 *   3. 停止、切模式时结束时间线，**排在收尾的平仓 / 撤单之后**——那几笔还属于旧时间线。
 * 行为本身在 contexts/__tests__/TradingContext.replayTimeline.test.tsx 里走真实 Provider 验过。
 */
describe('回放时间线的分叉 / 结束调用点', () => {
  const index = read('pages/Index.tsx');

  it('手动开始：取数成功之后、改钟之前分叉', () => {
    const body = handlerBody(index, 'handleStart');
    const forkAt = body.indexOf('forkReplayTimeline(activeSymbol, "start", startTs, timeDirection)');
    expect(forkAt).toBeGreaterThan(body.indexOf('data.length > 0'));
    expect(forkAt).toBeLessThan(body.indexOf('setCoinTimelines('));
    expect(forkAt).toBeLessThan(body.indexOf('sim.startSimulation('));
  });

  it('信号跳转：行情覆盖检查全部通过之后才分叉（失败的跳转不留痕迹），且在改钟之前', () => {
    const body = handlerBody(index, 'handleJumpToSignal');
    const forkAt = body.indexOf('forkReplayTimeline(normalized, "jump", startTs, timeDirection)');
    expect(forkAt).toBeGreaterThan(body.lastIndexOf('return { ok: false'));
    expect(forkAt).toBeLessThan(body.indexOf('setCoinTimelines('));
    expect(forkAt).toBeLessThan(body.indexOf('sim.startSimulation('));
  });

  it('暂停、恢复、改倍速、切标的、切周期都不分叉也不结束', () => {
    for (const name of ['handlePause', 'handleResume', 'handleSetSpeed', 'handleSymbolChange', 'handleIntervalChange']) {
      const body = handlerBody(index, name);
      expect(body, name).not.toContain('forkReplayTimeline(');
      expect(body, name).not.toContain('endReplayTimeline(');
    }
  });

  it('刷新恢复会话沿用登记表里的指针，不分叉', () => {
    const at = index.indexOf('hasRestoredRef.current = true;');
    expect(at).toBeGreaterThan(-1);
    const restore = index.slice(at, index.indexOf('}, []);', at));
    expect(restore).not.toContain('forkReplayTimeline(');
  });

  it('停止：两种模式都在收尾的平仓 / 撤单之后、停钟之前结束时间线', () => {
    const body = handlerBody(index, 'handleStop');
    const isolatedEnd = body.indexOf('endReplayTimeline(replayTimelineScope("isolated", activeSymbol))');
    expect(isolatedEnd).toBeGreaterThan(body.indexOf('handleCancelOrder(activeSymbol, order.id)'));
    expect(isolatedEnd).toBeLessThan(body.indexOf('status: "stopped"'));

    const syncedEnd = body.indexOf('endReplayTimeline("synced")');
    expect(syncedEnd).toBeGreaterThan(body.indexOf('handleCancelOrder(sym, order.id)'));
    expect(syncedEnd).toBeLessThan(body.lastIndexOf('sim.stopSimulation()'));
  });

  it('合并时间轴切回同步：收尾之后结束全部时间线；直接切模式同样结束', () => {
    const confirm = handlerBody(index, 'confirmStopAllAndSwitch');
    const endAt = confirm.indexOf('endReplayTimeline("all")');
    expect(endAt).toBeGreaterThan(confirm.lastIndexOf('handleCancelOrder('));
    expect(endAt).toBeLessThan(confirm.indexOf('sim.stopSimulation()'));

    const switchMode = handlerBody(index, 'handleSetTimeMode');
    const endAll = switchMode.indexOf('endReplayTimeline("all")');
    expect(endAll).toBeLessThan(switchMode.indexOf('setTimeMode(newMode)'));
    // 离开同步模式时全局那只钟要真的停下（结束时间线之后、换模式之前）：
    // 不停的话它在隔离模式下继续在原地跑，切回同步模式时登记表会给一只从没停过的钟补一个 bootstrap 根。
    const stopAt = switchMode.indexOf('sim.stopSimulation()');
    expect(stopAt).toBeGreaterThan(endAll);
    expect(stopAt).toBeLessThan(switchMode.indexOf('setTimeMode(newMode)'));
    expect(switchMode.slice(endAll, stopAt)).toContain('newMode === "isolated" && sim.status !== "stopped"');
  });

  it('翻转方向在改钟之前分叉', () => {
    const ctx = read('contexts/TradingContext.tsx');
    const body = handlerBody(ctx, 'setTimeDirection');
    const forkAt = body.indexOf("forkReplayTimeline(sym, 'direction'");
    expect(forkAt).toBeGreaterThan(-1);
    expect(body.indexOf("forkReplayTimeline(activeNow, 'direction'")).toBeGreaterThan(-1);
    expect(forkAt).toBeLessThan(body.indexOf('setCoinTimelines('));
    expect(forkAt).toBeLessThan(body.indexOf('sim.setDirection('));
  });

  it('每一个成交点都把时间线章交给 executeSettlementFill', () => {
    for (const rel of ['pages/Index.tsx', 'contexts/TradingContext.tsx', 'hooks/useBackgroundPrices.ts']) {
      const src = read(rel);
      // import 列表里写的是 `executeSettlementFill,`，不带括号，不会被这里数进去。
      let from = src.indexOf('executeSettlementFill(');
      let calls = 0;
      while (from > -1) {
        const call = src.slice(from, src.indexOf(');', from));
        expect(/timelineId|stampClock\(/i.test(call), `${rel}: ${call.slice(0, 120)}`).toBe(true);
        calls += 1;
        from = src.indexOf('executeSettlementFill(', from + 1);
      }
      expect(calls, rel).toBeGreaterThan(0);
    }
  });
});
