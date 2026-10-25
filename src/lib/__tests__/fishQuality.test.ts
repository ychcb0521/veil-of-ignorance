import { describe, expect, it, vi } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { collectFishQuality, evaluateQualitySample, migrateQualityCaptureEntries, importQualityFish, newQualityStudy, qualityDefinition, qualityGroupId, qualityGroupSummary, qualityMetricPlan, qualityResultKey, type QualityGroup, type QualitySample } from '@/lib/fish/quality';
import type { FishSnapshot } from '@/lib/fish/algorithm';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { ResearchBar } from '@/lib/deepRsa/window';

const T = Date.UTC(2026, 9, 20), M = 60_000;
const def = { id: 'test', name: '测试', short: 'T', definition: '', formula: 'raw = C\navg_raw = avg(raw, 0.05)\navg_raw_2 = avg_raw', scale: 10, unit: '点', positive: '1', control: '0', interval: '5m' as const, halfLifeHours: 3, avgHours: 12 };
const snap = (patch: Partial<FishSnapshot> = {}): FishSnapshot => ({ featureId: def.id, featureShort: 'T', definitionKey: definitionKey(def), statistic: '结果', interval: '5m', scale: 10, direction: '>', threshold: 1000, average: 105, cbi2: 105, startAverage: 105, previousAverage: 99, cutoffMs: T, ...patch });
const fish = (snapshot = snap()): TradeSignal => ({ id: 'a', symbol: 'AAAUSDT', timeMs: T - 3600_000, timeLabel: '', fallbackZone: '', fish: snapshot, caughtAt: T + M });
function fixture(snapshot = snap()) {
  const study = importQualityFish({ ...newQualityStudy(T + 2 * M), entryMode: 'capture' }, [fish(snapshot)]);
  return { study, s: study.samples[0], g: study.groups[0] };
}
const bar = (time: number, open = 100, close = open, high = Math.max(open, close), low = Math.min(open, close)): ResearchBar => ({ openTime: time, open, close, high, low, volume: 1, quoteVolume: 100, takerBuyQuoteVolume: 50, takerBuyVolume: .5 });
const loader = (change: (time: number, step: number) => ResearchBar = (time) => bar(time)): FishReconstructionLoader => async (_row, from, cut, plan) => Array.from({ length: (cut - from) / plan.step }, (_, i) => change(from + i * plan.step, plan.step));
const evaluate = (s: QualitySample, g: QualityGroup, load = loader(), now = T + 15 * M, hours = 1) => { g.rule ??= { metric: 'capture', direction: '<', threshold: -1 }; return evaluateQualitySample(s, g, hours, now, load, new AbortController().signal); };

describe('fish quality paper experiments', () => {
  // 【用户要求】2026-10-26「历史鱼按捕捞时刻买入」
  it('buys historical fish at the capture time by default, never at the hindsight signal onset', async () => {
    const source = fish(), study = importQualityFish(newQualityStudy(T + 2 * M), [source]);
    expect(study.entryMode).toBe('capture');
    const sample = study.samples[0], g = study.groups[0];
    expect(source.timeMs).toBe(T - 3600_000); expect(source.fish!.cutoffMs).toBe(T);
    expect(sample).toMatchObject({ enteredAt: T, basis: 'capture' });
    const load = vi.fn(loader());
    const result = await evaluateQualitySample(sample, g, 0, T + 15 * M, load, new AbortController().signal);
    expect(result.entryTime).toBe(T);
    expect(load.mock.calls[0].slice(1, 3)).toEqual([T, T + M]);
  });
  it('migrates existing signal-time entries to capture time and invalidates their previous returns while preserving live trades, copies and exit rules', () => {
    const { study: captured, s: c, g } = fixture();
    const s: QualitySample = { ...c, enteredAt: c.source.timeMs, basis: 'signal' };
    const study = { ...captured, entryMode: 'signal' as const, samples: [s] };
    g.rule = { metric: 'capture', direction: '<', threshold: 500 };
    const live: QualitySample = { ...s, id: 'live', basis: 'detected', enteredAt: T + M, source: { ...s.source, id: 'live', symbol: 'BBBUSDT' } };
    study.samples.push(live);
    study.results.push(
      { key: qualityResultKey(s, g, 0), sampleId: s.id, groupId: g.id, evaluatedAt: T, status: 'open', returnPct: 25, pendingExit: { at: T, reading: 1 } },
      { key: qualityResultKey(live, g, 0), sampleId: live.id, groupId: g.id, evaluatedAt: T, status: 'closed', returnPct: 10 },
    );
    const original = structuredClone(study), upgraded = migrateQualityCaptureEntries(study);
    expect(upgraded.entryMode).toBe('capture');
    expect(upgraded.samples[0]).toMatchObject({ id: s.id, enteredAt: T, basis: 'capture' });
    expect(upgraded.samples[0].source).toBe(s.source); expect(upgraded.groups).toBe(study.groups);
    expect(upgraded.groups[0].rule).toEqual(g.rule); expect(upgraded.samples[1]).toBe(live);
    expect(upgraded.results).toEqual([study.results[1]]);
    expect(migrateQualityCaptureEntries(upgraded)).toBe(upgraded);
    expect(study).toEqual(original);
    expect(qualityResultKey(upgraded.samples[0], g, 0)).not.toBe(study.results[0].key);
  });
  it('keeps equal-time results and marks missing capture times instead of substituting the signal onset', () => {
    const { study, s, g } = fixture();
    study.results.push({ key: qualityResultKey(s, g, 0), sampleId: s.id, groupId: g.id, evaluatedAt: T, status: 'closed', returnPct: 10 });
    expect(migrateQualityCaptureEntries(study)).toBe(study);
    const missing = migrateQualityCaptureEntries({ ...study, samples: [{ ...s, source: { ...s.source, fish: { ...s.source.fish!, cutoffMs: NaN } } }] });
    expect(missing.samples[0]).toMatchObject({ enteredAt: null, basis: 'missing' }); expect(missing.results).toHaveLength(0);
  });
  it('defaults to continuous observation and registers the buy without preselecting an exit or downloading an unbounded price history', async () => {
    const { s, g } = fixture(), load = vi.fn(loader());
    expect(newQualityStudy().observeHours).toBe(0);
    const result = await evaluateQualitySample(s, g, 0, T + 365 * 86400_000, load, new AbortController().signal);
    expect(result).toMatchObject({ status: 'waiting', entryPrice: 100, entryTime: T });
    expect(result.returnPct).toBeUndefined(); expect(result.reason).toContain('待选择卖出规则');
    expect(load.mock.calls[0].slice(1, 3)).toEqual([T, T + M]);
  });
  it('continues beyond one week until the chosen rule exits and resumes holding metrics without downloading earlier prices again', async () => {
    const { s, g } = fixture(); g.rule = { metric: 'raw', direction: '<', threshold: -1 };
    const path = loader((t, step) => step === M ? bar(t, 100 + ((t - T) / M % 20), 105, Math.max(125, 100 + ((t - T) / M % 20)), 80) : bar(t));
    const first = await evaluateQualitySample(s, g, 0, T + 6 * M, path, new AbortController().signal);
    const nextLoad = vi.fn(path);
    const resumed = await evaluateQualitySample(s, g, 0, T + 20 * M, nextLoad, new AbortController().signal, first);
    const whole = await evaluateQualitySample(s, g, 0, T + 20 * M, path, new AbortController().signal);
    expect(resumed).toEqual(whole);
    expect(nextLoad.mock.calls.filter(c => c[3].step === M)[0][1]).toBe(T + 6 * M);
    const later = await evaluateQualitySample(s, g, 0, T + 8 * 86400_000, loader(), new AbortController().signal, whole);
    expect(later.status).toBe('open'); expect(later.complete).toBe(false); expect(later.heldHours).toBe(8 * 24);
  });
  it('carries a last-minute exit confirmation into the next update without using the exit candle extremes', async () => {
    const { s, g } = fixture(snap({ definitionKey: definitionKey({ ...def, formula: 'raw = C' }) }));
    g.rule = { metric: 'capture', direction: '<', threshold: 950 };
    const path = loader((t, step) => step === 5 * M ? bar(t, 100, t + step >= T + 5 * M ? 90 : 100) : t === T + 5 * M ? bar(t, 92, 1000, 2000, 1) : bar(t, 100));
    const first = await evaluateQualitySample(s, g, 0, T + 5 * M, path, new AbortController().signal);
    expect(first.pendingExit?.at).toBe(T + 5 * M);
    const resumed = await evaluateQualitySample(s, g, 0, T + 6 * M, path, new AbortController().signal, first);
    const whole = await evaluateQualitySample(s, g, 0, T + 6 * M, path, new AbortController().signal);
    expect(resumed).toEqual(whole); expect(resumed.status).toBe('closed'); expect(resumed.peakPct).toBe(0);
  });
  it('copies each signal once, survives archival, freezes source data and uses capture time rather than hindsight signal onset', () => {
    const source = fish(), before = structuredClone(source), study = importQualityFish({ ...newQualityStudy(T + 2 * M), entryMode: 'capture' }, [source]);
    expect(study.samples[0]).toMatchObject({ enteredAt: T, basis: 'capture' });
    expect(importQualityFish(study, [{ ...source, id: 'archived', fishArchive: { id: 'x', at: T + 3 * M }, freshCatch: false }])).toBe(study);
    source.fish!.threshold = 999;
    expect(study.groups[0].snapshot.threshold).toBe(1000); expect(study.samples[0].source).toEqual(before);
  });
  it('uses actual detection time for a live arrival and the capture time for historical imports', () => {
    const active = newQualityStudy(T);
    const live = importQualityFish(active, [{ ...fish(), freshCatch: true }]);
    expect(live.samples[0]).toMatchObject({ enteredAt: T + M, basis: 'detected' });
    const historical = importQualityFish(active, [{ ...fish(snap({ cutoffMs: T - 86400_000 })), freshCatch: true }]);
    expect(historical.samples[0]).toMatchObject({ enteredAt: T - 86400_000, basis: 'capture' });
  });
  it('attributes only OR hits, keeps different subtypes/thresholds/formula versions separate, and does not mutate the cabin', () => {
    const a = snap(), b = snap({ statistic: 'raw', scale: 1 }), c = snap({ threshold: 900 });
    const source = fish({ ...a, algorithms: [a, b, c], combination: 'or', hitAlgorithms: [1, 3] });
    const study = importQualityFish(newQualityStudy(), [source]);
    expect(study.samples).toHaveLength(1); expect(study.groups).toHaveLength(2); expect(study.samples[0].groups).toEqual([qualityGroupId(a), qualityGroupId(c)]);
    expect(qualityGroupId(a)).not.toBe(qualityGroupId(b));
    expect(qualityGroupId(a)).not.toBe(qualityGroupId(snap({ definitionKey: definitionKey({ ...def, formula: 'C' }) })));
    expect(source.fish!.algorithms).toHaveLength(3);
  });
  it('restores captured hl, avgh and period, rejects missing formulas, and distinguishes result display scale from raw variables', () => {
    expect(qualityDefinition(snap())).toMatchObject({ formula: def.formula, interval: '5m', halfLifeHours: 3, avgHours: 12 });
    expect(qualityMetricPlan(snap()).scale).toBe(10); expect(qualityMetricPlan(snap(), 'raw').scale).toBe(1);
    expect(() => qualityDefinition(snap({ definitionKey: undefined }))).toThrow('公式快照');
    expect(qualityMetricPlan(snap({ H: 1 })).plan.def.formula).toContain('avg(avg_raw_2, 1)');
  });
  it('does not buy one algorithm twice when a union gains another member or its displayed signal start changes', () => {
    const a = snap({ startIndex: 10, cutoffIndex: 12 }), b = snap({ statistic: 'raw', scale: 1, startIndex: 9, cutoffIndex: 12 });
    const first = fish({ ...a, algorithms: [a, b], combination: 'or', hitAlgorithms: [1] });
    const study = importQualityFish(newQualityStudy(), [first]);
    const second = { ...first, timeMs: first.timeMs - 300_000, fish: { ...first.fish!, hitAlgorithms: [1, 2] } };
    const next = importQualityFish(study, [second]);
    expect(next.samples).toHaveLength(2); expect(next.samples[1].groups).toEqual([qualityGroupId(b)]);
    expect(qualityGroupSummary(next, next.groups[0]).total).toBe(1);
  });
  it('hand-checks 100 USDT / 1x returns, holding metrics, peak-to-subsequent-trough drawdown, and open horizon status', async () => {
    const { s, g } = fixture();
    const prices = [bar(T, 100, 110, 120, 95), bar(T + M, 110, 100, 115, 90), bar(T + 2 * M, 100, 105, 112, 100)];
    const r = await evaluate(s, g, loader(t => prices.find(b => b.openTime === t) ?? bar(t)), T + 3 * M, .05);
    expect(r).toMatchObject({ status: 'open', entryPrice: 100, endPrice: 105, complete: true });
    expect(r.returnPct).toBeCloseTo(5); expect(r.pnl).toBeCloseTo(5); expect(r.peakPct).toBeCloseTo(20);
    expect(r.drawdownPct).toBeCloseTo(25); expect(r.adversePct).toBeCloseTo(-10); expect(r.uncapturedPct).toBeCloseTo(15);
    expect(r.reason).toContain('仍持有'); expect(r.heldHours).toBeCloseTo(.05);
  });
  it('sells only after a completed algorithm reading, at the next minute open; excludes the exit candle high/low', async () => {
    const { s, g } = fixture(snap({ definitionKey: definitionKey({ ...def, formula: 'raw = C' }) }));
    g.rule = { metric: 'capture', direction: '<', threshold: 950 };
    const load = loader((t, step) => step === 5 * M ? bar(t, 100, t + step >= T + 5 * M ? 90 : 100) : t === T + 5 * M ? bar(t, 92, 1000, 2000, 1) : bar(t, 100));
    const r = await evaluate(s, g, load);
    expect(r).toMatchObject({ status: 'closed', entryTime: T, endTime: T + 5 * M, entryPrice: 100, endPrice: 92, exitReading: 900 });
    expect(r.returnPct).toBeCloseTo(-8); expect(r.peakPct).toBe(0); expect(r.drawdownPct).toBeCloseTo(8);
    const waiting = await evaluate(s, g, load, T + 5 * M);
    expect(waiting.status).toBe('open'); expect(waiting.reason).toContain('等待下一分钟');
  });
  it('does not use pre-entry OHLC extremes or the original signal time when entry falls inside an algorithm bar', async () => {
    const { s, g } = fixture(); s.enteredAt = T + 1234;
    const calls: number[][] = [];
    const load: FishReconstructionLoader = async (row, a, b, p, signal) => { calls.push([a, b, row.timeMs]); return loader(t => bar(t, 100, 101, 102, 99))(row, a, b, p, signal); };
    const r = await evaluate(s, g, load, T + 4 * M);
    expect(r.entryTime).toBe(T + M); expect(calls[0][0]).toBe(T + M); expect(calls.every(v => v[1] <= v[2])).toBe(true);
  });
  it('marks absent entry, gaps and invalid readings as errors and aborts without inventing returns', async () => {
    const { s, g } = fixture();
    expect((await evaluate({ ...s, enteredAt: null }, g)).status).toBe('error');
    expect((await evaluate(s, g, async () => [])).status).toBe('error');
    g.rule = { metric: 'missing', direction: '<', threshold: 0 };
    expect((await evaluate(s, g)).status).toBe('error');
    const c = new AbortController(); c.abort();
    await expect(evaluateQualitySample(s, g, 1, T + 15 * M, async () => { throw new DOMException('', 'AbortError'); }, c.signal)).rejects.toThrow();
  });
  it('invalidates old rule statistics, counts closed wins separately from floating PnL, reuses complete results and retries failures', async () => {
    const { study, s, g } = fixture(), result = await evaluate(s, g, loader(t => bar(t, 100, 105)), T + 60 * M);
    study.observeHours = 1; study.results = [result];
    expect(qualityGroupSummary(study, g)).toMatchObject({ valid: 1, closed: 0, closedWinRate: null });
    const load = vi.fn(loader());
    await collectFishQuality({ study, signal: new AbortController().signal, onProgress: vi.fn(), onResult: vi.fn() }, load, T + 120 * M);
    expect(load).not.toHaveBeenCalled();
    g.rule = { metric: 'raw', direction: '<', threshold: 10 };
    expect(qualityResultKey(s, g, 1)).not.toBe(result.key); expect(qualityGroupSummary(study, g).valid).toBe(0);
    expect(qualityGroupSummary(study, g).pending).toBe(1);
  });
});
