/**
 * 交易战役指标的字母表：每个指标一个字母（已有的沿用，没有的补上），交易战役与 Deep dig 共用这一份。
 *
 * 【用户要求】2026-10-16「给交易战役中的每个指标赋予一个字母，如果当下已经有字母，那就用现有的字母，如果没有，要赋予字母。
 * 并且在交易战役中、deep dig 中，都要有个表格，要统一」。字母方案经用户确认：
 *   已有沿用：d 预期回撤、G 单位涨幅、U 单位利润、W 仓位利润、E 算术期望、η 首仓涨跌幅倍数、L₀ 最大预期亏损、w L_磨损（÷ L₀）；
 *   冲突的处理：b = 盈亏比（沿用 bᵢ），神奇的 b = B（理论值 Bₜ）；首仓币数保留 Q（公式里用）。【用户要求】2026-10-17 机会质量（原 q）删除。
 * 下标 ₜ = 理论值。希腊字母 / 下标另有拼写，便于在分组标准里输入：η → eta，λ → lev，L₀ → L0，Bₜ → Bt，Mₜ → Mt，Wₜ → Wt。
 * 信号库的「信号评分 s」不是战役指标：它属于每一条信号，时间点是那条信号自己的时间。
 */
import { computeMagicB } from '@/lib/campaignGeometricMetrics';
import { computeCampaignExpectanciesFromMagicB } from '@/lib/campaignMetrics';
import {
  campaignLeverage, rowAddCount, rowAddEfficiency, rowEffectivePriceChangePct, rowExecutionWearR, rowGeometricGrowth, rowMagicB,
  rowMainPriceEfficiency, rowMirrorTpRank, rowPayoffRatio, rowPositionAmplification, rowPositionGeometricMultiple,
  rowPositionGeometricMultipleTheoretical, rowPositionProfit, rowPositionProfitTheoretical, rowRelativePriceChange, rowUnitProfit,
  rowUnitRise, rowUnrealizedPriceChangePct,
} from '@/lib/campaignListSort';
import type { CampaignCardData } from '@/lib/campaignListCache';

export type MetricSource = 'campaign' | 'signal';

export interface MetricLetter {
  /** 显示的字母（可能带下标或是希腊字母）。 */
  letter: string;
  /** 在分组标准里也可以这样写（ASCII）。 */
  aliases: readonly string[];
  name: string;
  unit: string;
  /** 一句话算法。 */
  help: string;
  source: MetricSource;
  /** 封面卡片上对应的格子（CARD_METRIC_LABEL 的键）。 */
  cardMode?: string;
  /** 盈亏概览里对应的项（CampaignPnlOverviewItem.key）。 */
  overviewKey?: string;
  /** 从战役行取值；取不到为 null。 */
  get?: (row: CampaignCardData) => number | null;
}

const num = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : null);
const safe = (f: (row: CampaignCardData) => number | null | undefined) => (row: CampaignCardData) => {
  try { return num(f(row)); } catch { return null; }
};

export const CAMPAIGN_METRIC_LETTERS: readonly MetricLetter[] = [
  { letter: 'd', aliases: [], name: '预期回撤', unit: '%', help: '首仓开仓价到初始止损价的回撤幅度', source: 'campaign', cardMode: 'expectedDrawdownPct', overviewKey: 'expectedMaxDrawdownPct', get: safe(r => (r.initialExpectedMaxDrawdownPct > 0 ? r.initialExpectedMaxDrawdownPct : null)) },
  { letter: 'G', aliases: [], name: '相对涨幅', unit: '×', help: 'G = (F − Kₘ) ÷ (E − K初)：离场价相对最后支撑的涨幅，以首仓风险距离为单位', source: 'campaign', cardMode: 'effectivePriceChangePct', overviewKey: 'effectivePriceChangePct', get: safe(rowRelativePriceChange) },
  { letter: 'n', aliases: [], name: '加仓次数', unit: '次', help: '主力加仓的次数', source: 'campaign', cardMode: 'addCount', overviewKey: 'addCount', get: safe(rowAddCount) },
  { letter: 'M', aliases: [], name: '几何仓位', unit: 'x', help: '(1 − αf) × ∏(1 + αₖ)：加仓后相对首仓的几何仓位倍数（实际）', source: 'campaign', cardMode: 'positionGeometricMultiple', overviewKey: 'positionGeometricMultiple', get: safe(rowPositionGeometricMultiple) },
  { letter: 'Mₜ', aliases: ['Mt'], name: '几何仓位（理论）', unit: 'x', help: '按理论加仓系数算的几何仓位', source: 'campaign', get: safe(rowPositionGeometricMultipleTheoretical) },
  { letter: 'B', aliases: [], name: '神奇的 b', unit: '×', help: '几何仓位 × 相对涨幅（实际）', source: 'campaign', cardMode: 'magicB', overviewKey: 'magicB', get: safe(rowMagicB) },
  { letter: 'Bₜ', aliases: ['Bt'], name: '神奇的 b（理论）', unit: '×', help: '几何仓位（理论）× 相对涨幅；没有加仓的战役没有这个读数', source: 'campaign', get: safe(r => computeMagicB(rowEffectivePriceChangePct(r), rowPositionGeometricMultipleTheoretical(r))) },
  { letter: 'b', aliases: [], name: '盈亏比', unit: '×', help: '已实现净盈亏 ÷ L₀', source: 'campaign', cardMode: 'captureRate', overviewKey: 'payoffRatio', get: safe(rowPayoffRatio) },
  { letter: 'w', aliases: [], name: 'L_磨损', unit: 'R', help: 'L_磨损 ÷ L₀：中途对冲的损益 + 最终对冲的价差 / 数量磨损', source: 'campaign', cardMode: 'executionWear', overviewKey: 'executionWear', get: safe(rowExecutionWearR) },
  { letter: 'g', aliases: [], name: '几何期望', unit: '倍', help: '1 + 0.1 × b（方法一，按盈亏比）；1.00 = 不赚不亏', source: 'campaign', cardMode: 'geometricExpectancy', overviewKey: 'geometricExpectancy', get: safe(rowGeometricGrowth) },
  { letter: 'A', aliases: [], name: '仓位放大', unit: 'x', help: '(主方向总名义仓位 − 镜像止盈名义仓位) ÷ 主力开仓名义仓位', source: 'campaign', cardMode: 'positionAmplification', overviewKey: 'positionAmplification', get: safe(rowPositionAmplification) },
  { letter: 'y', aliases: [], name: '加仓效用', unit: '×', help: 'b ÷ |η|：每单位首仓涨跌幅换来多少盈亏比', source: 'campaign', cardMode: 'addEfficiency', overviewKey: 'addEfficiency', get: safe(rowAddEfficiency) },
  { letter: 'E', aliases: [], name: '算术期望', unit: 'R', help: 'Eᵢ = 50% × b − 50%', source: 'campaign', cardMode: 'arithmeticExpectancy', overviewKey: 'arithmeticExpectancy', get: safe(r => computeCampaignExpectanciesFromMagicB(rowPayoffRatio(r)).arithmeticExpectancy) },
  { letter: 'ΔP', aliases: ['deltaP'], name: '单位涨幅', unit: 'U/币', help: 'ΔP = F − Kₘ：离场价减最后支撑', source: 'campaign', cardMode: 'unitRise', overviewKey: 'unitRise', get: safe(rowUnitRise) },
  { letter: 'U', aliases: [], name: '单位利润', unit: 'USDT', help: 'U = Q × ΔP（Q = 首仓币数）', source: 'campaign', cardMode: 'unitProfit', overviewKey: 'unitProfit', get: safe(rowUnitProfit) },
  { letter: 'W', aliases: [], name: '仓位利润', unit: 'USDT', help: 'W = U × 几何仓位（实际）', source: 'campaign', cardMode: 'positionProfit', overviewKey: 'positionProfit', get: safe(rowPositionProfit) },
  { letter: 'Wₜ', aliases: ['Wt'], name: '仓位利润（理论）', unit: 'USDT', help: 'U × 几何仓位（理论）', source: 'campaign', get: safe(rowPositionProfitTheoretical) },
  { letter: 'c', aliases: [], name: '首仓涨跌幅', unit: '%', help: '首仓从开仓到平仓的涨跌幅（按主力方向记正负）；主力未平时没有', source: 'campaign', cardMode: 'mainPriceChange', overviewKey: 'mainPriceChange', get: safe(r => r.mainPriceChangePct) },
  { letter: 'η', aliases: ['eta'], name: '首仓涨跌幅倍数', unit: '×', help: 'η = 首仓涨跌幅 ÷ 预期回撤', source: 'campaign', cardMode: 'mainPriceEfficiency', overviewKey: 'mainPriceEfficiency', get: safe(rowMainPriceEfficiency) },
  { letter: 'z', aliases: [], name: '涨幅未兑现', unit: '%', help: '峰值涨幅 − 首仓涨跌幅（要先算出峰值涨幅）', source: 'campaign', cardMode: 'unrealizedPriceChangePct', overviewKey: 'unrealizedPriceChangePct', get: safe(rowUnrealizedPriceChangePct) },
  { letter: 'T', aliases: [], name: '镜像止盈', unit: '级', help: '镜像止盈的结果等级 0–5（0 = 未实现）', source: 'campaign', cardMode: 'mirrorTp', get: safe(rowMirrorTpRank) },
  { letter: 'L₀', aliases: ['L0'], name: '最大预期亏损', unit: 'USDT', help: '主力开仓名义仓位 × 预期回撤比例：入场时在初始对冲风险边界下的最大亏损', source: 'campaign', overviewKey: 'initialExpectedMaxLoss', get: safe(r => r.initialExpectedMaxLoss) },
  { letter: 'p', aliases: [], name: '已实现 P&L', unit: 'USDT', help: '整场战役已实现的净盈亏', source: 'campaign', overviewKey: 'realizedPnl', get: safe(r => r.campaign.final_realized_pnl) },
  { letter: 'h', aliases: [], name: '峰值涨幅', unit: '%', help: '持仓期间首仓的最大浮动涨幅（按 K 线算，交易战役列表算过才有）', source: 'campaign', overviewKey: 'peakPriceChange', get: safe(r => r.peakPriceChangePct) },
  { letter: 'D', aliases: [], name: '动态最大回撤', unit: '%', help: '持仓期间此前峰值到此后谷值的最大跌幅（按 K 线算，交易战役列表算过才有）', source: 'campaign', cardMode: 'dynamicMaxDrawdownPct', overviewKey: 'dynamicMaxDrawdownPct', get: safe(r => r.dynamicMaxDrawdownPct) },
  // 【用户要求】2026-10-26 静态最大回撤；下标 ₛ = 静态
  { letter: 'Dₛ', aliases: ['Ds'], name: '静态最大回撤', unit: '%', help: '持仓期间最不利价格离买入价的跌幅 ÷ 买入价（主多看最低价、主空看最高价；按 K 线算，交易战役列表算过才有）', source: 'campaign', cardMode: 'staticMaxDrawdownPct', overviewKey: 'staticMaxDrawdownPct', get: safe(r => r.staticMaxDrawdownPct) },
  { letter: 'λ', aliases: ['lev'], name: '杠杆倍数', unit: 'x', help: '主力开仓时的初始杠杆（老战役取各腿最大杠杆）', source: 'campaign', overviewKey: 'mainLeverage', get: safe(r => campaignLeverage(r.campaign, r.legs)) },
  { letter: 'i', aliases: [], name: '自评', unit: '级', help: '战役封面上的自评 1–5', source: 'campaign', get: safe(r => r.campaign.importance_weight) },
  { letter: 's', aliases: [], name: '信号评分', unit: '级', help: '信号库里这条信号的星级 1–5；没评分 = 空。属于信号本身，时间点是那条信号的时间', source: 'signal' },
];

export const METRIC_BY_LETTER = new Map(CAMPAIGN_METRIC_LETTERS.map(m => [m.letter, m]));
export const LETTER_BY_CARD_MODE = new Map(CAMPAIGN_METRIC_LETTERS.filter(m => m.cardMode).map(m => [m.cardMode!, m.letter]));
export const LETTER_BY_OVERVIEW_KEY = new Map(CAMPAIGN_METRIC_LETTERS.filter(m => m.overviewKey).map(m => [m.overviewKey!, m.letter]));

/** 一场战役所有字母的读数（交易战役指标；信号评分不在这里）。 */
export function campaignLetterValues(row: CampaignCardData): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const m of CAMPAIGN_METRIC_LETTERS) if (m.get) out[m.letter] = m.get(row);
  return out;
}

/** 一个字母在一批样本里的读数范围（写分组条件时用同样的单位）。 */
export interface LetterRange {
  min: number;
  max: number;
  median: number;
  /** 有读数的个数。 */
  n: number;
  /** 样本总数。 */
  total: number;
}

/**
 * 【用户要求】2026-10-18「我想知道每个指标可以输入的数值范围，请你在表格中补充」：
 * 按本机样本算每个字母的最小 ~ 最大、中位数、有读数的个数（没有读数的字母 n = 0）。
 */
export function letterRanges(rows: readonly Readonly<Record<string, number | null | undefined>>[], letters: readonly string[]): Record<string, LetterRange> {
  const out: Record<string, LetterRange> = {};
  for (const letter of letters) {
    const vals = rows.map(r => r[letter]).filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    const h = vals.length >> 1;
    out[letter] = {
      min: vals[0] ?? Number.NaN,
      max: vals[vals.length - 1] ?? Number.NaN,
      median: vals.length === 0 ? Number.NaN : vals.length % 2 ? vals[h] : (vals[h - 1] + vals[h]) / 2,
      n: vals.length,
      total: rows.length,
    };
  }
  return out;
}

/** 范围里的数：整数照写，其余按大小留 0–3 位小数。 */
export function formatRangeValue(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  const text = v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3);
  return Number(text) === 0 ? text.replace('-', '') : text;
}
