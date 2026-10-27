import { clusterBootstrapCi } from '@/lib/deepRsa/clusterBootstrap';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { holmAdjust } from '@/lib/deepRsa/rsa';
import type { QualityResult } from './quality';
import type { QualityStatisticTrade, QualityStatisticSeries } from './qualityStatistics';
const finite = (n: number | undefined | null): n is number => n != null && Number.isFinite(n);
const average = (values: readonly number[]) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

export function qualityTradeHours(result: QualityResult): number | null {
  if (finite(result.heldHours) && result.heldHours >= 0) return result.heldHours;
  return finite(result.entryTime) && finite(result.endTime) && result.endTime >= result.entryTime ? (result.endTime - result.entryTime) / 3_600_000 : null;
}
export type QualityInferenceMetric = 'return' | 'held';
export function qualityStatisticsEstimate(trades: readonly QualityStatisticTrade[], reps = 1999) {
  const clusters = trades.map(t => t.cluster), n = new Set(clusters).size;
  if (n < 5) return { clusters: n, meanCi: null, winCi: null, winReason: '少于 5 个标的簇' };
  const wins = trades.filter(t => t.result.returnPct! > 0).length, interior = wins > 0 && wins < trades.length;
  return { clusters: n,
    meanCi: clusterBootstrapCi(idx => average(idx.map(i => trades[i].result.returnPct!))!, clusters, { reps, seed: 20261027 }),
    winCi: interior ? clusterBootstrapCi(idx => idx.filter(i => trades[i].result.returnPct! > 0).length / idx.length * 100, clusters, { reps, seed: 20261027 }) : null,
    winReason: interior ? '重抽样不足' : '全盈或无盈利，Bootstrap 无法估计边界不确定性',
  };
}
export interface QualityInferenceRow { id: string; label: string; nA: number; nB: number; overlap: number; clusters: number; difference: number | null; ci: [number, number] | null; p: number | null; pHolm: number | null; note: string }
/** Same-symbol observations move together. For overlapping memberships, one union-cluster draw feeds both groups. */
export function qualityStatisticsInference(series: readonly QualityStatisticSeries[], referenceId: string, paired: boolean, metric: QualityInferenceMetric = 'return', reps = 1999): QualityInferenceRow[] {
  const reference = series.find(s => s.id === referenceId);
  if (!reference) return [];
  const value = (t: QualityStatisticTrade) => metric === 'return' ? t.result.returnPct : qualityTradeHours(t.result);
  const rows = series.filter(s => s.id !== referenceId).map((s, index): QualityInferenceRow => {
    const originalA = s.trades.filter(t => finite(value(t))), originalB = reference.trades.filter(t => finite(value(t)));
    const idsA = new Set(originalA.map(t => t.id)), idsB = new Set(originalB.map(t => t.id));
    const a = paired ? originalA.filter(t => idsB.has(t.id)) : originalA, b = paired ? originalB.filter(t => idsA.has(t.id)) : originalB;
    const clusters = [...new Set([...a, ...b].map(t => t.cluster))].sort();
    const sums = clusters.map(cluster => { const av = a.filter(t => t.cluster === cluster).map(t => value(t)!), bv = b.filter(t => t.cluster === cluster).map(t => value(t)!); return { a: av.reduce((x, y) => x + y, 0), na: av.length, b: bv.reduce((x, y) => x + y, 0), nb: bv.length }; });
    const difference = a.length && b.length ? average(a.map(t => value(t)!))! - average(b.map(t => value(t)!))! : null;
    const row: QualityInferenceRow = { id: s.id, label: `${s.variable} · ${s.level}`, nA: a.length, nB: b.length, overlap: originalA.filter(t => idsB.has(t.id)).length, clusters: clusters.length, difference, ci: null, p: null, pHolm: null, note: '' };
    if (difference == null) { row.note = paired ? '没有共同且均已卖出的入场记录' : '至少一组没有有效样本'; return row; }
    if (clusters.length < 5) { row.note = '少于 5 个标的簇，仅报告描述差异'; return row; }
    if (new Set(a.map(t => t.cluster)).size < 5 || new Set(b.map(t => t.cluster)).size < 5) { row.note = '至少一组少于 5 个标的簇，仅报告描述差异'; return row; }
    const statistic = (idx: readonly number[]) => { let sa = 0, sb = 0, na = 0, nb = 0; for (const i of idx) { sa += sums[i].a; sb += sums[i].b; na += sums[i].na; nb += sums[i].nb; } return na && nb ? sa / na - sb / nb : NaN; };
    row.ci = clusterBootstrapCi(statistic, clusters, { reps, seed: 20261027 + index });
    if (paired) {
      // Cluster sign-flip: a whole symbol's paired differences change sign together.
      const differences = sums.map(x => x.a - x.b), observed = Math.abs(differences.reduce((x, y) => x + y, 0));
      const exact = clusters.length <= 12, total = exact ? 2 ** clusters.length : reps, random = mulberry32(27102026 + index);
      let extreme = 0;
      for (let k = 0; k < total; k++) { const permuted = differences.reduce((sum, d, i) => sum + d * (exact ? ((k >> i) & 1 ? 1 : -1) : random() < .5 ? 1 : -1), 0); if (Math.abs(permuted) >= observed - 1e-10) extreme++; }
      row.p = exact ? extreme / total : (extreme + 1) / (total + 1);
      row.note = '共同入场配对；按标的簇符号翻转双侧检验（要求簇间独立、零假设下差值对称）';
    } else row.note = '组别可能重叠；联合簇重抽样保留重叠，仅估计差值区间，不作独立样本检验';
    if (!row.ci) row.note = '重抽样中有效组不足，无法估计区间';
    return row;
  });
  const tested = rows.filter(r => r.p != null), adjusted = holmAdjust(tested.map(r => r.p!));
  tested.forEach((r, i) => { r.pHolm = adjusted[i]; });
  return rows;
}
