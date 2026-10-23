import { CBA2_DEFINITION, CBA2_STEPS } from '@/lib/cba2';
/**
 * IndicatorMenu — Searchable indicator panel with 80+ indicators.
 * Works with klinecharts native indicator system + custom registered indicators.
 */

import { useState, useRef, useEffect, useLayoutEffect, useMemo, forwardRef } from 'react';
import { Search, X, Plus, Check } from 'lucide-react';
import type { IndicatorConfig } from './CandlestickChart';
import { AVG_DEFAULT_HOURS, CUSTOM_INDICATOR_MAP } from '@/lib/customIndicators';
import { DSP_V_DEFINITION, DSP_V_STEPS, DSP_VZ_DEFINITION } from '@/lib/dynamicSchellingPoint';
import { BSS_DEFINITION, BSS_STEPS } from '@/lib/bss';
import { CBA_DEFINITION, CBA_STEPS } from '@/lib/cba';
import { CBI_DEFINITION, CBI_STEPS } from '@/lib/cbi';
import { CBI2_DEFINITION, CBI2_STEPS } from '@/lib/cbi2';
import { RESEARCH_INDICATORS, CUSTOM_RESEARCH_INDICATORS, researchDefaultPeriod } from '@/lib/researchIndicators';
import { BUILD_STAMP } from '@/lib/buildStamp';

export interface IndicatorCatalogItem {
  id: string;
  nameZh: string;
  nameEn: string;
  isOverlay: boolean;
  defaultPeriod: number;
  color: string;
  /** Category for grouping */
  category: 'trend' | 'momentum' | 'volatility' | 'volume' | 'oscillator' | 'other' | 'custom';
  /** 参数框的含义（悬停提示）与单位（框后小字）；不写就是普通的「周期」。 */
  periodHint?: string;
  periodUnit?: string;
  /** 名称下面的一句说明；detail 是悬停时的完整说明（计算步骤）。 */
  description?: string;
  detail?: string;
  /** 【用户要求】副图均线 avg(·, N)：有这一项就多一个均线时长框（小时），默认值在这里。 */
  avgDefault?: number;
  avgHint?: string;
  /** 【用户要求】有「Z」开关（Z 分数版）：开关的说明。 */
  zHint?: string;
}

// Determine support status dynamically: if we have a mapping, it's supported
function isSupported(id: string): boolean {
  return id in CUSTOM_INDICATOR_MAP;
}

/** 二选一的菜单项：动态谢林点「主图线 + 副图」与「只要副图」。 */
const EXCLUSIVE_PAIRS: Record<string, string> = { DSP: 'DSP_VA', DSP_VA: 'DSP' };

export const INDICATOR_CATALOG: IndicatorCatalogItem[] = [
  // ═══════════════════════════════════════════
  // OVERLAYS (主图叠加)
  // ═══════════════════════════════════════════
  // --- Moving Averages ---
  { id: 'MA',     nameZh: '移动平均线',             nameEn: 'Moving Average (MA)',        isOverlay: true,  defaultPeriod: 7,  color: '#F0B90B', category: 'trend' },
  { id: 'EMA',    nameZh: '指数移动平均线',          nameEn: 'EMA',                        isOverlay: true,  defaultPeriod: 21, color: '#3B82F6', category: 'trend' },
  { id: 'SMA',    nameZh: '简单移动平均线',          nameEn: 'SMA',                        isOverlay: true,  defaultPeriod: 20, color: '#10B981', category: 'trend' },
  { id: 'WMA',    nameZh: '加权移动平均线',          nameEn: 'WMA',                        isOverlay: true,  defaultPeriod: 20, color: '#FDBA74', category: 'trend' },
  { id: 'DEMA',   nameZh: '双指数移动平均线',        nameEn: 'Double EMA (DEMA)',           isOverlay: true,  defaultPeriod: 21, color: '#22D3EE', category: 'trend' },
  { id: 'TEMA',   nameZh: '三重指数平滑平均线',      nameEn: 'Triple EMA (TEMA)',           isOverlay: true,  defaultPeriod: 21, color: '#A78BFA', category: 'trend' },
  { id: 'SMMA',   nameZh: '平滑移动平均线',          nameEn: 'Smoothed MA (SMMA)',          isOverlay: true,  defaultPeriod: 20, color: '#FCA5A5', category: 'trend' },
  { id: 'HMA',    nameZh: '船体移动平均线',          nameEn: 'Hull MA (HMA)',               isOverlay: true,  defaultPeriod: 20, color: '#34D399', category: 'trend' },
  { id: 'ALMA',   nameZh: '阿诺勒古移动平均线',     nameEn: 'Arnaud Legoux MA (ALMA)',     isOverlay: true,  defaultPeriod: 9,  color: '#F472B6', category: 'trend' },
  { id: 'LSMA',   nameZh: '最小二乘移动平均线',      nameEn: 'Least Squares MA (LSMA)',     isOverlay: true,  defaultPeriod: 25, color: '#FB923C', category: 'trend' },
  { id: 'KAMA',   nameZh: '自适应移动均线',          nameEn: 'Kaufman AMA (KAMA)',          isOverlay: true,  defaultPeriod: 10, color: '#818CF8', category: 'trend' },
  { id: 'HAMA',   nameZh: '海明移动平均',            nameEn: 'Hamming MA',                  isOverlay: true,  defaultPeriod: 20, color: '#6EE7B7', category: 'trend' },
  { id: 'MCGD',   nameZh: '麦吉利动态指标',          nameEn: 'McGinley Dynamic',            isOverlay: true,  defaultPeriod: 14, color: '#FBBF24', category: 'trend' },
  { id: 'DMA',    nameZh: '双移动平均线',            nameEn: 'Double MA',                   isOverlay: true,  defaultPeriod: 10, color: '#C084FC', category: 'trend' },
  { id: 'TMA',    nameZh: '三重移动平均',            nameEn: 'Triple MA',                   isOverlay: true,  defaultPeriod: 20, color: '#5EEAD4', category: 'trend' },
  { id: 'MMA',    nameZh: '多重移动平均线',          nameEn: 'Multiple MA',                 isOverlay: true,  defaultPeriod: 20, color: '#D946EF', category: 'trend' },
  { id: 'GMMA',   nameZh: '顾比复合移动平均线',      nameEn: 'Guppy MMA (GMMA)',            isOverlay: true,  defaultPeriod: 3,  color: '#2DD4BF', category: 'trend' },
  { id: 'MACHAN', nameZh: '移动平均线通道',          nameEn: 'MA Channel',                  isOverlay: true,  defaultPeriod: 20, color: '#93C5FD', category: 'trend' },
  { id: 'EMA_CROSS', nameZh: 'EMA交叉',             nameEn: 'EMA Cross',                   isOverlay: true,  defaultPeriod: 12, color: '#4ADE80', category: 'trend' },
  { id: 'MA_EMA_CROSS', nameZh: 'MA与EMA交叉',      nameEn: 'MA/EMA Cross',                isOverlay: true,  defaultPeriod: 20, color: '#FDE047', category: 'trend' },

  // --- Bands & Channels ---
  { id: 'BOLL',   nameZh: '布林带',                  nameEn: 'Bollinger Bands',             isOverlay: true,  defaultPeriod: 20, color: '#8B5CF6', category: 'volatility' },
  { id: 'BOLL_B', nameZh: '布林带 %B',              nameEn: 'Bollinger %B',                isOverlay: false, defaultPeriod: 20, color: '#A78BFA', category: 'volatility' },
  { id: 'BBW',    nameZh: '布林带宽度',              nameEn: 'Bollinger Bandwidth',         isOverlay: false, defaultPeriod: 20, color: '#C4B5FD', category: 'volatility' },
  { id: 'KC',     nameZh: '肯特纳通道',              nameEn: 'Keltner Channel',             isOverlay: true,  defaultPeriod: 20, color: '#F97316', category: 'volatility' },
  { id: 'DC',     nameZh: '唐奇安通道',              nameEn: 'Donchian Channel',            isOverlay: true,  defaultPeriod: 20, color: '#0EA5E9', category: 'volatility' },
  { id: 'PC',     nameZh: '价格通道',                nameEn: 'Price Channel',               isOverlay: true,  defaultPeriod: 20, color: '#14B8A6', category: 'volatility' },
  { id: 'ENV',    nameZh: '包络线指标',              nameEn: 'Envelope',                    isOverlay: true,  defaultPeriod: 20, color: '#E879F9', category: 'volatility' },
  { id: 'SEB',    nameZh: '标准误差带',              nameEn: 'Standard Error Bands',        isOverlay: true,  defaultPeriod: 20, color: '#7DD3FC', category: 'volatility' },

  // --- Trend Overlays ---
  { id: 'SAR',    nameZh: '抛物线转向指标',          nameEn: 'Parabolic SAR',               isOverlay: true,  defaultPeriod: 2,  color: '#FACC15', category: 'trend' },
  { id: 'ICH',    nameZh: '一目均衡表',              nameEn: 'Ichimoku Cloud',              isOverlay: true,  defaultPeriod: 9,  color: '#0EA5E9', category: 'trend' },
  { id: 'ST',     nameZh: '超级趋势',                nameEn: 'SuperTrend',                  isOverlay: true,  defaultPeriod: 10, color: '#22C55E', category: 'trend' },
  { id: 'ZIGZAG', nameZh: '之字转向',                nameEn: 'Zig Zag',                     isOverlay: true,  defaultPeriod: 5,  color: '#F43F5E', category: 'trend' },
  { id: 'CRSI_STOP', nameZh: '钱德克罗止损',         nameEn: 'Chande Kroll Stop',           isOverlay: true,  defaultPeriod: 10, color: '#FB7185', category: 'trend' },
  { id: 'PIVOT',  nameZh: '枢轴点 - 标准',          nameEn: 'Pivot Points Standard',       isOverlay: true,  defaultPeriod: 1,  color: '#94A3B8', category: 'trend' },
  { id: 'W52HL',  nameZh: '52周最高最低',            nameEn: '52 Week High/Low',            isOverlay: true,  defaultPeriod: 252,color: '#D4D4D8', category: 'trend' },
  { id: 'FRAC',   nameZh: '威廉姆斯分形指标',        nameEn: 'Williams Fractal',            isOverlay: true,  defaultPeriod: 2,  color: '#E11D48', category: 'trend' },
  { id: 'ALLIGATOR', nameZh: '威廉姆斯鳄鱼线',      nameEn: 'Williams Alligator',          isOverlay: true,  defaultPeriod: 13, color: '#16A34A', category: 'trend' },
  { id: 'LRC',    nameZh: '线性回归曲线',            nameEn: 'Linear Regression Curve',     isOverlay: true,  defaultPeriod: 20, color: '#2563EB', category: 'trend' },

  // --- Price ---
  { id: 'MEDP',   nameZh: '中位数价格',              nameEn: 'Median Price',                isOverlay: true,  defaultPeriod: 1,  color: '#A1A1AA', category: 'other' },
  { id: 'TYPP',   nameZh: '典型价格',                nameEn: 'Typical Price',               isOverlay: true,  defaultPeriod: 1,  color: '#9CA3AF', category: 'other' },
  { id: 'AVGP',   nameZh: '平均价',                  nameEn: 'Average Price',               isOverlay: true,  defaultPeriod: 1,  color: '#D4D4D8', category: 'other' },
  { id: 'VWAP',   nameZh: '成交量加权平均价',        nameEn: 'VWAP',                        isOverlay: true,  defaultPeriod: 1,  color: '#7C3AED', category: 'volume' },

  // ═══════════════════════════════════════════
  // OSCILLATORS / SUB-PANE (副图指标)
  // ═══════════════════════════════════════════
  // --- Core Oscillators ---
  { id: 'VOL',    nameZh: '成交量',                  nameEn: 'Volume',                      isOverlay: false, defaultPeriod: 1,  color: '#6366F1', category: 'volume' },
  { id: 'MACD',   nameZh: 'MACD',                   nameEn: 'MACD',                        isOverlay: false, defaultPeriod: 12, color: '#10B981', category: 'momentum' },
  { id: 'RSI',    nameZh: '相对强弱指标',            nameEn: 'RSI',                         isOverlay: false, defaultPeriod: 14, color: '#F59E0B', category: 'momentum' },
  { id: 'KDJ',    nameZh: '随机指数',                nameEn: 'KDJ / Stochastic',            isOverlay: false, defaultPeriod: 14, color: '#A855F7', category: 'momentum' },
  { id: 'ATR',    nameZh: '真实波动幅度均值',        nameEn: 'Average True Range (ATR)',     isOverlay: false, defaultPeriod: 14, color: '#EF4444', category: 'volatility' },
  { id: 'CCI',    nameZh: '顺势指标',                nameEn: 'CCI',                         isOverlay: false, defaultPeriod: 20, color: '#94A3B8', category: 'momentum' },
  { id: 'OBV',    nameZh: '能量潮指标',              nameEn: 'OBV',                         isOverlay: false, defaultPeriod: 1,  color: '#A855F7', category: 'volume' },
  { id: 'ROC',    nameZh: '变化速率',                nameEn: 'Rate of Change (ROC)',         isOverlay: false, defaultPeriod: 12, color: '#FCD34D', category: 'momentum' },
  { id: 'DMI',    nameZh: '动向指标',                nameEn: 'DMI',                         isOverlay: false, defaultPeriod: 14, color: '#FB923C', category: 'trend' },
  { id: 'WR',     nameZh: '威廉姆斯指标',            nameEn: 'Williams %R',                 isOverlay: false, defaultPeriod: 14, color: '#FDA4AF', category: 'momentum' },
  { id: 'TRIX',   nameZh: 'TRIX',                   nameEn: 'TRIX',                        isOverlay: false, defaultPeriod: 15, color: '#2DD4BF', category: 'momentum' },

  // --- Momentum ---
  { id: 'MOM',    nameZh: '动量指标',                nameEn: 'Momentum',                    isOverlay: false, defaultPeriod: 10, color: '#6366F1', category: 'momentum' },
  { id: 'AO',     nameZh: '动量震荡指标',            nameEn: 'Awesome Oscillator',          isOverlay: false, defaultPeriod: 5,  color: '#22C55E', category: 'momentum' },
  { id: 'AC',     nameZh: 'Accelerator Oscillator', nameEn: 'Accelerator Oscillator',      isOverlay: false, defaultPeriod: 5,  color: '#F97316', category: 'momentum' },
  { id: 'PO',     nameZh: '价格摆动指标',            nameEn: 'Price Oscillator',            isOverlay: false, defaultPeriod: 12, color: '#14B8A6', category: 'momentum' },
  { id: 'KST',    nameZh: 'Know Sure Thing',        nameEn: 'KST',                        isOverlay: false, defaultPeriod: 10, color: '#E879F9', category: 'momentum' },
  { id: 'SMI',    nameZh: 'SMI遍历性指标',           nameEn: 'SMI Ergodic',                 isOverlay: false, defaultPeriod: 5,  color: '#38BDF8', category: 'momentum' },
  { id: 'CMO',    nameZh: '钱德动量摆动指标',        nameEn: 'Chande Momentum Oscillator',  isOverlay: false, defaultPeriod: 14, color: '#F472B6', category: 'momentum' },
  { id: 'TSI',    nameZh: '真实强弱指数',            nameEn: 'True Strength Index',         isOverlay: false, defaultPeriod: 25, color: '#4ADE80', category: 'momentum' },
  { id: 'RCI',    nameZh: 'Rank Correlation Index', nameEn: 'RCI',                         isOverlay: false, defaultPeriod: 9,  color: '#FBBF24', category: 'momentum' },
  { id: 'CRSI',   nameZh: '康纳相对强弱指数',        nameEn: 'Connors RSI (CRSI)',          isOverlay: false, defaultPeriod: 3,  color: '#F87171', category: 'momentum' },
  { id: 'STOCH_RSI', nameZh: '随机相对强弱指数',     nameEn: 'Stoch RSI',                   isOverlay: false, defaultPeriod: 14, color: '#C084FC', category: 'momentum' },
  { id: 'UO',     nameZh: '终极波动指标',            nameEn: 'Ultimate Oscillator',         isOverlay: false, defaultPeriod: 7,  color: '#FB923C', category: 'momentum' },
  { id: 'DPO',    nameZh: '非趋势价格摆动指标',      nameEn: 'Detrended Price Oscillator',  isOverlay: false, defaultPeriod: 20, color: '#A3E635', category: 'momentum' },
  { id: 'FISHER', nameZh: '费舍尔转换',              nameEn: 'Fisher Transform',            isOverlay: false, defaultPeriod: 10, color: '#F43F5E', category: 'momentum' },
  { id: 'REI',    nameZh: '相对能量指数',            nameEn: 'Relative Energy Index',       isOverlay: false, defaultPeriod: 14, color: '#7DD3FC', category: 'momentum' },
  { id: 'RDI',    nameZh: '相对离散指数',            nameEn: 'Relative Disparity Index',    isOverlay: false, defaultPeriod: 14, color: '#86EFAC', category: 'momentum' },
  { id: 'MJ',     nameZh: '多数决原则',              nameEn: 'Majority Rule',               isOverlay: false, defaultPeriod: 10, color: '#FDBA74', category: 'momentum' },
  { id: 'MOVRUB', nameZh: '移动揉搓线',              nameEn: 'Moving Rubbing Lines',        isOverlay: false, defaultPeriod: 6,  color: '#CBD5E1', category: 'momentum' },

  // --- Trend Strength ---
  { id: 'ADX',    nameZh: '平均趋向指数',            nameEn: 'ADX',                         isOverlay: false, defaultPeriod: 14, color: '#7C3AED', category: 'trend' },
  { id: 'AROON',  nameZh: '阿隆指标',                nameEn: 'Aroon',                       isOverlay: false, defaultPeriod: 25, color: '#06B6D4', category: 'trend' },
  { id: 'VORTEX', nameZh: '旋涡指标',                nameEn: 'Vortex Indicator',            isOverlay: false, defaultPeriod: 14, color: '#D946EF', category: 'trend' },
  { id: 'TII',    nameZh: '趋势强度指数',            nameEn: 'Trend Intensity Index',       isOverlay: false, defaultPeriod: 30, color: '#34D399', category: 'trend' },
  { id: 'ELDER',  nameZh: "Elder's Force Index",    nameEn: "Elder's Force Index",         isOverlay: false, defaultPeriod: 13, color: '#EAB308', category: 'trend' },
  { id: 'BOP',    nameZh: '均势指标',                nameEn: 'Balance of Power',            isOverlay: false, defaultPeriod: 14, color: '#A3A3A3', category: 'trend' },
  { id: 'LRS',    nameZh: '线性回归斜率',            nameEn: 'Linear Regression Slope',     isOverlay: false, defaultPeriod: 20, color: '#60A5FA', category: 'trend' },
  { id: 'COPP',   nameZh: '估波曲线',                nameEn: 'Coppock Curve',               isOverlay: false, defaultPeriod: 14, color: '#C084FC', category: 'trend' },

  // --- Volatility ---
  { id: 'CHOP',   nameZh: '波动指数',                nameEn: 'Choppiness Index',            isOverlay: false, defaultPeriod: 14, color: '#F97316', category: 'volatility' },
  { id: 'CHOPZ',  nameZh: '波动区间',                nameEn: 'Chop Zone',                   isOverlay: false, defaultPeriod: 14, color: '#FB923C', category: 'volatility' },
  { id: 'HV',     nameZh: '历史波动率(方差)',        nameEn: 'Historical Volatility',       isOverlay: false, defaultPeriod: 20, color: '#EF4444', category: 'volatility' },
  { id: 'STDEV',  nameZh: '标准偏差',                nameEn: 'Standard Deviation',          isOverlay: false, defaultPeriod: 20, color: '#F87171', category: 'volatility' },
  { id: 'SE',     nameZh: '标准误差',                nameEn: 'Standard Error',              isOverlay: false, defaultPeriod: 20, color: '#FCA5A5', category: 'volatility' },
  { id: 'MASI',   nameZh: '梅斯波动率指数',          nameEn: 'Mass Index',                  isOverlay: false, defaultPeriod: 25, color: '#FECDD3', category: 'volatility' },
  { id: 'VOLZT',  nameZh: '波动率零趋势',            nameEn: 'Volatility Zero Trend',       isOverlay: false, defaultPeriod: 14, color: '#FEF08A', category: 'volatility' },
  { id: 'VOHLC',  nameZh: '波动率 O-H-L-C',         nameEn: 'Volatility OHLC',             isOverlay: false, defaultPeriod: 14, color: '#FDE68A', category: 'volatility' },
  { id: 'VCC',    nameZh: '波动率 Close-to-Close',  nameEn: 'Volatility Close-to-Close',   isOverlay: false, defaultPeriod: 14, color: '#FCD34D', category: 'volatility' },
  { id: 'CHAIKV', nameZh: '蔡金波动率',              nameEn: 'Chaikin Volatility',          isOverlay: false, defaultPeriod: 10, color: '#BEF264', category: 'volatility' },
  { id: 'ASI',    nameZh: '振动升降指标',            nameEn: 'Accumulation Swing Index',    isOverlay: false, defaultPeriod: 1,  color: '#84CC16', category: 'volatility' },
  { id: 'EMV',    nameZh: '简易波动指标',            nameEn: 'Ease of Movement',            isOverlay: false, defaultPeriod: 14, color: '#A3E635', category: 'volatility' },
  { id: 'CORR',   nameZh: '相关系数',                nameEn: 'Correlation Coefficient',     isOverlay: false, defaultPeriod: 20, color: '#67E8F9', category: 'volatility' },

  // --- Volume ---
  // 【用户要求】动态谢林点：主图 DSP 线 + 副图 买方推力漂移速度 DSP·a、主动买方优势 A；参数 = 5 分钟图上的时间半衰期（小时，其他周期等比例缩放），成交量一律用金额
  { id: 'DSP',    nameZh: '动态谢林点 DSP（含 a / A 副图）', nameEn: 'Dynamic Schelling Point',    isOverlay: true,  defaultPeriod: 6,  color: '#F0B90B', category: 'volume', periodHint: '半衰期 h（小时，按 5 分钟图计）：越早的 K 线权重越小。其他周期的记忆时间等比例放大 / 缩小——15 分钟图 ×3、1 小时图 ×12、1 分钟图 ÷5，每根 K 线的权重都一样', periodUnit: 'h', description: DSP_V_DEFINITION, detail: DSP_V_STEPS, avgDefault: AVG_DEFAULT_HOURS, avgHint: 'avg_a = avg(a, N)：a 副图正下方单独一个副图，过去 N 小时 a 的平均（N 按 5 分钟图计，其他周期等比例缩放）', zHint: DSP_VZ_DEFINITION },
  // 自制普通 DSP·a：原值、同名均值、同名分段加权均值。
  { id: 'DSP_VA', nameZh: '买方推力漂移速度 DSP·a',   nameEn: 'DSP · a · avg_a · avg_a_2',          isOverlay: false, defaultPeriod: 6,  color: '#F0B90B', category: 'custom', periodHint: '半衰期 h（小时，按 5 分钟图计）：越早的 K 线权重越小。其他周期的记忆时间等比例放大 / 缩小——15 分钟图 ×3、1 小时图 ×12、1 分钟图 ÷5，每根 K 线的权重都一样', periodUnit: 'h', description: DSP_V_DEFINITION, detail: DSP_V_STEPS },
  // 【用户要求】2026-10-18 BSS 买卖强度综合分（副图）：参数 = 5 分钟图上的近期窗口 n（小时），其他周期等比例缩放（与 DSP 同一约定）
  { id: 'BSS',    nameZh: '买卖强度综合分 BSS',        nameEn: 'Buy/Sell Strength (BSS)',   isOverlay: false, defaultPeriod: 1,  color: '#0ECB81', category: 'custom', periodHint: '近期窗口 n（小时，按 5 分钟图计）：M 涨跌幅、V 相对成交量、A 成交攻击性都取最近 n。标准化窗口取 Deep dig 的 avgh（默认 24 小时）。其他周期等比例放大 / 缩小，每根 K 线的窗口根数一样', periodUnit: 'h', description: BSS_DEFINITION, detail: BSS_STEPS },
  // 【用户要求】2026-10-18 CBA 买方定价优势指数（副图）：参数 = 5 分钟图上的时间权重半衰期 h（小时），其他周期等比例缩放（与 DSP 同一约定）
  { id: 'CBA',    nameZh: '买方定价优势指数 CBA',      nameEn: 'Buyer Pricing Advantage (CBA)', isOverlay: false, defaultPeriod: 6, color: '#0ECB81', category: 'custom', periodHint: '时间权重半衰期 h（小时，按 5 分钟图计）：48 小时窗口里越早的 K 线权重越小。η = 0.5、α = 1，常态成交额与波动率回看 24 小时（Deep dig 公式里可改）。其他周期等比例放大 / 缩小，每根 K 线的窗口根数一样', periodUnit: 'h', description: CBA_DEFINITION, detail: CBA_STEPS },
  // 【用户要求】2026-10-18 CBI 买方优势指数（副图）：参数 = 时间衰减半衰期 h（根），N = 48、m = 12、ATR 14 根，基线 24 小时按 5 分钟图计
  { id: 'CBA-2', nameZh: '成交支持下的价格重心迁移 CBA-2', nameEn: 'Volume-supported Price Center Migration', isOverlay: false, defaultPeriod: 6, color: '#0ECB81', category: 'volume', periodHint: '仅5分钟已收盘K线；时间权重半衰期h（小时）。48小时完整窗口，历史基线24小时；α=1、ε=0.000001、m=12、失效阈值3均为研究默认值，Deep dig公式可改。其他周期留空。红点1表示独立失效，不清零主值。', periodUnit: 'h', description: CBA2_DEFINITION, detail: CBA2_STEPS },
  { id: 'CBI',    nameZh: '买方优势指数 CBI',          nameEn: 'Buyer Advantage Index (CBI)', isOverlay: false, defaultPeriod: 12, color: '#0ECB81', category: 'volume', periodHint: '时间衰减半衰期 h（根）：w = 2^(−(t − i) ÷ h)，求和在最近 48 根内；均价斜率回看 12 根、ATR 14 根、κ = 1、k = 2（Deep dig 公式里可改）。基线（中位数、MAD）= 截至上一根过去 24 小时，按 5 分钟图计', periodUnit: '根', description: CBI_DEFINITION, detail: CBI_STEPS },
  { id: 'DSP_Z', nameZh: '买方推力漂移速度 DSP·a（Z 分数）', nameEn: 'DSP · az · Z score', isOverlay: false, defaultPeriod: 6, color: '#F0B90B', category: 'custom', periodHint: '半衰期 h（小时，按 5 分钟图计）；使用 Deep dig 的 DSP·a（Z 分数）定义。', periodUnit: 'h', description: DSP_VZ_DEFINITION },
  // 【用户要求】2026-10-18 CBI-2 买方优势指数第 2 版（副图）：参数 = 基线回看小时（按 5 分钟图计）；窗口按笔记默认值、按根计；动量剔除 BTC（另取 BTCUSDT）
  { id: 'CBI2',   nameZh: '买方优势指数 CBI-2',        nameEn: 'Buyer Advantage Index v2 (CBI-2)', isOverlay: false, defaultPeriod: 24, color: '#0ECB81', category: 'custom', periodHint: '基线回看小时（按 5 分钟图计）：V̄、MAD、λ₀、s_e、ATR̄ 都取截至上一根的过去这么多小时（原文 20 天 / 14 天拿不到）。其余窗口按笔记默认值、按根计；动量剔除 BTC，另取同时段的 BTCUSDT', periodUnit: 'h', description: CBI2_DEFINITION, detail: CBI2_STEPS },
  ...RESEARCH_INDICATORS.map(item => ({
    id: item.id, nameZh: item.name, nameEn: `${item.short} · avg_${item.core} · avg_${item.core}_2`,
    isOverlay: false, defaultPeriod: item.period, color: item.seller ? '#F6465D' : '#0ECB81', category: 'custom' as const,
    periodHint: `${item.parameter}（小时，按5分钟图计，其他周期等比例缩放）。原值、均值和分段加权均值均读 Deep dig 当前公式。`, periodUnit: 'h',
    description: '原值、均值、近端加权均值，各一个副图。',
  })),
  { id: 'MFI',    nameZh: '资金流量指数',            nameEn: 'Money Flow Index (MFI)',       isOverlay: false, defaultPeriod: 14, color: '#22D3EE', category: 'volume' },
  { id: 'NV',     nameZh: '净成交量',                nameEn: 'Net Volume',                  isOverlay: false, defaultPeriod: 1,  color: '#2DD4BF', category: 'volume' },
  { id: 'PVT',    nameZh: '价量趋势指标',            nameEn: 'Price Volume Trend',          isOverlay: false, defaultPeriod: 1,  color: '#5EEAD4', category: 'volume' },
  { id: 'VOLOSC', nameZh: '成交量震荡指标',          nameEn: 'Volume Oscillator',           isOverlay: false, defaultPeriod: 14, color: '#99F6E4', category: 'volume' },
  { id: 'AD',     nameZh: '累积/派发线',             nameEn: 'Accumulation/Distribution',   isOverlay: false, defaultPeriod: 1,  color: '#6EE7B7', category: 'volume' },
  { id: 'CMF',    nameZh: '蔡金资金流量',            nameEn: 'Chaikin Money Flow',          isOverlay: false, defaultPeriod: 20, color: '#4ADE80', category: 'volume' },
  { id: 'CO',     nameZh: '蔡金震荡指标',            nameEn: 'Chaikin Oscillator',          isOverlay: false, defaultPeriod: 3,  color: '#86EFAC', category: 'volume' },
  { id: 'KVO',    nameZh: '克林格成交量摆动指标',    nameEn: 'Klinger Volume Oscillator',   isOverlay: false, defaultPeriod: 34, color: '#BBF7D0', category: 'volume' },
  { id: 'VWMA',   nameZh: '成交量加权移动平均值',    nameEn: 'VWMA',                        isOverlay: false, defaultPeriod: 20, color: '#D9F99D', category: 'volume' },
  { id: 'ADR',    nameZh: '涨跌比',                  nameEn: 'Advance/Decline Ratio',       isOverlay: false, defaultPeriod: 14, color: '#FEF08A', category: 'volume' },
  { id: 'VPFR',   nameZh: 'Volume Profile Fixed Range', nameEn: 'VP Fixed Range',          isOverlay: false, defaultPeriod: 1,  color: '#818CF8', category: 'volume' },
  { id: 'VPVR',   nameZh: 'Volume Profile Visible Range', nameEn: 'VP Visible Range',      isOverlay: false, defaultPeriod: 1,  color: '#A78BFA', category: 'volume' },

  // --- Other ---
  { id: 'SPREAD', nameZh: 'Spread',                 nameEn: 'Spread',                      isOverlay: false, defaultPeriod: 1,  color: '#E5E7EB', category: 'other' },
  { id: 'RATIO',  nameZh: 'Ratio',                  nameEn: 'Ratio',                       isOverlay: false, defaultPeriod: 1,  color: '#D1D5DB', category: 'other' },
];

// Category labels
const CATEGORY_LABELS: Record<string, string> = {
  trend: '趋势 · Trend',
  momentum: '动量 · Momentum',
  volatility: '波动率 · Volatility',
  volume: '成交量 · Volume',
  oscillator: '摆动指标 · Oscillator',
  other: '其他 · Other',
  custom: '自制区',
};

interface Props {
  open: boolean;
  onClose: () => void;
  indicators: IndicatorConfig[];
  onIndicatorsChange: (indicators: IndicatorConfig[]) => void;
}

export function IndicatorMenu({ open, onClose, indicators, onIndicatorsChange }: Props) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const handler = (e: MouseEvent) => {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
      };
      document.addEventListener('mousedown', handler);
      cleanupRef.current = () => document.removeEventListener('mousedown', handler);
    }, 50);

    return () => {
      window.clearTimeout(timer);
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [open, onClose]);

  // The menu is anchored to the chart toolbar, which sits left of the price axis.
  // A viewport-wide max width can therefore still clip the menu behind the chart edge.
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const host = panel.closest<HTMLElement>('[data-chart-indicator-host]');
    if (!host) return;
    const fit = () => {
      const boundary = host.querySelector<HTMLElement>('[data-chart-indicator-boundary]') ?? host;
      const left = Math.max(8, boundary.getBoundingClientRect().left + 8);
      const rect = panel.getBoundingClientRect();
      panel.style.maxWidth = `${Math.max(0, Math.min(384, rect.right - left))}px`;
      panel.style.maxHeight = `${Math.max(0, boundary.getBoundingClientRect().bottom - rect.top - 8)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    if (panel.parentElement) observer.observe(panel.parentElement);
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [open]);

  const filtered = useMemo(() => {
    let items = INDICATOR_CATALOG;
    if (categoryFilter) {
      items = items.filter(i => i.category === categoryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        item => item.nameZh.toLowerCase().includes(q) || item.nameEn.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
      );
    }
    return items;
  }, [search, categoryFilter]);

  const toggleIndicator = (item: IndicatorCatalogItem) => {
    const existing = indicators.find(i => i.type === item.id);
    if (existing) {
      onIndicatorsChange(indicators.filter(i => i.type !== item.id));
      return;
    }
    // 互斥的一组（DSP 与「只要副图」）：打开一项就关掉另一项，半衰期、均线时长与 Z 开关沿用原来的设置
    const rival = EXCLUSIVE_PAIRS[item.id];
    const replaced = rival ? indicators.find(i => i.type === rival) : undefined;
    const kept = replaced ? indicators.filter(i => i.type !== rival) : indicators;
    const avgHours = item.avgDefault == null ? undefined : (replaced?.avgHours ?? item.avgDefault);
    const zscore = item.id === 'DSP_Z' || (item.zHint != null && replaced?.zscore) ? true : undefined;
    const research = CUSTOM_RESEARCH_INDICATORS.find(r => r.id === item.id);
    const defaultPeriod = research ? researchDefaultPeriod(research) : item.defaultPeriod;
    onIndicatorsChange([...kept, { type: item.id, period: replaced?.period ?? defaultPeriod, ...(avgHours == null ? {} : { avgHours }), ...(zscore ? { zscore } : {}), color: item.color, enabled: true }]);
  };

  const updatePeriod = (id: string, period: number) => {
    onIndicatorsChange(indicators.map(i => i.type === id ? { ...i, period } : i));
  };
  const updateAvgHours = (id: string, avgHours: number) => {
    onIndicatorsChange(indicators.map(i => i.type === id ? { ...i, avgHours } : i));
  };
  const toggleZ = (id: string) => {
    onIndicatorsChange(indicators.map(i => i.type === id ? { ...i, zscore: !i.zscore } : i));
  };

  const toggleAverage = (id: string) => {
    onIndicatorsChange(indicators.map(i => i.type === id ? { ...i, showAverage: !i.showAverage } : i));
  };

  if (!open) return null;

  const overlays = filtered.filter(i => i.isOverlay);
  const oscillators = filtered.filter(i => !i.isOverlay);
  const categories = ['custom', 'trend', 'momentum', 'volatility', 'volume', 'other'];
  const supportedCount = INDICATOR_CATALOG.filter(i => isSupported(i.id)).length;

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-10 z-[120] flex flex-col w-96 max-w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-card shadow-2xl overflow-hidden transition-all duration-150 ease-out origin-top"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-2.5 border-b border-border bg-card">
        <span className="text-sm font-semibold text-foreground">技术指标</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{supportedCount}/{INDICATOR_CATALOG.length} 已支持</span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors duration-100 ease-out active:scale-[0.9]">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 px-3 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-secondary/50 border border-border">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索指标 (MACD / RSI / BOLL ...)"
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 px-3 py-1.5 border-b border-border overflow-x-auto bg-card">
        <button
          type="button"
          onClick={() => setCategoryFilter(null)}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.95] whitespace-nowrap ${
            !categoryFilter ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          全部
        </button>
        {categories.map(cat => (
          <button
            type="button"
            key={cat}
            onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.95] whitespace-nowrap ${
              categoryFilter === cat ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {CATEGORY_LABELS[cat]?.split(' · ')[0] || cat}
          </button>
        ))}
      </div>

      <div className="max-h-[60vh] min-h-0 flex-auto overflow-y-auto bg-card">
        {(!INDICATOR_CATALOG?.length || filtered.length === 0) && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">未找到匹配的指标</div>
        )}

        {INDICATOR_CATALOG?.length > 0 && overlays.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-secondary border-b border-border sticky top-0 z-10">
              主图叠加 · Overlays ({overlays.length})
            </div>
            {overlays.map(item => (
              <IndicatorRow key={item.id} item={item} indicators={indicators} onToggle={toggleIndicator} onUpdatePeriod={updatePeriod} onUpdateAvgHours={updateAvgHours} onToggleZ={toggleZ} onToggleAverage={toggleAverage} />
            ))}
          </>
        )}

        {INDICATOR_CATALOG?.length > 0 && oscillators.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-secondary border-b border-border sticky top-0 z-10">
              副图指标 · Sub-pane ({oscillators.length})
            </div>
            {oscillators.map(item => (
              <IndicatorRow key={item.id} item={item} indicators={indicators} onToggle={toggleIndicator} onUpdatePeriod={updatePeriod} onUpdateAvgHours={updateAvgHours} onToggleZ={toggleZ} onToggleAverage={toggleAverage} />
            ))}
          </>
        )}
      </div>

      <div className="shrink-0 px-3 py-2 border-t border-border flex items-center justify-between bg-card">
        <span className="text-[10px] text-muted-foreground">
          已启用 {indicators.length} 个指标
          {/* 线上跑的是哪一版：对照提交说明里的版本戳，就知道 Lovable 发布了没有 */}
          <span className="ml-2 font-mono text-muted-foreground/70" data-testid="indicator-menu-build" title="当前页面的版本戳">{BUILD_STAMP.replace('veil-build:', '版本 ')}</span>
        </span>
        <span className="text-[10px] text-muted-foreground">显示 {filtered.length} / {INDICATOR_CATALOG.length}</span>
      </div>
    </div>
  );
}

const IndicatorRow = forwardRef<HTMLDivElement, {
  item: IndicatorCatalogItem;
  indicators: IndicatorConfig[];
  onToggle: (item: IndicatorCatalogItem) => void;
  onUpdatePeriod: (id: string, period: number) => void;
  onUpdateAvgHours: (id: string, avgHours: number) => void;
  onToggleZ: (id: string) => void;
  onToggleAverage: (id: string) => void;
}>(function IndicatorRow({ item, indicators, onToggle, onUpdatePeriod, onUpdateAvgHours, onToggleZ, onToggleAverage }, ref) {
  const active = indicators.find(i => i.type === item.id);
  const supported = isSupported(item.id);
  const custom = item.category === 'custom';
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  return (
    <div
      ref={ref}
      className="flex flex-wrap items-center justify-between gap-y-1 px-3 py-2 hover:bg-accent/30 transition-colors duration-100 ease-out cursor-pointer group"
      onClick={() => onToggle(item)}
    >
      <div className="flex items-center gap-2.5 flex-1 basis-48 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium leading-4 text-foreground">{item.nameZh}</span>
            {!supported && (
              <span className="text-[8px] px-1 py-0 rounded bg-muted text-muted-foreground leading-tight">优化中</span>
            )}
          </div>
          {custom ? (
            <button
              type="button"
              aria-label={`${item.nameZh} 说明`}
              aria-expanded={descriptionOpen}
              onClick={e => { e.stopPropagation(); setDescriptionOpen(open => !open); }}
              className="mt-1 text-[10px] leading-4 text-muted-foreground hover:text-foreground"
            >
              {descriptionOpen ? '收起说明 ▴' : '说明 ▾'}
            </button>
          ) : <span className="text-[10px] text-muted-foreground">{item.nameEn}</span>}
          {!custom && item.description && (
            // 【用户要求】在旁边注明定义；悬停给出完整计算步骤
            <span className="mt-0.5 block whitespace-normal text-[10px] leading-4 text-muted-foreground/90" title={item.detail}>{item.description}</span>
          )}
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 shrink-0 max-w-full">
        {active ? (
          <>
            <ParamInput
              value={active.period}
              parse={v => { const n = CUSTOM_RESEARCH_INDICATORS.some(r => r.id === item.id) ? Number(v) : parseInt(v); return Number.isFinite(n) && n > 0 ? n : null; }}
              onCommit={n => onUpdatePeriod(item.id, n)}
              title={item.periodHint}
              label={`${item.nameZh} 参数`}
            />
            {item.periodUnit && <span className="-ml-1 text-[10px] text-muted-foreground">{item.periodUnit}</span>}
            {item.avgDefault != null && (
              <>
                <span className="ml-0.5 text-[10px] text-muted-foreground" title={item.avgHint}>avg</span>
                <ParamInput
                  value={active.avgHours ?? item.avgDefault}
                  parse={v => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null; }}
                  onCommit={n => onUpdateAvgHours(item.id, n)}
                  title={item.avgHint}
                  label={`${item.nameZh} 均线时长 N（小时）`}
                />
                <span className="-ml-1 text-[10px] text-muted-foreground">h</span>
              </>
            )}
            {item.zHint != null && (
              <button
                type="button"
                aria-pressed={!!active.zscore}
                aria-label={`${item.nameZh} 用 Z 分数版`}
                title={item.zHint}
                onClick={e => { e.stopPropagation(); onToggleZ(item.id); }}
                className={`h-[18px] rounded px-1.5 font-mono text-[10px] leading-none border transition-colors ${active.zscore ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                Z
              </button>
            )}
            {item.category === 'custom' && <button
              type="button" aria-pressed={!!active.showAverage} aria-label={`${item.nameZh} 显示 avg_x`}
              title="显示 / 隐藏普通均值 avg_x；原值和 avg_x_2 保留"
              onClick={e => { e.stopPropagation(); onToggleAverage(item.id); }}
              className={`h-[18px] rounded border px-1.5 font-mono text-[10px] leading-none transition-colors ${active.showAverage ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >avg</button>}
            <Check className="w-3.5 h-3.5 text-primary" />
          </>
        ) : (
          <Plus className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
      {custom && descriptionOpen && (
        <div
          className="basis-full pl-[18px] pr-1 pt-1 text-[10px] leading-4 text-muted-foreground cursor-text"
          onClick={e => e.stopPropagation()}
        >
          <p className="font-medium">{item.nameEn}</p>
          {item.description && <p className="mt-1 whitespace-normal" title={item.detail}>{item.description}</p>}
        </div>
      )}
    </div>
  );
});

IndicatorRow.displayName = 'IndicatorRow';

/**
 * 参数框：输入过程中保留草稿（清空、打到一半不会被弹回默认值），是有效数字才生效；失焦时复原为当前生效的值。
 */
function ParamInput({ value, parse, onCommit, title, label }: {
  value: number;
  parse: (raw: string) => number | null;
  onCommit: (n: number) => void;
  title?: string;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      aria-label={label}
      value={draft ?? String(value)}
      onChange={e => {
        e.stopPropagation();
        setDraft(e.target.value);
        const n = parse(e.target.value);
        if (n != null && n !== value) onCommit(n);
      }}
      onBlur={() => setDraft(null)}
      onClick={e => e.stopPropagation()}
      title={title}
      className="w-12 px-1 py-0.5 rounded text-[10px] font-mono text-right bg-secondary border border-border text-foreground"
    />
  );
}
