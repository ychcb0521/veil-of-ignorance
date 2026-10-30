import { SELLER_RETENTION_SPECS, retentionFormula, type SellerRetentionSpec } from '@/lib/sellerRetention';
import { ctbaFormula, CTBA_DESCRIPTION, CTBA_12H_DEFAULTS } from '@/lib/ctba';
import { CBA2_DEFINITION, CBA2_FORMULA } from '@/lib/cba2';
import { MBI2_Z0, MBI2_TOOLTIP, mbi2HoursOf, mbi2NOf, mbi2Z0Of, mbi2BandOf, mbi2ConfirmOf, validateMbi2Params, type Mbi2Params } from '@/lib/mbi2';
import { MBI_N, MBI_Z0, MBI_TOOLTIP, mbiNOf, mbiZ0Of, validateMbiParams, type MbiParams } from '@/lib/mbi';
import { appendResearchAverages } from '@/lib/researchAverageFormula';
export { MBI_N, MBI_Z0 };
/**
 * Deep dig 的特征值定义：名称、定义、公式、显示单位、分组标准——都可以由用户改，运行时照这里算。
 *
 * 【用户要求】2026-10-16「我希望每个特征值的这里都可以人为输入定义概念、公式、分组标准，然后运行的时候，
 * 就按照这里的公式提取因变量，按分组标准进行划分组别」。
 *   - 公式：在进场前观察窗内的已收盘 K 线（周期可选，默认 5m）上逐根算，取最后一根的值（见 formula.ts）。
 *   - 分组标准：实验组、对照组各一个条件，按每场战役的读数判断；同时满足 → 冲突，都不满足 → 其他战役。
 * 内置的「买方推力漂移速度 DSP·a」：默认公式用过去 avgh 小时（默认 24）的平均成交额；把 avg(Q, avgh) 换回 ema(Q, hl) 即与主图 DSP 的 V 逐根一致（单元测试核对）。默认分组标准与原 Deep RSA 分组一致。
 */
import type { ObservationWindow, ResearchBar } from '@/lib/deepRsa/window';
import { intervalMs, type ResearchInterval } from '@/lib/deepRsa/marketData';
import type { CampaignGroupRow } from '@/lib/deepRsa/report';
import { groupSignal, type DeepRsaGroup } from '@/lib/deepRsa/grouping';
import { CAMPAIGN_METRIC_LETTERS, type MetricLetter } from '@/lib/campaignMetricLetters';
import { US_STOCK_UNSUPPORTED } from '@/lib/signalMarket';
import type { TradeSignal } from '@/lib/signalLibrary';
import { evaluateProgram, evaluateProgramVars, programHistoryBars, FormulaError, lastValue, parseFormula, programVariables, type Program, type FormulaEvaluationCache } from '@/lib/deepDig/formula';

export interface DeepDigFeatureDef extends MbiParams, Mbi2Params {
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
  /** 卖方输出统一为负值的口径版本；旧账号定义读入时等价升级一次。 */
  sellerSignVersion?: 1;
  builtin?: boolean;
  /** 内置项被用户从目录删掉（隐藏，可恢复）。 */
  removed?: boolean;
  /** Visibility restoration revision; a later explicit hide retains this revision. */
  visibilityVersion?: number;
  createdAt?: number;
  /** Fixed chart semantics copied at creation; formulas and parameters never read the original feature. */
  chartTemplate?: string;
  /** The independent raw series, including seller-sensitive variants. */
  chartCore?: string;
  /** Independent closed-bar research/display window; computation additionally loads formula prehistory. */
  researchWindowHours?: number;
  retentionSourceId?: string;
  retentionPrefix?: string;
  retentionVersion?: 1;
}

/** Deep dig 目录与渔共用的账号定义键。 */
export const FEATURES_KEY = 'deep_dig_features_v1';
export const SELLER_FEATURE_CORES: Readonly<Record<string, string>> = { cdi2: 'CDI2', dss: 'DSS', 'seller-control': 'bc', cda: 'CDA', 'mbi-bear': 'MBI_bear', 'ctba-bear': 'CTBA_bear', 'mbi2-bear':'MBI2_bear', 'ctba_12h-bear':'CTBA_12H_bear', ...Object.fromEntries(SELLER_RETENTION_SPECS.map(s=>[s.id,s.core])) };
// Retired built-ins must not return as saved custom definitions. Historical results remain stored.
export const isRetiredFeature = (id: string) => id === 'drift-speed-down-z' || id === 'seller-push';
export const isSellerFeature = (id: string) => Object.prototype.hasOwnProperty.call(SELLER_FEATURE_CORES, id);
const SELLER_SIGN_MARK = '# seller-negative-v1';
export const BEAR_RESPONSE_MARK = '# seller-response-v2';

/** Flip the completed output arrays, never inputs or intermediate physics. */
export function sellerNegativeFormula(formula: string, core: string): string {
  if (formula.includes(SELLER_SIGN_MARK)) return formula;
  const program = compileFeatureFormula(formula).program;
  const last = program.statements.at(-1)!;
  const names = new Set(program.statements.flatMap(s => s.name && (s.name === core || new RegExp(`^avg_${core}(?:_\\d+)?$`).test(s.name)) ? [s.name] : []));
  let capture = '';
  let result = last.name;
  if (!result) {
    result = '_seller_result';
    while (program.statements.some(s => s.name === result) || program.inputs.has(result)) result += '_';
    const render = (n: Program['statements'][number]['expr']): string => n.k === 'num' ? String(n.v) : n.k === 'var' ? n.name
      : n.k === 'un' ? `(${n.op} ${render(n.a)})` : n.k === 'bin' ? `(${render(n.a)} ${n.op} ${render(n.b)})` : `${n.name}(${n.args.map(render).join(', ')})`;
    capture = `\n${result} = ${render(last.expr)}`;
  }
  names.delete(result);
  names.add(result); // Preserve the previous result, including an arbitrary named / anonymous tail.
  return `${formula}${capture}\n${SELLER_SIGN_MARK}\n# 卖方输出取负：中间量保持原样；原值和已定义的均值一并转换。\n${[...names].map(name => `${name} = -${name}`).join('\n')}`;
}

export function upgradeSellerSign<T extends { id: string; formula: string; sellerSignVersion?: 1 }>(def: T): T {
  if(SELLER_RETENTION_SPECS.some(s=>s.id===def.id)&&def.formula.includes('# seller-retention-v1'))return def.sellerSignVersion===1?def:{...def,sellerSignVersion:1};
  if (['mbi-bear','ctba-bear'].includes(def.id) && /\bseller_response\s*\(/.test(def.formula)) return def.sellerSignVersion === 1 ? def : { ...def, sellerSignVersion: 1 };
  if (!isSellerFeature(def.id) || def.sellerSignVersion === 1) return def;
  try { return { ...def, formula: sellerNegativeFormula(def.formula, SELLER_FEATURE_CORES[def.id]), sellerSignVersion: 1 }; }
  catch { return def; } // Keep invalid user formulas editable; do not replace them with a default.
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

export const featureTemplateId = (d: { id?: string; chartTemplate?: string }) => d.chartTemplate ?? d.id;
export const intervalOf = (d: Pick<DeepDigFeatureDef, 'interval' | 'chartTemplate'> & { id?: string }): ResearchInterval => ['cba-2', 'ctba'].includes(featureTemplateId(d) ?? '') ? '5m' : d.interval ?? DEFAULT_INTERVAL;
export const halfLifeOf = (d: Pick<DeepDigFeatureDef, 'halfLifeHours'>): number => (d.halfLifeHours != null && d.halfLifeHours > 0 ? d.halfLifeHours : DEFAULT_HALF_LIFE_HOURS);
export const avgHoursOf = (d: Pick<DeepDigFeatureDef, 'avgHours'>): number => (d.avgHours != null && d.avgHours > 0 ? d.avgHours : DEFAULT_AVG_HOURS);
type ParamDef = Pick<DeepDigFeatureDef, 'interval' | 'halfLifeHours' | 'avgHours' | 'MBI_N' | 'MBI_Z0' | 'chartTemplate' | 'researchWindowHours' | 'MBI2_T_HOURS' | 'MBI2_Z0' | 'MBI2_BAND' | 'MBI2_CONFIRM'> & { id?: string; formula?: string };
export const featureUsesMbi = (d: { id?: string; formula?: string }) => d.id === 'mbi' || /\bmbiz\s*\(/.test((d.formula ?? '').replace(/(#|\/\/).*$/gm, ''));
export const featureUsesMbi2 = (d:{id?:string;formula?:string}) => d.id==='mbi2'||/\bmbiz2\s*\(/.test((d.formula??'').replace(/(#|\/\/).*$/gm,''));
export const featureUsesMbiFamily = (d:{id?:string;formula?:string}) => featureUsesMbi(d)||featureUsesMbi2(d);
export function featureParams(d:ParamDef):Record<string,number> {
  const original={BAR_MINUTES:intervalMs(intervalOf(d))/60000,hl:halfLifeOf(d),半衰期:halfLifeOf(d),avgh:avgHoursOf(d),平均时长:avgHoursOf(d),MBI_N:mbiNOf(d),MBI_Z0:mbiZ0Of(d)};
  if(!featureUsesMbi2(d))return original;
  const minutes=intervalMs(intervalOf(d))/60000;
  return {...original,MBI2_T_HOURS:mbi2HoursOf(d,minutes),MBI2_N:mbi2NOf(d,minutes),MBI2_Z0:mbi2Z0Of(d),MBI2_BAND:mbi2BandOf(d),MBI2_CONFIRM:mbi2ConfirmOf(d)};
}

/**
 * 观察窗长度：进场前多长时间的 K 线。至少 48 小时（与原研究一致）；半衰期长时放到 8 个半衰期，让平滑「热起来」；
 * 平均时长长时放到「平均时长 + 4 个半衰期」（最后一段平滑用到的每根都有足够的过去可平均）；周期粗时至少 50 根。
 * 默认（5m、半衰期 6 小时、平均 24 小时）正好 48 小时。
 */
export function featureWindowMs(d: ParamDef): number {
  const H = 3_600_000;
  let formulaHistory = 0;
  let mbiWarmupMs = 0;
  if (d.formula) {
    try {
      const barMs = intervalMs(intervalOf(d));
      const params = featureParams(d);
      const program = compileFeatureFormula(d.formula).program;
      formulaHistory = (programHistoryBars(program, params, barMs / 60_000) + 2) * barMs;
      if (featureUsesMbi(d)) mbiWarmupMs = programHistoryBars(program, params, barMs / 60_000, true) * barMs;
    } catch { /* 编辑中的不完整公式由公式校验提示 */ }
  }
  if(featureUsesMbi2(d)) {
    const originalWindow=48*H+5*mbi2NOf(d,intervalMs(intervalOf(d))/60000)*intervalMs(intervalOf(d));
    return d.formula?.includes('# seller-retention-v1') ? Math.max(formulaHistory,originalWindow) : originalWindow;
  }
  const window = Math.max(featureTemplateId(d) === 'cba-2' ? (48 + avgHoursOf(d) + 1) * H : 0, 48 * H, 8 * halfLifeOf(d) * H, (avgHoursOf(d) + 4 * halfLifeOf(d)) * H, 50 * intervalMs(intervalOf(d)));
  if(featureTemplateId(d)==='ctba') return (d.researchWindowHours ?? 48)*H+formulaHistory;
  return Math.max(formulaHistory, featureUsesMbi(d) ? 48 * H + Math.max(mbiWarmupMs, 5 * mbiNOf(d) * intervalMs(intervalOf(d))) : window);
}
/** 「6 小时 = 72 根 5 分钟 K 线」这种换算，界面上用。 */
export const barsPerHalfLife = (d: ParamDef) => (halfLifeOf(d) * 3_600_000) / intervalMs(intervalOf(d));
export const barsPerAvg = (d: ParamDef) => Math.max(1, Math.round((avgHoursOf(d) * 3_600_000) / intervalMs(intervalOf(d))));

/** 公式里可用的参数（一个数）：上面点选 / 填写的值。 */
export const PARAM_VARIABLES: readonly { name: string; alias: string; label: string }[] = [
  {name:'BAR_MINUTES',alias:'BAR_MINUTES',label:'当前计算周期的分钟数（自动读取，不手填）'},
  { name: 'hl', alias: '半衰期', label: '半衰期（小时，上面选的；也可写「半衰期」）' },
  { name: 'avgh', alias: '平均时长', label: '平均时长（小时，上面选的；也可写「平均时长」），配 avg(x, avgh) 用' },
  { name:'MBI2_N',alias:'MBI2_N',label:'MBI2 按小时和周期派生的根数（不手填）' },
  { name:'MBI2_T_HOURS',alias:'MBI2_T_HOURS',label:'MBI2 日历时长（小时）' },
  { name:'MBI2_BAND',alias:'MBI2_BAND',label:'MBI2 缓冲带半宽（默认0.2）' },
  { name:'MBI2_CONFIRM',alias:'MBI2_CONFIRM',label:'MBI2 确认阈值（默认0.8）' },
  { name: 'MBI2_Z0', alias: 'MBI2_Z0', label: 'MBI2 独立饱和尺度' },
  { name: 'MBI_N', alias: 'MBI_N', label: `MBI 衰减周期（K 线根数，默认 ${MBI_N}；α 严格等于 1/n）` },
  { name: 'MBI_Z0', alias: 'MBI_Z0', label: `MBI 饱和尺度（默认 ${MBI_Z0}）` },
];
const PARAM_NAMES = PARAM_VARIABLES.flatMap(p => [p.name, p.alias]);

/** 公式里可用的序列：每根 K 线（上面选的周期）一个值。 */
export const SERIES_VARIABLES: readonly { name: string; label: string }[] = [
  { name: 'T', label: 'K线开盘时间（毫秒）' },
  { name: 'C', label: '收盘价' },
  { name: 'O', label: '开盘价' },
  { name: 'H', label: '最高价' },
  { name: 'L', label: '最低价' },
  { name: 'Q', label: '成交额（USDT）= B + S' },
  { name: 'B', label: '主动买入成交额（USDT）' },
  { name: 'S', label: '主动卖出成交额（USDT）= Q − B' },
  { name: 'E', label: '成交均价 VWAP = 成交额 ÷ 成交量' },
  { name: 'CB', label: '同时段 BTCUSDT 收盘价（用到时另取；取不到为空）' },
];
const AMOUNT_VARIABLES = new Set(['Q', 'B', 'S', 'E']);
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
  visibilityVersion: 1,
  name: '买方推力漂移速度 DSP·a',
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
 * 买方推力漂移速度 DSP·az（Z 分数版）：Deep dig 第三个内置特征值；K 线图「动态谢林点」打开「Z」开关时 a 副图画的就是它
 * （主图用的「平时成交额」是 ema(Q, hl)，把下面 f 一行换成 ema(Q, hl) 就与主图逐根一致，单元测试核对）。
 * 【用户要求】2026-10-18「把 DSP 也做成可以基于 Z 分数的，具体哪一步需要标准化处理，你来定」：只把涨跌 R 除以它自己的标准差——
 * f 本来就是和自己的平均成交额比、A 本来就在 −1 ~ 1，只有 R 带着各个币自己的波动大小；不减均值（减掉会把趋势本身减掉）。
 */
export const DRIFT_SPEED_Z_FORMULA = [
  '# 波动率归一化：R / sd(R)，未减均值；再加权和平滑后的 az 不是标准 Z 分数，0 为净推力方向分界',
  '# B / S = 主动买入 / 卖出成交金额（USDT），Q = B + S；hl = 半衰期，avgh = 平均时长（小时，都在下面选）',
  'N = abs(B - S)                 # 主动净资金',
  'f = ln(1 + N / avg(Q, avgh))   # 资金力量：净资金比过去 avgh 小时的平均成交额异常多少',
  'A = (B - S) / Q                # 主动买方优势',
  'G = 1 + max(A, 0)              # 买方优势权重',
  'R = ln(C / prev(C))            # 价格变化',
  'Rz = R / sd(R, avgh)           # 波动率缩放的价格变化：未减均值，不是标准 Z 分数',
  'F = nz(f * G * Rz)             # 单根推力（标准差单位；缺数据的那根记 0）',
  'az = ema(F, hl, 0)             # 波动率归一化推力：按半衰期 hl 指数平滑',
].join('\n');

export const DRIFT_SPEED_Z_DEF: DeepDigFeatureDef = {
  id: 'drift-speed-z',
  name: '买方推力漂移速度 DSP·az（波动率归一化）',
  short: 'az',
  definition: '原始 az = EMA(f × G × R / sd(R))，图上读数为 100 × az。仅按波动率缩放涨跌，不减均值；最终指标未标准化、方差不保证为 1。0 是净推力方向分界，15 仅对应未乘显示倍数前的 0.15，不是理论强弱门槛或 15 个标准差。',
  formula: DRIFT_SPEED_Z_FORMULA,
  scale: 100,
  unit: '归一化×100',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

/**
 * CBA 买方定价优势指数（Deep dig 第三个特征值；K 线图指标里同名副图用 src/lib/cba.ts 的 computeCba，单元测试核对逐根一致）。
 * 【用户要求】2026-10-18「新增一个指标 CBA…放在指标中、以及 deep dig 的第三个特征值」。η、α 写在公式里可改；
 * hl = 时间权重半衰期，avgh = 常态成交额 V̄ 与波动率 σ 的回看时长（都「截至上一根」）。
 */
export const CBA_FORMULA = [
  '# CBA 买方定价优势指数（−100 ~ 100）= 100·tanh(Σ w·F·G·R)；正 = 向上的价格优势仍被保留，负 = 价格结果不支持买方优势；不是胜率',
  '# B / S = 主动买入 / 卖出成交额，Q = B + S，E = 成交均价（VWAP）；hl = 时间权重半衰期，avgh = 常态成交额与波动率的回看时长（小时，都在下面选）',
  'eta = 0.5                                     # η：双向活跃成交的保留权重（0 < η ≤ 1）',
  'alpha = 1                                     # α：主动买入优势的额外加权系数（≥ 0）',
  'D = B - S                                     # 主动成交净差额（不是市场净资金流入）',
  'A = D / Q                                     # 主动买卖失衡，−1 ~ 1',
  'Vbar = prev(avg(Q, avgh))                     # 截至上一根的常态成交额：过去 avgh 小时平均',
  'F = ln(1 + (abs(D) + eta * (Q - abs(D))) / Vbar)  # 成交支持',
  'G = 1 + alpha * max(A, 0)                     # 主动买入加权',
  'P = min(E, C)                                 # 当前价：成交均价与收盘价取低',
  'sig = prev(sd(ln(E / prev(E)), avgh))         # 截至上一根：成交均价对数收益率的波动率 σ',
  'CBA = 100 * tanh(retain(F * G, P, prev(E), hl, 48) / sig)  # 48 小时窗口、时间权重 w、保留上移速度 R = ln(P ÷ Eᵢ₋₁) ÷ ((t − i + 1)·σ)',
].join('\n');

export const CBA_DEF: DeepDigFeatureDef = {
  id: 'cba',
  name: '买方定价优势指数 CBA',
  short: 'CBA',
  definition: '进场前最后一根 K 线上的买方定价优势（−100 ~ 100）：过去 48 小时每根 K 线的成交支持 × 主动买入加权 × 保留上移速度，按时间权重加总后 100·tanh 压缩。正值 = 向上的价格优势仍被保留；负值 = 价格结果不支持买方优势。不是胜率。',
  formula: CBA_FORMULA,
  scale: 1,
  unit: '',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

/**
 * CBI 买方优势指数（Deep dig 第五个特征值；K 线图指标里同名副图用 src/lib/cbi.ts 的 computeCbi，单元测试核对逐根一致）。
 * 【用户要求】2026-10-18「新增一个指标 CBI…放在指标中、以及 deep dig 的第五个特征值」。h、N、m、κ、k 写在公式里可改；
 * avgh = 基线期（V̄、各分量的中位数 / MAD、λ₀ 都「截至上一根、过去 avgh 小时」）。
 */
export const CBI_FORMULA = [
  '# CBI 买方优势指数（−1 ~ 1）= P × D；> 0 买方占优。D = 方向（四个分量加权），P = 参与度（可信度）',
  '# V = 成交额 Q，Vᵇ / Vˢ = 主动买入 / 卖出成交额 B / S；avgh = 基线期（小时，下面选；原文 V̄ 是同时段 20 天中位数，拿不到，改用过去 avgh 小时）',
  'h = 12                                          # 时间衰减半衰期（根）：w = 2^(−(t − i) ÷ h)',
  'N = 48                                          # 求和窗口：最近 N 根',
  'm = 12                                          # 均价斜率回看根数',
  'kappa = 1                                       # κ：吸收斜率的收缩强度',
  'k = 2                                           # 参与度敏感度',
  'ATR = atr(H, L, C, 14)                          # 平均真实波幅（14 根）',
  'Vbar = prev(median(Q, avgh))                    # 基线成交额：截至上一根、过去 avgh 小时的中位数',
  'x = (B - S) / Vbar                              # 主动净流量',
  'r = (C - prev(C)) / ATR                         # 单根收益（以 ATR 计）',
  'F = wsum(B - S, h, N) / wsum(Q, h, N)           # F 主动性',
  'lam0 = rsum(r * sign(x), avgh) / rsum(abs(x), avgh)   # λ₀：基线对称冲击',
  'lp = (wsum(if(x > 0, r, 0), h, N) + kappa * lam0) / (wsum(if(x > 0, x, 0), h, N) + kappa)   # λ⁺：买一侧的价格冲击斜率',
  'lm = (wsum(if(x < 0, r, 0), h, N) - kappa * lam0) / (wsum(if(x < 0, x, 0), h, N) - kappa)   # λ⁻：卖一侧的价格冲击斜率',
  'A = (lp - lm) / (abs(lp) + abs(lm))             # A 吸收',
  'CLV = if(H > L, (2 * C - H - L) / (H - L), 0)   # 收盘在 K 线区间里的位置（−1 ~ 1）',
  'K = wsum(Q * CLV, h, N) / wsum(Q, h, N)         # K 收盘控制',
  'M = wsum(Q * ((H + L + C) / 3), h, N) / wsum(Q, h, N)   # 窗口成交额加权均价（平均成本）',
  'd = (C - M) / ATR                               # 价格相对均价的偏离',
  'v = (M - prev(M, m)) / (m * ATR)                # 均价漂移速度（ATR / 根）',
  'uF = tanh((F - prev(median(F, avgh))) / prev(rscale(F, avgh)) / 2)   # 稳健 z 压到 −1 ~ 1：z = (X − 中性点) ÷ rscale，rscale = 1.4826·MAD（MAD = 0 时 1.2533·平均绝对偏差）；F 的中性点 = 基线中位数',
  'uA = tanh(A / prev(rscale(A, avgh)) / 2)',
  'uK = tanh(K / prev(rscale(K, avgh)) / 2)',
  'uS = (tanh(d / prev(rscale(d, avgh)) / 2) + tanh(v / prev(rscale(v, avgh)) / 2)) / 2   # S 结构',
  'D = (0.30 * uF + 0.30 * uA + 0.15 * uK + 0.25 * uS) / (0.30 + 0.30 + 0.15 + 0.25)   # 方向',
  'RV = wsum(Q, h, N) / wsum(Vbar, h, N)           # 相对成交量',
  'P = RV ^ k / (1 + RV ^ k)                       # 参与度（可信度）',
  'CBI = P * D',
].join('\n');

export const CBI_DEF: DeepDigFeatureDef = {
  id: 'cbi',
  name: '买方优势指数 CBI',
  short: 'CBI',
  definition: '进场前最后一根 K 线上的买方优势（−1 ~ 1）= 参与度 P × 方向 D：D 由主动性 F、吸收 A、收盘控制 K、结构 S 四个分量（稳健 z 压到 −1 ~ 1）按 0.30 / 0.30 / 0.15 / 0.25 加权；P = RV² ÷ (1 + RV²)。> 0 买方占优。',
  formula: CBI_FORMULA,
  scale: 1,
  unit: '',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

export const CBA2_DEF: DeepDigFeatureDef = { id: 'cba-2', name: '成交支持下的价格重心迁移指标 CBA-2', short: 'CBA-2', definition: CBA2_DEFINITION, formula: CBA2_FORMULA, scale: 1, unit: '', positive: DEFAULT_POSITIVE, control: DEFAULT_CONTROL, source: 'campaigns', groupVars: 2, builtin: true };

/**
 * CBI-2 买方优势指数第 2 版（Deep dig 内置特征值；K 线图同名副图用 src/lib/cbi2.ts，直接算这同一份公式）。
 * 【用户要求】2026-10-18「新增一个指标 CBI-2…放在指标中、以及 deep dig 的第七个特征值」。窗口、半衰期、系数按笔记的默认值写在公式里，可改；
 * avgh = 基线期：原文 V̄ 取 20 天同时段中位数、MAD / λ₀ / s_e / ATR̄ 取 14 天、φ 取 1 天——拿不到这么长的 5 分钟 K 线，V̄ / MAD / λ₀ / s_e / ATR̄ 改用过去 avgh 小时，
 * φ 用过去 24 小时（= 原文 1 天）。CB = 同时段 BTCUSDT 收盘价（流水线另取）；取不到时不剔除 BTC。
 * 交易规则（进场 / 持有 / 减仓 / 离场 / 暂停）与 EV = p·W̄ − (1 − p) 要用到赢时平均收益 W̄ 与交易成本 c，不在特征值里。
 */
export const CBI2_FORMULA = [
  '# CBI-2 买方优势指数第 2 版（−1 ~ 1）= 2p − 1；0 = 五五开，0.1 ≈ 55:45。p = (1 − Ψ)·σ(L₁) + Ψ·σ(L₂)，σ = logistic',
  '# V = 成交额 Q，Vᵇ / Vˢ = B / S，CB = 同时段 BTCUSDT 收盘价；avgh = 基线期（小时，下面选；原文 20 天 / 14 天拿不到，改用过去 avgh 小时）',
  'k = 2                                            # 参与度敏感度',
  'kappa = 0.5                                      # κ：吸收斜率的收缩强度',
  'm = 6                                            # 动量 / 均价斜率回看根数',
  'ATR = atr(H, L, C, 14)                           # 平均真实波幅（14 根）',
  'ATRb = prev(median(ATR, avgh))                   # ATR̄：基线期 ATR 中位数',
  'Vbar = prev(median(Q, avgh))                     # V̄：基线成交额（中位数）',
  'x = (B - S) / Vbar                               # 主动净流量（除以基线量）',
  'r = (C - prev(C)) / ATRb                         # 单根收益（除以 ATR̄）',
  'rho = ln(C / prev(C))                            # 对数收益 ρ',
  'rb = ln(CB / prev(CB))                           # BTC 的对数收益',
  'F = wsum(B - S, 3, 12) / wsum(Q, 3, 12)          # F 主动买卖失衡（12 根，半衰期 3）',
  'dF = wsum(B - S, 2, 6) / wsum(Q, 2, 6) - wsum(B - S, 6, 24) / wsum(Q, 6, 24)   # ΔF = F₆ − F₂₄：买盘增减',
  'lam0 = rsum(r * sign(x), avgh) / rsum(abs(x), avgh)   # λ₀：基线期的对称冲击',
  'lp = (wsum(if(x > 0, r, 0), 6, 24) + kappa * lam0) / (wsum(if(x > 0, x, 0), 6, 24) + kappa)   # λ⁺（24 根，半衰期 6）',
  'lm = (wsum(if(x < 0, r, 0), 6, 24) - kappa * lam0) / (wsum(if(x < 0, x, 0), 6, 24) - kappa)   # λ⁻',
  'A = (lp - lm) / (abs(lp) + abs(lm))              # A 吸收',
  'lpf = (wsum(if(x > 0, r, 0), 3, 12) + kappa * lam0) / (wsum(if(x > 0, x, 0), 3, 12) + kappa)  # 快速版 λ⁺（12 根，半衰期 3）',
  'lmf = (wsum(if(x < 0, r, 0), 3, 12) - kappa * lam0) / (wsum(if(x < 0, x, 0), 3, 12) - kappa)  # 快速版 λ⁻',
  'Af = (lpf - lmf) / (abs(lpf) + abs(lmf))         # A_f 吸收快速版',
  'e = r - (lp * max(x, 0) + lm * min(x, 0))        # 成交解释不了的价格变化',
  'U = e / prev(sd(e, avgh))                        # U 意外度：除以基线标准差 s_e',
  'phi = prev(beta(rho, rb, 24))                    # φ：对 BTC 的回归斜率（过去 1 天）',
  'Mo = msum(rho - nz(phi * rb), m) / (ATR / C * sqrt(m))   # Mo 剔除 BTC 后的短期动量（BTC 读数缺失时不剔除）',
  'M = wsum(Q * ((H + L + C) / 3), 6, 24) / wsum(Q, 6, 24)  # 成交额加权均价（24 根，半衰期 6）',
  'd = (C - M) / ATR                                # 价格相对均价的偏离',
  'v = (M - prev(M, m)) / (m * ATR)                 # 均价漂移速度（ATR / 根）',
  'Hh = highest(H, 12)                              # 最近 12 根最高价',
  'Ll = lowest(L, 12)                               # 最近 12 根最低价',
  'K = if(Hh > Ll, (2 * C - Hh - Ll) / (Hh - Ll), 0)   # K 最近 1 小时的收盘位置（−1 ~ 1）',
  'S6 = msum(S, 6)                                  # 最近 6 根主动卖出之和',
  'Ex = ln(highest(S6, 43) / S6)                    # Ex 卖盘衰竭度：48 根内任意连续 6 根的最大值 ÷ 最近 6 根',
  'DD = (highest(C, 48) - C) / ATR                  # 距 48 根最高收盘的回撤（ATR）',
  'RV = msum(Q, 12) / msum(Vbar, 12)                # 相对成交量（12 根）',
  'RV24 = msum(Q, 24) / msum(Vbar, 24)              # 相对成交量（24 根）',
  'g = 2 * RV ^ k / (1 + RV ^ k)                    # 参与度放大系数（量能正常 = 1）',
  'Psi = 1 / (1 + exp(-4 * (ln(RV24) - ln(2.5)))) / (1 + exp(-2 * (DD - 3)))   # Ψ 恐慌度 = σ(4·(ln RV₂₄ − ln 2.5))·σ(2·(DD − 3))',
  'zF = clip((F - prev(median(F, avgh))) / prev(rscale(F, avgh)), -3, 3)   # 稳健 z 截断到 ±3：(X − 中性点) ÷ (1.4826·MAD)；F 的中性点 = 基线中位数',
  'zdF = clip(dF / prev(rscale(dF, avgh)), -3, 3)',
  'zA = clip(A / prev(rscale(A, avgh)), -3, 3)',
  'zMo = clip(Mo / prev(rscale(Mo, avgh)), -3, 3)',
  'zd = clip(d / prev(rscale(d, avgh)), -3, 3)',
  'zv = clip(v / prev(rscale(v, avgh)), -3, 3)',
  'zK = clip(K / prev(rscale(K, avgh)), -3, 3)',
  'zU = clip(U / prev(rscale(U, avgh)), -3, 3)',
  'zAf = clip(Af / prev(rscale(Af, avgh)), -3, 3)',
  'zEx = clip(Ex / prev(rscale(Ex, avgh)), -3, 3)',
  'L1 = 0 + g * (0.07 * zF + 0.04 * zdF + 0.07 * zA + 0.07 * zMo + 0.04 * zd + 0.04 * zv + 0.02 * zK) + 0.2 * min(zU, 0)   # L₁ 顺势分支（对数几率）',
  'L2 = -0.5 + 0.35 * zAf + 0.25 * zEx              # L₂ 吸收分支（对数几率）',
  'p = (1 - Psi) / (1 + exp(-L1)) + Psi / (1 + exp(-L2))   # 上涨（交易成功）的概率',
  'CBI2 = 2 * p - 1',
].join('\n');

export const CBI2_DEF: DeepDigFeatureDef = {
  id: 'cbi2',
  name: '买方优势指数 CBI-2',
  short: 'CBI-2',
  definition: '进场前最后一根 K 线上的买方优势第 2 版（−1 ~ 1）= 2p − 1：p 是上涨的概率，由顺势分支 L₁（主动性、买盘增减、吸收、剔除 BTC 的动量、均价偏离与漂移、收盘位置、意外度）与吸收分支 L₂（快速吸收、卖盘衰竭）按恐慌度 Ψ 混合。0 = 五五开，0.1 ≈ 55:45。',
  formula: CBI2_FORMULA,
  scale: 1,
  unit: '',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

export const MBI_FORMULA = appendResearchAverages([
  '# MBI 只看已收盘价格；参数 MBI_N、MBI_Z0 在下方设置。',
  '# x = ln(C)；α = 1/MBI_N；κ = 1/√(α·(2−α))。',
  '# M、S 从序列首根递推；S 初值为前 n 个对数涨跌平方的平均。',
  '# z 使用更新前的 M、S；前 5n 根为空，不参与均值、平滑或评估。',
  'z = mbiz(C, MBI_N)',
  'MBI = tanh(z / MBI_Z0)',
].join('\n'), new Set(['z', 'MBI']), { core: 'MBI', avg: 'avg_MBI', avg2: 'avg_MBI_2' }) + '\nMBI = MBI';

export const MBI_DEF: DeepDigFeatureDef = {
  id: 'mbi', name: 'MBI 迈克尔买方优势', short: 'MBI', definition: MBI_TOOLTIP,
  formula: MBI_FORMULA, MBI_N, MBI_Z0, scale: 1, unit: '',
  positive: DEFAULT_POSITIVE, control: DEFAULT_CONTROL, source: 'campaigns', groupVars: 2, builtin: true,
};

const mbi2Copy=copyFeatureDefinition(MBI_DEF,[MBI_DEF],Date.UTC(2026,9,29,14));
const {MBI_N:_oldN,MBI_Z0:_oldZ,...mbi2Own}=mbi2Copy;
export const MBI2_FORMULA = appendResearchAverages([
  '# MBI2 独立副本；MBI2_N由日历小时派生，前5n根为空；z0固定1.25。',
  'MBI2_z = mbiz2(C, MBI2_N)',
  'MBI2 = tanh(MBI2_z / MBI2_Z0)',
].join('\n'),new Set(['MBI2_z','MBI2']),{core:'MBI2',avg:'avg_MBI2',avg2:'avg_MBI2_2'})+[
  '',
  'MBI2_state = mbi2state(MBI2,T,MBI2_BAND,MBI2_CONFIRM,0)',
  'MBI2_lead_h = mbi2state(MBI2,T,MBI2_BAND,MBI2_CONFIRM,1)',
  'MBI2_confirm_h = mbi2state(MBI2,T,MBI2_BAND,MBI2_CONFIRM,2)',
  'MBI2 = MBI2',
].join('\n');
export const MBI2_DEF:DeepDigFeatureDef={...mbi2Own,id:'mbi2',name:'MBI2 迈克尔买方优势（可调版）',short:'MBI2',builtin:true,chartTemplate:'mbi2',chartCore:'MBI2',
  formula:MBI2_FORMULA,MBI2_Z0,MBI2_BAND:.2,MBI2_CONFIRM:.8,researchWindowHours:48,
  definition:MBI2_TOOLTIP+' 未手动设小时数时，每个周期默认n=25；手动设定后固定日历时长。状态为买方确认/买方试探/均衡/卖方试探/卖方确认。持续小时以当前方向及本段确认为起点，起始根为0，最多48小时。扫描仅展示，不自动调整默认参数。'};

/** CBI-2 的卖方镜像：买卖互换、方向反转、恐慌回撤改为亢奋上冲；保留原窗口与系数。 */
export const CDI2_FORMULA = sellerNegativeFormula([
  '# CDI2 买方失控程度（−1 ~ 1）：越低（越负）表示卖方优势越强、买方控制越弱；p 为模型映射分数，未经胜率校准',
  '# B / S = 主动买入 / 卖出成交额，CB = 同时段 BTC 收盘价；窗口、系数与 CBI-2 相同，方向对称转换',
  'k = 2                                            # 参与度敏感度',
  'kappa = 0.5                                      # κ：吸收斜率的收缩强度',
  'm = 6                                            # 动量 / 均价斜率回看根数',
  'ATR = atr(H, L, C, 14)                           # 平均真实波幅（14 根）',
  'ATRb = prev(median(ATR, avgh))                   # ATR̄：基线期 ATR 中位数',
  'Vbar = prev(median(Q, avgh))                     # V̄：基线成交额（中位数）',
  'x = (S - B) / Vbar                               # 主动卖出净差额（除以基线量）',
  'r = (prev(C) - C) / ATRb                         # 向下价格变化（除以 ATR̄）',
  'rho = -ln(C / prev(C))                            # 向下对数收益 ρ',
  'rb = -ln(CB / prev(CB))                           # BTC 的向下对数收益',
  'F = wsum(S - B, 3, 12) / wsum(Q, 3, 12)          # F 主动卖买失衡（12 根，半衰期 3）',
  'dF = wsum(S - B, 2, 6) / wsum(Q, 2, 6) - wsum(S - B, 6, 24) / wsum(Q, 6, 24)   # ΔF = F₆ − F₂₄：卖盘增减',
  'lam0 = rsum(r * sign(x), avgh) / rsum(abs(x), avgh)   # λ₀：基线期的对称冲击',
  'lp = (wsum(if(x > 0, r, 0), 6, 24) + kappa * lam0) / (wsum(if(x > 0, x, 0), 6, 24) + kappa)   # λ⁺（24 根，半衰期 6）',
  'lm = (wsum(if(x < 0, r, 0), 6, 24) - kappa * lam0) / (wsum(if(x < 0, x, 0), 6, 24) - kappa)   # λ⁻',
  'A = (lp - lm) / (abs(lp) + abs(lm))              # A 卖方吸收',
  'lpf = (wsum(if(x > 0, r, 0), 3, 12) + kappa * lam0) / (wsum(if(x > 0, x, 0), 3, 12) + kappa)  # 快速版 λ⁺（12 根，半衰期 3）',
  'lmf = (wsum(if(x < 0, r, 0), 3, 12) - kappa * lam0) / (wsum(if(x < 0, x, 0), 3, 12) - kappa)  # 快速版 λ⁻',
  'Af = (lpf - lmf) / (abs(lpf) + abs(lmf))         # A_f 卖方吸收快速版',
  'e = r - (lp * max(x, 0) + lm * min(x, 0))        # 成交解释不了的向下价格变化（负值为意外上涨，惩罚卖方判断）',
  'U = e / prev(sd(e, avgh))                        # U 意外度：除以基线标准差 s_e',
  'phi = prev(beta(rho, rb, 24))                    # φ：对 BTC 的回归斜率（过去 1 天）',
  'Mo = msum(rho - nz(phi * rb), m) / (ATR / C * sqrt(m))   # Mo 剔除 BTC 后的向下短期动量（BTC 读数缺失时不剔除）',
  'M = wsum(Q * ((H + L + C) / 3), 6, 24) / wsum(Q, 6, 24)  # 成交额加权均价（24 根，半衰期 6）',
  'd = (M - C) / ATR                                # 均价相对价格的向下偏离',
  'v = (prev(M, m) - M) / (m * ATR)                 # 均价向下漂移速度（ATR / 根）',
  'Hh = highest(H, 12)                              # 最近 12 根最高价',
  'Ll = lowest(L, 12)                               # 最近 12 根最低价',
  'K = if(Hh > Ll, (Hh + Ll - 2 * C) / (Hh - Ll), 0)   # K 最近 12 根的向下收盘位置（−1 ~ 1）',
  'B6 = msum(B, 6)                                  # 最近 6 根主动买入之和',
  'Ex = ln(highest(B6, 43) / B6)                    # Ex 买盘衰竭度：48 根内任意连续 6 根的最大值 ÷ 最近 6 根',
  'DU = (C - lowest(C, 48)) / ATR                  # 距 48 根最低收盘的上冲（ATR）',
  'RV = msum(Q, 12) / msum(Vbar, 12)                # 相对成交量（12 根）',
  'RV24 = msum(Q, 24) / msum(Vbar, 24)              # 相对成交量（24 根）',
  'g = 2 * RV ^ k / (1 + RV ^ k)                    # 参与度放大系数（量能正常 = 1）',
  'Psi = 1 / (1 + exp(-4 * (ln(RV24) - ln(2.5)))) / (1 + exp(-2 * (DU - 3)))   # Ψ 亢奋度 = σ(4·(ln RV₂₄ − ln 2.5))·σ(2·(DU − 3))',
  'zF = clip((F - prev(median(F, avgh))) / prev(rscale(F, avgh)), -3, 3)   # 稳健 z 截断到 ±3：(X − 中性点) ÷ (1.4826·MAD)；F 的中性点 = 基线中位数',
  'zdF = clip(dF / prev(rscale(dF, avgh)), -3, 3)',
  'zA = clip(A / prev(rscale(A, avgh)), -3, 3)',
  'zMo = clip(Mo / prev(rscale(Mo, avgh)), -3, 3)',
  'zd = clip(d / prev(rscale(d, avgh)), -3, 3)',
  'zv = clip(v / prev(rscale(v, avgh)), -3, 3)',
  'zK = clip(K / prev(rscale(K, avgh)), -3, 3)',
  'zU = clip(U / prev(rscale(U, avgh)), -3, 3)',
  'zAf = clip(Af / prev(rscale(Af, avgh)), -3, 3)',
  'zEx = clip(Ex / prev(rscale(Ex, avgh)), -3, 3)',
  'L1 = 0 + g * (0.07 * zF + 0.04 * zdF + 0.07 * zA + 0.07 * zMo + 0.04 * zd + 0.04 * zv + 0.02 * zK) + 0.2 * min(zU, 0)   # L₁ 卖方顺势分支（对数几率）',
  'L2 = -0.5 + 0.35 * zAf + 0.25 * zEx              # L₂ 卖方吸收分支（对数几率）',
  'p = (1 - Psi) / (1 + exp(-L1)) + Psi / (1 + exp(-L2))   # 卖方优势的模型映射分数（非实测胜率）',
  'CDI2 = 2 * p - 1',
].join('\n'), 'CDI2');

export const CDI2_DEF: DeepDigFeatureDef = {
  id: 'cdi2',
  name: '买方失控程度',
  short: 'CDI2',
  definition: '买方失控程度（−1 ~ 1）：越低（越负）表示优势越向卖方转移、卖方优势越强、买方控制越弱。沿用 CBI-2 的窗口与权重，改看主动卖盘、卖盘增减、卖方吸收、剔除 BTC 后的向下动量、均价下移与低位收盘；放量上冲时侧重买盘衰竭与快速卖方吸收。p 是模型映射分数，未经真实下跌概率或胜率校准。',
  sellerSignVersion: 1,
  formula: CDI2_FORMULA,
  scale: 1,
  unit: '',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

/**
 * 多空状态 S（0–1）：0 = 卖方完全占优，0.5 = 均衡，1 = 买方完全占优。
 * 【用户要求】2026-10-22「在 Deep dig 里新加一个状态 0–1 特征值」（承接 1–7 状态的分析：要对称、有界、0.5 = 平衡、滞后小）。
 * 三部分都改成买卖对称再相加，最后 logistic 压到 0–1：
 *   1. CBI-2 的买方分数 p 与同一套算法的卖方分数 ps（与 CDI2 逐根一致），取对数几率之差的一半，按 sh 小时半衰期平滑；
 *   2. 推力 az：同 DSP·az，但买方优势权重改成买卖双方都加权（1 + |A|）；
 *   3. 定价保留：同 CBA，买方用较低价、卖方用较高价各算一次再平均（原 CBA 只衡量买方）。
 * 不平均 2p − 1 而平均对数几率：平均有界值会把极端往中间压。
 */
export const STATE_FORMULA = [
  '# 多空状态 S（0 ~ 1）：0 = 卖方完全占优，0.5 = 均衡，1 = 买方完全占优；三部分都买卖对称，相加后 logistic 压到 0 ~ 1',
  '# B / S = 主动买入 / 卖出成交额，Q = B + S，E = 成交均价，CB = 同时段 BTC 收盘价；hl = 半衰期，avgh = 基线时长（小时，下面选）',
  'wc = 3                                           # CBI-2 买卖对称分的权重（它本身读数偏小，0.04 ≈ 52:48）',
  'wa = 0.4                                         # 推力 az 的权重',
  'wb = 1                                           # 定价保留的权重',
  'sh = 4                                           # CBI-2 部分的平滑半衰期（小时）',
  'ka = 10                                          # az 每 0.1 记 1 个对数几率单位',
  '# —— 1. CBI-2：买方分数 p（与 CBI-2 公式相同）',
  ...CBI2_FORMULA.split('\n').slice(2),
  '# —— 卖方分数 ps（与 CDI2 相同：方向项取反，吸收分支改看买盘衰竭与上冲）',
  'dir = 0.07 * zF + 0.04 * zdF + 0.07 * zA + 0.07 * zMo + 0.04 * zd + 0.04 * zv + 0.02 * zK   # CBI-2 的方向合计',
  'B6 = msum(B, 6)                                  # 最近 6 根主动买入之和',
  'ExS = ln(highest(B6, 43) / B6)                   # 买盘衰竭度',
  'DU = (C - lowest(C, 48)) / ATR                   # 距 48 根最低收盘的上冲（ATR）',
  'PsiS = 1 / (1 + exp(-4 * (ln(RV24) - ln(2.5)))) / (1 + exp(-2 * (DU - 3)))   # 亢奋度',
  'zExS = clip(ExS / prev(rscale(ExS, avgh)), -3, 3)',
  'L1s = -g * dir + 0.2 * min(-zU, 0)               # 卖方顺势分支',
  'L2s = -0.5 - 0.35 * zAf + 0.25 * zExS            # 卖方吸收分支',
  'ps = (1 - PsiS) / (1 + exp(-L1s)) + PsiS / (1 + exp(-L2s))   # 卖方分数',
  'Lc = (ln(p / (1 - p)) - ln(ps / (1 - ps))) / 2   # 买卖对称分（对数几率）：买方占优 > 0，卖方占优 < 0',
  'Lcs = ema(nz(Lc), sh, 0)                         # 平滑（不平均有界的 2p − 1，免得极端被压向中间）',
  '# —— 2. 推力 az（买卖双方都加权）',
  'uN = abs(B - S)                                  # 主动净资金',
  'uf = ln(1 + uN / avg(Q, avgh))                   # 资金力量',
  'uA = (B - S) / Q                                 # 主动买卖失衡，−1 ~ 1',
  'uG = 1 + abs(uA)                                 # 失衡权重：哪边主动都加权（原 DSP 只加权买方）',
  'uR = ln(C / prev(C))                             # 价格变化',
  'uRz = uR / sd(uR, avgh)                          # 几个标准差',
  'uF = nz(uf * uG * uRz)                           # 单根推力',
  'az = ema(uF, hl, 0)                              # 推力漂移速度（Z 分数）',
  'La = clip(ka * az, -3, 3)                        # 换成对数几率单位',
  '# —— 3. 定价保留（CBA 的买卖对称版）',
  'cD = B - S                                       # 主动成交净差额',
  'cA = cD / Q                                      # 主动买卖失衡',
  'cVbar = prev(avg(Q, avgh))                       # 截至上一根的常态成交额',
  'cF = ln(1 + (abs(cD) + 0.5 * (Q - abs(cD))) / cVbar)   # 成交支持',
  'sig = prev(sd(ln(E / prev(E)), avgh))            # 成交均价对数收益率的波动率',
  'Sb = retain(cF * (1 + max(cA, 0)), min(E, C), prev(E), hl, 48) / sig   # 买方：向上的价格优势是否被保留（取较低价）',
  'Ss = retain(cF * (1 + max(-cA, 0)), max(E, C), prev(E), hl, 48) / sig  # 卖方：向下的价格优势是否被保留（取较高价）',
  'Lb = clip((Sb + Ss) / 2, -3, 3)                  # 对称定价保留',
  '# —— 合成',
  'Lt = wc * Lcs + wa * La + wb * Lb                # 合计对数几率',
  'state = 1 / (1 + exp(-Lt))',
].join('\n');

export const STATE_DEF: DeepDigFeatureDef = {
  id: 'state',
  name: '多空状态 S（0–1）',
  short: '状态',
  definition: '当前多空状态（0 ~ 1）：0 = 卖方完全占优，0.5 = 均衡，1 = 买方完全占优。由三部分合成，都做成买卖对称：CBI-2 的买方分数与同一套算法的卖方分数之差（对数几率，4 小时半衰期平滑）、买卖双方都加权的推力 az、买卖双方各算一次的定价保留（CBA 对称版）。数值是模型分数，不是胜率。',
  formula: STATE_FORMULA,
  scale: 1,
  unit: '',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

/** S2 changes the pricing component: Ss is CDA's signed retention before 100*tanh.
 * Keep S's component scale and clipping; using the displayed [-100,100] CDA directly would change its effective weight.
 * 【用户要求】2026-10-23「权重…现在是 3，0.4，2」「你去改一下，要生效」：S2 的定价保留权重 wb 由 1 改为 2，S 保持 1。
 * 【用户要求】2026-10-23「状态 S2 的权重改成 3 / 0.4 / 3」：wb 再改为 3。
 */
export const STATE2_FORMULA = STATE_FORMULA.split('\n')
  .filter(line => !line.startsWith('Sb = '))
  .map(line => line.startsWith('# 多空状态 S（')
    ? '# 多空状态 S2（0 ~ 1）：沿用状态 S，第三部分改为 CDA 定价保留、权重 3；越高越偏买方'
    : line.startsWith('wb = ') ? 'wb = 3                                           # CDA 定价保留的权重（状态 S 为 1）'
    : line.startsWith('# —— 3.') ? '# —— 3. CDA 定价保留（沿用状态 S 的尺度、方向与截断）'
    : line.startsWith('Lb = ') ? 'Lb = clip(Ss, -3, 3)                             # CDA 的有符号定价保留，负值偏卖方；保持原合成尺度'
    : line.startsWith('state = ') ? line.replace('state = ', 'state2 = ')
    : line).join('\n');
export const STATE2_DEF: DeepDigFeatureDef = {
  ...STATE_DEF, id: 'state2', name: '多空状态 S2（0–1）', short: '状态 S2',
  definition: '状态 S 的独立变体（0 ~ 1）：将第三部分由 CBA 买卖对称定价保留改为 CDA 对应的有符号定价保留，越负表示卖方越强；沿用原分量尺度与 ±3 截断。权重为 3 / 0.4 / 3（定价保留权重由状态 S 的 1 提高到 3）；CBI-2 买卖对称分、对称推力 az、4 小时平滑与最终 logistic 均不变。越高越偏买方，0.5 为模型中性点；不是胜率。',
  formula: STATE2_FORMULA,
};

/** Symmetric outcome control: active or passive selling succeeds only when price declines. */
export const SELLER_CONTROL_FORMULA = sellerNegativeFormula([
  '# 卖方控制力：涨跌共用对称权重 1 + abs(A)，不因哪方主动而系统性偏向卖方',
  '# RMS = sqrt(avg(R * R, avgh))，保留漂移；不是减均值的标准差或最终指标的 Z 分数',
  'N = abs(B - S)',
  'f = ln(1 + N / avg(Q, avgh))',
  'A = (B - S) / Q',
  'W = 1 + abs(A)',
  'R = ln(C / prev(C))',
  'Rz = R / sqrt(avg(R * R, avgh))',
  'Dn = max(-Rz, 0)',
  'Up = max(Rz, 0)',
  'F = nz(f * W * (Dn - Up))',
  'bc = ema(F, hl, 0)',
].join('\n'), 'bc');
export const SELLER_CONTROL_DEF: DeepDigFeatureDef = {
  id: 'seller-control', name: '卖方控制力', short: 'DSP·bc',
  definition: '衡量卖方是否控制价格结果：主动卖压低价格、或被动卖盘压住主动买，都计为卖方占优；上涨（含卖压失败）计为买方占优。涨跌共用 1 + abs(A) 对称权重和收益 RMS 归一化。按 hl 半衰期平滑并取负后，负值表示卖方占优，正值表示买方占优，均衡约为 0。',
  formula: SELLER_CONTROL_FORMULA, sellerSignVersion: 1,
  scale: 100, unit: '%σ/根', positive: DEFAULT_POSITIVE, control: DEFAULT_CONTROL,
  source: 'campaigns', groupVars: 2, builtin: true,
};

/** BSS 的卖方镜像：下跌动量、主动卖出占优取正，成交量方向规则同样转换。 */
export const DSS_FORMULA = sellerNegativeFormula([
  '# DSS 买方状态恶化（−1 ~ 1）= 0.45·向下动量标准化 + 0.25·卖方成交量方向分 + 0.30·主动卖方失衡',
  '# Q = 成交额，B / S = 主动买入 / 卖出成交额；avgh = 标准化窗口（小时，默认 24）；窗口与权重沿用 BSS',
  'n = 1                                   # 近期窗口（小时）',
  'M = 1 - C / ago(C, n)                   # 向下价格动量：相对 n 小时前的跌幅，下跌为正',
  'V = avg(Q, n) / avg(Q, avgh)            # 相对成交量：近期平均成交额 ÷ 基线平均',
  'A = (avg(S, n) - avg(B, n)) / avg(Q, n) # 主动卖方失衡：(主动卖 − 主动买) ÷ 合计',
  'Mz = tanh(zscore(M, avgh))              # 向下动量标准化，保留 BSS 的滚动口径',
  'Vz = tanh(zscore(V, avgh))              # 相对成交量标准化',
  'Vd = if(M > 0, Vz, if(M < 0, min(-Vz, 0), 0))   # 跌时放量加分、缩量扣分；涨时放量扣分、缩量不加分',
  'DSS = 0.45 * Mz + 0.25 * Vd + 0.30 * A',
].join('\n'), 'DSS');

export const DSS_DEF: DeepDigFeatureDef = {
  id: 'dss',
  name: '买方状态恶化',
  short: 'DSS',
  definition: '买方状态恶化（−1 ~ 1）：0.45 × 向下动量标准化 + 0.25 × 卖方成交量方向分 + 0.30 × 主动卖方失衡。下跌时放量加分、缩量扣分；上涨时放量扣分、缩量不加分。沿用 BSS 的 1 小时近期窗口、标准化窗口和权重；数值越低（越负）表示综合状态越偏向卖方。读数是相对常态的状态评分，不是恶化速度或下跌概率。',
  sellerSignVersion: 1,
  formula: DSS_FORMULA,
  scale: 1,
  unit: '',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

/** CBA 的卖方镜像：主动卖出加权、当前价取高、保留下移为正；保留原参数和时间窗口。 */
export const CDA_FORMULA = sellerNegativeFormula([
  '# CDA 买方阻力（−100 ~ 100）：成交支持 × 主动卖出权重 × 保留下移速度，按时间加权后 100·tanh 压缩',
  '# B / S = 主动买入 / 卖出成交额，Q = B + S，E = 成交均价；hl、avgh 均以小时计，沿用 CBA',
  'eta = 0.5                                     # 双向活跃成交的保留权重',
  'alpha = 1                                     # 主动卖出优势的额外加权系数',
  'D = S - B                                     # 主动卖出净差额',
  'A = D / Q                                     # 主动卖方失衡',
  'Vbar = prev(avg(Q, avgh))                     # 截至上一根的常态成交额',
  'F = ln(1 + (abs(D) + eta * (Q - abs(D))) / Vbar)  # 成交支持',
  'G = 1 + alpha * max(A, 0)                     # 主动卖出加权',
  'P = max(E, C)                                 # 当前价取成交均价与收盘价的较高者，保守衡量向下成果',
  'sig = prev(sd(ln(E / prev(E)), avgh))         # 截至上一根的成交均价对数收益率波动率',
  'CDA = 100 * tanh(-retain(F * G, P, prev(E), hl, 48) / sig)  # 保留下移速度 = ln(Eᵢ₋₁ ÷ P) ÷ ((t − i + 1)·σ)，48 小时窗口',
].join('\n'), 'CDA');

export const CDA_DEF: DeepDigFeatureDef = {
  id: 'cda',
  name: '买方阻力',
  short: 'CDA',
  definition: '买方阻力（−100 ~ 100）：过去 48 小时每根 K 线的成交支持 × 主动卖出权重 × 当前仍保留的向下价格位移速度，按时间加权后 100·tanh 压缩。当前价取成交均价与收盘价的较高者，保守衡量卖方成果；负值表示向下的价格优势仍被保留，数值越低表示买方面临的卖方阻力越强。沿用 CBA 的窗口、权重和波动率标准化；这是状态评分，不是订单簿阻力价位或下跌概率。',
  sellerSignVersion: 1,
  formula: CDA_FORMULA,
  scale: 1,
  unit: '',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

export const CTBA_DEF: DeepDigFeatureDef = { id:'ctba', name:'CTBA｜趋势买方优势', short:'CTBA', definition:CTBA_DESCRIPTION, formula:ctbaFormula(), scale:1, unit:'', positive:DEFAULT_POSITIVE, control:DEFAULT_CONTROL, source:'campaigns', groupVars:2, builtin:true, interval:'5m' };


/** First copy through the same independent-feature mechanism used by the editor; then configure only the copy. */
const ctba12hCopy = copyFeatureDefinition(CTBA_DEF, [CTBA_DEF], Date.UTC(2026, 9, 29));
export const CTBA_12H_DEF: DeepDigFeatureDef = {
  ...ctba12hCopy, id:'ctba_12h', name:'CTBA-12H｜趋势买方优势（12小时）', short:'CTBA-12H', builtin:true,
  chartTemplate:'ctba', chartCore:'CTBA', interval:'5m', halfLifeHours:2, researchWindowHours:12,
  formula:'ctba_12h_version = 1\n' + ctbaFormula({...CTBA_12H_DEFAULTS}),
  definition:'原 CTBA 的独立12小时副本：5m，N=144，EMA 8/24，波动窗口48根，主动买卖半衰期24根（2h），λ=ln(2)/24，ε=1e-12，权重0.35/0.40/0.25。100·tanh[0.35·tanh(T)+0.40·tanh(M)+0.25·F]；0是固定综合中性基准，正值偏买方、负值偏卖方。分量正负可抵消，0不单独证明主动买卖额相等。无平移、无样本重定心、无截负；保留缺失与全精度。研究展示入场前144根已收盘线，另取滚动与EMA预热；原CTBA独立保留。',
};


/** Response changes amplitude only; original measurement, parameters, warm-up and averages stay intact. */
function bearFeatureFormula(source: string, original: string, core: string, scale = 1, response = false): string {
  const formula = source + '\n' + (response ? `${BEAR_RESPONSE_MARK}\nseller_gain = 2\n${core} = seller_response(${original}, seller_gain, ${scale})` : `${core} = min(${original}, 0)`);
  const names = new Set(compileFeatureFormula(formula).program.statements.flatMap(s => s.name ? [s.name] : []));
  return appendResearchAverages(formula, names, { core, avg: 'avg_' + core, avg2: 'avg_' + core + '_2' }) + '\n' + core + ' = ' + core;
}
export const LEGACY_MBI_BEAR_FORMULA = bearFeatureFormula(MBI_FORMULA, 'MBI', 'MBI_bear');
export const LEGACY_CTBA_BEAR_FORMULA = bearFeatureFormula(CTBA_DEF.formula, 'CTBA', 'CTBA_bear');
const LEGACY_MBI_BEAR_DEFINITION = 'MBI 空方趋势 = min(MBI, 0)，范围 −1～0。空方越强读数越负；原 MBI 为正时记 0，缺失值不补零。沿用 MBI 的收盘价格、衰减周期、饱和尺度及预热规则；各自保存公式和参数。';
const LEGACY_CTBA_BEAR_DEFINITION = 'CTBA 空方趋势 = min(CTBA, 0)，范围 −100～0。空方趋势越强读数越负；原 CTBA 为正时记 0，缺失值不补零。沿用已收盘 5m 的趋势位置、VWAP 动能及主动成交金额；各自保存公式和参数。';
export const MBI_BEAR_DEF: DeepDigFeatureDef = {
  ...MBI_DEF, id: 'mbi-bear', name: 'MBI 空方趋势', short: 'MBI·空方', chartTemplate: 'mbi', chartCore: 'MBI_bear', sellerSignVersion: 1,
  definition: 'MBI 空方趋势 v2：0 为多空平衡，卖方优势用负值、买方优势用正值，保留 −1～1 双向刻度。正值原样保留；负值在 tanh 压缩前施加 seller_gain（默认 2），增强弱卖方信号，保持零轴、衰减周期、饱和尺度、预热及均值窗口不变。MBI=−0.5 时空方读数为−0.8；缺失值不补零。增益可在公式中修改。',
  formula: bearFeatureFormula(MBI_FORMULA, 'MBI', 'MBI_bear', 1, true),
};
export const CTBA_BEAR_DEF: DeepDigFeatureDef = {
  ...CTBA_DEF, id: 'ctba-bear', name: 'CTBA 空方趋势', short: 'CTBA·空方', chartTemplate: 'ctba', chartCore: 'CTBA_bear', sellerSignVersion: 1,
  definition: 'CTBA 空方趋势 v2：0 为趋势位置、VWAP 动能及主动成交金额的综合平衡，卖方优势为负、买方优势为正，保留 −100～100 双向刻度。正值原样保留；负值在外层 tanh 压缩前施加 seller_gain（默认 2）。CTBA=−50 时空方读数为−80。全部窗口、权重、5m 已收盘规则、预热和均值窗口保持不变，缺失值不补零；增益可在公式中修改。',
  formula: bearFeatureFormula(CTBA_DEF.formula, 'CTBA', 'CTBA_bear', 100, true),
};
/** Independent seller copies retain every measurement window; only negative amplitude changes. */
const mbi2SellerCopy=copyFeatureDefinition(MBI2_DEF,[MBI2_DEF],Date.UTC(2026,9,29,15));
export const MBI2_BEAR_DEF:DeepDigFeatureDef={...mbi2SellerCopy,id:'mbi2-bear',name:'MBI2 卖方趋势（可调版）',short:'MBI2·卖方',builtin:true,
  chartTemplate:'mbi2',chartCore:'MBI2_bear',sellerSignVersion:1,
  formula:bearFeatureFormula(MBI2_FORMULA,'MBI2','MBI2_bear',1,true)+[
    '',
    'MBI2_bear_state = mbi2state(MBI2_bear,T,MBI2_BAND,MBI2_CONFIRM,0)',
    'MBI2_bear_lead_h = mbi2state(MBI2_bear,T,MBI2_BAND,MBI2_CONFIRM,1)',
    'MBI2_bear_confirm_h = mbi2state(MBI2_bear,T,MBI2_BAND,MBI2_CONFIRM,2)',
    'MBI2_bear = MBI2_bear',
  ].join('\n'),
  definition:'MBI2 的独立卖方副本。0为综合均衡，卖方越强越负，正值原样保留；seller_gain默认2，只增强负向幅度，不缩短日历时长、5n预热或均值窗口。保留独立的缓冲状态及本轮/确认持续小时；状态阈值作用于本副本增强后的读数。确认阈值默认0.8、缓冲带默认0.2，z0固定1.25。缺失不补零，原MBI2及原MBI不变；参数扫描仍在原MBI2买方研究中运行，本副本支持通用描述与推断统计。'};
const ctba12hSellerCopy=copyFeatureDefinition(CTBA_12H_DEF,[CTBA_12H_DEF],Date.UTC(2026,9,29,15,1));
export const CTBA_12H_BEAR_DEF:DeepDigFeatureDef={...ctba12hSellerCopy,id:'ctba_12h-bear',name:'CTBA-12H 卖方趋势（12小时）',short:'CTBA-12H·卖方',builtin:true,
  chartTemplate:'ctba',chartCore:'CTBA_12H_bear',sellerSignVersion:1,
  formula:'ctba_12h_bear_version = 1\n'+bearFeatureFormula(CTBA_12H_DEF.formula,'CTBA','CTBA_12H_bear',100,true),
  definition:'CTBA-12H 的独立卖方副本。5m，N144，EMA8/24，波动窗口48根，主动成交半衰期24根（2小时），权重0.35/0.40/0.25全部保留。0为固定综合均衡基准；正值原样保留，负值在外层tanh前以seller_gain（默认2）增强，不截负、不按样本平移或缩放。负向绝对值理论上界约96.4028，保留对称零轴和12小时研究窗口；均值另读足够预热。T/M/F及缺失保留，公式、缓存和计算状态独立，原CTBA-12H及CTBA不变。'};

/** Upgrade just the retired clipping assignment on the two built-ins; edited parameters/averages and independent copies survive. */
export function upgradeBearResponse(d: DeepDigFeatureDef): DeepDigFeatureDef {
  const entry = d.id === 'mbi-bear' ? { original:'MBI', core:'MBI_bear', scale:1, target:MBI_BEAR_DEF, description:LEGACY_MBI_BEAR_DEFINITION }
    : d.id === 'ctba-bear' ? { original:'CTBA', core:'CTBA_bear', scale:100, target:CTBA_BEAR_DEF, description:LEGACY_CTBA_BEAR_DEFINITION } : undefined;
  if (!entry || /\bseller_response\s*\(/.test(d.formula)) return d;
  try {
    const names = new Set(compileFeatureFormula(d.formula).program.statements.flatMap(s=>s.name?[s.name]:[]));
    let gain='seller_gain';while(names.has(gain))gain+='_';
    const pattern = new RegExp('^\\s*'+entry.core+'\\s*=\\s*min\\(\\s*'+entry.original+'\\s*,\\s*0(?:\\.0*)?\\s*\\)\\s*(?:#.*)?$');
    let changed=false;
    const formula=d.formula.split('\n').map(line=>{
      if(!pattern.test(line))return line;
      const prefix=changed?'':`${BEAR_RESPONSE_MARK}\n${gain} = 2\n`;changed=true;
      return `${prefix}${entry.core} = seller_response(${entry.original}, ${gain}, ${entry.scale})`;
    }).join('\n');
    return changed ? {...d,formula,sellerSignVersion:1,definition:d.definition===entry.description?entry.target.definition:d.definition} : d;
  } catch { return d; }
}

/** Copy before augmenting. No source lookup occurs during evaluation. */
export function createSellerRetentionCopy(source:DeepDigFeatureDef,spec:SellerRetentionSpec):DeepDigFeatureDef {
 const copy=copyFeatureDefinition(source,[source],Date.UTC(2026,9,30,3));
 const program=compileFeatureFormula(source.formula).program,declared=new Set(program.statements.map(s=>s.name));
 const last=program.statements.at(-1)!;
 const render=(n:typeof last.expr):string=>n.k==='num'?String(n.v):n.k==='var'?n.name:n.k==='un'?`(${n.op} ${render(n.a)})`:n.k==='bin'?`(${render(n.a)} ${n.op} ${render(n.b)})`:`${n.name}(${n.args.map(render).join(',')})`;
 const base=declared.has(source.chartCore??spec.sourceCore)?(source.chartCore??spec.sourceCore):last.name??render(last.expr);
 const built=retentionFormula(copy.formula,base,spec.core,spec.bound,source.researchWindowHours??48);
 const names=new Set(compileFeatureFormula(built.formula).program.statements.flatMap(s=>s.name?[s.name]:[]));
 const formula=appendResearchAverages(built.formula,names,{core:spec.core,avg:'avg_'+spec.core,avg2:'avg_'+spec.core+'_2'})+'\n'+spec.core+' = '+spec.core;
 return {...copy,id:spec.id,name:source.name+'｜成交保留增强',short:source.short+'·保留',builtin:true,chartCore:spec.core,sellerSignVersion:1,retentionSourceId:source.id,retentionPrefix:built.prefix,retentionVersion:1,formula,
  definition:source.definition+'\n独立副本 v1：原算法完整保留，新增成交支持加权的历史价格位移重估。失守未收复为负，收复后回升；主动成交失衡及单位失衡下行冲击作为权重代理，不代表完整订单簿OFI或因果冲击。以过去avgh小时波动率标准化，成交基线和波动率只用上一根及以前；缺失/缺根/预热不足不补零。新增分量在最终压缩前按gain合成（默认0.5，gain=0恢复原读数）；原窗口和参数不缩短，新窗口默认'+(source.researchWindowHours??48)+'小时。固定零中心，原始/均值序列与存储版本独立，阈值需另行验证。'};
}
const retentionSources=[CDI2_DEF,SELLER_CONTROL_DEF,DSS_DEF,MBI_BEAR_DEF,CTBA_BEAR_DEF,MBI2_BEAR_DEF,CTBA_12H_BEAR_DEF];
export const SELLER_RETENTION_FEATURES=SELLER_RETENTION_SPECS.map(s=>createSellerRetentionCopy(retentionSources.find(d=>d.id===s.sourceId)!,s));

export const BUILTIN_FEATURES: readonly DeepDigFeatureDef[] = [DRIFT_SPEED_DEF, BSS_DEF, CBA_DEF, DRIFT_SPEED_Z_DEF, CBI_DEF, CBA2_DEF, CBI2_DEF, MBI_DEF, MBI2_DEF, CTBA_DEF, CTBA_12H_DEF, STATE_DEF, STATE2_DEF, CDI2_DEF, SELLER_CONTROL_DEF, DSS_DEF, CDA_DEF, MBI_BEAR_DEF, CTBA_BEAR_DEF, MBI2_BEAR_DEF, CTBA_12H_BEAR_DEF, ...SELLER_RETENTION_FEATURES];

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


/** Copy the effective definition, never the source's results or mutable research state. */
export function copyFeatureDefinition(source: DeepDigFeatureDef, existing: readonly DeepDigFeatureDef[], now = Date.now()): DeepDigFeatureDef {
  let id = newFeatureTemplate(now).id, serial = 1;
  while (existing.some(d => d.id === id)) id = newFeatureTemplate(now).id + '-' + serial++;
  let number = 1;
  const name = () => source.name + '（副本' + (number === 1 ? '' : number) + '）';
  while (existing.some(d => d.name === name())) number++;
  const { builtin: _builtin, removed: _removed, visibilityVersion: _visibility, ...copy } = structuredClone(source);
  return { ...copy, id, name: name(), short: source.short + '·副本' + (number === 1 ? '' : number),
    chartTemplate: featureTemplateId(source), createdAt: now };
}

/** Freeze each effective account source once; repeated loads never rebase an existing copy. */
export function ensureSellerRetentionCopies(saved:readonly DeepDigFeatureDef[]):DeepDigFeatureDef[] {
 let next=saved as DeepDigFeatureDef[];
 for(const spec of SELLER_RETENTION_SPECS){
  if(next.some(d=>d.id===spec.id))continue;
  const source=next.find(d=>d.id===spec.sourceId)??BUILTIN_FEATURES.find(d=>d.id===spec.sourceId)!;
  const effective=upgradeSellerSign(upgradeBearResponse(upgradeBssFormula(upgradeFormula(upgradeGroupVars(source)))));
  try{const copy=createSellerRetentionCopy(effective,spec);next=[...next,copy];}catch{const copy=copyFeatureDefinition(effective,[effective],Date.UTC(2026,9,30,3));next=[...next,{...copy,id:spec.id,builtin:true,chartCore:spec.core,sellerSignVersion:1,retentionSourceId:effective.id,retentionVersion:1,name:effective.name+'｜成交保留增强',short:effective.short+'·保留',definition:'原账号公式待修正；保留原文，修正后再配置增强分量。',formula:effective.formula+'\n# 原公式无效，不能用内置默认公式冒充本副本结果'}];}
 }
 return next;
}

/** Always retain all saved parameters, even when the formula still equals a builtin. */
export function saveFeatureDefinition(saved: readonly DeepDigFeatureDef[], next: DeepDigFeatureDef): DeepDigFeatureDef[] {
  return [...ensureSellerRetentionCopies(saved).filter(d => d.id !== next.id), { ...next, builtin: undefined }];
}

/** 用户存的定义（改过的内置项 + 新增项）合到内置清单上：内置在前，新增按创建先后。 */
export function mergeFeatureDefs(saved: readonly DeepDigFeatureDef[]): DeepDigFeatureDef[] {
  saved = ensureSellerRetentionCopies(saved.filter(d => !isRetiredFeature(d.id)).map(restoreFeatureVisibility));
  const byId = new Map(saved.map(d => [d.id, upgradeSellerSign(upgradeBearResponse(upgradeBssFormula(upgradeFormula(upgradeGroupVars(d)))))]));
  const builtins = BUILTIN_FEATURES.filter(b => !byId.get(b.id)?.removed).map(b => ({ ...b, ...(byId.get(b.id) ?? {}), id: b.id, builtin: true }));
  const custom = saved.filter(d => !BUILTIN_FEATURES.some(b => b.id === d.id)).map(upgradeGroupVars).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  // 历史内置名称随系统更新，用户自定义的名称保持原样。
  const legacyNames = new Set([
    ['多空博弈均衡点', '漂移速度'].join(''),
    ['多空博弈均衡点', '漂移速度 V'].join(''),
    ['谢林点', '迁移速度 V'].join(''),
    ['买方推力的加速度', ' V'].join(''),
    ['买方推力的加速度', ' a'].join(''),
  ]);
  // 【用户要求】2026-10-18「买方推力加速度…改成买方推力漂移速度 DSP·a」：Z 分数版的旧内置名也换
  const legacyZNames = new Set(['买方推力漂移速度 DSP·az（Z 分数）', ['买方推力的加速度', ' az（Z 分数）'].join('')]);
  const legacyZDefinition = '与买方推力漂移速度 DSP·a 相同，只是每根的涨跌先换成「几个标准差」（除以它过去 avgh 小时的标准差）：波动大的币不再天然读数大，不同币可以横向比较、少受极端值左右；0 仍是多空平衡。';
  return [...builtins, ...custom].map(def => {
    if (def.id === SELLER_CONTROL_DEF.id) return { ...def, short: SELLER_CONTROL_DEF.short };
    if (def.id === DRIFT_SPEED_DEF.id) return { ...def, name: legacyNames.has(def.name) ? DRIFT_SPEED_DEF.name : def.name, short: DRIFT_SPEED_DEF.short };
    if (def.id === DRIFT_SPEED_Z_DEF.id) return { ...def,
      name: legacyZNames.has(def.name) ? DRIFT_SPEED_Z_DEF.name : def.name,
      definition: def.definition === legacyZDefinition ? DRIFT_SPEED_Z_DEF.definition : def.definition,
      unit: def.unit === '%σ/根' && def.scale === 100 ? DRIFT_SPEED_Z_DEF.unit : def.unit,
    };
    return def;
  });
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
function restoreFeatureVisibility(def: DeepDigFeatureDef): DeepDigFeatureDef {
  // 2026-10-29: restore DSP·a across all readers, preserving the account formula and parameters.
  return def.id === 'drift-speed' && (def.visibilityVersion ?? 0) < 1
    ? { ...def, removed: false, visibilityVersion: 1 } : def;
}
export function removedBuiltins(saved: readonly DeepDigFeatureDef[]): DeepDigFeatureDef[] {
  const removed = new Set(saved.map(restoreFeatureVisibility).filter(d => d.removed).map(d => d.id));
  return BUILTIN_FEATURES.filter(b => removed.has(b.id));
}

/** 影响运行结果的部分：改了这些，旧结果就不再对应当前定义。 */
export const definitionKey = (d: Pick<DeepDigFeatureDef, 'formula' | 'positive' | 'control' | 'source' | 'groupVars' | 'interval' | 'halfLifeHours' | 'avgHours' | 'MBI_N' | 'MBI_Z0' | 'chartTemplate' | 'researchWindowHours' | 'MBI2_T_HOURS' | 'MBI2_Z0' | 'MBI2_BAND' | 'MBI2_CONFIRM'>) => {
  const g = upgradeGroupVars(d);
  // 写死 6 小时的那版与按 hl 平滑的那版在默认半衰期下结果一样（旧结果只会是默认半衰期）
  const raw = d.formula.trim() === LEGACY_DRIFT_SPEED_FORMULA ? EMA_DRIFT_SPEED_FORMULA : d.formula.trim();
  // 注释不影响结果：只改了注释（例如 2026-10-18 改名「买方推力漂移速度」）的旧结果不提示重跑
  const formula = raw.split('\n').map(l => l.replace(/#.*$/, '').trimEnd()).filter(Boolean).join('\n');
  const key: unknown[] = [formula, g.positive.trim(), g.control.trim(), d.source ?? 'campaigns'];
  // 默认周期 / 半衰期不进键：旧结果没有这两项
  if (intervalOf(d) !== DEFAULT_INTERVAL) key.push(intervalOf(d));
  if (halfLifeOf(d) !== DEFAULT_HALF_LIFE_HOURS) key.push(`hl=${halfLifeOf(d)}`);
  if (avgHoursOf(d) !== DEFAULT_AVG_HOURS) key.push(`avgh=${avgHoursOf(d)}`);
  if (featureUsesMbi(d)) key.push(`MBI_N=${mbiNOf(d)}`, `MBI_Z0=${mbiZ0Of(d)}`);
  if(featureUsesMbi2(d)){const p=featureParams(d);key.push(`MBI2_T_HOURS=${p.MBI2_T_HOURS}`,`MBI2_Z0=${p.MBI2_Z0}`,`MBI2_BAND=${p.MBI2_BAND}`,`MBI2_CONFIRM=${p.MBI2_CONFIRM}`);}
  if (d.chartTemplate) key.push("chart=" + d.chartTemplate);
  if (d.researchWindowHours != null) key.push("researchHours=" + d.researchWindowHours);
  return JSON.stringify(key);
};

// ===================== 公式 =====================

export interface CompiledFeature {
  program: Program;
  usesAmounts: boolean;
  /** 用到对照币 BTCUSDT 的收盘价（CB）：流水线另取同时段的 K 线。 */
  usesBtc?: boolean;
  usesMbi?: boolean;
  usesMbi2?: boolean;
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
  return { program, usesAmounts: [...program.inputs].some(n => AMOUNT_VARIABLES.has(n)), usesBtc: program.inputs.has('CB'), usesMbi: featureUsesMbi({ formula }), usesMbi2: featureUsesMbi2({formula}) };
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
export function evaluateOnBars(bars: readonly ResearchBar[], compiled: CompiledFeature, params: ParamDef = {}, cache?: FormulaEvaluationCache) {
  if (compiled.usesMbi || params.id === 'mbi') validateMbiParams(mbiNOf(params), mbiZ0Of(params));
  if(compiled.usesMbi2||featureUsesMbi2(params))validateMbi2Params(params,intervalMs(intervalOf(params))/60000);
  const keys = ['T','C','O','H','L','Q','B','S','E','CB'] as const;
  const input = (cache?.buffers ?? {}) as Record<typeof keys[number], Float64Array>;
  for (const key of keys) {
    const old = input[key];
    if (old?.length === bars.length) continue;
    if (old && old.byteOffset + bars.length * 8 <= old.buffer.byteLength) input[key] = new Float64Array(old.buffer, old.byteOffset, bars.length);
    else { const capacity = cache && bars.length ? 2 ** Math.ceil(Math.log2(bars.length)) : bars.length; input[key] = new Float64Array(capacity).subarray(0, bars.length); }
  }
  if (cache) cache.buffers = input;
  const finite = (v: number | null | undefined) => v != null && Number.isFinite(v) ? v : NaN;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], q = finite(b.quoteVolume), buy = finite(b.takerBuyQuoteVolume);
    input.T[i] = finite(b.openTime); input.C[i] = finite(b.close); input.O[i] = finite(b.open);
    input.H[i] = finite(b.high); input.L[i] = finite(b.low); input.Q[i] = q; input.B[i] = buy; input.S[i] = q - buy;
    input.E[i] = finite(b.quoteVolume != null && b.volume != null && b.volume > 0 ? b.quoteVolume / b.volume : null);
    input.CB[i] = finite(b.refClose);
  }
  return evaluateProgramVars(compiled.program, {
    ...input,
    ...featureParams(params),
  }, { barMinutes: intervalMs(intervalOf(params)) / 60_000, cache });
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
export type DeepDigOtherReason = 'unreliable' | 'missing' | 'conflict' | 'neither' | 'us_stock';

/**
 * 分组用的一个样本：一场交易战役，或信号库里的一条信号（时间点 = 那条信号的时间）。
 * values / missing 的键同时有字母与它的拼写（Bₜ 与 Bt 都能写）。
 */
export interface SampleRow {
  unsupportedReason?: string;
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
  if(signal.market==='us_stock')return {id:signal.id,symbol:signal.symbol,anchorMs:Number.isFinite(signal.timeMs)?signal.timeMs:null,excluded:true,unreliable:false,values:{s:Number.isFinite(signal.quality)?signal.quality!:NaN},missing:new Set(signal.quality==null?['s']:[]),unsupportedReason:US_STOCK_UNSUPPORTED};
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
  if (row.unsupportedReason) return {group:'other',reason:'us_stock'};
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
    if(row.unsupportedReason){out.other++;continue;}
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
export function checkDefinition(d: Pick<DeepDigFeatureDef, 'formula' | 'positive' | 'control' | 'scale' | 'source' | 'MBI_N' | 'MBI_Z0' | 'MBI2_T_HOURS' | 'MBI2_Z0' | 'MBI2_BAND' | 'MBI2_CONFIRM' | 'interval'>): DefinitionCheck {
  const msg = (f: () => unknown) => {
    try { f(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
  };
  return {
    formula: msg(() => { const compiled = compileFeatureFormula(d.formula); if (/\bctba\s*\(/.test(d.formula)) evaluateOnBars([],compiled,d); if (featureUsesMbi(d)) validateMbiParams(mbiNOf(d), mbiZ0Of(d)); if(featureUsesMbi2(d))validateMbi2Params(d,intervalMs(intervalOf(d))/60000); }),
    groups: msg(() => compileGroups(d.positive, d.control, d.source ?? 'campaigns')),
    scale: Number.isFinite(d.scale) && d.scale > 0 ? null : '显示倍数要是正数',
  };
}

