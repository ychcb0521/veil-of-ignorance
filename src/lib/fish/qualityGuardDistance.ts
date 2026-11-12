import { DBL5_DEF } from '../deepDig/features';
import { DBL5_STEP, dbl5GuardVersion, DBL5_RETEST_GUARD_VERSION } from '../dbl5m';
import { formatUTC8 } from '../timeFormat';
import { compileFishProgram } from './algorithm';
import { createNativeGuardReader } from './preEntryGuardEvent';
import { ADDITION_VETO_LABELS, validateAdditionVetoes, type QualityAdditionEntryVeto, type VetoBar } from './qualityAdditionVeto';
import type { HistoryVetoResult } from './qualityVetoHistory';
import { FishError, validateFishBars } from './shared';

const MINUTE = 60_000;
const label = ADDITION_VETO_LABELS['guard-distance'];
const pending = (reason: string): HistoryVetoResult => ({ pending: label + '：' + reason, pendingKind: 'guard-distance' });

export function createGuardDistanceVetoReader(
  rule: QualityAdditionEntryVeto,
  options: Parameters<typeof createNativeGuardReader>[0],
  availableStart?: number,
) {
  validateAdditionVetoes([rule]);
  const parameters = rule.guardDistance!.parameters;
  const threshold = rule.atr!;
  const readGuard = createNativeGuardReader(options, { ...DBL5_DEF, DBL5_config: parameters }, availableStart);
  const guardName = dbl5GuardVersion(parameters) === DBL5_RETEST_GUARD_VERSION ? '防守线-20261112' : '防守线 v1';
  const minutePlan = compileFishProgram(
    { id: 'guard-distance-price', name: '防守线距离收盘价', short: '价格', definition: '', formula: 'C', scale: 1, unit: '', positive: '1', control: '0', interval: '1m' },
    { statistic: '结果', direction: '>', threshold: 0, constraints: [] },
  );
  return async (at: number, minute?: VetoBar): Promise<HistoryVetoResult> => {
    const closeAt = Math.floor(at / MINUTE) * MINUTE;
    try {
      const { row } = await readGuard(closeAt);
      const line = row?.darvas_5m_guard, atr = row?.darvas_5m_guard_atr;
      if (!row || row.at !== Math.floor(closeAt / DBL5_STEP) * DBL5_STEP
        || line == null || !(line > 0) || !Number.isFinite(line)
        || atr == null || !(atr > 0) || !Number.isFinite(atr)) {
        return pending('等待有效防守线与 5 分钟 ATR(14)');
      }

      let price = minute?.openTime === closeAt - MINUTE ? minute.close : undefined;
      if (price == null) {
        const bars = await options.load(options.row, closeAt - MINUTE, closeAt, minutePlan, options.signal);
        validateFishBars(bars, closeAt, 1, MINUTE);
        price = bars[0].close;
      }
      if (!(price > 0) || !Number.isFinite(price)) return pending('缺少候选时点有效的 1 分钟收盘价');
      if (price > line + threshold * atr) {
        const multiple = (price - line) / atr;
        return { hit: {
          kind: 'guard-distance', label,
          reading: `1 分钟收盘价 ${price} · ${guardName} ${line}（${formatUTC8(row.at)}） · 5 分钟 ATR(14) ${atr} · 高出 ${multiple} ATR，超过阈值 ${threshold} ATR`,
        } };
      }
      return {};
    } catch (error) {
      if (options.signal.aborted || !(error instanceof FishError) || !['history', 'gap'].includes(error.kind)) throw error;
      return pending('缺少连续的已收盘行情，暂无法判定');
    }
  };
}
