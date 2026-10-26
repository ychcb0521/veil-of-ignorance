import { buildXlsx, type XlsxSheet } from '@/lib/xlsxWorkbook';
import { formatUTC8 } from '@/lib/timeFormat';
import { EXCHANGE_NAMES } from './exchanges';
import { expandQualityRows, type FishQualityStudy, type QualitySample } from './quality';
import { qualityRowResult, qualityResultMap } from './qualityComparison';

/** Match the displayed detector rows; repeated sell values belong to the same signal and entry. */
export function buildQualitySheets(study: FishQualityStudy, rows: QualitySample[]): XlsxSheet[] {
  rows = expandQualityRows(rows);
  const plans = study.sellPlans ?? [], groups = new Map(study.groups.map(g => [g.id, g])), results = qualityResultMap(study);
  return [{ name: '鱼质量', columns: [
    { header: '标的', width: 25 }, { header: '来源', width: 10 }, { header: '信号时间', width: 24 }, { header: '市场', width: 10 }, { header: '评分', width: 8 },
    ...plans.map(p => ({ header: `卖出 · ${p.label}（${p.rule ? `${p.rule.direction} ${p.rule.threshold}` : '未设置'}）收益率 %`, width: 34 })),
    { header: '探测算法 / 捕获阈值', width: 42 }, { header: '买入时间', width: 24 },
  ], rows: rows.map(row => [
    row.source.symbol + (row.source.exchange && row.source.exchange !== 'binance' ? `（${EXCHANGE_NAMES[row.source.exchange]}）` : ''),
    row.origin === 'library' ? '信号库' : '鱼',
    formatUTC8(row.source.timeMs), row.source.market === 'us_stock' ? '美股' : '', row.source.quality ?? null,
    ...plans.map(p => { const r = qualityRowResult(study, row, p, results); return r?.status === 'closed' ? r.returnPct ?? null : r?.status === 'open' ? `持有浮盈 ${r.returnPct?.toFixed(2) ?? '—'}%` : r?.status === 'error' ? '缺数据' : '待评估'; }),
    row.detectorId && groups.has(row.detectorId) ? `${groups.get(row.detectorId)!.label} ${groups.get(row.detectorId)!.snapshot.direction ?? '>'} ${groups.get(row.detectorId)!.snapshot.threshold}` : '—', row.enteredAt ? formatUTC8(row.enteredAt) : null,
  ]) }];
}
export function downloadQualityComparison(study: FishQualityStudy, rows: QualitySample[], at = Date.now()) {
  if (!rows.length) throw new Error('暂无可导出的鱼质量记录');
  const filename = `鱼质量-${formatUTC8(at).replace(/\D/g, '').slice(0, 14)}.xlsx`;
  const blob = buildXlsx(buildQualitySheets(study, rows)), url = URL.createObjectURL(blob), link = document.createElement('a');
  try { link.href = url; link.download = filename; document.body.appendChild(link); link.click(); }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return filename;
}
