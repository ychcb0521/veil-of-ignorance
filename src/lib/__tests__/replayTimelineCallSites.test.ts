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

/**
 * 【用户要求】暂停 / 恢复 / 行情补载之间的时间隔离，委托与强平的时序校验。
 * 行为在 replayExecution.test.ts、liquidationPricePath.test.ts、useBackgroundPrices.test.tsx、
 * TradingContext.replayTimeline.test.tsx 里验过；这里守住「每一条成交路径都过了这一关」——漏接一条就是无声的。
 */
describe('时序校验的调用点：每条撮合路径都问 canExecuteReplayOrder，强平写入前再核一遍', () => {
  const index = read('pages/Index.tsx');
  const ctx = read('contexts/TradingContext.tsx');
  const background = read('hooks/useBackgroundPrices.ts');

  it('盘面逐根撮合（条件单 / 跟踪委托 / 止盈止损）先按这根 K 线的时刻筛委托', () => {
    const body = handlerBody(index, 'runConditionalMatchingForSymbol');
    expect(body).toContain('.filter(order => canExecuteReplayOrder(symbol, order, openTime))');
  });

  it('限价撮合：K 线先映回真实时间、夹到撮合时钟上，早于委托生效时刻的不撮合', () => {
    const at = index.indexOf('const klineEventTime = timeDirection === -1');
    expect(at).toBeGreaterThan(-1);
    const block = index.slice(at, index.indexOf('switch (order.type)', at));
    expect(block).toContain('Math.max(matchClock, klineRealStart)');
    expect(block).toContain('Math.min(matchClock, klineRealStart + iMs)');
    expect(block).toContain('if (!canExecuteReplayOrder(activeSymbol, order, klineEventTime)) {');
    expect(index).toContain('mirrorTime(activeReverseCap, kline.time)');
  });

  it('正放每帧推进按时间戳取「哪几根刚收线」，游标身份含数据集代次与时间线；数据集不是当前标的 / 周期时整帧不执行', () => {
    expect(index).toContain('const key = `${sym}|${iMs}|${context.generation}|${getTimelineId(sym)}`;');
    expect(index).toContain('const step = planForwardReplayStep({');
    // 时钟落在水位之前的那一帧不执行（持续太久则重新播种，见下一条）
    expect(index).toContain('if (step.regressed) {');
    expect(index).toContain('forwardRegressedSinceRef.current = null;');
    expect(index).toContain('if (!context || context.symbol !== sym || intervalToMs(context.interval) !== iMs) return;');
    // 原来按数组下标数「新收线了几根」：换了数据集、历史补进来，下标对应的就不是同一段时间了
    expect(index).not.toContain('while (cursorRef.current < data.length) {');
  });

  it('后台标的轮询：请求时刻之后才挂的委托不吃这次的价；成交时刻记请求时刻；暂停 / 跳转作废在途请求', () => {
    expect(background).toContain('canExecuteReplayOrder(symbol, order, simulatedTime)');
    expect(background).toContain('matchBackgroundOrders(sym, r!, orders, requestedTime)');
    expect(background).toContain('const requestIsCurrent = () => mountedRef.current && requestEpochRef.current.value === epoch;');
    expect(background).toContain('if (!isSymbolPlaying(symbol)) break;');
  });

  it('强平：风险起点只由显式时间操作重置；逐仓强平写入前按独立规则再核一遍时刻', () => {
    // 这个回调的第一个花括号是参数的类型字面量，不能用 handlerBody：按前后两个声明切
    const settleAt = ctx.indexOf('const settleIsolatedLiquidations = useCallback');
    const settle = ctx.slice(settleAt, ctx.indexOf('const candleLiqLastEndRef', settleAt));
    expect(settleAt).toBeGreaterThan(-1);
    expect(settle).toContain('explicitRiskRebaseFor(timeline, sym, pos)?.rebaseAt ?? positionRiskSince(pos, direction)');
    expect(settle).toContain('replayEventIsAfterOrigin(closeTime, origin, direction)');
    expect(settle).toContain('for (const { symbol: sym, position: pos, exitPrice, closeTime } of admissible) {');
    const onCandle = handlerBody(ctx, 'liquidateIsolatedOnCandle');
    expect(onCandle).toContain('explicitRiskRebaseFor(timeline, symbol, pos)');
    expect(ctx).toContain('explicitRiskRebaseFor(timeline, sym, pos) ?? undefined,');
    // 时钟落后不再是重置风险起点的理由
    const guards = read('lib/liquidationGuards.ts');
    expect(guards).not.toContain('clockBehind');
    expect(guards).not.toContain('since - candleEnd > discontinuityMs');
  });

  it('【评审发现】倒放帧与限价撮合同样只认当前标的 / 周期的数据集；换了数据集或时间线的第一帧只播种', () => {
    const reverseAt = index.indexOf('const runReverseChartTick = (');
    const reverse = index.slice(reverseAt, index.indexOf('// ① 本帧被完整揭示的蜡烛', reverseAt));
    expect(reverse).toContain('if (!context || context.symbol !== sym || intervalToMs(context.interval) !== iMs) return;');
    expect(reverse).toContain('const reverseKey = `${sym}|${iMs}|${context.generation}|${getTimelineId(sym)}`;');
    expect(reverse).toContain('lastReverseSimTimeRef.current = null;');
    const limitAt = index.indexOf('// ===== MATCHING ENGINE for active symbol =====');
    const limit = index.slice(limitAt, index.indexOf('const newKlines = plan.match;', limitAt));
    expect(limit).toContain("if (!matchContext || matchContext.symbol !== activeSymbol || intervalToMs(matchContext.interval) !== iMs) return;");
    expect(limit).toContain('}|${matchContext.generation}`,');
  });

  it('【评审发现】TWAP 按自己标的的钟走：独立时间轴下没在播放的币整组跳过，切片之前过时序校验', () => {
    const at = index.indexOf('// ===== TWAP ENGINE =====');
    const twap = index.slice(at, index.indexOf('// ===== ISOLATED-MODE HANDLERS =====', at));
    expect(twap).toContain('if (timeMode === "isolated" && coinTimelines[symbol]?.status !== "playing") continue;');
    expect(twap).toContain('const symbolNow = timeMode === "isolated" ? getEffectiveTime(symbol) : effectiveSimTime;');
    expect(twap).toContain('if (!canExecuteReplayOrder(symbol, order, now)) return order;');
    expect(twap).not.toContain('const now = effectiveSimTime;');
  });

  it('【评审发现】独立时间轴的开始 / 跳转：新钟与分叉在同一段同步代码里写进 ref（撮合循环看不到「新时间线 + 旧时钟」的那一帧）', () => {
    const start = handlerBody(index, 'handleStart');
    const forkAt = start.indexOf('forkReplayTimeline(activeSymbol, "start", startTs, timeDirection)');
    const refAt = start.indexOf('coinTimelinesRef.current = { ...coinTimelinesRef.current, [activeSymbol]: started };');
    expect(refAt).toBeGreaterThan(forkAt);
    expect(refAt).toBeLessThan(start.indexOf('setCoinTimelines('));
    const jump = handlerBody(index, 'handleJumpToSignal');
    const jumpRefAt = jump.indexOf('coinTimelinesRef.current = { ...coinTimelinesRef.current, [normalized]: jumped };');
    expect(jumpRefAt).toBeGreaterThan(jump.indexOf('forkReplayTimeline(normalized, "jump", startTs, timeDirection)'));
    expect(jumpRefAt).toBeLessThan(jump.indexOf('setCoinTimelines('));
    // 兜底：水位之前的时钟持续 1 秒以上就重新播种，循环不会永久停摆
    expect(index).toContain('else if (now - forwardRegressedSinceRef.current > FORWARD_REGRESSION_RESEED_MS) {');
    expect(index).toContain('const FORWARD_REGRESSION_RESEED_MS = 1_000;');
  });

  it('【评审发现】被取代的取数静默放弃；信号跳转先验后提交；数据集对不上时限次自动重取', () => {
    const start = handlerBody(index, 'handleStart');
    expect(start.indexOf('if (data === SUPERSEDED_INIT_LOAD) return;')).toBeGreaterThan(-1);
    expect(start.indexOf('if (data === SUPERSEDED_INIT_LOAD) return;')).toBeLessThan(start.indexOf('toast.error("数据获取失败"'));
    const jump = handlerBody(index, 'handleJumpToSignal');
    expect(jump).toContain('accept: (candles: KlineData[]) => hasKlineCoveringSignalTime(candles, timeMs, iMs),');
    expect(jump.match(/if \(data === SUPERSEDED_INIT_LOAD\) return superseded;/g)).toHaveLength(2);
    expect(jump.indexOf('if (data === SUPERSEDED_INIT_LOAD) return superseded;')).toBeLessThan(jump.indexOf('diagnoseSignalJump('));
    expect(index).toContain('if (datasetRehomeRef.current.attempts >= DATASET_REHOME_MAX_ATTEMPTS) return;');
    expect(index).toContain('const DATASET_REHOME_MAX_ATTEMPTS = 2;');
    const hook = read('hooks/useBinanceData.ts');
    expect(hook).toContain('if (opts?.accept && !opts.accept(merged)) return merged;');
    expect(hook.indexOf('if (opts?.accept && !opts.accept(merged)) return merged;'))
      .toBeLessThan(hook.indexOf('dataContextRef.current = { symbol, interval, generation: requestId };'));
  });

  it('【评审发现】保护单的挂单时刻不取界面时钟：随单的取成交时刻，手动设置的取撮合时钟', () => {
    const attach = handlerBody(ctx, 'applyAttachedTpSl');
    expect(attach).toContain('const fillTimes = [position.openTime, ...(position.fills ?? []).map(fill => fill.openTime)]');
    expect(attach).not.toContain('const now = getEffectiveTime(symbol);');
    expect(ctx).toContain('const now = getLiveSimTime(symbol);\n    const newOrders = buildTpSlOrders({');
  });

  it('指南写明这套规则', () => {
    const guide = read('pages/GuidePage.tsx');
    expect(guide).toContain('<strong>暂停、恢复与行情补载互不串时间。</strong>');
    expect(guide).toContain('<strong>委托只会被它生效之后的行情触发</strong>');
    expect(guide).toContain('每一笔强平写入之前还要再核一遍「强平时刻不早于仓位形成时刻」');
    expect(guide).toContain('恢复后从暂停那一刻正在走的那根 K 线接着走完，不会跳过它');
    expect(guide).toContain('<strong>数据也只认自己的</strong>');
    expect(guide).toContain('它的 TWAP 也不会被图上那只币的时钟带着切片或提前结束');
  });
});

