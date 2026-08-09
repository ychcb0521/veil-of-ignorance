/**
 * 倒叙播放（镜像视图）——纯计算层。
 *
 * 倒放不是把蜡烛从右沿抽走，而是把「反市场」当作一个正常盘面来看：
 * 真实时间上更晚的 K 线是主观历史铺在图上，更早的 K 线逐帧从右侧出现，
 * 横轴时间从左到右递减。
 *
 * 实现手段是时间反射：以倒放起点 cap（对齐到 K 线开盘的时刻）为镜面，
 *   mirrorTime(t) = 2·cap − t
 * 真实时间越早 → 镜像时间越晚，序列在镜像域严格递增，图表引擎照常工作；
 * 且该映射是对合（自己的逆），坐标轴标签用同一函数即可换回真实时间。
 *
 * 每根蜡烛在主观时间里「从真实收盘走向真实开盘」，因此镜像蜡烛开收互换：
 * 开 = 真实收、收 = 真实开——只有这样相邻蜡烛才连续（前一根的收 ≈ 后一根的开），
 * 阳线阴线随之翻转，这正是反市场的本来面目。
 *
 * 无知之幕在倒放下同样成立，方向相反：主观未来 = 真实更早的数据，绝不显示。
 * cap 之后（真实更晚）的数据也不显示——那是这次倒放会话开始前尚未揭示的部分，
 * 展示它会向正放会话泄露未来。
 */
import type { KlineData } from '@/hooks/useBinanceData';

/** 把时刻对齐到所在 K 线的开盘（Binance 各周期均按 UTC 纪元整除对齐）。 */
export function snapToBarStart(time: number, intervalMs: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(intervalMs) || intervalMs <= 0) return time;
  return Math.floor(time / intervalMs) * intervalMs;
}

/** 时间反射（对合：mirrorTime(cap, mirrorTime(cap, t)) === t）。 */
export function mirrorTime(capTime: number, time: number): number {
  return 2 * capTime - time;
}

/** 完整落定蜡烛的镜像：开收互换，高低与量不变。返回真实价格域、镜像时间域。 */
export function mirrorSettledBar(bar: KlineData, capTime: number): KlineData {
  return {
    time: mirrorTime(capTime, bar.time),
    open: bar.close,
    high: bar.high,
    low: bar.low,
    close: bar.open,
    volume: bar.volume,
  };
}

/**
 * 成形中的镜像蜡烛：主观进度 p = (真实收盘时刻 − simTime) ÷ 周期。
 * 从真实收盘价出发向真实开盘价回走；高低点随进度渐显（与正放同一 1.5x 提前系数）。
 * 其 close 恒等于正放插值公式在同一 simTime 的取值——显示价与撮合价共用一个价格域。
 */
export function reverseFormingBar(
  bar: KlineData,
  simTime: number,
  intervalMs: number,
  capTime: number,
): KlineData {
  const progress = Math.max(0, Math.min(1, (bar.time + intervalMs - simTime) / intervalMs));
  const open = bar.close;
  const close = bar.close + (bar.open - bar.close) * progress;
  const hlReveal = Math.min(1, progress * 1.5);
  const rawHigh = bar.close + (bar.high - bar.close) * hlReveal;
  const rawLow = bar.close + (bar.low - bar.close) * hlReveal;
  return {
    time: mirrorTime(capTime, bar.time),
    open,
    high: Math.max(open, close, rawHigh),
    low: Math.min(open, close, rawLow),
    close,
    volume: bar.volume * progress,
  };
}

/**
 * 倒放视图的可见数据：镜像时间递增的 KlineData 数组。
 *
 * 可见性（真实域）：只收「真实收盘时刻 ≤ cap 且 > simTime」的蜡烛——
 *   - 收盘晚于 cap 的：本次倒放开始时尚未完整揭示，永不显示（防泄露）；
 *   - 收盘早于等于 simTime 的：主观未来，被幕遮蔽；
 *   - 时钟正在穿越的那根（开 < simTime < 收）按主观进度部分成形。
 */
export function getReverseVisibleData(
  allData: KlineData[],
  simTime: number,
  capTime: number,
  intervalMs: number,
): KlineData[] {
  if (!Number.isFinite(capTime) || !Number.isFinite(simTime) || intervalMs <= 0) return [];

  const out: KlineData[] = [];
  // allData 按真实时间升序；倒序遍历得到镜像时间升序。
  for (let i = allData.length - 1; i >= 0; i--) {
    const bar = allData[i];
    const barEnd = bar.time + intervalMs;
    if (barEnd > capTime) continue;
    if (barEnd <= simTime) break;
    out.push(
      simTime > bar.time
        ? reverseFormingBar(bar, simTime, intervalMs, capTime)
        : mirrorSettledBar(bar, capTime),
    );
  }
  return out;
}
