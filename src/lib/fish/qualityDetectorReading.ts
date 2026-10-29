/** Read the observation belonging to this signal and detector, never another signal's group snapshot. */
import { qualityGroupId, qualityMembers, type QualitySample } from './quality';
import { libraryCondition } from './libraryConditions';
import { formatUTC8 } from '@/lib/timeFormat';

export function qualityDetectorReading(row: QualitySample) {
  const id = row.detectorId;
  const snapshot = id ? row.readings?.[id] ?? qualityMembers(row.source).find(f => qualityGroupId(f) === id) : undefined;
  const condition = snapshot ? libraryCondition(snapshot, '探测时保存的读数') : undefined;
  const measured = condition?.reading;
  const value = measured != null && Number.isFinite(measured) && (condition?.snapshot.scale ?? 0) > 0 ? measured : null;
  const at = snapshot && Number.isFinite(snapshot.cutoffMs) && snapshot.cutoffMs > 0 ? snapshot.cutoffMs : null;
  return { value, text: value == null ? '—' : String(Number(value.toPrecision(7))), label: condition?.label ?? '探测算法', at,
    detail: condition ? `${condition.text} · 探测时刻 ${at ? formatUTC8(at) : '未记录'} · ${condition.context}${value == null ? ' · 探测读数未记录' : ` · 探测值 ${value}`}` : id ? '历史探测快照未记录' : '信号库的信号没有探测读数' };
}
