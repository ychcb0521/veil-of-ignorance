import { describe, expect, it } from 'vitest';
import { buildCampaignBoardOverview, type CampaignBoardExportInput } from '@/lib/campaignLegsPngExport';
import type { TradeCampaign, TradeJournal } from '@/types/journal';

const campaign = {
  id: 'campaign-1',
  campaign_code: 'C-ABC123',
  symbol: 'BTCUSDT',
  direction: 'main_long',
  status: 'closed_profit',
  strategy_template: 'main_hedge_mirror',
  opened_at: '2026-07-14T01:00:00.000Z',
  closed_at: '2026-07-14T03:30:00.000Z',
  initial_main_size_usdt: 12000,
  initial_leverage: 6,
  final_realized_pnl: 3456.78,
  final_r_multiple: 2.4,
} as TradeCampaign;

const legs = [
  {
    id: 'main',
    leg_role: 'main_open',
    pre_real_time: '2026-07-14T01:00:00.000Z',
  },
  {
    id: 'hedge',
    leg_role: 'hedge_initial_a',
    pre_real_time: '2026-07-14T02:00:00.000Z',
  },
  {
    id: 'tp',
    leg_role: 'mirror_tp',
    pre_real_time: '2026-07-14T02:30:00.000Z',
    post_real_close_time: '2026-07-14T03:30:00.000Z',
  },
] as TradeJournal[];

function input(): CampaignBoardExportInput {
  return {
    campaign,
    legs,
    tradeRecords: [],
    reverseHedgeOrders: [],
    chartElement: null,
    pnlOverview: {
      campaignMaxProfitReal: 5200,
      campaignMaxDrawdownReal: -800,
      profitCaptureRatio: 66.48,
    },
  };
}

describe('campaign PNG overview', () => {
  it('完整包含战役原数据和盈亏概览字段', () => {
    const overview = buildCampaignBoardOverview(input());
    const metadata = Object.fromEntries(overview.metadataItems.map(item => [item.label, item.value]));
    const pnl = Object.fromEntries(overview.pnlItems.map(item => [item.label, item.value]));

    expect(metadata['操作时间']).not.toBe('—');
    expect(metadata['方向 / 状态']).toBe('主多 / 盈利结束');
    expect(metadata['持续时间']).toBe('2 小时 30 分钟');
    expect(metadata['Legs 构成']).toBe('共 3 · 主仓 1 / 对冲 1 / TP 1 / 其他 0');
    expect(metadata['初始主仓 / 杠杆']).toBe('12000.00 USDT / 6x');
    expect(pnl['已实现 P&L']).toBe('3456.78 USDT');
    expect(pnl['最终 R']).toBe('2.40');
    expect(pnl['峰值浮盈']).toBe('5200.00 USDT');
    expect(pnl['最大回撤']).toBe('-800.00 USDT');
    expect(pnl['盈利捕获率']).toBe('66.48%');
    expect(pnl['战役编号']).toBe('C-ABC123');
  });
});
