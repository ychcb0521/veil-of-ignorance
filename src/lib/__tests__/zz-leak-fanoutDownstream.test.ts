import { describe, expect, it } from 'vitest';
import {
  computeInitialExpectedMaxLoss,
  computeInitialMainExposureNotional,
  computeMirrorTpReductionPct,
  resolveMainRiskAnchors,
} from '@/lib/campaignAnalysis';
import { buildMainLegOrdinals } from '@/lib/campaignMainLegOrdinals';
import { pickPrimaryMainLeg } from '@/lib/campaignPrimaryMainLeg';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

const OPEN = '2025-04-23T11:31:07.000Z';
const ENTRY = 0.102754;
const PROTECT = 0.089;
const F = Math.abs(PROTECT - ENTRY) / ENTRY;      // 13.3854%

const campaign: TradeCampaign = {
  id: 'c', user_id: 'u', campaign_code: 'C', symbol: 'ENJUSDT',
  direction: 'main_long', status: 'closed_profit', strategy_template: 'main_dual_hedge_mirror_tp',
  title: 'enj', opened_at: OPEN, closed_at: '2025-04-23T15:08:00.000Z',
  initial_main_size_usdt: null, initial_leverage: 5,
  final_realized_pnl: 0, final_r_multiple: null, peak_unrealized_pnl: null, peak_drawdown: null,
  actual_evolution: [{ id: 'e', event_type: 'historical_classification_created', timestamp: OPEN }],
} as unknown as TradeCampaign;

const leg = (id: string, role: TradeJournal['leg_role'], size: number, closeAt: string, seq: number): TradeJournal => ({
  id, leg_role: role, leg_sequence: seq, direction: 'long',
  order_kind: role === 'mirror_tp' ? 'tp' : 'main',
  pre_simulated_time: OPEN, pre_entry_price: ENTRY, pre_position_size: size,
  pre_account_equity_usdt: 100_000, trade_record_id: `r-${id}`, leverage: 5,
  __closeAt: closeAt,
} as unknown as TradeJournal);

const rec = (legId: string, sizeUsd: number, closeAt: string): TradeRecord => ({
  id: `r-${legId}`, symbol: 'ENJUSDT', side: 'LONG', action: 'CLOSE',
  openTime: Date.parse(OPEN), closeTime: Date.parse(closeAt),
  entryPrice: ENTRY, exitPrice: ENTRY, quantity: sizeUsd / ENTRY, leverage: 5, pnl: 0,
} as unknown as TradeRecord);

const ORDERS: CampaignReverseHedgeOrder[] = [
  { id: 'o1', side: 'SHORT', price: PROTECT, createdAt: Date.parse(OPEN) + 60_000, triggeredAt: null, cancelledAt: null, status: 'cancelled' },
  { id: 'o2', side: 'SHORT', price: PROTECT, createdAt: Date.parse(OPEN) + 90_000, triggeredAt: null, cancelledAt: null, status: 'cancelled' },
] as unknown as CampaignReverseHedgeOrder[];

describe('zz-leak downstream: 一笔主力成交被拆成两条 main_open 腿', () => {
  it('对照：正确的单腿模型', () => {
    const legs = [leg('m', 'main_open', 1000, '2025-04-23T15:08:00.000Z', 1), leg('tp', 'mirror_tp', 1500, '2025-04-23T12:19:00.000Z', 2)];
    const records = [rec('m', 1000, '2025-04-23T15:08:00.000Z'), rec('tp', 1500, '2025-04-23T12:19:00.000Z')];
    const N = computeInitialMainExposureNotional(campaign, legs, records);
    const L = computeInitialExpectedMaxLoss(campaign, legs, records, ORDERS);
    const pct = computeMirrorTpReductionPct(campaign, legs[1], legs, records);
    // eslint-disable-next-line no-console
    console.log('CORRECT  N=', N, 'L=', L, 'mirrorPct=', pct,
      'primaryMain=', pickPrimaryMainLeg(legs)?.pre_position_size,
      'ordinals=', [...buildMainLegOrdinals(legs)]);
    expect(N).toBeCloseTo(2500, 6);
    expect(L).toBeCloseTo(F * 2500, 4);
  });

  it('分片：同一笔主力被两次部分平仓拆成两条 main_open,各 500', () => {
    const legs = [
      leg('m1', 'main_open', 500, '2025-04-23T14:00:00.000Z', 1),
      leg('m2', 'main_open', 500, '2025-04-23T15:08:00.000Z', 2),
      leg('tp', 'mirror_tp', 1500, '2025-04-23T12:19:00.000Z', 3),
    ];
    const records = [
      rec('m1', 500, '2025-04-23T14:00:00.000Z'),
      rec('m2', 500, '2025-04-23T15:08:00.000Z'),
      rec('tp', 1500, '2025-04-23T12:19:00.000Z'),
    ];
    const N = computeInitialMainExposureNotional(campaign, legs, records);
    const L = computeInitialExpectedMaxLoss(campaign, legs, records, ORDERS);
    const pct = computeMirrorTpReductionPct(campaign, legs[2], legs, records);
    const anchors = resolveMainRiskAnchors(campaign, legs, records, ORDERS);
    // eslint-disable-next-line no-console
    console.log('SHARDED  N=', N, 'L=', L, 'mirrorPct=', pct,
      'primaryMain=', pickPrimaryMainLeg(legs)?.id, pickPrimaryMainLeg(legs)?.pre_position_size,
      'ordinals=', [...buildMainLegOrdinals(legs)],
      'anchors=', anchors.anchors.map(a => ({ id: a.mainLegId, n: a.exposureNotional, f: a.drawdownFraction })));
    expect(N).toBeCloseTo(2500, 6);
  });
});
