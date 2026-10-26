import type { TradeCampaign, TradeJournal, CampaignEvent } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import type { getCampaignFullData } from '@/lib/journalApi';
import { isQualityCampaignId, qualityCampaignId } from '@/lib/campaignSections';
import { loadQualityStudy } from './qualityStore';
import { archiveQualityStudy, hasQualityCampaign, hasQualityEntry, isCurrentQualityRun, qualityRuleLabel, qualitySellKey, qualityFormulaVersion, qualityVersionedRuleLabel, type QualityCampaignRun } from './qualityCampaignArchive';
import { FISH_DEFAULT_ALGORITHMS } from './cards';
import type { QualityGroup } from './quality';
import { QUALITY_NOTIONAL, hasQualityExit, activeBuyFilters, anyBuyFilters, qualityFilterStatus, qualityDefinition, type FishQualityStudy } from './quality';
import { activeHoldingVetoes } from './qualityVeto';
import { syncQualitySellDefinitions } from './qualityComparison';

/**
 * 【用户要求】2026-10-26「探测比较模块中要增加一个指标"探测信号类别"，用于后续的观察和统计」
 * 类别 = 这条信号命中的探测算法组合（按默认算法顺序排列，不含阈值），如「CBI-2·avg₂ + CBA·avg₂」。
 */
export function qualityDetectorCategory(detectors: readonly QualityGroup[]): string {
  const rank = (d: QualityGroup) => { const i = FISH_DEFAULT_ALGORITHMS.indexOf(d.snapshot.featureId ?? ''); return i < 0 ? FISH_DEFAULT_ALGORITHMS.length : i; };
  const labels = [...new Map([...detectors].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label)).map(d => [d.label, d.label])).values()];
  return labels.length ? labels.join(' + ') : '无探测算法';
}
export type QualityCampaignData = Awaited<ReturnType<typeof getCampaignFullData>>;
const iso = (time: number) => new Date(time).toISOString();
/** Adapt the frozen paper trade into the exact inputs of existing campaign charts/metrics/exports. */
export function buildQualityCampaignData(owner: string, run: QualityCampaignRun, section: 'sell' | 'detect'): QualityCampaignData {
  const { sample, plan, result: r } = run, id = qualityCampaignId(r.key, section), closed = r.status === 'closed';
  const entry = r.entryTime!, price = r.entryPrice!, end = r.endTime ?? entry, pnl = closed ? r.pnl! : null;
  const legId = `${id}-main`, recordId = `${id}-close`, label = qualityRuleLabel(plan), recorded = iso(run.firstEvaluatedAt);
  const detectorLabels = run.detectors.map(d => ({ id: d.id, label: `${d.label} ${d.snapshot.direction ?? '>'} ${d.snapshot.threshold}` }));
  const definition = qualityDefinition(plan.snapshot);
  const opening: CampaignEvent = {
    id: `${id}-entry`, timestamp: iso(entry), event_type: 'main_opened', leg_role: 'main_open', journal_id: legId,
    trade_record_id: closed ? recordId : null, pending_order_id: null, price, size_usdt: QUALITY_NOTIONAL,
    notes: `鱼质量模拟多单 · ${label}`, recorded_at: recorded, direction: 'long', leverage: 1, leg_sequence: 1, order_kind: 'main',
    open_time: iso(entry), entry_price: price,
  };
  const campaign: TradeCampaign = {
    id, user_id: owner, campaign_code: `${section === 'sell' ? 'QS' : 'QD'}-${r.key}`, symbol: sample.source.symbol,
    direction: 'main_long', status: closed ? pnl! > 1e-8 ? 'closed_profit' : pnl! < -1e-8 ? 'closed_loss' : 'closed_breakeven' : 'active',
    strategy_template: 'main_only', title: `${sample.source.symbol} · ${label}`, opened_at: iso(entry), closed_at: closed ? iso(end) : null,
    initial_main_size_usdt: QUALITY_NOTIONAL, initial_leverage: 1, final_realized_pnl: pnl, final_r_multiple: null,
    peak_unrealized_pnl: r.peakPct == null ? null : QUALITY_NOTIONAL * r.peakPct / 100, peak_drawdown: null,
    importance_weight: 0, notes: `${sample.origin === 'library' ? '信号库' : '鱼舱'} · 信号 ${iso(sample.source.timeMs)}\n卖出：${label}\n探测：${detectorLabels.map(d => d.label).join('；') || '无'}\n100 USDT · 1 倍模拟多单；未扣手续费、资金费与滑点。`,
    actual_evolution: [opening, ...(closed ? [{ ...opening, id: `${id}-exit`, timestamp: iso(end), event_type: 'main_fully_closed' as const, price: r.endPrice!, realized_pnl: pnl, close_time: iso(end), exit_price: r.endPrice!, recorded_at: iso(r.evaluatedAt) }] : [])],
    deviation_notes: {}, deleted_at: null, created_at: recorded, updated_at: iso(r.evaluatedAt),
    comparison: { section, runKey: r.key, sellKey: JSON.stringify([qualitySellKey(plan), run.observeHours]), sellLabel: qualityVersionedRuleLabel(plan) + (run.observeHours ? ` · 观察 ${run.observeHours}h` : ''), detectors: detectorLabels, valuedAt: end, category: qualityDetectorCategory(run.detectors),
      sellEvidence: { formula: definition.formula, definitionKey: plan.snapshot.definitionKey!, featureId: plan.snapshot.featureId!,
        metric: plan.rule?.metric ?? plan.metric, version: qualityFormulaVersion(plan), interval: plan.snapshot.interval ?? '5m',
        halfLifeHours: definition.halfLifeHours!, avgHours: definition.avgHours!, source: plan.definitionSource === 'account' ? 'account' : 'historical',
        direction: plan.rule?.direction, threshold: plan.rule?.threshold, reading: r.exitReading ?? r.pendingExit?.reading,
        confirmedAt: closed ? r.endTime : r.pendingExit?.at,
        execution: plan.execution,barOpenAt:r.exitSnapshot?.barOpenTime,
        executedAt:closed ? r.endTime : undefined,
        previousAt:r.exitSnapshot?.previous?.at,previousReading:r.exitSnapshot?.previous?.reading,
        triggerCause:r.exitSnapshot?.cause??r.pendingExit?.cause,triggerAtOpen:r.exitSnapshot?.atOpen,holdingVetoes:activeHoldingVetoes(plan.holdingVetoes).map(v=>({id:v.id,label:v.label,kind:v.kind,direction:v.direction,threshold:v.threshold,formula:v.snapshot?qualityDefinition(v.snapshot).formula:undefined})),
      },
      repair: run.repair,
    },
  };
  const leg: TradeJournal = {
    id: legId, user_id: owner, trade_record_id: closed ? recordId : null, campaign_id: id, leg_role: 'main_open', leg_sequence: 1,
    source: 'retroactive_from_record', symbol: sample.source.symbol, direction: 'long', leverage: 1, position_mode: 'isolated', order_kind: 'main',
    pre_simulated_time: iso(entry), pre_real_time: recorded, pre_entry_price: price, pre_planned_stop_loss: null, pre_planned_take_profit: null,
    pre_entry_reason: campaign.notes, pre_falsification_signal: label, pre_mental_state: 3, pre_mental_trigger: null, pre_risk_awareness: null, pre_risk_management: null,
    pre_checklist_items: null, pre_checklist_passed: null, pre_position_size: QUALITY_NOTIONAL, pre_account_equity_usdt: QUALITY_NOTIONAL, pre_max_loss_usdt: null,
    pre_settlement_mode: 'usdt', pre_settlement_asset: 'USDT',
    post_outcome: pnl == null ? null : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven', post_realized_pnl: pnl, post_r_multiple: null,
    post_reflection: null, post_correct_action: null, post_reviewed_at: null, reason_was_rewritten: false,
    post_simulated_close_time: closed ? iso(end) : null, post_real_close_time: closed ? iso(r.evaluatedAt) : null,
    post_exit_price_snapshot: closed ? r.endPrice : null, created_at: recorded, updated_at: iso(r.evaluatedAt),
  };
  const tradeRecords: TradeRecord[] = closed ? [{ id: recordId, symbol: sample.source.symbol, side: 'LONG', type: 'MARKET', action: 'CLOSE',
    entryPrice: price, exitPrice: r.endPrice!, quantity: QUALITY_NOTIONAL / price, leverage: 1, settlementMode: 'usdt', settlementAsset: 'USDT',
    pnl: pnl!, fee: 0, openFeeUsd: 0, openFeeRate: 0, closeFeeRate: 0, slippage: 0, openTime: entry, closeTime: end,
    openedRealAt: run.firstEvaluatedAt, closedRealAt: r.evaluatedAt, exit_reason_text: r.exitSnapshot?.cause ? r.reason : label,
  }] : [];
  return { campaign, legs: [leg], tradeRecords, pendingOrders: [], reverseHedgeOrders: [], foreignLiveOrders: [], unfilledOrderIds: [], legExitPriceCorrections: {},
    timelineDiagnostics: { mode: 'exact', timelineIds: [], anchorTimelineIds: [], unstampedAnchors: 0, missingAnchorNodes: [], verdicts: {}, disagreements: [] } };
}
/** 各卖出方案的买入过滤，一行写完：「状态 S 原始值：状态 S 原始值 > 0.7；CDA 原始值：不过滤」。都没开过滤时为空。 */
export function qualityBuyFilterSummary(study: FishQualityStudy): string {
  if (!anyBuyFilters(study)) return '';
  return (study.sellPlans ?? []).map(plan => { const filters = activeBuyFilters(study, plan);
    return `${plan.label}：${filters.length ? filters.map(f => `${f.label} ${f.direction} ${f.threshold}`).join(' 且 ') : '不过滤'}`; }).join('；');
}
export function qualityCampaignDataFromStudy(owner: string, study: FishQualityStudy, section: 'sell' | 'detect' | 'quality'): QualityCampaignData[] {
  // 卖出比较跟随各卖出方案自己的买入过滤：只列满足那套方案条件的交易，和鱼质量里的卖出对照一致
  const readings = new Map((study.filterReadings ?? []).map(r => [r.key, r]));
  const detection = (run: QualityCampaignRun) => !!run.detectionAt && run.detectors.length > 0;
  if (section === 'quality') {
    // 合并板块（卖出与探测）：卖出试验里买入的交易 + 固定卖出方案做探测的交易，同一场只列一次
    const sell = (run: QualityCampaignRun) => { const plan = study.sellPlans?.find(p => p.id === run.plan.id); return !activeBuyFilters(study, plan).length || qualityFilterStatus(study, run.sample, plan, readings).state === 'pass'; };
    return (archiveQualityStudy(study).campaignRuns ?? []).filter(run => isCurrentQualityRun(run) && hasQualityExit(run.plan) && hasQualityCampaign(run.result) && (detection(run) || sell(run)))
      .map(run => buildQualityCampaignData(owner, run, detection(run) ? 'detect' : 'sell'));
  }
  const bought = (run: QualityCampaignRun) => {
    if (section !== 'sell') return true;
    const plan = study.sellPlans?.find(p => p.id === run.plan.id);
    return !activeBuyFilters(study, plan).length || qualityFilterStatus(study, run.sample, plan, readings).state === 'pass';
  };
  return (archiveQualityStudy(study).campaignRuns ?? []).filter(run => isCurrentQualityRun(run) && hasQualityExit(run.plan) && hasQualityCampaign(run.result) && (section === 'sell' || !!run.detectionAt && run.detectors.length > 0)
    && bought(run))
    .map(run => buildQualityCampaignData(owner, run, section));
}
export async function listQualityCampaignData(owner: string, section: 'sell' | 'detect' | 'quality' = 'quality') {
  const loaded = await loadQualityStudy(owner);
  const selected = syncQualitySellDefinitions(loaded.study).sellPlans?.find(plan => plan.id === loaded.study.selectedSellId && hasQualityExit(plan));
  const buyFilterLabel = section !== 'detect' ? qualityBuyFilterSummary(loaded.study) : '';
  return { rows: qualityCampaignDataFromStudy(owner, loaded.study, section), warning: loaded.warning, buyFilterLabel, repair: loaded.study.campaignRepair,
    selectedSellKey: selected ? JSON.stringify([qualitySellKey(selected), loaded.study.observeHours]) : undefined };
}
export async function loadQualityCampaignData(owner: string, id: string): Promise<QualityCampaignData> {
  if (!isQualityCampaignId(id)) throw new Error('比较战役链接无效');
  const section = id.startsWith('fish-detect-') ? 'detect' : 'sell';
  const loaded = await loadQualityStudy(owner), runs = archiveQualityStudy(loaded.study).campaignRuns ?? [];
  let run = runs.find(row => qualityCampaignId(row.result.key,section) === id);
  const visited = new Set<string>();
  while (run?.supersededBy) {
    if (visited.has(run.result.key)) throw new Error('纠错版本引用循环，请重新运行纠错');
    visited.add(run.result.key); run = runs.find(row => row.result.key === run!.supersededBy);
  }
  if (!run) throw new Error('本账号未找到这场比较战役，请在保存鱼质量结果的浏览器中打开');
  if (!hasQualityEntry(run.result)) throw new Error(`此战役纠错未通过：${run.repair?.error ?? '缺少可靠成交数据'}。原记录仍保留，可在比较列表重试纠错。`);
  return buildQualityCampaignData(owner,run,section);
}
