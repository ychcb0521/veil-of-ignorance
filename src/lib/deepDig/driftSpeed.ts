/**
 * Deep dig · 特征值「多空博弈均衡点漂移速度 V」（动态谢林点指标的 Vₜ，进场前最后一根已收盘 5m K 线）。
 *
 * 【用户要求】2026-10-16：「deep RSA 统一改成 deep dig……按照特征值来做成目录（目前我只关注多空博弈均衡点漂移速度这一个特征值），
 * 每个特征值又可以分成 3 个模块：描述统计、推断统计、规律提取」。
 * 这里只负责算：事件与 24h 客观行情取自 Deep RSA 同一条流水线（collectRunEvents），统计用 analyzeFeatureDeepDive（DRIFT_STUDY），
 * 另外补上界面要的明细行与分组描述；「规律提取」的默认文字也从这里按结果生成。
 */
import { CODE_VERSION } from '@/lib/deepRsa/campaignLabels';
import {
  analyzeFeatureDeepDive, DEEP_DIVE_ALPHA, DEEP_DIVE_PRIMARY_H, DRIFT_STUDY,
  type AssociationRow, type ConfirmationRow, type DeepDiveOptions, type DeepDiveTargetKey, type LabelRow, type QuintileBin, type TTestRow,
} from '@/lib/deepRsa/deepDive';
import { collectRunEvents, type RunEvent, type RunOptions } from '@/lib/deepRsa/pipeline';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';

export const DRIFT_FEATURE_KEY = 'dsp_v';
/** V 按基点 / 根显示（× 10⁴，只换单位）。 */
export const DRIFT_SCALE = 1e4;
export const DRIFT_UNIT = '基点/根';

/** 目录里的特征值：目前只有一个。slug 用在网址上。 */
export const DEEP_DIG_FEATURES = [
  {
    slug: 'drift-speed',
    name: '多空博弈均衡点漂移速度 V',
    short: '漂移速度 V',
    definition: '进场前最后一根 5m K 线上，动态谢林点（多空博弈的均衡价）每根往上（+）或往下（−）移动多少：净资金力量 × 买方优势权重 × 涨跌幅，按半衰期 6 小时指数平滑。',
    formula: 'Vₜ = ρ·Vₜ₋₁ + (1 − ρ)·Fₜ·Gₜ·Rₜ；Fₜ = ln(1 + |Bₜ − Sₜ| ÷ EMA(Bₜ + Sₜ))，Gₜ = 1 + max(Aₜ, 0)，Rₜ = ln(Cₜ ÷ Cₜ₋₁)；B / S = 主动买 / 卖成交金额',
  },
] as const;
export type DeepDigFeatureSlug = (typeof DEEP_DIG_FEATURES)[number]['slug'];

export type DriftGroup = 'positive' | 'control' | 'other' | 'background';
export const DRIFT_GROUPS: readonly DriftGroup[] = ['positive', 'control', 'other', 'background'];
export const DRIFT_GROUP_LABEL: Record<DriftGroup, string> = { positive: '实验组', control: '对照组', other: '其他战役', background: '随机时点' };
export const DRIFT_GROUP_NOTE: Record<DriftGroup, string> = {
  positive: '正样本：理论 b 或盈亏比 > 3，另一项不低于 0.5',
  control: '理论 b 或盈亏比 < 0.5，另一项不高于 3',
  other: '中间、冲突、待判定的战役：只作描述，不进两组比较',
  background: '同一批币、同一段时间里随机抽的时点：市场平时的 V',
};

export interface DriftRow {
  id: string;
  symbol: string;
  anchorMs: number;
  group: DriftGroup;
  /** 这一簇里的战役 id（同币 48h 内的多场合为一簇）；随机时点为空。 */
  memberIds: string[];
  /** V 原值（对数 / 根）；成交额覆盖不足时为 null。 */
  v: number | null;
  endRet: number | null;
  maxUp: number | null;
  maxDown: number | null;
  period: 'discovery' | 'confirmation' | 'embargo';
}

export interface DriftGroupStat {
  group: DriftGroup;
  n: number;
  mean: number | null;
  sd: number | null;
  median: number | null;
  q25: number | null;
  q75: number | null;
  min: number | null;
  max: number | null;
  sharePositive: number | null;
}

export interface DriftSpeedResult {
  feature: typeof DRIFT_FEATURE_KEY;
  codeVersion: string;
  startedAt: number;
  finishedAt: number;
  seed: number;
  permutations: number;
  bootstrap: number;
  halfLifeHours: number;
  coverage: {
    campaigns: number;
    clusters: number;
    failed: number;
    lowCoverage: number;
    outcomeMissing: number;
    featureMissing: number;
    discovery: number;
    confirmation: number;
    embargoed: number;
  };
  rows: DriftRow[];
  groups: DriftGroupStat[];
  tTest: TTestRow | null;
  label: LabelRow | null;
  association: AssociationRow[];
  confirmation: ConfirmationRow[];
  quintiles: { cuts: number[]; bins: QuintileBin[] };
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function groupOf(e: Pick<RunEvent, 'kind' | 'label'>): DriftGroup {
  if (e.kind === 'background') return 'background';
  return e.label === 'positive' ? 'positive' : e.label === 'control' ? 'control' : 'other';
}

export function describeGroup(group: DriftGroup, values: readonly number[]): DriftGroupStat {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = n ? sorted.reduce((s, v) => s + v, 0) / n : null;
  const sd = mean != null && n > 1 ? Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
  return {
    group, n, mean, sd, median: quantile(sorted, 0.5), q25: quantile(sorted, 0.25), q75: quantile(sorted, 0.75),
    min: n ? sorted[0] : null, max: n ? sorted[n - 1] : null, sharePositive: n ? sorted.filter(v => v > 0).length / n : null,
  };
}

/** 纯计算：给定事件，产出整套结果（不拉数据，便于测试）。 */
export function analyzeDriftSpeed(
  events: readonly RunEvent[],
  options: Omit<DeepDiveOptions, 'study'> = {},
): Omit<DriftSpeedResult, 'codeVersion' | 'startedAt' | 'finishedAt' | 'coverage'> & { split: { discovery: number; confirmation: number; embargoed: number } } {
  const { split, ...a } = analyzeFeatureDeepDive(events, { ...options, study: DRIFT_STUDY });
  const periodOf = new Map<string, DriftRow['period']>();
  [...split.train, ...split.val].forEach(e => periodOf.set(e.id, 'discovery'));
  split.test.forEach(e => periodOf.set(e.id, 'confirmation'));
  split.embargoed.forEach(e => periodOf.set(e.id, 'embargo'));
  const rows: DriftRow[] = events.map(e => {
    const v = e.featuresByH[DEEP_DIVE_PRIMARY_H]?.[DRIFT_FEATURE_KEY];
    return {
      id: e.id, symbol: e.symbol, anchorMs: e.anchorMs, group: groupOf(e), memberIds: e.memberIds ?? [],
      v: finite(v) ? v : null, endRet: e.endRet, maxUp: e.maxUp, maxDown: e.maxDown, period: periodOf.get(e.id) ?? 'discovery',
    };
  });
  const groups = DRIFT_GROUPS.map(g => describeGroup(g, rows.filter(r => r.group === g).map(r => r.v).filter(finite)));
  return {
    feature: DRIFT_FEATURE_KEY, seed: a.seed, permutations: a.permutations, bootstrap: a.bootstrap, halfLifeHours: a.primaryH,
    rows, groups,
    tTest: a.tTests?.[0] ?? null,
    label: a.labels[0] ?? null,
    association: a.association,
    confirmation: a.confirmation,
    quintiles: a.quintiles[0] ? { cuts: a.quintiles[0].cuts, bins: a.quintiles[0].bins } : { cuts: [], bins: [] },
    split: { discovery: split.train.length + split.val.length, confirmation: split.test.length, embargoed: split.embargoed.length },
  };
}

/** 一键：取数（与 Deep RSA 同一批事件：去重后的战役簇 + 随机时点）→ 分析。 */
export async function runDriftSpeed(
  report: CampaignGroupReport,
  options: Omit<DeepDiveOptions, 'study'> & Pick<RunOptions, 'fetchFn' | 'signal' | 'onProgress' | 'concurrency' | 'backgroundCap'> = {},
): Promise<DriftSpeedResult> {
  const startedAt = Date.now();
  const collected = await collectRunEvents(report, options);
  options.onProgress?.({ stage: 'rsa', done: 0, total: 1 });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  const { split, ...analysis } = analyzeDriftSpeed(collected.events, options);
  options.onProgress?.({ stage: 'done', done: 1, total: 1 });
  return {
    codeVersion: CODE_VERSION,
    startedAt,
    finishedAt: Date.now(),
    ...analysis,
    coverage: {
      campaigns: collected.campaigns,
      clusters: collected.clusters,
      failed: collected.failed.length,
      lowCoverage: collected.lowCoverage,
      outcomeMissing: collected.outcomeMissing,
      featureMissing: analysis.rows.filter(r => r.v == null).length,
      ...split,
    },
  };
}

// ===================== 规律提取：按结果生成的默认文字 =====================

export const bp = (v: number | null | undefined, d = 2) => (finite(v) ? (v * DRIFT_SCALE).toFixed(d) : '—');
export const pText = (p: number | null | undefined) => (!finite(p) ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3));
/** 「p = 0.012」或「p < 0.001」。 */
const pEq = (p: number | null | undefined) => (finite(p) && p < 0.001 ? 'p < 0.001' : `p = ${pText(p)}`);
const pct = (v: number | null | undefined, d = 0) => (finite(v) ? `${(v * 100).toFixed(d)}%` : '—');
const TARGET_NAME: Record<DeepDiveTargetKey, string> = { endRet: '24h 期末收益', maxUp: '24h 最大涨幅', maxDown: '24h 最大跌幅' };

/**
 * 「规律提取」的默认内容：一行一条，全部来自这次运行的统计结果；用户可以手动改。
 * 措辞按结果走：显著与否、方向、是否只是波动，都由数字决定，不预设结论。
 */
export function driftRules(result: DriftSpeedResult): string[] {
  const g = Object.fromEntries(result.groups.map(s => [s.group, s])) as Record<DriftGroup, DriftGroupStat>;
  const pos = g.positive; const ctl = g.control;
  const lines: string[] = [];
  if (!pos?.n || !ctl?.n || pos.median == null || ctl.median == null) {
    lines.push('实验组或对照组没有数据，暂时提取不出规律。');
    return lines;
  }
  const lower = pos.median < ctl.median;
  lines.push(`实验组进场时 V 的中位数 ${bp(pos.median)}，对照组 ${bp(ctl.median)}（${DRIFT_UNIT}）：实验组${lower ? '更低' : '更高'}——${lower ? '好的战役更少在均衡价正快速上移时进场' : '好的战役更多在均衡价快速上移时进场'}。`);

  const t = result.tTest;
  if (t && finite(t.p)) {
    lines.push(`t 检验：均值差 ${bp(t.diff)}（95% 区间 ${t.ci95 ? `${bp(t.ci95[0])} ~ ${bp(t.ci95[1])}` : '—'}），${pEq(t.p)}，${t.p < DEEP_DIVE_ALPHA ? '差异显著' : '差异不显著'}（α = 0.05）。`);
  }
  const l = result.label;
  if (l && finite(l.auc)) {
    const sep = l.auc < 0.5 ? 1 - l.auc : l.auc;
    lines.push(`排名比较：AUC ${l.auc.toFixed(2)}，${pEq(l.p)}——随机挑一场实验组和一场对照组，实验组 V ${l.auc < 0.5 ? '更低' : '更高'}的概率约 ${pct(sep)}。`);
  }

  const assoc = (k: DeepDiveTargetKey) => result.association.find(r => r.target === k);
  const end = assoc('endRet'); const up = assoc('maxUp'); const down = assoc('maxDown');
  if (end && finite(end.rho)) {
    const conf = result.confirmation.find(r => r.target === 'endRet');
    lines.push(conf?.verdict === '已验证'
      ? `V 能预测之后 24h 的方向：发现集 ρ = ${end.rho.toFixed(2)}，确认集复现${conf.survivesVolControl ? '，控制波动率后仍成立' : '，但控制波动率后不成立'}。`
      : `V 不能预测之后 24h 的方向：与${TARGET_NAME.endRet} ρ = ${end.rho.toFixed(2)}（Holm ${pEq(end.pHolm)}）${end.pHolm < DEEP_DIVE_ALPHA ? '，确认集没有复现' : ''}。`);
  }
  if (up && down && finite(up.rho) && finite(down.rho) && up.pHolm < DEEP_DIVE_ALPHA && down.pHolm < DEEP_DIVE_ALPHA && Math.sign(up.rho) !== Math.sign(down.rho)) {
    lines.push(`V 与 24h 最大涨幅（ρ = ${up.rho.toFixed(2)}）、最大跌幅（ρ = ${down.rho.toFixed(2)}）同时相关：V 大主要意味着之后波动大，不代表方向。`);
  }

  // 可操作的做法：以对照组中位数为界（对照组按定义约一半在界内），看实验组有多少落在同一侧
  const cut = ctl.median;
  const posVals = result.rows.filter(r => r.group === 'positive' && r.v != null).map(r => r.v!);
  const ctlVals = result.rows.filter(r => r.group === 'control' && r.v != null).map(r => r.v!);
  const side = (v: number) => (lower ? v <= cut : v >= cut);
  const share = (xs: number[]) => (xs.length ? xs.filter(side).length / xs.length : null);
  lines.push(`做法：进场前看 V，${lower ? '≤' : '≥'} ${bp(cut)} ${DRIFT_UNIT}（对照组中位数）时更像实验组——实验组 ${pct(share(posVals))} 满足，对照组 ${pct(share(ctlVals))} 满足。`);
  lines.push(`局限：实验组只有 ${pos.n} 个、对照组 ${ctl.n} 个，结论来自同一批数据；V 是看过三项结果后单独挑出来的，p 值偏乐观，要用之后新产生的战役确认。`);
  return lines;
}
