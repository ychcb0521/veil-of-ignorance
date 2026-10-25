/** Independent paper experiments. Never writes orders, balances, fish or campaign records. */
import type { TradeSignal } from '@/lib/signalLibrary';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { compileFeatureFormula, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { intervalMs, type ResearchInterval } from '@/lib/deepRsa/marketData';
import { compileFishProgram, evaluateFishProgram, shortFishHash, type FishSnapshot, type FishProgram } from './algorithm';
import { fishSourceLabel, fishMetricLabel } from './records';
import { signalDedupKey } from '@/lib/signalLibrary';
import type { FishReconstructionLoader } from './reconstruction';
import { validateFishBars } from './shared';
import { computeHoldingDynamicMaxDrawdownPct, computePeakPriceChangePct } from '@/lib/campaignMainPriceChange';

export const QUALITY_NOTIONAL = 100, QUALITY_MINUTE = 60_000;
export type QualityEntryMode = 'capture' | 'signal';
export interface QualityExitRule { metric: string; direction: '<' | '>'; threshold: number }
export interface QualityGroup { id: string; label: string; metric: string; snapshot: FishSnapshot; rule?: QualityExitRule }
export interface QualitySample {
  id: string; source: TradeSignal; groups: string[]; enteredAt: number | null;
  basis: 'capture' | 'detected' | 'signal' | 'missing'; importedAt: number;
}
export interface QualityResult {
  key: string; sampleId: string; groupId: string; evaluatedAt: number;
  status: 'open' | 'closed' | 'waiting' | 'error'; reason?: string;
  entryTime?: number; entryPrice?: number; endTime?: number; endPrice?: number;
  returnPct?: number; pnl?: number; peakPct?: number; adversePct?: number;
  drawdownPct?: number; uncapturedPct?: number; heldHours?: number; complete?: boolean;
  exitReading?: number;
  pendingExit?: { at: number; reading: number };
}
export interface FishQualityStudy {
  version: 1; startedAt: number; entryMode: QualityEntryMode; observeHours: number;
  tracking: boolean; groups: QualityGroup[]; samples: QualitySample[]; results: QualityResult[];
}
export const newQualityStudy = (now = Date.now()): FishQualityStudy => ({ version: 1, startedAt: now, entryMode: 'signal', observeHours: 0, tracking: true, groups: [], samples: [], results: [] });
/** User's historical-entry choice applies to existing copies too. Keep live detections and chosen exit rules. */
export function migrateQualitySignalEntries(study: FishQualityStudy): FishQualityStudy {
  let changed = study.entryMode !== 'signal';
  const reset = new Set<string>();
  const samples = study.samples.map(sample => {
    if (sample.basis === 'detected') return sample;
    const enteredAt = Number.isFinite(sample.source.timeMs) && sample.source.timeMs > 0 ? sample.source.timeMs : null;
    const basis = enteredAt == null ? 'missing' : 'signal';
    if (sample.enteredAt === enteredAt && sample.basis === basis) return sample;
    changed = true;
    if (sample.enteredAt !== enteredAt) reset.add(sample.id);
    return { ...sample, enteredAt, basis } as QualitySample;
  });
  return changed ? { ...study, entryMode: 'signal', samples, results: study.results.filter(r => !reset.has(r.sampleId)) } : study;
}
export function qualityMembers(s: TradeSignal): FishSnapshot[] {
  const f = s.fish;
  if (!f) return [];
  return f.algorithms?.length
    ? (f.combination === 'or' ? (f.hitAlgorithms ?? []).map(i => f.algorithms![i - 1]).filter(Boolean) : f.algorithms)
    : [f];
}
export const qualityGroupId = (f: FishSnapshot) => shortFishHash(JSON.stringify([
  f.featureId, f.definitionKey, f.statistic, f.interval, f.H, f.scale, f.unit, f.direction, f.threshold, f.constraints,
]));
/** A union's displayed start changes when another member joins. Attribute each member's original run once. */
function memberKey(source: TradeSignal, f: FishSnapshot): string {
  let start = source.timeMs;
  const bars = f.cutoffIndex != null && f.startIndex != null ? f.cutoffIndex - f.startIndex : f.aboveBars != null ? f.aboveBars - 1 : null;
  if (bars != null && Number.isInteger(bars) && bars >= 0 && Number.isFinite(f.cutoffMs)) {
    const step = intervalMs((f.interval ?? '5m') as ResearchInterval);
    start = Math.floor(f.cutoffMs / step) * step - bars * step;
  }
  return `${signalDedupKey({ ...source, timeMs: start })}|${qualityGroupId(f)}`;
}
/** Snapshot parameters, including non-default hl/avgh, are encoded in definitionKey. Never use today's formula. */
export function qualityDefinition(f: FishSnapshot): DeepDigFeatureDef {
  const saved: unknown = JSON.parse(f.definitionKey ?? 'null');
  if (!Array.isArray(saved) || typeof saved[0] !== 'string' || !saved[0].trim()) throw new Error('缺少捕获时的公式快照，请重新捕捞');
  const extra = saved.slice(4).filter((v): v is string => typeof v === 'string');
  const numeric = (prefix: string, fallback: number) => {
    const value = extra.find(v => v.startsWith(prefix));
    const n = value ? Number(value.slice(prefix.length)) : fallback;
    if (!(n > 0) || !Number.isFinite(n)) throw new Error('捕获快照的周期参数无效');
    return n;
  };
  return {
    id: f.featureId ?? 'captured', name: f.featureName ?? '捕获算法', short: f.featureShort ?? '捕获算法', definition: '',
    formula: saved[0], scale: f.scale ?? 1, unit: f.unit ?? '', positive: typeof saved[1] === 'string' ? saved[1] : '1',
    control: typeof saved[2] === 'string' ? saved[2] : '0', groupVars: 2,
    interval: (f.interval ?? extra.find(v => /^\d+[mhdwM]$/.test(v)) ?? '5m') as ResearchInterval,
    halfLifeHours: numeric('hl=', 6), avgHours: numeric('avgh=', 24),
  };
}
export function qualityMetricPlan(f: FishSnapshot, metric = 'capture'): { plan: FishProgram; scale: number } {
  let def = qualityDefinition(f), statistic = metric === 'capture' ? f.statistic ?? '结果' : metric;
  if (metric === 'capture' && f.H != null && f.H > 0) {
    const last = compileFeatureFormula(def.formula).program.statements.at(-1)!;
    const expression = last.name ?? `(${def.formula.split('\n')[last.line - 1]})`;
    let alias = '__qualityCapture';
    while (def.formula.includes(alias)) alias += '_';
    def = { ...def, formula: `${def.formula}\n${alias} = avg(${statistic === '结果' ? expression : statistic}, ${f.H})` };
    statistic = alias;
  }
  const plan = compileFishProgram(def, { statistic, direction: '>', threshold: 0, constraints: [] });
  if (plan.unavailable) throw new Error(plan.unavailable);
  return { plan, scale: metric === 'capture' ? f.scale ?? 1 : 1 };
}
export function importQualityFish(study: FishQualityStudy, signals: readonly TradeSignal[], now = Date.now()): FishQualityStudy {
  if (!study.tracking) return study;
  const groups = new Map(study.groups.map(g => [g.id, g])), samples = new Map(study.samples.map(s => [s.id, s]));
  const seen = new Set(study.samples.flatMap(s => qualityMembers(s.source).filter(f => s.groups.includes(qualityGroupId(f))).map(f => memberKey(s.source, f))));
  let changed = false;
  for (const source of signals) {
    const members = [...new Map(qualityMembers(source).map(f => [qualityGroupId(f), f])).values()].filter(f => !seen.has(memberKey(source, f)));
    const ids = members.map(qualityGroupId);
    if (!ids.length) continue;
    // Archiving/reopening a panel cannot buy the same signal again; changed capture settings are a new experiment.
    const id = shortFishHash(JSON.stringify(members.map(f => memberKey(source, f)).sort()));
    if (samples.has(id)) continue;
    const cutoff = source.fish?.cutoffMs;
    const live = source.freshCatch && (source.caughtAt ?? 0) >= study.startedAt && cutoff != null && Math.abs((source.caughtAt ?? 0) - cutoff) < 3_600_000;
    const enteredAt = live ? source.caughtAt : study.entryMode === 'signal' ? source.timeMs : cutoff;
    samples.set(id, { id, source: structuredClone(source), groups: ids, enteredAt: Number.isFinite(enteredAt) && enteredAt! > 0 ? enteredAt! : null,
      basis: !Number.isFinite(enteredAt) || enteredAt! <= 0 ? 'missing' : live ? 'detected' : study.entryMode === 'signal' ? 'signal' : 'capture', importedAt: now });
    members.forEach(f => { const key = qualityGroupId(f); if (!groups.has(key)) groups.set(key, { id: key, label: fishSourceLabel(f), metric: fishMetricLabel(f), snapshot: structuredClone(f) }); });
    members.forEach(f => seen.add(memberKey(source, f)));
    changed = true;
  }
  return changed ? { ...study, groups: [...groups.values()], samples: [...samples.values()] } : study;
}
export const qualityResultKey = (s: QualitySample, g: QualityGroup, hours: number) => shortFishHash(JSON.stringify([s.id, s.enteredAt, g.id, g.rule ?? null, hours]));
export function qualityExitSuggestions(group: QualityGroup): { label: string; rule: QualityExitRule }[] {
  const t = group.snapshot.threshold, direction: '<' | '>' = group.snapshot.direction === '<' ? '>' : '<';
  return [
    { label: '回穿捕获门槛', rule: { metric: 'capture', direction, threshold: t } },
    { label: '缓冲 50% 门槛幅度', rule: { metric: 'capture', direction, threshold: t + (direction === '<' ? -1 : 1) * Math.abs(t) / 2 } },
    { label: '穿过零轴', rule: { metric: 'capture', direction, threshold: 0 } },
  ].map(v => ({ ...v, label: `${v.label}（${v.rule.direction} ${v.rule.threshold}）` }));
}

const pricePlan = () => compileFishProgram({ id: 'quality-price', short: '价格', name: '价格', definition: '', formula: 'C', scale: 1, unit: '', positive: '1', control: '0', interval: '1m' }, { statistic: '结果', direction: '>', threshold: 0, constraints: [] });
const abort = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('已取消', 'AbortError'); };
/** A rule is observed only at completed algorithm bars; fill at the next minute's open, never a past signal price. */
export async function evaluateQualitySample(sample: QualitySample, group: QualityGroup, observeHours: number, now: number, load: FishReconstructionLoader, signal: AbortSignal, previous?: QualityResult): Promise<QualityResult> {
  const key = qualityResultKey(sample, group, observeHours), base = { key, sampleId: sample.id, groupId: group.id, evaluatedAt: now };
  if (!sample.enteredAt) return { ...base, status: 'error', reason: '缺少有效买入时间，不能可靠还原买入时点' };
  if (!(observeHours >= 0 && observeHours <= 24 * 366) || !Number.isFinite(observeHours)) return { ...base, status: 'error', reason: '观察时长须在 0～8784 小时之间；0 为持续至卖出' };
  const entry = Math.ceil(sample.enteredAt / QUALITY_MINUTE) * QUALITY_MINUTE;
  const limit = observeHours === 0 ? Infinity : entry + Math.ceil(observeHours * 60) * QUALITY_MINUTE;
  const end = Math.min(Math.floor(now / QUALITY_MINUTE) * QUALITY_MINUTE, limit);
  if (end <= entry) return { ...base, status: 'waiting', reason: '等待入场后的首根 1 分钟 K 线' };
  try {
    const row = { ...sample.source, timeMs: now }, pp = pricePlan();
    if (!group.rule) {
      // Enter now, but wait for a chosen exit experiment before loading the whole holding history.
      const bars = await load(row, entry, entry + QUALITY_MINUTE, pp, signal);
      validateFishBars(bars, entry + QUALITY_MINUTE, 1, QUALITY_MINUTE);
      return { ...base, status: 'waiting', entryTime: entry, entryPrice: bars[0].open, reason: '已登记买入，待选择卖出规则后评估收益' };
    }
    const prior = previous?.key === key && previous.status === 'open' && previous.entryPrice! > 0 && previous.endTime! >= entry && previous.endTime! <= end ? previous : undefined;
    const since = prior?.endTime ?? entry;
    if (since >= end && !prior?.pendingExit) return { ...prior!, evaluatedAt: now };
    let trigger: { at: number; reading: number } | undefined = prior?.pendingExit;
    if (group.rule) {
      const rule = group.rule;
      if (!Number.isFinite(rule.threshold) || !['<', '>'].includes(rule.direction)) throw new Error('卖出规则无效');
      const { plan, scale } = qualityMetricPlan(group.snapshot, rule.metric);
      let cursor = Math.floor(since / plan.step) * plan.step;
      const stop = Math.floor(end / plan.step) * plan.step;
      while (cursor < stop && !trigger) {
        abort(signal);
        const cut = Math.min(stop, cursor + 500 * plan.step), from = cursor - plan.warm * plan.step;
        if (from < 0) throw new Error('公式预热所需历史不足');
        const bars = await load(row, from, cut, plan, signal);
        validateFishBars(bars, cut, (cut - from) / plan.step, plan.step);
        const readings = evaluateFishProgram(bars, plan).average;
        for (let i = 0; i < bars.length; i++) {
          const at = bars[i].openTime + plan.step;
          if (at <= entry || at <= cursor || at > end) continue;
          const reading = readings[i] * scale;
          if (!Number.isFinite(reading)) throw new Error('卖出指标存在缺失读数，不能越过缺口判断成交');
          if (rule.direction === '<' ? reading < rule.threshold : reading > rule.threshold) { trigger = { at, reading }; break; }
        }
        cursor = cut;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    // Need the execution minute's open, but never its future high/low. A last-minute trigger waits for that price.
    const priceEnd = trigger && trigger.at < end ? trigger.at + QUALITY_MINUTE : end;
    if (priceEnd <= since && prior) return { ...prior, evaluatedAt: now };
    const prices = await load(row, since, priceEnd, pp, signal);
    validateFishBars(prices, priceEnd, (priceEnd - since) / QUALITY_MINUTE, QUALITY_MINUTE);
    const entryPrice = prior?.entryPrice ?? prices[0].open;
    const exitBar = trigger ? prices.find(b => b.openTime === trigger.at) : undefined;
    const closed = !!exitBar, finalTime = closed ? exitBar!.openTime : end;
    const finalPrice = closed ? exitBar!.open : prices.at(-1)!.close;
    const held = prices.filter(b => b.openTime < finalTime);
    const klines = held.map(b => ({ time: b.openTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    const args = { klines, startMs: since, endMs: finalTime - 1, barMs: QUALITY_MINUTE };
    const returnPct = (finalPrice / entryPrice - 1) * 100;
    let peakPct = Math.max(prior?.peakPct ?? 0, returnPct);
    for (let i = 0; i < klines.length; i += 5000) peakPct = Math.max(peakPct, computePeakPriceChangePct({ ...args, klines: klines.slice(i, i + 5000), side: 'long', entryPrice }) ?? 0);
    // The exit open itself is observable and belongs to the holding path; the rest of the exit candle does not.
    const previousPeak = entryPrice * (1 + (prior?.peakPct ?? 0) / 100);
    let peak = previousPeak, exitDrawdown = 0;
    for (const b of held) peak = Math.max(peak, b.high);
    exitDrawdown = Math.max(0, (peak - finalPrice) / peak * 100);
    const low = held.reduce((minimum, b) => Math.min(minimum, b.low), Math.min(entryPrice * (1 + (prior?.adversePct ?? 0) / 100), finalPrice));
    const drawdownBars = prior ? [{ time: since - QUALITY_MINUTE, open: previousPeak, high: previousPeak, low: previousPeak, close: previousPeak, volume: 0 }, ...klines] : klines;
    return { ...base, status: closed ? 'closed' : 'open', entryTime: entry, entryPrice, endTime: finalTime, endPrice: finalPrice,
      returnPct, pnl: QUALITY_NOTIONAL * returnPct / 100, peakPct, adversePct: (low / entryPrice - 1) * 100,
      drawdownPct: Math.max(prior?.drawdownPct ?? 0, exitDrawdown, computeHoldingDynamicMaxDrawdownPct({ ...args, klines: drawdownBars, startMs: prior ? since - QUALITY_MINUTE : since }) ?? 0), uncapturedPct: peakPct - returnPct,
      heldHours: (finalTime - entry) / 3_600_000, complete: closed || end >= limit,
      exitReading: closed ? trigger!.reading : undefined,
      pendingExit: !closed ? trigger : undefined,
      reason: closed ? '指标收盘确认，下一分钟开盘卖出' : trigger ? '指标已触发，等待下一分钟开盘价' : end < limit ? '持有中' : '观察期结束仍持有，记录期末浮盈' };
  } catch (error) {
    abort(signal);
    return { ...base, status: 'error', reason: error instanceof Error ? error.message : '行情读取失败' };
  }
}
export interface QualityProgress { done: number; total: number; current: string }
export interface QualityRunOptions { study: FishQualityStudy; signal: AbortSignal; onProgress: (p: QualityProgress) => void; onResult: (r: QualityResult) => void }
export async function collectFishQuality(options: QualityRunOptions, load: FishReconstructionLoader, now: number): Promise<void> {
  const { study, signal } = options, previous = new Map(study.results.map(r => [r.key, r]));
  const tasks = study.samples.flatMap(s => s.groups.map(id => ({ s, g: study.groups.find(g => g.id === id)! }))).filter(v => v.g);
  let done = 0;
  for (const { s, g } of tasks) {
    abort(signal);
    options.onProgress({ done, total: tasks.length, current: `${s.source.symbol} · ${g.label}` });
    const cached = previous.get(qualityResultKey(s, g, study.observeHours));
    if (!cached?.complete && !(!g.rule && cached?.status === 'waiting' && cached.entryPrice! > 0)) options.onResult(await evaluateQualitySample(s, g, study.observeHours, now, load, signal, cached));
    done++;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  options.onProgress({ done, total: tasks.length, current: '' });
}
export function qualityGroupSummary(study: FishQualityStudy, group: QualityGroup) {
  const samples = study.samples.filter(s => s.groups.includes(group.id));
  const keys = new Set(samples.map(s => qualityResultKey(s, group, study.observeHours)));
  const results = study.results.filter(r => keys.has(r.key));
  const valid = results.filter(r => r.status === 'open' || r.status === 'closed'), closed = valid.filter(r => r.status === 'closed');
  const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return { total: samples.length, valid: valid.length, closed: closed.length, open: valid.length - closed.length + results.filter(r => r.status === 'waiting' && r.entryPrice! > 0).length,
    failed: results.filter(r => r.status === 'error').length, pending: samples.length - results.length + results.filter(r => r.status === 'waiting').length,
    averageReturn: mean(valid.map(r => r.returnPct!)), averagePeak: mean(valid.map(r => r.peakPct!)),
    pnl: valid.reduce((a, r) => a + r.pnl!, 0), closedWinRate: closed.length ? closed.filter(r => r.pnl! > 0).length / closed.length * 100 : null };
}
