import {HOLDING_LEDGER_ADDITION_VERSION,replayQualityHoldingLedger} from './qualityHoldingLedger';
import type {TradeRecord} from '@/types/trading';
import {qualityAdditionFills} from './qualityAddition';
import type { TradeCampaign } from '@/types/journal';
import type { ChartMarker, VerticalLine } from '@/components/journal/ReplayCandleChart';
import { campaignHalfMirror } from './qualityPresentation';
import { mirrorFillGainPct } from './qualityMirror';

export const MIRROR_BOARD_COLOR = '#B98500';
const finite = (n: number | null | undefined) => n != null && Number.isFinite(n) ? n : null;
export const mirrorPercentText = (n: number) => +(n * 100).toPrecision(8);

/** Frozen execution only: changing today's settings or chart interval cannot move a fill. */
export function qualityMirrorBoard(campaign: TradeCampaign) {
  const holding = campaign.comparison?.sellEvidence;
  const manual = campaign.comparison?.instant?.manual;
  const evidence = campaign.comparison?.instant ?? holding;
  const fill = evidence?.mirrorFill ?? holding?.mirrorFill;
  const rule = evidence?.mirrorTakeProfit ?? holding?.mirrorTakeProfit;
  if (!rule?.enabled && !fill) return null;
  const metrics = campaign.comparison?.holdingMetrics;
  const opening = campaign.actual_evolution.find(e => e.event_type === 'main_opened');
  const entryPrice = finite(metrics?.entryPrice) ?? finite(opening?.entry_price) ?? finite(opening?.price);
  const initialNotional = finite(metrics?.initialNotional) ?? finite(campaign.initial_main_size_usdt);
  const additions=qualityAdditionFills(holding ?? {}),addition = additions[0];
  const totalInvested = finite(metrics?.totalInvested) ?? initialNotional;
  const returnPct = finite(metrics?.returnPct) ?? (campaign.closed_at && totalInvested && campaign.final_realized_pnl != null ? campaign.final_realized_pnl / totalInvested * 100 : null);
  const totalPnl = manual && campaign.closed_at ? campaign.final_realized_pnl
    : totalInvested != null && returnPct != null ? totalInvested * returnPct / 100 : null;
  const gainPct = mirrorFillGainPct(entryPrice ?? undefined, fill);
  const originalQuantity = initialNotional != null && entryPrice != null && entryPrice > 0 ? initialNotional / entryPrice : null;
  const totalQuantity = originalQuantity != null ? originalQuantity + additions.reduce((n,a)=>n+a.quantity,0) : null;
  const ledger=additions.some(a=>a.positionVersion===HOLDING_LEDGER_ADDITION_VERSION)&&initialNotional&&entryPrice?replayQualityHoldingLedger({notional:initialNotional,entryPrice,entryAt:Date.parse(campaign.opened_at),additions,mirror:fill,reductions:holding?.additionReductions,includeIntraminute:true,details:false}):undefined;
  const quantity = ledger&&fill?ledger.mirrorQuantity:fill && totalQuantity != null ? fill.fraction === 1 ? totalQuantity : originalQuantity! * fill.fraction : null;
  const mirrorPnl = fill && initialNotional != null && gainPct != null ? finite(metrics?.mirrorRealizedPnl) ?? initialNotional * fill.fraction * gainPct / 100 : null;
  const remainingPnl = mirrorPnl != null && totalPnl != null ? manual || ledger ? totalPnl - mirrorPnl:finite(metrics?.remainingPnl) ?? totalPnl - mirrorPnl : null;
  const soldFraction = fill?.fraction ?? 0;
  const held = campaign.comparison?.instant?.openPosition;
  const remainingFraction = campaign.closed_at ? 0 : manual && held && totalQuantity ? held.quantity / totalQuantity : ledger&&totalQuantity?ledger.held/totalQuantity:addition && totalQuantity ? (totalQuantity - (quantity ?? 0)) / totalQuantity : 1 - soldFraction;
  const title = '镜像平衡减仓';
  const status = fill ? '已成交' : campaignHalfMirror(campaign)?.label ?? '待评估';
  return { title, status, fill, marginBased: !!campaign.comparison?.instant, rule, entryPrice, initialNotional, totalInvested, addition, additions, gainPct, mirrorPnl, remainingPnl, totalPnl, returnPct, quantity,
    soldFraction, remainingFraction, closed: !!campaign.closed_at, valuedAt: campaign.comparison?.valuedAt,
    remainingText: manual ? fill ? campaign.closed_at ? '镜像成交后的余仓已按手动成交记录结算' : `余仓 ${mirrorPercentText(remainingFraction)}% · 手动接管` : '手动接管 · 无镜像成交' : fill ? campaign.closed_at ? soldFraction === 1 ? '全部币数已止盈' : addition?`原始余仓＋全部加仓共 ${+(ledger?.held??(totalQuantity??0)-(quantity??0)).toPrecision(8)} 币已全部卖出`:`余仓 ${mirrorPercentText(1-soldFraction)}% 已按原卖出条件卖出` : `余仓 ${mirrorPercentText(remainingFraction)}% 继续按原卖出条件运行` : campaign.closed_at ? '未触发镜像平衡减仓，按原卖出条件结束' : '尚未触发，原仓位继续运行' };
}

export function qualityMirrorChartArtifacts(campaign: TradeCampaign): { markers: ChartMarker[]; verticalLines: VerticalLine[] } {
  const board = qualityMirrorBoard(campaign);
  const fill = board?.fill;
  if (!fill) return { markers: [], verticalLines: [] };
  const sold = mirrorPercentText(fill.fraction);
  return {
    markers: [{ time: fill.at, price: fill.price, shape: 'square', color: MIRROR_BOARD_COLOR,
      label: `${board.title} · 卖出 ${sold}%${board.gainPct != null ? ` · 涨幅 +${board.gainPct.toFixed(2)}%` : ''}` }],
    verticalLines: [{ time: fill.at, color: MIRROR_BOARD_COLOR, labelColor: MIRROR_BOARD_COLOR, width: 1.4, z: 6, dashed: true }],
  };
}

/** One final sale marker aggregates every remaining acquisition lot. */
export function qualityFinalSale(campaign:TradeCampaign,records:readonly TradeRecord[]){
 if(!campaign.comparison||!campaign.closed_at)return;
 const at=Date.parse(campaign.closed_at),closes=records.filter(r=>r.action==='CLOSE'&&r.closeTime===at&&r.exit_reason_text!=='镜像止盈');
 if(!closes.length)return;
 const quantity=closes.reduce((n,r)=>n+r.quantity,0),price=closes.reduce((n,r)=>n+r.quantity*r.exitPrice,0)/quantity;
 return {at,price,quantity,label:qualityAdditionFills(campaign.comparison.sellEvidence??{}).length?'余仓＋加仓 · 全部卖出':'余仓 · 全部卖出'};
}
