/**
 * Deep dig 描述统计 · 总体模式识别：不分组，把真实样本（实验组 + 对照组 + 其他）合成一个总体看整体特征；
 * 可写一个条件筛出一部分，与总体、随机时点对照（汇总、分布、时间序列、按读数分档后的 24h 结果）。
 * 【用户要求】2026-10-19「除了做分组描述，我还希望看看将所有数据汇总到一起之后，这些数据整体上会呈现出什么特征，
 * 以及经过一些条件约束或者标准过滤之后，会呈现出什么样的特征和分布（比如时间序列图等等的）」。
 * 纯计算，不联网。
 */
import { FormulaError, evaluateProgram, lastValue, parseFormula, type Program } from '@/lib/deepDig/formula';
import { describeGroup, type DeepDigGroupStat, type DeepDigRow } from '@/lib/deepDig/analysis';

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const HOUR = 3_600_000;

/** 条件里除了公式变量之外还能用的名字。 */
export const PATTERN_EXTRA_VARS: readonly { name: string; label: string; after?: boolean }[] = [
  { name: 'endRet', label: '24h 期末涨跌（小数，0.05 = 5%）', after: true },
  { name: 'maxUp', label: '24h 最大涨幅（小数）', after: true },
  { name: 'maxDown', label: '24h 最大跌幅（小数，负数）', after: true },
  { name: 'vol', label: '观察窗波动率' },
  { name: 'hour', label: '进场时刻（北京时间 0–23 点）' },
  { name: 'weekday', label: '星期几（1 = 周一 … 7 = 周日，北京时间）' },
];
const AFTER = new Set(PATTERN_EXTRA_VARS.filter(v => v.after).map(v => v.name));

export interface RowFilter {
  text: string;
  program: Program;
  inputs: ReadonlySet<string>;
  /** 用到了进场后的结果（endRet / maxUp / maxDown）：只能作事后描述。 */
  usesOutcome: boolean;
}

/** 编译条件；留空 = 不过滤（filter 为 null、没有错误）。names = 公式变量名（含结果名）。 */
export function compileRowFilter(text: string, names: readonly string[]): { filter: RowFilter | null; error: string | null } {
  const src = text.trim();
  if (!src) return { filter: null, error: null };
  try {
    const program = parseFormula(src, new Set([...names, ...PATTERN_EXTRA_VARS.map(v => v.name)]));
    return { filter: { text: src, program, inputs: program.inputs, usesOutcome: [...program.inputs].some(n => AFTER.has(n)) }, error: null };
  } catch (e) {
    return { filter: null, error: e instanceof FormulaError ? e.message.replace(/^第 \d+ 行：/, '') : String(e) };
  }
}

/** 北京时间的小时（0–23）与星期（1 = 周一 … 7 = 周日）。 */
export function beijingClock(ms: number): { hour: number; weekday: number } {
  const d = new Date(ms + 8 * HOUR);
  const day = d.getUTCDay();
  return { hour: d.getUTCHours(), weekday: day === 0 ? 7 : day };
}

/**
 * 一行的条件读数：公式变量（vars）+ 结果名（v）+ 24h 结果、波动率、时刻。缺失记 NaN。
 * row 应是「所选时刻」的数据（dataAtOffset 之后），这样条件与上面看的时刻一致。
 */
export function rowFilterValues(row: DeepDigRow, resultName: string): Record<string, number> {
  const val = (v: number | null | undefined) => (finite(v) ? v : Number.NaN);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(row.vars ?? {})) out[k] = val(v);
  out[resultName] = val(row.v);
  const { hour, weekday } = beijingClock(row.anchorMs);
  Object.assign(out, { endRet: val(row.endRet), maxUp: val(row.maxUp), maxDown: val(row.maxDown), vol: val(row.vol), hour, weekday });
  return out;
}

/** 按条件分：满足 / 不满足 / 条件里用到的读数缺失（两边都不进）。没有条件时全部算满足。 */
export function splitByFilter<T extends DeepDigRow>(
  rows: readonly T[],
  filter: RowFilter | null,
  valuesOf: (row: T) => Record<string, number>,
): { pass: T[]; fail: T[]; missing: T[] } {
  if (!filter) return { pass: [...rows], fail: [], missing: [] };
  const pass: T[] = [];
  const fail: T[] = [];
  const missing: T[] = [];
  for (const r of rows) {
    const values = valuesOf(r);
    if ([...filter.inputs].some(n => !Number.isFinite(values[n]))) { missing.push(r); continue; }
    const v = lastValue(evaluateProgram(filter.program, values));
    (v != null && v !== 0 ? pass : fail).push(r);
  }
  return { pass, fail, missing };
}

export interface PatternStat extends DeepDigGroupStat {
  /** 24h 期末涨跌的平均与上涨占比、24h 最大涨幅的中位数（有结果的行）。 */
  endRetMean: number | null;
  upShare: number | null;
  maxUpMedian: number | null;
}

const median = (xs: readonly number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2;
};

/** 一批行的汇总：读数 v 的描述 + 24h 结果。 */
export function describeRows(rows: readonly DeepDigRow[]): PatternStat {
  const base = describeGroup('other', rows.map(r => r.v).filter(finite));
  const ends = rows.map(r => r.endRet).filter(finite);
  const ups = rows.map(r => r.maxUp).filter(finite);
  return {
    ...base,
    endRetMean: ends.length ? ends.reduce((s, x) => s + x, 0) / ends.length : null,
    upShare: ends.length ? ends.filter(x => x > 0).length / ends.length : null,
    maxUpMedian: median(ups),
  };
}

/**
 * 直方图：几组数共用一套等宽分箱（范围取所有数的 1% ~ 99% 分位，且含 0；两端以外的压在边上的箱里），
 * 每组给的是占比（各箱之和 = 1），样本数不同也能直接比形状。
 */
export function sharedHistogram(sets: readonly (readonly number[])[], bins = 20): { lo: number; hi: number; shares: number[][] } | null {
  const all = sets.flat().filter(Number.isFinite).sort((a, b) => a - b);
  if (all.length < 2) return null;
  const q = (p: number) => all[Math.min(all.length - 1, Math.max(0, Math.round(p * (all.length - 1))))];
  let lo = Math.min(0, q(0.01));
  let hi = Math.max(0, q(0.99));
  if (hi === lo) { lo -= 1; hi += 1; }
  const w = (hi - lo) / bins;
  const shares = sets.map(xs => {
    const c = new Array<number>(bins).fill(0);
    const vs = xs.filter(Number.isFinite);
    for (const v of vs) c[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)))]++;
    return vs.length ? c.map(n => n / vs.length) : c;
  });
  return { lo, hi, shares };
}

export interface PatternBin {
  /** 第几档（1 = 读数最低）。 */
  k: number;
  lo: number;
  hi: number;
  n: number;
  endRetMean: number | null;
  upShare: number | null;
  maxUpMedian: number | null;
}

/** 按读数 v 从低到高等分成 k 档（每档人数尽量相同），看各档 24h 结果。读数缺失的行不进。少于 k 行返回空。 */
export function quantileBins(rows: readonly DeepDigRow[], k = 5): PatternBin[] {
  const sorted = rows.filter(r => finite(r.v)).sort((a, b) => a.v! - b.v!);
  if (sorted.length < k) return [];
  return Array.from({ length: k }, (_, i) => {
    const part = sorted.slice(Math.floor((i * sorted.length) / k), Math.floor(((i + 1) * sorted.length) / k));
    const s = describeRows(part);
    return { k: i + 1, lo: part[0].v!, hi: part[part.length - 1].v!, n: part.length, endRetMean: s.endRetMean, upShare: s.upShare, maxUpMedian: s.maxUpMedian };
  });
}
