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
import type { DeepRsaGroup } from '@/lib/deepRsa/grouping';
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

/** 分组标准里可用的战役读数。 */
export const CAMPAIGN_VARIABLES: readonly { name: string; label: string }[] = [
  { name: 'b', label: '理论 b（无加仓的战役没有这个读数，条件按不成立算，不算缺失）' },
  { name: 'r', label: '盈亏比（盈亏 ÷ L₀；L₀ 无效或盈亏来源弱时缺失）' },
  { name: 'pnl', label: '已实现盈亏（USDT）' },
  { name: 'chg', label: '主腿涨跌幅（%）' },
  { name: 'wear', label: 'L_磨损 ÷ L₀' },
];

export const DEFAULT_POSITIVE = 'b > 3 or r > 3';
export const DEFAULT_CONTROL = 'b < 0.5 or r < 0.5';

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
    createdAt: now,
  };
}

/** 用户存的定义（改过的内置项 + 新增项）合到内置清单上：内置在前，新增按创建先后。 */
export function mergeFeatureDefs(saved: readonly DeepDigFeatureDef[]): DeepDigFeatureDef[] {
  const byId = new Map(saved.map(d => [d.id, d]));
  const builtins = BUILTIN_FEATURES.filter(b => !byId.get(b.id)?.removed).map(b => ({ ...b, ...(byId.get(b.id) ?? {}), id: b.id, builtin: true }));
  const custom = saved.filter(d => !BUILTIN_FEATURES.some(b => b.id === d.id)).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return [...builtins, ...custom];
}

/** 被删掉（隐藏）的内置项：目录底部给一个不起眼的「恢复」。 */
export function removedBuiltins(saved: readonly DeepDigFeatureDef[]): DeepDigFeatureDef[] {
  const removed = new Set(saved.filter(d => d.removed).map(d => d.id));
  return BUILTIN_FEATURES.filter(b => removed.has(b.id));
}

/** 影响运行结果的部分：改了这些，旧结果就不再对应当前定义。 */
export const definitionKey = (d: Pick<DeepDigFeatureDef, 'formula' | 'positive' | 'control'>) => JSON.stringify([d.formula.trim(), d.positive.trim(), d.control.trim()]);

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

export interface CompiledGroups {
  positive: Program;
  control: Program;
  inputs: Set<string>;
}

export function compileGroups(positive: string, control: string): CompiledGroups {
  const known = new Set(CAMPAIGN_VARIABLES.map(v => v.name));
  const wrap = (label: string, src: string) => {
    try {
      return parseFormula(src, known);
    } catch (e) {
      throw e instanceof FormulaError ? new FormulaError(`${label}：${e.message.replace(/^第 \d+ 行：/, '')}`, e.line) : e;
    }
  };
  const p = wrap('实验组条件', positive);
  const c = wrap('对照组条件', control);
  return { positive: p, control: c, inputs: new Set([...p.inputs, ...c.inputs]) };
}

/** 战役本身数据不可靠（未结算、校正未拉齐、无锚点）：不进两组。条件读数是否缺失按条件里用到的读数单独判断。 */
const UNRELIABLE = new Set(['unresolved_status', 'no_anchor', 'corrections_incomplete', 'corrections_unknown']);

export function campaignVariables(row: CampaignGroupRow): { values: Record<string, number>; missing: Set<string> } {
  const g = row.grouping;
  const missing = new Set<string>();
  const val = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : Number.NaN);
  if (g.theoreticalB === 'missing') missing.add('b');
  if (g.payoff === 'missing') missing.add('r');
  const m = row.metrics;
  const values: Record<string, number> = {
    b: g.theoreticalB === 'missing' || g.theoreticalB === 'na' ? Number.NaN : val(row.theoreticalB),
    r: g.payoff === 'missing' ? Number.NaN : val(row.payoffRatio),
    pnl: val(m?.pnl), chg: val(m?.chg), wear: val(m?.wear),
  };
  for (const k of ['pnl', 'chg', 'wear']) if (Number.isNaN(values[k])) missing.add(k);
  return { values, missing };
}

const holds = (p: Program, values: Record<string, number>) => {
  const v = lastValue(evaluateProgram(p, values));
  return v != null && v !== 0;
};

export function classifyCampaign(row: CampaignGroupRow, groups: CompiledGroups): { group: DeepDigGroup; reason: DeepDigOtherReason | null } {
  if (row.grouping.pendingReasons.some(r => UNRELIABLE.has(r))) return { group: 'other', reason: 'unreliable' };
  const { values, missing } = campaignVariables(row);
  if ([...groups.inputs].some(k => missing.has(k))) return { group: 'other', reason: 'missing' };
  const pos = holds(groups.positive, values);
  const ctl = holds(groups.control, values);
  if (pos && ctl) return { group: 'conflict', reason: 'conflict' };
  if (pos) return { group: 'positive', reason: null };
  if (ctl) return { group: 'control', reason: null };
  return { group: 'other', reason: 'neither' };
}

/** 给流水线用：映射到原有的组名（簇的标签照旧按「簇里有正有负 → 不进比较」）。 */
export function groupOverride(groups: CompiledGroups): (row: CampaignGroupRow) => DeepRsaGroup {
  return row => {
    const { group } = classifyCampaign(row, groups);
    return group === 'other' ? 'middle' : group;
  };
}

/** 按当前标准数一下本机战役各组多少场（编辑时即时预览，不用跑行情）。 */
export function previewGroups(rows: readonly CampaignGroupRow[], groups: CompiledGroups): Record<DeepDigGroup, number> {
  const out: Record<DeepDigGroup, number> = { positive: 0, control: 0, conflict: 0, other: 0 };
  for (const row of rows) {
    if (row.grouping.group === 'excluded' || row.anchorMs == null) continue;
    out[classifyCampaign(row, groups).group]++;
  }
  return out;
}

export interface DefinitionCheck {
  formula: string | null;
  groups: string | null;
  scale: string | null;
}

/** 保存前检查：公式、分组标准能否解析，显示倍率是不是正数。 */
export function checkDefinition(d: Pick<DeepDigFeatureDef, 'formula' | 'positive' | 'control' | 'scale'>): DefinitionCheck {
  const msg = (f: () => unknown) => {
    try { f(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
  };
  return {
    formula: msg(() => compileFeatureFormula(d.formula)),
    groups: msg(() => compileGroups(d.positive, d.control)),
    scale: Number.isFinite(d.scale) && d.scale > 0 ? null : '显示倍数要是正数',
  };
}

