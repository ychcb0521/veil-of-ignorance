/**
 * Deep dig 描述统计的时间序列曲线：每个事件把公式里每个变量，从进场前一段到进场后一段逐点取值；画图时按组求平均。
 * 【用户要求】2026-10-17「描述统计那里能够画出各组的时间序列曲线（组内数据在时间序列上的平均），比如 V 的时间序列曲线，
 * 并且这个变量可以让我来选择（默认为当前的核心变量）」。
 *
 * 口径：
 *   - 点的时刻 t = 进场 + τ，取 t 之前最后一根已收盘 K 线上的值（τ = 0 就是特征值本身）；
 *   - K 线往前多取整段曲线前段：曲线上每一点都有与特征值本身相同长度的观察窗（featureWindowMs），进场前后整段都有数据；
 *   - 进场后的部分只是描述（看进场后怎么走），特征值、分组、推断统计都只用进场前的数据。
 */
import { intervalMs } from '@/lib/deepRsa/marketData';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { lastValue } from '@/lib/deepDig/formula';
import { avgHoursOf, evaluateOnBars, featureWindowMs, intervalOf, RESULT_VAR, type CompiledFeature, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { DEEP_DIG_GROUPS, describeGroup, viewForVariable, type DeepDigData, type DeepDigRow, type DeepDigRowGroup } from '@/lib/deepDig/analysis';

const HOUR = 3_600_000;

/** 相对进场的时刻 → 「进场」「−6h」「+1.5h」。 */
export function formatSeriesOffset(ms: number): string {
  const h = ms / HOUR;
  if (h === 0) return '进场';
  const t = Number.isInteger(h) ? String(Math.abs(h)) : Math.abs(h).toFixed(1);
  return `${h < 0 ? '−' : '+'}${t}h`;
}

export interface DeepDigSeries {
  /** 对应哪一次描述统计（DeepDigData.finishedAt）。 */
  finishedAt: number;
  /** 各点相对进场的时间（毫秒）：负 = 进场前。 */
  offsets: number[];
  /** 变量（与 formulaVariables 同序）；最后一句没起名时最后一个是「结果」。 */
  names: string[];
  result: string;
  /** 每个事件一条：names.length × offsets.length，按变量依次排；缺失为 NaN。 */
  byEvent: Record<string, Float32Array>;
}

/**
 * 曲线范围与点距：进场前后各「平均时长 avgh」（至少 12 根），点距 ≈ 范围 ÷ 24（至少 1 根，取整根），约 49 个点。
 * 5m 默认 avgh = 24 → −24h … +24h 每小时一点。
 * 【用户要求】2026-10-18「平均时长要与这个时间序列图的时间段保持一致」：之前固定 24 小时，现在跟着平均时长走
 * （平均时长变了定义就变了，重跑描述统计后曲线按新范围算）。
 */
export function seriesRangeOf(def: Pick<DeepDigFeatureDef, 'interval' | 'avgHours'>): { beforeMs: number; afterMs: number; stepMs: number } {
  const barMs = intervalMs(intervalOf(def));
  const want = Math.max(avgHoursOf(def) * HOUR, 12 * barMs);
  const stepMs = barMs * Math.max(1, Math.round(want / 24 / barMs));
  // 范围取点距的整数倍：进场（τ = 0）一定是其中一点
  const span = stepMs * Math.max(1, Math.round(want / stepMs));
  return { beforeMs: span, afterMs: span, stepMs };
}

export function seriesOffsets(range: { beforeMs: number; afterMs: number; stepMs: number }): number[] {
  const out: number[] = [];
  for (let t = -range.beforeMs; t <= range.afterMs + 1e-6; t += range.stepMs) out.push(t);
  return out;
}

/**
 * 一个事件的曲线：在 [进场 − 观察窗 − 曲线前段, 进场 + 曲线后段] 的已收盘 K 线上逐根算公式，再按点取值。
 * 公式写错、K 线太少 → null。
 */
export function computeEventSeries(
  bars: readonly ResearchBar[],
  anchorMs: number,
  compiled: CompiledFeature,
  def: Pick<DeepDigFeatureDef, 'interval' | 'halfLifeHours' | 'avgHours'> & { id?: string },
  names: readonly string[],
  offsets: readonly number[],
): Float32Array | null {
  const barMs = intervalMs(intervalOf(def));
  const range = seriesRangeOf(def);
  const start = anchorMs - featureWindowMs(def) - range.beforeMs;
  const end = anchorMs + range.afterMs;
  const seen = new Set<number>();
  const sel = bars
    .filter(b => b.openTime >= start && b.openTime + barMs <= end && b.openTime % barMs === 0 && !seen.has(b.openTime) && seen.add(b.openTime))
    .sort((a, b) => a.openTime - b.openTime);
  if (sel.length < 2) return null;
  let out: ReturnType<typeof evaluateOnBars>;
  try {
    out = evaluateOnBars(sel, compiled, def);
  } catch {
    return null;
  }
  const closes = sel.map(b => b.openTime + barMs);
  const values = names.map(n => (n === RESULT_VAR && !out.vars.has(n) ? out.last : out.vars.get(n) ?? Number.NaN));
  const result = new Float32Array(names.length * offsets.length).fill(Number.NaN);
  offsets.forEach((tau, k) => {
    const t = anchorMs + tau;
    // t 之前最后一根已收盘的；太久以前的（中间缺 K 线）不算
    let lo = 0;
    let hi = closes.length - 1;
    let j = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (closes[mid] <= t) { j = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (j < 0 || t - closes[j] >= Math.max(barMs, range.stepMs)) return;
    values.forEach((v, n) => {
      const x = typeof v === 'number' ? v : v[j];
      result[n * offsets.length + k] = Number.isFinite(x) ? x : Number.NaN;
    });
  });
  return result;
}

export interface GroupCurve {
  group: DeepDigRowGroup;
  /** 有曲线的事件数。 */
  n: number;
  /** 每个点：组内平均与标准误（原值）；这个点没有数据为 null。 */
  mean: (number | null)[];
  se: (number | null)[];
  count: number[];
}

/** 按组求每个点的平均（rows = 去掉删除行之后的数据）。 */
export function groupCurves(rows: readonly DeepDigRow[], series: DeepDigSeries, name: string): GroupCurve[] {
  const vi = series.names.indexOf(name);
  const P = series.offsets.length;
  return DEEP_DIG_GROUPS.map(group => {
    const sum = new Float64Array(P);
    const sq = new Float64Array(P);
    const count = new Array<number>(P).fill(0);
    let n = 0;
    if (vi >= 0) {
      for (const r of rows) {
        if (r.group !== group || r.v == null) continue;
        const s = series.byEvent[r.id];
        if (!s) continue;
        n++;
        for (let k = 0; k < P; k++) {
          const x = s[vi * P + k];
          if (!Number.isFinite(x)) continue;
          sum[k] += x; sq[k] += x * x; count[k]++;
        }
      }
    }
    const mean = count.map((c, k) => (c > 0 ? sum[k] / c : null));
    const se = count.map((c, k) => {
      if (c < 2) return null;
      const m = sum[k] / c;
      const variance = Math.max(0, (sq[k] - c * m * m) / (c - 1));
      return Math.sqrt(variance / c);
    });
    return { group, n, mean, se, count };
  });
}

/** τ = 0 那一点（应等于特征值本身，单元测试核对）。 */
export const valueAt = (series: DeepDigSeries, eventId: string, name: string, offsetMs = 0): number | null => {
  const s = series.byEvent[eventId];
  const k = series.offsets.indexOf(offsetMs);
  const vi = series.names.indexOf(name);
  if (!s || k < 0 || vi < 0) return null;
  return lastValue(s[vi * series.offsets.length + k]);
};

/**
 * 【用户要求】2026-10-18「手动滑动进场这条竖线，选取不同时刻的对应数据」：分组表、点阵图、逐场数据按选中时刻的值统计。
 * offsetMs = 0（进场）→ 与原来一样用特征值本身；其他时刻 → 每行换成它的曲线在那一点的值
 * （那一刻之前最后一根已收盘 K 线上的值；这一行没有曲线、或那一点缺 K 线 → 缺失）。name 为 null = 公式最后一句。
 */
export function viewAtOffset(data: DeepDigData, series: DeepDigSeries | null, name: string | null, offsetMs: number): DeepDigData {
  if (offsetMs === 0 || !series || !series.offsets.includes(offsetMs)) return viewForVariable(data, name);
  const varName = name != null && series.names.includes(name) ? name : series.result;
  const rows = data.rows.map(r => ({ ...r, v: valueAt(series, r.id, varName, offsetMs) }));
  const finiteV = (v: number | null): v is number => v != null && Number.isFinite(v);
  return { ...data, rows, groups: DEEP_DIG_GROUPS.map(g => describeGroup(g, rows.filter(r => r.group === g).map(r => r.v).filter(finiteV))) };
}

/** 推断输入：所有公式变量都移到同一选中时点，不能只替换默认因变量v。
 * 缺曲线/缺变量留空；非零时点的曲线尚未加载时返回null，禁止偷偷回用进场值。
 */
export function dataAtOffset(data: DeepDigData, series: DeepDigSeries | null, offsetMs: number): DeepDigData | null {
  if (offsetMs === 0) return data;
  if (!series || series.finishedAt !== data.finishedAt || !series.offsets.includes(offsetMs)) return null;
  const rows = data.rows.map(r => ({
    ...r, v: valueAt(series, r.id, series.result, offsetMs),
    vars: Object.fromEntries([...new Set([...Object.keys(r.vars ?? {}), ...series.names])].map(name => [name, valueAt(series, r.id, name, offsetMs)])),
  }));
  return { ...data, sampleOffsetMs: offsetMs, rows, groups: DEEP_DIG_GROUPS.map(g => describeGroup(g, rows.filter(r => r.group === g).map(r => r.v).filter((v): v is number => v != null && Number.isFinite(v)))) };
}
