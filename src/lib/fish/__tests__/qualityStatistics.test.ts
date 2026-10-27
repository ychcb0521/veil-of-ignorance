import { describe, expect, it } from 'vitest';
import { STATE_DEF, definitionKey } from '@/lib/deepDig/features';
import { newQualityStudy, qualityResultKey, type QualityGroup, type QualitySample } from '../quality';
import { makeQualityBuyFilter, makeQualityHoldingVeto } from '../qualityFilters';
import { qualityCohortSummary, qualityMagnitudeBins, qualityOutcomeSummary, qualitySellType, qualityStatisticsEstimate, qualityStatisticsInference, qualityStatisticsSeries, qualityStatisticsDefaultSell, qualityTradeHours, type QualityStatisticSeries, type QualityStatisticTrade } from '../qualityStatistics';
import { qualityFilterColumns } from '../qualityFilterColumns';
import { qualityVariables } from '../qualityVariables';

const snapshot = { featureId: 'state', featureShort: '状态 S', definitionKey: definitionKey(STATE_DEF), statistic: 'state', interval: '5m', scale: 1, threshold: .5, direction: '>' as const, cutoffMs: 1, average: 1, cbi2: 1, startAverage: 1, previousAverage: 1 };
const plan: QualityGroup = { id: 'seller', label: '状态 S', metric: 'state', snapshot, rule: { metric: 'state', direction: '<', threshold: .5 } };
const sample = (id: string, group = 'g'): QualitySample => ({ id, enteredAt: 1000, basis: 'capture', importedAt: 1, groups: [group], source: { id, symbol: `${id}USDT`, timeMs: 1, timeLabel: '', fallbackZone: '' } });
function trade(id: string, value: number, dd = 0, cluster = id): QualityStatisticTrade {
  return { id, cluster, sellType: '算法条件卖出', result: { key: id, sampleId: id, groupId: 'seller', status: 'closed', evaluatedAt: 1, returnPct: value, adversePct: -dd, heldHours: 2 } };
}
const series = (id: string, trades: QualityStatisticTrade[]): QualityStatisticSeries => ({ id, variableId: 'v', variable: id, level: '< .5', context: '', trades, excluded: { filtered: 0, pendingFilter: 0, open: 0, waiting: 0, error: 0, invalidReturn: 0 } });

describe('algorithm variables and levels', () => {
  it('groups three thresholds under one variable and keeps different formulas/series separate', () => {
    const groups = [.5, .6, .7].map((threshold, i) => ({ ...plan, id: String(i), snapshot: { ...snapshot, threshold } }));
    expect(qualityVariables(groups)).toHaveLength(1);
    expect(qualityVariables(groups)[0].levels).toHaveLength(3);
    expect(qualityVariables([...groups, { ...plan, id: 'different', snapshot: { ...snapshot, definitionKey: 'another formula' } }])).toHaveLength(2);
    expect(qualityVariables([...groups, { ...plan, id: 'average', metric: 'avg_state', snapshot: { ...snapshot, statistic: 'avg_state' } }])).toHaveLength(2);
    expect(qualityVariables([makeQualityBuyFilter('state:state','>',.5),makeQualityBuyFilter('state:state','>',.7)])).toHaveLength(1);
  });
});
describe('descriptive statistics', () => {
  it('uses inclusive nested static cutoffs, counts flat in win denominator, never treats absent DD as zero', () => {
    const trades = [trade('a', 10, 5), trade('b', -2, 8), trade('c', 0, 10), trade('d', 50, 10.01), trade('e', 1)];
    trades[4].result.adversePct = undefined;
    const five = qualityCohortSummary(trades, 5), eight = qualityCohortSummary(trades, 8), ten = qualityCohortSummary(trades, 10);
    expect([five.n, eight.n, ten.n]).toEqual([1, 2, 3]);
    expect(ten.winRate).toBeCloseTo(100 / 3);
    expect(ten.flat).toBe(1); expect(ten.missingDrawdown).toBe(1);
    expect(ten.profit.mean).toBe(10); expect(ten.loss.mean).toBe(2);
    expect(qualityCohortSummary(trades).n).toBe(5);
  });
  it('puts magnitude boundaries in exhaustive disjoint bins and excludes zero from both outcomes', () => {
    const values = [.1, 1, 3, 5, 10, 20];
    for (const sign of ['profit', 'loss'] as const) {
      const result = qualityOutcomeSummary([...values.map((v, i) => trade(String(i), sign === 'profit' ? v : -v)), trade('zero', 0)], sign);
      expect(result.bins.map(b => b.label)).toEqual(qualityMagnitudeBins);
      expect(result.bins.map(b => b.n)).toEqual([1, 1, 1, 1, 1, 1]); expect(result.n).toBe(6);
    }
  });
  it('averages available valid durations, can reconstruct from timestamps, and reports no sample as null', () => {
    const a = trade('a', 1), b = trade('b', 2); b.result.heldHours = undefined;
    expect(qualityOutcomeSummary([a,b], 'profit')).toMatchObject({ held: 2, heldN: 1 });
    b.result.entryTime = 1000; b.result.endTime = 3_601_000;
    expect(qualityTradeHours(b.result)).toBe(1);
    b.result.heldHours = -1; b.result.endTime = 0; expect(qualityTradeHours(b.result)).toBeNull();
    expect(qualityCohortSummary([])).toMatchObject({ n: 0, winRate: null, mean: null, sd: null });
  });
  it('uses saved sell causes and leaves historical unknown veto triggers unknown', () => {
    const t = trade('a', 1), veto = makeQualityHoldingVeto('drop-5m', '>=', 3);
    expect(qualitySellType(t.result, { ...plan, holdingVetoes: [veto] })).toBe('触发原因未记录');
    t.result.exitSnapshot = { barOpenTime: 0, observedAt: 0, cause: veto };
    expect(qualitySellType(t.result, plan)).toBe('5分钟跌幅卖出');
    t.result.exitSnapshot.cause = undefined; expect(qualitySellType(t.result, plan)).toBe('算法条件卖出');
  });
});
describe('series construction and filtering', () => {
  it('deduplicates detector rows within a level while retaining different entries and exclusion reasons', () => {
    const study = { ...newQualityStudy(), sellPlans: [plan] }, a = sample('a'), b = sample('b'), c = sample('c'), d = sample('d');
    study.results = [a,b,c,d].map((r,i) => ({ ...trade(r.id, i).result, key: qualityResultKey(r,plan,0), status: (['closed','open','error','closed'] as const)[i], returnPct: i === 3 ? undefined : i }));
    const rows = [{ ...a, id: 'a/one', signalId: 'a', detectorId:'g' }, { ...a, id: 'a/two', signalId: 'a', detectorId:'g2' }, b,c,d];
    const [s] = qualityStatisticsSeries(study, rows, 'sell');
    expect(s.trades.map(t => t.id)).toEqual(['a']);
    expect(s.excluded).toMatchObject({ open: 1, error: 1, invalidReturn: 1 });
    study.groups = ['g','g2'].map(id => ({ ...plan, id }));
    const detectors = qualityStatisticsSeries(study, rows, 'detect', plan.id);
    expect(detectors.map(s => s.trades.map(t => t.id))).toEqual([['a'],['a']]);
    expect(study.results).toHaveLength(4);
  });
  it('opens a filter level with its owning seller rather than an unrelated fixed seller', () => {
    const f = makeQualityBuyFilter('state:state','>',.7);
    const study = { ...newQualityStudy(), selectedSellId: 'seller', sellPlans: [plan, {...plan,id:'owner',buyFilters:[f]}] };
    expect(qualityStatisticsDefaultSell(study, 'filter', qualityFilterColumns(study)[0].id)).toBe('owner');
    expect(qualityStatisticsDefaultSell(study, 'detect')).toBe('seller');
  });
  it('honors the fixed seller actual buy conditions and never includes cached unbought outcomes', () => {
    const f = makeQualityBuyFilter('state:state', '>', .7), study = { ...newQualityStudy(), sellPlans: [{ ...plan, buyFilters: [f] }] }, a = sample('a');
    study.results = [{ ...trade('a', 10).result, key: qualityResultKey(a,plan,0) }];
    const s = qualityStatisticsSeries(study, [a], 'sell')[0];
    expect(s.trades).toHaveLength(0); expect(s.excluded.pendingFilter).toBe(1);
    expect(qualityStatisticsSeries(study, [a], 'filter', plan.id)[0].trades).toHaveLength(0);
  });
});
describe('inference protects pairing and dependent memberships', () => {
  it('pairs only common entries, preserves whole-symbol clusters and computes exact two-sided p with Holm', () => {
    const base = Array.from({length: 8}, (_,i) => trade(String(i),i));
    const variants = [series('base',base), ...[2,3].map(v => series(String(v), [...base.map(t => trade(t.id,t.result.returnPct!+v)),trade('extra',100)]))];
    const rows = qualityStatisticsInference(variants, 'base', true, 'return', 99);
    expect(rows[0]).toMatchObject({ nA: 8, nB: 8, overlap: 8, clusters: 8, difference: 2, ci: [2,2], p: 2/256, pHolm: 4/256 });
    expect(rows[1].difference).toBe(3);
    expect(qualityStatisticsInference(variants, 'base', true, 'return', 99)).toEqual(rows);
  });
  it('does not manufacture sample size by treating many events from one coin as independent', () => {
    const a = Array.from({length: 100}, (_,i) => trade(String(i),10,0,'same coin'));
    const [r] = qualityStatisticsInference([series('a',a),series('b',a.map(t => trade(t.id,0,0,'same coin')))],'b',true);
    expect(r).toMatchObject({ clusters: 1, ci: null, p: null });
    expect(qualityStatisticsEstimate(a).meanCi).toBeNull();
    const many = Array.from({length: 8}, (_,i) => trade(String(i), i));
    expect(qualityStatisticsInference([series('a',a),series('b',many)], 'b',false)[0].ci).toBeNull();
    expect(qualityStatisticsEstimate(many.map(t => trade(t.id, 1)),99).winCi).toBeNull();
  });
  it('retains overlapping membership during bootstrap without applying independent-sample p values', () => {
    const a = Array.from({length: 8}, (_,i) => trade(String(i),i));
    const [r] = qualityStatisticsInference([series('a',a),series('b',a)],'b',false,'return',99);
    expect(r).toMatchObject({ overlap: 8, nA: 8, nB: 8, difference: 0, ci: [0,0], p: null, pHolm: null });
  });
  it('excludes missing holding times, leaves no common entries untestable and returns finite one-level intervals', () => {
    const a = Array.from({length: 8}, (_,i) => trade(String(i),i));
    a[0].result.heldHours = undefined;
    expect(qualityStatisticsInference([series('a',a),series('b',a)],'b',true,'held',99)[0].nA).toBe(7);
    expect(qualityStatisticsInference([series('a',[trade('x',1)]),series('b',[trade('y',1)])],'b',true)[0].difference).toBeNull();
    const estimate = qualityStatisticsEstimate(a,99); expect(estimate.clusters).toBe(8); expect(estimate.meanCi).not.toBeNull();
  });
});
