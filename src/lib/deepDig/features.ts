/**
 * Deep dig 的特征值定义：名称、定义、公式、显示单位、分组标准——都可以由用户改，运行时照这里算。
 *
 * 【用户要求】2026-10-16「我希望每个特征值的这里都可以人为输入定义概念、公式、分组标准，然后运行的时候，
 * 就按照这里的公式提取因变量，按分组标准进行划分组别」。
 *   - 公式：在进场前观察窗内的已收盘 K 线（周期可选，默认 5m）上逐根算，取最后一根的值（见 formula.ts）。
 *   - 分组标准：实验组、对照组各一个条件，按每场战役的读数判断；同时满足 → 冲突，都不满足 → 其他战役。
 * 内置的「买方推力的加速度 a」：默认公式用过去 avgh 小时（默认 24）的平均成交额；把 avg(Q, avgh) 换回 ema(Q, hl) 即与主图 DSP 的 V 逐根一致（单元测试核对）。默认分组标准与原 Deep RSA 分组一致。
 */
import type { ObservationWindow, ResearchBar } from '@/lib/deepRsa/window';
import { intervalMs, type ResearchInterval } from '@/lib/deepRsa/marketData';
import type { CampaignGroupRow } from '@/lib/deepRsa/report';
import { groupSignal, type DeepRsaGroup } from '@/lib/deepRsa/grouping';
import { CAMPAIGN_METRIC_LETTERS, type MetricLetter } from '@/lib/campaignMetricLetters';
import type { TradeSignal } from '@/lib/signalLibrary';
import { evaluateProgram, evaluateProgramVars, FormulaError, lastValue, parseFormula, programVariables, type Program } from '@/lib/deepDig/formula';

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
  /**
   * 特征值用哪个周期的 K 线、半衰期多少小时（公式里写 hl）。
   * 【用户要求】2026-10-16「周期这里可以做成能够自主选择的。选择哪个周期，就统计哪个周期的变量。另外半衰期也要做成可以选择的」。
   * 不给 = 5m、6 小时（与原 Deep RSA 第 7 步、主图 DSP 一致）。
   */
  interval?: ResearchInterval;
  halfLifeHours?: number;
  /**
   * 平均时长（小时，公式里写 avgh，配 avg(x, avgh) 用）：过去多长时间的平均。
   * 【用户要求】2026-10-17「如果想改成过去一段时间的平均值，时间的选取就选 24 小时（并且还要满足能够修改）…既可以在公式中改、也可以手动点击选取和填写」。
   * 不给 = 24 小时。
   */
  avgHours?: number;
  builtin?: boolean;
  /** 内置项被用户从目录删掉（隐藏，可恢复）。 */
  removed?: boolean;
  createdAt?: number;
}

export const DEFAULT_INTERVAL: ResearchInterval = '5m';
export const DEFAULT_HALF_LIFE_HOURS = 6;
/** 半衰期的快捷选项（小时）；也可以手填。 */
export const HALF_LIFE_PRESETS = [1, 2, 3, 6, 12, 24, 48, 72] as const;
export const DEFAULT_AVG_HOURS = 24;
/** 平均时长的快捷选项（小时）；也可以手填。 */
export const AVG_HOURS_PRESETS = [1, 4, 12, 24, 48, 72] as const;
/** 特征值的 K 线周期（不含太粗的 6h / 12h，界面上更简洁）。 */
export const FEATURE_INTERVALS: readonly ResearchInterval[] = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'];
export const INTERVAL_LABEL: Record<string, string> = { '1m': '1 分钟', '3m': '3 分钟', '5m': '5 分钟', '15m': '15 分钟', '30m': '30 分钟', '1h': '1 小时', '2h': '2 小时', '4h': '4 小时', '6h': '6 小时', '12h': '12 小时', '1d': '1 天' };

export const intervalOf = (d: Pick<DeepDigFeatureDef, 'interval'>): ResearchInterval => d.interval ?? DEFAULT_INTERVAL;
export const halfLifeOf = (d: Pick<DeepDigFeatureDef, 'halfLifeHours'>): number => (d.halfLifeHours != null && d.halfLifeHours > 0 ? d.halfLifeHours : DEFAULT_HALF_LIFE_HOURS);
export const avgHoursOf = (d: Pick<DeepDigFeatureDef, 'avgHours'>): number => (d.avgHours != null && d.avgHours > 0 ? d.avgHours : DEFAULT_AVG_HOURS);
type ParamDef = Pick<DeepDigFeatureDef, 'interval' | 'halfLifeHours' | 'avgHours'>;

/**
 * 观察窗长度：进场前多长时间的 K 线。至少 48 小时（与原研究一致）；半衰期长时放到 8 个半衰期，让平滑「热起来」；
 * 平均时长长时放到「平均时长 + 4 个半衰期」（最后一段平滑用到的每根都有足够的过去可平均）；周期粗时至少 50 根。
 * 默认（5m、半衰期 6 小时、平均 24 小时）正好 48 小时。
 */
export function featureWindowMs(d: ParamDef): number {
  const H = 3_600_000;
  return Math.max(48 * H, 8 * halfLifeOf(d) * H, (avgHoursOf(d) + 4 * halfLifeOf(d)) * H, 50 * intervalMs(intervalOf(d)));
}
/** 「6 小时 = 72 根 5 分钟 K 线」这种换算，界面上用。 */
export const barsPerHalfLife = (d: ParamDef) => (halfLifeOf(d) * 3_600_000) / intervalMs(intervalOf(d));
export const barsPerAvg = (d: ParamDef) => Math.max(1, Math.round((avgHoursOf(d) * 3_600_000) / intervalMs(intervalOf(d))));

/** 公式里可用的参数（一个数）：上面点选 / 填写的值。 */
export const PARAM_VARIABLES: readonly { name: string; alias: string; label: string }[] = [
  { name: 'hl', alias: '半衰期', label: '半衰期（小时，上面选的；也可写「半衰期」）' },
  { name: 'avgh', alias: '平均时长', label: '平均时长（小时，上面选的；也可写「平均时长」），配 avg(x, avgh) 用' },
];
const PARAM_NAMES = PARAM_VARIABLES.flatMap(p => [p.name, p.alias]);

/** 公式里可用的序列：每根 K 线（上面选的周期）一个值。 */
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
/** 观察窗的 K 线覆盖率至少这么多（与原研究同一标准）。 */
export const MIN_WINDOW_COVERAGE = 0.95;

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

/** 上一版的默认公式（半衰期写死 6）：用户存的若还是它，读进来换成跟随 hl 的新版。 */
const LEGACY_DRIFT_SPEED_FORMULA = [
  '# B / S = 主动买入 / 卖出成交金额（USDT），Q = B + S',
  'N = abs(B - S)              # 主动净资金',
  'F = ln(1 + N / ema(Q, 6))   # 资金力量：净资金比平时的成交额异常多少',
  'A = (B - S) / Q             # 主动买方优势',
  'G = 1 + max(A, 0)           # 买方优势权重',
  'R = ln(C / prev(C))         # 价格变化',
  'U = nz(F * G * R)           # 单根推动力（缺数据的那根记 0）',
  'V = ema(U, 6, 0)            # 漂移速度：半衰期 6 小时指数平滑',
].join('\n');

/** 上一版的默认公式（平时成交额 = 按半衰期平滑的成交额，与主图 DSP 一致）。 */
export const EMA_DRIFT_SPEED_FORMULA = [
  '# B / S = 主动买入 / 卖出成交金额（USDT），Q = B + S；hl = 上面选的半衰期（小时）',
  'N = abs(B - S)              # 主动净资金',
  'F = ln(1 + N / ema(Q, hl))  # 资金力量：净资金比平时的成交额异常多少',
  'A = (B - S) / Q             # 主动买方优势',
  'G = 1 + max(A, 0)           # 买方优势权重',
  'R = ln(C / prev(C))         # 价格变化',
  'U = nz(F * G * R)           # 单根推动力（缺数据的那根记 0）',
  'V = ema(U, hl, 0)           # 漂移速度：按半衰期 hl 指数平滑',
].join('\n');

/**
 * 默认公式：平时成交额 = 过去 avgh 小时（默认 24）的平均成交额。
 * 【用户要求】2026-10-17「如果想改成过去一段时间的平均值，时间的选取就选 24 小时」。想与主图 DSP 逐根一致，把 avg(Q, avgh) 换回 ema(Q, hl)。
 */
const LEGACY_V_DRIFT_SPEED_FORMULA = [
  '# B / S = 主动买入 / 卖出成交金额（USDT），Q = B + S；hl = 半衰期，avgh = 平均时长（小时，都在下面选）',
  'N = abs(B - S)                 # 主动净资金',
  'F = ln(1 + N / avg(Q, avgh))   # 资金力量：净资金比过去 avgh 小时的平均成交额异常多少',
  'A = (B - S) / Q                # 主动买方优势',
  'G = 1 + max(A, 0)              # 买方优势权重',
  'R = ln(C / prev(C))            # 价格变化',
  'U = nz(F * G * R)              # 单根推动力（缺数据的那根记 0）',
  'V = ema(U, hl, 0)              # 漂移速度：按半衰期 hl 指数平滑',
].join('\n');

const LEGACY_A_DRIFT_SPEED_FORMULA = LEGACY_V_DRIFT_SPEED_FORMULA.replace('V = ema(U, hl, 0)', 'a = ema(U, hl, 0)');
export const DRIFT_SPEED_FORMULA = LEGACY_A_DRIFT_SPEED_FORMULA
  .replace('F = ln(', 'f = ln(')
  .replace('U = nz(F * G * R)', 'F = nz(f * G * R)')
  .replace('ema(U, hl, 0)', 'ema(F, hl, 0)')
  .replace('单根推动力', '单根推力');

export const DRIFT_SPEED_DEF: DeepDigFeatureDef = {
  id: 'drift-speed',
  name: '买方推力的加速度 a',
  short: 'a',
  definition: '进场前最后一根 K 线上，动态谢林点（多空博弈的均衡价）每根往上（+）或往下（−）移动多少：净资金力量 × 买方优势权重 × 涨跌幅，按半衰期指数平滑（周期、半衰期见下）。',
  formula: DRIFT_SPEED_FORMULA,
  scale: 1e4,
  unit: '基点/根',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

/**
 * BSS 买卖强度综合分（Deep dig 第二个特征值；K 线图指标里同名副图用 src/lib/bss.ts 的 computeBss，单元测试核对逐根一致）。
 * 【用户要求】2026-10-18「新增一个指标 BSS…放在指标中、以及 deep dig 的第二个特征值」；订单簿 I 没有历史数据，去掉；
 * 权重按用户给的 0.45 / 0.25 / 0.30。标准化 = tanh(滚动 z-score)，BSS 落在 −1 ~ 1；标准化窗口 = 平均时长 avgh（默认 24 小时）。
 */
export const BSS_FORMULA = [
  '# BSS = 0.45·M标准化 + 0.25·Vd + 0.30·A，−1 ~ 1；Vd = V 随价格方向的加减分；订单簿 I 没有历史数据，去掉',
  '# Q = 成交额，B / S = 主动买入 / 卖出成交额（USDT）；avgh = 标准化窗口（下面选，默认 24 小时）',
  'n = 1                                   # 近期窗口（小时）',
  'M = C / ago(C, n) - 1                   # 价格动量：近 n 小时涨跌幅',
  'V = avg(Q, n) / avg(Q, avgh)            # 相对成交量：近 n 小时平均成交额 ÷ 近 avgh 小时平均',
  'A = (avg(B, n) - avg(S, n)) / avg(Q, n) # 成交攻击性：(主动买 − 主动卖) ÷ 合计，−1 ~ 1',
  'Mz = tanh(zscore(M, avgh))              # M 标准化：滚动 z-score 压到 −1 ~ 1',
  'Vz = tanh(zscore(V, avgh))              # V 标准化',
  'Vd = if(M > 0, Vz, if(M < 0, min(-Vz, 0), 0))   # 涨时放量加分、缩量扣分；跌时放量扣分、缩量不加分',
  'BSS = 0.45 * Mz + 0.25 * Vd + 0.30 * A',
].join('\n');

/**
 * 用户存的 BSS 定义（含自己加的行）升级到现在的「V 方向分」写法，其余行原样保留；定义键随之改变，界面提示重新运行描述统计。
 * 两种旧写法：最早不分方向（BSS = … + 0.25 * Vz + …），第一版方向分（Vd = sign(M) * Vz，跌时缩量也加分）。
 */
const BSS_NEW_HEAD = '# BSS = 0.45·M标准化 + 0.25·Vd + 0.30·A，−1 ~ 1；Vd = V 随价格方向的加减分；订单簿 I 没有历史数据，去掉';
const BSS_NEW_VD = 'Vd = if(M > 0, Vz, if(M < 0, min(-Vz, 0), 0))   # 涨时放量加分、缩量扣分；跌时放量扣分、缩量不加分';
const BSS_LINE_UPGRADES: readonly { match: (line: string) => boolean; to: string }[] = [
  { match: l => l.startsWith('# BSS = 0.45·M标准化 + 0.25·V标准化 + 0.30·A') || l.startsWith('# BSS = 0.45·M标准化 + 0.25·sign(M)·V标准化 + 0.30·A'), to: BSS_NEW_HEAD },
  { match: l => l === 'BSS = 0.45 * Mz + 0.25 * Vz + 0.30 * A', to: `${BSS_NEW_VD}\nBSS = 0.45 * Mz + 0.25 * Vd + 0.30 * A` },
  { match: l => /^Vd = sign\(M\) \* Vz\b/.test(l), to: BSS_NEW_VD },
];
export function upgradeBssFormula<T extends { id?: string; formula?: string }>(d: T): T {
  if (d.id !== 'bss' || !d.formula) return d;
  const lines = d.formula.split('\n');
  // 只在有旧的 V 那一行时动（只改了注释的不算）
  if (!lines.some(l => BSS_LINE_UPGRADES.slice(1).some(u => u.match(l.trim())))) return d;
  const formula = lines.map(l => BSS_LINE_UPGRADES.find(u => u.match(l.trim()))?.to ?? l).join('\n');
  return { ...d, formula };
}

export const BSS_DEF: DeepDigFeatureDef = {
  id: 'bss',
  name: '买卖强度综合分 BSS',
  short: 'BSS',
  definition: '进场前最后一根 K 线上的买卖强度（−1 ~ 1）：0.45 × 价格动量 M 标准化 + 0.25 × 相对成交量 V 标准化 + 0.30 × 成交攻击性 A。> 0.55 且 M > 0 买方优势明确；从高位回落到 < 0.2 或 A 转负 = 弱了（阈值需自行验证）。订单簿没有历史，板不平衡 I 去掉。',
  formula: BSS_FORMULA,
  scale: 1,
  unit: '',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

/**
 * 买方推力的加速度 az（Z 分数版）：Deep dig 第三个内置特征值；K 线图「动态谢林点」打开「Z」开关时 a 副图画的就是它
 * （主图用的「平时成交额」是 ema(Q, hl)，把下面 f 一行换成 ema(Q, hl) 就与主图逐根一致，单元测试核对）。
 * 【用户要求】2026-10-18「把 DSP 也做成可以基于 Z 分数的，具体哪一步需要标准化处理，你来定」：只把涨跌 R 除以它自己的标准差——
 * f 本来就是和自己的平均成交额比、A 本来就在 −1 ~ 1，只有 R 带着各个币自己的波动大小；不减均值（减掉会把趋势本身减掉）。
 */
export const DRIFT_SPEED_Z_FORMULA = [
  '# Z 分数版：涨跌 R 先除以它过去 avgh 小时的标准差（几个 σ），不同币的波动大小不再左右结果；0 仍是多空平衡',
  '# B / S = 主动买入 / 卖出成交金额（USDT），Q = B + S；hl = 半衰期，avgh = 平均时长（小时，都在下面选）',
  'N = abs(B - S)                 # 主动净资金',
  'f = ln(1 + N / avg(Q, avgh))   # 资金力量：净资金比过去 avgh 小时的平均成交额异常多少',
  'A = (B - S) / Q                # 主动买方优势',
  'G = 1 + max(A, 0)              # 买方优势权重',
  'R = ln(C / prev(C))            # 价格变化',
  'Rz = R / sd(R, avgh)           # 价格变化的 Z 分数：除以过去 avgh 小时的标准差（均值按 0）',
  'F = nz(f * G * Rz)             # 单根推力（标准差单位；缺数据的那根记 0）',
  'az = ema(F, hl, 0)             # 买方推力的加速度（Z 分数版）：按半衰期 hl 指数平滑',
].join('\n');

export const DRIFT_SPEED_Z_DEF: DeepDigFeatureDef = {
  id: 'drift-speed-z',
  name: '买方推力的加速度 az（Z 分数）',
  short: 'az',
  definition: '与买方推力的加速度 a 相同，只是每根的涨跌先换成「几个标准差」（除以它过去 avgh 小时的标准差）：波动大的币不再天然读数大，不同币可以横向比较、少受极端值左右；0 仍是多空平衡。',
  formula: DRIFT_SPEED_Z_FORMULA,
  scale: 100,
  unit: '%σ/根',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

export const BUILTIN_FEATURES: readonly DeepDigFeatureDef[] = [DRIFT_SPEED_DEF, BSS_DEF, DRIFT_SPEED_Z_DEF];

/** 新增特征值的模板。 */
export function newFeatureTemplate(now: number): DeepDigFeatureDef {
  return {
    id: `f-${now.toString(36)}`,
    name: '新特征值',
    short: 'X',
    definition: '',
    formula: '# 例：最近 144 根 K 线的涨跌幅（5 分钟周期 = 12 小时）\nln(C / prev(C, 144))',
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
  const byId = new Map(saved.map(d => [d.id, upgradeBssFormula(upgradeFormula(upgradeGroupVars(d)))]));
  const builtins = BUILTIN_FEATURES.filter(b => !byId.get(b.id)?.removed).map(b => ({ ...b, ...(byId.get(b.id) ?? {}), id: b.id, builtin: true }));
  const custom = saved.filter(d => !BUILTIN_FEATURES.some(b => b.id === d.id)).map(upgradeGroupVars).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  // 历史内置名称随系统更新，用户自定义的名称保持原样。
  const legacyNames = new Set([
    ['多空博弈均衡点', '漂移速度'].join(''),
    ['多空博弈均衡点', '漂移速度 V'].join(''),
    ['谢林点', '迁移速度 V'].join(''),
    ['买方推力的加速度', ' V'].join(''),
  ]);
  return [...builtins, ...custom].map(def => def.id === DRIFT_SPEED_DEF.id
    ? { ...def, name: legacyNames.has(def.name) ? DRIFT_SPEED_DEF.name : def.name, short: DRIFT_SPEED_DEF.short } : def);
}

/**
 * 存的还是以前的默认公式（写死 6 小时的、按半衰期平滑成交额的）：换成现在的默认公式（过去 avgh 小时平均成交额）。
 * 后一次换法改变结果：旧结果的定义键对不上，界面提示重新运行。
 */
function upgradeFormula<T extends { formula?: string; definition?: string }>(d: T): T {
  const f = d.formula?.trim();
  if (f !== LEGACY_DRIFT_SPEED_FORMULA && f !== EMA_DRIFT_SPEED_FORMULA && f !== LEGACY_V_DRIFT_SPEED_FORMULA && f !== LEGACY_A_DRIFT_SPEED_FORMULA) return d;
  const definition = d.definition === '进场前最后一根 5m K 线上，动态谢林点（多空博弈的均衡价）每根往上（+）或往下（−）移动多少：净资金力量 × 买方优势权重 × 涨跌幅，按半衰期 6 小时指数平滑。'
    ? DRIFT_SPEED_DEF.definition : d.definition;
  return { ...d, formula: DRIFT_SPEED_FORMULA, definition };
}

/** 被删掉（隐藏）的内置项：目录底部给一个不起眼的「恢复」。 */
export function removedBuiltins(saved: readonly DeepDigFeatureDef[]): DeepDigFeatureDef[] {
  const removed = new Set(saved.filter(d => d.removed).map(d => d.id));
  return BUILTIN_FEATURES.filter(b => removed.has(b.id));
}

/** 影响运行结果的部分：改了这些，旧结果就不再对应当前定义。 */
export const definitionKey = (d: Pick<DeepDigFeatureDef, 'formula' | 'positive' | 'control' | 'source' | 'groupVars' | 'interval' | 'halfLifeHours' | 'avgHours'>) => {
  const g = upgradeGroupVars(d);
  // 写死 6 小时的那版与按 hl 平滑的那版在默认半衰期下结果一样（旧结果只会是默认半衰期）
  const formula = d.formula.trim() === LEGACY_DRIFT_SPEED_FORMULA ? EMA_DRIFT_SPEED_FORMULA : d.formula.trim();
  const key: unknown[] = [formula, g.positive.trim(), g.control.trim(), d.source ?? 'campaigns'];
  // 默认周期 / 半衰期不进键：旧结果没有这两项
  if (intervalOf(d) !== DEFAULT_INTERVAL) key.push(intervalOf(d));
  if (halfLifeOf(d) !== DEFAULT_HALF_LIFE_HOURS) key.push(`hl=${halfLifeOf(d)}`);
  if (avgHoursOf(d) !== DEFAULT_AVG_HOURS) key.push(`avgh=${avgHoursOf(d)}`);
  return JSON.stringify(key);
};

// ===================== 公式 =====================

export interface CompiledFeature {
  program: Program;
  usesAmounts: boolean;
}

/** 公式里用到了哪些参数（界面上没用到的参数淡一点）；公式写错时返回 null。 */
export function formulaParamUse(formula: string): { hl: boolean; avgh: boolean } | null {
  try {
    const { inputs } = compileFeatureFormula(formula).program;
    return { hl: inputs.has('hl') || inputs.has('半衰期'), avgh: inputs.has('avgh') || inputs.has('平均时长') };
  } catch {
    return null;
  }
}

export function compileFeatureFormula(formula: string): CompiledFeature {
  const program = parseFormula(formula, new Set([...SERIES_VARIABLES.map(v => v.name), ...PARAM_NAMES]));
  return { program, usesAmounts: [...program.inputs].some(n => AMOUNT_VARIABLES.has(n)) };
}

/** 在观察窗上算一次：取最后一根的值；算不出来或成交额覆盖不足 → null。 */
export function computeFeatureValue(window: ObservationWindow | null, compiled: CompiledFeature, params: ParamDef = {}): number | null {
  return computeFeatureValues(window, compiled, params).value;
}

/**
 * 同上，另外带回公式里每个起了名的变量在最后一根的值（推断统计选因变量用）。
 * 【用户要求】2026-10-17「推断统计的时候，需要让我选择因变量…因变量要源自那个公式框中」。
 */
export function computeFeatureValues(
  window: ObservationWindow | null,
  compiled: CompiledFeature,
  params: ParamDef = {},
): { value: number | null; vars: Record<string, number | null> } {
  const { names } = programVariables(compiled.program);
  const none = () => ({ value: null, vars: Object.fromEntries(names.map(n => [n, null])) });
  if (!window) return none();
  const bars = window.bars;
  if (!bars.length) return none();
  // 这个周期的观察窗缺太多 K 线：不算（5m 观察窗在流水线里已按同一标准筛过）
  if (window.coverage < MIN_WINDOW_COVERAGE) return none();
  if (compiled.usesAmounts) {
    const withAmounts = bars.filter(b => b.quoteVolume != null && b.takerBuyQuoteVolume != null).length;
    if (withAmounts < MIN_AMOUNT_COVERAGE * bars.length) return none();
  }
  try {
    const out = evaluateOnBars(bars, compiled, params);
    return { value: lastValue(out.last), vars: Object.fromEntries(names.map(n => [n, lastValue(out.vars.get(n) ?? Number.NaN)])) };
  } catch {
    return none();
  }
}

/** 在一串 K 线上逐根算公式：带回最后一句与每个起了名的变量的整条序列（会抛 FormulaError）。 */
export function evaluateOnBars(bars: readonly ResearchBar[], compiled: CompiledFeature, params: ParamDef = {}) {
  const series = (f: (b: ResearchBar) => number | null | undefined) => Float64Array.from(bars, b => {
    const v = f(b);
    return v != null && Number.isFinite(v) ? v : Number.NaN;
  });
  const q = series(b => b.quoteVolume);
  const buy = series(b => b.takerBuyQuoteVolume);
  return evaluateProgramVars(compiled.program, {
    C: series(b => b.close), O: series(b => b.open), H: series(b => b.high), L: series(b => b.low),
    Q: q, B: buy, S: q.map((v, i) => v - buy[i]),
    hl: halfLifeOf(params), 半衰期: halfLifeOf(params), avgh: avgHoursOf(params), 平均时长: avgHoursOf(params),
  }, { barMinutes: intervalMs(intervalOf(params)) / 60_000 });
}

/** 公式里可选作因变量的变量：起了名的每一个；最后一句没起名时再加一个「结果」。写错时为空。 */
export function formulaVariables(formula: string): { names: string[]; result: string } {
  try {
    const { names, result } = programVariables(compileFeatureFormula(formula).program);
    return result ? { names, result } : { names: [...names, RESULT_VAR], result: RESULT_VAR };
  } catch {
    return { names: [RESULT_VAR], result: RESULT_VAR };
  }
}
/** 最后一句没起名时，它在推断统计里的名字。 */
export const RESULT_VAR = '结果';

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

