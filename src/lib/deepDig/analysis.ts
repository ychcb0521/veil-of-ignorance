/**
 * Deep dig · 一个特征值的整套统计：按定义里的公式在每个事件的观察窗上算出特征值，按定义里的分组标准分组，
 * 再做描述统计与推断统计；「规律提取」的默认文字也从这里按结果生成。
 *
 * 分两步运行（用户要求分开）：描述统计 = 取行情、算特征值、分组（collectDeepDigData）；推断统计 = 在那份数据上做检验（inferDeepDig）。
 * 事件与 24h 客观行情取自原 Deep RSA 同一条流水线（collectRunEvents：同币 48h 去重成簇、每簇一个代表、加随机时点），
 * 统计用 analyzeFeatureDeepDive（t 检验、AUC、相关 + 确认集、五分位）。
 */
import { CODE_VERSION } from '@/lib/deepRsa/campaignLabels';
import {
  analyzeFeatureDeepDive, DEEP_DIVE_ALPHA, DEEP_DIVE_PRIMARY_H, DRIFT_STUDY,
  type AssociationRow, type ConfirmationRow, type DeepDiveOptions, type DeepDiveStudy, type DeepDiveTargetKey, type LabelRow, type QuintileBin, type TTestRow,
} from '@/lib/deepRsa/deepDive';
import { collectRunEvents, type RunEvent, type RunOptions } from '@/lib/deepRsa/pipeline';
import { chronologicalSplit } from '@/lib/deepRsa/splits';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';
import {
  compileFeatureFormula, compileGroups, computeFeatureValue, DRIFT_SPEED_DEF, groupOverride,
  type DeepDigFeatureDef,
} from '@/lib/deepDig/features';

/** 用户公式算出的值在事件特征里的键。 */
export const DEEP_DIG_KEY = 'deep_dig_x';

export type DeepDigRowGroup = 'positive' | 'control' | 'other' | 'background';
export const DEEP_DIG_GROUPS: readonly DeepDigRowGroup[] = ['positive', 'control', 'other', 'background'];
export const DEEP_DIG_GROUP_LABEL: Record<DeepDigRowGroup, string> = { positive: '实验组', control: '对照组', other: '其他战役', background: '随机时点' };

/** 结果里留一份运行时用的定义：之后定义改了，界面能提示「这份结果按旧定义算」。 */
export type DefinitionSnapshot = Pick<DeepDigFeatureDef, 'id' | 'name' | 'short' | 'formula' | 'scale' | 'unit' | 'positive' | 'control'>;

export interface DeepDigRow {
  id: string;
  symbol: string;
  anchorMs: number;
  group: DeepDigRowGroup;
  /** 这一簇里的战役 id（同币 48h 内的多场合为一簇）；随机时点为空。 */
  memberIds: string[];
  /** 特征值原值；算不出来为 null。 */
  v: number | null;
  /** 观察窗波动率（推断统计里「控制波动」用）；旧数据没有。 */
  vol?: number | null;
  endRet: number | null;
  maxUp: number | null;
  maxDown: number | null;
  period: 'discovery' | 'confirmation' | 'embargo';
}

export interface DeepDigGroupStat {
  group: DeepDigRowGroup;
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

/**
 * 描述统计的运行结果：取行情、按公式算特征值、按分组标准分组。
 * 【用户要求】2026-10-16「描述统计和推断统计的运行要分开」：这一步要联网取 K 线（1–3 分钟）；推断统计只用这里的数据。
 */
export interface DeepDigData {
  definition: DefinitionSnapshot;
  codeVersion: string;
  startedAt: number;
  finishedAt: number;
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
  rows: DeepDigRow[];
  groups: DeepDigGroupStat[];
}

/** 推断统计的运行结果：在某一份描述统计数据上做检验（不联网，几秒）。 */
export interface DeepDigInference {
  /** 用的是哪一次描述统计（DeepDigData.finishedAt）：描述统计重跑后提示推断统计也要重跑。 */
  dataFinishedAt: number;
  /** 运行时删掉的行（exclusionKey）：删减改了也提示重跑。 */
  excludedKey?: string;
  startedAt: number;
  finishedAt: number;
  seed: number;
  permutations: number;
  bootstrap: number;
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

export function snapshotOf(def: DeepDigFeatureDef): DefinitionSnapshot {
  const { id, name, short, formula, scale, unit, positive, control } = def;
  return { id, name, short, formula, scale, unit, positive, control };
}

export function groupOf(e: Pick<RunEvent, 'kind' | 'label'>): DeepDigRowGroup {
  if (e.kind === 'background') return 'background';
  return e.label === 'positive' ? 'positive' : e.label === 'control' ? 'control' : 'other';
}

export function describeGroup(group: DeepDigRowGroup, values: readonly number[]): DeepDigGroupStat {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = n ? sorted.reduce((s, v) => s + v, 0) / n : null;
  const sd = mean != null && n > 1 ? Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
  return {
    group, n, mean, sd, median: quantile(sorted, 0.5), q25: quantile(sorted, 0.25), q75: quantile(sorted, 0.75),
    min: n ? sorted[0] : null, max: n ? sorted[n - 1] : null, sharePositive: n ? sorted.filter(v => v > 0).length / n : null,
  };
}

/** 描述统计（纯计算）：事件 → 明细行（含所在时段）与各组描述。特征值在 featuresByH[6][key]。 */
export function describeDeepDig(events: readonly RunEvent[], key = DEEP_DIG_KEY): Pick<DeepDigData, 'rows' | 'groups'> & { split: { discovery: number; confirmation: number; embargoed: number } } {
  const split = chronologicalSplit(events);
  const periodOf = new Map<string, DeepDigRow['period']>();
  [...split.train, ...split.val].forEach(e => periodOf.set(e.id, 'discovery'));
  split.test.forEach(e => periodOf.set(e.id, 'confirmation'));
  split.embargoed.forEach(e => periodOf.set(e.id, 'embargo'));
  const rows: DeepDigRow[] = events.map(e => {
    const f = e.featuresByH[DEEP_DIVE_PRIMARY_H];
    const v = f?.[key];
    const vol = f?.vol_w;
    return {
      id: e.id, symbol: e.symbol, anchorMs: e.anchorMs, group: groupOf(e), memberIds: e.memberIds ?? [],
      v: finite(v) ? v : null, vol: finite(vol) ? vol : null,
      endRet: e.endRet, maxUp: e.maxUp, maxDown: e.maxDown, period: periodOf.get(e.id) ?? 'discovery',
    };
  });
  return {
    rows,
    groups: DEEP_DIG_GROUPS.map(g => describeGroup(g, rows.filter(r => r.group === g).map(r => r.v).filter(finite))),
    split: { discovery: split.train.length + split.val.length, confirmation: split.test.length, embargoed: split.embargoed.length },
  };
}

/** 旧数据没有波动率：推断统计的「控制波动」算不了，要先重跑描述统计。 */
export const dataSupportsInference = (data: Pick<DeepDigData, 'rows'>) => data.rows.every(r => r.vol !== undefined);

/** 明细行还原成统计要的事件（只有主半衰期的特征值与波动率）。 */
function eventsFromRows(rows: readonly DeepDigRow[]): RunEvent[] {
  return rows.map(r => ({
    id: r.id, symbol: r.symbol, anchorMs: r.anchorMs,
    kind: r.group === 'background' ? 'background' : 'event',
    label: r.group === 'positive' || r.group === 'control' ? r.group : null,
    featuresByH: { [DEEP_DIVE_PRIMARY_H]: { [DEEP_DIG_KEY]: r.v, vol_w: r.vol ?? null } },
    outcome: r.maxUp, block: new Date(r.anchorMs).toISOString().slice(0, 7), momentum: null,
    maxUp: r.maxUp, maxDown: r.maxDown, endRet: r.endRet, memberIds: r.memberIds,
  }));
}

function studyOf(def: DefinitionSnapshot): DeepDiveStudy {
  return {
    ...DRIFT_STUDY,
    definitionsTitle: def.name,
    features: [{ key: DEEP_DIG_KEY, name: def.name, definition: '', formula: def.formula, reading: '', weighted: false, display: { scale: def.scale, unit: def.unit } }],
  };
}

/** 推断统计（纯计算，不联网）：t 检验、排名比较、相关 + 确认集、五分位。 */
export function inferDeepDig(
  data: Pick<DeepDigData, 'rows' | 'definition' | 'finishedAt'>,
  options: Omit<DeepDiveOptions, 'study'> & { excludedKey?: string } = {},
): DeepDigInference {
  const startedAt = Date.now();
  const { split: _split, ...a } = analyzeFeatureDeepDive(eventsFromRows(data.rows), { ...options, study: studyOf(data.definition) });
  return {
    dataFinishedAt: data.finishedAt, excludedKey: options.excludedKey ?? '', startedAt, finishedAt: Date.now(),
    seed: a.seed, permutations: a.permutations, bootstrap: a.bootstrap,
    tTest: a.tTests?.[0] ?? null,
    label: a.labels[0] ?? null,
    association: a.association,
    confirmation: a.confirmation,
    quintiles: a.quintiles[0] ? { cuts: a.quintiles[0].cuts, bins: a.quintiles[0].bins } : { cuts: [], bins: [] },
  };
}

/** 描述统计的运行：按定义分组 → 取行情、按公式算特征值 → 描述。定义写错时直接抛出（界面保存时已检查过）。 */
export async function collectDeepDigData(
  report: CampaignGroupReport,
  def: DeepDigFeatureDef,
  options: Pick<RunOptions, 'fetchFn' | 'signal' | 'onProgress' | 'concurrency' | 'backgroundCap'> = {},
): Promise<DeepDigData> {
  const startedAt = Date.now();
  const compiled = compileFeatureFormula(def.formula);
  const groups = compileGroups(def.positive, def.control);
  const collected = await collectRunEvents(report, {
    ...options,
    groupOf: groupOverride(groups),
    extraFeatures: window => ({ [DEEP_DIG_KEY]: computeFeatureValue(window, compiled) }),
  });
  const described = describeDeepDig(collected.events);
  options.onProgress?.({ stage: 'done', done: 1, total: 1 });
  return {
    definition: snapshotOf(def),
    codeVersion: CODE_VERSION,
    startedAt,
    finishedAt: Date.now(),
    coverage: {
      campaigns: collected.campaigns,
      clusters: collected.clusters,
      failed: collected.failed.length,
      lowCoverage: collected.lowCoverage,
      outcomeMissing: collected.outcomeMissing,
      featureMissing: described.rows.filter(r => r.v == null).length,
      ...described.split,
    },
    rows: described.rows,
    groups: described.groups,
  };
}

// ===================== 规律提取：按结果生成的默认文字 =====================

export const fmtValue = (def: Pick<DefinitionSnapshot, 'scale'>, v: number | null | undefined, d = 2) => (finite(v) ? (v * def.scale).toFixed(d) : '—');
export const pText = (p: number | null | undefined) => (!finite(p) ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3));
/** 「p = 0.012」或「p < 0.001」。 */
const pEq = (p: number | null | undefined) => (finite(p) && p < 0.001 ? 'p < 0.001' : `p = ${pText(p)}`);
const pct = (v: number | null | undefined, d = 0) => (finite(v) ? `${(v * 100).toFixed(d)}%` : '—');
const TARGET_NAME: Record<DeepDiveTargetKey, string> = { endRet: '24h 期末收益', maxUp: '24h 最大涨幅', maxDown: '24h 最大跌幅' };

/**
 * 「规律提取」的默认内容：一行一条，全部来自这次运行的统计结果；用户可以手动改。
 * 措辞按结果走：显著与否、方向、是否只是波动，都由数字决定，不预设结论。
 */
export function deepDigRules(data: DeepDigData, inference: DeepDigInference | null): string[] {
  const def = data.definition;
  const result = { ...data, ...(inference ?? { tTest: null, label: null, association: [], confirmation: [] }) };
  const X = def.short || '特征值';
  const val = (v: number | null | undefined) => fmtValue(def, v);
  const g = Object.fromEntries(result.groups.map(s => [s.group, s])) as Record<DeepDigRowGroup, DeepDigGroupStat>;
  const pos = g.positive; const ctl = g.control;
  const lines: string[] = [];
  if (!pos?.n || !ctl?.n || pos.median == null || ctl.median == null) {
    lines.push('实验组或对照组没有数据，暂时提取不出规律。');
    return lines;
  }
  const lower = pos.median < ctl.median;
  lines.push(`实验组进场时 ${X} 的中位数 ${val(pos.median)}，对照组 ${val(ctl.median)}${def.unit ? `（${def.unit}）` : ''}：实验组${lower ? '更低' : '更高'}。`);

  const t = result.tTest;
  if (t && finite(t.p)) {
    lines.push(`t 检验：均值差 ${val(t.diff)}（95% 区间 ${t.ci95 ? `${val(t.ci95[0])} ~ ${val(t.ci95[1])}` : '—'}），${pEq(t.p)}，${t.p < DEEP_DIVE_ALPHA ? '差异显著' : '差异不显著'}（α = 0.05）。`);
  }
  const l = result.label;
  if (l && finite(l.auc)) {
    const sep = l.auc < 0.5 ? 1 - l.auc : l.auc;
    lines.push(`排名比较：AUC ${l.auc.toFixed(2)}，${pEq(l.p)}——随机挑一场实验组和一场对照组，实验组 ${X} ${l.auc < 0.5 ? '更低' : '更高'}的概率约 ${pct(sep)}。`);
  }

  const assoc = (k: DeepDiveTargetKey) => result.association.find(r => r.target === k);
  const end = assoc('endRet'); const up = assoc('maxUp'); const down = assoc('maxDown');
  if (end && finite(end.rho)) {
    const conf = result.confirmation.find(r => r.target === 'endRet');
    lines.push(conf?.verdict === '已验证'
      ? `${X} 能预测之后 24h 的方向：发现集 ρ = ${end.rho.toFixed(2)}，确认集复现${conf.survivesVolControl ? '，控制波动率后仍成立' : '，但控制波动率后不成立'}。`
      : `${X} 不能预测之后 24h 的方向：与${TARGET_NAME.endRet} ρ = ${end.rho.toFixed(2)}（Holm ${pEq(end.pHolm)}）${end.pHolm < DEEP_DIVE_ALPHA ? '，确认集没有复现' : ''}。`);
  }
  if (up && down && finite(up.rho) && finite(down.rho) && up.pHolm < DEEP_DIVE_ALPHA && down.pHolm < DEEP_DIVE_ALPHA && Math.sign(up.rho) !== Math.sign(down.rho)) {
    lines.push(`${X} 与 24h 最大涨幅（ρ = ${up.rho.toFixed(2)}）、最大跌幅（ρ = ${down.rho.toFixed(2)}）同时相关：${X} 大主要意味着之后波动大，不代表方向。`);
  }

  // 可操作的做法：以对照组中位数为界（对照组按定义约一半在界内），看实验组有多少落在同一侧
  const cut = ctl.median;
  const side = (v: number) => (lower ? v <= cut : v >= cut);
  const share = (group: DeepDigRowGroup) => {
    const xs = result.rows.filter(r => r.group === group && r.v != null).map(r => r.v!);
    return xs.length ? xs.filter(side).length / xs.length : null;
  };
  lines.push(`做法：进场前看 ${X}，${lower ? '≤' : '≥'} ${val(cut)}${def.unit ? ` ${def.unit}` : ''}（对照组中位数）时更像实验组——实验组 ${pct(share('positive'))} 满足，对照组 ${pct(share('control'))} 满足。`);
  const pickedAfter = def.id === DRIFT_SPEED_DEF.id && def.formula.trim() === DRIFT_SPEED_DEF.formula.trim()
    ? `；${X} 是看过三项结果后单独挑出来的，p 值偏乐观` : '';
  if (!inference) lines.push('推断统计还没运行：运行后这里会补上 t 检验、排名比较与预测力的结论。');
  lines.push(`局限：实验组只有 ${pos.n} 个、对照组 ${ctl.n} 个，结论来自同一批数据${pickedAfter}，要用之后新产生的战役确认。`);
  return lines;
}

/**
 * 【用户要求】2026-10-16「描述统计的数据那里，我希望可以整行删减（因为有的数据归类不准确）」：
 * 删掉的行（按事件 id）不进各组描述、推断统计与规律提取；明细里仍可查看、恢复。
 */
export function applyExclusions(data: DeepDigData, excluded: readonly string[]): DeepDigData {
  if (!excluded.length) return data;
  const drop = new Set(excluded);
  const rows = data.rows.filter(r => !drop.has(r.id));
  if (rows.length === data.rows.length) return data;
  return { ...data, rows, groups: DEEP_DIG_GROUPS.map(g => describeGroup(g, rows.filter(r => r.group === g).map(r => r.v).filter(finite))) };
}

/** 推断统计用的是哪些删减：与现在不同 → 提示重跑。 */
export const exclusionKey = (data: Pick<DeepDigData, 'rows'>, excluded: readonly string[]) => {
  const ids = new Set(data.rows.map(r => r.id));
  return excluded.filter(id => ids.has(id)).sort().join(',');
};
