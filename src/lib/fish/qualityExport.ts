import { buildXlsx, type XlsxSheet } from '@/lib/xlsxWorkbook';
import { formatUTC8 } from '@/lib/timeFormat';
import { EXCHANGE_NAMES } from './exchanges';
import { expandQualityRows, type FishQualityStudy, type QualitySample } from './quality';
import { qualityRowResult, qualityResultMap } from './qualityComparison';
import { archiveQualityStudy, qualityRuleLabel } from './qualityCampaignArchive';

/** Match the displayed detector rows; repeated sell values belong to the same signal and entry. */
export function buildQualitySheets(study: FishQualityStudy, rows: QualitySample[]): XlsxSheet[] {
  rows = expandQualityRows(rows);
  const plans = study.sellPlans ?? [], groups = new Map(study.groups.map(g => [g.id, g])), results = qualityResultMap(study);
  const sheets: XlsxSheet[] = [{ name: '鱼质量', columns: [
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
  const signals = new Set(rows.map(row => row.signalId ?? row.id));
  const runs = (archiveQualityStudy(study).campaignRuns ?? []).filter(run => signals.has(run.sample.id));
  sheets.push({ name: '运行结果', columns: [
    ['标的', 24], ['来源', 10], ['信号时间', 24], ['探测算法 / 捕获阈值', 50], ['卖出算法', 24], ['具体指标', 18], ['卖出方向', 10], ['卖出门槛', 12],
    ['状态', 14], ['买入时间', 24], ['买入价', 18], ['卖出 / 估值时间', 24], ['卖出 / 估值价', 18], ['收益率 %', 15], ['盈亏 USDT', 15],
    ['最大涨幅 %', 16], ['最大不利涨跌 %', 18], ['最大回撤 %', 16], ['涨幅未兑现 %', 18], ['持仓小时', 14], ['观察时长小时（0=持续至卖出）', 29], ['本金 USDT', 14], ['杠杆', 9], ['试验编号', 27],
  ].map(([header, width]) => ({ header: String(header), width: Number(width) })), rows: runs.map(run => {
    const r = run.result;
    return [run.sample.source.symbol, run.sample.origin === 'library' ? '信号库' : '鱼', formatUTC8(run.sample.source.timeMs),
      run.detectors.map(d => `${d.label} ${d.snapshot.direction ?? '>'} ${d.snapshot.threshold}`).join('；') || '—',
      run.plan.label, run.plan.rule?.metric ?? run.plan.metric, run.plan.rule?.direction ?? '', run.plan.rule?.threshold ?? null,
      r.status === 'closed' ? '已卖出' : r.status === 'open' ? '持有（浮盈）' : '待设门槛',
      r.entryTime ? formatUTC8(r.entryTime) : null, r.entryPrice ?? null, r.endTime ? formatUTC8(r.endTime) : null, r.endPrice ?? null,
      r.returnPct ?? null, r.pnl ?? null, r.peakPct ?? null, r.adversePct ?? null, r.drawdownPct ?? null, r.uncapturedPct ?? null,
      r.heldHours ?? null, run.observeHours, 100, 1, `${r.key} · ${qualityRuleLabel(run.plan)}`];
  }) });
  return sheets;
}
export function downloadQualityComparison(study: FishQualityStudy, rows: QualitySample[], at = Date.now()) {
  if (!rows.length) throw new Error('暂无可导出的鱼质量记录');
  const filename = `鱼质量-${formatUTC8(at).replace(/\D/g, '').slice(0, 14)}.xlsx`;
  const blob = buildXlsx(buildQualitySheets(study, rows)), url = URL.createObjectURL(blob), link = document.createElement('a');
  try { link.href = url; link.download = filename; document.body.appendChild(link); link.click(); }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return filename;
}
