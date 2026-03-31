/**
 * IndicatorMenu — Searchable indicator panel with 80+ indicators.
 * Works with klinecharts native indicator system + custom registered indicators.
 */

import { useState, useRef, useEffect, useMemo, forwardRef } from 'react';
import { Search, X, Plus, Check } from 'lucide-react';
import type { IndicatorConfig } from './CandlestickChart';
import { CUSTOM_INDICATOR_MAP } from '@/lib/customIndicators';

export interface IndicatorCatalogItem {
  id: string;
  nameZh: string;
  nameEn: string;
  isOverlay: boolean;
  defaultPeriod: number;
  color: string;
  /** Category for grouping */
  category: 'trend' | 'momentum' | 'volatility' | 'volume' | 'oscillator' | 'other';
}

// Determine support status dynamically: if we have a mapping, it's supported
function isSupported(id: string): boolean {
  return id in CUSTOM_INDICATOR_MAP;
}

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
  { id: 'HV',     nameZh: '历史波动率',              nameEn: 'Historical Volatility',       isOverlay: false, defaultPeriod: 20, color: '#EF4444', category: 'volatility' },
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

  useEffect(() => {
    if (!open) return;
    // Delay adding listener to avoid catching the same click that opened the menu
    const timer = setTimeout(() => {
      const handler = (e: MouseEvent) => {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
      };
      document.addEventListener('mousedown', handler);
      // Store cleanup ref
      cleanupRef.current = () => document.removeEventListener('mousedown', handler);
    }, 50);
    return () => {
      clearTimeout(timer);
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [open, onClose]);

  const cleanupRef = useRef<(() => void) | null>(null);

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
    onIndicatorsChange([...indicators, { type: item.id, period: item.defaultPeriod, color: item.color, enabled: true }]);
  };

  const updatePeriod = (id: string, period: number) => {
    onIndicatorsChange(indicators.map(i => i.type === id ? { ...i, period } : i));
  };

  if (!open) return null;

  const overlays = filtered.filter(i => i.isOverlay);
  const oscillators = filtered.filter(i => !i.isOverlay);

  const categories = ['trend', 'momentum', 'volatility', 'volume', 'other'];

  const supportedCount = INDICATOR_CATALOG.filter(i => isSupported(i.id)).length;

  return (
    <div ref={panelRef} className="absolute right-0 top-10 z-[100] w-96 rounded-lg border border-border shadow-2xl overflow-hidden bg-card animate-in fade-in slide-in-from-top-2 duration-150"
      onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-sm font-semibold text-foreground">技术指标</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{supportedCount}/{INDICATOR_CATALOG.length} 已激活</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors duration-100 ease-out active:scale-[0.9]">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-secondary/50 border border-border">
          <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索指标 (如 MACD, 布林带, RSI, Bollinger...)"
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Category Filters */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border overflow-x-auto">
        <button
          onClick={() => setCategoryFilter(null)}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.95] whitespace-nowrap ${
            !categoryFilter ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          全部
        </button>
        {categories.map(cat => (
          <button
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

      <div className="max-h-[420px] overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">未找到匹配的指标</div>
        )}

        {overlays.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-secondary/30 border-b border-border sticky top-0 z-10">
              主图叠加 · Overlays ({overlays.length})
            </div>
            {overlays.map(item => (
              <IndicatorRow key={item.id} item={item} indicators={indicators} onToggle={toggleIndicator} onUpdatePeriod={updatePeriod} />
            ))}
          </>
        )}

        {oscillators.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-secondary/30 border-b border-border sticky top-0 z-10">
              副图指标 · Sub-pane ({oscillators.length})
            </div>
            {oscillators.map(item => (
              <IndicatorRow key={item.id} item={item} indicators={indicators} onToggle={toggleIndicator} onUpdatePeriod={updatePeriod} />
            ))}
          </>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          已启用 {indicators.length} 个指标
        </span>
        <span className="text-[10px] text-muted-foreground">
          显示 {filtered.length} / {INDICATOR_CATALOG.length}
        </span>
      </div>
    </div>
  );
}

function IndicatorRow({ item, indicators, onToggle, onUpdatePeriod }: {
  item: IndicatorCatalogItem;
  indicators: IndicatorConfig[];
  onToggle: (item: IndicatorCatalogItem) => void;
  onUpdatePeriod: (id: string, period: number) => void;
}) {
  const active = indicators.find(i => i.type === item.id);
  const supported = isSupported(item.id);

  return (
    <div
      className="flex items-center justify-between px-3 py-2 hover:bg-accent/30 transition-colors duration-100 ease-out cursor-pointer group"
      onClick={() => onToggle(item)}
    >
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-foreground truncate">{item.nameZh}</span>
            {!supported && (
              <span className="text-[8px] px-1 py-0 rounded bg-muted text-muted-foreground leading-tight">优化中</span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">{item.nameEn}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {active ? (
          <>
            <input
              type="number"
              value={active.period}
              onChange={e => { e.stopPropagation(); onUpdatePeriod(item.id, parseInt(e.target.value) || item.defaultPeriod); }}
              onClick={e => e.stopPropagation()}
              className="w-12 px-1 py-0.5 rounded text-[10px] font-mono text-right bg-secondary border border-border text-foreground"
            />
            <Check className="w-3.5 h-3.5 text-primary" />
          </>
        ) : (
          <Plus className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    </div>
  );
}
