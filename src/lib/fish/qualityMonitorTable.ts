import { buildXlsx, type XlsxCell, type XlsxSheet } from '@/lib/xlsxWorkbook';
import { formatUTC8 } from '@/lib/timeFormat';
import { EXCHANGE_NAMES } from './exchanges';
import { qualityDefinition, qualityDrawdownPct, type QualityGroup } from './quality';
import { qualityRuleLabel, qualityVersionedRuleLabel, qualitySellKey } from './qualityCampaignArchive';
import type { QualityMonitorRecord, QualityMonitorSetting } from './qualityMonitorLibrary';
import { activeHoldingVetoes } from './qualityVeto';
import { monitorCampaignUnavailable, qualityMonitorCampaignPath } from './qualityMonitorCampaign';

export const monitorBuying = (s: QualityMonitorSetting) => s.plan.buyFilters?.length ? s.plan.buyFilters.map(f => `${f.label} ${f.direction} ${f.threshold}`).join(' 且 ') + (s.filtersKnown ? '' : '（历史判断读数未完整记录）') : s.filtersKnown ? '无买前条件' : '历史条件未记录';
export const monitorVetoes = (s: QualityMonitorSetting) => activeHoldingVetoes(s.plan.holdingVetoes).map(v => `${v.label} ${v.direction} ${v.threshold}${v.kind === 'indicator' ? '' : '%'}`).join(' 或 ') || '无';
export const monitorDetectorKey = (g: QualityGroup) => JSON.stringify([g.snapshot.featureId, g.metric, g.snapshot.definitionKey, g.snapshot.interval, g.snapshot.scale, g.snapshot.H, g.snapshot.direction, g.snapshot.threshold]);
export const monitorDetectorLabel = (g: QualityGroup) => `${g.label} ${g.snapshot.direction ?? '>'} ${g.snapshot.threshold}`;
export const monitorDetectors = (s: QualityMonitorSetting) => !s.detectorsKnown ? '历史算法未记录' : s.detectors.map(monitorDetectorLabel).join('；') || '无探测算法';
export const monitorAlgorithmKey = (s: QualityMonitorSetting) => JSON.stringify([qualitySellKey(s.plan), s.plan.metric, s.plan.snapshot.statistic, s.plan.snapshot.H]);
/** Failed/pending buy conditions must never expose a hypothetical trade as a bought outcome. */
export const monitorResult = (r: QualityMonitorRecord, s: QualityMonitorSetting) => !s.filtersKnown || ['none', 'pass'].includes(r.filterStatus.state) ? r.result : undefined;
export function monitorStatus(r: QualityMonitorRecord, s: QualityMonitorSetting): string {
  if (s.filtersKnown) {
    if (r.filterStatus.state === 'fail') return '未买入';
    if (r.filterStatus.state === 'error') return '过滤缺数据';
    if (r.filterStatus.state === 'pending') return '待过滤';
  }
  return r.result?.status === 'closed' ? '已卖出' : r.result?.status === 'open' ? '持有中' : r.result?.status === 'error' ? '缺数据' : r.result?.entryPrice ? '待设卖出' : '待评估';
}
export const monitorColumns = [
  ['symbol', '标的', 24], ['time', '信号时间', 24], ['algorithm', '监测算法', 48], ['buying', '买前过滤', 56],
  ['status', '结果', 15], ['return', '收益率', 16], ['static', '静态最大回撤', 18], ['dynamic', '动态最大回撤', 18], ['held', '持仓时间', 18],
  ['detectors', '探测算法', 48], ['entered', '买入时间', 24], ['vetoes', '持仓否决', 48], ['market', '市场', 10], ['saved', '保存时间', 24],
] as const;
export type MonitorSortKey = typeof monitorColumns[number][0];
const finite = (n: number | null | undefined): number | null => n != null && Number.isFinite(n) ? n : null;
export function monitorValue(r: QualityMonitorRecord, s: QualityMonitorSetting, key: MonitorSortKey): string | number | null {
  const result = monitorResult(r, s), valued = result && ['closed', 'open'].includes(result.status) ? result : undefined;
  switch (key) {
    case 'symbol': return r.source.symbol;
    case 'time': return finite(r.source.timeMs);
    case 'market': return r.source.market === 'us_stock' ? '美股' : '合约';
    case 'entered': return finite(r.enteredAt);
    case 'algorithm': return qualityVersionedRuleLabel(s.plan);
    case 'buying': return monitorBuying(s);
    case 'vetoes': return monitorVetoes(s);
    case 'status': return monitorStatus(r, s);
    case 'return': return finite(valued?.returnPct);
    case 'static': return qualityDrawdownPct(result, 'static');
    case 'dynamic': return qualityDrawdownPct(result, 'dynamic');
    case 'held': return finite(valued?.heldHours);
    case 'detectors': return monitorDetectors(s);
    case 'saved': return finite(r.updatedAt);
  }
}
export function sortMonitorRecords(records: readonly QualityMonitorRecord[], settings: ReadonlyMap<string, QualityMonitorSetting>, key: MonitorSortKey, ascending: boolean): QualityMonitorRecord[] {
  return [...records].sort((a, b) => {
    const x = monitorValue(a, settings.get(a.settingId)!, key), y = monitorValue(b, settings.get(b.settingId)!, key);
    // Missing readings remain last in both directions; real zero stays numeric.
    if (x == null || y == null) return x == null && y == null ? a.id.localeCompare(b.id) : x == null ? 1 : -1;
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh-CN', { numeric: true });
    return (ascending ? order : -order) || b.updatedAt - a.updatedAt || b.source.timeMs - a.source.timeMs || a.id.localeCompare(b.id);
  });
}
const date = (n: number | null | undefined) => n == null ? null : formatUTC8(n);
function formula(g: QualityGroup['snapshot']): string { try { return qualityDefinition(g).formula; } catch { return g.definitionKey; } }
/** Export only the selected frozen records, in the same order as the filtered table, across every page. */
export function buildMonitorSheets(records: readonly QualityMonitorRecord[], settings: ReadonlyMap<string, QualityMonitorSetting>): XlsxSheet[] {
  const rows = records.filter(r => settings.has(r.settingId));
  const used = [...new Set(rows.map(r => r.settingId))].map(id => settings.get(id)!);
  return [{ name: '监测记录', columns: [
    ...monitorColumns.map(([key, header, width]) => ({ header: `${header}${['return', 'static', 'dynamic'].includes(key) ? ' %' : key === 'held' ? ' 小时' : ''}`, width })),
    ...['交易所', '买入价', '卖出 / 估值时间', '卖出 / 估值价', '盈亏 USDT', '结果说明', '过滤判断', '过滤读数 JSON', '记录编号', '配置编号', '交易战役链接'].map(header => ({ header, width: header.includes('JSON') ? 70 : 28 })),
  ], rows: rows.map(r => {
    const s = settings.get(r.settingId)!, result = monitorResult(r, s), valued = result && ['closed', 'open'].includes(result.status) ? result : undefined;
    return [...monitorColumns.map(([key]): XlsxCell => ['time', 'entered', 'saved'].includes(key) ? date(monitorValue(r, s, key) as number | null) : monitorValue(r, s, key)),
      EXCHANGE_NAMES[r.source.exchange ?? 'binance'], result?.entryPrice ?? null, date(result?.endTime), result?.endPrice ?? null, valued?.pnl ?? null,
      result?.reason ?? null, r.filterStatus.detail, JSON.stringify(r.readings), r.id, s.id,
      monitorCampaignUnavailable(r,s)?null:new URL(qualityMonitorCampaignPath(r.id),window.location.origin).href];
  }) }, { name: '算法与公式', columns: ['配置编号', '监测算法', '买前过滤', '持仓否决', '探测算法', '观察小时（0=持续至卖出）', '本金 USDT', '杠杆', '类型', '算法', '公式', '原始快照 JSON'].map(header => ({ header, width: header.includes('公式') || header.includes('JSON') ? 80 : 35 })),
    rows: used.flatMap(s => {
      const snapshots = [{ type: '监测', label: qualityRuleLabel(s.plan), snapshot: s.plan.snapshot },
        ...(s.plan.buyFilters ?? []).map(f => ({ type: '买前过滤', label: `${f.label} ${f.direction} ${f.threshold}`, snapshot: f.snapshot })),
        ...activeHoldingVetoes(s.plan.holdingVetoes).filter(v => v.snapshot).map(v => ({ type: '持仓否决', label: `${v.label} ${v.direction} ${v.threshold}`, snapshot: v.snapshot! })),
        ...s.detectors.map(g => ({ type: '探测', label: monitorDetectorLabel(g), snapshot: g.snapshot }))];
      return snapshots.map(g => [s.id, qualityVersionedRuleLabel(s.plan), monitorBuying(s), monitorVetoes(s), monitorDetectors(s), s.observeHours, s.notional, s.leverage, g.type, g.label, formula(g.snapshot), JSON.stringify(g.snapshot)]);
    }) }];
}
export function downloadMonitorRecords(records: readonly QualityMonitorRecord[], settings: ReadonlyMap<string, QualityMonitorSetting>, at = Date.now()): string {
  if (!records.length) throw new Error('暂无可导出的监测记录');
  const filename = `监测库-${formatUTC8(at).replace(/\D/g, '').slice(0, 14)}.xlsx`;
  const url = URL.createObjectURL(buildXlsx(buildMonitorSheets(records, settings))), link = document.createElement('a');
  try { link.href = url; link.download = filename; document.body.appendChild(link); link.click(); }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return filename;
}
