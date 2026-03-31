/**
 * Custom indicator registration for klinecharts using the `technicalindicators` NPM library.
 * Bridges indicators not built into klinecharts by registering them via registerIndicator().
 */

import { registerIndicator, type KLineData } from 'klinecharts';
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

let registered = false;

export function registerCustomIndicators() {
  if (registered) return;
  registered = true;

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
}

/**
 * Maps indicator IDs to klinecharts indicator names (built-in or custom registered).
 * Returns null if no mapping exists (will use fallback).
 */
export const CUSTOM_INDICATOR_MAP: Record<string, string> = {
  // Built-in klinecharts indicators
  MA: 'MA', EMA: 'EMA', SMA: 'SMA', WMA: 'WMA',
  BOLL: 'BOLL', SAR: 'SAR',
  RSI: 'RSI', MACD: 'MACD', KDJ: 'KDJ',
  ATR: 'ATR', CCI: 'CCI', OBV: 'OBV', ROC: 'ROC',
  STOCH: 'KDJ', VOL: 'VOL',
  DMI: 'DMI', TRIX: 'TRIX',
  WR: 'WR', MFI: 'MFI',
  // AO is built-in in some klinecharts versions
  EMV: 'EMV', PVT: 'PVT',

  // Custom registered
  ADX: 'ADX_CUSTOM',
  VWAP: 'VWAP_CUSTOM',
  ICH: 'ICH_CUSTOM',
  STOCH_RSI: 'STOCH_RSI_CUSTOM',
  KC: 'KC_CUSTOM',
  AD: 'AD_CUSTOM',
  ELDER: 'ELDER_CUSTOM',
  AO: 'AO_CUSTOM',
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
  CHOP: 'CHOP_CUSTOM',
  CMF: 'CMF_CUSTOM',
  BOP: 'BOP_CUSTOM',
  COPP: 'COPP_CUSTOM',
};
