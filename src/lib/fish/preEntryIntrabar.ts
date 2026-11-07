import { qualityMetricPlan, type QualityProgress, type QualityGroup, type QualityBuyFilter } from './quality';
import { findQualityIntrabarExit } from './qualityIntrabar';
import { withTuringInitialization } from './qualityInitialization';
import { planVersionChanges } from './qualityPlanVersions';
import type { FishReconstructionLoader } from './reconstruction';
import { PRE_ENTRY_ZERO_TRADE_VERSION, type PreEntryRun, type PreEntryRecord } from './preEntryMonitor';
import { formatUTC8 } from '../timeFormat';
import { PRE_ENTRY_CONDITIONS_VERSION, validatePreEntryConditions, hasPreEntryVetoes, preEntryVetoes } from './preEntryConditions';
import { createPreEntryGate, preEntryGuardWarmBars } from './preEntryGate';

export function preEntryPlanFilters(plan: QualityGroup): QualityBuyFilter[] {
  if (!plan.rule || !Number.isFinite(plan.rule.threshold)) throw Error(`「${plan.label}」需要填写买入门槛`);
  return [{ id: 'primary', label: plan.label, metric: plan.rule.metric, snapshot: plan.snapshot, direction: plan.rule.direction, threshold: plan.rule.threshold, enabled: true }, ...(plan.buyFilters ?? []).filter(f => f.enabled)];
}

/** Same one-minute, forming-candle engine as holding monitoring; all buy confirmations must agree. */
export async function collectPreEntryIntrabar(task: PreEntryRun, load: FishReconstructionLoader, now: number, signal: AbortSignal,
  onProgress: (progress: QualityProgress) => void,
  bounds?: { start?: (symbol: string) => Promise<number | undefined>; end?: (symbol: string) => Promise<number> }) {
  let done = 0;
  for (const original of task.records) {
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    if (['matched', 'unmatched', 'warming'].includes(original.status)) {
      onProgress({ done: ++done, total: task.records.length, current: original.sample.source.symbol });
      continue;
    }
    let record = { ...original };
    const publish = (patch: Partial<PreEntryRecord>) => { record = { ...record, ...patch, updatedAt: Date.now() }; task.onRecord(record); };
    try {
      if (!Number.isFinite(task.round.hours) || task.round.hours < 0 || task.round.hours > 8784) throw Error('筛选时长无效');
      if (!Number.isFinite(record.startTime) || record.startTime <= 0 || !Number.isFinite(record.cursor)) throw Error('缺少有效筛选起点');
      const selected = task.round.plans?.find(p => p.id === record.planId);
      if (!selected) throw Error('缺少本轮冻结的买入方案');
      if (planVersionChanges(selected).length) throw Error('本轮买入方案的算法版本已变化；请保留旧记录并另开新轮次');
      const v4 = task.round.engine === PRE_ENTRY_CONDITIONS_VERSION;
      if (v4) validatePreEntryConditions(selected.preEntryConditions);
      const vetoes = v4 ? preEntryVetoes(selected.preEntryConditions) : [];
      const excluded = vetoes.filter(v=>v.kind==='indicator').map(v=>({...qualityMetricPlan(v.snapshot!,v.metric!),rule:v,cause:v,entryVeto:true}));
      const filters = preEntryPlanFilters(selected), plans = filters.map(f => qualityMetricPlan(f.snapshot, f.metric));
      const start = await bounds?.start?.(record.sample.source.symbol), availableEnd = await bounds?.end?.(record.sample.source.symbol) ?? now;
      const initialized = selected.initialization ? withTuringInitialization(load, record.sample.source.symbol, start ?? NaN) : load;
      const end = record.endTime ?? Math.floor(Math.min(now, availableEnd, task.round.hours ? record.startTime + task.round.hours * 3600000 : Infinity) / 60000) * 60000;
      const readyAt = start == null || selected.initialization ? record.startTime : Math.max(record.startTime,
        ...[...plans,...excluded].map(({plan}) => Math.ceil(start / plan.step) * plan.step + plan.warm * plan.step),
        ...(v4 && preEntryGuardWarmBars(selected.preEntryConditions) ? [Math.ceil(start/300000)*300000+preEntryGuardWarmBars(selected.preEntryConditions)*300000] : []));
      const resumeAt = record.cursor;
      // v4 restores path-dependent veto state from the fixed scan origin. Old
      // rounds keep their existing resume path and never read the new settings.
      const gated = v4 && hasPreEntryVetoes(selected.preEntryConditions);
      const since = gated ? readyAt : Math.max(record.cursor, readyAt);
      const gate = gated ? createPreEntryGate({conditions:selected.preEntryConditions!,start:record.startTime,row:{...record.sample.source,timeMs:now},load:initialized,signal}) : undefined;
      publish({ status: 'scanning', endTime: end, cursor: Math.max(since,resumeAt) });
      if (since >= end) {
        publish({status: readyAt >= end ? 'warming' : 'unmatched', detail: readyAt >= end ? `当前行情无法完成本方案预热；最早可判断 ${formatUTC8(readyAt)}。可另建图灵杯专用副本，原方案保留。` : '本轮行情范围已结束'});
      } else {
        let lastPaint = 0;
        let waitingForTrade = false;
        const result = await findQualityIntrabarExit({ row: {...record.sample.source, timeMs: now}, ...plans[0], rule: filters[0],
          entry: readyAt, since, end, resumed: since > readyAt, load: initialized, signal, matchMode: 'all',
          zeroTradePolicy: task.round.engine === PRE_ENTRY_ZERO_TRADE_VERSION || v4 ? 'wait' : undefined,
          conditions: [...filters.slice(1).map((f, i) => ({...plans[i+1], rule: f, cause: { id: f.id, label: f.label, kind: 'indicator' as const, direction: f.direction, threshold: f.threshold }})),...excluded],
          entryGate: gate ? async(at,minute)=>{const decision=await gate(at,minute);return at<resumeAt?{...decision,pending:'正在恢复本轮此前的观察状态'}:decision;} : undefined,
          onObservation: (at, observation) => {
            if (at < resumeAt) return;
            waitingForTrade = observation?.waitingForTrade ?? false;
            if (observation?.entryBlocked && at > (record.lastVeto?.at ?? -Infinity)) record.lastVeto={at,reason:observation.entryBlocked,count:(record.lastVeto?.count??0)+1};
            if (observation?.readings) record.readings=observation.readings.map(r=>({key:r.id,value:r.value,at:r.at}));
            if (waitingForTrade && at > (record.zeroTradeWait?.lastAt ?? -Infinity)) {
              record.zeroTradeWait = { count: (record.zeroTradeWait?.count ?? 0) + 1, firstAt: record.zeroTradeWait?.firstAt ?? at, lastAt: at };
            }
            record.cursor = at;
            if (performance.now() - lastPaint >= 150) { lastPaint = performance.now(); publish({detail: waitingForTrade ? `零成交或读数恢复中，暂不判定入选：${formatUTC8(at)}` : observation?.entryBlocked ? `本分钟不入选：${observation.entryBlocked}` : observation?.entryPending ?? `正在筛选 ${formatUTC8(at)}`}); onProgress({done, total:task.records.length, current:`${record.sample.source.symbol} · ${selected.label}`}); }
          } });
        if (result.trigger) publish({status: 'matched', cursor: result.trigger.at, matchedAt: result.trigger.at,
          readings: (result.trigger.readings ?? []).map(r => ({key:r.id, value:r.value, at:r.at})),
          detail: v4 ? '入选算法和确认条件同分钟满足，且全部启用否决均未触发；已停在该入选节点' : '按持仓监测同一套分钟盘中复原流程，买入算法和启用的确认条件首次同时满足；已停在该买入节点'});
        else publish({status:'unmatched', cursor:end, detail:waitingForTrade?'行情末尾仍在等待零成交后的有效读数，未判定入选':v4?'本轮范围内，未出现入选条件全部满足且没有否决的时点':'本轮范围内，买入算法和确认条件未同时满足'});
      }
    } catch (cause) {
      if (signal.aborted) { publish({status:'paused', detail:'已暂停，继续时沿用本轮冻结方案'}); throw cause; }
      publish({status:'error', detail:cause instanceof Error ? cause.message : '动态筛选失败'});
    }
    done++; onProgress({done, total:task.records.length, current:record.sample.source.symbol});
  }
}
