/**
 * 爆仓这件事要在**导出的三处**都说出来：Legs 导出图的角色标签、开仓快照 TXT、平仓评价 TXT。
 * 判据与页面同一个 legRowStatus，不另写一套。
 */
import { describe, expect, it } from 'vitest';
import { buildCampaignLegsExportRows, type CampaignBoardExportInput } from '@/lib/campaignLegsPngExport';
import { buildCampaignOpeningSnapshotsTxt } from '@/lib/campaignSnapshotTxtExport';
import { buildCampaignPostReviewsTxt } from '@/lib/campaignReviewTxtExport';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const campaign = {
  id: 'campaign-1',
  campaign_code: 'C-LIQ001',
  symbol: 'XUSDT',
  title: 'XUSDT 爆仓战役',
  direction: 'main_long',
  status: 'closed_loss',
  strategy_template: 'custom',
  opened_at: '2026-08-07T01:00:00.000Z',
  closed_at: '2026-08-07T03:00:00.000Z',
  initial_main_size_usdt: 20_000,
  initial_leverage: 20,
  final_realized_pnl: -1000,
} as TradeCampaign;

const liquidation = {
  id: 'rec-liq',
  positionId: 'pos-liq',
  fillId: 'pos-liq',
  symbol: 'XUSDT',
  side: 'LONG',
  type: 'MARKET',
  action: 'LIQUIDATION',
  exit_method: 'liquidation',
  liquidationSettlement: 'bankruptcy',
  entryPrice: 1,
  exitPrice: 0.954,
  quantity: 20_000,
  leverage: 20,
  pnl: -1000,
  fee: 12,
  slippage: 0,
  openTime: Date.parse('2026-08-07T01:00:00.000Z'),
  closeTime: Date.parse('2026-08-07T02:00:00.000Z'),
} as TradeRecord;

const leg = {
  id: 'leg-liq',
  user_id: 'u',
  campaign_id: 'campaign-1',
  trade_record_id: 'pos-liq',
  leg_role: 'main_open',
  leg_sequence: 1,
  source: 'live',
  symbol: 'XUSDT',
  direction: 'long',
  leverage: 20,
  position_mode: 'isolated',
  order_kind: 'main',
  pre_simulated_time: '2026-08-07T01:00:00.000Z',
  pre_real_time: '2026-08-07T01:00:00.000Z',
  pre_entry_price: 1,
  pre_position_size: 20_000,
  pre_mental_state: 5,
  pre_checklist_items: [],
  pre_checklist_passed: true,
  post_reviewed_at: '2026-08-07T03:10:00.000Z',
  post_outcome: 'loss',
  post_realized_pnl: -1000,
  post_every_ball_pct: 40,
  created_at: '2026-08-07T01:00:00.000Z',
  updated_at: '2026-08-07T03:10:00.000Z',
} as unknown as TradeJournal;

function exportInput(): CampaignBoardExportInput {
  return {
    campaign,
    accountName: '主账户',
    legs: [leg],
    tradeRecords: [liquidation],
    reverseHedgeOrders: [],
    chartElement: null,
    chartInterval: '5m',
    pnlOverview: { items: [], note: '' },
    emotionDiary: null,
  } as unknown as CampaignBoardExportInput;
}

describe('爆仓在导出里也认得出来', () => {
  it('Legs 导出图：角色标签带「爆仓」小字（与页面同一套状态画法）', () => {
    const rows = buildCampaignLegsExportRows(exportInput());
    const legRow = rows.find(row => row.kind === 'leg' && row.legId === 'leg-liq')!;
    const roleLine = legRow.cells[0][0];
    expect(roleLine.text).toBe('主力开仓');
    expect(roleLine.chip?.flag).toBe('爆仓');
    expect(roleLine.chip?.hollow).toBeUndefined();
    expect(roleLine.chip?.dot).toBeUndefined();
  });

  it('Legs 导出图的平仓价格：强平异常只加 K 线区间与红字，不再印与它一模一样的「原 …」', () => {
    const input = exportInput();
    const rows = buildCampaignLegsExportRows({
      ...input,
      legExitPriceCorrections: {
        'leg-liq': { exitPrice: 0.99, originalExitPrice: 0.954, candleLow: 0.98, candleHigh: 1 },
      },
    } as CampaignBoardExportInput);
    const legRow = rows.find(row => row.kind === 'leg' && row.legId === 'leg-liq')!;
    // 平仓价那一格（表头顺序与页面一致：角色 / 时间 / 贡献·盈亏 / Δb / 开仓价 / 平仓价 …）
    const exitCell = legRow.cells.find(cell => cell[0]?.text === '0.954000')!;
    expect(exitCell.map(line => line.text)).toEqual([
      '0.954000',
      'K线 0.980000-1.0000',
      '强平异常',
    ]);
  });

  it('开仓快照 TXT：仓位那一行写出「· 爆仓」；不传成交记录时维持原样', () => {
    expect(buildCampaignOpeningSnapshotsTxt(campaign, [leg], '主账户', [liquidation]))
      .toContain('仓位：主力开仓 · XUSDT · 多 · 爆仓');
    expect(buildCampaignOpeningSnapshotsTxt(campaign, [leg], '主账户'))
      .toContain('仓位：主力开仓 · XUSDT · 多\n');
  });

  it('平仓评价 TXT：仓位那一行写出「· 爆仓」', () => {
    expect(buildCampaignPostReviewsTxt(campaign, [leg], '主账户', [liquidation]))
      .toContain('仓位：主力开仓 · XUSDT · 多 · 爆仓');
  });
});
