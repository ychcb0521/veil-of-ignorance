/**
 * Technical Indicator Engine
 * - Uses `technicalindicators` library for core math
 * - Provides a unified registry of 80+ indicators (UI menu data)
 * - MVP: 5 indicators fully wired (MA, BOLL, MACD, RSI, ATR)
 */

import { SMA, EMA, BollingerBands, RSI, MACD, ATR } from 'technicalindicators';
import type { KlineData } from './useBinanceData';

// ===== Output types =====
export interface IndicatorPoint {
  time: number;
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

// ===== Calculation functions using technicalindicators =====

export function calcSMA(data: KlineData[], period: number): IndicatorPoint[] {
  const closes = data.map(d => d.close);
  const result = SMA.calculate({ period, values: closes });
  // SMA returns (data.length - period + 1) values, starting at index period-1
  const offset = data.length - result.length;
  return result.map((v, i) => ({ time: data[i + offset].time, value: v }));
}

export function calcEMA(data: KlineData[], period: number): IndicatorPoint[] {
  const closes = data.map(d => d.close);
  const result = EMA.calculate({ period, values: closes });
  const offset = data.length - result.length;
  return result.map((v, i) => ({ time: data[i + offset].time, value: v }));
}

export function calcBOLL(data: KlineData[], period: number = 20, stdDev: number = 2): BollBand[] {
  const closes = data.map(d => d.close);
  const result = BollingerBands.calculate({ period, values: closes, stdDev });
  const offset = data.length - result.length;
  return result.map((b, i) => ({
    time: data[i + offset].time,
    upper: b.upper,
    middle: b.middle,
    lower: b.lower,
  }));
}

export function calcRSI(data: KlineData[], period: number = 14): IndicatorPoint[] {
  const closes = data.map(d => d.close);
  const result = RSI.calculate({ period, values: closes });
  const offset = data.length - result.length;
  return result.map((v, i) => ({ time: data[i + offset].time, value: v }));
}

export function calcMACD(data: KlineData[], _period: number = 12): MACDResult[] {
  const closes = data.map(d => d.close);
  const result = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const offset = data.length - result.length;
  return result
    .filter(r => r.MACD !== undefined && r.signal !== undefined && r.histogram !== undefined)
    .map((r, i) => ({
      time: data[i + offset].time,
      macd: r.MACD!,
      signal: r.signal!,
      histogram: r.histogram!,
    }));
}

export function calcATR(data: KlineData[], period: number = 14): IndicatorPoint[] {
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const closes = data.map(d => d.close);
  const result = ATR.calculate({ period, high: highs, low: lows, close: closes });
  const offset = data.length - result.length;
  return result.map((v, i) => ({ time: data[i + offset].time, value: v }));
}

// ===== Indicator Config (runtime state) =====
export type ImplementedIndicator = 'MA' | 'EMA' | 'BOLL' | 'RSI' | 'MACD' | 'ATR';

export interface IndicatorConfig {
  type: string;
  period: number;
  color?: string;
  enabled: boolean;
}

// ===== Presets for the 5+2 implemented indicators =====
export const INDICATOR_PRESETS: {
  type: string; label: string; defaultPeriod: number; isOverlay: boolean; color: string;
}[] = [
  { type: 'MA',   label: '移动平均线 (MA)',      defaultPeriod: 7,  isOverlay: true,  color: '#F0B90B' },
  { type: 'EMA',  label: '指数移动平均线 (EMA)',  defaultPeriod: 21, isOverlay: true,  color: '#3B82F6' },
  { type: 'BOLL', label: '布林带 (Bollinger)',     defaultPeriod: 20, isOverlay: true,  color: '#8B5CF6' },
  { type: 'RSI',  label: '相对强弱指标 (RSI)',     defaultPeriod: 14, isOverlay: false, color: '#F59E0B' },
  { type: 'MACD', label: 'MACD',                   defaultPeriod: 12, isOverlay: false, color: '#10B981' },
  { type: 'ATR',  label: '真实波动幅度 (ATR)',     defaultPeriod: 14, isOverlay: false, color: '#EF4444' },
];

// Set of implemented indicator types for quick lookup
export const IMPLEMENTED_TYPES = new Set<string>(['MA', 'EMA', 'BOLL', 'RSI', 'MACD', 'ATR']);

// ===== Full 80+ indicator catalogue for UI menu =====
export interface IndicatorCatalogItem {
  id: string;       // unique key
  nameZh: string;   // Chinese name
  nameEn: string;   // English name / abbreviation
  isOverlay: boolean;
  defaultPeriod: number;
  color: string;
}

export const INDICATOR_CATALOG: IndicatorCatalogItem[] = [
  // --- Implemented (MVP) ---
  { id: 'MA',   nameZh: '移动平均线',           nameEn: 'Moving Average (MA)',        isOverlay: true,  defaultPeriod: 7,  color: '#F0B90B' },
  { id: 'EMA',  nameZh: '指数移动平均线',       nameEn: 'EMA',                        isOverlay: true,  defaultPeriod: 21, color: '#3B82F6' },
  { id: 'BOLL', nameZh: '布林带',               nameEn: 'Bollinger Bands',            isOverlay: true,  defaultPeriod: 20, color: '#8B5CF6' },
  { id: 'RSI',  nameZh: '相对强弱指标',         nameEn: 'RSI',                        isOverlay: false, defaultPeriod: 14, color: '#F59E0B' },
  { id: 'MACD', nameZh: 'MACD 指数平滑',        nameEn: 'MACD',                       isOverlay: false, defaultPeriod: 12, color: '#10B981' },
  { id: 'ATR',  nameZh: '真实波动幅度均值',     nameEn: 'ATR',                        isOverlay: false, defaultPeriod: 14, color: '#EF4444' },
  // --- Full catalogue (not yet implemented) ---
  { id: 'CHOP',      nameZh: '波动指数',               nameEn: 'Choppiness Index',           isOverlay: false, defaultPeriod: 14, color: '#06B6D4' },
  { id: 'CHOPZONE',  nameZh: '波动区间',               nameEn: 'Chop Zone',                  isOverlay: false, defaultPeriod: 14, color: '#14B8A6' },
  { id: '52WHL',     nameZh: '52周高低',               nameEn: '52 Week High/Low',           isOverlay: true,  defaultPeriod: 252, color: '#A78BFA' },
  { id: 'AO',        nameZh: '动量震荡指标',           nameEn: 'Awesome Oscillator (AO)',    isOverlay: false, defaultPeriod: 5,  color: '#34D399' },
  { id: 'ACCEL',     nameZh: '加速振荡器',             nameEn: 'Accelerator Oscillator',     isOverlay: false, defaultPeriod: 5,  color: '#6EE7B7' },
  { id: 'EFI',       nameZh: '艾尔德力量指标',         nameEn: "Elder's Force Index",        isOverlay: false, defaultPeriod: 13, color: '#F472B6' },
  { id: 'EMACROSS',  nameZh: 'EMA交叉',               nameEn: 'EMA Cross',                  isOverlay: true,  defaultPeriod: 12, color: '#60A5FA' },
  { id: 'KST',       nameZh: '确然指标',               nameEn: 'Know Sure Thing (KST)',      isOverlay: false, defaultPeriod: 10, color: '#C084FC' },
  { id: 'MACROSS',   nameZh: 'MA与EMA交叉',           nameEn: 'MA & EMA Cross',             isOverlay: true,  defaultPeriod: 9,  color: '#38BDF8' },
  { id: 'RCI',       nameZh: '等级相关指数',           nameEn: 'Rank Correlation Index',     isOverlay: false, defaultPeriod: 9,  color: '#FB923C' },
  { id: 'RATIO',     nameZh: '比率',                   nameEn: 'Ratio',                      isOverlay: false, defaultPeriod: 14, color: '#FBBF24' },
  { id: 'SMI',       nameZh: 'SMI 遍历性指标',        nameEn: 'SMI Ergodic',                isOverlay: false, defaultPeriod: 5,  color: '#A3E635' },
  { id: 'SPREAD',    nameZh: '价差',                   nameEn: 'Spread',                     isOverlay: false, defaultPeriod: 1,  color: '#E879F9' },
  { id: 'VPFR',      nameZh: '成交量分布固定范围',     nameEn: 'Volume Profile Fixed Range', isOverlay: true,  defaultPeriod: 1,  color: '#818CF8' },
  { id: 'VPVR',      nameZh: '成交量分布可见范围',     nameEn: 'Volume Profile Visible Range', isOverlay: true, defaultPeriod: 1, color: '#6366F1' },
  { id: 'ICHIMOKU',  nameZh: '一目均衡表',             nameEn: 'Ichimoku Cloud',             isOverlay: true,  defaultPeriod: 9,  color: '#F97316' },
  { id: 'TEMA',      nameZh: '三重指数平滑平均线',     nameEn: 'TEMA',                       isOverlay: true,  defaultPeriod: 20, color: '#22D3EE' },
  { id: 'TRIX',      nameZh: '三重指数平滑移动平均线', nameEn: 'TRIX',                       isOverlay: false, defaultPeriod: 15, color: '#2DD4BF' },
  { id: 'TMA',       nameZh: '三重移动平均',           nameEn: 'Triple MA',                  isOverlay: true,  defaultPeriod: 20, color: '#4ADE80' },
  { id: 'MEDIAN',    nameZh: '中位数价格',             nameEn: 'Median Price',               isOverlay: true,  defaultPeriod: 1,  color: '#FDE047' },
  { id: 'ZIGZAG',    nameZh: '之字转向',               nameEn: 'Zig Zag',                    isOverlay: true,  defaultPeriod: 5,  color: '#F87171' },
  { id: 'PPO',       nameZh: '价格摆动指标',           nameEn: 'Price Oscillator',           isOverlay: false, defaultPeriod: 12, color: '#FB7185' },
  { id: 'PCHANNEL',  nameZh: '价格通道',               nameEn: 'Price Channel',              isOverlay: true,  defaultPeriod: 20, color: '#94A3B8' },
  { id: 'PVT',       nameZh: '价量趋势指标',           nameEn: 'Price Volume Trend',         isOverlay: false, defaultPeriod: 1,  color: '#CBD5E1' },
  { id: 'COPPOCK',   nameZh: '估波曲线',               nameEn: 'Coppock Curve',              isOverlay: false, defaultPeriod: 10, color: '#D946EF' },
  { id: 'KVO',       nameZh: '克林格成交量摆动指标',   nameEn: 'Klinger Volume Oscillator',  isOverlay: false, defaultPeriod: 34, color: '#A855F7' },
  { id: 'TYPICAL',   nameZh: '典型价格',               nameEn: 'Typical Price',              isOverlay: true,  defaultPeriod: 1,  color: '#E2E8F0' },
  { id: 'NVI',       nameZh: '净成交量',               nameEn: 'Net Volume',                 isOverlay: false, defaultPeriod: 1,  color: '#7DD3FC' },
  { id: 'WMA',       nameZh: '加权移动平均线',         nameEn: 'WMA',                        isOverlay: true,  defaultPeriod: 20, color: '#FDBA74' },
  { id: 'DMI',       nameZh: '动向指标',               nameEn: 'DMI',                        isOverlay: false, defaultPeriod: 14, color: '#F0ABFC' },
  { id: 'MOM',       nameZh: '动量指标',               nameEn: 'Momentum',                   isOverlay: false, defaultPeriod: 10, color: '#67E8F9' },
  { id: 'ENVELOPE',  nameZh: '包络线指标',             nameEn: 'Envelope',                   isOverlay: true,  defaultPeriod: 20, color: '#BEF264' },
  { id: 'HV',        nameZh: '历史波动率',             nameEn: 'Historical Volatility',      isOverlay: false, defaultPeriod: 20, color: '#FCA5A5' },
  { id: 'DEMA',      nameZh: '双指数移动平均线',       nameEn: 'DEMA',                       isOverlay: true,  defaultPeriod: 20, color: '#93C5FD' },
  { id: 'DMA',       nameZh: '双移动平均线',           nameEn: 'Double MA',                  isOverlay: true,  defaultPeriod: 10, color: '#86EFAC' },
  { id: 'ROC',       nameZh: '变化速率',               nameEn: 'ROC',                        isOverlay: false, defaultPeriod: 12, color: '#FCD34D' },
  { id: 'DC',        nameZh: '唐奇安通道',             nameEn: 'Donchian Channels',          isOverlay: true,  defaultPeriod: 20, color: '#5EEAD4' },
  { id: 'BOP',       nameZh: '均势指标',               nameEn: 'Balance of Power',           isOverlay: false, defaultPeriod: 14, color: '#C4B5FD' },
  { id: 'MAJORITY',  nameZh: '多数决原则',             nameEn: 'Majority Rule',              isOverlay: false, defaultPeriod: 10, color: '#A5B4FC' },
  { id: 'MMA',       nameZh: '多重移动平均线',         nameEn: 'Multiple MA',                isOverlay: true,  defaultPeriod: 20, color: '#FDE68A' },
  { id: 'FRACTAL',   nameZh: '威廉姆斯分形指标',       nameEn: 'Williams Fractal',           isOverlay: true,  defaultPeriod: 5,  color: '#F9A8D4' },
  { id: 'WILLR',     nameZh: '威廉姆斯指标',           nameEn: 'Williams %R',                isOverlay: false, defaultPeriod: 14, color: '#FDA4AF' },
  { id: 'ALLIGATOR', nameZh: '威廉姆斯鳄鱼线',         nameEn: 'Williams Alligator',         isOverlay: true,  defaultPeriod: 13, color: '#4ADE80' },
  { id: 'BOLLPB',    nameZh: '布林带 %B',             nameEn: 'Bollinger %B',               isOverlay: false, defaultPeriod: 20, color: '#D8B4FE' },
  { id: 'BOLLW',     nameZh: '布林带宽度',             nameEn: 'Bollinger Width',            isOverlay: false, defaultPeriod: 20, color: '#C084FC' },
  { id: 'AVGPRICE',  nameZh: '平均价',                 nameEn: 'Average Price',              isOverlay: true,  defaultPeriod: 1,  color: '#E5E7EB' },
  { id: 'ADX',       nameZh: '平均趋向指数',           nameEn: 'ADX',                        isOverlay: false, defaultPeriod: 14, color: '#FB923C' },
  { id: 'SMMA',      nameZh: '平滑移动平均线',         nameEn: 'SMMA',                       isOverlay: true,  defaultPeriod: 20, color: '#A3E635' },
  { id: 'CRSI',      nameZh: '康纳相对强弱指数',       nameEn: 'Connors RSI',                isOverlay: false, defaultPeriod: 3,  color: '#F472B6' },
  { id: 'VOL',       nameZh: '成交量',                 nameEn: 'Volume',                     isOverlay: false, defaultPeriod: 1,  color: '#60A5FA' },
  { id: 'VWAP',      nameZh: '成交量加权平均价',       nameEn: 'VWAP',                       isOverlay: true,  defaultPeriod: 1,  color: '#2DD4BF' },
  { id: 'VWMA',      nameZh: '成交量加权移动平均值',   nameEn: 'VWMA',                       isOverlay: true,  defaultPeriod: 20, color: '#38BDF8' },
  { id: 'VOLOSC',    nameZh: '成交量震荡指标',         nameEn: 'Volume Oscillator',          isOverlay: false, defaultPeriod: 14, color: '#818CF8' },
  { id: 'SAR',       nameZh: '抛物线转向指标',         nameEn: 'Parabolic SAR',              isOverlay: true,  defaultPeriod: 2,  color: '#FACC15' },
  { id: 'ASI',       nameZh: '振动升降指标',           nameEn: 'ASI',                        isOverlay: false, defaultPeriod: 1,  color: '#4ADE80' },
  { id: 'VI',        nameZh: '旋涡指标',               nameEn: 'Vortex Indicator',           isOverlay: false, defaultPeriod: 14, color: '#22D3EE' },
  { id: 'LSMA',      nameZh: '最小二乘移动平均线',     nameEn: 'LSMA',                       isOverlay: true,  defaultPeriod: 25, color: '#34D399' },
  { id: 'PIVOT',     nameZh: '枢轴点 - 标准',         nameEn: 'Pivot Points',               isOverlay: true,  defaultPeriod: 1,  color: '#F59E0B' },
  { id: 'STDDEV',    nameZh: '标准偏差',               nameEn: 'Standard Deviation',         isOverlay: false, defaultPeriod: 20, color: '#E879F9' },
  { id: 'STDERR',    nameZh: '标准误差',               nameEn: 'Standard Error',             isOverlay: false, defaultPeriod: 20, color: '#C084FC' },
  { id: 'SEB',       nameZh: '标准误差带',             nameEn: 'Standard Error Bands',       isOverlay: true,  defaultPeriod: 20, color: '#A78BFA' },
  { id: 'MASSI',     nameZh: '梅斯波动率指数',         nameEn: 'Mass Index',                 isOverlay: false, defaultPeriod: 25, color: '#FB7185' },
  { id: 'VOLCC',     nameZh: '波动率 Close-to-Close',  nameEn: 'Volatility C-C',            isOverlay: false, defaultPeriod: 20, color: '#FCA5A5' },
  { id: 'VOLZT',     nameZh: '波动率零趋势',           nameEn: 'Volatility Zero Trend C-C',  isOverlay: false, defaultPeriod: 20, color: '#FECDD3' },
  { id: 'VOLOHLC',   nameZh: '波动率 O-H-L-C',        nameEn: 'Volatility O-H-L-C',        isOverlay: false, defaultPeriod: 20, color: '#FED7AA' },
  { id: 'HULLMA',    nameZh: '船体移动平均线',         nameEn: 'Hull MA (HMA)',              isOverlay: true,  defaultPeriod: 9,  color: '#6EE7B7' },
  { id: 'CHAIKINVOL', nameZh: '蔡金波动率',            nameEn: 'Chaikin Volatility',         isOverlay: false, defaultPeriod: 10, color: '#67E8F9' },
  { id: 'CMF',       nameZh: '蔡金资金流量',           nameEn: 'Chaikin Money Flow',         isOverlay: false, defaultPeriod: 20, color: '#7DD3FC' },
  { id: 'CMFOSC',    nameZh: '蔡金资金流量震荡指标',   nameEn: 'Chaikin MF Oscillator',      isOverlay: false, defaultPeriod: 3,  color: '#93C5FD' },
  { id: 'FISHER',    nameZh: '费舍尔转换',             nameEn: 'Fisher Transform',           isOverlay: false, defaultPeriod: 10, color: '#F0ABFC' },
  { id: 'MFI',       nameZh: '资金流量指数',           nameEn: 'MFI',                        isOverlay: false, defaultPeriod: 14, color: '#86EFAC' },
  { id: 'SUPERTREND', nameZh: '超级趋势',              nameEn: 'SuperTrend',                 isOverlay: true,  defaultPeriod: 10, color: '#4ADE80' },
  { id: 'TSI',       nameZh: '趋势强度指数',           nameEn: 'Trend Strength Index',       isOverlay: false, defaultPeriod: 25, color: '#BEF264' },
  { id: 'CKS',       nameZh: '钱德克罗止损',           nameEn: 'Chande Kroll Stop',          isOverlay: true,  defaultPeriod: 10, color: '#FDE047' },
  { id: 'CMO',       nameZh: '钱德动量摆动指标',       nameEn: 'CMO',                        isOverlay: false, defaultPeriod: 9,  color: '#FDBA74' },
  { id: 'ALMA',      nameZh: '阿诺勒古移动平均线',     nameEn: 'ALMA',                       isOverlay: true,  defaultPeriod: 9,  color: '#FCD34D' },
  { id: 'AROON',     nameZh: '阿隆指标',               nameEn: 'Aroon',                      isOverlay: false, defaultPeriod: 25, color: '#D946EF' },
  { id: 'STOCH',     nameZh: '随机指数',               nameEn: 'Stochastic',                 isOverlay: false, defaultPeriod: 14, color: '#A855F7' },
  { id: 'STOCHRSI',  nameZh: '随机相对强弱指数',       nameEn: 'Stochastic RSI',             isOverlay: false, defaultPeriod: 14, color: '#8B5CF6' },
  { id: 'DPO',       nameZh: '非趋势价格摆动指标',     nameEn: 'DPO',                        isOverlay: false, defaultPeriod: 20, color: '#CBD5E1' },
  { id: 'CCI',       nameZh: '顺势指标',               nameEn: 'CCI',                        isOverlay: false, defaultPeriod: 20, color: '#94A3B8' },
  { id: 'GMMA',      nameZh: '顾比复合移动平均线',     nameEn: 'GMMA',                       isOverlay: true,  defaultPeriod: 3,  color: '#14B8A6' },
  { id: 'MCGINLEY',  nameZh: '麦吉利动态指标',         nameEn: 'McGinley Dynamic',           isOverlay: true,  defaultPeriod: 14, color: '#F97316' },
  { id: 'HEIKINMA',  nameZh: '海明移动平均',           nameEn: 'Heikin MA',                  isOverlay: true,  defaultPeriod: 14, color: '#5EEAD4' },
  { id: 'ADRATIO',   nameZh: '涨跌比',                 nameEn: 'A/D Ratio',                  isOverlay: false, defaultPeriod: 1,  color: '#E5E7EB' },
  { id: 'CORREL',    nameZh: '相关系数',               nameEn: 'Correlation Coefficient',    isOverlay: false, defaultPeriod: 20, color: '#F9A8D4' },
  { id: 'CORRELLOG', nameZh: '相关 - 记录',            nameEn: 'Correlation - Log',          isOverlay: false, defaultPeriod: 20, color: '#FDA4AF' },
  { id: 'RVI',       nameZh: '相对离散指数',           nameEn: 'RVI',                        isOverlay: false, defaultPeriod: 10, color: '#FCA5A5' },
  { id: 'REI',       nameZh: '相对能量指数',           nameEn: 'Relative Energy Index',      isOverlay: false, defaultPeriod: 14, color: '#FECDD3' },
  { id: 'TSI2',      nameZh: '真实强弱指数',           nameEn: 'True Strength Index',        isOverlay: false, defaultPeriod: 25, color: '#FED7AA' },
  { id: 'MACHANNEL', nameZh: '移动平均线通道',         nameEn: 'MA Channel',                 isOverlay: true,  defaultPeriod: 20, color: '#D8B4FE' },
  { id: 'MARIBBON',  nameZh: '移动揉搓线',             nameEn: 'MA Ribbon',                  isOverlay: true,  defaultPeriod: 20, color: '#C4B5FD' },
  { id: 'EOM',       nameZh: '简易波动指标',           nameEn: 'Ease of Movement',           isOverlay: false, defaultPeriod: 14, color: '#A5B4FC' },
  { id: 'ADLINE',    nameZh: '累积/派发线',            nameEn: 'A/D Line',                   isOverlay: false, defaultPeriod: 1,  color: '#818CF8' },
  { id: 'LINREGSLOPE', nameZh: '线性回归斜率',         nameEn: 'Linear Regression Slope',    isOverlay: false, defaultPeriod: 14, color: '#6366F1' },
  { id: 'LINREG',    nameZh: '线性回归曲线',           nameEn: 'Linear Regression',          isOverlay: true,  defaultPeriod: 14, color: '#4F46E5' },
  { id: 'UO',        nameZh: '终极波动指标',           nameEn: 'Ultimate Oscillator',        isOverlay: false, defaultPeriod: 7,  color: '#7C3AED' },
  { id: 'KC',        nameZh: '肯特纳通道',             nameEn: 'Keltner Channels',           isOverlay: true,  defaultPeriod: 20, color: '#9333EA' },
  { id: 'OBV',       nameZh: '能量潮指标',             nameEn: 'OBV',                        isOverlay: false, defaultPeriod: 1,  color: '#A855F7' },
  { id: 'ADAPTIVE',  nameZh: '自适应移动均线',         nameEn: 'Adaptive MA',                isOverlay: true,  defaultPeriod: 10, color: '#C026D3' },
  { id: 'EOM2',      nameZh: '估波曲线',               nameEn: 'Coppock Curve',              isOverlay: false, defaultPeriod: 14, color: '#DB2777' },
  { id: 'DPO2',      nameZh: '非趋势价格摆动指标',     nameEn: 'DPO',                        isOverlay: false, defaultPeriod: 20, color: '#E11D48' },
];
