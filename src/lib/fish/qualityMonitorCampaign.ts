import { hasQualityCampaign, type QualityCampaignRun } from './qualityCampaignArchive';
import type { QualityMonitorRecord, QualityMonitorSetting } from './qualityMonitorLibrary';

const PREFIX = 'fish-sell-monitor-';
/** Encode the full record identity: different frozen settings must never share a campaign by result key alone. */
export function qualityMonitorCampaignId(recordId: string): string {
  const bytes = new TextEncoder().encode(recordId);
  return PREFIX + btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const qualityMonitorCampaignPath = (recordId: string) => `/journal/campaigns/${qualityMonitorCampaignId(recordId)}?section=quality`;
export const isMonitorCampaignId = (id: string) => id.startsWith(PREFIX);
export function monitorCampaignRecordId(id: string): string | undefined {
  if (!isMonitorCampaignId(id)) return;
  try {
    const encoded=id.slice(PREFIX.length).replace(/-/g,'+').replace(/_/g,'/');
    return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(encoded), c=>c.charCodeAt(0)));
  } catch { return; }
}
export function monitorCampaignUnavailable(record: QualityMonitorRecord, setting: QualityMonitorSetting): string | undefined {
  if (setting.filtersKnown && !['none','pass'].includes(record.filterStatus.state)) return record.filterStatus.state==='fail'?'未买入，不生成交易战役':'买前过滤尚未完成，暂未形成交易';
  if (!record.result || record.result.status==='waiting') return '尚未形成可复盘的交易，完成持仓监测后可进入战役';
  if (!hasQualityCampaign(record.result)) return '缺少有效成交数据，请重新监测后再查看战役';
}
export function qualityMonitorCampaignRun(record: QualityMonitorRecord, setting: QualityMonitorSetting): QualityCampaignRun | undefined {
  if (monitorCampaignUnavailable(record,setting)) return;
  const result=record.result!;
  return {
    sample: {id:result.sampleId,source:record.source,groups:setting.detectors.map(d=>d.id),enteredAt:record.enteredAt,
      basis:record.basis,importedAt:record.firstSavedAt,origins:record.origins,...(record.origin?{origin:record.origin}:record.basis==='signal'&&!record.origins?.length?{origin:'library' as const}:{})},
    plan:setting.plan,detectors:setting.detectors,result,observeHours:setting.observeHours,firstEvaluatedAt:record.firstSavedAt,
  };
}
