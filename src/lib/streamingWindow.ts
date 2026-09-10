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
 * 倍速 × 1000ms ÷ 周期毫秒数。例：3m 周期 180 倍速 = 1 根/秒；
 * 最快的 1m 周期 3600 倍速 = 60 根/秒（旧的最快组合 900x/1m 是 15 根/秒）。
 */
export function barsPerRealSecond(speed: number, intervalMs: number): number {
  if (!(intervalMs > 0) || !Number.isFinite(speed)) return 0;
  return (speed * 1000) / intervalMs;
}

/** 一次流式补给的批量大小（Binance klines limit）。 */
export const PREFETCH_BATCH_BARS = 1000;
/** 预取重试节流：一次没补到数据，最快 2 秒后再试。这 2 秒里蜡烛照吃，要算进余量预算。 */
export const PREFETCH_DEBOUNCE_MS = 2000;
/**
 * 单次取数的「挂死断路器」超时。它不是预算基准，只保证在途锁一定会释放：
 * 没有超时的 fetch 是流式供给最阴的失效方式——重试阶梯只对「有响应的错误码」
 * 生效，卡住的连接永远走不到 finally，锁就一直锁着，此时预取阈值留多少都补不上。
 * 取值必须远大于一次正常取数（1000 根 ≈130KB），否则慢网会被误杀；
 * 但也不能太大：挂死期间照吃蜡烛，10 秒 × 最快的 60 根/秒 = 600 根，仍小于一批 1000 根。
 */
export const FETCH_HANG_TIMEOUT_MS = 10_000;
/** 一次正常取数的真实耗时上限（含传输）。预算按它算，而不是按断路器算。 */
export const TYPICAL_FETCH_SECONDS = 1.5;
/**
 * 预取余量要覆盖「一次失败 + 节流等待 + 一次成功」= 1.5 + 2 + 1.5 = 5 秒。
 * 比这更糟的网络（连挂死断路器都撞上）不由余量兜底，而是走「数据到头，自动暂停」
 * ——那是一个有闩、只提示一次、用户看得见的结局，不是时钟空跑。
 */
export const PREFETCH_BUDGET_SECONDS =
  2 * TYPICAL_FETCH_SECONDS + PREFETCH_DEBOUNCE_MS / 1000;

/**
 * 正放要留出的真实秒数余量。16 秒是上面 5 秒预算的 3.2 倍。
 *
 * 为什么按「秒」而不是按「根」：根数是速度盲的。240 根在 1x/1m 下是 4 小时，
 * 在 3600x/1m 下只有 4 秒——而真正不能耗尽的是「发一次请求所需的真实时间」。
 * 巧的是今天的 240 / 120 正好就是「900x/1m（旧的最快组合，15 根/秒）下的 16 秒 / 8 秒」，
 * 所以这条按秒的规则在所有既有倍速×周期上逐根复现今天的数值，一根不差。
 */
export const FORWARD_RUNWAY_SECONDS = 16;
/**
 * 倒放留一半（沿用今天 900x/1m 的既有余量：120 根正是 8 秒）。8 秒仍覆盖 5 秒预算，
 * 但富余只有 1.6 倍——倒放缓冲本就更浅，且到底只是暂停、不丢撮合；
 * 抬高它会改掉既有倍速下的阈值，故保持不动。
 */
export const REVERSE_RUNWAY_SECONDS = 8;

/** 低速时按秒算出的余量小得离谱（1x/1d 只需 0.0002 根），保留原有下限。 */
export const MIN_FORWARD_PRELOAD_BARS = 240;
export const MIN_REVERSE_PRELOAD_BARS = 120;

function preloadBars(
  speed: number,
  intervalMs: number,
  runwaySeconds: number,
  minBars: number,
): number {
  const bps = barsPerRealSecond(speed, intervalMs);
  if (!(bps > 0)) return minBars; // 坏输入退回旧常量，绝不放大
  return Math.max(minBars, Math.ceil(bps * runwaySeconds));
}

/**
 * 正放的预取阈值（还剩多少根就去补）。
 *
 * 不设上限是刻意的：阈值大小与「补完仍在阈值内 → 每帧重触发」无关。
 * 触发瞬间剩余 = T，补完一批后剩余 = T − 途中消耗 + 1000，T 两边抵消，
 * 只要「一次取数吃掉的根数 < 一批的根数」条件就必然转假；最快的 3600x/1m
 * 也只有 60 根/秒 × 断路器上限 10 秒 = 600 根 < 一批 1000 根。
 */
export function forwardPreloadBars(speed: number, intervalMs: number): number {
  return preloadBars(speed, intervalMs, FORWARD_RUNWAY_SECONDS, MIN_FORWARD_PRELOAD_BARS);
}

/** 倒放的预取阈值——正放的镜像，余量减半。 */
export function reversePreloadBars(speed: number, intervalMs: number): number {
  return preloadBars(speed, intervalMs, REVERSE_RUNWAY_SECONDS, MIN_REVERSE_PRELOAD_BARS);
}
