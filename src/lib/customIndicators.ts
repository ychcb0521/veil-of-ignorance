import { accountResearchIndicators, researchDefaultPeriod, type ResearchIndicator } from '@/lib/researchIndicators';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { accountFeatureDefs } from '@/lib/featureSource';
import { CTBA_DEFAULTS } from '@/lib/ctba';
import { computeCba2, CBA2_DEFAULTS } from '@/lib/cba2';
/**
 * Custom indicator registration for klinecharts using the `technicalindicators` NPM library.
 * Bridges indicators not built into klinecharts by registering them via registerIndicator().
 */

import { registerIndicator as registerKcIndicator, type IndicatorTemplate, type IndicatorCreateTooltipDataSourceParams, type IndicatorSeries, type IndicatorTooltipData, type KLineData } from 'klinecharts';
import { computeDsp, DSP_BASE_INTERVAL_MS, DSP_DEFAULTS, DSP_V_DISPLAY_SCALE, DSP_VZ_DISPLAY_SCALE, DSP_Z_WINDOW_HOURS, dspHalfLifeForInterval, inferIntervalMs } from '@/lib/dynamicSchellingPoint';
import { BSS_DEFAULTS, BSS_STRONG, BSS_WEAK, computeBss } from '@/lib/bss';
import { CBA_DEFAULTS, computeCba } from '@/lib/cba';
import { CBI_DEFAULTS, computeCbi } from '@/lib/cbi';
import { CBI2_DEFAULTS, computeCbi2 } from '@/lib/cbi2';
import { MBI_N } from '@/lib/mbi';
import { mbi2StateLabel } from '@/lib/mbi2';
import { chartFeatureSeries, accountFeatureDef, chartFeatureDef, sameCoreAsBuiltin, ctbaChartParameterText } from '@/lib/featureSource';
import { RESEARCH_INDICATORS, BUYER_RESEARCH_INDICATORS, CUSTOM_RESEARCH_INDICATORS, researchKcName, researchIndicatorForKc, researchChartSeries, researchDefinitionVersion, researchSeriesNames } from '@/lib/researchIndicators';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { researchHistoryVersion } from '@/lib/researchChartHistory';
import { btcClosesAt, btcReferenceVersion, requestBtcReference } from '@/lib/btcReference';
import { barsForHours, rollingMean } from '@/lib/deepDig/formula';
import { AVG_HIGHLIGHT_SPECS, AVG_HIGHLIGHT_COLORS, type AverageKind } from '@/lib/avgHighlight';
import { avgCalibrationContext, avgCalibrationVersion } from '@/lib/avgHighlightClient';
import { drawChartLine } from './drawChartLine';
import { averageAreaColor, drawAverageArea } from './drawAverageArea';
import {
  ADX, VWAP, BollingerBands, Stochastic, IchimokuCloud,
  StochasticRSI, ADL, ForceIndex, AwesomeOscillator, CCI as CCI_TI,
  PSAR, KeltnerChannels, WilliamsR, MFI as MFI_TI,
} from 'technicalindicators';

// Helper: extract arrays from KLineData
function closes(data: KLineData[]) { return data.map(d => d.close); }
function highs(data: KLineData[]) { return data.map(d => d.high); }
function lows(data: KLineData[]) { return data.map(d => d.low); }
function volumes(data: KLineData[]) { return data.map(d => d.volume); }

/** Simple EMA helper for custom calcs */
function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    if (i === 0) { result.push(prev); continue; }
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

/** Simple SMA helper */
function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    result.push(i >= period - 1 ? sum / period : NaN);
  }
  return result;
}

/** DEMA = 2*EMA(n) - EMA(EMA(n)) */
function calcDEMA(values: number[], period: number): number[] {
  const e1 = ema(values, period);
  const e2 = ema(e1, period);
  return e1.map((v, i) => 2 * v - e2[i]);
}

/** TEMA = 3*EMA - 3*EMA(EMA) + EMA(EMA(EMA)) */
function calcTEMA(values: number[], period: number): number[] {
  const e1 = ema(values, period);
  const e2 = ema(e1, period);
  const e3 = ema(e2, period);
  return e1.map((v, i) => 3 * v - 3 * e2[i] + e3[i]);
}

/** Hull MA = WMA(2*WMA(n/2) - WMA(n), sqrt(n)) */
function calcHMA(values: number[], period: number): number[] {
  const half = Math.max(1, Math.floor(period / 2));
  const sqrtP = Math.max(1, Math.round(Math.sqrt(period)));
  const wma1 = calcWMA(values, half);
  const wma2 = calcWMA(values, period);
  const diff = wma1.map((v, i) => 2 * v - wma2[i]);
  return calcWMA(diff, sqrtP);
}

function calcWMA(values: number[], period: number): number[] {
  const result: number[] = [];
  const denom = (period * (period + 1)) / 2;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += values[i - period + 1 + j] * (j + 1);
    }
    result.push(sum / denom);
  }
  return result;
}

/**
 * 历史波动率（HV）的纯计算：对数收益的滚动样本方差 → 标准差 → 按周期年化（%）。
 *
 * - 收益 rᵢ = ln(closeᵢ / closeᵢ₋₁)；窗口 N 内取样本方差（n−1）。
 * - 年化：加密市场 7×24，全年毫秒数 ÷ 单根周期毫秒数 = 每年根数，σ_年 = σ_根 × √每年根数。
 * - 前 N 根与无效价格处返回 NaN（图上留空，不画假值）。
 * 导出以便单测：方差与年化两步都必须钉死。
 */
export function computeAnnualizedVolatility(
  closesArr: number[],
  period: number,
  intervalMs: number,
): number[] {
  const n = closesArr.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < 2 || period < 2 || !Number.isFinite(intervalMs) || intervalMs <= 0) return out;

  const MS_PER_YEAR = 365 * 24 * 3_600_000;
  const annualize = Math.sqrt(MS_PER_YEAR / intervalMs);

  const rets = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const prev = closesArr[i - 1];
    const cur = closesArr[i];
    if (prev > 0 && cur > 0) rets[i] = Math.log(cur / prev);
  }

  // 滚动 sum / sumsq：窗口内含 NaN 则该点不出数
  let sum = 0;
  let sumSq = 0;
  let nanCount = 0;
  for (let i = 1; i < n; i++) {
    const r = rets[i];
    if (Number.isFinite(r)) { sum += r; sumSq += r * r; } else nanCount++;
    const drop = i - period; // 移出窗口的下标（收益从 1 开始）
    if (drop >= 1) {
      const d = rets[drop];
      if (Number.isFinite(d)) { sum -= d; sumSq -= d * d; } else nanCount--;
    }
    const windowFull = i >= period;
    if (windowFull && nanCount === 0) {
      const mean = sum / period;
      const variance = Math.max(0, (sumSq - period * mean * mean) / (period - 1));
      out[i] = Math.sqrt(variance) * annualize * 100;
    }
  }
  return out;
}

/** klinecharts 数据 → DSP：成交额读 turnover，主动买入额读 takerBuyTurnover（toKLineData 写入）；h 按 5 分钟图计，按实际周期等比例缩放。 */
export function dspPoints(dataList: KLineData[], halfLifeHours: number | undefined, zscore = false) {
  const h = Number(halfLifeHours);
  const bars = dataList.map(d => ({
    time: d.timestamp,
    close: d.close,
    quoteVolume: typeof d.turnover === 'number' ? d.turnover : null,
    takerBuyQuoteVolume: typeof d.takerBuyTurnover === 'number' ? d.takerBuyTurnover as number : null,
  }));
  // 【用户要求】参数 h 是 5 分钟图上的半衰期；其他周期的记忆时间等比例缩放（每根 K 线的权重相同）
  const intervalMs = inferIntervalMs(bars) ?? DSP_BASE_INTERVAL_MS;
  const h5m = Number.isFinite(h) && h > 0 ? h : DSP_DEFAULTS.halfLifeHours;
  // 【用户要求】Z 分数版：σ 的窗口同样按 5 分钟图计（24 小时），其他周期等比例缩放
  return computeDsp(bars, {
    halfLifeHours: dspHalfLifeForInterval(h5m, intervalMs),
    ...(zscore ? { zWindowHours: dspHalfLifeForInterval(DSP_Z_WINDOW_HOURS, intervalMs) } : {}),
  }, intervalMs);
}

/** a / avg_a 副图里要画的值：Z 开关打开时用 Z 分数版（% 标准差 / 根），否则原始 a（基点 / 根）。 */
export function dspAValues(dataList: KLineData[], halfLifeHours: number | undefined, zscore: boolean): (number | null)[] {
  return dspPoints(dataList, halfLifeHours, zscore).map(p => {
    const x = zscore ? p.vz : p.v;
    return x == null ? null : x * (zscore ? DSP_VZ_DISPLAY_SCALE : DSP_V_DISPLAY_SCALE);
  });
}

/**
 * klinecharts 数据 → BSS（副图）。【用户要求】2026-10-18 新增。成交额读 turnover、主动买入额读 takerBuyTurnover。
 * 窗口与动态谢林点同一个约定：参数是「5 分钟图上的」近期窗口（小时），其他周期等比例缩放（每根 K 线的窗口根数相同）；
 * 标准化窗口固定 24 小时（同样按 5 分钟图计）。
 */
/**
 * klinecharts 数据 → CBA（副图）。【用户要求】2026-10-18 新增。成交额读 turnover、主动买入额读 takerBuyTurnover、成交量读 volume（算成交均价）。
 * 与动态谢林点同一个约定：参数 h 是「5 分钟图上的」时间权重半衰期（小时），48 小时窗口、24 小时常态成交额 / 波动率同样按 5 分钟图计，
 * 其他周期等比例缩放（每根 K 线的窗口根数相同）。
 */
export function cbaPoints(dataList: KLineData[], halfLifeHours: number | undefined) {
  const h = Number(halfLifeHours);
  const bars = dataList.map(d => ({
    close: d.close,
    volume: typeof d.volume === 'number' ? d.volume : null,
    quoteVolume: typeof d.turnover === 'number' ? d.turnover : null,
    takerBuyQuoteVolume: typeof d.takerBuyTurnover === 'number' ? d.takerBuyTurnover as number : null,
  }));
  return computeCba(bars, DSP_BASE_INTERVAL_MS / 60_000, { halfLifeHours: Number.isFinite(h) && h > 0 ? h : CBA_DEFAULTS.halfLifeHours });
}

/**
 * klinecharts 数据 → CBI（副图）。【用户要求】2026-10-18 新增。参数 = 时间衰减半衰期 h（根）；N、m、ATR 都按根计（所有周期一样），
 * 基线 24 小时按 5 分钟图计（288 根），与其他指标同一约定。成交额读 turnover、主动买入额读 takerBuyTurnover。
 */
export function cba2Points(dataList: KLineData[], halfLifeHours: number | undefined) {
  if (dataList.length > 1 && inferIntervalMs(dataList.map(d => ({ time: d.timestamp }))) !== 300000) return dataList.map(() => ({ cba2: null, dd: null, invalid: null }));
  return computeCba2(dataList.map(d => ({ time: d.timestamp, closed: d.cba2Closed !== false, close: d.close, volume: d.volume, quoteVolume: d.turnover, takerBuyQuoteVolume: d.takerBuyTurnover as number | null })), { halfLifeHours: halfLifeHours ?? CBA2_DEFAULTS.halfLifeHours });
}

export function cbiPoints(dataList: KLineData[], halfLifeBars: number | undefined) {
  const h = Number(halfLifeBars);
  const bars = dataList.map(d => ({
    high: d.high,
    low: d.low,
    close: d.close,
    quoteVolume: typeof d.turnover === 'number' ? d.turnover : null,
    takerBuyQuoteVolume: typeof d.takerBuyTurnover === 'number' ? d.takerBuyTurnover as number : null,
  }));
  return computeCbi(bars, DSP_BASE_INTERVAL_MS / 60_000, { h: Number.isFinite(h) && h > 0 ? h : CBI_DEFAULTS.h });
}

/**
 * klinecharts 数据 → CBI-2（副图）。【用户要求】2026-10-18 新增。参数 = 基线回看小时（公式里的 avgh，按 5 分钟图计）；
 * 动量要剔除 BTC：按图上的时间段与周期另取 BTCUSDT（取到后图表重算），没取到的那根不剔除。
 */
export function cbi2Points(dataList: KLineData[], baseHours: number | undefined, options: { fetchReference?: boolean } = {}) {
  const h = Number(baseHours);
  const times = dataList.map(d => d.timestamp);
  const intervalMs = inferIntervalMs(times.map(time => ({ time }))) ?? DSP_BASE_INTERVAL_MS;
  if (options.fetchReference !== false && times.length) requestBtcReference(times[0], times[times.length - 1] + intervalMs, intervalMs);
  const ref = btcClosesAt(times, intervalMs);
  return computeCbi2(dataList.map((d, i) => ({
    open: d.open, high: d.high, low: d.low, close: d.close,
    volume: typeof d.volume === 'number' ? d.volume : null,
    quoteVolume: typeof d.turnover === 'number' ? d.turnover : null,
    takerBuyQuoteVolume: typeof d.takerBuyTurnover === 'number' ? d.takerBuyTurnover as number : null,
    refClose: ref[i],
  })), { baseHours: Number.isFinite(h) && h > 0 ? h : CBI2_DEFAULTS.baseHours });
}

/**
 * 【用户要求】2026-10-19「公式要统一，指标、捕鱼算法、dig 中的要保持一致」：图上的特征值副图与 Deep dig 读同一份定义。
 * 定义与内置核心公式相同 → 沿用原来的实现（单元测试核对与公式逐位相同，CBA-2 还保留「只算已收盘」的处理）；
 * 改过 → 直接算改过的公式。DSP 的 a / az 原先成交额基线用 ema(Q, hl)、Deep dig 用 avg(Q, avgh)，现在一律按 Deep dig 的公式。
 */
function unifiedCore(dataList: KLineData[], featureId: string, period: number | undefined, legacy: (() => (number | null | undefined)[]) | null, refClose?: (number | null)[]): (number | null)[] {
  const def = accountFeatureDef(featureId);
  if (legacy && (!def || sameCoreAsBuiltin(def, BUILTIN_FEATURES.find(b => b.id === featureId)))) return legacy().map(v => (v == null || !Number.isFinite(v) ? null : v));
  return chartFeatureSeries(dataList, featureId, period, refClose)?.core ?? dataList.map(() => null);
}
/** DSP 的 a（Z 版为 az）：按 Deep dig 公式，乘它的显示倍数（a 为基点 × 10⁴，az 为 × 100）。 */
export function unifiedDspA(dataList: KLineData[], halfLifeHours: number | undefined, zscore: boolean): (number | null)[] {
  return buyerSeries(dataList, zscore ? 'DSP_Z' : 'DSP_VA', halfLifeHours).core;
}

function buyerSeries(data: KLineData[], id: string, period: number | undefined) {
  const item = BUYER_RESEARCH_INDICATORS.find(item => item.id === id)!;
  return researchChartSeries(data, item, period ?? item.period);
}

export function bssPoints(dataList: KLineData[], recentHours: number | undefined) {
  const h = Number(recentHours);
  const bars = dataList.map(d => ({
    close: d.close,
    quoteVolume: typeof d.turnover === 'number' ? d.turnover : null,
    takerBuyQuoteVolume: typeof d.takerBuyTurnover === 'number' ? d.takerBuyTurnover as number : null,
  }));
  return computeBss(bars, DSP_BASE_INTERVAL_MS / 60_000, {
    recentHours: Number.isFinite(h) && h > 0 ? h : BSS_DEFAULTS.recentHours,
    normHours: BSS_DEFAULTS.normHours,
  });
}

/**
 * 【用户要求】2026-10-18 均线副图：avg_BSS = avg(BSS, N)、avg_a = avg(a, N)，N 默认 24 小时、菜单里可调；
 * 【用户要求】各自一个独立副图，紧挨在原指标副图的正下方，不与原指标叠在一起。
 * 与 Deep dig 公式的 avg(x, h) 同一份滚动实现：过去 N 小时（含当根）的算术平均，空值跳过，开头不满 N 小时用已有的；
 * 窗口与动态谢林点同一个约定——N 按 5 分钟图计，其他周期等比例缩放（每根 K 线的窗口根数相同）。
 */
export const AVG_DEFAULT_HOURS = 24;
/** 均线副图（第二个参数 = 均线时长 N）。 */
export const AVG_PARAM_INDICATORS = new Set(['DSP_OVERLAY_AVG_CUSTOM', ...AVG_HIGHLIGHT_SPECS.flatMap(spec => [researchKcName(spec.id, 1), researchKcName(spec.id, 2)])]);

const validHours = (h: unknown, fallback: number) => {
  const n = Number(h);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** 逐根的过去 N 小时平均（N 按 5 分钟图计）。 */
export function rollingAvgHours(values: readonly (number | null | undefined)[], hours: unknown): (number | null)[] {
  const x = Float64Array.from(values, v => (v != null && Number.isFinite(v) ? v : Number.NaN));
  const avg = rollingMean(x, barsForHours(validHours(hours, AVG_DEFAULT_HOURS), DSP_BASE_INTERVAL_MS / 60_000));
  return Array.from(avg, v => (Number.isFinite(v) ? v : null));
}

/**
 * 自制区每项依次打开原值、avg_x、avg_x_2；主图 DSP 保留 a、可调均值、A。
 * 附属副图用「主项#后缀」作 CandlestickChart 里 activeIndicatorPanes 的键，随主项一起建、一起改参数、一起移除；按这里的顺序依次往下建。
 */
const DSP_COMPANIONS = [
  { key: 'DSP#V', kcName: 'DSP_V_CUSTOM' },
  // 【用户要求】avg_a 独立一个副图，紧挨在 a 副图下面（按这里的顺序依次往下建）
  { key: 'DSP#OVERLAYAVG', kcName: 'DSP_OVERLAY_AVG_CUSTOM' },
  { key: 'DSP#A', kcName: 'DSP_A_CUSTOM' },
];
export const INDICATOR_COMPANIONS: Record<string, { key: string; kcName: string }[]> = {
  DSP: DSP_COMPANIONS,
  // 普通版与 Z 版各有三条序列；保留旧原值 / avg 的 pane key。
  DSP_VA: [
    { key: 'DSP#V', kcName: 'DSP_V_CUSTOM' },
    { key: 'DSP#VAVG', kcName: 'DSP_V_AVG_CUSTOM' },
    { key: 'DSP_VA#AVG2', kcName: 'DSP_V_AVG2_CUSTOM' },
  ],
  DSP_Z: [
    { key: 'DSP_Z#V', kcName: 'DSP_Z_V_CUSTOM' },
    { key: 'DSP_Z#VAVG', kcName: 'DSP_Z_V_AVG_CUSTOM' },
    { key: 'DSP_Z#AVG2', kcName: 'DSP_Z_V_AVG2_CUSTOM' },
  ],
  // 【用户要求】avg_BSS 独立一个副图，紧挨在 BSS 副图下面
  BSS: [{ key: 'BSS#AVG', kcName: 'BSS_AVG_CUSTOM' }, { key: 'BSS#AVG2', kcName: 'BSS_AVG2_CUSTOM' }],
  CBA: [{ key: 'CBA#AVG', kcName: 'CBA_AVG_CUSTOM' }, { key: 'CBA#AVG2', kcName: 'CBA_AVG2_CUSTOM' }],
  CBI2: [{ key: 'CBI2#AVG', kcName: 'CBI2_AVG_CUSTOM' }, { key: 'CBI2#AVG2', kcName: 'CBI2_AVG2_CUSTOM' }],
  CTBA: [{key:'CTBA#AVG',kcName:'CTBA_AVG_CUSTOM'},{key:'CTBA#AVG2',kcName:'CTBA_AVG2_CUSTOM'}],
  MBI: [{ key: 'MBI#AVG', kcName: 'MBI_AVG_CUSTOM' }, { key: 'MBI#AVG2', kcName: 'MBI_AVG2_CUSTOM' }],
  ...Object.fromEntries(RESEARCH_INDICATORS.map(item => [item.id, [
    { key: `${item.id}#AVG`, kcName: researchKcName(item.id, 1) },
    { key: `${item.id}#AVG2`, kcName: researchKcName(item.id, 2) },
  ]])),
};

const registeredAccountIndicators = new Set<string>();
export function registerAccountFeatureIndicators(definitions: readonly DeepDigFeatureDef[] = accountFeatureDefs()) {
  for (const item of accountResearchIndicators(definitions).filter(item => item.id.startsWith('FEATURE_'))) {
    CUSTOM_INDICATOR_MAP[item.id] = researchKcName(item.id);
    INDICATOR_COMPANIONS[item.id] = [1, 2].map(level => ({ key: item.id + '#AVG' + (level === 2 ? '2' : ''), kcName: researchKcName(item.id, level) }));
    if (registeredAccountIndicators.has(item.id)) continue;
    for (const level of [0, 1, 2]) {
      const label = level === 0 ? item.short : 'avg_' + item.core + (level === 2 ? '_2' : '');
      registerIndicator({
        name: researchKcName(item.id, level), shortName: label, calcParams: [researchDefaultPeriod(item), 0, 0], precision: 8,
        ...(item.min < item.max ? { minValue: item.min, maxValue: item.max } : {}),
        draw: zeroLine(ORANGE_DASH_LINE, item.neutral),
        createTooltipDataSource: ({ defaultStyles }) => ({ name: chartFeatureDef(item.featureId)?.short ?? label, calcParamsText: '', icons: defaultStyles.tooltip.icons, values: undefined as never }),
        figures: [{ key: 'value', title: label + ': ', type: 'line', styles: data => ({
          color: vColor((data.next?.indicatorData as { value?: number } | undefined)?.value ?? (data.current.indicatorData as { value?: number } | undefined)?.value), size: 1.5,
        }) }],
        calc: (data, indicator) => {
          const values = researchChartSeries(data, item, indicator.calcParams[0]);
          return indicatorRows(indicator, level === 0 ? values.core : level === 1 ? values.avg : values.avg2, 'value');
        },
      });
    }
    registeredAccountIndicators.add(item.id);
  }
}

export type CustomPaneVisibility = 'showRaw' | 'showAverage' | 'showAverage2';
export function customIndicatorPane(name: string) {
  const item = researchIndicatorForKc(name);
  if (!item) return undefined;
  const level = [0, 1, 2].find(level => researchKcName(item.id, level) === name)!;
  return { type: item.id, visibility: (['showRaw', 'showAverage', 'showAverage2'] as const)[level] };
}
/** Visibility does not change formulas or the complete companion catalog. */
export function visibleIndicatorCompanions(ind: { type: string; showRaw?: boolean; showAverage?: boolean; showAverage2?: boolean }) {
  return (INDICATOR_COMPANIONS[ind.type] ?? []).filter(companion => {
    const pane = customIndicatorPane(companion.kcName);
    return !pane || (pane.visibility === 'showAverage' ? !!ind.showAverage : ind[pane.visibility] !== false);
  });
}

/**
 * 菜单里的一项 → 某个 klinecharts 指标的 calcParams：带均线的副图多一个均线时长；
 * 【用户要求】DSP 的 a / avg_a 副图最后多一个 Z 开关（1 = Z 分数版，0 = 原始），图例里不显示这一位。
 */
export function indicatorCalcParams(kcName: string, ind: { type?: string; period: number; avgHours?: number; zscore?: boolean }): number[] {
  const averaged = calibratedAverageForName(kcName);
  if (averaged) return [ind.period, validHours(ind.avgHours, AVG_DEFAULT_HOURS), btcReferenceVersion() + researchHistoryVersion(), researchDefinitionVersion(averaged.item), avgCalibrationVersion()];
  const base = DSP_Z_BASE_NAMES[kcName];
  if (base) return indicatorCalcParams(base, { ...ind, zscore: true });
  const research = researchIndicatorForKc(kcName);
  const z = ind.zscore && ind.type !== 'DSP_VA' ? 1 : 0;
  const dsp = BUYER_RESEARCH_INDICATORS.find(item => item.id === (z ? 'DSP_Z' : 'DSP_VA'))!;
  if (kcName === 'DSP_V_CUSTOM') return [ind.period, z, btcReferenceVersion() + researchHistoryVersion(), researchDefinitionVersion(dsp)];
  if (kcName === 'DSP_OVERLAY_AVG_CUSTOM') return [ind.period, validHours(ind.avgHours, AVG_DEFAULT_HOURS), z, btcReferenceVersion() + researchHistoryVersion(), researchDefinitionVersion(dsp)];
  if (kcName === 'DSP_V_AVG_CUSTOM') return [ind.period, validHours(ind.avgHours, AVG_DEFAULT_HOURS), z, btcReferenceVersion() + researchHistoryVersion(), researchDefinitionVersion(dsp)];
  if (kcName === 'DSP_V_AVG2_CUSTOM') return [ind.period, z, btcReferenceVersion() + researchHistoryVersion(), researchDefinitionVersion(dsp)];
  if (research) return [ind.period, btcReferenceVersion() + researchHistoryVersion(), researchDefinitionVersion(research)];
  const legacyId = kcName === 'CBI_CUSTOM' ? 'cbi' : kcName === 'CBA2_CUSTOM' ? 'cba-2' : undefined;
  if (legacyId) return [ind.period, researchDefinitionVersion({ featureId: legacyId } as ResearchIndicator)];
  return AVG_PARAM_INDICATORS.has(kcName) ? [ind.period, validHours(ind.avgHours, AVG_DEFAULT_HOURS)] : [ind.period];
}

const DSP_Z_BASE_NAMES: Record<string, string> = {
  DSP_Z_V_CUSTOM: 'DSP_V_CUSTOM', DSP_Z_V_AVG_CUSTOM: 'DSP_V_AVG_CUSTOM', DSP_Z_V_AVG2_CUSTOM: 'DSP_V_AVG2_CUSTOM', DSP_Z_A_CUSTOM: 'DSP_A_CUSTOM',
};
function registerDspVariant(template: IndicatorTemplate) {
  registerIndicator(template);
  if (template.name === 'DSP_V_AVG_CUSTOM') registerIndicator({ ...template, name: 'DSP_OVERLAY_AVG_CUSTOM', createTooltipDataSource: dspATooltip('avg', true),
    draw: args => {
      V_ZERO_LINE(args);
      return drawAverageArea(args, 'v', { center: 0 }) || drawChartLine(args, template.figures![0]);
    },
    calc: (data, indicator) => rollingAvgHours(unifiedDspA(data, indicator.calcParams[0], indicator.calcParams[2] === 1), indicator.calcParams[1]).map(v => v == null ? {} : { v }),
  });
  const alias = Object.keys(DSP_Z_BASE_NAMES).find(name => DSP_Z_BASE_NAMES[name] === template.name);
  if (!alias) return;
  const flag = template.name === 'DSP_V_CUSTOM' || template.name === 'DSP_V_AVG2_CUSTOM' ? 1 : template.name === 'DSP_V_AVG_CUSTOM' ? 2 : null;
  const params = (values: number[]) => { const out = [...values]; if (flag != null) out[flag] = 1; return out; };
  registerIndicator({ ...template, name: alias, calcParams: params(template.calcParams ?? []),
    calc: (data, indicator) => template.calc(data, { ...indicator, calcParams: params(indicator.calcParams) }),
  });
}

type SegmentData = { current: { indicatorData?: unknown }; next: { indicatorData?: unknown } };
/** 折线这一段终点的 V：没有下一根（最后一根）时用这一根自己的。 */
function segmentEndV(data: SegmentData): number | undefined {
  const next = (data.next?.indicatorData as { v?: number } | undefined)?.v;
  return next ?? (data.current.indicatorData as { v?: number } | undefined)?.v;
}
const vColor = (v: number | undefined) => (v == null || v === 0 ? '#F0B90B' : v > 0 ? '#0ECB81' : '#F6465D');

type ZeroLineStyle = { color: string; width: number; dash: number[] };
/**
 * 副图的 0 轴（多空平衡线）：直接画一条线，不当成数据系列（否则纵轴上会多一个 0 的标签）。
 * 先于 V / A 本身画，所以数据线压在它上面。
 */
function zeroLine({ color, width, dash }: ZeroLineStyle, level = 0, label?: string) {
  return ({ ctx, bounding, yAxis }: { ctx: CanvasRenderingContext2D; bounding: { width: number; height: number }; yAxis: { convertToPixel: (v: number) => number } }): boolean => {
    const y = Math.round(yAxis.convertToPixel(level)) + (width % 2 ? 0.5 : 0);
    if (y >= 0 && y <= bounding.height) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(bounding.width, y);
      ctx.stroke();
      if(label){ctx.font='11px system-ui';ctx.fillStyle=color;ctx.textAlign='left';ctx.textBaseline='bottom';ctx.fillText(label,8,y-4);}
      ctx.restore();
    }
    return false;
  };
}
/** Keep the legacy export name; reference centers now use a quiet, solid amber hairline. */
export const ORANGE_DASH_LINE: ZeroLineStyle = { color: 'rgba(181,140,65,0.38)', width: 0.6, dash: [] };
const V_ZERO_LINE = zeroLine(ORANGE_DASH_LINE);
/** A uses the same unobtrusive solid reference treatment, in gray. */
const A_ZERO_LINE = zeroLine({ color: 'rgba(132,142,156,0.3)', width: 0.6, dash: [] });
/** Chart reference levels are zero; fishing thresholds are configured separately. */
export const ACTION_LEVELS = { cbi2: 0, cba: 0, avgBss: 0 } as const;
type LineArgs = { ctx: CanvasRenderingContext2D; bounding: { width: number; height: number }; yAxis: { convertToPixel: (v: number) => number }; indicator?: { calcParams?: unknown[] } };
/** Average bounds use short edge marks without adding background bands. */
function averageReferenceMarks({ ctx, bounding, yAxis }: LineArgs, lower: number, upper: number): void {
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) return;
  const upperY = yAxis.convertToPixel(upper), lowerY = yAxis.convertToPixel(lower);
  if (!Number.isFinite(upperY) || !Number.isFinite(lowerY)) return;
  ctx.save();
  ctx.setLineDash([]);
  for (const [y, stroke] of [
    [upperY, 'rgba(14,203,129,0.5)'],
    [lowerY, 'rgba(246,70,93,0.5)'],
  ] as const) {
    if (y < 0 || y > bounding.height) continue;
    const markerY = Math.round(y) + 0.5;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.max(0, bounding.width - 14), markerY);
    ctx.lineTo(bounding.width, markerY);
    ctx.stroke();
  }
  ctx.restore();
}
const CBI2_ACTION_LINE = zeroLine(ORANGE_DASH_LINE, ACTION_LEVELS.cbi2);
const CBA_ACTION_LINE = zeroLine(ORANGE_DASH_LINE, ACTION_LEVELS.cba);
/** DSP a / az and their averages use zero as the net-force direction boundary.
 * Displayed az = 100 * EMA(f * G * R / sd(R)): neither az nor its averages have unit variance.
 * A fixed +15 or standard-score ±1/±2 cutoff cannot be derived from this formula.
 */
/** avg_BSS 副图只保留橘色 0 参考线。 */
/**
 * 橘色线必须看得见：纵轴至少包含这条线（读数离线很远时线也在图里，不再落到图外）。
 * 【用户要求】2026-10-22「为啥没有横线？要加上横线」——avg_a 读数只到 7.7，纵轴到不了 15，线在图外。
 * DSP 的普通版和波动率归一化版都画 0 方向参考线。返回 null = 这个副图没有橘色线。
 */
export function axisLineLevel(name: string, _p: readonly unknown[] | undefined): number | null {
  const averaged = calibratedAverageForName(name);
  if (averaged) return averaged.spec.center;
  switch (name) {
    case 'DSP_V_CUSTOM': case 'DSP_V_AVG2_CUSTOM': return 0;
    case 'DSP_V_AVG_CUSTOM': case 'DSP_OVERLAY_AVG_CUSTOM': return 0;
    case 'DSP_Z_V_CUSTOM': case 'DSP_Z_V_AVG_CUSTOM': case 'DSP_Z_V_AVG2_CUSTOM': return 0;
    case 'CBI2_CUSTOM': case 'CBI2_AVG_CUSTOM': case 'CBI2_AVG2_CUSTOM': return ACTION_LEVELS.cbi2;
    case 'CBA_CUSTOM': case 'CBA_AVG_CUSTOM': case 'CBA_AVG2_CUSTOM': return ACTION_LEVELS.cba;
    case 'BSS_CUSTOM': return 0;
    case 'BSS_AVG_CUSTOM': case 'BSS_AVG2_CUSTOM': return ACTION_LEVELS.avgBss;
  }
  for (const item of RESEARCH_INDICATORS) for (const level of [0, 1, 2]) {
    if (researchKcName(item.id, level) === name) return level > 0 && 'avgNeutral' in item ? item.avgNeutral : item.neutral;
  }
  return null;
}
/** Resolve calibrated averages independently of raw indicator display ranges. */
export function calibratedAverageForName(name: string) {
  for (const spec of AVG_HIGHLIGHT_SPECS) {
    const item = CUSTOM_RESEARCH_INDICATORS.find(item => item.id === spec.id)!;
    for (const level of [1, 2]) if (researchKcName(item.id, level) === name) return { spec, item, kind: (level === 1 ? 'avg' : 'avg2') as AverageKind };
  }
  return undefined;
}
const indicatorRowCache = new WeakMap<object, Record<string, number>[]>();
function indicatorRows(indicator: object, values: (number | null)[], key: string, limits?: { lower: number; upper: number }) {
  let rows = indicatorRowCache.get(indicator);
  if (!rows) { rows = []; indicatorRowCache.set(indicator, rows); }
  rows.length = values.length;
  for (let i = 0; i < values.length; i++) {
    const value = values[i], old = rows[i];
    if (old && Object.is(old[key], value ?? undefined)
      && (!limits || (Object.is(old._avgLower, limits.lower) && Object.is(old._avgUpper, limits.upper)))) continue;
    rows[i] = { ...(value == null ? {} : { [key]: value }), ...(limits ? { _avgLower: limits.lower, _avgUpper: limits.upper } : {}) };
  }
  return rows;
}
function registerIndicator(template: IndicatorTemplate): void {
  const averaged = calibratedAverageForName(template.name);
  if (averaged) {
    const { item, spec, kind } = averaged;
    const key = template.figures?.[0]?.key ?? 'value';
    const definition: IndicatorTemplate = { ...template, minValue: undefined, maxValue: undefined,
      calcParams: [item.period, AVG_DEFAULT_HOURS, 0, 0, 0],
      createTooltipDataSource: ({ indicator, defaultStyles }) => {
        const context = avgCalibrationContext(item.featureId, indicator.calcParams[0], indicator.calcParams[1], kind);
        const def = chartFeatureDef(item.featureId), names = def ? researchSeriesNames(item, def.formula) : null;
        const label = (kind === 'avg' ? names?.avg : names?.avg2) ?? template.shortName;
        return { name: `${label}${def?.unit ? `(${def.unit})` : ''}${context.limits ? '' : ` · ${context.status}`}`, calcParamsText: `(${indicator.calcParams[1]}h)`, icons: defaultStyles.tooltip.icons, values: undefined as never };
      },
      draw: args => {
        const last = args.indicator?.result?.at(-1) as Record<string, number> | undefined;
        if (last && Number.isFinite(last._avgLower)) {
          averageReferenceMarks(args, last._avgLower, last._avgUpper);
        }
        zeroLine(ORANGE_DASH_LINE, spec.center)(args);
        return drawAverageArea(args, key, { center: spec.center, lower: last?._avgLower, upper: last?._avgUpper, range: spec.range })
          || drawChartLine(args, definition.figures![0]);
      },
      figures: [{ key, title: template.figures?.[0]?.title ?? '', type: 'line', styles: data => {
        const point = (data.next?.indicatorData ?? data.current.indicatorData) as Record<string, number> | undefined;
        const limits = point && Number.isFinite(point._avgLower) ? { lower: point._avgLower, upper: point._avgUpper } : undefined;
        return { color: averageAreaColor(point?.[key] ?? NaN, { center: spec.center, ...limits, range: spec.range }), size: 2.1 };
      } }],
      calc: (data, indicator) => {
        const hours = validHours(indicator.calcParams[1], AVG_DEFAULT_HOURS);
        const context = avgCalibrationContext(item.featureId, indicator.calcParams[0], hours, kind);
        const limits = context.limits;
        indicator.minValue = limits?.lower ?? spec.center; indicator.maxValue = limits?.upper ?? spec.center;
        const values = researchChartSeries(data, item, indicator.calcParams[0], { averageHours: hours })[kind];
        return indicatorRows(indicator, values, key, { lower: limits?.lower ?? NaN, upper: limits?.upper ?? NaN });
      },
    };
    registerKcIndicator(definition);
    return;
  }
  const raw = AVG_HIGHLIGHT_SPECS.some(spec => researchKcName(spec.id) === template.name);
  if (raw) {
    const threshold = axisLineLevel(template.name, template.calcParams)!;
    template = { ...template,
      // Auto-fit actual values while always keeping the single threshold visible.
      minValue: threshold,
      maxValue: threshold,
      draw: args => {
        zeroLine(ORANGE_DASH_LINE, threshold)(args);
        return template.figures?.length === 1 ? drawChartLine(args, template.figures[0]) : false;
      },
    };
  }
  const calc = template.calc;
  if (!calc || axisLineLevel(template.name, template.calcParams) == null) { registerKcIndicator(template); return; }
  const baseMin = template.minValue, baseMax = template.maxValue;
  registerKcIndicator({ ...template, calc: (data, indicator) => {
    const level = axisLineLevel(template.name, indicator.calcParams);
    if (level != null) {
      const ind = indicator as { minValue?: number | null; maxValue?: number | null };
      ind.minValue = Math.min(typeof baseMin === 'number' ? baseMin : level, level);
      ind.maxValue = Math.max(typeof baseMax === 'number' ? baseMax : level, level);
    }
    return calc(data, indicator);
  } });
}
const avgBssLines = V_ZERO_LINE;

/** BSS 着色：> 0.55 绿、< −0.55 红，中间按正负淡绿 / 淡红。 */
const bssColor = (v: number | undefined) => (v == null ? '#F0B90B' : v >= BSS_STRONG ? '#0ECB81' : v <= -BSS_STRONG ? '#F6465D' : v >= 0 ? 'rgba(14,203,129,0.7)' : 'rgba(246,70,93,0.7)');

/** a / avg_a 副图的图例：Z 开关打开时名字、单位换成 Z 分数版；括号里只写 h（和 N），不写开关那一位。 */
function dspATooltip(kind: 'a' | 'avg', adjustableAverage = false) {
  return ({ indicator, crosshair, defaultStyles }: IndicatorCreateTooltipDataSourceParams): IndicatorTooltipData => {
    const p = indicator.calcParams as number[];
    const z = (kind === 'a' ? p[1] : p[2]) === 1;
    const v = (indicator.result[crosshair.dataIndex ?? -1] as { v?: number } | undefined)?.v;
    const color = vColor(v);
    const item = BUYER_RESEARCH_INDICATORS.find(i => i.id === (z ? 'DSP_Z' : 'DSP_VA'))!;
    const def = chartFeatureDef(item.featureId);
    const names = def ? researchSeriesNames(item, def.formula) : { core: item.core, avg: `avg_${item.core}` };
    const unit = `(${def?.unit ?? (z ? '归一化×100' : '基点/根')}): `;
    const name = kind === 'a' ? (z ? 'DSP·az' : 'DSP·a') : names.avg;
    return {
      name,
      calcParamsText: `(${kind === 'avg' && adjustableAverage ? `${p[0]},${p[1]}` : p[0]})`,
      icons: defaultStyles.tooltip.icons,
      values: [{ title: { text: `${kind === 'a' ? names.core : name}${unit}`, color }, value: { text: v == null ? defaultStyles.tooltip.defaultValue : v.toFixed(indicator.precision), color } }],
    };
  };
}

let registered = false;

export function registerCustomIndicators() {
  registerAccountFeatureIndicators();
  if (registered) return;

  try {

  // ─── HV 历史波动率（对数收益的滚动方差 → 年化 σ%） ───
  registerIndicator({
    name: 'HV_CUSTOM',
    shortName: 'HV',
    calcParams: [20],
    figures: [
      { key: 'hv', title: '年化σ%: ', type: 'line' },
      { key: 'ma', title: '平滑: ', type: 'line' },
    ],
    calc: (dataList, indicator) => {
      const period = Math.max(2, indicator.calcParams[0] ?? 20);
      const smooth = Math.max(2, Math.round(period / 2));
      try {
        if (dataList.length < 2) return dataList.map(() => ({}));
        // 年化系数按相邻时间戳推断单根周期，随图表周期自动适配
        const intervalMs = (dataList[1].timestamp as number) - (dataList[0].timestamp as number);
        const hv = computeAnnualizedVolatility(closes(dataList), period, intervalMs);
        // NaN 安全的滚动均值（既有 sma 会被 NaN 前缀永久污染累加和）
        const ma = new Array<number>(hv.length).fill(NaN);
        let s = 0;
        let cnt = 0;
        for (let i = 0; i < hv.length; i++) {
          if (Number.isFinite(hv[i])) { s += hv[i]; cnt++; }
          const d = i - smooth;
          if (d >= 0 && Number.isFinite(hv[d])) { s -= hv[d]; cnt--; }
          if (cnt === smooth) ma[i] = s / smooth;
        }
        return dataList.map((_, i) => {
          const point: Record<string, number> = {};
          if (Number.isFinite(hv[i])) point.hv = hv[i];
          if (Number.isFinite(ma[i])) point.ma = ma[i];
          return point;
        });
      } catch { return dataList.map(() => ({})); }
    },
  });

  // ─── ADX ───
  registerIndicator({
    name: 'ADX_CUSTOM',
    shortName: 'ADX',
    calcParams: [14],
    figures: [
      { key: 'adx', title: 'ADX: ', type: 'line' },
      { key: 'pdi', title: '+DI: ', type: 'line' },
      { key: 'mdi', title: '-DI: ', type: 'line' },
    ],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 14;
      try {
        const result = ADX.calculate({ close: closes(dataList), high: highs(dataList), low: lows(dataList), period });
        const offset = dataList.length - result.length;
        return dataList.map((_, i) => {
          const r = result[i - offset];
          return r ? { adx: r.adx, pdi: r.pdi, mdi: r.mdi } : {};
        });
      } catch { return dataList.map(() => ({})); }
    },
  });

  // ─── VWAP ───
  registerIndicator({
    name: 'VWAP_CUSTOM',
    shortName: 'VWAP',
    calcParams: [],
    figures: [{ key: 'vwap', title: 'VWAP: ', type: 'line' }],
    calc: (dataList) => {
      try {
        const result = VWAP.calculate({ close: closes(dataList), high: highs(dataList), low: lows(dataList), volume: volumes(dataList) });
        const offset = dataList.length - result.length;
        return dataList.map((_, i) => {
          const v = result[i - offset];
          return v !== undefined ? { vwap: v } : {};
        });
      } catch { return dataList.map(() => ({})); }
    },
  });

  // ─── Ichimoku Cloud ───
  registerIndicator({
    name: 'ICH_CUSTOM',
    shortName: 'Ichimoku',
    calcParams: [9, 26, 52],
    figures: [
      { key: 'tenkan', title: '转换: ', type: 'line' },
      { key: 'kijun', title: '基准: ', type: 'line' },
      { key: 'spanA', title: 'SpanA: ', type: 'line' },
      { key: 'spanB', title: 'SpanB: ', type: 'line' },
    ],
    calc: (dataList, indicator) => {
      const [conv, base, span] = indicator.calcParams;
      try {
        const result = IchimokuCloud.calculate({
          high: highs(dataList), low: lows(dataList),
          conversionPeriod: conv ?? 9, basePeriod: base ?? 26,
          spanPeriod: span ?? 52, displacement: base ?? 26,
        });
        const offset = dataList.length - result.length;
        return dataList.map((_, i) => {
          const r = result[i - offset];
          return r ? { tenkan: r.conversion, kijun: r.base, spanA: r.spanA, spanB: r.spanB } : {};
        });
      } catch { return dataList.map(() => ({})); }
    },
  });

  // ─── Stochastic RSI ───
  registerIndicator({
    name: 'STOCH_RSI_CUSTOM',
    shortName: 'StochRSI',
    calcParams: [14, 14, 3, 3],
    figures: [
      { key: 'k', title: 'K: ', type: 'line' },
      { key: 'd', title: 'D: ', type: 'line' },
    ],
    calc: (dataList, indicator) => {
      const [rsiPeriod, stochPeriod, kPeriod, dPeriod] = indicator.calcParams;
      try {
        const result = StochasticRSI.calculate({
          values: closes(dataList),
          rsiPeriod: rsiPeriod ?? 14, stochasticPeriod: stochPeriod ?? 14,
          kPeriod: kPeriod ?? 3, dPeriod: dPeriod ?? 3,
        });
        const offset = dataList.length - result.length;
        return dataList.map((_, i) => {
          const r = result[i - offset];
          return r ? { k: r.k, d: r.d } : {};
        });
      } catch { return dataList.map(() => ({})); }
    },
  });

  // ─── Keltner Channel ───
  registerIndicator({
    name: 'KC_CUSTOM',
    shortName: 'KC',
    calcParams: [20, 1.5],
    figures: [
      { key: 'upper', title: '上: ', type: 'line' },
      { key: 'middle', title: '中: ', type: 'line' },
      { key: 'lower', title: '下: ', type: 'line' },
    ],
    calc: (dataList, indicator) => {
      const [period, mult] = indicator.calcParams;
      try {
        const result = KeltnerChannels.calculate({
          high: highs(dataList), low: lows(dataList), close: closes(dataList),
          maPeriod: period ?? 20, atrPeriod: period ?? 20, useSMA: false,
          multiplier: mult ?? 1.5,
        });
        const offset = dataList.length - result.length;
        return dataList.map((_, i) => {
          const r = result[i - offset];
          return r ? { upper: r.upper, middle: r.middle, lower: r.lower } : {};
        });
      } catch { return dataList.map(() => ({})); }
    },
  });

  // ─── Accumulation/Distribution Line ───
  registerIndicator({
    name: 'AD_CUSTOM',
    shortName: 'A/D',
    calcParams: [],
    figures: [{ key: 'ad', title: 'A/D: ', type: 'line' }],
    calc: (dataList) => {
      try {
        const result = ADL.calculate({ high: highs(dataList), low: lows(dataList), close: closes(dataList), volume: volumes(dataList) });
        const offset = dataList.length - result.length;
        return dataList.map((_, i) => {
          const v = result[i - offset];
          return v !== undefined ? { ad: v } : {};
        });
      } catch { return dataList.map(() => ({})); }
    },
  });

  // ─── Force Index ───
  registerIndicator({
    name: 'ELDER_CUSTOM',
    shortName: 'EFI',
    calcParams: [13],
    figures: [{ key: 'efi', title: 'EFI: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 13;
      try {
        const fi: number[] = [];
        for (let i = 0; i < dataList.length; i++) {
          if (i === 0) { fi.push(0); continue; }
          fi.push((dataList[i].close - dataList[i - 1].close) * dataList[i].volume);
        }
        const smoothed = ema(fi, period);
        return dataList.map((_, i) => ({ efi: smoothed[i] }));
      } catch { return dataList.map(() => ({})); }
    },
  });

  // ─── Awesome Oscillator ───
  registerIndicator({
    name: 'AO_CUSTOM',
    shortName: 'AO',
    calcParams: [5, 34],
    figures: [{ key: 'ao', title: 'AO: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const [fast, slow] = indicator.calcParams;
      try {
        const result = AwesomeOscillator.calculate({ high: highs(dataList), low: lows(dataList), fastPeriod: fast ?? 5, slowPeriod: slow ?? 34 });
        const offset = dataList.length - result.length;
        return dataList.map((_, i) => {
          const v = result[i - offset];
          return v !== undefined ? { ao: v } : {};
        });
      } catch { return dataList.map(() => ({})); }
    },
  });

  // ─── Bollinger %B ───
  registerIndicator({
    name: 'BOLL_B_CUSTOM',
    shortName: '%B',
    calcParams: [20, 2],
    figures: [{ key: 'percentB', title: '%B: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const [period, stdDev] = indicator.calcParams;
      try {
        const result = BollingerBands.calculate({ period: period ?? 20, stdDev: stdDev ?? 2, values: closes(dataList) });
        const offset = dataList.length - result.length;
        return dataList.map((_, i) => {
          const r = result[i - offset];
          if (!r) return {};
          const bw = r.upper - r.lower;
          return { percentB: bw !== 0 ? (dataList[i].close - r.lower) / bw : 0.5 };
        });
      } catch { return dataList.map(() => ({})); }
    },
  });

  // ─── Bollinger Bandwidth ───
  registerIndicator({
    name: 'BBW_CUSTOM',
    shortName: 'BBW',
    calcParams: [20, 2],
    figures: [{ key: 'bbw', title: 'BBW: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const [period, stdDev] = indicator.calcParams;
      try {
        const result = BollingerBands.calculate({ period: period ?? 20, stdDev: stdDev ?? 2, values: closes(dataList) });
        const offset = dataList.length - result.length;
        return dataList.map((_, i) => {
          const r = result[i - offset];
          return r && r.middle !== 0 ? { bbw: (r.upper - r.lower) / r.middle } : {};
        });
      } catch { return dataList.map(() => ({})); }
    },
  });

  // ─── DEMA (overlay) ───
  registerIndicator({
    name: 'DEMA_CUSTOM',
    shortName: 'DEMA',
    calcParams: [21],
    figures: [{ key: 'dema', title: 'DEMA: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 21;
      const vals = calcDEMA(closes(dataList), period);
      return dataList.map((_, i) => ({ dema: vals[i] }));
    },
  });

  // ─── TEMA (overlay) ───
  registerIndicator({
    name: 'TEMA_CUSTOM',
    shortName: 'TEMA',
    calcParams: [21],
    figures: [{ key: 'tema', title: 'TEMA: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 21;
      const vals = calcTEMA(closes(dataList), period);
      return dataList.map((_, i) => ({ tema: vals[i] }));
    },
  });

  // ─── HMA (overlay) ───
  registerIndicator({
    name: 'HMA_CUSTOM',
    shortName: 'HMA',
    calcParams: [20],
    figures: [{ key: 'hma', title: 'HMA: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 20;
      const vals = calcHMA(closes(dataList), period);
      return dataList.map((_, i) => ({ hma: isNaN(vals[i]) ? undefined : vals[i] }));
    },
  });

  // ─── SMMA (overlay) ───
  registerIndicator({
    name: 'SMMA_CUSTOM',
    shortName: 'SMMA',
    calcParams: [20],
    figures: [{ key: 'smma', title: 'SMMA: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 20;
      const c = closes(dataList);
      const result: number[] = [];
      for (let i = 0; i < c.length; i++) {
        if (i < period - 1) { result.push(NaN); continue; }
        if (i === period - 1) {
          result.push(c.slice(0, period).reduce((a, b) => a + b, 0) / period);
          continue;
        }
        result.push((result[i - 1] * (period - 1) + c[i]) / period);
      }
      return dataList.map((_, i) => ({ smma: isNaN(result[i]) ? undefined : result[i] }));
    },
  });

  // ─── Donchian Channel (overlay) ───
  registerIndicator({
    name: 'DC_CUSTOM',
    shortName: 'DC',
    calcParams: [20],
    figures: [
      { key: 'upper', title: '上: ', type: 'line' },
      { key: 'middle', title: '中: ', type: 'line' },
      { key: 'lower', title: '下: ', type: 'line' },
    ],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 20;
      return dataList.map((_, i) => {
        if (i < period - 1) return {};
        let high = -Infinity, low = Infinity;
        for (let j = i - period + 1; j <= i; j++) {
          if (dataList[j].high > high) high = dataList[j].high;
          if (dataList[j].low < low) low = dataList[j].low;
        }
        return { upper: high, lower: low, middle: (high + low) / 2 };
      });
    },
  });

  // ─── Momentum ───
  registerIndicator({
    name: 'MOM_CUSTOM',
    shortName: 'MOM',
    calcParams: [10],
    figures: [{ key: 'mom', title: 'MOM: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 10;
      return dataList.map((_, i) => {
        if (i < period) return {};
        return { mom: dataList[i].close - dataList[i - period].close };
      });
    },
  });

  // ─── Aroon ───
  registerIndicator({
    name: 'AROON_CUSTOM',
    shortName: 'Aroon',
    calcParams: [25],
    figures: [
      { key: 'up', title: 'Up: ', type: 'line' },
      { key: 'down', title: 'Down: ', type: 'line' },
    ],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 25;
      return dataList.map((_, i) => {
        if (i < period) return {};
        let highIdx = 0, lowIdx = 0;
        for (let j = 1; j <= period; j++) {
          if (dataList[i - j + 1].high >= dataList[i - highIdx].high) highIdx = j - 1;
          if (dataList[i - j + 1].low <= dataList[i - lowIdx].low) lowIdx = j - 1;
        }
        // Recalculate properly
        let hh = i, ll = i;
        for (let j = i - period; j <= i; j++) {
          if (dataList[j].high > dataList[hh].high) hh = j;
          if (dataList[j].low < dataList[ll].low) ll = j;
        }
        return {
          up: ((period - (i - hh)) / period) * 100,
          down: ((period - (i - ll)) / period) * 100,
        };
      });
    },
  });

  // ─── Standard Deviation ───
  registerIndicator({
    name: 'STDEV_CUSTOM',
    shortName: 'StdDev',
    calcParams: [20],
    figures: [{ key: 'stdev', title: 'σ: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 20;
      const c = closes(dataList);
      return dataList.map((_, i) => {
        if (i < period - 1) return {};
        const slice = c.slice(i - period + 1, i + 1);
        const mean = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
        return { stdev: Math.sqrt(variance) };
      });
    },
  });

  // ─── Choppiness Index ───
  registerIndicator({
    name: 'CHOP_CUSTOM',
    shortName: 'CHOP',
    calcParams: [14],
    figures: [{ key: 'chop', title: 'CHOP: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 14;
      return dataList.map((_, i) => {
        if (i < period) return {};
        let atrSum = 0, highH = -Infinity, lowL = Infinity;
        for (let j = i - period + 1; j <= i; j++) {
          const tr = Math.max(
            dataList[j].high - dataList[j].low,
            Math.abs(dataList[j].high - dataList[j - 1].close),
            Math.abs(dataList[j].low - dataList[j - 1].close)
          );
          atrSum += tr;
          if (dataList[j].high > highH) highH = dataList[j].high;
          if (dataList[j].low < lowL) lowL = dataList[j].low;
        }
        const range = highH - lowL;
        if (range === 0) return {};
        return { chop: 100 * Math.log10(atrSum / range) / Math.log10(period) };
      });
    },
  });

  // ─── CMF (Chaikin Money Flow) ───
  registerIndicator({
    name: 'CMF_CUSTOM',
    shortName: 'CMF',
    calcParams: [20],
    figures: [{ key: 'cmf', title: 'CMF: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 20;
      return dataList.map((_, i) => {
        if (i < period - 1) return {};
        let mfvSum = 0, volSum = 0;
        for (let j = i - period + 1; j <= i; j++) {
          const hl = dataList[j].high - dataList[j].low;
          const mfm = hl !== 0 ? ((dataList[j].close - dataList[j].low) - (dataList[j].high - dataList[j].close)) / hl : 0;
          mfvSum += mfm * dataList[j].volume;
          volSum += dataList[j].volume;
        }
        return { cmf: volSum !== 0 ? mfvSum / volSum : 0 };
      });
    },
  });

  // ─── Balance of Power ───
  registerIndicator({
    name: 'BOP_CUSTOM',
    shortName: 'BOP',
    calcParams: [14],
    figures: [{ key: 'bop', title: 'BOP: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 14;
      const raw = dataList.map(d => {
        const hl = d.high - d.low;
        return hl !== 0 ? (d.close - d.open) / hl : 0;
      });
      const smoothed = sma(raw, period);
      return dataList.map((_, i) => ({ bop: isNaN(smoothed[i]) ? undefined : smoothed[i] }));
    },
  });

  // ─── Coppock Curve ───
  registerIndicator({
    name: 'COPP_CUSTOM',
    shortName: 'Coppock',
    calcParams: [14, 11, 10],
    figures: [{ key: 'copp', title: 'Coppock: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const [wma_p, roc1_p, roc2_p] = indicator.calcParams;
      const c = closes(dataList);
      const rocSum = dataList.map((_, i) => {
        const r1 = i >= roc1_p ? (c[i] - c[i - roc1_p]) / c[i - roc1_p] * 100 : NaN;
        const r2 = i >= roc2_p ? (c[i] - c[i - roc2_p]) / c[i - roc2_p] * 100 : NaN;
        return r1 + r2;
      });
      const w = calcWMA(rocSum, wma_p);
      return dataList.map((_, i) => ({ copp: isNaN(w[i]) ? undefined : w[i] }));
    },
  });

  // ─── Generic fallback for unsupported indicators ───
  // Uses a simple SMA as placeholder rendering
  registerIndicator({
    name: 'FALLBACK_OVERLAY',
    shortName: 'Calc…',
    calcParams: [20],
    figures: [{ key: 'val', title: 'Val: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 20;
      const c = closes(dataList);
      const s = sma(c, period);
      return dataList.map((_, i) => ({ val: isNaN(s[i]) ? undefined : s[i] }));
    },
  });

  registerIndicator({
    name: 'FALLBACK_OSCILLATOR',
    shortName: 'Calc…',
    calcParams: [14],
    figures: [{ key: 'val', title: 'Val: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 14;
      const c = closes(dataList);
      return dataList.map((_, i) => {
        if (i < period) return {};
        return { val: ((c[i] - c[i - period]) / c[i - period]) * 100 };
      });
    },
  });

  // ─── WMA (not built into klinecharts) ───
  registerIndicator({
    name: 'WMA_CUSTOM',
    shortName: 'WMA',
    calcParams: [20],
    figures: [{ key: 'wma', title: 'WMA: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 20;
      const vals = calcWMA(closes(dataList), period);
      return dataList.map((_, i) => ({ wma: isNaN(vals[i]) ? undefined : vals[i] }));
    },
  });

  // ─── ATR (not built into klinecharts) ───
  registerIndicator({
    name: 'ATR_CUSTOM',
    shortName: 'ATR',
    calcParams: [14],
    figures: [{ key: 'atr', title: 'ATR: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 14;
      const trs: number[] = [];
      for (let i = 0; i < dataList.length; i++) {
        if (i === 0) { trs.push(dataList[i].high - dataList[i].low); continue; }
        trs.push(Math.max(
          dataList[i].high - dataList[i].low,
          Math.abs(dataList[i].high - dataList[i - 1].close),
          Math.abs(dataList[i].low - dataList[i - 1].close)
        ));
      }
      const atrVals = ema(trs, period);
      return dataList.map((_, i) => ({ atr: atrVals[i] }));
    },
  });

  // ─── MFI (not built into klinecharts) ───
  registerIndicator({
    name: 'MFI_CUSTOM',
    shortName: 'MFI',
    calcParams: [14],
    figures: [{ key: 'mfi', title: 'MFI: ', type: 'line' }],
    calc: (dataList, indicator) => {
      const period = indicator.calcParams[0] ?? 14;
      return dataList.map((_, i) => {
        if (i < period) return {};
        let posFlow = 0, negFlow = 0;
        for (let j = i - period + 1; j <= i; j++) {
          const tp = (dataList[j].high + dataList[j].low + dataList[j].close) / 3;
          const prevTp = j > 0 ? (dataList[j-1].high + dataList[j-1].low + dataList[j-1].close) / 3 : tp;
          const mf = tp * dataList[j].volume;
          if (tp > prevTp) posFlow += mf;
          else negFlow += mf;
        }
        const ratio = negFlow === 0 ? 100 : posFlow / negFlow;
        return { mfi: 100 - (100 / (1 + ratio)) };
      });
    },
  });

  // ─── 动态谢林点 DSP（主图）+ 买方推力漂移速度 DSP·a、主动买方优势 A（两个副图）───
  // 【用户要求】2026-10-15 按用户规格；计算在 dynamicSchellingPoint.ts。成交额来自 K 线的 turnover / takerBuyTurnover（USDT），缺失不拿币数凑。
  // 三个指标各算一遍同一个 computeDsp（同一份数据、同一个半衰期），结果一致。
  registerIndicator({
    name: 'DSP_CUSTOM',
    shortName: 'DSP',
    // 与主图价格同精度（IndicatorSeries.Price 的值；只做类型导入，测试里的 klinecharts 替身没有这个枚举）
    series: 'price' as IndicatorSeries,
    calcParams: [DSP_DEFAULTS.halfLifeHours],
    figures: [{
      key: 'dsp', title: 'DSP: ', type: 'line',
      // V > 0 绿、V < 0 红：曲线往哪边走一眼可见。klinecharts 用这一根的样式画「这一根 → 下一根」那段线，
      // 所以按段终点（下一根）的 V 着色：最新那段立刻反映最新一根的方向，不晚一根
      styles: (data) => ({ color: vColor(segmentEndV(data)), size: 2 }),
    }],
    calc: (dataList, indicator) => dspPoints(dataList, indicator.calcParams[0]).map(p => (p.dsp == null ? {} : { dsp: p.dsp, v: p.v ?? undefined })),
  });

  registerDspVariant({
    name: 'DSP_V_CUSTOM',
    shortName: 'DSP·a',
    // [半衰期 h, Z 开关]
    calcParams: [DSP_DEFAULTS.halfLifeHours, 0],
    createTooltipDataSource: dspATooltip('a'),
    precision: 3,
    // 纵轴总是包含 0（多空平衡线）：klinecharts 取 min(minValue, 数据最小)、max(maxValue, 数据最大)
    minValue: 0,
    maxValue: 0,
    draw: V_ZERO_LINE,
    figures: [
      {
        key: 'v', title: 'a(基点/根): ', type: 'line',
        styles: (data) => ({ color: vColor(segmentEndV(data)), size: 1.5 }),
      },
    ],
    calc: (dataList, indicator) => unifiedDspA(dataList, indicator.calcParams[0], indicator.calcParams[1] === 1).map(x => (x == null ? {} : { v: x })),
  });

  // 【用户要求】avg_a = avg(a, N)：独立副图，紧挨在 a 副图下面。参数 [半衰期 h, 均线时长 N]；0 轴与 a 副图同一条橘黄色虚线，线按正负着色
  registerDspVariant({
    name: 'DSP_V_AVG_CUSTOM',
    shortName: 'avg_a',
    // [半衰期 h, 均线时长 N, Z 开关]
    calcParams: [DSP_DEFAULTS.halfLifeHours, AVG_DEFAULT_HOURS, 0],
    createTooltipDataSource: dspATooltip('avg'),
    precision: 8,
    draw: V_ZERO_LINE,
    figures: [
      {
        key: 'v', title: 'avg_a(基点/根): ', type: 'line',
        styles: (data) => ({ color: vColor(segmentEndV(data)), size: 1.5 }),
      },
    ],
    calc: (dataList, indicator) => {
      const values = buyerSeries(dataList, indicator.calcParams[2] === 1 ? 'DSP_Z' : 'DSP_VA', indicator.calcParams[0]);
      return values.avg.map(x => (x == null ? {} : { v: x }));
    },
  });

  registerDspVariant({
    name: 'DSP_A_CUSTOM',
    shortName: 'DSP·A',
    calcParams: [DSP_DEFAULTS.halfLifeHours],
    precision: 3,
    // 纵轴总是包含 0（多空平衡线）：klinecharts 取 min(minValue, 数据最小)、max(maxValue, 数据最大)
    minValue: 0,
    maxValue: 0,
    draw: A_ZERO_LINE,
    figures: [
      {
        key: 'a', title: '主动买方优势 A: ', type: 'bar', baseValue: 0,
        styles: (data) => {
          const a = (data.current.indicatorData as { a?: number } | undefined)?.a ?? 0;
          return { color: a >= 0 ? 'rgba(14,203,129,0.7)' : 'rgba(246,70,93,0.7)' };
        },
      },
    ],
    calc: (dataList, indicator) => dspPoints(dataList, indicator.calcParams[0]).map(p => (p.a == null ? {} : { a: p.a })),
  });

  // ─── BSS 买卖强度综合分（副图）───
  // 【用户要求】2026-10-18：BSS = 0.45·M标准化 + 0.25·V标准化 + 0.30·A，−1 ~ 1；订单簿 I 没有历史，去掉。计算在 bss.ts（与 Deep dig 同一份）。
  registerIndicator({
    name: 'BSS_CUSTOM',
    shortName: 'BSS',
    createTooltipDataSource: ({ indicator, defaultStyles }) => ({ name: 'BSS', calcParamsText: `(${indicator.calcParams[0]}h)`, icons: defaultStyles.tooltip.icons, values: undefined as never }),
    calcParams: [BSS_DEFAULTS.recentHours],
    precision: 2,
    // 纵轴固定包含 −1 ~ 1（BSS 的取值范围），参考线始终画得出来
    minValue: -1,
    maxValue: 1,
    draw: V_ZERO_LINE,
    figures: [
      {
        key: 'bss', title: 'BSS: ', type: 'line',
        styles: (data) => ({ color: bssColor((data.next?.indicatorData as { bss?: number } | undefined)?.bss ?? (data.current.indicatorData as { bss?: number } | undefined)?.bss), size: 1.5 }),
      },
    ],
    calc: (dataList, indicator) => buyerSeries(dataList, 'BSS', indicator.calcParams[0]).core.map(x => (x == null ? {} : { bss: x })),
  });

  // ─── CBA 买方定价优势指数（副图）───
  // 【用户要求】2026-10-18：CBA = 100·tanh(Σ w·F·G·R)，−100 ~ 100。计算在 cba.ts（与 Deep dig 同一份）。0 轴是分水岭：与 DSP·a 同一条橘黄色虚线
  registerIndicator({
    name: 'CBA_CUSTOM',
    shortName: 'CBA',
    createTooltipDataSource: ({ indicator, defaultStyles }) => ({ name: 'CBA', calcParamsText: `(${indicator.calcParams[0]}h)`, icons: defaultStyles.tooltip.icons, values: undefined as never }),
    calcParams: [CBA_DEFAULTS.halfLifeHours],
    precision: 1,
    minValue: 0,
    maxValue: ACTION_LEVELS.cba, // 纵轴总是包含 0 与橘色线
    draw: CBA_ACTION_LINE,
    figures: [
      {
        key: 'cba', title: 'CBA: ', type: 'line',
        styles: (data) => {
          const end = (data.next?.indicatorData as { cba?: number } | undefined)?.cba ?? (data.current.indicatorData as { cba?: number } | undefined)?.cba;
          return { color: vColor(end), size: 1.5 };
        },
      },
    ],
    calc: (dataList, indicator) => buyerSeries(dataList, 'CBA', indicator.calcParams[0]).core.map(x => (x == null ? {} : { cba: x })),
  });

  registerIndicator({
    name: 'CBA2_CUSTOM', shortName: 'CBA-2', calcParams: [6], precision: 2,
    minValue: 0, maxValue: 0, draw: V_ZERO_LINE,
    figures: [
      { key: 'cba2', title: 'CBA-2: ', type: 'line', styles: data => ({ color: vColor((data.current.indicatorData as { cba2?: number } | undefined)?.cba2), size: 1.5 }) },
      { key: 'invalid', title: '失效（1=是）: ', type: 'circle', styles: () => ({ color: '#F6465D', size: 3 }) },
    ],
    calc: (dataList, indicator) => {
      const def = accountFeatureDef('cba-2');
      if (!def || sameCoreAsBuiltin(def, BUILTIN_FEATURES.find(b => b.id === 'cba-2'))) return cba2Points(dataList, indicator.calcParams[0]).map(p => ({ cba2: p.cba2 ?? undefined, invalid: p.invalid === true ? 1 : undefined }));
      // 定义改过：按改过的公式（同样只认 5 分钟图）
      if (dataList.length > 1 && inferIntervalMs(dataList.map(d => ({ time: d.timestamp }))) !== 300000) return dataList.map(() => ({}));
      const out = chartFeatureSeries(dataList, 'cba-2', indicator.calcParams[0]);
      const invalid = out?.vars.get('invalid');
      return dataList.map((_, i) => ({ cba2: out?.core[i] ?? undefined, invalid: invalid?.[i] === 1 ? 1 : undefined }));
    },
  });

  // ─── CBI 买方优势指数（副图）───
  // 【用户要求】2026-10-18：CBI = P × D，−1 ~ 1，> 0 买方占优。计算在 cbi.ts（与 Deep dig 同一份）。0 轴橘黄色虚线
  registerIndicator({
    name: 'CBI_CUSTOM',
    shortName: 'CBI',
    calcParams: [CBI_DEFAULTS.h],
    precision: 3,
    minValue: -1,
    maxValue: 1,
    draw: V_ZERO_LINE,
    figures: [
      {
        key: 'cbi', title: 'CBI: ', type: 'line',
        styles: (data) => {
          const end = (data.next?.indicatorData as { cbi?: number } | undefined)?.cbi ?? (data.current.indicatorData as { cbi?: number } | undefined)?.cbi;
          return { color: vColor(end), size: 1.5 };
        },
      },
    ],
    calc: (dataList, indicator) => unifiedCore(dataList, 'cbi', indicator.calcParams[0], () => cbiPoints(dataList, indicator.calcParams[0]).map(p => p.cbi)).map(x => (x == null ? {} : { cbi: x })),
  });

  // ─── CBI-2 买方优势指数第 2 版（副图）───
  // 【用户要求】2026-10-18：CBI-2 = 2p − 1，−1 ~ 1，0 = 五五开。直接算 Deep dig 的同一份公式（cbi2.ts）。参数 [基线回看小时, BTC 数据版本]
  registerIndicator({
    name: 'CBI2_CUSTOM',
    shortName: 'CBI-2',
    calcParams: [CBI2_DEFAULTS.baseHours, 0],
    precision: 3,
    minValue: -1,
    maxValue: 1,
    draw: CBI2_ACTION_LINE,
    // 括号里只写基线小时，不写 BTC 版本号；图例数值照默认
    createTooltipDataSource: ({ indicator, defaultStyles }) => ({
      name: 'CBI-2', calcParamsText: `(${(indicator.calcParams as number[])[0]}h)`, icons: defaultStyles.tooltip.icons, values: undefined as never,
    }),
    figures: [
      {
        key: 'cbi2', title: 'CBI-2: ', type: 'line',
        styles: (data) => {
          const end = (data.next?.indicatorData as { cbi2?: number } | undefined)?.cbi2 ?? (data.current.indicatorData as { cbi2?: number } | undefined)?.cbi2;
          return { color: vColor(end), size: 1.5 };
        },
      },
    ],
    calc: (dataList, indicator) => {
      return buyerSeries(dataList, 'CBI2', indicator.calcParams[0]).core.map(x => (x == null ? {} : { cbi2: x }));
    },
  });

  // 【用户要求】avg_BSS = avg(BSS, N)：独立副图，紧挨在 BSS 副图下面。参数 [近期窗口 n, 均线时长 N]；参考线、着色与 BSS 副图相同
  registerIndicator({
    name:'CTBA_CUSTOM',shortName:'CTBA',calcParams:[CTBA_DEFAULTS.N,0,0],precision:2,minValue:-100,maxValue:100,draw:V_ZERO_LINE,
    figures:[{key:'ctba',title:'CTBA: ',type:'line',styles:data=>({color:vColor((data.current.indicatorData as {ctba?:number}|undefined)?.ctba),size:1.5})}],
    calc:(data,indicator)=>buyerSeries(data,'CTBA',indicator.calcParams[0]).core.map(ctba=>ctba==null?{}:{ctba}),
  });
  registerIndicator({
    name: 'MBI_CUSTOM', shortName: 'MBI', calcParams: [MBI_N, 0, 0], precision: 2,
    minValue: -1, maxValue: 1, draw: V_ZERO_LINE,
    createTooltipDataSource: ({ indicator, defaultStyles }) => ({ name: 'MBI', calcParamsText: `(${indicator.calcParams[0]}根)`, icons: defaultStyles.tooltip.icons, values: undefined as never }),
    figures: [{ key: 'mbi', title: 'MBI: ', type: 'line', styles: data => ({
      color: vColor((data.next?.indicatorData as { mbi?: number } | undefined)?.mbi ?? (data.current.indicatorData as { mbi?: number } | undefined)?.mbi), size: 1.5,
    }) }],
    calc: (data, indicator) => buyerSeries(data, 'MBI', indicator.calcParams[0]).core.map(mbi => mbi == null ? {} : { mbi }),
  });

  registerIndicator({
    name: 'BSS_AVG_CUSTOM',
    shortName: 'avg_BSS',
    createTooltipDataSource: ({ indicator, defaultStyles }) => ({ name: 'avg_BSS', calcParamsText: `(${indicator.calcParams[0]}h)`, icons: defaultStyles.tooltip.icons, values: undefined as never }),
    calcParams: [BSS_DEFAULTS.recentHours, AVG_DEFAULT_HOURS],
    precision: 8,
    draw: avgBssLines,
    figures: [
      {
        key: 'bss', title: 'avg_BSS: ', type: 'line',
        styles: (data) => ({ color: bssColor((data.next?.indicatorData as { bss?: number } | undefined)?.bss ?? (data.current.indicatorData as { bss?: number } | undefined)?.bss), size: 1.5 }),
      },
    ],
    calc: (dataList, indicator) => {
      return buyerSeries(dataList, 'BSS', indicator.calcParams[0]).avg.map(x => (x == null ? {} : { bss: x }));
    },
  });

  // Complete the original five entries with named Deep dig averages. Keep native
  // series keys for existing panes; never average the formula's last expression.
  for (const item of BUYER_RESEARCH_INDICATORS) {
    for (const level of [1, 2]) {
      if (level === 1 && ['DSP_VA', 'DSP_Z', 'BSS'].includes(item.id)) continue;
      if (item.id === 'DSP_Z') continue; // Registered as the independent Z alias below.
      const key = item.id === 'DSP_VA' ? 'v' : item.id === 'BSS' ? 'bss' : item.id === 'CBI2' ? 'cbi2' : item.id === 'MBI' ? 'mbi' : item.id === 'CTBA' ? 'ctba' : 'cba';
      const label = `avg_${item.core}${level === 2 ? '_2' : ''}`;
      const template: IndicatorTemplate = {
        name: researchKcName(item.id, level), shortName: label, calcParams: [item.period, 0, 0], precision: item.id === 'MBI' ? 2 : 8,
        draw: item.id === 'BSS' ? avgBssLines : item.id === 'CBA' ? CBA_ACTION_LINE : item.id === 'CBI2' ? CBI2_ACTION_LINE : V_ZERO_LINE,
        createTooltipDataSource: ({ indicator, defaultStyles }) => {
          const selected = item.id === 'DSP_VA' && indicator.calcParams[1] === 1 ? BUYER_RESEARCH_INDICATORS.find(i => i.id === 'DSP_Z')! : item;
          const def = chartFeatureDef(selected.featureId);
          const names = def ? researchSeriesNames(selected, def.formula) : null;
          return { name: (level === 1 ? names?.avg : names?.avg2) ?? label, calcParamsText: `(${indicator.calcParams[0]}${item.id === 'MBI' ? '根' : 'h'})`, icons: defaultStyles.tooltip.icons, values: undefined as never };
        },
        figures: [{ key, title: `${label}: `, type: 'line', styles: data => {
          const value = (data.next?.indicatorData as Record<string, number> | undefined)?.[key] ?? (data.current.indicatorData as Record<string, number> | undefined)?.[key];
          return { color: item.id === 'BSS' ? bssColor(value) : vColor(value), size: 1.5 };
        } }],
        calc: (data, indicator) => {
          const selected = item.id === 'DSP_VA' && indicator.calcParams[1] === 1 ? 'DSP_Z' : item.id;
          const values = buyerSeries(data, selected, indicator.calcParams[0]);
          return (level === 1 ? values.avg : values.avg2).map(value => value == null ? {} : { [key]: value });
        },
      };
      if (item.id === 'DSP_VA') registerDspVariant(template); else registerIndicator(template);
    }
  }

  // One source of truth: the account's Deep dig formula, including both named averages.
  for (const item of RESEARCH_INDICATORS) {
    for (const level of [0, 1, 2]) {
      const label = level === 0 ? item.short : `avg_${item.core}${level === 2 ? '_2' : ''}`;
      // 均值线可单独设橘色线（avgNeutral）；没设就与原始值相同
      const line = level > 0 && 'avgNeutral' in item ? item.avgNeutral : item.neutral;
      registerIndicator({
        name: researchKcName(item.id, level), shortName: label,
        calcParams: [item.period, 0, 0], precision: level === 0 ? (item.id === 'CDA' ? 2 : 3) : 8,
        // Fixed-range averages retain their reference bounds; other averages use visible values.
        ...(level === 0 ? { minValue: item.min, maxValue: item.max } : 'avgRange' in item ? { minValue: item.avgRange[0], maxValue: item.avgRange[1] } : {}),
        draw: args => {
          if (item.seller) A_ZERO_LINE(args);
          return zeroLine(ORANGE_DASH_LINE, line, 'neutralLabel' in item ? item.neutralLabel : undefined)(args);
        },
        createTooltipDataSource: ({ indicator, defaultStyles, crosshair }) => {
          if(item.id==='MBI2'||item.id==='MBI2_BEAR'){
            const row=indicator.result[crosshair?.dataIndex??indicator.result.length-1] as Record<string,number>|undefined;
            const fmt=(v:number|undefined)=>v==null||!Number.isFinite(v)?'—':v.toFixed(4);
            return {name:label,calcParamsText:`(${indicator.calcParams[0]}h)`,icons:defaultStyles.tooltip.icons,values:[
              {title:item.short+': ',value:{text:fmt(row?.value),color:vColor(row?.value)}},
              {title:'状态: ',value:mbi2StateLabel(row?.[item.core+'_state'])},
              {title:'本轮小时: ',value:fmt(row?.[item.core+'_lead_h'])},{title:'确认小时: ',value:fmt(row?.[item.core+'_confirm_h'])},
            ]};
          }
          if(item.id==='CTBA_12H'||item.id==='CTBA_12H_BEAR'){
            const row=indicator.result[crosshair?.dataIndex ?? indicator.result.length-1] as Record<string,number|undefined>|undefined;
            const format=(value:number|undefined,digits:number)=>value==null||!Number.isFinite(value)?'—':(Math.abs(value)<.5*10**-digits?0:value).toFixed(digits);
            return {name:label,calcParamsText:ctbaChartParameterText(item.featureId,indicator.calcParams[0])+` · 参数版本 ${researchDefinitionVersion(item).toString(16)}`,icons:defaultStyles.tooltip.icons,
              values:[{title:label+': ',value:{text:format(row?.value,2),color:vColor(row?.value)}},...['T','M','F'].map(name=>({title:name+': ',value:{text:format(row?.[name],5),color:vColor(row?.[name])}}))]};
          }
          return {name:label+(chartFeatureDef(item.featureId)?.unit?`(${chartFeatureDef(item.featureId)!.unit})`:''),calcParamsText:'('+indicator.calcParams[0]+(['MBI_BEAR','CTBA_BEAR'].includes(item.id)?'根':'h')+')',icons:defaultStyles.tooltip.icons,values:undefined as never};
        },
        figures: [{ key: 'value', title: `${label}: `, type: 'line', styles: data => {
          const value = (data.next?.indicatorData as { value?: number } | undefined)?.value ?? (data.current.indicatorData as { value?: number } | undefined)?.value;
          const colorLine = item.seller ? 0 : line;
          const stateWarning = level === 0 && (item.id === 'STATE' || item.id === 'STATE2')
            && value != null && value >= 0.5 && value <= 0.6;
          const color = stateWarning ? '#FFD600' : value == null || value === colorLine ? '#F0B90B'
            : value > colorLine ? '#0ECB81' : '#F6465D';
          return { color, size: 1.5 };
        } }],
        calc: (dataList, indicator) => {
          const values = researchChartSeries(dataList, item, indicator.calcParams[0]);
          const rows = indicatorRows(indicator, level === 0 ? values.core : level === 1 ? values.avg : values.avg2, 'value');
          return ('components' in item) ? rows.map((row, i) => ({ ...row,
            ...Object.fromEntries(item.components.map(name => [name, values.components?.[name]?.[i] ?? undefined])),
          })) : rows;
        },
      });
    }
  }

    registered = true;
  } catch (e) {
    console.error('Failed to register custom indicators:', e);
  }
}

/**
 * Maps indicator IDs to klinecharts indicator names (built-in or custom registered).
 * Returns null if no mapping exists (will use fallback).
 */
export const CUSTOM_INDICATOR_MAP: Record<string, string> = {
  // Built-in klinecharts indicators (verified in klinecharts 9.8.12 ESM)
  MA: 'MA', EMA: 'EMA', SMA: 'SMA',
  BOLL: 'BOLL', SAR: 'SAR',
  RSI: 'RSI', MACD: 'MACD', KDJ: 'KDJ',
  CCI: 'CCI', OBV: 'OBV', ROC: 'ROC',
  STOCH: 'KDJ', VOL: 'VOL',
  DMI: 'DMI', TRIX: 'TRIX',
  WR: 'WR',
  EMV: 'EMV', PVT: 'PVT',
  AO: 'AO',

  // Custom registered (not built into klinecharts)
  WMA: 'WMA_CUSTOM',
  ATR: 'ATR_CUSTOM',
  MFI: 'MFI_CUSTOM',
  ADX: 'ADX_CUSTOM',
  VWAP: 'VWAP_CUSTOM',
  ICH: 'ICH_CUSTOM',
  STOCH_RSI: 'STOCH_RSI_CUSTOM',
  KC: 'KC_CUSTOM',
  AD: 'AD_CUSTOM',
  ELDER: 'ELDER_CUSTOM',
  BOLL_B: 'BOLL_B_CUSTOM',
  BBW: 'BBW_CUSTOM',
  DEMA: 'DEMA_CUSTOM',
  TEMA: 'TEMA_CUSTOM',
  HMA: 'HMA_CUSTOM',
  SMMA: 'SMMA_CUSTOM',
  DC: 'DC_CUSTOM',
  MOM: 'MOM_CUSTOM',
  AROON: 'AROON_CUSTOM',
  STDEV: 'STDEV_CUSTOM',
  HV: 'HV_CUSTOM',
  DSP: 'DSP_CUSTOM',
  DSP_VA: 'DSP_V_CUSTOM',
  DSP_Z: 'DSP_Z_V_CUSTOM',
  BSS: 'BSS_CUSTOM',
  CBA: 'CBA_CUSTOM',
  'CBA-2': 'CBA2_CUSTOM',
  CBI: 'CBI_CUSTOM',
  CBI2: 'CBI2_CUSTOM',
  MBI: 'MBI_CUSTOM',
  CTBA:'CTBA_CUSTOM',
  ...Object.fromEntries(RESEARCH_INDICATORS.map(item => [item.id, researchKcName(item.id)])),
  CHOP: 'CHOP_CUSTOM',
  CMF: 'CMF_CUSTOM',
  BOP: 'BOP_CUSTOM',
  COPP: 'COPP_CUSTOM',
};
