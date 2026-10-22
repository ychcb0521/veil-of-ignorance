/**
 * 特征值的唯一来源：K 线图指标、渔、Deep dig 都读同一份定义（Deep dig 里账号保存的那份，没改过就是内置的）。
 * 【用户要求】2026-10-19「公式要统一。指标类标、捕鱼算法、dig 中的要保持一致。尤其是 avg，不能重复 avg」
 * 「你要保证内在统一」。
 *
 * 核心值 X：公式最后一句；但末尾若是「名字 = avg(前面某个变量, h)」这种纯均值行（如 avg_CBI2 = avg(CBI2, 24)），
 * 它只是在 X 上再取均值，X 取被平均的那个变量。均值统一由使用方套一次：K 线图的 avg 副图、渔的 avg(X, H)；
 * 不会出现「均值的均值」。Deep dig 自己的结果仍按公式写的算（写了 avg 行就是 avg(X, h)，与渔 H = h 时同一个量）。
 */
import type { KLineData } from 'klinecharts';
import { BUILTIN_FEATURES, compileFeatureFormula, evaluateOnBars, FEATURES_KEY, mergeFeatureDefs, type CompiledFeature, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { Program } from '@/lib/deepDig/formula';
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

let cache: { raw: string | null; defs: DeepDigFeatureDef[] } | null = null;
/** Deep dig 目录的定义（改过的内置项 + 新增项，已移除的不列）。按原文缓存，Deep dig 一保存这里就跟着变。 */
export function accountFeatureDefs(): DeepDigFeatureDef[] {
  let raw: string | null = null;
  try { raw = readPersistedStateRaw(getUserPrefix() + FEATURES_KEY); } catch { raw = null; }
  if (cache && cache.raw === raw) return cache.defs;
  let saved: DeepDigFeatureDef[] = [];
  try { const x = JSON.parse(raw ?? '[]'); if (Array.isArray(x)) saved = x; } catch { saved = []; }
  const defs = mergeFeatureDefs(saved).filter(d => !d.removed);
  cache = { raw, defs };
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
  'drift-speed': { param: 'hl' }, 'drift-speed-z': { param: 'hl' }, cba: { param: 'hl' }, 'cba-2': { param: 'hl' },
  state: { param: 'avgh' }, cdi2: { param: 'avgh' }, 'drift-speed-down-z': { param: 'hl' }, dss: { constant: 'n' }, cda: { param: 'hl' },
  cbi2: { param: 'avgh' }, bss: { constant: 'n' }, cbi: { constant: 'h' },
};

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

export interface ChartFeatureSeries {
  def: DeepDigFeatureDef;
  /** 核心值 X（原值，未乘显示倍数）。 */
  core: (number | null)[];
  vars: Map<string, (number | null)[]>;
}

const seriesCache = new WeakMap<KLineData[], Map<string, ChartFeatureSeries>>();
/**
 * 在图上的 K 线上算账号里那份定义：refClose 由调用方给（用到 CB 时）；T 用真实开盘时间，其余窗口按 5 分钟图计。
 * 同一批 K 线、同一参数只算一次（DSP 的 a / avg_a / A 三个副图共用）。
 */
export function chartFeatureSeries(dataList: KLineData[], featureId: string, period: number | undefined, refClose?: (number | null)[], options: { formula?: string; revision?: string } = {}): ChartFeatureSeries | null {
  const def = chartFeatureDef(featureId);
  if (!def) return null;
  const formula = options.formula ?? def.formula;
  const binding = CHART_PARAM[featureId];
  const p = Number(period);
  const has = Number.isFinite(p) && p > 0;
  const constant = binding && 'constant' in binding ? binding.constant : null;
  const params = {
    interval: '5m' as const,
    halfLifeHours: binding && 'param' in binding && binding.param === 'hl' && has ? p : def.halfLifeHours,
    avgHours: binding && 'param' in binding && binding.param === 'avgh' && has ? p : def.avgHours,
  };
  let refSig = '';
  if (refClose) { let n = 0, sum = 0; for (const r of refClose) if (r != null) { n++; sum += r; } refSig = `${n}:${sum}`; }
  const key = `${featureId}|${p}|${params.halfLifeHours}|${params.avgHours}|${refSig}|${options.revision ?? ''}|${def.scale}|${def.unit}|${formula}`;
  let perList = seriesCache.get(dataList);
  const cached = perList?.get(key);
  if (cached) return cached;
  let compiled: ReturnType<typeof compileFor>;
  try { compiled = compileFor(formula, constant, constant && has ? p : null); } catch { return null; }
  const bars: ResearchBar[] = dataList.map((d, i) => ({
    openTime: d.timestamp, open: d.open, high: d.high, low: d.low, close: d.close,
    volume: typeof d.volume === 'number' ? d.volume : Number.NaN,
    takerBuyVolume: null,
    quoteVolume: typeof d.turnover === 'number' ? d.turnover : null,
    takerBuyQuoteVolume: typeof d.takerBuyTurnover === 'number' ? (d.takerBuyTurnover as number) : null,
    refClose: refClose?.[i] ?? null,
  }));
  let out: ReturnType<typeof evaluateOnBars>;
  try { out = evaluateOnBars(bars, compiled.compiled, params); } catch { return null; }
  const toArr = (v: unknown): (number | null)[] => {
    if (typeof v === 'number') return bars.map(() => (Number.isFinite(v) ? v : null));
    const a = v as Float64Array | undefined;
    return bars.map((_, i) => (a && Number.isFinite(a[i]) ? a[i] : null));
  };
  const vars = new Map<string, (number | null)[]>();
  for (const [name, v] of out.vars) vars.set(name, toArr(v));
  const core = compiled.core ? (vars.get(compiled.core) ?? toArr(out.last)) : toArr(out.last);
  const result: ChartFeatureSeries = { def, core, vars };
  if (!perList) { perList = new Map(); seriesCache.set(dataList, perList); }
  if (perList.size > 16) perList.clear();
  perList.set(key, result);
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
