/** Frozen holding-period exit conditions. Any enabled condition can close the paper trade. */
import type { FishSnapshot } from './algorithm';
import type { ResearchBar } from '@/lib/deepRsa/window';
export type QualityOperator = '<' | '>' | '<=' | '>=';
export interface QualityHoldingVeto {
  id: string; label: string; kind: 'static-drawdown' | 'dynamic-drawdown' | 'indicator';
  direction: QualityOperator; threshold: number; enabled: boolean;
  metric?: string; snapshot?: FishSnapshot;
}
export type QualityExitCause = Pick<QualityHoldingVeto,'id'|'label'|'kind'|'direction'|'threshold'>;
export const activeHoldingVetoes = (conditions: readonly QualityHoldingVeto[] = []) => conditions.filter(v => v.enabled);
export const qualityConditionMet = (value: number, direction: QualityOperator, threshold: number) => direction === '<' ? value < threshold : direction === '>' ? value > threshold : direction === '<=' ? value <= threshold : value >= threshold;
export function validateHoldingVeto(v: QualityHoldingVeto) {
  if (!['static-drawdown','dynamic-drawdown','indicator'].includes(v.kind))throw new Error('未知的持仓否决指标');
  if (!Number.isFinite(v.threshold) || !['<','>','<=','>='].includes(v.direction)) throw new Error('一票否决条件须设置有效方向和有限数字阈值');
  if (v.kind !== 'indicator' && (!(v.threshold > 0 && v.threshold <= 100) || v.direction !== '>=')) throw new Error('回撤阈值须大于 0 且不超过 100%，达到（≥）即触发');
  if (v.kind === 'indicator' && (!v.snapshot || !v.metric)) throw new Error('一票否决指标缺少公式快照');
}
/** No conditions keeps old experiment keys byte-for-byte compatible. IDs/order do not change the outcome. */
export function holdingVetoIdentity(vetoes: readonly QualityHoldingVeto[] = []): unknown[] {
  return activeHoldingVetoes(vetoes).map(v => [v.kind,v.direction,v.threshold,v.metric ?? null,v.snapshot?.definitionKey ?? null,v.snapshot?.interval ?? null]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
export interface QualityHoldingPath { entry: number; peak: number; minimum: number; dynamic: number }
/** OHLC cannot tell high/low order within a minute: use prior peak/open→low, and high→close, whose order is known. */
export function advanceQualityHolding(path: QualityHoldingPath, b: ResearchBar): QualityHoldingPath {
  const beforeLow = Math.max(path.peak,b.open), peak = Math.max(beforeLow,b.high);
  return { entry:path.entry,peak,minimum:Math.min(path.minimum,b.low),dynamic:Math.max(path.dynamic,0,(beforeLow-b.low)/beforeLow*100,(peak-b.close)/peak*100) };
}
export const holdingVetoReading = (path: QualityHoldingPath, kind: 'static-drawdown'|'dynamic-drawdown') => kind === 'static-drawdown' ? Math.max(0,(path.entry-path.minimum)/path.entry*100) : path.dynamic;
