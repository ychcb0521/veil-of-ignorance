import { activeBuyFilters, qualityComparisonRows, qualityDrawdownPct, type FishQualityStudy, type QualitySample } from './quality';
import { qualityStatisticsSeries, type QualityStatisticTrade } from './qualityStatistics';
import { qualityLevelText, qualityVariableKey, qualityVariables } from './qualityVariables';

export const QUALITY_RETURN_CUTS = [100, 50, 40, 30, 20, 10] as const;
export type QualityReturnClassification = 'variable' | 'level';
interface Category { id: string; label: string }
export interface QualityReturnTrade extends QualityStatisticTrade {
  trialId: string;
  seller: Record<QualityReturnClassification, Category>;
  filter: Record<QualityReturnClassification, Category>;
  detector: Record<QualityReturnClassification, Category>;
}
/** A multi-condition gate or overlapping detector membership is one exclusive combination, never extra pie slices. */
function combination(items: readonly Category[], empty: string): Category {
  const unique = [...new Map(items.map(item => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
  return { id: JSON.stringify(unique.length ? unique.map(item => item.id) : ['empty', empty]), label: unique.length ? unique.map(item => item.label).join(' 且 ') : empty };
}
export function qualityReturnTrades(study: FishQualityStudy, rows: readonly QualitySample[]): QualityReturnTrade[] {
  const plans = new Map((study.sellPlans ?? []).map(p => [p.id, p]));
  // A detector selector narrows eligible entries; it does not rewrite their original multi-hit attribution.
  const original = new Map(qualityComparisonRows(study).map(row => [row.id, row]));
  const libraryIds = new Set(rows.filter(r => r.origin === 'library').map(r => r.signalId ?? r.id));
  const groupMap = new Map(study.groups.map(g => [g.id, g]));
  const fallback = new Map<string, Set<string>>();
  for (const row of rows) { const id = row.signalId ?? row.id, ids = fallback.get(id) ?? new Set<string>(); row.groups.forEach(g => ids.add(g)); fallback.set(id, ids); }
  const detectorVariables = new Map(qualityVariables(study.groups).flatMap(v => v.levels.map(g => [g.id, { id: v.id, label: v.label }] as const)));
  const result: QualityReturnTrade[] = [];
  for (const series of qualityStatisticsSeries(study, rows, 'sell')) {
    const plan = plans.get(series.id)!;
    const filters = activeBuyFilters(study, plan);
    const filter = {
      variable: combination(filters.map(f => ({ id: qualityVariableKey(f.snapshot, f.metric), label: f.label })), study.independentFilters ? '独立过滤（未绑定卖出）' : '未设置过滤'),
      level: combination(filters.map(f => ({ id: JSON.stringify([qualityVariableKey(f.snapshot, f.metric), f.direction, f.threshold]), label: `${f.label} ${qualityLevelText(f)}` })), study.independentFilters ? '独立过滤（未绑定卖出）' : '未设置过滤'),
    };
    for (const trade of series.trades) {
      const ids = original.get(trade.id)?.groups ?? [...(fallback.get(trade.id) ?? [])];
      const groups = ids.map(id => groupMap.get(id)).filter(g => g != null);
      const missing = original.get(trade.id)?.origin === 'library' || libraryIds.has(trade.id) ? '无探测算法（信号库）' : '探测归属未记录';
      const unknown: Category[] = ids.some(id => !groupMap.has(id)) ? [{ id: 'unknown-detector', label: '部分探测归属未记录' }] : [];
      const detector = {
        variable: combination([...groups.map(g => detectorVariables.get(g.id)!), ...unknown], missing),
        level: combination([...groups.map(g => ({ id: g.id, label: `${g.label} ${qualityLevelText(g)}${g.snapshot.constraints?.length ? ` · 约束 ${g.snapshot.constraints.length} 条` : ''}` })), ...unknown], missing),
      };
      // Combination membership is conjunctive, while detector attribution means simultaneous hits.
      detector.variable.label = detector.variable.label.split(' 且 ').join(' ＋ ');
      detector.level.label = detector.level.label.split(' 且 ').join(' ＋ ');
      result.push({ ...trade, trialId: `${plan.id}|${trade.id}`, seller: { variable: { id: series.variableId, label: series.variable }, level: { id: plan.id, label: `${series.variable} ${series.level}` } }, filter, detector });
    }
  }
  return result;
}
export interface QualityReturnBin { label: string; n: number }
function counts(items: readonly Category[]): QualityReturnBin[] {
  const map = new Map<string, QualityReturnBin>();
  for (const item of items) { const bin = map.get(item.id); if (bin) bin.n++; else map.set(item.id, { label: item.label, n: 1 }); }
  return [...map.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}
export function qualityReturnSummary(trades: readonly QualityReturnTrade[], minimumReturn: number, classification: QualityReturnClassification = 'variable') {
  const qualified = [...new Map(trades.filter(t => t.result.status === 'closed' && Number.isFinite(t.result.returnPct) && t.result.returnPct! >= minimumReturn).map(t => [t.trialId, t])).values()];
  const drawdown = ['[0, 1)%', '[1, 3)%', '[3, 5)%', '[5, 8)%', '[8, 10)%', '[10, 20)%', '≥20%', '静态回撤未记录'].map(label => ({ label, n: 0 }));
  for (const trade of qualified) { const dd = qualityDrawdownPct(trade.result, 'static'); drawdown[dd == null ? 7 : dd < 1 ? 0 : dd < 3 ? 1 : dd < 5 ? 2 : dd < 8 ? 3 : dd < 10 ? 4 : dd < 20 ? 5 : 6].n++; }
  return { n: qualified.length, entries: new Set(qualified.map(t => t.id)).size, sellers: new Set(qualified.map(t => t.seller.level.id)).size, drawdown,
    seller: counts(qualified.map(t => t.seller[classification])), filter: counts(qualified.map(t => t.filter[classification])), detector: counts(qualified.map(t => t.detector[classification])),
    sellType: counts(qualified.map(t => ({ id: t.sellType, label: t.sellType }))),
  };
}
