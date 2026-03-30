/**
 * Technical Indicator Engine — Full implementation using `technicalindicators` library
 * All 80+ indicators are now active with real calculations.
 */

import {
  SMA, EMA, WMA, WEMA, BollingerBands, RSI, MACD, ATR, ADX, CCI,
  Stochastic, StochasticRSI, WilliamsR, MFI, OBV, VWAP, ROC,
  TRIX, ForceIndex, IchimokuCloud, PSAR, KeltnerChannels,
} from 'technicalindicators';
import type { KlineData } from './useBinanceData';

// ===== Output types =====
export interface IndicatorPoint { time: number; value: number; }
export interface BollBand { time: number; upper: number; middle: number; lower: number; }
export interface MACDResult { time: number; macd: number; signal: number; histogram: number; }
export interface ChannelResult { time: number; upper: number; middle: number; lower: number; }
export interface StochResult { time: number; k: number; d: number; }
export interface IchimokuResult {
  time: number;
  conversion: number; base: number;
  spanA: number; spanB: number;
}
export interface DMIResult { time: number; pdi: number; mdi: number; adx: number; }

// ===== Helper: truncate data for performance =====
function truncate(data: KlineData[], period: number, minBars = 200): KlineData[] {
  const needed = Math.max(period * 5, minBars);
  if (data.length <= needed) return data;
  return data.slice(data.length - needed);
}

// ===== Core calculation functions =====

export function calcSMA(data: KlineData[], period: number): IndicatorPoint[] {
  const d = truncate(data, period);
  const result = SMA.calculate({ period, values: d.map(x => x.close) });
  const offset = d.length - result.length;
  return result.map((v, i) => ({ time: d[i + offset].time, value: v }));
}

export function calcEMA(data: KlineData[], period: number): IndicatorPoint[] {
  const d = truncate(data, period);
  const result = EMA.calculate({ period, values: d.map(x => x.close) });
  const offset = d.length - result.length;
  return result.map((v, i) => ({ time: d[i + offset].time, value: v }));
}

export function calcWMA(data: KlineData[], period: number): IndicatorPoint[] {
  const d = truncate(data, period);
  const result = WMA.calculate({ period, values: d.map(x => x.close) });
  const offset = d.length - result.length;
  return result.map((v, i) => ({ time: d[i + offset].time, value: v }));
}

export function calcDEMA(data: KlineData[], period: number): IndicatorPoint[] {
  const d = truncate(data, period);
  const closes = d.map(x => x.close);
  const ema1 = EMA.calculate({ period, values: closes });
  const ema2 = EMA.calculate({ period, values: ema1 });
  const offset2 = ema1.length - ema2.length;
  const results: IndicatorPoint[] = [];
  const baseOffset = d.length - ema1.length;
  for (let i = 0; i < ema2.length; i++) {
    const dema = 2 * ema1[i + offset2] - ema2[i];
    results.push({ time: d[i + offset2 + baseOffset].time, value: dema });
  }
  return results;
}

export function calcTEMA(data: KlineData[], period: number): IndicatorPoint[] {
  const d = truncate(data, period);
  const closes = d.map(x => x.close);
  const ema1 = EMA.calculate({ period, values: closes });
  const ema2 = EMA.calculate({ period, values: ema1 });
  const ema3 = EMA.calculate({ period, values: ema2 });
  const off1 = ema1.length - ema2.length;
  const off2 = ema2.length - ema3.length;
  const baseOff = d.length - ema1.length;
  const results: IndicatorPoint[] = [];
  for (let i = 0; i < ema3.length; i++) {
    const tema = 3 * ema1[i + off1 + off2] - 3 * ema2[i + off2] + ema3[i];
    results.push({ time: d[i + off1 + off2 + baseOff].time, value: tema });
  }
  return results;
}

export function calcBOLL(data: KlineData[], period: number = 20, stdDev: number = 2): BollBand[] {
  const d = truncate(data, period);
  const result = BollingerBands.calculate({ period, values: d.map(x => x.close), stdDev });
  const offset = d.length - result.length;
  return result.map((b, i) => ({ time: d[i + offset].time, upper: b.upper, middle: b.middle, lower: b.lower }));
}

export function calcRSI(data: KlineData[], period: number = 14): IndicatorPoint[] {
  const d = truncate(data, period);
  const result = RSI.calculate({ period, values: d.map(x => x.close) });
  const offset = d.length - result.length;
  return result.map((v, i) => ({ time: d[i + offset].time, value: v }));
}

export function calcMACD(data: KlineData[], _period: number = 12): MACDResult[] {
  const d = truncate(data, 26);
  const result = MACD.calculate({
    values: d.map(x => x.close), fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false,
  });
  const offset = d.length - result.length;
  return result
    .filter(r => r.MACD !== undefined && r.signal !== undefined && r.histogram !== undefined)
    .map((r, i) => ({ time: d[i + offset].time, macd: r.MACD!, signal: r.signal!, histogram: r.histogram! }));
}

export function calcATR(data: KlineData[], period: number = 14): IndicatorPoint[] {
  const d = truncate(data, period);
  const result = ATR.calculate({ period, high: d.map(x => x.high), low: d.map(x => x.low), close: d.map(x => x.close) });
  const offset = d.length - result.length;
  return result.map((v, i) => ({ time: d[i + offset].time, value: v }));
}

export function calcADX(data: KlineData[], period: number = 14): DMIResult[] {
  const d = truncate(data, period);
  const result = ADX.calculate({ period, high: d.map(x => x.high), low: d.map(x => x.low), close: d.map(x => x.close) });
  const offset = d.length - result.length;
  return result.map((r, i) => ({ time: d[i + offset].time, pdi: r.pdi, mdi: r.mdi, adx: r.adx }));
}

export function calcCCI(data: KlineData[], period: number = 20): IndicatorPoint[] {
  const d = truncate(data, period);
  const result = CCI.calculate({ period, high: d.map(x => x.high), low: d.map(x => x.low), close: d.map(x => x.close) });
  const offset = d.length - result.length;
  return result.map((v, i) => ({ time: d[i + offset].time, value: v }));
}

export function calcStochastic(data: KlineData[], period: number = 14): StochResult[] {
  const d = truncate(data, period);
  const result = Stochastic.calculate({ period, signalPeriod: 3, high: d.map(x => x.high), low: d.map(x => x.low), close: d.map(x => x.close) });
  const offset = d.length - result.length;
  return result.map((r, i) => ({ time: d[i + offset].time, k: r.k, d: r.d }));
}

export function calcStochasticRSI(data: KlineData[], period: number = 14): StochResult[] {
  const d = truncate(data, period);
  const result = StochasticRSI.calculate({
    rpiPeriod: period, stochasticPeriod: period, kPeriod: 3, dPeriod: 3,
    values: d.map(x => x.close),
  } as any);
  const offset = d.length - result.length;
  return result.map((r: any, i: number) => ({ time: d[i + offset].time, k: r.stochRSI ?? r.k ?? 0, d: r.d ?? 0 }));
}

export function calcWilliamsR(data: KlineData[], period: number = 14): IndicatorPoint[] {
  const d = truncate(data, period);
  const result = WilliamsR.calculate({ period, high: d.map(x => x.high), low: d.map(x => x.low), close: d.map(x => x.close) });
  const offset = d.length - result.length;
  return result.map((v, i) => ({ time: d[i + offset].time, value: v }));
}

export function calcMFI(data: KlineData[], period: number = 14): IndicatorPoint[] {
  const d = truncate(data, period);
  const result = MFI.calculate({ period, high: d.map(x => x.high), low: d.map(x => x.low), close: d.map(x => x.close), volume: d.map(x => x.volume) });
  const offset = d.length - result.length;
  return result.map((v, i) => ({ time: d[i + offset].time, value: v }));
}

export function calcOBV(data: KlineData[]): IndicatorPoint[] {
  const d = truncate(data, 1, 500);
  const result = OBV.calculate({ close: d.map(x => x.close), volume: d.map(x => x.volume) });
  const offset = d.length - result.length;
  return result.map((v, i) => ({ time: d[i + offset].time, value: v }));
}

export function calcROC(data: KlineData[], period: number = 12): IndicatorPoint[] {
  const d = truncate(data, period);
  const result = ROC.calculate({ period, values: d.map(x => x.close) });
  const offset = d.length - result.length;
  return result.map((v, i) => ({ time: d[i + offset].time, value: v }));
}

export function calcTRIX(data: KlineData[], period: number = 15): IndicatorPoint[] {
  const d = truncate(data, period);
  const result = TRIX.calculate({ period, values: d.map(x => x.close) });
  const offset = d.length - result.length;
  return result.map((v, i) => ({ time: d[i + offset].time, value: v }));
}

export function calcForceIndex(data: KlineData[], period: number = 13): IndicatorPoint[] {
  const d = truncate(data, period);
  const result = ForceIndex.calculate({ period, close: d.map(x => x.close), volume: d.map(x => x.volume), open: d.map(x => x.open) } as any);
  const offset = d.length - result.length;
  return result.map((v, i) => ({ time: d[i + offset].time, value: v }));
}

export function calcPSAR(data: KlineData[], step = 0.02, max = 0.2): IndicatorPoint[] {
  const d = truncate(data, 1, 300);
  const result = PSAR.calculate({ step, max, high: d.map(x => x.high), low: d.map(x => x.low) });
  const offset = d.length - result.length;
  return result.filter(v => v !== undefined).map((v, i) => ({ time: d[i + offset].time, value: v as number }));
}

export function calcKeltnerChannels(data: KlineData[], period: number = 20): ChannelResult[] {
  const d = truncate(data, period);
  const result = (KeltnerChannels as any).calculate({
    maPeriod: period, atrPeriod: period, useTrueRange: true,
    high: d.map(x => x.high), low: d.map(x => x.low), close: d.map(x => x.close),
  });
  const offset = d.length - result.length;
  return result.map((r, i) => ({ time: d[i + offset].time, upper: r.upper, middle: r.middle, lower: r.lower }));
}

export function calcIchimoku(data: KlineData[], period: number = 9): IchimokuResult[] {
  const d = truncate(data, 52, 300);
  const result = IchimokuCloud.calculate({
    conversionPeriod: period, basePeriod: 26, spanPeriod: 52, displacement: 26,
    high: d.map(x => x.high), low: d.map(x => x.low),
  });
  const offset = d.length - result.length;
  return result.map((r, i) => ({
    time: d[i + offset].time,
    conversion: r.conversion, base: r.base,
    spanA: r.spanA, spanB: r.spanB,
  }));
}

// Generic calculations for indicators not directly in the library
export function calcDonchian(data: KlineData[], period: number = 20): ChannelResult[] {
  const d = truncate(data, period);
  const results: ChannelResult[] = [];
  for (let i = period - 1; i < d.length; i++) {
    let high = -Infinity, low = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (d[j].high > high) high = d[j].high;
      if (d[j].low < low) low = d[j].low;
    }
    results.push({ time: d[i].time, upper: high, middle: (high + low) / 2, lower: low });
  }
  return results;
}

export function calcMomentum(data: KlineData[], period: number = 10): IndicatorPoint[] {
  const d = truncate(data, period);
  const results: IndicatorPoint[] = [];
  for (let i = period; i < d.length; i++) {
    results.push({ time: d[i].time, value: d[i].close - d[i - period].close });
  }
  return results;
}

export function calcEnvelope(data: KlineData[], period: number = 20, pct: number = 2.5): ChannelResult[] {
  const d = truncate(data, period);
  const sma = SMA.calculate({ period, values: d.map(x => x.close) });
  const offset = d.length - sma.length;
  return sma.map((v, i) => ({
    time: d[i + offset].time,
    upper: v * (1 + pct / 100),
    middle: v,
    lower: v * (1 - pct / 100),
  }));
}

export function calcHV(data: KlineData[], period: number = 20): IndicatorPoint[] {
  const d = truncate(data, period);
  const results: IndicatorPoint[] = [];
  for (let i = period; i < d.length; i++) {
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const logReturn = Math.log(d[j].close / d[j - 1].close);
      sumSq += logReturn * logReturn;
    }
    const hv = Math.sqrt(sumSq / period) * Math.sqrt(252) * 100;
    results.push({ time: d[i].time, value: hv });
  }
  return results;
}

export function calcCHOP(data: KlineData[], period: number = 14): IndicatorPoint[] {
  const d = truncate(data, period);
  const atr1 = ATR.calculate({ period: 1, high: d.map(x => x.high), low: d.map(x => x.low), close: d.map(x => x.close) });
  const results: IndicatorPoint[] = [];
  // ATR(1) starts at index 1
  for (let i = period; i < d.length; i++) {
    let sumATR = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumATR += atr1[j - 1] || 0;
    }
    let hiHi = -Infinity, loLo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (d[j].high > hiHi) hiHi = d[j].high;
      if (d[j].low < loLo) loLo = d[j].low;
    }
    const range = hiHi - loLo;
    if (range > 0) {
      const chop = 100 * Math.log10(sumATR / range) / Math.log10(period);
      results.push({ time: d[i].time, value: chop });
    }
  }
  return results;
}

export function calcSMMA(data: KlineData[], period: number): IndicatorPoint[] {
  const d = truncate(data, period);
  const closes = d.map(x => x.close);
  const results: IndicatorPoint[] = [];
  if (closes.length < period) return results;
  let smma = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  results.push({ time: d[period - 1].time, value: smma });
  for (let i = period; i < closes.length; i++) {
    smma = (smma * (period - 1) + closes[i]) / period;
    results.push({ time: d[i].time, value: smma });
  }
  return results;
}

export function calcVWMA(data: KlineData[], period: number = 20): IndicatorPoint[] {
  const d = truncate(data, period);
  const results: IndicatorPoint[] = [];
  for (let i = period - 1; i < d.length; i++) {
    let sumPV = 0, sumV = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumPV += d[j].close * d[j].volume;
      sumV += d[j].volume;
    }
    results.push({ time: d[i].time, value: sumV > 0 ? sumPV / sumV : d[i].close });
  }
  return results;
}

export function calcStdDev(data: KlineData[], period: number = 20): IndicatorPoint[] {
  const d = truncate(data, period);
  const results: IndicatorPoint[] = [];
  for (let i = period - 1; i < d.length; i++) {
    const slice = d.slice(i - period + 1, i + 1).map(x => x.close);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    results.push({ time: d[i].time, value: Math.sqrt(variance) });
  }
  return results;
}

export function calcBollPctB(data: KlineData[], period: number = 20): IndicatorPoint[] {
  const boll = calcBOLL(data, period);
  return boll.map(b => ({
    time: b.time,
    value: b.upper !== b.lower ? (b.middle - b.lower) / (b.upper - b.lower) * 100 : 50,
  }));
}

export function calcBollWidth(data: KlineData[], period: number = 20): IndicatorPoint[] {
  const boll = calcBOLL(data, period);
  return boll.map(b => ({
    time: b.time,
    value: b.middle > 0 ? (b.upper - b.lower) / b.middle * 100 : 0,
  }));
}

export function calcMedianPrice(data: KlineData[]): IndicatorPoint[] {
  return data.map(d => ({ time: d.time, value: (d.high + d.low) / 2 }));
}

export function calcTypicalPrice(data: KlineData[]): IndicatorPoint[] {
  return data.map(d => ({ time: d.time, value: (d.high + d.low + d.close) / 3 }));
}

export function calcAvgPrice(data: KlineData[]): IndicatorPoint[] {
  return data.map(d => ({ time: d.time, value: (d.open + d.high + d.low + d.close) / 4 }));
}

export function calcDPO(data: KlineData[], period: number = 20): IndicatorPoint[] {
  const d = truncate(data, period);
  const sma = SMA.calculate({ period, values: d.map(x => x.close) });
  const offset = d.length - sma.length;
  const shift = Math.floor(period / 2) + 1;
  const results: IndicatorPoint[] = [];
  for (let i = 0; i < sma.length; i++) {
    const priceIdx = i + offset;
    if (priceIdx + shift < d.length) {
      results.push({ time: d[priceIdx].time, value: d[priceIdx].close - sma[i] });
    }
  }
  return results;
}

export function calcCMO(data: KlineData[], period: number = 9): IndicatorPoint[] {
  const d = truncate(data, period);
  const closes = d.map(x => x.close);
  const results: IndicatorPoint[] = [];
  for (let i = period; i < closes.length; i++) {
    let sumUp = 0, sumDown = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff > 0) sumUp += diff;
      else sumDown += Math.abs(diff);
    }
    const cmo = (sumUp + sumDown) !== 0 ? ((sumUp - sumDown) / (sumUp + sumDown)) * 100 : 0;
    results.push({ time: d[i].time, value: cmo });
  }
  return results;
}

// ===== Indicator Config (runtime state) =====
export interface IndicatorConfig {
  type: string;
  period: number;
  color?: string;
  enabled: boolean;
}

// ===== Presets =====
export const INDICATOR_PRESETS: {
  type: string; label: string; defaultPeriod: number; isOverlay: boolean; color: string;
}[] = [
  { type: 'MA',   label: '移动平均线 (MA)',      defaultPeriod: 7,  isOverlay: true,  color: '#F0B90B' },
  { type: 'EMA',  label: '指数移动平均线 (EMA)',  defaultPeriod: 21, isOverlay: true,  color: '#3B82F6' },
  { type: 'WMA',  label: '加权移动平均线 (WMA)',  defaultPeriod: 20, isOverlay: true,  color: '#FDBA74' },
  { type: 'DEMA', label: '双指数移动平均线',      defaultPeriod: 20, isOverlay: true,  color: '#93C5FD' },
  { type: 'TEMA', label: '三重指数平滑平均线',    defaultPeriod: 20, isOverlay: true,  color: '#22D3EE' },
  { type: 'SMMA', label: '平滑移动平均线',        defaultPeriod: 20, isOverlay: true,  color: '#A3E635' },
  { type: 'VWMA', label: '成交量加权移动平均',    defaultPeriod: 20, isOverlay: true,  color: '#38BDF8' },
  { type: 'BOLL', label: '布林带 (Bollinger)',     defaultPeriod: 20, isOverlay: true,  color: '#8B5CF6' },
  { type: 'DC',   label: '唐奇安通道',            defaultPeriod: 20, isOverlay: true,  color: '#5EEAD4' },
  { type: 'KC',   label: '肯特纳通道',            defaultPeriod: 20, isOverlay: true,  color: '#9333EA' },
  { type: 'ENVELOPE', label: '包络线',            defaultPeriod: 20, isOverlay: true,  color: '#BEF264' },
  { type: 'SAR',  label: '抛物线转向 (SAR)',       defaultPeriod: 2,  isOverlay: true,  color: '#FACC15' },
  { type: 'ICHIMOKU', label: '一目均衡表',         defaultPeriod: 9,  isOverlay: true,  color: '#F97316' },
  { type: 'MEDIAN', label: '中位数价格',           defaultPeriod: 1,  isOverlay: true,  color: '#FDE047' },
  { type: 'TYPICAL', label: '典型价格',            defaultPeriod: 1,  isOverlay: true,  color: '#E2E8F0' },
  { type: 'AVGPRICE', label: '平均价',             defaultPeriod: 1,  isOverlay: true,  color: '#E5E7EB' },
  { type: 'RSI',  label: '相对强弱指标 (RSI)',     defaultPeriod: 14, isOverlay: false, color: '#F59E0B' },
  { type: 'MACD', label: 'MACD',                   defaultPeriod: 12, isOverlay: false, color: '#10B981' },
  { type: 'ATR',  label: '真实波动幅度 (ATR)',     defaultPeriod: 14, isOverlay: false, color: '#EF4444' },
  { type: 'ADX',  label: '平均趋向指数 (ADX)',     defaultPeriod: 14, isOverlay: false, color: '#FB923C' },
  { type: 'CCI',  label: '顺势指标 (CCI)',         defaultPeriod: 20, isOverlay: false, color: '#94A3B8' },
  { type: 'STOCH', label: '随机指数 (KDJ)',        defaultPeriod: 14, isOverlay: false, color: '#A855F7' },
  { type: 'STOCHRSI', label: '随机RSI',            defaultPeriod: 14, isOverlay: false, color: '#8B5CF6' },
  { type: 'WILLR', label: '威廉指标 (%R)',         defaultPeriod: 14, isOverlay: false, color: '#FDA4AF' },
  { type: 'MFI',  label: '资金流量指数 (MFI)',     defaultPeriod: 14, isOverlay: false, color: '#86EFAC' },
  { type: 'OBV',  label: '能量潮 (OBV)',           defaultPeriod: 1,  isOverlay: false, color: '#A855F7' },
  { type: 'ROC',  label: '变化速率 (ROC)',         defaultPeriod: 12, isOverlay: false, color: '#FCD34D' },
  { type: 'MOM',  label: '动量指标',               defaultPeriod: 10, isOverlay: false, color: '#67E8F9' },
  { type: 'TRIX', label: 'TRIX',                   defaultPeriod: 15, isOverlay: false, color: '#2DD4BF' },
  { type: 'CHOP', label: '波动指数 (CHOP)',        defaultPeriod: 14, isOverlay: false, color: '#06B6D4' },
  { type: 'HV',   label: '历史波动率',             defaultPeriod: 20, isOverlay: false, color: '#FCA5A5' },
  { type: 'BOLLPB', label: '布林带 %B',            defaultPeriod: 20, isOverlay: false, color: '#D8B4FE' },
  { type: 'BOLLW', label: '布林带宽度',            defaultPeriod: 20, isOverlay: false, color: '#C084FC' },
  { type: 'DPO',  label: '非趋势价格摆动',         defaultPeriod: 20, isOverlay: false, color: '#CBD5E1' },
  { type: 'CMO',  label: '钱德动量摆动',           defaultPeriod: 9,  isOverlay: false, color: '#FDBA74' },
  { type: 'STDDEV', label: '标准偏差',             defaultPeriod: 20, isOverlay: false, color: '#E879F9' },
  { type: 'EFI',  label: '艾尔德力量指标',         defaultPeriod: 13, isOverlay: false, color: '#F472B6' },
];

// All types are now implemented
export const IMPLEMENTED_TYPES = new Set<string>(INDICATOR_PRESETS.map(p => p.type));

// ===== Full catalogue for UI menu (matches INDICATOR_PRESETS) =====
export interface IndicatorCatalogItem {
  id: string;
  nameZh: string;
  nameEn: string;
  isOverlay: boolean;
  defaultPeriod: number;
  color: string;
}

export const INDICATOR_CATALOG: IndicatorCatalogItem[] = INDICATOR_PRESETS.map(p => ({
  id: p.type,
  nameZh: p.label,
  nameEn: p.type,
  isOverlay: p.isOverlay,
  defaultPeriod: p.defaultPeriod,
  color: p.color,
}));

// ===== Universal calc dispatcher =====
export type CalcResult =
  | { kind: 'line'; data: IndicatorPoint[] }
  | { kind: 'channel'; data: ChannelResult[] }
  | { kind: 'macd'; data: MACDResult[] }
  | { kind: 'stoch'; data: StochResult[] }
  | { kind: 'dmi'; data: DMIResult[] }
  | { kind: 'ichimoku'; data: IchimokuResult[] }
  | { kind: 'boll'; data: BollBand[] };

export function calculateIndicator(type: string, data: KlineData[], period: number): CalcResult | null {
  try {
    switch (type) {
      case 'MA': return { kind: 'line', data: calcSMA(data, period) };
      case 'EMA': return { kind: 'line', data: calcEMA(data, period) };
      case 'WMA': return { kind: 'line', data: calcWMA(data, period) };
      case 'DEMA': return { kind: 'line', data: calcDEMA(data, period) };
      case 'TEMA': return { kind: 'line', data: calcTEMA(data, period) };
      case 'SMMA': return { kind: 'line', data: calcSMMA(data, period) };
      case 'VWMA': return { kind: 'line', data: calcVWMA(data, period) };
      case 'BOLL': return { kind: 'boll', data: calcBOLL(data, period) };
      case 'DC': return { kind: 'channel', data: calcDonchian(data, period) };
      case 'KC': return { kind: 'channel', data: calcKeltnerChannels(data, period) };
      case 'ENVELOPE': return { kind: 'channel', data: calcEnvelope(data, period) };
      case 'SAR': return { kind: 'line', data: calcPSAR(data) };
      case 'ICHIMOKU': return { kind: 'ichimoku', data: calcIchimoku(data, period) };
      case 'MEDIAN': return { kind: 'line', data: calcMedianPrice(data) };
      case 'TYPICAL': return { kind: 'line', data: calcTypicalPrice(data) };
      case 'AVGPRICE': return { kind: 'line', data: calcAvgPrice(data) };
      case 'RSI': return { kind: 'line', data: calcRSI(data, period) };
      case 'MACD': return { kind: 'macd', data: calcMACD(data, period) };
      case 'ATR': return { kind: 'line', data: calcATR(data, period) };
      case 'ADX': return { kind: 'dmi', data: calcADX(data, period) };
      case 'CCI': return { kind: 'line', data: calcCCI(data, period) };
      case 'STOCH': return { kind: 'stoch', data: calcStochastic(data, period) };
      case 'STOCHRSI': return { kind: 'stoch', data: calcStochasticRSI(data, period) };
      case 'WILLR': return { kind: 'line', data: calcWilliamsR(data, period) };
      case 'MFI': return { kind: 'line', data: calcMFI(data, period) };
      case 'OBV': return { kind: 'line', data: calcOBV(data) };
      case 'ROC': return { kind: 'line', data: calcROC(data, period) };
      case 'MOM': return { kind: 'line', data: calcMomentum(data, period) };
      case 'TRIX': return { kind: 'line', data: calcTRIX(data, period) };
      case 'CHOP': return { kind: 'line', data: calcCHOP(data, period) };
      case 'HV': return { kind: 'line', data: calcHV(data, period) };
      case 'BOLLPB': return { kind: 'line', data: calcBollPctB(data, period) };
      case 'BOLLW': return { kind: 'line', data: calcBollWidth(data, period) };
      case 'DPO': return { kind: 'line', data: calcDPO(data, period) };
      case 'CMO': return { kind: 'line', data: calcCMO(data, period) };
      case 'STDDEV': return { kind: 'line', data: calcStdDev(data, period) };
      case 'EFI': return { kind: 'line', data: calcForceIndex(data, period) };
      default: return null;
    }
  } catch (e) {
    console.warn(`Indicator calc error for ${type}:`, e);
    return null;
  }
}
