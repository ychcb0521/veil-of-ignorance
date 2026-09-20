import { Layers } from 'lucide-react';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import type {
  CampaignCounterfactualManualLeg,
  CampaignCounterfactualResult,
  LegRole,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import type { LegExecutionMethod, LegExecutionMethods } from '@/lib/legExecutionMethod';

interface Props {
  campaign: TradeCampaign;
  legs: CampaignCounterfactualManualLeg[];
  result: CampaignCounterfactualResult;
  title?: string;
}

function counterfactualExecutionMethods(leg: CampaignCounterfactualManualLeg, filled: boolean): LegExecutionMethods {
  const actual = leg.actual;
  const sameTime = (left: string, right: string) => Number.isFinite(Date.parse(left)) && Date.parse(left) === Date.parse(right);
  const samePrice = (left: number, right: number) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-9;
  const openUnchanged = actual != null && leg.direction === actual.direction
    && sameTime(leg.open_time, actual.open_time) && samePrice(leg.entry_price, actual.entry_price);
  const closeUnchanged = actual != null && !actual.close_time_fallback && !actual.still_open
    && sameTime(leg.close_time, actual.close_time) && samePrice(leg.exit_price, actual.exit_price);
  const method = (kind: 'manual' | 'order' | 'unknown' | undefined, unchanged: boolean, action: string): LegExecutionMethod => {
    if (!filled || !unchanged || (kind !== 'manual' && kind !== 'order')) {
      return {
        kind: 'unknown', label: '未记录',
        reason: !filled ? '本条反事实未成交，没有实际操作方式。'
          : action === '平仓' && (actual?.close_time_fallback || actual?.still_open) ? '没有已确认的实际平仓；模拟平仓时间不代表实际操作方式。'
          : actual && !unchanged ? `反事实${action}参数已改变，不沿用实际交易的操作方式；修改模拟参数不代表手动交易。`
            : `保存分支没有可信的实际${action}方式记录；修改模拟参数不代表手动交易。`,
      };
    }
    return {
      kind, label: kind === 'manual' ? '手动' : '非手动',
      reason: `${action}参数未改动，沿用分支保存的实际交易方式。`,
    };
  };
  return { open: method(actual?.entry_method, openUnchanged, '开仓'), close: method(actual?.exit_method, closeUnchanged, '平仓') };
}

/**
 * 反事实结果直接使用原始战役的 CampaignLegsList。这里只把模拟结果适配成它的输入，
 * 不复制表格：列序、列宽、冻结列、阶段、占比、手续费及合计行会始终与原始 Legs 一致。
 */
function adaptCounterfactualLegs(
  campaign: TradeCampaign,
  legs: CampaignCounterfactualManualLeg[],
  result: CampaignCounterfactualResult,
): { journals: TradeJournal[]; records: TradeRecord[]; executionMethods: Map<string, LegExecutionMethods> } {
  const records: TradeRecord[] = [];
  const executionMethods = new Map<string, LegExecutionMethods>();
  const journals = legs.map((leg, index) => {
    const summary = result.legs_summary[index]
      ?? result.legs_summary.find(item => item.leg_role === leg.leg_role);
    const filled = leg.enabled && leg.filled !== false && summary?.status !== 'never_triggered';
    executionMethods.set(leg.id, counterfactualExecutionMethods(leg, filled));
    const recordId = filled ? `counterfactual-record-${leg.id}` : null;
    const openTime = new Date(leg.open_time).getTime();
    const closeTime = new Date(leg.close_time).getTime();
    const coinSettled = leg.settlement_mode === 'coin';
    const contractSizeUsd = leg.contract_size_usd ?? 10;
    const quantity = coinSettled
      ? leg.size_usdt / contractSizeUsd
      : leg.entry_price > 0 ? leg.size_usdt / leg.entry_price : 0;

    if (recordId) {
      records.push({
        id: recordId,
        positionId: `counterfactual-position-${leg.id}`,
        symbol: campaign.symbol,
        side: leg.direction === 'short' ? 'SHORT' : 'LONG',
        type: 'MARKET',
        action: 'CLOSE',
        entryPrice: leg.entry_price,
        exitPrice: leg.exit_price,
        quantity,
        leverage: leg.leverage,
        settlementMode: coinSettled ? 'coin' : 'usdt',
        contractSizeUsd: coinSettled ? contractSizeUsd : undefined,
        contracts: coinSettled ? quantity : undefined,
        notionalUsd: leg.size_usdt,
        pnl: summary?.realized_pnl_usdt ?? 0,
        fee: summary?.close_fee_usdt ?? 0,
        openFeeUsd: summary?.open_fee_usdt,
        slippage: 0,
        openTime: Number.isFinite(openTime) ? openTime : 0,
        closeTime: Number.isFinite(closeTime) ? closeTime : 0,
      });
    }

    // 交易情绪、评价等字段不属于反事实结果；CampaignLegsList 所需的交易字段均在这里提供。
    return {
      id: leg.id,
      user_id: campaign.user_id,
      trade_record_id: recordId,
      campaign_id: campaign.id,
      leg_role: leg.leg_role as LegRole,
      leg_sequence: index + 1,
      source: 'live',
      symbol: campaign.symbol,
      direction: leg.direction,
      leverage: leg.leverage,
      position_mode: null,
      order_kind: leg.leg_role.startsWith('hedge_') || leg.leg_role === 'reentry_hedge' ? 'hedge' : 'main',
      pre_simulated_time: leg.open_time,
      pre_real_time: leg.open_time,
      pre_entry_price: leg.entry_price,
      pre_planned_stop_loss: null,
      pre_planned_take_profit: null,
      pre_entry_reason: null,
      pre_mental_state: 3,
      pre_mental_trigger: null,
      pre_risk_awareness: null,
      pre_risk_management: null,
      pre_checklist_items: null,
      pre_checklist_passed: null,
      pre_position_size: leg.size_usdt,
      pre_settlement_mode: coinSettled ? 'coin' : 'usdt',
      pre_contract_size_usd: coinSettled ? contractSizeUsd : null,
      pre_contracts: coinSettled ? quantity : null,
      pre_max_loss_usdt: null,
      post_outcome: filled ? ((summary?.realized_pnl_usdt ?? 0) >= 0 ? 'win' : 'loss') : null,
      post_realized_pnl: filled ? summary?.realized_pnl_usdt ?? 0 : null,
      post_r_multiple: null,
      post_exit_price_snapshot: filled ? leg.exit_price : null,
      post_reflection: null,
      post_correct_action: null,
      post_reviewed_at: filled ? leg.close_time : null,
      post_simulated_close_time: filled ? leg.close_time : null,
      post_real_close_time: null,
      reason_was_rewritten: false,
      created_at: leg.open_time,
      updated_at: leg.close_time,
    } as TradeJournal;
  });

  return { journals, records, executionMethods };
}

export function CounterfactualLegsTable({ campaign, legs, result, title = '反事实 Legs' }: Props) {
  const { journals, records, executionMethods } = adaptCounterfactualLegs(campaign, legs, result);

  return (
    <section data-testid="counterfactual-result-legs" className="mt-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <Layers className="h-4 w-4 text-muted-foreground" />
          {title}
        </div>
        <div className="text-[11px] text-muted-foreground">{journals.length} 条</div>
      </div>
      <CampaignLegsList
        legs={journals}
        tradeRecords={records}
        executionMethodsByLeg={executionMethods}
        initialExpectedMaxLoss={result.initial_expected_max_loss ?? null}
        campaignDirection={campaign.direction}
      />
    </section>
  );
}
