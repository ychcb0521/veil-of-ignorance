/** Frozen holding-period exit conditions. Any enabled condition can close the paper trade. */
import type { FishSnapshot } from './algorithm';
import type { ResearchBar } from '@/lib/deepRsa/window';
export type QualityOperator = '<' | '>' | '<=' | '>=';
export interface QualityHoldingVeto {
  id: string; label: string; kind: 'static-drawdown' | 'dynamic-drawdown' | 'drop-1m' | 'drop-5m' | 'indicator';
  direction: QualityOperator; threshold: number; enabled: boolean;
  metric?: string; snapshot?: FishSnapshot;
}
export const holdingPriceLabels = { 'static-drawdown': '持仓过程静态最大回撤', 'dynamic-drawdown': '持仓过程动态最大回撤', 'drop-1m': '1分钟内跌幅', 'drop-5m': '5分钟内跌幅' } as const;
export const isHoldingPriceChoice = (choice: string): choice is keyof typeof holdingPriceLabels => Object.prototype.hasOwnProperty.call(holdingPriceLabels, choice);
export const minuteDropWindow = (kind: QualityHoldingVeto['kind']) => kind === 'drop-1m' ? 1 : kind === 'drop-5m' ? 5 : 0;
export type QualityExitCause = Omit<Pick<QualityHoldingVeto,'id'|'label'|'kind'|'direction'|'threshold'>, 'kind'> & {kind:QualityHoldingVeto['kind'] | 'mirror-take-profit'};
export const activeHoldingVetoes = (conditions: readonly QualityHoldingVeto[] = []) => conditions.filter(v => v.enabled);
export const qualityConditionMet = (value: number, direction: QualityOperator, threshold: number) => direction === '<' ? value < threshold : direction === '>' ? value > threshold : direction === '<=' ? value <= threshold : value >= threshold;
export function validateHoldingVeto(v: QualityHoldingVeto) {
  if (![...Object.keys(holdingPriceLabels),'indicator'].includes(v.kind))throw new Error('未知的持仓否决指标');
  if (!Number.isFinite(v.threshold) || !['<','>','<=','>='].includes(v.direction)) throw new Error('一票否决条件须设置有效方向和有限数字阈值');
  if (v.kind !== 'indicator' && (!(v.threshold > 0 && v.threshold <= 100) || v.direction !== '>=')) throw new Error('回撤或跌幅阈值须大于 0 且不超过 100%，达到（≥）即触发');
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
/**
 * 回撤止损在这一分钟内的成交（止损单式）：止损价在分钟开始前就已确定，盘中最低价碰到即按止损价卖出，不等这一分钟收完。
 * 【用户要求】2026-10-26「已经设置了静态回撤 ≥ 5% 卖出，为什么卖出列的静态回撤还有大于 5% 的」——
 * 以前要等这一分钟收完才检查、再按下一分钟开盘价卖，一分钟里砸穿的部分全算进了回撤。
 * 开盘就跳空越线的由调用方先按开盘价处理。分钟内高低点先后不明：
 *   第一段 开盘→最低：静态止损价 = 买入价 ×（1 − 阈值）；动态止损价 = max(此前峰值, 开盘) ×（1 − 阈值）。价格自上而下先碰到较高的那条。
 *   第二段 最高→收盘（先后确定）：只可能是动态止损被新高抬升后，收盘跌破 新高 ×（1 − 阈值）。
 * 两段都按较差的一侧成交，不借用这一分钟里还没发生的价格。
 */
export interface QualityStopFill { veto: QualityHoldingVeto; price: number; peak: number; reading: number }
export function qualityIntrabarStop(path: QualityHoldingPath, b: ResearchBar, risk: readonly QualityHoldingVeto[]): QualityStopFill | undefined {
  const touched = (price: number, level: number) => price <= level * (1 + 1e-12);
  const beforeLow = Math.max(path.peak, b.open);
  let best: QualityStopFill | undefined;
  for (const v of risk) {
    if (v.kind !== 'static-drawdown' && v.kind !== 'dynamic-drawdown') continue;
    const anchor = v.kind === 'static-drawdown' ? path.entry : beforeLow, level = anchor * (1 - v.threshold / 100);
    if (touched(b.low, level) && (!best || level > best.price)) best = { veto: v, price: level, peak: beforeLow, reading: v.threshold };
  }
  if (best) return best;
  const peak = Math.max(beforeLow, b.high);
  for (const v of risk) {
    if (v.kind !== 'dynamic-drawdown') continue;
    const level = peak * (1 - v.threshold / 100);
    if (touched(b.close, level) && (!best || level > best.price)) best = { veto: v, price: level, peak, reading: v.threshold };
  }
  return best;
}

/** Rolling closed-minute fall. Short holdings start at entry; no pre-entry price or missing minute is substituted. */
export function minuteDropReading(bars: readonly ResearchBar[], minutes: number, entry: number, at: number): { reading: number; start: number } | undefined {
  const start = Math.max(entry, at - minutes * 60_000), window = bars.filter(b => b.openTime >= start && b.openTime < at);
  if (!window.length || window.length !== (at - start) / 60_000 || window.some((b, i) => b.openTime !== start + i * 60_000)) return;
  const first = window[0].open, last = window.at(-1)!.close;
  if (!(first > 0 && last > 0 && Number.isFinite(first) && Number.isFinite(last))) throw new Error('短时跌幅缺少有效价格');
  return { reading: Math.max(0, (first - last) / first * 100), start };
}
