import {sbsHistoryBars} from '@/lib/sbs5m';
import {saveSbsCheckpoint} from '@/lib/sbs5mPersistence';
import {savePrsCheckpoint} from '@/lib/prs6hPersistence';
import {PRS6H_ID} from '@/lib/prs6h';
import {ati6hDependencyOf} from '@/lib/deepDig/features';
import {peekAti6hTickSize,ati6hMarketVersion} from '@/lib/ati6hMarketData';
import { featureTemplateId, featureUsesMbi, featureUsesMbi2, featureUsesMbiFamily } from '@/lib/deepDig/features';
/**
 * 特征值的唯一来源：K 线图指标、渔、Deep dig 都读同一份定义（Deep dig 里账号保存的那份，没改过就是内置的）。
 * 【用户要求】2026-10-19「公式要统一。指标类标、捕鱼算法、dig 中的要保持一致。尤其是 avg，不能重复 avg」
 * 「你要保证内在统一」。
 *
 * 核心值 X：公式最后一句；但末尾若是「名字 = avg(前面某个变量, h)」这种纯均值行（如 avg_CBI2 = avg(CBI2, 24)），
 * 它只是在 X 上再取均值，X 取被平均的那个变量。均值统一由使用方套一次：K 线图的 avg 副图、渔的 avg(X, H)；
 * 不会出现「均值的均值」。Deep dig 自己的结果仍按公式写的算（写了 avg 行就是 avg(X, h)，与渔 H = h 时同一个量）。
 */
import { isChartComputationEnabled, requestChartComputation } from './chartComputeClient';
import type { KLineData } from 'klinecharts';
import { BUILTIN_FEATURES, compileFeatureFormula, evaluateOnBars, halfLifeOf, avgHoursOf, featureParams, FEATURES_KEY, mergeFeatureDefs, type CompiledFeature, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { mbiNOf } from '@/lib/mbi';
import { mbi2HoursOf, mbi2NOf, mbi2BandOf, mbi2ConfirmOf, mbi2MinutesOf } from '@/lib/mbi2';
import { RESEARCH_INTERVALS, intervalMs, type ResearchInterval } from '@/lib/deepRsa/marketData';
import { programHistoryBars, createFormulaEvaluationCache, type FormulaEvaluationCache, type Program } from '@/lib/deepDig/formula';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { readPersistedStateRaw } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';

type Statement = Program['statements'][number];

/** 「名字 = avg(前面起过名的变量, …)」：纯均值行。 */
function pureAverageOf(st: Statement, earlier: ReadonlySet<string>): string | null {
  const e = st.expr;
  if (!st.name || e.k !== 'call' || e.name !== 'avg' || e.args.length !== 2) return null;
  const a = e.args[0];
  return a.k === 'var' && earlier.has(a.name) ? a.name : null;
}

/** 核心值 X 的名字：去掉末尾的纯均值行；最后一句没起名时为 null（用最后一句本身）。 */
export function featureCoreName(program: Program): string | null {
  const st = program.statements;
  let end = st.length - 1;
  for (;;) {
    if (end < 0) return null;
    // A final sign conversion does not change which earlier variable is the core.
    const current = st[end];
    if (current.name && current.expr.k === 'un' && current.expr.op === '-' && current.expr.a.k === 'var' && current.expr.a.name === current.name) {
      let previous = end - 1;
      while (previous >= 0 && st[previous].name !== current.name) previous--;
      if (previous >= 0) { end = previous; continue; }
    }
    const earlier = new Set(st.slice(0, end).flatMap(s => (s.name ? [s.name] : [])));
    const inner = pureAverageOf(st[end], earlier);
    if (!inner) return st[end].name;
    // 跳到被平均的那个变量最后一次赋值处，继续看它是不是也只是个均值
    let k = end - 1;
    while (k >= 0 && st[k].name !== inner) k--;
    if (k < 0) return inner;
    end = k;
  }
}

/** 只留到核心值 X 最后一次赋值为止的语句（末尾的纯均值行去掉，不参与计算，也不拉长所需历史）。 */
export function coreProgram(program: Program): Program {
  const core = featureCoreName(program);
  if (!core) return program;
  let end = program.statements.length - 1;
  while (end >= 0 && program.statements[end].name !== core) end--;
  return end < 0 || end === program.statements.length - 1 ? program : { ...program, statements: program.statements.slice(0, end + 1) };
}

// ===================== 账号里的定义（与 Deep dig 目录同一份） =====================

let cache: { prefix: string; raw: string | null; defs: DeepDigFeatureDef[] } | null = null;
/** Deep dig 目录的定义（改过的内置项 + 新增项，已移除的不列）。按原文缓存，Deep dig 一保存这里就跟着变。 */
export function accountFeatureDefs(): DeepDigFeatureDef[] {
  const prefix = getUserPrefix();
  let raw: string | null = null;
  try { raw = readPersistedStateRaw(prefix + FEATURES_KEY); } catch { raw = null; }
  if (cache && cache.prefix === prefix && cache.raw === raw) return cache.defs;
  let saved: DeepDigFeatureDef[] = [];
  try { const x = JSON.parse(raw ?? '[]'); if (Array.isArray(x)) saved = x; } catch { saved = []; }
  const defs = mergeFeatureDefs(saved).filter(d => !d.removed);
  cache = { prefix, raw, defs };
  return defs;
}
export const accountFeatureDef = (id: string) => accountFeatureDefs().find(d => d.id === id);
/**
 * K 线图用的定义：账号里有就用账号的；在 Deep dig 里删掉（隐藏）了的内置项退回内置公式，副图照常画。
 * 【用户反馈】2026-10-22「为啥不显示指标的线」：DSP·a 的原版在 Deep dig 里被删了，图上 a / avg_a / avg_a_2 全是 n/a。
 */
export const chartFeatureDef = (id: string): DeepDigFeatureDef | undefined => accountFeatureDef(id) ?? BUILTIN_FEATURES.find(b => b.id === id);

// ===================== K 线图：直接算这份定义 =====================

/**
 * 图上的参数对应公式里的哪一项：半衰期 hl、平均时长 avgh，或公式里的某个常数（BSS 的近期窗口 n、CBI 的半衰期 h）。
 * 图上窗口按根计、基线按 5 分钟图计（所有周期一样），与原来的副图同一约定。
 */
const CHART_PARAM: Record<string, { param: 'hl' | 'avgh' } | { constant: string }> = {
  prs6h:{param:'hl'}, ati6h:{param:'hl'}, 'drift-speed': { param: 'hl' }, 'drift-speed-z': { param: 'hl' }, cba: { param: 'hl' }, 'cba-2': { param: 'hl' },
  state: { param: 'avgh' }, state2: { param: 'avgh' }, cdi2: { param: 'avgh' }, 'seller-control': { param: 'hl' }, dss: { constant: 'n' }, cda: { param: 'hl' },
  ctba: { constant:'N' }, cbi2: { param: 'avgh' }, bss: { constant: 'n' }, cbi: { constant: 'h' },
};


export function hasSavedFeatureDefinition(id: string): boolean {
  try { const saved = JSON.parse(readPersistedStateRaw(getUserPrefix() + FEATURES_KEY) ?? '[]'); return Array.isArray(saved) && saved.some(d => d.id === id); }
  catch { return false; }
}
/** A scalar in the saved formula is authoritative until the chart is manually overridden. */
export function chartFeaturePeriod(def: DeepDigFeatureDef, fallback = 6): number {
  if(featureTemplateId(def)==='sbs_5m')return def.SBS5M_config?.active_box_max_age??6;
  if(featureTemplateId(def)==='prs6h'&&def.PRS6H_config?.evidenceHalfLifeMinutes)return def.PRS6H_config.evidenceHalfLifeMinutes/60;
  if(featureUsesMbi2(def))return mbi2HoursOf(def,intervalMs(def.interval??'5m')/60000);
  if (featureUsesMbi(def)) return mbiNOf(def);
  const binding = CHART_PARAM[featureTemplateId(def) ?? ''];
  if (binding && 'constant' in binding) {
    try {
      const statement = compileFeatureFormula(def.formula).program.statements.find(s => s.name === binding.constant && s.expr.k === 'num');
      if (statement?.expr.k === 'num' && statement.expr.v > 0) return statement.expr.v;
    } catch { /* The editor reports invalid formulas. */ }
    return fallback;
  }
  return binding && 'param' in binding && binding.param === 'avgh' ? avgHoursOf(def) : halfLifeOf(def);
}
/** Name anonymous results for shared chart averages, without changing the saved text. */
const namedChartFormulaCache = new Map<string, string>();
export function namedChartFormula(formula: string): string {
  const cached = namedChartFormulaCache.get(formula);
  if (cached != null) return cached;
  const save = (value: string) => { if (namedChartFormulaCache.size >= 64) namedChartFormulaCache.clear(); namedChartFormulaCache.set(formula, value); return value; };
  const program = compileFeatureFormula(formula).program;
  if (featureCoreName(program)) return save(formula);
  const render = (n: Program['statements'][number]['expr']): string => n.k === 'num' ? String(n.v) : n.k === 'var' ? n.name
    : n.k === 'un' ? '(' + n.op + ' ' + render(n.a) + ')' : n.k === 'bin' ? '(' + render(n.a) + ' ' + n.op + ' ' + render(n.b) + ')' : n.name + '(' + n.args.map(render).join(', ') + ')';
  let name = '_feature_value';
  while (program.inputs.has(name) || program.statements.some(s => s.name === name)) name += '_';
  return save(formula + '\n' + name + ' = ' + render(program.statements.at(-1)!.expr));
}

const compiledCache = new Map<string, { compiled: CompiledFeature; core: string | null }>();
function compileFor(formula: string, constant: string | null, value: number | null) {
  const key = `${constant ?? ''}=${value ?? ''}\n${formula}`;
  let hit = compiledCache.get(key);
  if (!hit) {
    const base = compileFeatureFormula(formula);
    const statements = constant != null && value != null
      ? base.program.statements.map(s => (s.name === constant && s.expr.k === 'num' ? { ...s, expr: { ...s.expr, v: value } } : s))
      : base.program.statements;
    const compiled = { ...base, program: { ...base.program, statements } };
    hit = { compiled, core: featureCoreName(compiled.program) };
    if (compiledCache.size > 64) compiledCache.clear();
    compiledCache.set(key, hit);
  }
  return hit;
}

const ctbaParameterTextCache = new Map<string,string>();
/** Parameter labels read the selected feature's own compiled assignments, including a chart N override. */
export function ctbaChartParameterText(featureId:string,period:number):string {
  const def=chartFeatureDef(featureId);if(!def)return '';
  const key=featureId+'|'+period+'|'+def.formula,hit=ctbaParameterTextCache.get(key);if(hit)return hit;
  try {
    const vars=evaluateOnBars([],compileFor(def.formula,'N',period).compiled,def).vars;
    const n=(key:string)=>{const v=vars.get(key);return typeof v==='number'&&Number.isFinite(v)?v:NaN;};
    const fmt=(value:number)=>Number.isFinite(value)?String(Number(value.toPrecision(7))):'—';
    const text=`5m · N=${fmt(n('N'))} · EMA ${fmt(n('f'))}/${fmt(n('s'))} · m=${fmt(n('m'))} · 半衰期${fmt(Math.LN2/n('lambda')/12)}h · λ=${fmt(n('lambda'))} · ε=${fmt(n('epsilon'))} · α/β/γ=${fmt(n('alpha'))}/${fmt(n('ctba_beta'))}/${fmt(n('gamma'))}`;
    if(ctbaParameterTextCache.size>=64)ctbaParameterTextCache.clear();ctbaParameterTextCache.set(key,text);return text;
  }catch{return '公式待修正';}
}

const historyBarsCache = new Map<string, number>();
/** Include every nested rolling window plus a conservative EMA convergence buffer. */
export function chartFeatureHistoryBars(featureId: string, period: number, formula: string, barMinutes = 5): number {
  const def = chartFeatureDef(featureId);
  if (!def) return 0;
  if(featureTemplateId(def)==='sbs_5m')return sbsHistoryBars(def.SBS5M_config); // Explicit 24h initialization, fixed5m only.
  if(['prs6h','ati6h'].includes(featureTemplateId(def)??'')){
    const warm=featureTemplateId(def)==='prs6h'?Math.ceil(24*60/barMinutes):Math.ceil((def.ATI6H_parameters?.WINDOW_HOURS??6)*60/barMinutes)+5*mbi2NOf(ati6hDependencyOf(def),barMinutes)+2;
    const rolling=programHistoryBars(compileFeatureFormula(formula).program,{...featureParams(def),BAR_MINUTES:barMinutes},barMinutes);
    return warm+rolling;
  }
  const usesMbi = featureUsesMbi(def), usesMbi2=featureUsesMbi2(def);
  if(usesMbi2&&!def.retentionSourceId)return Math.ceil(48*60/barMinutes)+5*mbi2NOf({...def,MBI2_T_HOURS:period},barMinutes);
  const binding = CHART_PARAM[featureTemplateId(def) ?? featureId];
  const constant = binding && 'constant' in binding ? binding.constant : null;
  const program = compileFor(formula, constant, constant ? period : null).compiled.program;
  const hl = binding && 'param' in binding && binding.param === 'hl' ? period : halfLifeOf(def);
  const avgh = binding && 'param' in binding && binding.param === 'avgh' ? period : avgHoursOf(def);
  const key = `${featureId}|${period}|${hl}|${avgh}|${formula}|${barMinutes}`;
  const cached = historyBarsCache.get(key);
  if (cached != null) return cached;
  const params = { ...featureParams(def), BAR_MINUTES:barMinutes, hl, avgh, 半衰期: hl, 平均时长: avgh, ...(usesMbi ? { MBI_N: period } : {}) };
  const bars = usesMbi
    ? Math.max(programHistoryBars(program, params, barMinutes) + 1, Math.ceil(48 * 60 / barMinutes) + Math.max(5 * period, programHistoryBars(program, params, barMinutes, true)))
    : programHistoryBars(program, params, def.retentionSourceId?barMinutes:5) + Math.ceil(32 * hl * (def.retentionSourceId?60/barMinutes:12)) + 2;
  if (historyBarsCache.size >= 128) historyBarsCache.clear();
  historyBarsCache.set(key, bars);
  return bars;
}

export interface ChartFeatureSeries {
  def: DeepDigFeatureDef;
  /** 核心值 X（原值，未乘显示倍数）。 */
  core: (number | null)[];
  vars: Map<string, (number | null)[]>;
}

function inferResearchMinutes(data:KLineData[]){let step=Infinity;for(let i=1;i<Math.min(data.length,65);i++){const d=data[i].timestamp-data[i-1].timestamp;if(d>0)step=Math.min(step,d);}return Number.isFinite(step)?step/60000:5;}
const chartBarBuffers = new WeakMap<FormulaEvaluationCache, ResearchBar[]>();
const evaluationCaches = new WeakMap<KLineData[], Map<string, FormulaEvaluationCache>>();
const seriesCache = new WeakMap<KLineData[], Map<string, { key: string; result: ChartFeatureSeries }>>();
/**
 * 在图上的 K 线上算账号里那份定义：refClose 由调用方给（用到 CB 时）；T 用真实开盘时间，其余窗口按 5 分钟图计。
 * 同一批 K 线、同一参数只算一次（DSP 的 a / avg_a / A 三个副图共用）。
 */
export function chartFeatureSeries(dataList: KLineData[], featureId: string, period: number | undefined, refClose?: (number | null)[], options: { formula?: string; revision?: string; variables?: string[]; delta?: { revision:number; changes:readonly [number,number][]; referenceVersion:number } } = {}): ChartFeatureSeries | null {
  const def = chartFeatureDef(featureId);
  if (!def) return null;
  const usesMbi = featureUsesMbi(def), usesMbi2=featureUsesMbi2(def), templateId = featureTemplateId(def);
  const formula = options.formula ?? def.formula;
  if (['ctba','sbs_5m'].includes(templateId??'') && dataList.length > 1) {
    // A missing first candle must not classify an otherwise 5m series as 10m.
    let cadence = Infinity;
    for (let i = 1; i < Math.min(dataList.length, 64); i++) {
      const step = dataList[i].timestamp - dataList[i - 1].timestamp;
      if (step > 0) cadence = Math.min(cadence, step);
    }
    if (cadence !== 300000) return null;
  }
  const binding = CHART_PARAM[featureTemplateId(def) ?? featureId];
  const p = Number(period);
  const has = Number.isFinite(p) && p > 0;
  const constant = binding && 'constant' in binding ? binding.constant : null;
  const mbi2Minutes=usesMbi2?mbi2MinutesOf(dataList.slice(-65).map(b=>b.timestamp)):5;
  const params = {
    interval: '5m' as const,
    halfLifeHours: binding && 'param' in binding && binding.param === 'hl' && has ? p : def.halfLifeHours,
    avgHours: binding && 'param' in binding && binding.param === 'avgh' && has ? p : def.avgHours,
    ...(usesMbi ? {
      MBI_N: has ? p : mbiNOf(def), MBI_Z0: def.MBI_Z0,
      // Other indicators keep their existing 5m convention. MBI uses actual candle units.
      interval: (RESEARCH_INTERVALS.find(i => intervalMs(i) === (dataList.length > 1 ? dataList[1].timestamp - dataList[0].timestamp : 300000)) ?? def.interval ?? '5m') as ResearchInterval,
    } : {}),
  };
  if(usesMbi2)Object.assign(params,{id:def.id,formula:def.formula,interval:RESEARCH_INTERVALS.find(i=>intervalMs(i)===mbi2Minutes*60000)??def.interval??'5m',
    MBI2_T_HOURS:has?p:mbi2HoursOf(def,mbi2Minutes),MBI2_Z0:def.MBI2_Z0,MBI2_BAND:mbi2BandOf(def),MBI2_CONFIRM:mbi2ConfirmOf(def)});
  if(templateId==='sbs_5m'){const symbol=dataList.find(b=>typeof b.researchSymbol==='string')?.researchSymbol as string|undefined;Object.assign(params,{id:def.id,chartTemplate:'sbs_5m',formula:def.formula,interval:'5m',SBS5M_config:def.SBS5M_config,SBS5M_dimension:def.SBS5M_dimension,SBS5M_symbol:symbol,SBS5M_tick_size:typeof dataList[0]?.PRS6H_tick_size==='number'?dataList[0].PRS6H_tick_size:symbol?peekAti6hTickSize(symbol):null});}
  if(templateId==='prs6h'){const minutes=inferResearchMinutes(dataList),symbol=dataList.find(b=>typeof b.researchSymbol==='string')?.researchSymbol as string|undefined;Object.assign(params,{id:def.id,chartTemplate:'prs6h',formula:def.formula,interval:RESEARCH_INTERVALS.find(i=>intervalMs(i)===minutes*60000)??def.interval??'5m',PRS6H_config:{...def.PRS6H_config,...(has?{evidenceHalfLifeMinutes:p*60}:{})},PRS6H_symbol:symbol,PRS6H_tick_size:typeof dataList[0]?.PRS6H_tick_size==='number'?dataList[0].PRS6H_tick_size:symbol?peekAti6hTickSize(symbol):null});}
  if(templateId==='ati6h'){const minutes=inferResearchMinutes(dataList),symbol=dataList.find(b=>typeof b.researchSymbol==='string')?.researchSymbol as string|undefined;Object.assign(params,{id:def.id,chartTemplate:'ati6h',formula:def.formula,interval:RESEARCH_INTERVALS.find(i=>intervalMs(i)===minutes*60000)??def.interval??'5m',ATI6H_parameters:def.ATI6H_parameters,ATI6H_volume_mode:def.ATI6H_volume_mode,ATI6H_dependency:ati6hDependencyOf(def),ATI6H_tick_size:typeof dataList[0]?.ATI6H_tick_size==='number'?dataList[0].ATI6H_tick_size:symbol?peekAti6hTickSize(symbol):null});}
  if(def.retentionSourceId){const minutes=inferResearchMinutes(dataList);Object.assign(params,{interval:RESEARCH_INTERVALS.find(i=>intervalMs(i)===minutes*60000)??def.interval??'5m'});}
  let refSig = '';
  if (refClose) { let n = 0, sum = 0; for (const r of refClose) if (r != null) { n++; sum += r; } refSig = `${n}:${sum}`; }
  const mbi2Key=['ati6h','prs6h','sbs_5m'].includes(templateId??'')?`|${JSON.stringify(params)}|${ati6hMarketVersion()}`:usesMbi2?`|${JSON.stringify(params)}`:'';
  const mbiKey = (usesMbi ? `|${params.MBI_N}|${params.MBI_Z0}|${params.interval}` : mbi2Key)+(def.retentionSourceId?`|retention:${params.interval}`:'');
  const key = `${featureId}|${p}|${params.halfLifeHours}|${params.avgHours}|${refSig}|${options.revision ?? ''}|${def.scale}|${def.unit}|${formula}${mbiKey}`;
  const context = `${featureId}|${p}|${params.halfLifeHours}|${params.avgHours}|${def.scale}|${def.unit}|${formula}|${options.variables?.join(',') ?? '*'}${mbiKey}`;
  // Live formula calculations share the worker; its packet preserves the same closed-candle masks.
  if (options.variables && isChartComputationEnabled(dataList)) {
    try {
      const plan = compileFor(formula, constant, constant && has ? p : null);
      return requestChartComputation(context, { data:dataList, refs:refClose, signature:key, compiled:plan.compiled, params, delta:options.delta,
        variables:[...new Set([...options.variables, ...(plan.core ? [plan.core] : [])])], core:plan.core, def });
    } catch { return null; }
  }
  let perList = seriesCache.get(dataList);
  const cached = perList?.get(context);
  if (cached?.key === key) return cached.result;
  let compiled: ReturnType<typeof compileFor>;
  try { compiled = compileFor(formula, constant, constant && has ? p : null); } catch { return null; }
  let out: ReturnType<typeof evaluateOnBars>;
  let bars: ResearchBar[];
  try {
    let caches = evaluationCaches.get(dataList);
    if (!caches) { caches = new Map(); evaluationCaches.set(dataList, caches); }
    const contextKey = `${featureId}|${p}|${params.halfLifeHours}|${params.avgHours}|${formula}${mbiKey}`;
    let cache = caches.get(contextKey);
    if (!cache) { cache = createFormulaEvaluationCache(); if (caches.size >= 16) caches.clear(); caches.set(contextKey, cache); }
    bars = chartBarBuffers.get(cache) ?? [];
    bars.length = dataList.length;
    for (let i = 0; i < dataList.length; i++) {
      const d = dataList[i];
      const b = bars[i] ?? (bars[i] = {} as ResearchBar);
      b.openTime = d.timestamp; b.open = d.open; b.high = d.high; b.low = d.low;
      b.close = (def.retentionSourceId || usesMbi || usesMbi2 || ['ati6h','prs6h','sbs_5m'].includes(templateId??'') || templateId === 'ctba') && (d.cba2Closed === false || d.timestamp + intervalMs(params.interval) > Date.now()) ? NaN : d.close;
      b.volume = typeof d.volume === 'number' ? d.volume : NaN; b.takerBuyVolume = null;
      b.quoteVolume = ['ati6h','prs6h','sbs_5m'].includes(templateId??'')&&typeof d.ATI6H_quoteVolume==='number'?d.ATI6H_quoteVolume:typeof d.turnover === 'number' ? d.turnover : null;
      b.takerBuyQuoteVolume = ['ati6h','prs6h','sbs_5m'].includes(templateId??'')&&typeof d.ATI6H_takerBuyQuoteVolume==='number'?d.ATI6H_takerBuyQuoteVolume:typeof d.takerBuyTurnover === 'number' ? d.takerBuyTurnover as number : null;
      if ((def.retentionSourceId || templateId === 'ctba') && !Number.isFinite(b.close)) {
        // Components must also hide forming VWAP/flow, not only the final score.
        b.volume = NaN; b.quoteVolume = null; b.takerBuyQuoteVolume = null;
      }
      if(['prs6h','sbs_5m'].includes(templateId??''))b.PRS6H_closed=d.cba2Closed!==false&&d.timestamp+intervalMs(params.interval)<=Date.now();
      b.refClose = refClose?.[i] ?? null;
    }
    chartBarBuffers.set(cache, bars);
    out = evaluateOnBars(bars, compiled.compiled, params, cache);
    if(out.SBS5M_checkpoint)void saveSbsCheckpoint(out.SBS5M_checkpoint);
    if(out.PRS6H_checkpoint)void savePrsCheckpoint(out.PRS6H_checkpoint);
  } catch { return null; }
  const toArr = (v: unknown): (number | null)[] => {
    if (typeof v === 'number') return bars.map(() => (Number.isFinite(v) ? v : null));
    const a = v as Float64Array | undefined;
    return bars.map((_, i) => (a && Number.isFinite(a[i]) ? a[i] : null));
  };
  const vars = new Map<string, (number | null)[]>();
  for (const [name, v] of out.vars) if (!options.variables || options.variables.includes(name) || name === compiled.core) vars.set(name, toArr(v));
  const core = compiled.core ? (vars.get(compiled.core) ?? toArr(out.last)) : toArr(out.last);
  const result: ChartFeatureSeries = { def, core, vars };
  if (!perList) { perList = new Map(); seriesCache.set(dataList, perList); }
  if (perList.size > 16) perList.clear();
  perList.set(context, { key, result });
  return result;
}

// ===================== 定义有没有改过核心（与内置比） =====================

const stripLines = (n: unknown): unknown => (Array.isArray(n) ? n.map(stripLines) : n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).filter(([k]) => k !== 'line').map(([k, v]) => [k, stripLines(v)])) : n);
/** 核心值之前（含）的语句；末尾的纯均值行不算。 */
function coreStatements(formula: string): string | null {
  try {
    const st = compileFeatureFormula(formula).program.statements;
    const core = featureCoreName(compileFeatureFormula(formula).program);
    let end = st.length - 1;
    if (core) while (end >= 0 && st[end].name !== core) end--;
    return JSON.stringify(stripLines(st.slice(0, end + 1)));
  } catch { return null; }
}
const builtinCore = new Map<string, string | null>();
/** 账号里的定义与内置的核心公式相同（只改注释、末尾加均值行都算相同）。没有内置版本 → false。 */
export function sameCoreAsBuiltin(def: DeepDigFeatureDef, builtin: DeepDigFeatureDef | undefined): boolean {
  if (!builtin) return false;
  if (!builtinCore.has(builtin.id)) builtinCore.set(builtin.id, coreStatements(builtin.formula));
  return coreStatements(def.formula) === builtinCore.get(builtin.id);
}
