/**
 * Deep RSA · 第 6 步：特征深挖——加权主动买卖失衡、失衡的近期偏移、谢林候选（偏离 12h VWAP / 偏离 POC）。
 *
 * 【用户要求】2026-10-15：「加权主动买卖失衡、失衡的近期偏移、谢林候选，我想进一步分析这三个特征」。
 * 与第 4 步的区别：RSA 把几个特征合成一个距离再看「相似 ↔ 相似」；这里每个特征**单独**看，回答
 * 「它高 / 低的时候，之后 24h 的客观行情是什么样」以及「它能不能把你的正 / 对照战役分开」。
 *
 * 事先写死（不看结果再改）：
 *   - 特征 4 个：taker_imb_w、taker_imb_shift_w（主分析 h = 6；h = 2 / 12 只作敏感性）、vwap12_dev、poc_dev_w（h = 6）。
 *     兜底价（候选 c）战役样本里没有数值，只报可用数。
 *   - 客观结果 3 个（与操作无关）：24h 期末收益（方向）、24h 最大涨幅、24h 最大跌幅（阴性对照：
 *     特征若对涨、跌两边都「相关」，多半只是波动率）。
 *   - 发现集 = 时间上前 80%（第 4 步的训练 + 验证），确认集 = 最后 20%（测试集，只读一次）；切口与隔离带同第 4 步。
 *   - 主检验：发现集上 4 × 3 = 12 个 Spearman ρ，时间块（月）内置换求 p，整族 Holm；按标的整簇重抽样给 95% 区间。
 *     同时报「控制观察窗波动率（vol_w）后的偏相关」，回答「是不是只是波动率」。
 *   - 确认：发现集 Holm 通过的，在确认集上按同一方向做单侧置换检验，再 Holm → 已验证 / 检验未获支持。
 *   - 标签：正 / 对照战役用 AUC（Mann–Whitney）比较，全部时间段（正样本太少，只能描述），置换 p + Holm。
 *   - 其余（分位数分档、子集、半衰期、谢林 × 失衡交叉）都是描述，不做判定。
 *
 * 第 7 步（动态谢林点 DSP，docs/deep-rsa/12-dsp-test.md）用同一套统计，只换特征清单与交叉表：见 DeepDiveStudy / DSP_STUDY；
 * 另按用户要求加做 H 节：实验组（正样本）vs 对照组的 Welch t 检验。
 */
import { CODE_VERSION } from '@/lib/deepRsa/campaignLabels';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { collectRunEvents, type CollectedEvents, type RunEvent, type RunOptions } from '@/lib/deepRsa/pipeline';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';
import { holmAdjust, ranks, spearman } from '@/lib/deepRsa/rsa';
import { chronologicalSplit } from '@/lib/deepRsa/splits';

export const DEEP_DIVE_ALPHA = 0.05;
export const DEEP_DIVE_PRIMARY_H = 6;
export const DEEP_DIVE_SENSITIVITY_H = [2, 6, 12] as const;

/** 特征键：第 6 步是 taker_imb_w / taker_imb_shift_w / vwap12_dev / poc_dev_w，第 7 步是 dsp_v / dsp_a / dsp_gap。 */
export type DeepDiveFeatureKey = string;
export type DeepDiveTargetKey = 'endRet' | 'maxUp' | 'maxDown';

export interface DeepDiveFeatureSpec {
  key: DeepDiveFeatureKey;
  name: string;
  /** 一句话定义（界面与报告用）。 */
  definition: string;
  formula: string;
  /** 正值的含义。 */
  reading: string;
  weighted: boolean;
  /** 界面显示倍率与单位（只换单位，检验用原值）：V 在 10⁻⁵ 量级，按基点（× 10⁴）显示。 */
  display?: { scale: number; unit: string };
}

export const DEEP_DIVE_FEATURES: readonly DeepDiveFeatureSpec[] = [
  {
    key: 'taker_imb_w', name: '加权主动买卖失衡', weighted: true,
    definition: '观察窗（进场前 48h）里，主动买入量比主动卖出量多出多少，占总成交量的比例；越靠近进场的 K 线权重越大。',
    formula: 'Σ wᵢ(2·TBᵢ − Vᵢ) ÷ Σ wᵢVᵢ，TB = 主动买入量，V = 成交量，wᵢ 按半衰期 h 指数衰减；取值 −1 ~ +1',
    reading: '正 = 近期主动买盘占优，负 = 主动卖盘占优',
  },
  {
    key: 'taker_imb_shift_w', name: '失衡的近期偏移', weighted: true,
    definition: '近期（加权）的主动买卖失衡，减去整个 48h 窗口不加权的失衡：买卖力量最近是在变强还是变弱。',
    formula: 'taker_imb_w − Σ(2·TBᵢ − Vᵢ) ÷ ΣVᵢ（整窗等权）',
    reading: '正 = 买盘最近比整窗更强（转强），负 = 最近比整窗更弱（转弱）',
  },
  {
    key: 'vwap12_dev', name: '谢林候选 a · 偏离 12h VWAP', weighted: false,
    definition: '进场前最后收盘价相对过去 12 小时成交量加权均价（VWAP）的对数偏离：市场共识的「公平价」在哪，现价离它多远。',
    formula: 'ln(C_N ÷ VWAP₁₂ₕ)，VWAP = ΣVᵢ·TPᵢ ÷ ΣVᵢ，TP = (H + L + C) ÷ 3，取最后 144 根 5m K 线',
    reading: '正 = 现价在 VWAP 上方，负 = 在下方',
  },
  {
    key: 'poc_dev_w', name: '谢林候选 b · 偏离成交密集区 POC', weighted: true,
    definition: '进场前最后收盘价相对 48h 成交量最密集的价位（POC）的对数偏离：大家成交最多、最「认可」的价位在哪，现价离它多远。',
    formula: 'ln(C_N ÷ POC)，每根 K 线的 wᵢVᵢ 均摊到 [L, H] 的 48 个价格档，POC = 量最大那一档的中点',
    reading: '正 = 现价在成交密集区上方，负 = 在下方',
  },
];

/**
 * 一项「逐个特征检验」研究：第 6 步（失衡 · 偏移 · 谢林）与第 7 步（动态谢林点 DSP）共用同一套统计，只换特征清单与交叉表。
 * 交叉表 G：first > 0 记「上方」（结果里的 price = 'above'），second > 0 记「买盘」（flow = 'buy'）——沿用第 6 步的字段名，旧结果照样能读。
 */
export type DeepDiveStudyId = 'features' | 'dsp';
export interface DeepDiveStudy {
  id: DeepDiveStudyId;
  /** 「第 6 步」「第 7 步」。 */
  step: string;
  /** 定义区的标题。 */
  definitionsTitle: string;
  features: readonly DeepDiveFeatureSpec[];
  interaction: {
    first: { key: DeepDiveFeatureKey; header: string; pos: string; neg: string };
    second: { key: DeepDiveFeatureKey; header: string; pos: string; neg: string };
    title: string;
    how: string;
  };
  /** 确认集的独立性说明（C 节）。 */
  confirmationNote: string;
  /** 定义下面的补充一句（可空）。 */
  definitionNote?: string;
  runLabel: string;
  rerunLabel: string;
  /** 是否做「实验组（正样本）vs 对照组」的 Welch t 检验（H 节）。【用户要求】2026-10-16 第 7 步用 t 检验。 */
  groupTTest?: boolean;
}

export const DEEP_DIVE_TARGETS: readonly { key: DeepDiveTargetKey; name: string; reading: string }[] = [
  { key: 'endRet', name: '24h 期末收益', reading: 'ln(进场 24h 后收盘价 ÷ 进场价)：方向，主要看它' },
  { key: 'maxUp', name: '24h 最大涨幅', reading: 'ln(24h 内最高价 ÷ 进场价)：上一轮「已验证」用的目标' },
  { key: 'maxDown', name: '24h 最大跌幅', reading: 'ln(24h 内最低价 ÷ 进场价)：阴性对照，若也「相关」多半只是波动率' },
];

export const FEATURES_STUDY: DeepDiveStudy = {
  id: 'features',
  step: '第 6 步',
  definitionsTitle: '三个特征的定义',
  features: DEEP_DIVE_FEATURES,
  interaction: {
    first: { key: 'vwap12_dev', header: '现价 vs 12h VWAP', pos: '上方', neg: '下方（或相等）' },
    second: { key: 'taker_imb_w', header: '近期主动买卖', pos: '买盘占优', neg: '卖盘占优（或持平）' },
    title: '谢林 × 失衡交叉',
    how: '现价在 12h VWAP 上方 / 下方 × 近期主动买 / 卖占优，四格各自之后 24h 的平均结果，以及你的正 / 对照战役落在哪一格。描述，用来提出下一轮假设。',
  },
  confirmationNote: '确认集与第 3–5 步的测试集是同一段时间；其中「谢林 → 24h 最大涨幅」那一类关系上次已经在这段时间看过一次，这一项不算完全独立的确认。',
  definitionNote: '谢林候选 c（偏离人工兜底价）：战役样本没有兜底价，只报可用场数。',
  runLabel: '开始深挖',
  rerunLabel: '重新深挖',
};

/** 【用户要求】2026-10-16「你要把这个指标在 deep RSA 那里做统计检验」：动态谢林点（docs/deep-rsa/12-dsp-test.md，运行前写定）。 */
export const DSP_FEATURES: readonly DeepDiveFeatureSpec[] = [
  {
    key: 'dsp_v', name: '谢林点迁移速度 V', weighted: true,
    definition: '动态谢林点指标在进场前最后一根 5m K 线上的 Vₜ：净资金力量 × 买方优势权重 × 价格变化，按半衰期 h 指数平滑。',
    formula: 'Vₜ = ρ·Vₜ₋₁ + (1 − ρ)·Fₜ·Gₜ·Rₜ，Fₜ = ln(1 + |Bₜ − Sₜ| ÷ EMA(Bₜ + Sₜ))，Gₜ = 1 + max(Aₜ, 0)，Rₜ = ln(Cₜ ÷ Cₜ₋₁)；B / S 为主动买 / 卖成交金额',
    reading: '正 = 共识价（谢林点）在往上移，越大移得越快（界面按基点 / 根显示）',
    display: { scale: 1e4, unit: '基点/根' },
  },
  {
    key: 'dsp_a', name: '主动买方优势 A', weighted: false,
    definition: '进场前最后一根 5m K 线上，主动买入金额比主动卖出金额多出多少，占成交额的比例（单根读数，噪声大）。',
    formula: 'Aₜ = (Bₜ − Sₜ) ÷ (Bₜ + Sₜ)，取值 −1 ~ +1',
    reading: '正 = 最后 5 分钟主动买方占优',
  },
  {
    key: 'dsp_gap', name: '现价偏离 DSP', weighted: true,
    definition: '进场前最后收盘价相对动态谢林点 DSP 的对数偏离；DSP 从观察窗第一根 K 线（进场前 48h）的收盘价起算，κ = 1。',
    formula: 'ln(Cₜ ÷ DSPₜ)，DSPₜ = DSPₜ₋₁ × e^(Vₜ)，DSP₀ = 窗口第一根收盘价',
    reading: '正 = 现价跑在资金共识价上方',
  },
];

export const DSP_STUDY: DeepDiveStudy = {
  id: 'dsp',
  step: '第 7 步',
  definitionsTitle: '动态谢林点的三个读数（进场前最后一根 5m K 线）',
  features: DSP_FEATURES,
  interaction: {
    first: { key: 'dsp_gap', header: '现价 vs DSP', pos: '上方', neg: '下方（或相等）' },
    second: { key: 'dsp_v', header: '谢林点移动', pos: '上移（V > 0）', neg: '下移或不动' },
    title: '偏离 × 迁移方向交叉',
    how: '现价在 DSP 上方 / 下方 × 谢林点上移 / 下移，四格各自之后 24h 的平均结果，以及你的正 / 对照战役落在哪一格。描述，用来提出下一轮假设。',
  },
  confirmationNote: '确认集与第 3–6 步的测试集是同一段时间，那段时间已经看过好几轮（谢林 / VWAP 一类的关系也在那里看过）；这次只能算同一段数据上的再确认，真正独立的确认要用之后新产生的战役。',
  definitionNote: '数据：主动买卖额用币安 K 线自带的成交金额（USDT）；观察窗里有金额数据的 K 线不到 95% 时这一场记为缺失，不拿币数凑。参数 α = 1、κ = 1。',
  runLabel: '开始检验',
  rerunLabel: '重新检验',
  groupTTest: true,
};

export const DEEP_DIVE_STUDIES: Record<DeepDiveStudyId, DeepDiveStudy> = { features: FEATURES_STUDY, dsp: DSP_STUDY };

// ===================== 统计工具 =====================

function pearson(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  if (n < 3) return Number.NaN;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : Number.NaN;
}

/** y 对 z 做最小二乘后的残差。 */
function residualize(y: readonly number[], z: readonly number[]): number[] {
  const n = y.length;
  const mz = z.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let szz = 0; let szy = 0;
  for (let i = 0; i < n; i++) { szz += (z[i] - mz) ** 2; szy += (z[i] - mz) * (y[i] - my); }
  const beta = szz > 0 ? szy / szz : 0;
  return y.map((v, i) => v - my - beta * (z[i] - mz));
}

/** 偏 Spearman：x、y 的秩各自对 z 的秩回归后取残差，再算 Pearson（剔除 z 的单调影响）。 */
export function partialSpearman(x: readonly number[], y: readonly number[], z: readonly number[]): number {
  if (x.length < 4) return Number.NaN;
  const rz = ranks(z);
  return pearson(residualize(ranks(x), rz), residualize(ranks(y), rz));
}

/** 固定 x 的 Spearman：x 的秩只算一次，置换时只重排 y。 */
function spearmanAgainst(x: readonly number[]): (y: readonly number[]) => number {
  const rx = ranks(x);
  return y => (y.length >= 3 ? pearson(rx, ranks(y)) : Number.NaN);
}

/** 固定 x、z 的偏 Spearman：x 的残差与 z 的秩只算一次。 */
function partialSpearmanAgainst(x: readonly number[], z: readonly number[]): (y: readonly number[]) => number {
  if (x.length < 4) return () => Number.NaN;
  const rz = ranks(z);
  const resX = residualize(ranks(x), rz);
  return y => pearson(resX, residualize(ranks(y), rz));
}

/** 在块内打乱下标（块 = 月份），保留时间结构。 */
function blockShuffle(blocks: readonly string[], rand: () => number): number[] {
  const byBlock = new Map<string, number[]>();
  blocks.forEach((b, i) => { const list = byBlock.get(b) ?? []; list.push(i); byBlock.set(b, list); });
  const perm = blocks.map((_, i) => i);
  for (const idx of byBlock.values()) {
    const shuffled = [...idx];
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
    }
    idx.forEach((orig, k) => { perm[orig] = shuffled[k]; });
  }
  return perm;
}

export type Tail = 'two' | 'greater' | 'less';

/** 置换 p：把 y 在块内打乱 n 次，统计量至少一样极端的比例（含观测本身，(1 + k) / (1 + n)）。 */
export function permutationP(
  stat: (y: readonly number[]) => number,
  y: readonly number[],
  blocks: readonly string[],
  options: { permutations: number; seed: number; tail?: Tail },
): number {
  const observed = stat(y);
  if (!Number.isFinite(observed) || options.permutations <= 0) return Number.NaN;
  const rand = mulberry32(options.seed);
  const tail = options.tail ?? 'two';
  let atLeast = 0;
  for (let t = 0; t < options.permutations; t++) {
    const perm = blockShuffle(blocks, rand);
    const s = stat(perm.map(i => y[i]));
    if (!Number.isFinite(s)) continue;
    if (tail === 'two' ? Math.abs(s) >= Math.abs(observed) - 1e-12
      : tail === 'greater' ? s >= observed - 1e-12 : s <= observed + 1e-12) atLeast++;
  }
  return (1 + atLeast) / (1 + options.permutations);
}

/** 按簇（标的）整簇有放回重抽样的百分位区间；同一个币的事件一起进出，区间不会因同币相关而偏窄。 */
export function clusterBootstrapCi(
  stat: (idx: readonly number[]) => number,
  clusters: readonly string[],
  options: { reps: number; seed: number },
): [number, number] | null {
  const byCluster = new Map<string, number[]>();
  clusters.forEach((c, i) => { const list = byCluster.get(c) ?? []; list.push(i); byCluster.set(c, list); });
  const groups = [...byCluster.values()];
  if (groups.length < 3 || options.reps <= 0) return null;
  const rand = mulberry32(options.seed);
  const stats: number[] = [];
  for (let t = 0; t < options.reps; t++) {
    const idx: number[] = [];
    for (let k = 0; k < groups.length; k++) idx.push(...groups[Math.floor(rand() * groups.length)]);
    const s = stat(idx);
    if (Number.isFinite(s)) stats.push(s);
  }
  if (stats.length < 10) return null;
  stats.sort((a, b) => a - b);
  const at = (q: number) => stats[Math.min(stats.length - 1, Math.max(0, Math.floor(q * (stats.length - 1))))];
  return [at(0.025), at(0.975)];
}

/** AUC = P(正样本的值 > 对照的值)，并列算一半（等价于 Mann–Whitney U ÷ (n₁n₂)）。 */
export function auc(pos: readonly number[], ctl: readonly number[]): number {
  if (!pos.length || !ctl.length) return Number.NaN;
  const all = [...pos, ...ctl];
  const r = ranks(all);
  const rankSumPos = r.slice(0, pos.length).reduce((s, v) => s + v, 0);
  return (rankSumPos - pos.length * (pos.length + 1) / 2) / (pos.length * ctl.length);
}

// ---------- t 检验（Welch，不假定两组方差相等）----------

/** ln Γ(x)，Lanczos 近似（x > 0）。 */
function lnGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** 不完全 Beta 函数的连分式（Numerical Recipes betacf）。 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b; const qap = a + 1; const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** 正则化不完全 Beta 函数 I_x(a, b)。 */
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betaContinuedFraction(a, b, x)) / a : 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Student t 分布的双侧 p：P(|T| ≥ |t|)，自由度 df（可为非整数）。 */
export function studentTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || !(df > 0)) return Number.NaN;
  return regularizedBeta(df / (df + t * t), df / 2, 0.5);
}

/** 双侧临界值 t*：P(|T| ≥ t*) = alpha（二分法）。 */
export function studentCritical(df: number, alpha = 0.05): number {
  let lo = 0; let hi = 1e4;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (studentTwoSidedP(mid, df) > alpha) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface WelchResult {
  nA: number; nB: number;
  meanA: number | null; meanB: number | null;
  sdA: number | null; sdB: number | null;
  /** meanA − meanB */
  diff: number | null;
  t: number; df: number; p: number;
  /** 均值差的 95% 置信区间（Welch）。 */
  ci95: [number, number] | null;
  /** 效应量 Hedges g（合并标准差、小样本校正）。 */
  hedgesG: number | null;
}

/** Welch 两样本 t 检验（双侧）：A = 实验组（正样本），B = 对照组。任一组少于 2 个或方差都为 0 → t、p 为 NaN。 */
export function welchTTest(a: readonly number[], b: readonly number[]): WelchResult {
  const nA = a.length; const nB = b.length;
  const meanA = meanOf(a); const meanB = meanOf(b);
  const variance = (xs: readonly number[], m: number | null) => (m != null && xs.length > 1 ? xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1) : null);
  const vA = variance(a, meanA); const vB = variance(b, meanB);
  const diff = meanA != null && meanB != null ? meanA - meanB : null;
  const base = { nA, nB, meanA, meanB, sdA: vA == null ? null : Math.sqrt(vA), sdB: vB == null ? null : Math.sqrt(vB), diff };
  if (diff == null || vA == null || vB == null) return { ...base, t: Number.NaN, df: Number.NaN, p: Number.NaN, ci95: null, hedgesG: null };
  const seA = vA / nA; const seB = vB / nB;
  const se = Math.sqrt(seA + seB);
  if (!(se > 0)) return { ...base, t: Number.NaN, df: Number.NaN, p: Number.NaN, ci95: null, hedgesG: null };
  const t = diff / se;
  const df = (seA + seB) ** 2 / (seA ** 2 / (nA - 1) + seB ** 2 / (nB - 1));
  const crit = studentCritical(df);
  const pooled = Math.sqrt(((nA - 1) * vA + (nB - 1) * vB) / (nA + nB - 2));
  const hedgesG = pooled > 0 ? (diff / pooled) * (1 - 3 / (4 * (nA + nB) - 9)) : null;
  return { ...base, t, df, p: studentTwoSidedP(t, df), ci95: [diff - crit * se, diff + crit * se], hedgesG };
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const meanOf = (xs: readonly number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

// ===================== 结果结构 =====================

export interface DistributionRow {
  feature: DeepDiveFeatureKey;
  group: 'all' | 'campaign' | 'background' | 'positive' | 'control';
  n: number;
  mean: number | null;
  median: number | null;
  q25: number | null;
  q75: number | null;
  sharePositive: number | null;
}

export interface AssociationRow {
  feature: DeepDiveFeatureKey;
  target: DeepDiveTargetKey;
  n: number;
  rho: number;
  ci: [number, number] | null;
  p: number;
  pHolm: number;
  /** 控制观察窗波动率 vol_w 后的偏 Spearman 与其置换 p（不进 Holm 族，只回答「是不是波动率」）。 */
  rhoPartialVol: number;
  pPartialVol: number;
}

export interface ConfirmationRow {
  feature: DeepDiveFeatureKey;
  target: DeepDiveTargetKey;
  discoveryRho: number;
  n: number;
  rho: number;
  /** 按发现集的方向做单侧检验。 */
  p: number;
  pHolm: number;
  rhoPartialVol: number;
  pPartialVol: number;
  verdict: '已验证' | '检验未获支持';
  /** 控制波动率后在确认集上同方向且 p < 0.05。 */
  survivesVolControl: boolean;
}

export interface QuintileBin {
  q: number;
  n: number;
  lo: number | null;
  hi: number | null;
  means: Record<DeepDiveTargetKey, number | null>;
  ci: Record<DeepDiveTargetKey, [number, number] | null>;
}

export interface LabelRow {
  feature: DeepDiveFeatureKey;
  nPos: number;
  nCtl: number;
  auc: number;
  ci: [number, number] | null;
  p: number;
  pHolm: number;
  posMedian: number | null;
  ctlMedian: number | null;
}

export type TTestVerdict = '差异显著' | '差异不显著';
export interface TTestRow extends WelchResult {
  feature: DeepDiveFeatureKey;
  /** 三个特征整族 Holm。 */
  pHolm: number;
  verdict: TTestVerdict;
  /** 同一检验分别在发现期 / 确认期上算一遍（描述，看方向是否一致）。 */
  byPeriod: { discovery: WelchResult; confirmation: WelchResult };
}

export interface InteractionCell {
  price: 'above' | 'below';
  flow: 'buy' | 'sell';
  n: number;
  means: Record<DeepDiveTargetKey, number | null>;
  nPos: number;
  nCtl: number;
}

export interface FeatureDeepDiveResult {
  /** 哪一项研究；旧版（第 6 步）结果没有这一项。 */
  study?: DeepDiveStudyId;
  codeVersion: string;
  startedAt: number;
  finishedAt: number;
  seed: number;
  permutations: number;
  bootstrap: number;
  primaryH: number;
  coverage: {
    campaigns: number;
    clusters: number;
    events: number;
    campaignEvents: number;
    background: number;
    labeled: { positive: number; control: number };
    failed: CollectedEvents['failed'];
    lowCoverage: number;
    outcomeMissing: number;
    missingTakerEvents: number;
    fallbackAvailable: number;
    /** 主半衰期下任一特征缺失的事件数（第 7 步：成交额覆盖不足）。旧结果没有。 */
    featureMissing?: number;
    discovery: number;
    confirmation: number;
    embargoed: number;
    confirmationCut: number | null;
  };
  distribution: DistributionRow[];
  association: AssociationRow[];
  confirmation: ConfirmationRow[];
  quintiles: { feature: DeepDiveFeatureKey; cuts: number[]; bins: QuintileBin[] }[];
  labels: LabelRow[];
  robustness: {
    bySubset: { feature: DeepDiveFeatureKey; target: DeepDiveTargetKey; subset: 'campaign' | 'background'; n: number; rho: number }[];
    byHalfLife: { feature: DeepDiveFeatureKey; target: DeepDiveTargetKey; h: number; n: number; rho: number }[];
  };
  interaction: InteractionCell[];
  /** H 节：实验组（正样本）vs 对照组的 Welch t 检验；只有 study.groupTTest 的研究有。 */
  tTests?: TTestRow[];
  conclusions: { verified: { feature: DeepDiveFeatureKey; target: DeepDiveTargetKey; survivesVolControl: boolean }[] };
}

// ===================== 分析 =====================

export interface DeepDiveOptions {
  seed?: number;
  permutations?: number;
  bootstrap?: number;
  /** 默认第 6 步。 */
  study?: DeepDiveStudy;
}

const featureOf = (e: RunEvent, key: DeepDiveFeatureKey, h = DEEP_DIVE_PRIMARY_H): number | null => {
  const v = e.featuresByH[h]?.[key];
  return finite(v) ? v : null;
};
const targetOf = (e: RunEvent, key: DeepDiveTargetKey): number | null => (finite(e[key]) ? e[key] : null);
const volOf = (e: RunEvent): number | null => featureOf(e, 'vol_w' as DeepDiveFeatureKey);

/** 同一批事件上的配对样本（特征、结果、波动率、时间块、标的都有）。 */
function paired(events: readonly RunEvent[], feature: DeepDiveFeatureKey, target: DeepDiveTargetKey, h = DEEP_DIVE_PRIMARY_H) {
  const rows = events.flatMap(e => {
    const x = featureOf(e, feature, h);
    const y = targetOf(e, target);
    const z = volOf(e);
    return x != null && y != null && z != null ? [{ x, y, z, block: e.block ?? '', symbol: e.symbol }] : [];
  });
  return { x: rows.map(r => r.x), y: rows.map(r => r.y), z: rows.map(r => r.z), blocks: rows.map(r => r.block), symbols: rows.map(r => r.symbol) };
}

/** 纯计算：给定事件与时间切分，产出全部分析（不拉数据，便于测试）。 */
export function analyzeFeatureDeepDive(
  events: readonly RunEvent[],
  options: DeepDiveOptions = {},
): Omit<FeatureDeepDiveResult, 'codeVersion' | 'startedAt' | 'finishedAt' | 'coverage'> & { split: ReturnType<typeof chronologicalSplit<RunEvent>> } {
  const seed = options.seed ?? 20261015;
  const permutations = options.permutations ?? 1999;
  const bootstrap = options.bootstrap ?? 999;
  const study = options.study ?? FEATURES_STUDY;
  const FEATURES = study.features;
  const split = chronologicalSplit(events);
  const discovery = [...split.train, ...split.val];
  const confirmationSet = split.test;
  let seedStep = 0;
  const nextSeed = () => seed + 7919 * ++seedStep;

  // A. 分布（全部事件，主 h）
  const groups: { group: DistributionRow['group']; pick: (e: RunEvent) => boolean }[] = [
    { group: 'all', pick: () => true },
    { group: 'campaign', pick: e => e.kind === 'event' },
    { group: 'background', pick: e => e.kind === 'background' },
    { group: 'positive', pick: e => e.label === 'positive' },
    { group: 'control', pick: e => e.label === 'control' },
  ];
  const distribution: DistributionRow[] = FEATURES.flatMap(f => groups.map(({ group, pick }) => {
    const vals = events.filter(pick).map(e => featureOf(e, f.key)).filter(finite).sort((a, b) => a - b);
    return {
      feature: f.key, group, n: vals.length, mean: meanOf(vals), median: quantile(vals, 0.5),
      q25: quantile(vals, 0.25), q75: quantile(vals, 0.75),
      sharePositive: vals.length ? vals.filter(v => v > 0).length / vals.length : null,
    };
  }));

  // B. 发现集：12 个主检验
  const assocRaw = FEATURES.flatMap(f => DEEP_DIVE_TARGETS.map(t => {
    const d = paired(discovery, f.key, t.key);
    const stat = spearmanAgainst(d.x);
    const partial = partialSpearmanAgainst(d.x, d.z);
    const rho = stat(d.y);
    const p = permutationP(stat, d.y, d.blocks, { permutations, seed: nextSeed() });
    const ci = clusterBootstrapCi(idx => spearman(idx.map(i => d.x[i]), idx.map(i => d.y[i])), d.symbols, { reps: bootstrap, seed: nextSeed() });
    const rhoPartialVol = partial(d.y);
    const pPartialVol = permutationP(partial, d.y, d.blocks, { permutations, seed: nextSeed() });
    return { feature: f.key, target: t.key, n: d.x.length, rho, ci, p, rhoPartialVol, pPartialVol };
  }));
  const holm = holmAdjust(assocRaw.map(r => r.p));
  const association: AssociationRow[] = assocRaw.map((r, i) => ({ ...r, pHolm: holm[i] }));

  // C. 确认集：发现集通过的，同方向单侧检验，再 Holm
  const passed = association.filter(r => Number.isFinite(r.pHolm) && r.pHolm < DEEP_DIVE_ALPHA && Number.isFinite(r.rho) && r.rho !== 0);
  const confRaw = passed.map(r => {
    const d = paired(confirmationSet, r.feature, r.target);
    const tail: Tail = r.rho > 0 ? 'greater' : 'less';
    const stat = spearmanAgainst(d.x);
    const partial = partialSpearmanAgainst(d.x, d.z);
    const rho = stat(d.y);
    const p = permutationP(stat, d.y, d.blocks, { permutations, seed: nextSeed(), tail });
    const rhoPartialVol = partial(d.y);
    const pPartialVol = permutationP(partial, d.y, d.blocks, { permutations, seed: nextSeed(), tail });
    return { feature: r.feature, target: r.target, discoveryRho: r.rho, n: d.x.length, rho, p, rhoPartialVol, pPartialVol };
  });
  const confHolm = holmAdjust(confRaw.map(r => r.p));
  const confirmation: ConfirmationRow[] = confRaw.map((r, i) => {
    const sameSign = Number.isFinite(r.rho) && Math.sign(r.rho) === Math.sign(r.discoveryRho);
    return {
      ...r, pHolm: confHolm[i],
      verdict: sameSign && confHolm[i] < DEEP_DIVE_ALPHA ? '已验证' : '检验未获支持',
      survivesVolControl: Number.isFinite(r.rhoPartialVol) && Math.sign(r.rhoPartialVol) === Math.sign(r.discoveryRho) && r.pPartialVol < DEEP_DIVE_ALPHA,
    };
  });

  // D. 五分位分档：切点取发现集，档内结果均值用全部事件（描述）
  const quintiles = FEATURES.map(f => {
    const ref = discovery.map(e => featureOf(e, f.key)).filter(finite).sort((a, b) => a - b);
    const cuts = [0.2, 0.4, 0.6, 0.8].map(q => quantile(ref, q)).filter(finite);
    const binOf = (v: number) => cuts.filter(c => v >= c).length;
    const bins: QuintileBin[] = cuts.length === 4 ? [0, 1, 2, 3, 4].map(q => {
      const members = events.filter(e => { const v = featureOf(e, f.key); return v != null && binOf(v) === q; });
      const means = {} as Record<DeepDiveTargetKey, number | null>;
      const ci = {} as Record<DeepDiveTargetKey, [number, number] | null>;
      for (const t of DEEP_DIVE_TARGETS) {
        const ys = members.map(e => targetOf(e, t.key));
        const valid = members.filter((_, i) => ys[i] != null);
        const vals = ys.filter(finite);
        means[t.key] = meanOf(vals);
        ci[t.key] = clusterBootstrapCi(idx => meanOf(idx.map(i => vals[i])) ?? Number.NaN, valid.map(e => e.symbol), { reps: bootstrap, seed: nextSeed() });
      }
      const vals = members.map(e => featureOf(e, f.key)).filter(finite);
      return { q: q + 1, n: members.length, lo: vals.length ? Math.min(...vals) : null, hi: vals.length ? Math.max(...vals) : null, means, ci };
    }) : [];
    return { feature: f.key, cuts, bins };
  });

  // E. 标签：正 vs 对照（全部时间段）
  const labelRaw = FEATURES.map(f => {
    const rows = events.flatMap(e => {
      const v = featureOf(e, f.key);
      return v != null && (e.label === 'positive' || e.label === 'control') ? [{ v, pos: e.label === 'positive', symbol: e.symbol }] : [];
    });
    const pos = rows.filter(r => r.pos).map(r => r.v);
    const ctl = rows.filter(r => !r.pos).map(r => r.v);
    const value = auc(pos, ctl);
    // 置换：打乱正 / 对照标签（不分块：标签事件只有一百来个，再分块就没有可换的了）
    const flags = rows.map(r => (r.pos ? 1 : 0));
    const values = rows.map(r => r.v);
    const stat = (f2: readonly number[]) => auc(values.filter((_, i) => f2[i] === 1), values.filter((_, i) => f2[i] === 0)) - 0.5;
    const p = permutationP(stat, flags, rows.map(() => ''), { permutations, seed: nextSeed() });
    const ci = clusterBootstrapCi(idx => auc(idx.filter(i => rows[i].pos).map(i => rows[i].v), idx.filter(i => !rows[i].pos).map(i => rows[i].v)),
      rows.map(r => r.symbol), { reps: bootstrap, seed: nextSeed() });
    const sp = [...pos].sort((a, b) => a - b);
    const sc = [...ctl].sort((a, b) => a - b);
    return { feature: f.key, nPos: pos.length, nCtl: ctl.length, auc: value, ci, p, posMedian: quantile(sp, 0.5), ctlMedian: quantile(sc, 0.5) };
  });
  const labelHolm = holmAdjust(labelRaw.map(r => r.p));
  const labels: LabelRow[] = labelRaw.map((r, i) => ({ ...r, pHolm: labelHolm[i] }));

  // F. 稳健性（描述）：战役 / 背景子集；半衰期敏感性
  const bySubset = FEATURES.flatMap(f => DEEP_DIVE_TARGETS.flatMap(t => (['campaign', 'background'] as const).map(subset => {
    const d = paired(discovery.filter(e => (subset === 'campaign' ? e.kind === 'event' : e.kind === 'background')), f.key, t.key);
    return { feature: f.key, target: t.key, subset, n: d.x.length, rho: spearman(d.x, d.y) };
  })));
  const byHalfLife = FEATURES.filter(f => f.weighted).flatMap(f => DEEP_DIVE_TARGETS.flatMap(t => DEEP_DIVE_SENSITIVITY_H.map(h => {
    const d = paired(discovery, f.key, t.key, h);
    return { feature: f.key, target: t.key, h, n: d.x.length, rho: spearman(d.x, d.y) };
  })));

  // G. 交叉（全部事件，描述）：第 6 步 = 现价在 12h VWAP 上 / 下 × 近期主动买 / 卖占优；第 7 步 = 现价在 DSP 上 / 下 × 谢林点上移 / 下移
  const interaction: InteractionCell[] = (['above', 'below'] as const).flatMap(price => (['buy', 'sell'] as const).map(flow => {
    const members = events.filter(e => {
      const dev = featureOf(e, study.interaction.first.key);
      const imb = featureOf(e, study.interaction.second.key);
      return dev != null && imb != null && (price === 'above' ? dev > 0 : dev <= 0) && (flow === 'buy' ? imb > 0 : imb <= 0);
    });
    const means = Object.fromEntries(DEEP_DIVE_TARGETS.map(t => [t.key, meanOf(members.map(e => targetOf(e, t.key)).filter(finite))])) as Record<DeepDiveTargetKey, number | null>;
    return { price, flow, n: members.length, means, nPos: members.filter(e => e.label === 'positive').length, nCtl: members.filter(e => e.label === 'control').length };
  }));

  // H. 实验组（正样本）vs 对照组：Welch 两样本 t 检验（双侧），全部时间段，三个特征整族 Holm
  let tTests: TTestRow[] | undefined;
  if (study.groupTTest) {
    const groupValues = (pool: readonly RunEvent[], key: DeepDiveFeatureKey, label: 'positive' | 'control') =>
      pool.filter(e => e.label === label).map(e => featureOf(e, key)).filter(finite);
    const tRaw = FEATURES.map(f => ({
      feature: f.key,
      ...welchTTest(groupValues(events, f.key, 'positive'), groupValues(events, f.key, 'control')),
      byPeriod: {
        discovery: welchTTest(groupValues(discovery, f.key, 'positive'), groupValues(discovery, f.key, 'control')),
        confirmation: welchTTest(groupValues(confirmationSet, f.key, 'positive'), groupValues(confirmationSet, f.key, 'control')),
      },
    }));
    const tHolm = holmAdjust(tRaw.map(r => r.p));
    tTests = tRaw.map((r, i) => ({ ...r, pHolm: tHolm[i], verdict: Number.isFinite(tHolm[i]) && tHolm[i] < DEEP_DIVE_ALPHA ? '差异显著' : '差异不显著' }));
  }

  return {
    study: study.id, seed, permutations, bootstrap, primaryH: DEEP_DIVE_PRIMARY_H, ...(tTests ? { tTests } : {}),
    distribution, association, confirmation, quintiles, labels,
    robustness: { bySubset, byHalfLife }, interaction,
    conclusions: { verified: confirmation.filter(r => r.verdict === '已验证').map(r => ({ feature: r.feature, target: r.target, survivesVolControl: r.survivesVolControl })) },
    split,
  };
}

/** 一键：取数（与第 3–5 步同一批事件）→ 分析。 */
export async function runFeatureDeepDive(
  report: CampaignGroupReport,
  options: DeepDiveOptions & Pick<RunOptions, 'fetchFn' | 'signal' | 'onProgress' | 'concurrency' | 'backgroundCap'> = {},
): Promise<FeatureDeepDiveResult> {
  const startedAt = Date.now();
  const collected = await collectRunEvents(report, options);
  options.onProgress?.({ stage: 'rsa', done: 0, total: 1 });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  const { split, ...analysis } = analyzeFeatureDeepDive(collected.events, options);
  options.onProgress?.({ stage: 'done', done: 1, total: 1 });
  const events = collected.events;
  return {
    codeVersion: CODE_VERSION,
    startedAt,
    finishedAt: Date.now(),
    ...analysis,
    coverage: {
      campaigns: collected.campaigns,
      clusters: collected.clusters,
      events: events.length,
      campaignEvents: events.filter(e => e.kind === 'event').length,
      background: events.filter(e => e.kind === 'background').length,
      labeled: { positive: events.filter(e => e.label === 'positive').length, control: events.filter(e => e.label === 'control').length },
      failed: collected.failed,
      lowCoverage: collected.lowCoverage,
      outcomeMissing: collected.outcomeMissing,
      missingTakerEvents: collected.missingTakerEvents,
      fallbackAvailable: events.filter(e => finite(e.featuresByH[DEEP_DIVE_PRIMARY_H]?.fallback_dev)).length,
      featureMissing: events.filter(e => (options.study ?? FEATURES_STUDY).features.some(f => !finite(e.featuresByH[DEEP_DIVE_PRIMARY_H]?.[f.key]))).length,
      discovery: split.train.length + split.val.length,
      confirmation: split.test.length,
      embargoed: split.embargoed.length,
      confirmationCut: split.cutoffs.test,
    },
  };
}
