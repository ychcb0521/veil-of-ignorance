/**
 * 播放窗口的边界判定 —— 决定「何时预取下一批 K 线」与「何时判定已喂完」。
 *
 * 抽成纯函数是有来由的：正放分支的这段逻辑此前完全缺失，而倒放有。
 * 缺口能长期存在，是因为它藏在 RAF 循环里、既没有测试也无法单独观察——
 * 症状只表现为「时钟在跑、蜡烛不动」，看起来像渲染卡顿而非数据耗尽。
 */

/**
 * 是否该预取更晚的 K 线（正放）。
 *
 * @param simTime        当前模拟时刻
 * @param lastLoadedTime 已加载最后一根 K 线的开盘时刻
 * @param intervalMs     周期毫秒数
 * @param preloadBars    还剩多少根就开始预取
 */
export function needsForwardPreload(
  simTime: number,
  lastLoadedTime: number,
  intervalMs: number,
  preloadBars: number,
): boolean {
  if (!Number.isFinite(simTime) || !Number.isFinite(lastLoadedTime)) return false;
  if (!(intervalMs > 0)) return false;
  return simTime >= lastLoadedTime - preloadBars * intervalMs;
}

/**
 * 是否已把已加载数据喂完（正放）。留一根的宽限，让最后一根走完它的成形过程
 * 再判定，否则最后一根会在刚露头时就被判耗尽。
 */
export function isForwardExhausted(
  simTime: number,
  lastLoadedTime: number,
  intervalMs: number,
): boolean {
  if (!Number.isFinite(simTime) || !Number.isFinite(lastLoadedTime)) return false;
  if (!(intervalMs > 0)) return false;
  return simTime > lastLoadedTime + intervalMs;
}

/** 是否该预取更早的 K 线（倒放）——正放的镜像。 */
export function needsReversePreload(
  simTime: number,
  firstLoadedTime: number,
  intervalMs: number,
  preloadBars: number,
): boolean {
  if (!Number.isFinite(simTime) || !Number.isFinite(firstLoadedTime)) return false;
  if (!(intervalMs > 0)) return false;
  return simTime <= firstLoadedTime + preloadBars * intervalMs;
}

/**
 * 以「每真实秒消耗几根 K 线」度量播放速度——用来判断预取余量够不够。
 * 倍速 × 1000ms ÷ 周期毫秒数。例：3m 周期 180 倍速 = 1 根/秒。
 */
export function barsPerRealSecond(speed: number, intervalMs: number): number {
  if (!(intervalMs > 0) || !Number.isFinite(speed)) return 0;
  return (speed * 1000) / intervalMs;
}
