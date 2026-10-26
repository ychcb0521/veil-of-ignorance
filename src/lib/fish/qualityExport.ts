import { buildXlsx, type XlsxSheet } from '@/lib/xlsxWorkbook';
import { formatUTC8 } from '@/lib/timeFormat';
import { EXCHANGE_NAMES } from './exchanges';
import { expandQualityRows, type FishQualityStudy, type QualitySample } from './quality';
import { qualityRowResult, qualityResultMap } from './qualityComparison';
import { archiveQualityStudy, isCurrentQualityRun, qualityRuleLabel, qualityFormulaVersion } from './qualityCampaignArchive';
import { qualityDefinition } from './quality';

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
  const allRuns = (archiveQualityStudy(study).campaignRuns ?? []).filter(run => signals.has(run.sample.id));
  const runs = allRuns.filter(isCurrentQualityRun);
  sheets.push({ name: '运行结果', columns: [
    ['标的', 24], ['来源', 10], ['信号时间', 24], ['探测算法 / 捕获阈值', 50], ['卖出算法', 24], ['具体指标', 18], ['卖出方向', 10], ['卖出门槛', 12],
    ['状态', 14], ['买入时间', 24], ['买入价', 18], ['卖出 / 估值时间', 24], ['卖出 / 估值价', 18], ['收益率 %', 15], ['盈亏 USDT', 15],
    ['最大涨幅 %', 16], ['最大不利涨跌 %', 18], ['最大回撤 %', 16], ['涨幅未兑现 %', 18], ['持仓小时', 14], ['观察时长小时（0=持续至卖出）', 29], ['本金 USDT', 14], ['杠杆', 9], ['试验编号', 27],
    ['公式版本', 28], ['公式来源', 18], ['指标周期', 12], ['半衰期小时', 14], ['基线小时', 12], ['卖出触发读数', 20], ['阈值确认时间', 24], ['实际卖出公式', 60],
    ['卖出时机',22],['触发指标K线起点',24],['前次采样时间',24],['前次采样读数',20],
  ].map(([header, width]) => ({ header: String(header), width: Number(width) })), rows: runs.map(run => {
    const r = run.result;
    const definition = qualityDefinition(run.plan.snapshot);
    return [run.sample.source.symbol, run.sample.origin === 'library' ? '信号库' : '鱼', formatUTC8(run.sample.source.timeMs),
      run.detectors.map(d => `${d.label} ${d.snapshot.direction ?? '>'} ${d.snapshot.threshold}`).join('；') || '—',
      run.plan.label, run.plan.rule?.metric ?? run.plan.metric, run.plan.rule?.direction ?? '', run.plan.rule?.threshold ?? null,
      r.status === 'closed' ? '已卖出' : r.status === 'open' ? '持有（浮盈）' : '待设门槛',
      r.entryTime ? formatUTC8(r.entryTime) : null, r.entryPrice ?? null, r.endTime ? formatUTC8(r.endTime) : null, r.endPrice ?? null,
      r.returnPct ?? null, r.pnl ?? null, r.peakPct ?? null, r.adversePct ?? null, r.drawdownPct ?? null, r.uncapturedPct ?? null,
      r.heldHours ?? null, run.observeHours, 100, 1, `${r.key} · ${qualityRuleLabel(run.plan)}`,
      qualityFormulaVersion(run.plan), run.plan.definitionSource === 'account' ? '运行时账号公式' : '历史公式快照',
      run.plan.snapshot.interval ?? '5m', definition.halfLifeHours, definition.avgHours,
      r.exitReading ?? r.pendingExit?.reading ?? null, r.status === 'closed' && r.endTime ? formatUTC8(r.endTime) : r.pendingExit ? formatUTC8(r.pendingExit.at) : null, definition.formula,
      run.plan.execution === 'intrabar-1m' ? '盘中达标 · 1分钟复原' : '原周期收盘确认',r.exitSnapshot?.barOpenTime?formatUTC8(r.exitSnapshot.barOpenTime):null,
      r.exitSnapshot?.previous?.at?formatUTC8(r.exitSnapshot.previous.at):null,r.exitSnapshot?.previous?.reading??null];
  }) });
  if (study.campaignRepair) {
    const byKey = new Map(allRuns.map(run => [run.result.key,run]));
    sheets.push({name:'纠错记录',columns:['标的','原试验编号','状态','纠正后试验编号','核验时间','原卖出时间','原收益率 %','纠正后卖出时间','纠正后收益率 %','未通过原因','原实际公式','纠正后实际公式','原卖出时机','纠正后卖出时机'].map(header => ({header,width:header.includes('公式')?60:25})),
      rows:allRuns.flatMap(run => {
        const target = run.supersededBy ? byKey.get(run.supersededBy) : run;
        const history = run.priorResults?.length ? run.priorResults.map(p => ({plan:p.plan,result:p.result,at:p.at})) : [{plan:run.plan,result:run.result,at:run.repair?.checkedAt}];
        return history.map(old => [run.sample.source.symbol,old.result.key,run.supersededBy?'已替换':run.repair?.status === 'verified'?'已核验':run.repair?.status === 'failed'?'未通过':'待核验',
          target?.result.key ?? null,old.at?formatUTC8(old.at):null,old.result.endTime?formatUTC8(old.result.endTime):null,old.result.returnPct??null,
          target?.repair?.status === 'verified' && target.result.endTime?formatUTC8(target.result.endTime):null,target?.repair?.status === 'verified'?target.result.returnPct??null:null,
          run.repair?.error??null,qualityDefinition(old.plan.snapshot).formula,target?qualityDefinition(target.plan.snapshot).formula:null,old.plan.execution==='intrabar-1m'?'盘中达标 · 1分钟复原':'原周期收盘确认',target?.plan.execution==='intrabar-1m'?'盘中达标 · 1分钟复原':target?'原周期收盘确认':null]);
      })});
  }
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
