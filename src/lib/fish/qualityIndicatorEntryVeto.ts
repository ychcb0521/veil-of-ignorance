import type { TradeSignal } from '../signalLibrary';
import { intervalMs, type ResearchInterval } from '../deepRsa/marketData';
import { readQualityMetricAt } from './qualityEntry';
import { additionVetoLabel, validateAdditionVetoes, type QualityAdditionEntryVeto } from './qualityAdditionVeto';
import type { FishReconstructionLoader } from './reconstruction';
import { qualityConditionMet } from './qualityVeto';
import type { HistoryVetoResult } from './qualityVetoHistory';

export function createIndicatorEntryVetoReader(rules:readonly QualityAdditionEntryVeto[], o:{
  row:TradeSignal; load:FishReconstructionLoader; signal:AbortSignal;
}) {
  const active = rules.filter(rule => rule.enabled && rule.kind === 'indicator');
  validateAdditionVetoes(active);
  const readers = active.map(rule => {
    const metric = rule.indicator!;
    const step = intervalMs(metric.snapshot.interval as ResearchInterval);
    const live = o.load.liveAdditionVeto;
    const key = live ? JSON.stringify(['indicator', rule]) : '';
    let cached: {cut:number; result:HistoryVetoResult} | undefined;
    return async (at:number):Promise<HistoryVetoResult> => {
      const cut = Math.floor(at / step) * step;
      if (cached?.cut === cut) return cached.result;
      const calculate = async () => {
        const reading = await readQualityMetricAt(o.row, metric.snapshot, metric.metric, at, 'closed', o.load, at, o.signal, '算法否决');
        let result:HistoryVetoResult = {};
        if (reading.initializing) result = {pending:metric.label + '：等待指标预热', pendingKind:'indicator'};
        else if (qualityConditionMet(reading.value, metric.direction, metric.threshold)) {
          result = {hit:{kind:'indicator', label:additionVetoLabel(rule), reading:`已收盘读数 ${reading.value}${metric.snapshot.unit ?? ''}`}};
        }
        return result;
      };
      const result = live && at <= live.boundary && at >= live.boundary - 60000
        ? await live.read(key, cut, calculate) : await calculate();
      cached = {cut, result};
      return result;
    };
  });
  return async (at:number):Promise<HistoryVetoResult> => {
    let pending:HistoryVetoResult = {};
    for (const read of readers) {
      const result = await read(at);
      if (result.hit) return result;
      if (result.pending) pending = result;
    }
    return pending;
  };
}

/** Warm each independent closed candle; the decision reader still applies the frozen veto order. */
export function warmIndicatorEntryVetoes(rules:readonly QualityAdditionEntryVeto[], options:Parameters<typeof createIndicatorEntryVetoReader>[1], at:number) {
  for (const rule of rules) {
    if (rule.enabled && rule.kind === 'indicator') {
      void createIndicatorEntryVetoReader([rule], options)(at).catch(() => {});
    }
  }
}
