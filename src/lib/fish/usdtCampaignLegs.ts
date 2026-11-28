import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import type { UsdtLiveCampaign } from './usdtLiveCampaign';

type Fees = Record<string, number>;
function addFee(fees: Fees, asset: string, amount: number) {
  fees[asset] = (fees[asset] ?? 0) + amount;
}

export function displayExchangeFees(fees: Fees | undefined) {
  return fees && Object.entries(fees).map(([asset, amount]) => Number(amount.toFixed(8)) + ' ' + asset).join(' / ');
}

export function totalExchangeFees(legs: readonly TradeJournal[]) {
  if (!legs.some(leg => leg.exchange_fees)) return;
  const total: Fees = {};
  for (const leg of legs) {
    for (const [asset, amount] of Object.entries(leg.exchange_fees ?? {})) addFee(total, asset, amount);
  }
  return displayExchangeFees(total);
}

type Entry = {
  fees: Fees; heldFees: Fees; mirrorFees: Fees;
  orderId: string; at: number; quantity: number; notional: number; held: number;
  heldCost: number; pendingFee: number; closed: number; exitValue: number; lastExit: number; pnl: number;
};

// Binance reports realized P&L against the combined position. Attribute a reduction
// proportionally to the entry orders still held, keeping the exchange total authoritative.
export function projectUsdtCampaignLegs(owner: string, id: string, live: UsdtLiveCampaign) {
  const entries = new Map<string, Entry>();
  const tradeRecords: TradeRecord[] = [];
  const iso = (at: number) => new Date(at).toISOString();
  const side = live.direction === 'long' ? 'LONG' : 'SHORT';
  const knownFees = live.fills.every(fill => !fill.commission || fill.commissionAsset === live.asset);
  let held = 0;
  for (const fill of live.fills) {
    const qty = Number(fill.positionQuantity), price = Number(fill.price);
    if (!(qty > 0 && price > 0)) continue;
    if (fill.action !== 'reduce') {
      const entry = entries.get(fill.orderId) ?? {orderId:fill.orderId, at:fill.at, quantity:0, notional:0, fees:{}, heldFees:{}, mirrorFees:{},
        held:0, heldCost:0, pendingFee:0, closed:0, exitValue:0, lastExit:0, pnl:0};
      addFee(entry.fees, fill.commissionAsset, fill.commission);
      addFee(entry.heldFees, fill.commissionAsset, fill.commission);
      entry.quantity += qty;
      entry.notional += qty * price;
      entry.held += qty;
      entry.heldCost += qty * price;
      entry.pendingFee += fill.commissionAsset === live.asset ? fill.commission : 0;
      entries.set(fill.orderId, entry);
      held += qty;
      continue;
    }
    if (held <= 0) continue;
    const fraction = Math.min(1, qty / held);
    const open = [...entries.values()].filter(entry => entry.held > 0);
    const cost = open.reduce((sum, entry) => sum + entry.heldCost, 0) / held;
    for (const entry of open) {
      const share = entry.held / held;
      const mirror = live.actionByOrder?.[fill.orderId] === 'mirror';
      addFee(entry.fees, fill.commissionAsset, fill.commission * share);
      if (mirror) addFee(entry.mirrorFees, fill.commissionAsset, fill.commission * share);
      for (const [asset, amount] of Object.entries(entry.heldFees)) {
        if (mirror) addFee(entry.mirrorFees, asset, amount * fraction);
        entry.heldFees[asset] = amount * (1 - fraction);
      }
      const quantity = entry.held * fraction;
      const basis = entry.heldCost / entry.held;
      const openFee = entry.pendingFee * fraction;
      const closeFee = fill.commissionAsset === live.asset ? fill.commission * share : 0;
      const gross = fill.realized * share + (side === 'LONG' ? 1 : -1) * (cost - basis) * quantity;
      const pnl = knownFees ? gross - openFee - closeFee : gross;
      const positionId = id + '-entry-' + entry.orderId;
      tradeRecords.push({id:positionId + '-close-' + fill.id, positionId, symbol:live.symbol, side,
        action:'CLOSE', type:null, quantity,
        exit_reason_text:live.actionByOrder?.[fill.orderId] === 'mirror' ? '镜像止盈' : undefined, entryPrice:basis, exitPrice:price,
        leverage:null, pnl, fee:closeFee, openFeeUsd:openFee, slippage:0, settlementMode:'usdt', settlementAsset:live.asset,
        openTime:entry.at, openedRealAt:entry.at, closeTime:fill.at, closedRealAt:fill.at});
      entry.closed += quantity;
      entry.exitValue += quantity * price;
      entry.lastExit = fill.at;
      entry.pnl += pnl;
      entry.held *= 1 - fraction;
      entry.heldCost *= 1 - fraction;
      entry.pendingFee *= 1 - fraction;
    }
    held *= 1 - fraction;
  }
  const legs = [...entries.values()].map((entry, index): TradeJournal => {
    const settled = entry.lastExit && (live.closedAt || entry.held <= entry.quantity * 1e-12);
    const closed = settled ? iso(entry.lastExit) : null;
    const positionId = id + '-entry-' + entry.orderId;
    return {
      exchange_fees:entry.fees, id:positionId, trade_record_id:positionId, campaign_id:id, user_id:owner, leg_sequence:index+1,
      leg_role:index ? `main_add_${index}` : 'main_open', source:'retroactive_from_record', symbol:live.symbol,
      direction:live.direction, leverage:null, position_mode:null, order_kind:'main',
      pre_simulated_time:iso(entry.at), pre_real_time:iso(entry.at), pre_entry_price:entry.notional / entry.quantity,
      pre_position_size:entry.notional, pre_settlement_mode:'usdt', pre_settlement_asset:live.asset,
      pre_entry_reason:'币安成交委托号 ' + entry.orderId, pre_falsification_signal:null, pre_planned_stop_loss:null,
      pre_planned_take_profit:null, pre_mental_state:null, pre_mental_trigger:null, pre_risk_awareness:null,
      pre_risk_management:null, pre_checklist_items:null, pre_checklist_passed:null, pre_max_loss_usdt:null,
      post_realized_pnl:entry.closed ? entry.pnl : null, post_outcome:!settled ? null : entry.pnl > 0 ? 'win' : entry.pnl < 0 ? 'loss' : 'breakeven',
      post_simulated_close_time:closed, post_real_close_time:closed, post_exit_price_snapshot:closed ? entry.exitValue / entry.closed : null,
      post_r_multiple:null, post_reflection:null, post_correct_action:null, post_reviewed_at:null, reason_was_rewritten:false,
      created_at:iso(entry.at), updated_at:iso(live.fills.at(-1)!.at),
    };
  });
  const mirrorRecords = new Map<string, TradeRecord[]>();
  for (const record of tradeRecords) {
    if (record.exit_reason_text !== '镜像止盈' || !record.positionId) continue;
    const key = record.positionId;
    const group = mirrorRecords.get(key) ?? [];
    group.push(record);
    mirrorRecords.set(key, group);
    record.positionId = key + '-mirror';
  }
  const orderedEntries = [...entries.values()];
  const detailedLegs = legs.flatMap((leg, index) => {
    const cuts = mirrorRecords.get(leg.id);
    if (!cuts?.length) return [leg];
    const quantity = cuts.reduce((sum, cut) => sum + cut.quantity, 0);
    const cost = cuts.reduce((sum, cut) => sum + cut.entryPrice * cut.quantity, 0);
    const pnl = cuts.reduce((sum, cut) => sum + cut.pnl, 0);
    const mirrorId = leg.id + '-mirror';
    const close = iso(cuts.at(-1)!.closeTime);
    const mirrorFees = orderedEntries[index].mirrorFees;
    const mirror: TradeJournal = {...leg, exchange_fees:mirrorFees, id:mirrorId, trade_record_id:mirrorId, leg_role:'mirror_tp',
      pre_entry_price:cost / quantity, pre_position_size:cost, pre_entry_reason:'币安镜像止盈成交',
      post_simulated_close_time:close, post_real_close_time:close,
      post_exit_price_snapshot:cuts.reduce((sum, cut) => sum + cut.exitPrice * cut.quantity, 0) / quantity,
      post_realized_pnl:pnl, post_outcome:pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven'};
    const remaining = leg.pre_position_size! - cost;
    if (remaining <= 1e-12 * leg.pre_position_size!) return [mirror];
    const others = tradeRecords.filter(record => record.positionId === leg.id);
    const otherPnl = others.length ? others.reduce((sum, cut) => sum + cut.pnl, 0) : null;
    const otherQuantity = others.reduce((sum, cut) => sum + cut.quantity, 0);
    const remainingFees = {...leg.exchange_fees};
    for (const [asset, fee] of Object.entries(mirrorFees)) addFee(remainingFees, asset, -fee);
    return [{...leg, exchange_fees:remainingFees, pre_position_size:remaining, post_realized_pnl:otherPnl,
      post_exit_price_snapshot:leg.post_real_close_time && otherQuantity ? others.reduce((sum, cut) => sum + cut.exitPrice * cut.quantity, 0) / otherQuantity : null,
      post_outcome:!leg.post_real_close_time || otherPnl == null ? null : otherPnl > 0 ? 'win' as const : otherPnl < 0 ? 'loss' as const : 'breakeven' as const}, mirror];
  });
  return {legs:detailedLegs.map((leg, index) => ({...leg, leg_sequence:index + 1})), tradeRecords};
}
