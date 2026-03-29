/**
 * Technical Indicator Calculations
 * All functions take OHLCV data and return { time, value } arrays
 * Compatible with lightweight-charts LineSeries format
 */

import type { KlineData } from './useBinanceData';

export interface IndicatorPoint {
  time: number; // ms timestamp
  value: number;
}

export interface BollBand {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

export interface MACDResult {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

// ===== Simple Moving Average =====
export function calcSMA(data: KlineData[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

// ===== Exponential Moving Average =====
export function calcEMA(data: KlineData[], period: number): IndicatorPoint[] {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result: IndicatorPoint[] = [];

  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i].close;
  let ema = sum / period;
  result.push({ time: data[period - 1].time, value: ema });

  for (let i = period; i < data.length; i++) {
    ema = data[i].close * k + ema * (1 - k);
    result.push({ time: data[i].time, value: ema });
  }
  return result;
}

// ===== Bollinger Bands =====
export function calcBOLL(data: KlineData[], period: number = 20, stdDev: number = 2): BollBand[] {
  const result: BollBand[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    const mean = sum / period;
    let sqSum = 0;
    for (let j = 0; j < period; j++) sqSum += (data[i - j].close - mean) ** 2;
    const std = Math.sqrt(sqSum / period);
    result.push({
      time: data[i].time,
      upper: mean + stdDev * std,
      middle: mean,
      lower: mean - stdDev * std,
    });
  }
  return result;
}

// ===== RSI =====
export function calcRSI(data: KlineData[], period: number = 14): IndicatorPoint[] {
  if (data.length < period + 1) return [];
  const result: IndicatorPoint[] = [];
  let avgGain = 0, avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) avgGain += change; else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push({ time: data[period].time, value: 100 - 100 / (1 + rs) });

  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
    const rs2 = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ time: data[i].time, value: 100 - 100 / (1 + rs2) });
  }
  return result;
}

// ===== MACD =====
export function calcMACD(data: KlineData[], fast = 12, slow = 26, signal = 9): MACDResult[] {
  const emaFast = calcEMA(data, fast);
  const emaSlow = calcEMA(data, slow);
  if (emaFast.length === 0 || emaSlow.length === 0) return [];

  // Align by time
  const slowMap = new Map(emaSlow.map(p => [p.time, p.value]));
  const macdLine: IndicatorPoint[] = [];
  for (const p of emaFast) {
    const sv = slowMap.get(p.time);
    if (sv !== undefined) macdLine.push({ time: p.time, value: p.value - sv });
  }

  if (macdLine.length < signal) return [];

  // Signal line = EMA of MACD line
  const k = 2 / (signal + 1);
  let sigEma = 0;
  for (let i = 0; i < signal; i++) sigEma += macdLine[i].value;
  sigEma /= signal;

  const result: MACDResult[] = [{
    time: macdLine[signal - 1].time,
    macd: macdLine[signal - 1].value,
    signal: sigEma,
    histogram: macdLine[signal - 1].value - sigEma,
  }];

  for (let i = signal; i < macdLine.length; i++) {
    sigEma = macdLine[i].value * k + sigEma * (1 - k);
    result.push({
      time: macdLine[i].time,
      macd: macdLine[i].value,
      signal: sigEma,
      histogram: macdLine[i].value - sigEma,
    });
  }
  return result;
}

// ===== ATR (Average True Range) =====
export function calcATR(data: KlineData[], period: number = 14): IndicatorPoint[] {
  if (data.length < 2) return [];
  const trs: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close),
    );
    trs.push(tr);
  }

  if (trs.length < period) return [];
  const result: IndicatorPoint[] = [];
  let atr = 0;
  for (let i = 0; i < period; i++) atr += trs[i];
  atr /= period;
  result.push({ time: data[period].time, value: atr });

  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    result.push({ time: data[i + 1].time, value: atr });
  }
  return result;
}

// ===== CHOP (Choppiness Index) =====
export function calcCHOP(data: KlineData[], period: number = 14): IndicatorPoint[] {
  if (data.length < period + 1) return [];
  const result: IndicatorPoint[] = [];

  for (let i = period; i < data.length; i++) {
    let atrSum = 0;
    let highMax = -Infinity, lowMin = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      const tr = Math.max(
        data[j].high - data[j].low,
        Math.abs(data[j].high - data[j - 1].close),
        Math.abs(data[j].low - data[j - 1].close),
      );
      atrSum += tr;
      highMax = Math.max(highMax, data[j].high);
      lowMin = Math.min(lowMin, data[j].low);
    }
    const range = highMax - lowMin;
    const chop = range > 0 ? 100 * Math.log10(atrSum / range) / Math.log10(period) : 50;
    result.push({ time: data[i].time, value: chop });
  }
  return result;
}

// ===== Indicator Registry =====
export type IndicatorType = 'MA' | 'EMA' | 'BOLL' | 'RSI' | 'MACD' | 'ATR' | 'CHOP';

export interface IndicatorConfig {
  type: IndicatorType;
  period: number;
  color?: string;
  enabled: boolean;
}

export const INDICATOR_PRESETS: { type: IndicatorType; label: string; defaultPeriod: number; isOverlay: boolean; color: string }[] = [
  { type: 'MA', label: 'MA 均线', defaultPeriod: 7, isOverlay: true, color: '#F0B90B' },
  { type: 'EMA', label: 'EMA 指数均线', defaultPeriod: 21, isOverlay: true, color: '#3B82F6' },
  { type: 'BOLL', label: 'BOLL 布林带', defaultPeriod: 20, isOverlay: true, color: '#8B5CF6' },
  { type: 'RSI', label: 'RSI 相对强弱', defaultPeriod: 14, isOverlay: false, color: '#F59E0B' },
  { type: 'MACD', label: 'MACD 指数平滑', defaultPeriod: 12, isOverlay: false, color: '#10B981' },
  { type: 'ATR', label: 'ATR 真实波幅', defaultPeriod: 14, isOverlay: false, color: '#EF4444' },
  { type: 'CHOP', label: 'CHOP 震荡指数', defaultPeriod: 14, isOverlay: false, color: '#06B6D4' },
];
