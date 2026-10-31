import {DBL5_ID,DBL5_VERSION,DBL5_FIELDS,DBL5_RENDER_FIELDS} from '@/lib/dbl5m';
import {SBS5M_ID,SBS5M_VERSION,SBS5M_FIELDS} from '@/lib/sbs5m';
import {PRS6H_ID,PRS6H_FIELDS} from '@/lib/prs6h';
import {ati6hMarketVersion,requestAti6hTickSize} from '@/lib/ati6hMarketData';
import {ati6hDependencyOf} from '@/lib/deepDig/features';
import { SELLER_RETENTION_SPECS, retentionComponents } from '@/lib/sellerRetention';
import { accountFeatureDefs, chartFeaturePeriod, featureCoreName, namedChartFormula, hasSavedFeatureDefinition } from '@/lib/featureSource';
import { featureTemplateId, featureUsesMbi, featureUsesMbi2, featureUsesMbiFamily, BUILTIN_FEATURES, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { CTBA_DEFAULTS, CTBA_ABSOLUTE_BOUND } from '@/lib/ctba';
/** Deep dig chart features: raw value and the two named averages share one formula. */
import type { KLineData } from 'klinecharts';
import { chartFeatureDef as accountFeatureDef, chartFeatureSeries, chartFeatureHistoryBars } from '@/lib/featureSource';
import { compileFeatureFormula, avgHoursOf, halfLifeOf } from '@/lib/deepDig/features';
import { chartPrehistoryReady, chartPrehistory, researchHistoryVersion } from '@/lib/researchChartHistory';
import { btcClosesAt, requestBtcReference, btcReferenceVersion } from '@/lib/btcReference';
import { inferIntervalMs, DSP_BASE_INTERVAL_MS } from '@/lib/dynamicSchellingPoint';
import { enableChartComputation, isChartComputationEnabled, chartComputationVersion, resetChartComputationAlignment } from './chartComputeClient';
import { displayAverage } from '@/lib/avgHighlight';
import { appendResearchAverages } from '@/lib/researchAverageFormula';
import { mbiNOf } from '@/lib/mbi';

// avgRange：均值副图固定纵轴（有固定范围的指标）。【用户要求】2026-10-22「把有固定范围的指标的均值副图纵轴也固定住：状态 S 0–1，CDI2 和 DSS ±1，CDA ±100」
export const RESEARCH_INDICATORS = [
  {id:'DBL5',featureId:DBL5_ID,core:'DBL5',short:'DBL-5',name:'DBL-5｜达瓦斯箱体下轨',period:3,parameter:'确认参数（定义）',neutral:0,min:0,max:0,seller:false,marketEvidence:true,rawOnly:true,priceOverlay:true,components:[...DBL5_FIELDS.filter(n=>n!=='DBL5'),...DBL5_RENDER_FIELDS]},
  ...[{id:'DBL5_DISTANCE',featureId:'darvas_5m_distance_bps',core:'DBL5_distance_bps',short:'DBL·距离',name:'DBL-5｜距下轨基点'},{id:'DBL5_WIDTH',featureId:'darvas_5m_width_bps',core:'DBL5_width_bps',short:'DBL·箱宽',name:'DBL-5｜箱宽基点'},{id:'DBL5_AGE',featureId:'darvas_5m_age_minutes',core:'DBL5_age_minutes',short:'DBL·年龄',name:'DBL-5｜确认年龄'}].map(d=>({...d,period:3,parameter:'确认参数（定义）',neutral:0,min:0,max:0,seller:false,marketEvidence:true,rawOnly:true,components:[...DBL5_FIELDS.filter(n=>n!=='DBL5'&&n!=='DBL5_upper'),...DBL5_RENDER_FIELDS]})),
  {id:'SBS5M',featureId:SBS5M_ID,core:'SBS5M',short:'SBS-5M',name:'台阶箱体支撑',period:6,parameter:'有效期（定义配置）',parameterUnit:'h',neutral:0,min:0,max:0,seller:false,marketEvidence:true,rawOnly:true,priceOverlay:true,components:SBS5M_FIELDS.filter(n=>n!=='SBS5M')},
  {id:'SBS5M_QUALITY',featureId:'sbs_5m_quality',core:'SBS5M_support_quality',short:'SBS·证据',name:'台阶箱体支撑｜证据分',period:6,parameter:'有效期（定义配置）',neutral:0,min:0,max:100,seller:false,marketEvidence:true,rawOnly:true},
  {id:'SBS5M_DISTANCE',featureId:'sbs_5m_distance',core:'SBS5M_distance_to_support',short:'SBS·距离',name:'台阶箱体支撑｜标准化距离',period:6,parameter:'有效期（定义配置）',neutral:0,min:0,max:0,seller:false,marketEvidence:true,rawOnly:true},
  {id:'SBS5M_STEP',featureId:'sbs_5m_step',core:'SBS5M_step_height_atr',short:'SBS·台阶',name:'台阶箱体支撑｜台阶幅度',period:6,parameter:'有效期（定义配置）',neutral:0,min:0,max:0,seller:false,marketEvidence:true,rawOnly:true},
  {id:'PRS6H',featureId:PRS6H_ID,core:'PRS6H',short:'PRS-6H',name:'日内顺势加仓证据',period:.5,parameter:'近期证据半衰期',parameterUnit:'h',neutral:0,neutralLabel:'0｜未满足本指标证据（非看空）',min:0,max:100,seller:false,marketEvidence:true,avgRange:[0,100],components:PRS6H_FIELDS.filter(n=>n!=='PRS6H')},
  {id:'ATI6H',featureId:'ati6h',core:'ATI6H',short:'ATI-6H',name:'ATI-6H｜加仓支持证据指数',period:1,parameter:'证据半衰期',parameterUnit:'h',neutral:0,neutralLabel:'0｜证据归零（非执行门槛）',min:0,max:1,seller:false,marketEvidence:true,avgRange:[0,1],components:['ATI6H_sA','ATI6H_sB','ATI6H_sC','ATI6H_sD','ATI6H_sE','ATI6H_sF','ATI6H_min','ATI6H_support_price','ATI6H_support_failure_price','ATI6H_breakout_price','ATI6H_nearest_resistance_price','ATI6H_structure_status_code']},
  { id: 'STATE', featureId: 'state', core: 'state', short: '状态 S', name: '多空状态 S（0–1）', period: 24, parameter: '基线时长', neutral: 0.6, avgNeutral: 0.6, min: 0, max: 1, avgRange: [0, 1], seller: false }, // 【用户要求】2026-10-22 橘色线（线上绿、线下红）：原始值与两条均值线都在 0.6
  { id: 'STATE2', featureId: 'state2', core: 'state2', short: '状态 S2', name: '多空状态 S2（0–1）', period: 24, parameter: '基线时长', neutral: 0.6, avgNeutral: 0.6, min: 0, max: 1, avgRange: [0, 1], seller: false },
  { id: 'CDI2', featureId: 'cdi2', core: 'CDI2', short: 'CDI2', name: '买方失控程度 CDI2', period: 24, parameter: '基线时长', neutral: 0, min: -1, max: 1, avgRange: [-1, 1], seller: true },
  { id: 'SELLER_CONTROL', featureId: 'seller-control', core: 'bc', short: 'DSP·bc', name: '卖方控制力 DSP·bc', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, seller: true },
  { id: 'DSS', featureId: 'dss', core: 'DSS', short: 'DSS', name: '买方状态恶化 DSS', period: 1, parameter: '近期窗口', neutral: 0, avgNeutral: 0, min: -1, max: 1, avgRange: [-1, 1], seller: true },
  { id: 'CDA', featureId: 'cda', core: 'CDA', short: 'CDA', name: '买方阻力 CDA', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, avgRange: [-100, 100], seller: true },
  { id: 'MBI_BEAR', featureId: 'mbi-bear', core: 'MBI_bear', short: 'MBI·空方', name: 'MBI 空方趋势', period: 25, parameter: '衰减根数', neutral: 0, min: -1, max: 1, avgRange: [-1, 1], seller: true },
  { id: 'CTBA_BEAR', featureId: 'ctba-bear', core: 'CTBA_bear', short: 'CTBA·空方', name: 'CTBA 空方趋势', period: CTBA_DEFAULTS.N, parameter: '窗口根数', neutral: 0, min: -100, max: 100, avgRange: [-100, 100], seller: true },
  { id:'MBI2',featureId:'mbi2',core:'MBI2',short:'MBI2',name:'MBI2 迈克尔买方优势（可调版）',period:25*5/60,parameter:'日历时长',parameterUnit:'h',neutral:0,min:-1,max:1,avgRange:[-1,1],components:['MBI2_state','MBI2_lead_h','MBI2_confirm_h'],seller:false },
  { id:'CTBA_12H',featureId:'ctba_12h',core:'CTBA',short:'CTBA-12H',name:'CTBA-12H｜趋势买方优势（12小时）',period:144,parameter:'窗口根数',parameterUnit:'根',neutral:0,neutralLabel:'0｜综合均衡基准',min:-CTBA_ABSOLUTE_BOUND,max:CTBA_ABSOLUTE_BOUND,avgRange:[-CTBA_ABSOLUTE_BOUND,CTBA_ABSOLUTE_BOUND],components:['T','M','F'],seller:false },
  { id:'MBI2_BEAR',featureId:'mbi2-bear',core:'MBI2_bear',short:'MBI2·卖方',name:'MBI2 卖方趋势（可调版）',period:25*5/60,parameter:'日历时长',parameterUnit:'h',neutral:0,min:-1,max:1,avgRange:[-1,1],components:['MBI2_bear_state','MBI2_bear_lead_h','MBI2_bear_confirm_h'],seller:true },
  { id:'CTBA_12H_BEAR',featureId:'ctba_12h-bear',core:'CTBA_12H_bear',short:'CTBA-12H·卖方',name:'CTBA-12H 卖方趋势（12小时）',period:144,parameter:'窗口根数',parameterUnit:'根',neutral:0,neutralLabel:'0｜综合均衡基准',min:-100,max:100,avgRange:[-100,100],components:['T','M','F'],seller:true },
  ...SELLER_RETENTION_SPECS.map(s=>({id:s.chartId,featureId:s.id,core:s.core,short:s.label+'·保留',name:s.label+'｜成交保留增强',period:6,parameter:'原算法参数',parameterUnit:['mbi-bear','ctba-bear','ctba_12h-bear'].includes(s.sourceId)?'根':'h',neutral:0,min:-s.bound,max:s.bound,avgRange:[-s.bound,s.bound] as const,seller:true,components:retentionComponents()})),
] as const;
export const BUYER_RESEARCH_INDICATORS = [
  { id: 'DSP_VA', featureId: 'drift-speed', core: 'a', short: 'DSP·a', name: '买方推力漂移速度 DSP·a', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, seller: false },
  { id: 'BSS', featureId: 'bss', core: 'BSS', short: 'BSS', name: '买卖强度综合分 BSS', period: 1, parameter: '近期窗口', neutral: 0, min: -1, max: 1, seller: false },
  { id: 'CBA', featureId: 'cba', core: 'CBA', short: 'CBA', name: '买方定价优势指数 CBA', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, seller: false },
  { id: 'DSP_Z', featureId: 'drift-speed-z', core: 'az', short: 'DSP·az', name: '买方推力漂移速度 DSP·az（波动率归一化）', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, seller: false },
  { id: 'CBI2', featureId: 'cbi2', core: 'CBI2', short: 'CBI-2', name: '买方优势指数 CBI-2', period: 24, parameter: '基线时长', neutral: 0, min: -1, max: 1, seller: false },
  { id: 'MBI', featureId: 'mbi', core: 'MBI', short: 'MBI', name: 'MBI 迈克尔买方优势', period: 25, parameter: '衰减根数', neutral: 0, min: -1, max: 1, seller: false },
  { id:'CTBA', featureId:'ctba', core:'CTBA', short:'CTBA', name:'CTBA｜趋势买方优势', period:CTBA_DEFAULTS.N, parameter:'窗口根数', neutral:0, min:-100, max:100, seller:false },
] as const;
export const CUSTOM_RESEARCH_INDICATORS = [...BUYER_RESEARCH_INDICATORS, ...RESEARCH_INDICATORS];

export interface ResearchIndicator {
  id: string; featureId: string; core: string; short: string; name: string; period: number; parameter: string;
  neutral: number; min: number; max: number; seller: boolean; avgNeutral?: number; avgRange?: readonly [number, number];
  priceOverlay?:boolean; rawOnly?:boolean; marketEvidence?:boolean; templateId?: string; neutralLabel?: string; components?: readonly string[]; parameterUnit?: string;
}
export const accountIndicatorId = (featureId: string) => 'FEATURE_' + featureId;
export function researchIndicatorForFeature(def: DeepDigFeatureDef): ResearchIndicator {
  const builtin = BUILTIN_FEATURES.find(d => d.id === def.id);
  const direct = CUSTOM_RESEARCH_INDICATORS.find(item => item.featureId === def.id);
  const template = direct ?? CUSTOM_RESEARCH_INDICATORS.find(item => def.chartCore === item.core) ?? CUSTOM_RESEARCH_INDICATORS.find(item => item.featureId === featureTemplateId(def));
  let core = def.chartCore ?? template?.core ?? '_feature_value';
  try {
    const program = compileFeatureFormula(namedChartFormula(def.formula)).program;
    if (!program.statements.some(s => s.name === core)) core = featureCoreName(program) ?? core;
  } catch { /* Invalid formulas remain editable, with empty charts. */ }
  return { ...(featureTemplateId(def)===DBL5_ID?{rawOnly:true,priceOverlay:(def.DBL5_dimension??'price')==='price'}:{}), ...(featureTemplateId(def)===SBS5M_ID?{rawOnly:true,priceOverlay:(def.SBS5M_dimension??'price')==='price'}:{}), ...(['ati6h','prs6h',SBS5M_ID,DBL5_ID].includes(featureTemplateId(def)??'')?{marketEvidence:true}:{}), id: direct?.id ?? accountIndicatorId(def.id), featureId: def.id, core, short: !def.focusVersion && def.short === builtin?.short ? template?.short ?? def.short : def.short, name: !def.focusVersion && def.name === builtin?.name ? template?.name ?? def.name : def.name,
    period: chartFeaturePeriod(def, template?.period ?? 6), parameter: template?.parameter ?? '半衰期', neutral: template?.neutral ?? 0,
    min: template?.min ?? 0, max: template?.max ?? 0, seller: template?.seller ?? false,
    ...('avgNeutral' in (template ?? {}) ? { avgNeutral: (template as ResearchIndicator).avgNeutral } : {}),
    ...('avgRange' in (template ?? {}) ? { avgRange: (template as ResearchIndicator).avgRange } : {}), templateId: template?.id, ...('neutralLabel' in (template ?? {})?{neutralLabel:(template as ResearchIndicator).neutralLabel}:{}), ...('components' in (template ?? {})?{components:(template as ResearchIndicator).components}:{}), ...('parameterUnit' in (template ?? {})?{parameterUnit:(template as ResearchIndicator).parameterUnit}:{}), ...(def.retentionSourceId?{components:retentionComponents(def.retentionPrefix),parameter:'原算法参数',neutral:0,avgNeutral:0}: {}) };
}
const accountRegistryCache = new WeakMap<readonly DeepDigFeatureDef[], ResearchIndicator[]>();
export function accountResearchIndicators(definitions: readonly DeepDigFeatureDef[] = accountFeatureDefs()): ResearchIndicator[] {
  const cached = accountRegistryCache.get(definitions);
  if (cached) return cached;
  const items: ResearchIndicator[] = [...CUSTOM_RESEARCH_INDICATORS.map(item => {
    const def = definitions.find(d => d.id === item.featureId);
    return def ? researchIndicatorForFeature(def) : item;
  }), ...definitions.filter(def => def.focusVersion || !BUILTIN_FEATURES.some(item => item.id === def.id)).map(researchIndicatorForFeature)];
  accountRegistryCache.set(definitions, items);
  return items;
}
/** Saved research changes reset the scalar once; later chart edits remain possible. */
export function syncResearchIndicatorConfigs<T extends { type: string; period: number; featureDefinitionVersion?: number; featureWindowPeriod?: number }>(configs: readonly T[], definitions: readonly DeepDigFeatureDef[]): T[] {
  const items = accountResearchIndicators(definitions);
  let changed = false;
  const next = configs.map(config => {
    const legacyId = config.type === 'CBI' ? 'cbi' : config.type === 'CBA-2' ? 'cba-2' : undefined;
    const legacyDef = legacyId && definitions.find(d => d.id === legacyId);
    const item = items.find(item => item.id === config.type || config.type === 'DSP' && item.id === 'DSP_VA') ?? (legacyDef ? researchIndicatorForFeature(legacyDef) : undefined);
    if (!item) return config;
    const version = researchDefinitionVersion(item);
    const response = ['mbi-bear','ctba-bear'].includes(item.featureId) && /\bseller_response\s*\(/.test(definitions.find(d=>d.id===item.featureId)?.formula ?? '');
    if (config.featureDefinitionVersion === version && (!response || config.featureWindowPeriod === item.period)) return config;
    changed = true;
    const preserveResponseWindow = response && (config.featureWindowPeriod == null || config.featureWindowPeriod === item.period);
    const reset = !preserveResponseWindow && (config.featureDefinitionVersion != null || hasSavedFeatureDefinition(item.featureId));
    return { ...config, period: reset ? researchDefaultPeriod(item) : config.period, ...(reset ? { avgHours: 24 } : {}), featureDefinitionVersion: version, ...(response ? {featureWindowPeriod:item.period} : {}) };
  });
  return changed ? next : configs as T[];
}


/** Replace saved DSP·b chart selections; a separately configured seller-control selection wins. */
export function migrateResearchIndicators<T extends { type: string }>(saved: readonly T[]): T[] {
  const hasControl = saved.some(item => item.type === 'SELLER_CONTROL');
  let replaced = hasControl;
  return saved.flatMap(item => {
    if (item.type !== 'DSP_B') return [item];
    if (replaced) return [];
    replaced = true;
    return [{ ...item, type: 'SELLER_CONTROL' }];
  });
}

export const researchKcName = (id: string, level = 0) => {
  const stem = id === 'DSP_VA' ? 'DSP_V' : id === 'DSP_Z' ? 'DSP_Z_V' : id;
  return `${stem}${level === 1 ? '_AVG' : level === 2 ? '_AVG2' : ''}_CUSTOM`;
};
export function researchIndicatorForKc(name: string): ResearchIndicator | undefined {
  return accountResearchIndicators().find(item => [0, 1, 2].some(level => researchKcName(item.id, level) === name));
}

/** Some saved Z definitions call their output a, rather than the built-in az. */
export function researchSeriesNames(item: ResearchIndicator, formula: string) {
  let core: string = item.core;
  try {
    const program = compileFeatureFormula(namedChartFormula(formula)).program;
    if (!program.statements.some(s => s.name === core)) core = featureCoreName(program) ?? core;
  } catch { /* Invalid definitions produce missing values. */ }
  if (item.id === 'DSP_Z') {
    try {
      const names = new Set(compileFeatureFormula(formula).program.statements.map(s => s.name));
      if (!names.has('az') && names.has('a')) core = 'a';
    } catch { /* Invalid definitions leave chart series blank, including tooltips. */ }
  }
  return { core, avg: `avg_${core}`, avg2: `avg_${core}_2` };
}

const chartDataGenerations = new WeakMap<KLineData[], number>();
const chartDataChanges = new WeakMap<KLineData[], [number, number][]>();
/** The native chart calls this before every data mutation, so companion panes share one scan. */
export function invalidateResearchChartData(data: KLineData[], from = 0) {
  const revision = (chartDataGenerations.get(data) ?? 0) + 1;
  chartDataGenerations.set(data, revision);
  const changes = chartDataChanges.get(data) ?? [];
  changes.push([revision, Math.max(0, from)]);
  if (changes.length > 128) changes.shift();
  chartDataChanges.set(data, changes);
}
const chartDataCache = new WeakMap<KLineData[], { values: Float64Array; revision: number; generation?: number }>();
const DATA_FIELDS = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'turnover', 'takerBuyTurnover', 'cba2Closed','ATI6H_quoteVolume','ATI6H_takerBuyQuoteVolume'] as const;
/** Compare mutable candles without allocating thousands of row arrays each frame. */
function dataRevision(data: KLineData[]): number {
  const generation = chartDataGenerations.get(data), cached = chartDataCache.get(data);
  if (generation != null && cached?.generation === generation) return cached.revision;
  // Interactive charts explicitly invalidate every mutation. Their generation
  // is sufficient; rescanning the entire history here blocks every replay tick.
  if (generation != null) {
    const revision = (cached?.revision ?? 0) + 1;
    chartDataCache.set(data, { values: cached?.values ?? new Float64Array(0), revision, generation });
    return revision;
  }
  const size = data.length * DATA_FIELDS.length;
  const values = cached?.values.length === size ? cached.values : new Float64Array(size);
  let changed = !cached || values !== cached.values;
  for (let i = 0; i < data.length; i++) for (let j = 0; j < DATA_FIELDS.length; j++) {
    const value = data[i][DATA_FIELDS[j]], v = typeof value === 'boolean' ? Number(value) : value ?? NaN, at = i * DATA_FIELDS.length + j;
    if (!Object.is(values[at], v)) changed = true;
    values[at] = v;
  }
  const revision = (cached?.revision ?? 0) + (changed ? 1 : 0);
  chartDataCache.set(data, { values, revision, generation });
  return revision;
}

/** Supply defaults only for missing series. Existing account expressions always win. */
export function researchChartFormula(item: ResearchIndicator, formula: string): string {
  const named = namedChartFormula(formula);
  const names = new Set(compileFeatureFormula(named).program.statements.map(s => s.name));
  const series = researchSeriesNames(item, named);
  return item.rawOnly?named:appendResearchAverages(named, names, series);
}

export function researchDefaultPeriod(item: ResearchIndicator): number {
  const def = accountFeatureDef(item.featureId);
  return def ? chartFeaturePeriod(def, item.period) : item.period;
}

function chartInterval(data: KLineData[]) {
  const gaps: number[] = [];
  for (let i = 1; i < data.length && gaps.length < 64; i++) {
    const gap = data[i].timestamp - data[i-1].timestamp;
    if (gap > 0) gaps.push(gap);
  }
  gaps.sort((a,b)=>a-b);
  return gaps[Math.floor(gaps.length/2)] ?? DSP_BASE_INTERVAL_MS;
}
const displaySeriesCache = new WeakMap<object, Map<string, DisplaySeries>>();
interface ExtendedChartData {history:KLineData[];revision:number;generation?:number;data:KLineData[]}
// Different indicators can require different warmup histories on the same chart.
// Retain each combined array so one pane cannot evict another pane's worker result.
const extendedData = new WeakMap<KLineData[],Map<KLineData[],ExtendedChartData>>();
const EMPTY_HISTORY: KLineData[] = [];
const formulaPlans = new Map<string, { formula: string; usesBtc: boolean }>();
function formulaPlan(item: ResearchIndicator, source: string) {
  const key = `${item.core}\n${source}`;
  let plan = formulaPlans.get(key);
  if (!plan) {
    const formula = researchChartFormula(item, source);
    plan = { formula, usesBtc: compileFeatureFormula(formula).program.inputs.has('CB') };
    if (formulaPlans.size > 64) formulaPlans.clear();
    formulaPlans.set(key, plan);
  }
  return plan;
}

/** Hidden calc parameter: account formula / scale changes must invalidate chart calculations. */
export function researchDefinitionVersion(item: ResearchIndicator): number {
  const def = accountFeatureDef(item.featureId);
  let hash = 2166136261;
  const values = [def?.formula, def?.scale, def?.unit, def?.halfLifeHours, def?.avgHours, def?.interval, def?.MBI_N, def?.MBI_Z0, def?.chartTemplate, ...(featureTemplateId(def??{})===DBL5_ID?[DBL5_VERSION,def?.DBL5_config,def?.DBL5_dimension,def?.DBL5_initialization_start,ati6hMarketVersion()]:[]), ...(featureTemplateId(def??{})===SBS5M_ID?[SBS5M_VERSION,def?.SBS5M_config,def?.SBS5M_dimension,ati6hMarketVersion()]:[]), ...(featureTemplateId(def??{})==='prs6h'?[def?.PRS6H_config,ati6hMarketVersion()]:[]), ...(featureTemplateId(def??{})==='ati6h'?[def?.ATI6H_parameters,def?.ATI6H_volume_mode,ati6hDependencyOf(def??{}),ati6hMarketVersion()]:[]), ...(def&&featureUsesMbi2(def)?[def.MBI2_T_HOURS,def.MBI2_Z0,def.MBI2_BAND,def.MBI2_CONFIRM]:[])];
  for (const c of JSON.stringify(values)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return hash >>> 0;
}

type DisplaySeries = { core: (number | null)[]; avg: (number | null)[]; avg2: (number | null)[]; pending?: boolean; components?: Record<string,(number|null)[]> };
interface DisplaySnapshot { times: Map<number, number>; result: DisplaySeries }
interface DisplayHistory { snapshots: Map<string, DisplaySnapshot> }
const displayHistories = new WeakMap<KLineData[], DisplayHistory>();
const historyAnchors = new WeakMap<KLineData, DisplayHistory>();
/** Native prepend uses concat: share continuity only through actual candle objects,
 * never through a symbol/time guess that could mix charts or replay timelines. */
function displayHistory(data: KLineData[]): DisplayHistory {
  let history = displayHistories.get(data);
  if (!history) {
    for (const bar of data) { history = historyAnchors.get(bar); if (history) break; }
    history ??= { snapshots: new Map() };
    displayHistories.set(data, history);
    if (data[0]) historyAnchors.set(data[0], history);
  }
  return history;
}
/** Only the chart's verified forward-snapshot path calls this. Known values
 * remain timestamp-aligned while missing candles are repaired; a new symbol,
 * interval or rewind deliberately starts with its own history. */
export function inheritForwardResearchChartData(previous: KLineData[], next: KLineData[]) {
  const history = displayHistories.get(previous);
  if (history) displayHistories.set(next, history);
  const cached = extendedData.get(previous);
  if (cached) {
    const inherited=new Map<KLineData[],ExtendedChartData>();
    for(const [history,entry] of cached){resetChartComputationAlignment(entry.data);inherited.set(history,{...entry,revision:-1,generation:undefined});}
    extendedData.set(next,inherited);
  }
}
function continueDisplay(data: KLineData[], key: string, result: DisplaySeries): DisplaySeries {
  const history = displayHistory(data), previous = history.snapshots.get(key);
  if (result.pending && previous) {
    const indices = data.map(bar => previous.times.get(bar.timestamp));
    const aligned = (name: 'core' | 'avg' | 'avg2') => indices.map(i => i == null ? null : previous.result[name][i] ?? null);
    return { core: aligned('core'), avg: aligned('avg'), avg2: aligned('avg2'), ...(previous.result.components?{components:Object.fromEntries(Object.entries(previous.result.components).map(([name,values])=>[name,indices.map(i=>i==null?null:values[i]??null)]))}:{}), pending: true };
  }
  if (!result.pending) {
    if (history.snapshots.size >= 256 && !history.snapshots.has(key)) history.snapshots.delete(history.snapshots.keys().next().value!);
    history.snapshots.set(key, { times: new Map(data.map((bar, i) => [bar.timestamp, i])), result });
  }
  return result;
}
type ChartSeriesOptions = { fetchReference?: boolean; averageHours?: number };
const liveSeriesCache = new WeakMap<KLineData[], Map<string, { generation: number; result: ReturnType<typeof calculateChartSeries> }>>();
export function researchChartSeries(data: KLineData[], item: ResearchIndicator, period: number, options: ChartSeriesOptions = {}) {
  const generation = chartDataGenerations.get(data);
  const def = accountFeatureDef(item.featureId);
  const continuityKey = `${item.id}|${period}|${options.averageHours ?? 24}|${researchDefinitionVersion(item)}`;
  const continuous = isChartComputationEnabled(data);
  const finish = (result: DisplaySeries) => continuous ? continueDisplay(data, continuityKey, result) : result;
  // Establish lineage even while the first worker request is still pending.
  if (continuous) displayHistory(data);
  if (generation == null) return finish(calculateChartSeries(data, item, period, options));
  const mbiKey = def && featureUsesMbi(def) ? `|${def?.MBI_N}|${def?.MBI_Z0}` : def&&featureUsesMbi2(def)?`|${def.MBI2_T_HOURS}|${def.MBI2_BAND}|${def.MBI2_CONFIRM}` : '';
  const key = `${item.id}|${period}|${options.averageHours ?? 24}|${options.fetchReference !== false}|${def?.formula}|${def?.scale}|${def?.halfLifeHours}|${def?.avgHours}|${researchHistoryVersion()}|${btcReferenceVersion()}|${item.marketEvidence?researchDefinitionVersion(item):''}${mbiKey}`;
  let cache = liveSeriesCache.get(data);
  // Raw and 24h companion panes read the same immutable display result during
  // one native update. Background completion must also invalidate this result.
  const computeVersion = chartComputationVersion();
  const versionKey = `${key}|${computeVersion}`;
  const current = cache?.get(versionKey);
  if (current?.generation === generation) return current.result;
  const result = finish(calculateChartSeries(data, item, period, options));
  if (!cache) { cache = new Map(); liveSeriesCache.set(data, cache); }
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(versionKey, { generation, result });
  return result;
}
function calculateChartSeries(data: KLineData[], item: ResearchIndicator, period: number, options: ChartSeriesOptions = {}): DisplaySeries {
  if(item.marketEvidence&&options.fetchReference!==false&&typeof data[0]?.researchSymbol==='string')requestAti6hTickSize(data[0].researchSymbol);
  const empty = () => ({ core: data.map(() => null as number | null), avg: data.map(() => null as number | null), avg2: data.map(() => null as number | null) });
  const def = accountFeatureDef(item.featureId);
  if (!def) return empty();
  if(def.retentionSourceId)item={...item,components:retentionComponents(def.retentionPrefix)};
  let formula: string, usesBtc: boolean;
  try {
    ({ formula, usesBtc } = formulaPlan(item, def.formula));
    if (options.averageHours != null && options.averageHours > 24) {
      const core = researchSeriesNames(item, formula).core;
      let helper = '_display_average_history';
      while (formula.includes(helper)) helper += '_';
      // Only requests sufficient hidden history; no account expression is replaced.
      formula += `\n${helper} = avg(${core}, ${options.averageHours})`;
    }
  } catch { return empty(); }
  if(featureTemplateId(def)===DBL5_ID&&chartInterval(data)!==300000)return empty();
  const visibleLength = data.length, background = isChartComputationEnabled(data);
  if (data.length) {
    const step = chartInterval(data);
    const dblStart=featureTemplateId(def)===DBL5_ID?(def.DBL5_initialization_start??data[0]?.DBL5_initialization_start as number|undefined):undefined;
    const wanted=dblStart===undefined?chartFeatureHistoryBars(item.featureId,period,formula,featureUsesMbiFamily(def)||item.marketEvidence?step/60000:5):Math.max(0,(data[0].timestamp-dblStart)/step);
    const namespace=item.marketEvidence?featureTemplateId(def):featureUsesMbi2(def)||item.featureId==='ctba_12h-bear'?item.featureId:undefined;
    const fetched = options.fetchReference !== false ? chartPrehistory(data,wanted,step,namespace) : EMPTY_HISTORY;
    if(featureTemplateId(def)===DBL5_ID&&options.fetchReference!==false&&!chartPrehistoryReady(data,wanted,step,namespace))return {...empty(),pending:true};

    const history = fetched.length ? fetched : EMPTY_HISTORY;
    if (history.length || background) {
      const revision = dataRevision(data), entries=extendedData.get(data)??new Map<KLineData[],ExtendedChartData>(),cached=entries.get(history);
      if (cached?.history === history && cached.revision === revision) data = cached.data;
      else {
        const sameHistory = cached?.history === history;
        const combined = sameHistory ? cached.data : [...history];
        let changedFrom = 0;
        const changes = chartDataChanges.get(data), generation = chartDataGenerations.get(data);
        if (sameHistory && cached.generation != null && changes?.length && changes[0][0] <= cached.generation + 1) {
          changedFrom = Math.min(combined.length - 1, ...changes.filter(([v]) => v > cached.generation!).map(([, from]) => history.length + from));
        }
        combined.length = history.length + data.length;
        for (let i = 0; i < data.length; i++) combined[history.length + i] = data[i];
        invalidateResearchChartData(combined, changedFrom);
        entries.set(history,{history,revision,generation,data:combined});
        if(entries.size>64)entries.delete(entries.keys().next().value!);
        extendedData.set(data,entries);
        data = combined;
      }
    }
  }
  if (background) enableChartComputation(data, false);
  const visibleOffset = data.length - visibleLength;
  let ref: (number | null)[] | undefined;
  if (usesBtc && data.length) {
    const times = data.map(d => d.timestamp), interval = chartInterval(data);
    if (options.fetchReference !== false) requestBtcReference(times[0], times[times.length - 1] + interval, interval);
    ref = btcClosesAt(times, interval);
  }
  const names = researchSeriesNames(item, formula);
  const generation = chartDataGenerations.get(data);
  const out = chartFeatureSeries(data, item.featureId, period, ref, { formula, variables: [names.core, names.avg, names.avg2,...(item.components??[])], revision: `${dataRevision(data)}:${researchHistoryVersion()}:${usesBtc ? btcReferenceVersion() : 0}`,
    delta: generation == null ? undefined : { revision:generation, changes:chartDataChanges.get(data) ?? [], referenceVersion:usesBtc ? btcReferenceVersion() : 0 } });
  const displayKey = `${visibleLength}|${options.averageHours ?? 24}|${def.scale}|${names.core}`;
  let displays = out ? displaySeriesCache.get(out) : undefined;
  const existing = displays?.get(displayKey);
  if (existing) return existing;
  if (!out && background) {
    const blank = () => Array<number | null>(visibleLength).fill(null);
    return { core: blank(), avg: blank(), avg2: blank(), pending: true };
  }
  const save = (result: DisplaySeries) => {
    if (out) { if (!displays) { displays = new Map(); displaySeriesCache.set(out, displays); } displays.set(displayKey, result); }
    return result;
  };
  const mbiStep = (item.marketEvidence || featureUsesMbiFamily(def) || featureTemplateId(def) === 'ctba') ? chartInterval(data) : 0;
  const scaled = (name: string, multiply = true) => Array.from({ length: visibleLength }, (_, i) => {
    // Live MBI never publishes a candle that has not closed yet.
    if ((item.marketEvidence || featureUsesMbiFamily(def) || featureTemplateId(def) === 'ctba') && (data[visibleOffset + i].cba2Closed === false || data[visibleOffset + i].timestamp + mbiStep > Date.now())) return null;
    const v = out?.vars.get(name)?.[visibleOffset + i]; return v == null ? null : v * (multiply ? def.scale : 1);
  });
  const components=item.components?{components:Object.fromEntries(item.components.map(name=>[name,scaled(name,false)]))}:{};
  // Do not use out.core: the last account expression may itself be the weighted average.
  if (options.averageHours != null) {
    if (options.averageHours === 24) return save({ core: scaled(names.core), avg: scaled(names.avg), avg2: scaled(names.avg2),...components });
    const core = out?.vars.get(names.core) ?? data.map(() => null);
    const average = (kind: 'avg' | 'avg2') => { const values = displayAverage(core, options.averageHours!*(item.marketEvidence?300000/chartInterval(data):1), kind); return Array.from({ length: visibleLength }, (_, i) => { if(item.marketEvidence&&(data[visibleOffset+i].cba2Closed===false||data[visibleOffset+i].timestamp+mbiStep>Date.now()))return null;const v = values[visibleOffset + i]; return Number.isFinite(v) ? v * def.scale : null; }); };
    return save({ core: scaled(names.core), avg: average('avg'), avg2: average('avg2'),...components });
  }
  return save({ core: scaled(names.core), avg: scaled(names.avg), avg2: scaled(names.avg2),...components });
}

/** Only an untouched MBI2 chart default follows the timeframe with n=25; manual hours stay calendar-fixed. */
export function syncMbi2ChartHours<T extends {type:string;period:number;mbi2AutoHours?:boolean}>(configs:readonly T[],definitions:readonly DeepDigFeatureDef[],minutes:number):T[] {
 return configs.map(c=>{const featureId=c.type==='MBI2'?'mbi2':c.type==='MBI2_BEAR'?'mbi2-bear':null;const def=definitions.find(d=>d.id===featureId);return featureId&&c.mbi2AutoHours&&def?.MBI2_T_HOURS==null&&c.period!==25*minutes/60?{...c,period:25*minutes/60}:c;});
}
