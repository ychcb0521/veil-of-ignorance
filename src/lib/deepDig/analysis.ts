import {dbl5AsOf,DBL5_ID,dbl5FieldUnit,type Dbl5Row,type Dbl5Checkpoint} from '@/lib/dbl5m';
import {saveDbl5Checkpoint} from '@/lib/dbl5mPersistence';
import {SBS5M_ID,type SbsRow,type SbsCheckpoint} from '@/lib/sbs5m';
import {saveSbsCheckpoint} from '@/lib/sbs5mPersistence';
import {evaluateSbs5m} from '@/lib/sbs5mEvaluation';
import type {PrsRow,PrsCheckpoint} from '@/lib/prs6h';
import {evaluatePrs6h} from '@/lib/prs6hEvaluation';
import {savePrsCheckpoint} from '@/lib/prs6hPersistence';
import type { AtiRow, AtiStructure } from '@/lib/ati6h';
import { ati6hTickSize } from '@/lib/ati6hMarketData';
import { scanMbi2, finishMbi2Evaluation, recommendMbi2Campaign, type Mbi2StudySample, type Mbi2Evaluation } from './mbi2Evaluation';
import { extractWindow } from '@/lib/deepRsa/window';
import { fetchResearchKlines, intervalMs } from '@/lib/deepRsa/marketData';
import { mbi2NOf } from '@/lib/mbi2';
import { featureTemplateId, featureUsesMbi, featureUsesMbi2 } from '@/lib/deepDig/features';
/**
 * Deep dig · 一个特征值的整套统计：按定义里的公式在每个事件的观察窗上算出特征值，按定义里的分组标准分组，
 * 再做描述统计与推断统计；「规律提取」的默认文字也从这里按结果生成。
 *
 * 分两步运行（用户要求分开）：描述统计 = 取行情、算特征值、分组（collectDeepDigData）；推断统计 = 在那份数据上按命令逐行检验（commands.ts 的 runInference）。
 * 事件与 24h 客观行情取自原 Deep RSA 同一条流水线（collectRunEvents：同币 48h 去重成簇、每簇一个代表、加随机时点），
 * 推断统计的方法与命令见 commands.ts。
 */
import { CODE_VERSION } from '@/lib/deepRsa/campaignLabels';
import {
  DEEP_DIVE_ALPHA, DEEP_DIVE_PRIMARY_H, type DeepDiveTargetKey,
} from '@/lib/deepRsa/deepDive';
import { collectRunEvents, type RunEvent, type RunOptions } from '@/lib/deepRsa/pipeline';
import { chronologicalSplit } from '@/lib/deepRsa/splits';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';
import type { TradeSignal } from '@/lib/signalLibrary';
import { WINDOW_MS } from '@/lib/deepRsa/grouping';
import {
  ati6hDependencyOf, campaignSample, compileFeatureFormula, compileGroups, computeFeatureValues, evaluateOnBars, DEFAULT_INTERVAL, DRIFT_SPEED_DEF, featureWindowMs, formulaVariables, halfLifeOf, intervalOf, avgHoursOf, sampleEventRows, signalSample,
  type DeepDigFeatureDef,
} from '@/lib/deepDig/features';

/** 用户公式算出的值在事件特征里的键。 */
export const DEEP_DIG_KEY = 'deep_dig_x';
/** 公式里起了名的变量在事件特征里的键前缀（deep_dig_var:F）。 */
const VAR_PREFIX = 'deep_dig_var:';

export type DeepDigRowGroup = 'positive' | 'control' | 'other' | 'background';
export const DEEP_DIG_GROUPS: readonly DeepDigRowGroup[] = ['positive', 'control', 'other', 'background'];
export const DEEP_DIG_GROUP_LABEL: Record<DeepDigRowGroup, string> = { positive: '实验组', control: '对照组', other: '其他战役', background: '随机时点' };
/** 组名：样本是信号时「其他」叫「其他信号」。 */
export const groupLabel = (g: DeepDigRowGroup, source?: 'campaigns' | 'signals') => (g === 'other' && source === 'signals' ? '其他信号' : DEEP_DIG_GROUP_LABEL[g]);

/** 结果里留一份运行时用的定义：之后定义改了，界面能提示「这份结果按旧定义算」。 */
export type DefinitionSnapshot = Pick<DeepDigFeatureDef, 'id' | 'name' | 'short' | 'formula' | 'scale' | 'unit' | 'positive' | 'control' | 'source' | 'groupVars' | 'interval' | 'halfLifeHours' | 'avgHours' | 'MBI_N' | 'MBI_Z0' | 'chartTemplate' | 'chartCore' | 'researchWindowHours' | 'MBI2_T_HOURS' | 'MBI2_Z0' | 'MBI2_BAND' | 'MBI2_CONFIRM' | 'ATI6H_parameters' | 'ATI6H_volume_mode' | 'ATI6H_dependency' | 'PRS6H_config' | 'SBS5M_config' | 'SBS5M_dimension' | 'SBS5M_research_symbol' | 'DBL5_config' | 'DBL5_dimension' | 'DBL5_research_symbol' | 'DBL5_initialization_start'>;

export interface DeepDigRow {
  DBL5_details?:Dbl5Row;
  DBL5_checkpoint?:Dbl5Checkpoint;
  SBS5M_details?:SbsRow;
  SBS5M_checkpoint?:SbsCheckpoint;
  PRS6H_details?:PrsRow;
  PRS6H_checkpoint?:Omit<PrsCheckpoint,'points'|'active'|'references'|'obstacles'|'archive'|'event_ids'|'last_row'>;
  ATI6H_details?:AtiRow;
  ATI6H_archive?:AtiStructure[];
  reason?: string;
  id: string;
  symbol: string;
  anchorMs: number;
  group: DeepDigRowGroup;
  /** 这一簇里的战役 id（同币 48h 内的多场合为一簇）；随机时点为空。 */
  memberIds: string[];
  /** 特征值原值（公式最后一句）；算不出来为 null。 */
  v: number | null;
  /** 公式里每个起了名的变量在最后一根的原值（推断统计选因变量用）；旧数据没有。 */
  vars?: Record<string, number | null>;
  /** 观察窗波动率（推断统计里「控制波动」用）；旧数据没有。 */
  vol?: number | null;
  endRet: number | null;
  maxUp: number | null;
  maxDown: number | null;
  period: 'discovery' | 'confirmation' | 'embargo';
}

export interface DeepDigGroupStat {
  group: DeepDigRowGroup;
  n: number;
  mean: number | null;
  sd: number | null;
  median: number | null;
  q25: number | null;
  q75: number | null;
  min: number | null;
  max: number | null;
  sharePositive: number | null;
}

/**
 * 描述统计的运行结果：取行情、按公式算特征值、按分组标准分组。
 * 【用户要求】2026-10-16「描述统计和推断统计的运行要分开」：这一步要联网取 K 线（1–3 分钟）；推断统计只用这里的数据。
 */
export interface DeepDigData {
  DBL5_diagnostics?:Record<string,{available:number;missing:number;event_counts:Record<string,number>;initialization_start:number|null;data_checksum:string}>;
  SBS5M_evaluation?:ReturnType<typeof evaluateSbs5m>[];
  PRS6H_evaluation?:ReturnType<typeof evaluatePrs6h>[];
  mbi2Evaluation?:Mbi2Evaluation;
  /** 当前推断输入的相对进场取样时点；未指定 = 进场。 */
  sampleOffsetMs?: number;
  definition: DefinitionSnapshot;
  codeVersion: string;
  startedAt: number;
  finishedAt: number;
  coverage: {
    unsupportedStocks?: number;
    campaigns: number;
    clusters: number;
    failed: number;
    lowCoverage: number;
    outcomeMissing: number;
    featureMissing: number;
    discovery: number;
    confirmation: number;
    embargoed: number;
  };
  rows: DeepDigRow[];
  groups: DeepDigGroupStat[];
}

import type { DeepDigInference } from '@/lib/deepDig/commands';
import { computeEventSeries, seriesOffsets, seriesRangeOf, type DeepDigSeries } from '@/lib/deepDig/series';

export type { DeepDigInference };

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function snapshotOf(def: DeepDigFeatureDef): DefinitionSnapshot {
  const { id, name, short, formula, scale, unit, positive, control } = def;
  return { ...(featureTemplateId(def)===DBL5_ID?{DBL5_config:def.DBL5_config,DBL5_dimension:def.DBL5_dimension,DBL5_research_symbol:def.DBL5_research_symbol,DBL5_initialization_start:def.DBL5_initialization_start}:{}), ...(featureTemplateId(def)===SBS5M_ID?{SBS5M_config:def.SBS5M_config,SBS5M_dimension:def.SBS5M_dimension,SBS5M_research_symbol:def.SBS5M_research_symbol}:{}), ...(featureTemplateId(def)==='prs6h'?{PRS6H_config:def.PRS6H_config}:{}), ...(featureTemplateId(def)==='ati6h'?{ATI6H_parameters:def.ATI6H_parameters,ATI6H_volume_mode:def.ATI6H_volume_mode,ATI6H_dependency:def.ATI6H_dependency}:{}), id, name, short, formula, scale, unit, positive, control, source: def.source ?? 'campaigns', groupVars: 2, interval: intervalOf(def), halfLifeHours: halfLifeOf(def), avgHours: avgHoursOf(def), ...(featureUsesMbi2(def)?{MBI2_T_HOURS:def.MBI2_T_HOURS,MBI2_Z0:def.MBI2_Z0,MBI2_BAND:def.MBI2_BAND,MBI2_CONFIRM:def.MBI2_CONFIRM}:{}), ...(featureUsesMbi(def) ? { MBI_N: def.MBI_N, MBI_Z0: def.MBI_Z0 } : {}), ...(def.chartTemplate ? { chartTemplate: def.chartTemplate } : {}), ...(def.chartCore ? { chartCore: def.chartCore } : {}), ...(def.researchWindowHours != null ? {researchWindowHours:def.researchWindowHours} : {}) };
}

export function groupOf(e: Pick<RunEvent, 'kind' | 'label'>): DeepDigRowGroup {
  if (e.kind === 'background') return 'background';
  return e.label === 'positive' ? 'positive' : e.label === 'control' ? 'control' : 'other';
}

export function describeGroup(group: DeepDigRowGroup, values: readonly number[]): DeepDigGroupStat {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = n ? sorted.reduce((s, v) => s + v, 0) / n : null;
  const sd = mean != null && n > 1 ? Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
  return {
    group, n, mean, sd, median: quantile(sorted, 0.5), q25: quantile(sorted, 0.25), q75: quantile(sorted, 0.75),
    min: n ? sorted[0] : null, max: n ? sorted[n - 1] : null, sharePositive: n ? sorted.filter(v => v > 0).length / n : null,
  };
}

/** 描述统计（纯计算）：事件 → 明细行（含所在时段）与各组描述。特征值在 featuresByH[6][key]。 */
export function describeDeepDig(events: readonly RunEvent[], key = DEEP_DIG_KEY): Pick<DeepDigData, 'rows' | 'groups'> & { split: { discovery: number; confirmation: number; embargoed: number } } {
  const split = chronologicalSplit(events);
  const periodOf = new Map<string, DeepDigRow['period']>();
  [...split.train, ...split.val].forEach(e => periodOf.set(e.id, 'discovery'));
  split.test.forEach(e => periodOf.set(e.id, 'confirmation'));
  split.embargoed.forEach(e => periodOf.set(e.id, 'embargo'));
  const rows: DeepDigRow[] = events.map(e => {
    const f = e.featuresByH[DEEP_DIVE_PRIMARY_H];
    const v = f?.[key];
    const vol = f?.vol_w;
    const vars: Record<string, number | null> = {};
    for (const [k, x] of Object.entries(f ?? {})) if (k.startsWith(VAR_PREFIX)) vars[k.slice(VAR_PREFIX.length)] = finite(x) ? x : null;
    return {
      id: e.id, symbol: e.symbol, anchorMs: e.anchorMs, group: groupOf(e), memberIds: e.memberIds ?? [],
      v: finite(v) ? v : null, vol: finite(vol) ? vol : null, vars,
      endRet: e.endRet, maxUp: e.maxUp, maxDown: e.maxDown, period: periodOf.get(e.id) ?? 'discovery',
    };
  });
  return {
    rows,
    groups: DEEP_DIG_GROUPS.map(g => describeGroup(g, rows.filter(r => r.group === g).map(r => r.v).filter(finite))),
    split: { discovery: split.train.length + split.val.length, confirmation: split.test.length, embargoed: split.embargoed.length },
  };
}

/**
 * 描述统计按公式里的某个变量看：每行的值换成这个变量，分组统计重算。
 * 【用户要求】2026-10-17「时间序列图和分组的数据表有矛盾，分组中的数据，要随着时间序列图中选取的变量而动」。
 * name 为 null（公式最后一句）或数据里没有这个变量（旧数据）→ 原样返回。
 */
export function viewForVariable(data: DeepDigData, name: string | null): DeepDigData {
  if (name == null || !data.rows.some(r => r.vars && name in r.vars)) return data;
  const rows = data.rows.map(r => {
    const x = r.vars?.[name];
    return { ...r, v: finite(x) ? x : null };
  });
  return { ...data,...(featureTemplateId(data.definition)===DBL5_ID&&dbl5FieldUnit(name)?{definition:{...data.definition,unit:dbl5FieldUnit(name)!}}:{}), rows, groups: DEEP_DIG_GROUPS.map(g => describeGroup(g, rows.filter(r => r.group === g).map(r => r.v).filter(finite))) };
}

/** 旧数据没有波动率：推断统计的「控制波动」算不了，要先重跑描述统计。 */
export const dataSupportsInference = (data: Pick<DeepDigData, 'rows'>) => data.rows.every(r => r.vol !== undefined);

type CollectOptions = Pick<RunOptions, 'fetchFn' | 'signal' | 'onProgress' | 'concurrency' | 'backgroundCap'> & {
  /** 样本来源是信号库时用的信号（信号库的当前内容）。 */
  signals?: readonly TradeSignal[];
};

/** 描述统计的运行：按定义分组 → 取行情、按公式算特征值 → 描述。定义写错时直接抛出（界面保存时已检查过）。 */
export async function collectDeepDigData(report: CampaignGroupReport, def: DeepDigFeatureDef, options: CollectOptions = {}): Promise<DeepDigData> {
  return (await collectDeepDigRun(report, def, options)).data;
}

/** 同上，另外带回每个事件的时间序列曲线（数据量大，另存在本机 IndexedDB）。 */
export async function collectDeepDigRun(
  report: CampaignGroupReport,
  def: DeepDigFeatureDef,
  options: CollectOptions = {},
): Promise<{ data: DeepDigData; series: DeepDigSeries }> {
  const startedAt = Date.now();
  if(featureTemplateId(def)==='ati6h'&&!def.ATI6H_dependency)def={...def,ATI6H_dependency:ati6hDependencyOf(def)};
  const DBL5_windows:NonNullable<DeepDigSeries['DBL5_windows']>={};
  const dblDetails=new Map<string,{row:Dbl5Row;checkpoint:Dbl5Checkpoint}>();
  const DBL5_diagnostics:NonNullable<DeepDigData['DBL5_diagnostics']>={};
  const SBS5M_windows:NonNullable<DeepDigSeries['SBS5M_windows']>={};
  const sbsDetails=new Map<string,{row:SbsRow;checkpoint:SbsCheckpoint}>();
  const SBS5M_evaluation:ReturnType<typeof evaluateSbs5m>[]=[];
  const prsDetails=new Map<string,{row:PrsRow;checkpoint:PrsCheckpoint}>();
  const PRS6H_windows:NonNullable<DeepDigSeries['PRS6H_windows']>={};
  const PRS6H_evaluation:ReturnType<typeof evaluatePrs6h>[]=[];
  const prsTick=new Map<string,number|null>();
  const atiDetails=new Map<string,{row:AtiRow;archive:AtiStructure[]}>();
  const ATI6H_windows:NonNullable<DeepDigSeries['ATI6H_windows']>={};
  // 带上 id：CBA-2 的观察窗（48 + avgh + 1 小时）与周期按 id 特判，缺了 id 曲线会按普通 48 小时截取，进场前的点全缺
  const params = { ...def, interval: intervalOf(def), halfLifeHours: halfLifeOf(def), avgHours: avgHoursOf(def) };
  const range = seriesRangeOf(def);
  const offsets = seriesOffsets(range);
  const { names, result } = formulaVariables(def.formula);
  const byEvent: DeepDigSeries['byEvent'] = {};
  const mbi2Tuning=featureUsesMbi2(def)&&def.chartCore!=='MBI2_bear';
  const mbi2Samples:Mbi2StudySample[]=[];
  let scanHistory=mbi2Tuning?Math.max(featureWindowMs(def),48*3600000+5*mbi2NOf({MBI2_T_HOURS:48},intervalMs(intervalOf(def))/60000)*intervalMs(intervalOf(def))):featureWindowMs(def);
  const anchorWindows: NonNullable<DeepDigSeries['anchorWindows']> = {};
  const compiled = compileFeatureFormula(def.formula);
  const source = def.source ?? 'campaigns';
  const groups = compileGroups(def.positive, def.control, source);
  // 【用户要求】样本可以是交易战役，也可以是信号库的信号（时间点 = 那条信号的时间）
  const allSamples = source === 'signals' ? (options.signals ?? []).map(signalSample) : report.rows.map(campaignSample);
  const researchSymbol=featureTemplateId(def)===DBL5_ID?def.DBL5_research_symbol:featureTemplateId(def)===SBS5M_ID?def.SBS5M_research_symbol:undefined;
  const samples=researchSymbol?allSamples.filter(s=>s.symbol===researchSymbol):allSamples;
  if(featureTemplateId(def)===DBL5_ID){
    if(researchSymbol&&!samples.length)throw Error('DBL-5 所选标的没有样本，请重新选择。');
    if(((def.DBL5_dimension??'price')==='price'||[...compiled.program.inputs].some(n=>/^DBL5_raw_(value|upper)$/.test(n)))&&new Set(samples.filter(s=>!s.excluded&&!s.unsupportedReason).map(s=>s.symbol)).size>1)throw Error('DBL-5 下轨价格只按单一品种研究；跨品种请选择距离、箱宽基点或确认年龄。');
    if(def.DBL5_initialization_start!==undefined)scanHistory=samples.reduce((max,s)=>Math.max(max,(s.anchorMs??def.DBL5_initialization_start!)-def.DBL5_initialization_start!),scanHistory);
  }
  if(featureTemplateId(def)===SBS5M_ID&&def.SBS5M_research_symbol&&!samples.length)throw Error('所选研究标的没有可用样本，请重新选择。');
  if(featureTemplateId(def)===SBS5M_ID&&((def.SBS5M_dimension??'price')==='price'||[...compiled.program.inputs].some(n=>/^SBS5M_raw_(value|support_price|box_top|invalidation_price|candidate_support_price|candidate_box_top|candidate_invalidation_price)$/.test(n)))&&new Set(samples.filter(s=>!s.unsupportedReason&&!s.excluded).map(s=>s.symbol)).size>1)throw Error('SBS-5M 支撑价有价格单位，不能混合统计不同品种。请选择单一品种，或选择 SBS·证据 / 距离 / 台阶。');
  const collected = await collectRunEvents(report, {
    ...options,
    eventRows: sampleEventRows(samples, groups),
    // 信号不合簇：每条信号（有时间、有评级）都单独是一个事件，跟有没有交易战役无关
    cluster: source !== 'signals',
    // 【用户要求】周期、半衰期可选：不是默认（5m、48h 观察窗）时另取这个周期的 K 线算特征值
    ...(intervalOf(def) !== DEFAULT_INTERVAL || featureWindowMs(def) !== WINDOW_MS || featureTemplateId(def)===DBL5_ID ? { featureKlines: { interval: intervalOf(def), windowMs: scanHistory, ...(['ati6h','prs6h',SBS5M_ID,DBL5_ID].includes(featureTemplateId(def)??'')?{strictAmounts:true}:{}) } } : {}),
    ...(['ati6h','prs6h',SBS5M_ID,DBL5_ID].includes(featureTemplateId(def)??'')?{prepareFeatureBars:async(symbol:string,bars:readonly import('@/lib/deepRsa/window').ResearchBar[])=>{
      const tick=await ati6hTickSize(symbol,options.fetchFn,options.signal);
      prsTick.set(symbol,tick);return bars.map(bar=>({...bar,ATI6H_tick_size:tick,PRS6H_tick_size:tick,DBL5_tick_size:tick}));
    }}:{}),
    seriesRange: range,
    // 【用户要求】公式用到 CB（同时段 BTCUSDT 收盘价，CBI-2 剔除 BTC 的动量）时另取 BTC 的 K 线
    ...(compiled.usesBtc ? { referenceSymbol: 'BTCUSDT' } : {}),
    // 只用得到波动率（推断统计的「控制波动」）：不算 Deep RSA 的整套表征
    volatilityOnlyAt: DEEP_DIVE_PRIMARY_H,
    extraFeatures: (window, ctx) => {
      const ownWindow=featureUsesMbi2(def)&&window?extractWindow(window.bars,ctx.anchorMs,featureWindowMs(def),intervalMs(intervalOf(def))):window;
      const scopedParams=featureTemplateId(def)===DBL5_ID?{...params,DBL5_symbol:ctx.symbol,DBL5_tick_size:prsTick.get(ctx.symbol)}:featureTemplateId(def)===SBS5M_ID?{...params,SBS5M_symbol:ctx.symbol,SBS5M_tick_size:prsTick.get(ctx.symbol)}:featureTemplateId(def)==='prs6h'?{...params,PRS6H_symbol:ctx.symbol}:params;
      const inputWindow=['prs6h',SBS5M_ID,DBL5_ID].includes(featureTemplateId(def)??'')&&window&&ctx.bars?{...window,bars:ctx.bars.filter(b=>b.openTime+intervalMs(intervalOf(def))<=ctx.anchorMs)}:ownWindow;
      const { value, vars } = computeFeatureValues(inputWindow, compiled, scopedParams);
      if(mbi2Tuning&&ctx.bars)mbi2Samples.push({id:ctx.id,anchorMs:ctx.anchorMs,group:'other',bars:ctx.bars.filter(b=>b.openTime+intervalMs(intervalOf(def))<=ctx.anchorMs)});
      if(featureTemplateId(def)===DBL5_ID&&inputWindow){
        const out=evaluateOnBars(inputWindow.bars,compiled,scopedParams),rows=out.DBL5_details??[],row=dbl5AsOf(rows,ctx.anchorMs),checkpoint=out.DBL5_checkpoint;
        if(row&&checkpoint){dblDetails.set(ctx.id,{row,checkpoint});void saveDbl5Checkpoint(checkpoint);}
        const begin=ctx.anchorMs-(def.researchWindowHours??6)*3600000;
        DBL5_windows[ctx.id]={checkpoint,rows:rows.filter(r=>r.at>begin),prices:inputWindow.bars.filter(b=>b.openTime+300000>begin).map(b=>({time:b.openTime+300000,close:b.close}))};
        const events=[...new Map(rows.flatMap(r=>r.events).map(e=>[e.id,e])).values()];
        DBL5_diagnostics[ctx.id]={available:rows.filter(r=>r.darvas_5m_available).length,missing:rows.filter(r=>!r.darvas_5m_available).length,event_counts:Object.fromEntries([...new Set(events.map(e=>e.type))].map(t=>[t,events.filter(e=>e.type===t).length])),initialization_start:checkpoint?.initialization_start??null,data_checksum:checkpoint?.data_checksum??''};
      }
      if(featureTemplateId(def)===SBS5M_ID&&inputWindow){
        const out=evaluateOnBars(inputWindow.bars,compiled,scopedParams),row=out.SBS5M_details?.at(-1),checkpoint=out.SBS5M_checkpoint;
        if(row&&checkpoint){sbsDetails.set(ctx.id,{row,checkpoint});void saveSbsCheckpoint(checkpoint);}
        const begin=ctx.anchorMs-(def.researchWindowHours??6)*3600000;
        SBS5M_windows[ctx.id]={checkpoint,rows:(out.SBS5M_details??[]).filter(r=>(r.at??0)>begin),prices:inputWindow.bars.filter(b=>b.openTime+300000>begin).map(b=>({time:b.openTime+300000,close:b.close}))};
        SBS5M_evaluation.push(evaluateSbs5m(out.SBS5M_details??[],ctx.outcomeBars??[]));
      }
      if(featureTemplateId(def)==='prs6h'&&inputWindow){
        const out=evaluateOnBars(inputWindow.bars,compiled,scopedParams),row=out.PRS6H_details?.at(-1),checkpoint=out.PRS6H_checkpoint;
        if(row&&checkpoint){prsDetails.set(ctx.id,{row,checkpoint});void savePrsCheckpoint(checkpoint);}
        const begin=ctx.anchorMs-6*3600000;
        PRS6H_windows[ctx.id]={checkpoint,rows:(out.PRS6H_details??[]).filter(r=>r.PRS6H_at>begin),prices:inputWindow.bars.filter(b=>b.openTime+intervalMs(intervalOf(def))>begin).map(b=>({time:b.openTime+intervalMs(intervalOf(def)),close:b.close}))};
        if(ctx.bars)PRS6H_evaluation.push(evaluatePrs6h(out.PRS6H_details??[],ctx.outcomeBars,5));
      }
      if(featureTemplateId(def)==='ati6h'&&window){
        const out=evaluateOnBars(window.bars,compiled,params);
        const row=out.ATI6H_details?.at(-1);
        if(row)atiDetails.set(ctx.id,{row,archive:out.ATI6H_archive??[]});
        const begin=ctx.anchorMs-(def.ATI6H_parameters?.WINDOW_HOURS??6)*3600000;
        ATI6H_windows[ctx.id]={rows:(out.ATI6H_details??[]).filter(row=>row.ATI6H_at>begin),prices:window.bars.filter(bar=>bar.openTime+intervalMs(intervalOf(def))>begin).map(bar=>({time:bar.openTime+intervalMs(intervalOf(def)),close:bar.close}))};
      }
      if(featureTemplateId(def)==='ctba' && window){
        const out=evaluateOnBars(window.bars,compiled,params);
        const windowHours=def.researchWindowHours ?? 48, slots=Math.round(windowHours*12);
        const startMs=Math.floor(ctx.anchorMs/300000)*300000-windowHours*3600000;
        const selected=window.bars.map((bar,i)=>({bar,i})).filter(({bar})=>bar.openTime>=startMs);
        const values=Object.fromEntries(['CTBA','T','M','F','no_trade','data_complete',...(def.id==='ctba_12h-bear'?['CTBA_12H_bear']:[])].map(name=>{
          const dense=new Float64Array(slots).fill(NaN),source=out.vars.get(name);
          if(source instanceof Float64Array)for(const {bar,i} of selected){const k=Math.round((bar.openTime-startMs)/300000);if(k>=0&&k<slots)dense[k]=source[i];}
          return [name,dense];
        }));
        anchorWindows[ctx.id]={startMs,stepMs:300000,values};
      }
      if (ctx.bars) {
        const s = computeEventSeries(ctx.bars, ctx.anchorMs, compiled, scopedParams, names, offsets);
        if (s) byEvent[ctx.id] = s;
      }
      return { [DEEP_DIG_KEY]: value, ...Object.fromEntries(Object.entries(vars).map(([k, x]) => [VAR_PREFIX + k, x])) };
    },
  });
  const described = describeDeepDig(collected.events);
  for(const row of described.rows){const dbl=dblDetails.get(row.id);if(dbl){row.DBL5_details=dbl.row;row.DBL5_checkpoint=dbl.checkpoint;}const sbs=sbsDetails.get(row.id);if(sbs){row.SBS5M_details=sbs.row;row.SBS5M_checkpoint=sbs.checkpoint;}const prs=prsDetails.get(row.id);if(prs){row.PRS6H_details=prs.row;const {points,active,references,obstacles,archive,event_ids,last_row,...metadata}=prs.checkpoint;row.PRS6H_checkpoint=metadata;}const detail=atiDetails.get(row.id);if(detail){row.ATI6H_details=detail.row;row.ATI6H_archive=detail.archive;}}
  // Kept in Other for visibility/counts, but never enter the price-fetching event rows or inference.
  const unsupported=samples.filter(s=>s.unsupportedReason);
  described.rows.push(...unsupported.map(s=>({id:s.id,symbol:s.symbol,anchorMs:s.anchorMs??0,group:'other' as const,memberIds:[s.id],v:null,vol:null,vars:{},endRet:null,maxUp:null,maxDown:null,period:'discovery' as const,reason:s.unsupportedReason})));
  options.onProgress?.({ stage: 'done', done: 1, total: 1 });
  const finishedAt = Date.now();
  const data: DeepDigData = {
    ...(featureTemplateId(def)===DBL5_ID?{DBL5_diagnostics}:{}),
    ...(SBS5M_evaluation.length?{SBS5M_evaluation}:{}),
    ...(PRS6H_evaluation.length?{PRS6H_evaluation}:{}),
    definition: snapshotOf(def),
    codeVersion: CODE_VERSION,
    startedAt,
    finishedAt,
    coverage: {
      ...(unsupported.length ? {unsupportedStocks: unsupported.length} : {}),
      campaigns: collected.campaigns,
      clusters: collected.clusters,
      failed: collected.failed.length,
      lowCoverage: collected.lowCoverage,
      outcomeMissing: collected.outcomeMissing,
      featureMissing: described.rows.filter(r => r.v == null).length,
      ...described.split,
    },
    rows: described.rows,
    groups: described.groups,
  };
  if(mbi2Tuning){
    const minutes=intervalMs(intervalOf(def))/60000,byId=new Map(data.rows.map(r=>[r.id,r.group]));
    const scans=scanMbi2(mbi2Samples.map(s=>({...s,group:byId.get(s.id)??'other'})),data.definition,minutes);
    const recommendations=[];
    if(source==='campaigns')for(const row of report.rows.filter(r=>r.grouping.group==='positive')){
      if(row.anchorMs==null||row.endMs==null||row.endMs<=row.anchorMs){recommendations.push({campaignId:row.campaignId,delta:null,nMin:null,ceilN:null,hours:null,reason:'missing' as const});continue;}
      try{
        const bars=await fetchResearchKlines(row.symbol,row.anchorMs,row.endMs,options.fetchFn,options.signal,intervalOf(def));
        recommendations.push(recommendMbi2Campaign(row.campaignId,bars.filter(b=>b.openTime>=row.anchorMs!&&b.openTime+minutes*60000<=row.endMs!),minutes,row.direction==='main_short',def));
      }catch(error){if(options.signal?.aborted)throw error;recommendations.push({campaignId:row.campaignId,delta:null,nMin:null,ceilN:null,hours:null,reason:'missing' as const});}
    }
    data.mbi2Evaluation=finishMbi2Evaluation(scans,recommendations,data.definition,minutes);
  }
  return { data, series: { DBL5_windows, SBS5M_windows, PRS6H_windows, ATI6H_windows, finishedAt, historyMs: featureWindowMs(params), offsets, names, result, byEvent, ...(featureTemplateId(def)==='ctba'?{anchorWindows}:{}) } };
}

// ===================== 规律提取：按结果生成的默认文字 =====================

export const fmtValue = (def: Pick<DefinitionSnapshot, 'scale'> & Partial<Pick<DefinitionSnapshot,'chartTemplate'>>, v: number | null | undefined, d = 2) => (finite(v) ? def.chartTemplate===DBL5_ID?Number((v*def.scale).toPrecision(12)).toString():(v * def.scale).toFixed(d) : '—');
export const pText = (p: number | null | undefined) => (!finite(p) ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3));
/** 「p = 0.012」或「p < 0.001」。 */
const pEq = (p: number | null | undefined) => (finite(p) && p < 0.001 ? 'p < 0.001' : `p = ${pText(p)}`);
const pct = (v: number | null | undefined, d = 0) => (finite(v) ? `${(v * 100).toFixed(d)}%` : '—');
const TARGET_NAME: Record<DeepDiveTargetKey, string> = { endRet: '24h 期末收益', maxUp: '24h 最大涨幅', maxDown: '24h 最大跌幅' };

/**
 * 「规律提取」的默认内容：一行一条，全部来自这次运行的统计结果；用户可以手动改。
 * 措辞按结果走：显著与否、方向、是否只是波动，都由数字决定，不预设结论。
 */
export function deepDigRules(data: DeepDigData, inference: DeepDigInference | null): string[] {
  const def = data.definition;
  const result = data;
  const X = def.short || '特征值';
  const val = (v: number | null | undefined) => fmtValue(def, v);
  /** 推断统计里的值已经是显示单位。 */
  const shown = (v: number | null | undefined) => (finite(v) ? v.toFixed(2) : '—');
  const blocks = inference?.blocks ?? [];
  const g = Object.fromEntries(result.groups.map(s => [s.group, s])) as Record<DeepDigRowGroup, DeepDigGroupStat>;
  const pos = g.positive; const ctl = g.control;
  const lines: string[] = [];
  if (!pos?.n || !ctl?.n || pos.median == null || ctl.median == null) {
    lines.push('实验组或对照组没有数据，暂时提取不出规律。');
    return lines;
  }
  const lower = pos.median < ctl.median;
  lines.push(`实验组进场时 ${X} 的中位数 ${val(pos.median)}，对照组 ${val(ctl.median)}${def.unit ? `（${def.unit}）` : ''}：实验组${lower ? '更低' : '更高'}。`);

  // 推断统计的因变量换成了公式里别的变量（X = F）时，推断那几句用它的名字
  const XI = inference?.target ?? X;
  const isMain = (b: { a?: string; b?: string; x?: string; call: string }) => /^\w+\(\s*X\s*[,)]/.test(b.call);
  const tb = blocks.find(b => b.kind === 'ttest' && b.a === '实验组' && b.b === '对照组' && isMain(b));
  if (tb?.kind === 'ttest' && finite(tb.result.p)) {
    const t = tb.result;
    lines.push(`t 检验：均值差 ${shown(t.diff)}（95% 区间 ${t.ci95 ? `${shown(t.ci95[0])} ~ ${shown(t.ci95[1])}` : '—'}），${pEq(t.p)}，${t.p < DEEP_DIVE_ALPHA ? '差异显著' : '差异不显著'}（α = 0.05）。`);
  }
  const mb = blocks.find(b => b.kind === 'mannwhitney' && b.a === '实验组' && b.b === '对照组' && isMain(b));
  if (mb?.kind === 'mannwhitney' && finite(mb.auc)) {
    const sep = mb.auc < 0.5 ? 1 - mb.auc : mb.auc;
    lines.push(`排名比较：AUC ${mb.auc.toFixed(2)}，${pEq(mb.p)}——随机挑一场实验组和一场对照组，实验组 ${XI} ${mb.auc < 0.5 ? '更低' : '更高'}的概率约 ${pct(sep)}。`);
  }

  const sb = blocks.find(b => b.kind === 'spearman' && b.x === 'X');
  const assoc = (k: string) => (sb?.kind === 'spearman' ? sb.rows.find(r => r.target === k) : undefined);
  const end = assoc('endRet'); const up = assoc('maxUp'); const down = assoc('maxDown');
  if (end && finite(end.rho)) {
    const conf = end.confirmation;
    lines.push(conf?.verdict === '已验证'
      ? `${XI} 能预测之后 24h 的方向：发现集 ρ = ${end.rho.toFixed(2)}，确认集复现${conf.survivesControl === false ? '，但控制波动率后不成立' : conf.survivesControl ? '，控制波动率后仍成立' : ''}。`
      : `${XI} 不能预测之后 24h 的方向：与${TARGET_NAME.endRet} ρ = ${end.rho.toFixed(2)}（Holm ${pEq(end.pHolm)}）${end.pHolm < DEEP_DIVE_ALPHA ? '，确认集没有复现' : ''}。`);
  }
  if (up && down && finite(up.rho) && finite(down.rho) && up.pHolm < DEEP_DIVE_ALPHA && down.pHolm < DEEP_DIVE_ALPHA && Math.sign(up.rho) !== Math.sign(down.rho)) {
    lines.push(`${XI} 与 24h 最大涨幅（ρ = ${up.rho.toFixed(2)}）、最大跌幅（ρ = ${down.rho.toFixed(2)}）同时相关：${XI} 大主要意味着之后波动大，不代表方向。`);
  }
  for (const b of blocks) {
    if (b.kind === 'regress') {
      const xt = b.terms.find(t => t.term === 'X');
      if (xt && finite(xt.p)) lines.push(`${b.title}（${b.call}）：${XI} 的系数 ${xt.beta.toFixed(3)}，${pEq(xt.p)}，R² = ${finite(b.r2) ? b.r2.toFixed(3) : '—'}${xt.p < DEEP_DIVE_ALPHA ? '' : '，不显著'}。`);
    } else if (b.kind === 'anova' && finite(b.p)) {
      lines.push(`方差分析（${b.groups.map(x => x.name).join(' / ')}）：F = ${b.f.toFixed(2)}，${pEq(b.p)}，η² = ${b.eta2.toFixed(3)}，${b.p < DEEP_DIVE_ALPHA ? '各组均值有差异' : '各组均值差异不显著'}。`);
    } else if (b.kind === 'rsa' && finite(b.r)) {
      lines.push(`RSA（${b.features.join(' + ')} ↔ ${b.target}）：r = ${b.r.toFixed(3)}，${pEq(b.p)}，${b.p < DEEP_DIVE_ALPHA ? '特征相近的事件，' + (b.target === '组别' ? '组别也更可能相同' : '结果也更相近') : '看不出特征相近与' + (b.target === '组别' ? '组别' : '结果') + '相近的对应'}。`);
    } else if (b.kind === 'ml' && finite(b.auc)) {
      lines.push(`${b.title}（${b.features.join(' + ')} → ${b.target}）：样本外 AUC ${b.auc.toFixed(2)}，${pEq(b.p)}，${b.p < DEEP_DIVE_ALPHA ? '能在没见过的战役上区分两组' : '在没见过的战役上分不开两组'}。`);
    }
  }

  // 可操作的做法：以对照组中位数为界（对照组按定义约一半在界内），看实验组有多少落在同一侧
  const cut = ctl.median;
  const side = (v: number) => (lower ? v <= cut : v >= cut);
  const share = (group: DeepDigRowGroup) => {
    const xs = result.rows.filter(r => r.group === group && r.v != null).map(r => r.v!);
    return xs.length ? xs.filter(side).length / xs.length : null;
  };
  lines.push(`做法：进场前看 ${X}，${lower ? '≤' : '≥'} ${val(cut)}${def.unit ? ` ${def.unit}` : ''}（对照组中位数）时更像实验组——实验组 ${pct(share('positive'))} 满足，对照组 ${pct(share('control'))} 满足。`);
  const pickedAfter = def.id === DRIFT_SPEED_DEF.id && def.formula.trim() === DRIFT_SPEED_DEF.formula.trim()
    ? `；${X} 是看过三项结果后单独挑出来的，p 值偏乐观` : '';
  if (!inference) lines.push('推断统计还没运行（或数据、删减、命令改过后没重跑）：运行后这里会补上检验的结论。');
  lines.push(`局限：实验组只有 ${pos.n} 个、对照组 ${ctl.n} 个，结论来自同一批数据${pickedAfter}，要用之后新产生的战役确认。`);
  return lines;
}

/**
 * 【用户要求】2026-10-16「描述统计的数据那里，我希望可以整行删减（因为有的数据归类不准确）」：
 * 删掉的行（按事件 id）不进各组描述、推断统计与规律提取；明细里仍可查看、恢复。
 */
export function applyExclusions(data: DeepDigData, excluded: readonly string[]): DeepDigData {
  if (!excluded.length) return data;
  const drop = new Set(excluded);
  const rows = data.rows.filter(r => !drop.has(r.id));
  if (rows.length === data.rows.length) return data;
  return { ...data, rows, groups: DEEP_DIG_GROUPS.map(g => describeGroup(g, rows.filter(r => r.group === g).map(r => r.v).filter(finite))) };
}

/** 极端值的判定倍数：组内低于 Q1 − k·IQR 或高于 Q3 + k·IQR（箱线图的标准，k = 1.5）。 */
export const OUTLIER_IQR_K = 1.5;
export interface DeepDigOutlier {
  id: string;
  group: DeepDigRowGroup;
  v: number;
  side: 'high' | 'low';
}
/**
 * 【用户要求】2026-10-18「描述分析中指出极端值是哪几个」：各组内按四分位距判（组内不足 4 个值不判），
 * 用这份数据当前的读数（变量、时刻已换好）。按组、再按偏离程度从大到小排。
 */
export function findOutliers(data: Pick<DeepDigData, 'rows' | 'groups'>): DeepDigOutlier[] {
  const out: (DeepDigOutlier & { dist: number })[] = [];
  for (const s of data.groups) {
    if (s.n < 4 || !finite(s.q25) || !finite(s.q75)) continue;
    const iqr = s.q75 - s.q25;
    const lo = s.q25 - OUTLIER_IQR_K * iqr;
    const hi = s.q75 + OUTLIER_IQR_K * iqr;
    for (const r of data.rows) {
      if (r.group !== s.group || !finite(r.v)) continue;
      if (r.v > hi) out.push({ id: r.id, group: s.group, v: r.v, side: 'high', dist: (r.v - hi) / (iqr || 1) });
      else if (r.v < lo) out.push({ id: r.id, group: s.group, v: r.v, side: 'low', dist: (lo - r.v) / (iqr || 1) });
    }
  }
  const order = new Map(DEEP_DIG_GROUPS.map((g, i) => [g, i]));
  return out.sort((a, b) => order.get(a.group)! - order.get(b.group)! || b.dist - a.dist).map(o => ({ id: o.id, group: o.group, v: o.v, side: o.side }));
}

/** 推断统计用的是哪些删减：与现在不同 → 提示重跑。 */
export const exclusionKey = (data: Pick<DeepDigData, 'rows'>, excluded: readonly string[]) => {
  const ids = new Set(data.rows.map(r => r.id));
  return excluded.filter(id => ids.has(id)).sort().join(',');
};
