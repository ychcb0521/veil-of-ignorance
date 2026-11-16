import { DBL5_DEF, dbl5VariantDefinition } from '../deepDig/features';
import { DBL5_GUARD_VERSION, DBL5_PROFILES, dbl5Step, dbl5GuardVersion, DBL5_RETEST_GUARD_VERSION, type Dbl5Config } from '../dbl5m';
import { formatUTC8 } from '../timeFormat';
import { compileFishProgram } from './algorithm';
import { createNativeGuardReader } from './preEntryGuardEvent';
import { ADDITION_VETO_LABELS, validateAdditionVetoes, type QualityAdditionEntryVeto, type VetoBar } from './qualityAdditionVeto';
import type { HistoryVetoResult } from './qualityVetoHistory';
import { FishError, validateFishBars } from './shared';

const MINUTE = 60_000;

const guardChoices=([
  { metric: 'guard-distance-atr-v1', version: DBL5_GUARD_VERSION, name: '防守线 v1' },
  { metric: 'guard-distance-atr-retest-v1', version: DBL5_RETEST_GUARD_VERSION, name: '防守线-20261112' },
] as const);
export const guardDistanceSignalChoices = (['5m','1h'] as const).flatMap(timeframe=>guardChoices.map(choice=>{
  const {id,label}=DBL5_PROFILES[timeframe];
  return {...choice,timeframe,key:id+':'+choice.metric,featureId:id,
    label:'距 '+label+' 防守线（ATR） · '+choice.name,group:label+' 防守线'};
}));
export const guardDistanceDefinition=(parameters:Dbl5Config)=>({
  ...(parameters.timeframe==='1h'?dbl5VariantDefinition('1h'):DBL5_DEF),DBL5_config:parameters,
});
export const guardDistanceSignalChoice = (featureId: string | undefined, metric: string) =>
  guardDistanceSignalChoices.find(choice => choice.featureId === featureId && choice.metric === metric);

type GuardDistanceReading = { at: number; guardAt: number; price: number; line: number; atr: number; multiple: number };
export function createGuardDistanceReader(
  parameters: Dbl5Config,
  options: Parameters<typeof createNativeGuardReader>[0],
  availableStart?: number,
) {
  const step=dbl5Step(parameters.timeframe);
  const atrPeriod=DBL5_PROFILES[parameters.timeframe].periodLabel;
  const readGuard = createNativeGuardReader(options, guardDistanceDefinition(parameters), availableStart);
  const minutePlan = compileFishProgram(
    { id: 'guard-distance-price', name: '防守线距离收盘价', short: '价格', definition: '', formula: 'C', scale: 1, unit: '', positive: '1', control: '0', interval: '1m' },
    { statistic: '结果', direction: '>', threshold: 0, constraints: [] },
  );
  return async (at: number, minute?: VetoBar): Promise<GuardDistanceReading | { pending: string }> => {
    const closeAt = Math.floor(at / MINUTE) * MINUTE;
    try {
      const { row } = await readGuard(closeAt);
      const line = row?.darvas_5m_guard, atr = row?.darvas_5m_guard_atr;
      if (!row || row.at !== Math.floor(closeAt / step) * step
        || line == null || !(line > 0) || !Number.isFinite(line)
        || atr == null || !(atr > 0) || !Number.isFinite(atr)) {
        return { pending: `等待有效防守线与 ${atrPeriod} ATR(14)` };
      }

      let price = minute?.openTime === closeAt - MINUTE ? minute.close : undefined;
      if (price == null) {
        const bars = await options.load(options.row, closeAt - MINUTE, closeAt, minutePlan, options.signal);
        validateFishBars(bars, closeAt, 1, MINUTE);
        price = bars[0].close;
      }
      if (!(price > 0) || !Number.isFinite(price)) return { pending: '缺少候选时点有效的 1 分钟收盘价' };
      return { at: closeAt, guardAt: row.at, price, line, atr, multiple: (price - line) / atr };
    } catch (error) {
      if (options.signal.aborted || !(error instanceof FishError) || !['history', 'gap'].includes(error.kind)) throw error;
      return { pending: '缺少连续的已收盘行情，暂无法判定' };
    }
  };
}

export function createGuardDistanceVetoReader(
  rule: QualityAdditionEntryVeto,
  options: Parameters<typeof createNativeGuardReader>[0],
  availableStart?: number,
) {
  validateAdditionVetoes([rule]);
  const parameters = rule.guardDistance!.parameters;
  const profile=DBL5_PROFILES[parameters.timeframe];
  const label=parameters.timeframe==='5m'?ADDITION_VETO_LABELS['guard-distance']:'距 '+profile.label+' 防守线过远';
  const threshold = rule.atr!;
  const read = createGuardDistanceReader(parameters, options, availableStart);
  const guardName = dbl5GuardVersion(parameters) === DBL5_RETEST_GUARD_VERSION ? '防守线-20261112' : '防守线 v1';
  return async (at: number, minute?: VetoBar): Promise<HistoryVetoResult> => {
    const result = await read(at, minute);
    if ('pending' in result) return {pending:label+'：'+result.pending,pendingKind:'guard-distance'};
    const { price, line, atr, multiple, guardAt } = result;
    if (price > line + threshold * atr) {
      return { hit: {
        kind: 'guard-distance', label,
        reading: `1 分钟收盘价 ${price} · ${guardName} ${line}（${formatUTC8(guardAt)}） · ${profile.periodLabel} ATR(14) ${atr} · 高出 ${multiple} ATR，超过阈值 ${threshold} ATR`,
      } };
    }
    return {};
  };
}
