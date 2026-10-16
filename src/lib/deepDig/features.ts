/**
 * Deep dig 的特征值定义：名称、定义、公式、显示单位、分组标准——都可以由用户改，运行时照这里算。
 *
 * 【用户要求】2026-10-16「我希望每个特征值的这里都可以人为输入定义概念、公式、分组标准，然后运行的时候，
 * 就按照这里的公式提取因变量，按分组标准进行划分组别」。
 *   - 公式：在进场前 48h 的已收盘 5m K 线上逐根算，取最后一根的值（见 formula.ts）。
 *   - 分组标准：实验组、对照组各一个条件，按每场战役的读数判断；同时满足 → 冲突，都不满足 → 其他战役。
 * 内置的「多空博弈均衡点漂移速度 V」默认公式与主图 DSP 指标的 V 逐根一致（单元测试核对），默认分组标准与原 Deep RSA 分组一致。
 */
import type { ObservationWindow } from '@/lib/deepRsa/window';
import type { CampaignGroupRow } from '@/lib/deepRsa/report';
import { groupSignal, type DeepRsaGroup } from '@/lib/deepRsa/grouping';
import { CAMPAIGN_METRIC_LETTERS, type MetricLetter } from '@/lib/campaignMetricLetters';
import type { TradeSignal } from '@/lib/signalLibrary';
import { evaluateProgram, FormulaError, lastValue, parseFormula, type Program } from '@/lib/deepDig/formula';

export interface DeepDigFeatureDef {
  /** 网址上的名字。 */
  id: string;
  name: string;
  /** 简称：表头、规律里用（如 V）。 */
  short: string;
  definition: string;
  formula: string;
  /** 界面显示倍率与单位（只换单位，检验用原值）。 */
  scale: number;
  unit: string;
  /** 分组标准（条件式）。 */
  positive: string;
  control: string;
  /** 样本来源：交易战役（默认）或信号库。【用户要求】信号评分的时间点是那条信号的时间。 */
  source?: SampleSource;
  /**
   * 分组标准用的是哪一版变量名：2 = 指标字母表（b 盈亏比、Bₜ 理论 b、c 首仓涨跌幅……）。
   * 没有这一项的是旧写法（b 理论 b、r 盈亏比、pnl、chg、wear），读进来时自动换成新字母，意思不变。
   */
  groupVars?: 2;
  builtin?: boolean;
  /** 内置项被用户从目录删掉（隐藏，可恢复）。 */
  removed?: boolean;
  createdAt?: number;
}

/** 公式里可用的序列：每根 5m K 线一个值。 */
export const SERIES_VARIABLES: readonly { name: string; label: string }[] = [
  { name: 'C', label: '收盘价' },
  { name: 'O', label: '开盘价' },
  { name: 'H', label: '最高价' },
  { name: 'L', label: '最低价' },
  { name: 'Q', label: '成交额（USDT）= B + S' },
  { name: 'B', label: '主动买入成交额（USDT）' },
  { name: 'S', label: '主动卖出成交额（USDT）= Q − B' },
];
const AMOUNT_VARIABLES = new Set(['Q', 'B', 'S']);
/** 用到成交额的公式：观察窗里有金额数据的 K 线不到这个比例，这一场记缺失（不拿币数凑）。 */
export const MIN_AMOUNT_COVERAGE = 0.95;

export type SampleSource = 'campaigns' | 'signals';
export const SOURCE_LABEL: Record<SampleSource, string> = { campaigns: '交易战役', signals: '信号库' };

/** 分组标准里可用的读数：交易战役用指标字母表里的战役指标，信号库用信号评分 s。 */
export function groupVariables(source: SampleSource = 'campaigns'): readonly MetricLetter[] {
  return CAMPAIGN_METRIC_LETTERS.filter(m => m.source === (source === 'signals' ? 'signal' : 'campaign'));
}

export const DEFAULT_GROUPS: Record<SampleSource, { positive: string; control: string }> = {
  // 与原 Deep RSA 分组一致：理论 b 或盈亏比 > 3 为正样本，< 0.5 为对照
  campaigns: { positive: 'Bₜ > 3 or b > 3', control: 'Bₜ < 0.5 or b < 0.5' },
  // 与原信号分组一致：≥ 3 星为正样本，< 3 星为对照
  signals: { positive: 's >= 3', control: 's < 3' },
};
export const DEFAULT_POSITIVE = DEFAULT_GROUPS.campaigns.positive;
export const DEFAULT_CONTROL = DEFAULT_GROUPS.campaigns.control;

const LEGACY_GROUP_VARS: Record<string, string> = { b: 'Bₜ', r: 'b', pnl: 'p', chg: 'c', wear: 'w' };
/** 旧变量名 → 指标字母（同时换，b → Bₜ 与 r → b 不会互相串）。 */
export function translateLegacyGroupExpr(expr: string): string {
  return expr.replace(/[\p{L}_][\p{L}\p{N}_]*/gu, id => LEGACY_GROUP_VARS[id] ?? id);
}
/** 没标 groupVars 的定义（旧写法）换成指标字母；已是新写法的原样返回。 */
export function upgradeGroupVars<T extends { positive: string; control: string; groupVars?: 2 }>(d: T): T {
  if (d.groupVars === 2) return d;
  return { ...d, positive: translateLegacyGroupExpr(d.positive), control: translateLegacyGroupExpr(d.control), groupVars: 2 };
}

export const DRIFT_SPEED_FORMULA = [
  '# B / S = 主动买入 / 卖出成交金额（USDT），Q = B + S',
  'N = abs(B - S)              # 主动净资金',
  'F = ln(1 + N / ema(Q, 6))   # 资金力量：净资金比平时的成交额异常多少',
  'A = (B - S) / Q             # 主动买方优势',
  'G = 1 + max(A, 0)           # 买方优势权重',
  'R = ln(C / prev(C))         # 价格变化',
  'U = nz(F * G * R)           # 单根推动力（缺数据的那根记 0）',
  'V = ema(U, 6, 0)            # 漂移速度：半衰期 6 小时指数平滑',
].join('\n');

export const DRIFT_SPEED_DEF: DeepDigFeatureDef = {
  id: 'drift-speed',
  name: '多空博弈均衡点漂移速度 V',
  short: 'V',
  definition: '进场前最后一根 5m K 线上，动态谢林点（多空博弈的均衡价）每根往上（+）或往下（−）移动多少：净资金力量 × 买方优势权重 × 涨跌幅，按半衰期 6 小时指数平滑。',
  formula: DRIFT_SPEED_FORMULA,
  scale: 1e4,
  unit: '基点/根',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

export const BUILTIN_FEATURES: readonly DeepDigFeatureDef[] = [DRIFT_SPEED_DEF];

/** 新增特征值的模板。 */
export function newFeatureTemplate(now: number): DeepDigFeatureDef {
  return {
    id: `f-${now.toString(36)}`,
    name: '新特征值',
    short: 'X',
    definition: '',
    formula: '# 例：进场前 12 小时（144 根 5m K 线）的涨跌幅\nln(C / prev(C, 144))',
    scale: 100,
    unit: '%',
    positive: DEFAULT_POSITIVE,
    control: DEFAULT_CONTROL,
    source: 'campaigns',
    groupVars: 2,
    createdAt: now,
  };
}

/** 用户存的定义（改过的内置项 + 新增项）合到内置清单上：内置在前，新增按创建先后。 */
export function mergeFeatureDefs(saved: readonly DeepDigFeatureDef[]): DeepDigFeatureDef[] {
  const byId = new Map(saved.map(d => [d.id, upgradeGroupVars(d)]));
  const builtins = BUILTIN_FEATURES.filter(b => !byId.get(b.id)?.removed).map(b => ({ ...b, ...(byId.get(b.id) ?? {}), id: b.id, builtin: true }));
  const custom = saved.filter(d => !BUILTIN_FEATURES.some(b => b.id === d.id)).map(upgradeGroupVars).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return [...builtins, ...custom];
}

/** 被删掉（隐藏）的内置项：目录底部给一个不起眼的「恢复」。 */
export function removedBuiltins(saved: readonly DeepDigFeatureDef[]): DeepDigFeatureDef[] {
  const removed = new Set(saved.filter(d => d.removed).map(d => d.id));
  return BUILTIN_FEATURES.filter(b => removed.has(b.id));
}

/** 影响运行结果的部分：改了这些，旧结果就不再对应当前定义。 */
export const definitionKey = (d: Pick<DeepDigFeatureDef, 'formula' | 'positive' | 'control' | 'source' | 'groupVars'>) => {
  const g = upgradeGroupVars(d);
  return JSON.stringify([d.formula.trim(), g.positive.trim(), g.control.trim(), d.source ?? 'campaigns']);
};

// ===================== 公式 =====================

export interface CompiledFeature {
  program: Program;
  usesAmounts: boolean;
}

export function compileFeatureFormula(formula: string): CompiledFeature {
  const program = parseFormula(formula, new Set(SERIES_VARIABLES.map(v => v.name)));
  return { program, usesAmounts: [...program.inputs].some(n => AMOUNT_VARIABLES.has(n)) };
}

/** 在观察窗上算一次：取最后一根的值；算不出来或成交额覆盖不足 → null。 */
export function computeFeatureValue(window: ObservationWindow, compiled: CompiledFeature): number | null {
  const bars = window.bars;
  if (!bars.length) return null;
  if (compiled.usesAmounts) {
    const withAmounts = bars.filter(b => b.quoteVolume != null && b.takerBuyQuoteVolume != null).length;
    if (withAmounts < MIN_AMOUNT_COVERAGE * bars.length) return null;
  }
  const series = (f: (b: (typeof bars)[number]) => number | null | undefined) => Float64Array.from(bars, b => {
    const v = f(b);
    return v != null && Number.isFinite(v) ? v : Number.NaN;
  });
  const q = series(b => b.quoteVolume);
  const buy = series(b => b.takerBuyQuoteVolume);
  try {
    return lastValue(evaluateProgram(compiled.program, {
      C: series(b => b.close), O: series(b => b.open), H: series(b => b.high), L: series(b => b.low),
      Q: q, B: buy, S: q.map((v, i) => v - buy[i]),
    }));
  } catch {
    return null;
  }
}

// ===================== 分组 =====================

export type DeepDigGroup = 'positive' | 'control' | 'conflict' | 'other';
export type DeepDigOtherReason = 'unreliable' | 'missing' | 'conflict' | 'neither';

/**
 * 分组用的一个样本：一场交易战役，或信号库里的一条信号（时间点 = 那条信号的时间）。
 * values / missing 的键同时有字母与它的拼写（Bₜ 与 Bt 都能写）。
 */
export interface SampleRow {
  id: string;
  symbol: string;
  anchorMs: number | null;
  /** 不进研究（回收站、非主多；信号：探顶区、事后跟进记录、没有行情）。 */
  excluded: boolean;
  /** 数据本身不可靠（未结算、校正未拉齐、没有锚点 / 时间）：归其他，不进两组。 */
  unreliable: boolean;
  values: Record<string, number>;
  missing: Set<string>;
}

export interface CompiledGroups {
  source: SampleSource;
  positive: Program;
  control: Program;
  inputs: Set<string>;
}

const namesOf = (m: MetricLetter) => [m.letter, ...m.aliases];

export function compileGroups(positive: string, control: string, source: SampleSource = 'campaigns'): CompiledGroups {
  const known = new Set(groupVariables(source).flatMap(namesOf));
  const wrap = (label: string, src: string) => {
    try {
      return parseFormula(src, known);
    } catch (e) {
      throw e instanceof FormulaError ? new FormulaError(`${label}：${e.message.replace(/^第 \d+ 行：/, '')}`, e.line) : e;
    }
  };
  const p = wrap('实验组条件', positive);
  const c = wrap('对照组条件', control);
  // 别名换成字母本身：判断「缺失」时按字母查
  const canonical = new Map(groupVariables(source).flatMap(m => namesOf(m).map(n => [n, m.letter] as const)));
  return { source, positive: p, control: c, inputs: new Set([...p.inputs, ...c.inputs].map(n => canonical.get(n) ?? n)) };
}

/** 战役本身数据不可靠（未结算、校正未拉齐、无锚点）：不进两组。条件读数是否缺失按条件里用到的读数单独判断。 */
const UNRELIABLE = new Set(['unresolved_status', 'no_anchor', 'corrections_incomplete', 'corrections_unknown']);

function withAliases(source: SampleSource, values: Record<string, number>, missing: Set<string>) {
  for (const m of groupVariables(source)) for (const a of m.aliases) { values[a] = values[m.letter]; if (missing.has(m.letter)) missing.add(a); }
}

/**
 * 战役 → 样本。读数来自指标字母表（report 里算好的 letters）；理论 b（Bₜ）与盈亏比（b）沿用原分组的口径：
 * 没有加仓的战役没有 Bₜ（条件按不成立算，不算缺失）；L₀ 无效或盈亏来源弱时 b 缺失。
 */
export function campaignSample(row: CampaignGroupRow): SampleRow {
  const g = row.grouping;
  const missing = new Set<string>();
  const val = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : Number.NaN);
  const values: Record<string, number> = {};
  for (const m of groupVariables('campaigns')) {
    values[m.letter] = val(row.letters?.[m.letter]);
    if (Number.isNaN(values[m.letter])) missing.add(m.letter);
  }
  values['Bₜ'] = g.theoreticalB === 'missing' || g.theoreticalB === 'na' ? Number.NaN : val(row.theoreticalB);
  if (g.theoreticalB === 'missing') missing.add('Bₜ'); else missing.delete('Bₜ');
  values.b = g.payoff === 'missing' ? Number.NaN : val(row.payoffRatio);
  if (g.payoff === 'missing') missing.add('b'); else missing.delete('b');
  withAliases('campaigns', values, missing);
  return {
    id: row.campaignId, symbol: row.symbol, anchorMs: row.anchorMs,
    excluded: g.group === 'excluded', unreliable: g.pendingReasons.some(r => UNRELIABLE.has(r)), values, missing,
  };
}

/** 信号 → 样本：时间点 = 信号自己的时间，读数 s = 星级（没评分 = 缺失）。不进研究的规则与原信号分组相同。 */
export function signalSample(signal: TradeSignal): SampleRow {
  const g = groupSignal({ signalId: signal.id, symbol: signal.symbol, anchorMs: signal.timeMs, quality: signal.quality, fallbackZone: signal.fallbackZone, jumpIssue: signal.jumpIssue });
  const values: Record<string, number> = { s: g.stars ?? Number.NaN };
  const missing = new Set<string>(g.stars == null ? ['s'] : []);
  return {
    id: signal.id, symbol: signal.symbol, anchorMs: Number.isFinite(signal.timeMs) ? signal.timeMs : null,
    excluded: g.excludedReasons.length > 0, unreliable: g.pendingReasons.includes('no_anchor'), values, missing,
  };
}

const holds = (p: Program, values: Record<string, number>) => {
  const v = lastValue(evaluateProgram(p, values));
  return v != null && v !== 0;
};

export function classifySample(row: SampleRow, groups: CompiledGroups): { group: DeepDigGroup; reason: DeepDigOtherReason | null } {
  if (row.unreliable) return { group: 'other', reason: 'unreliable' };
  if ([...groups.inputs].some(k => row.missing.has(k))) return { group: 'other', reason: 'missing' };
  const pos = holds(groups.positive, row.values);
  const ctl = holds(groups.control, row.values);
  if (pos && ctl) return { group: 'conflict', reason: 'conflict' };
  if (pos) return { group: 'positive', reason: null };
  if (ctl) return { group: 'control', reason: null };
  return { group: 'other', reason: 'neither' };
}

/** 兼容：按战役行直接分组。 */
export function classifyCampaign(row: CampaignGroupRow, groups: CompiledGroups) {
  return classifySample(campaignSample(row), groups);
}

/** 给流水线用的事件行：排除项不进；组名映射到原有的组名（簇的标签照旧按「簇里有正有负 → 不进比较」）。 */
export function sampleEventRows(samples: readonly SampleRow[], groups: CompiledGroups): { id: string; symbol: string; anchorMs: number; group: DeepRsaGroup }[] {
  return samples.flatMap(row => {
    if (row.excluded || row.anchorMs == null) return [];
    const { group } = classifySample(row, groups);
    return [{ id: row.id, symbol: row.symbol, anchorMs: row.anchorMs, group: group === 'other' ? 'middle' : group }];
  });
}

/** 按当前标准数一下本机样本各组多少个（编辑时即时预览，不用跑行情）。 */
export function previewGroups(samples: readonly SampleRow[], groups: CompiledGroups): Record<DeepDigGroup, number> {
  const out: Record<DeepDigGroup, number> = { positive: 0, control: 0, conflict: 0, other: 0 };
  for (const row of samples) {
    if (row.excluded || row.anchorMs == null) continue;
    out[classifySample(row, groups).group]++;
  }
  return out;
}

export interface DefinitionCheck {
  formula: string | null;
  groups: string | null;
  scale: string | null;
}

/** 保存前检查：公式、分组标准能否解析，显示倍率是不是正数。 */
export function checkDefinition(d: Pick<DeepDigFeatureDef, 'formula' | 'positive' | 'control' | 'scale' | 'source'>): DefinitionCheck {
  const msg = (f: () => unknown) => {
    try { f(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
  };
  return {
    formula: msg(() => compileFeatureFormula(d.formula)),
    groups: msg(() => compileGroups(d.positive, d.control, d.source ?? 'campaigns')),
    scale: Number.isFinite(d.scale) && d.scale > 0 ? null : '显示倍数要是正数',
  };
}

