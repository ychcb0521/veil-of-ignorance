import { describe, expect, it } from 'vitest';
import {
  buildCampaignBoardOverview,
  buildCampaignLegsExportRows,
  campaignLegsExportCanvasHeight,
  formatCampaignChartInterval,
  type CampaignBoardExportInput,
} from '@/lib/campaignLegsPngExport';
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
    chartInterval: '5m',
    pnlOverview: {
      items: [
        { key: 'realizedPnl', label: '已实现 P&L', value: '3456.78 USDT', color: '#0ECB81' },
        { key: 'initialMainExposureNotional', label: '主力开仓名义仓位', value: '12000.00 USDT' },
        { key: 'peakUnrealizedPnl', label: '峰值浮盈', value: '5200.00' },
        { key: 'maxDrawdown', label: '最大回撤', value: '-800.00' },
        { key: 'initialExpectedMaxLoss', label: '最大预期亏损', value: '1800.00 USDT' },
        { key: 'expectedMaxDrawdownPct', label: '预期回撤', value: '3.20%' },
        { key: 'payoffRatio', label: '盈亏比', value: '66.48%（0.66）', color: '#0ECB81' },
        { key: 'opportunityQuality', label: '机会质量', value: '0.21', color: '#0ECB81' },
        { key: 'arithmeticExpectancy', label: '算术期望', value: '+0.18R', color: '#0ECB81' },
        { key: 'geometricExpectancy', label: '几何期望', value: '+0.4%/笔', color: '#0ECB81' },
        { key: 'todayAccountEquity', label: '今日账户总资产', value: '50000.00 USDT' },
      ],
      note: '期望口径：37 场有效战役，实时胜率 48.65%。',
    },
  };
}

describe('campaign PNG overview', () => {
  it('完整包含战役原数据和盈亏概览字段', () => {
    const overview = buildCampaignBoardOverview(input());
    const metadata = Object.fromEntries(overview.metadataItems.map(item => [item.label, item.value]));
    const pnl = Object.fromEntries(overview.pnlItems.map(item => [item.label, item.value]));

    expect(metadata['操作时间']).not.toBe('—');
    expect(metadata['K 线周期']).toBe('5分钟线');
    expect(metadata['方向 / 状态']).toBe('主多 / 盈利结束');
    expect(metadata['持续时间']).toBe('2 小时 30 分钟');
    expect(metadata['Legs 构成']).toBe('共 3 · 主仓 1 / 对冲 1 / TP 1 / 其他 0');
    expect(metadata['主力开仓名义仓位 / 杠杆']).toBe('12000.00 USDT / 6x');
    expect(metadata['最终 R']).toBe('2.40');
    expect(metadata['战役编号']).toBe('C-ABC123');
    expect(pnl['已实现 P&L']).toBe('3456.78 USDT');
    expect(pnl['主力开仓名义仓位']).toBe('12000.00 USDT');
    expect(pnl['峰值浮盈']).toBe('5200.00');
    expect(pnl['最大回撤']).toBe('-800.00');
    expect(pnl['最大预期亏损']).toBe('1800.00 USDT');
    expect(pnl['预期回撤']).toBe('3.20%');
    expect(pnl['盈亏比']).toBe('66.48%（0.66）');
    expect(pnl['机会质量']).toBe('0.21');
    expect(pnl['算术期望']).toBe('+0.18R');
    expect(pnl['几何期望']).toBe('+0.4%/笔');
    expect(pnl['今日账户总资产']).toBe('50000.00 USDT');
    expect(overview.pnlNote).toContain('37 场有效战役');
  });

  it('将常用 K 线周期转换为完整的中文线型名称', () => {
    expect(formatCampaignChartInterval('1m')).toBe('1分钟线');
    expect(formatCampaignChartInterval('15m')).toBe('15分钟线');
    expect(formatCampaignChartInterval('1h')).toBe('1小时线');
    expect(formatCampaignChartInterval('1d')).toBe('日线');
  });

  it('亏损战役的盈亏比保留负号', () => {
    const negativeInput = input();
    negativeInput.pnlOverview.items = negativeInput.pnlOverview.items.map(item => (
      item.key === 'payoffRatio' ? { ...item, value: '-37.25%（-0.37）', color: '#F6465D' } : item
    ));

    const overview = buildCampaignBoardOverview(negativeInput);
    const pnl = Object.fromEntries(overview.pnlItems.map(item => [item.label, item.value]));

    expect(pnl['盈亏比']).toBe('-37.25%（-0.37）');
  });

  it('新增盈亏指标时自动进入导出摘要', () => {
    const futureInput = input();
    futureInput.pnlOverview.items.push({
      key: 'futureMetric',
      label: '未来新增指标',
      value: '42.00',
    });

    const overview = buildCampaignBoardOverview(futureInput);

    expect(overview.pnlItems).toContainEqual(expect.objectContaining({
      key: 'futureMetric',
      label: '未来新增指标',
      value: '42.00',
    }));
  });

  it('按完整 legs 数据导出滚动区域外的所有行与末行信息', () => {
    const manyLegs = Array.from({ length: 14 }, (_, index) => ({
      id: `leg-${index + 1}`,
      leg_sequence: index + 1,
      leg_role: index === 0 ? 'main_open' : 'main_add_1',
      pre_simulated_time: `2026-07-14T02:${String(index).padStart(2, '0')}:00.000Z`,
      pre_entry_price: 100 + index,
      pre_position_size: 1000 + index,
      post_exit_price_snapshot: 110 + index,
      post_r_multiple: index / 10,
    })) as TradeJournal[];
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: manyLegs,
      reverseHedgeOrders: [],
    });

    expect(rows).toHaveLength(14);
    expect(rows.at(-1)?.legId).toBe('leg-14');
    expect(rows.at(-1)?.cells[0][0].text).toBe('14');
    expect(rows.at(-1)?.cells[3][0].text).toBe('113.0000');
    expect(rows.at(-1)?.cells[5][0].text).toBe('1013.00');
    expect(campaignLegsExportCanvasHeight({
      ...input(),
      legs: manyLegs,
      reverseHedgeOrders: [],
    })).toBeGreaterThan(campaignLegsExportCanvasHeight({
      ...input(),
      legs: manyLegs.slice(0, 3),
      reverseHedgeOrders: [],
    }));
  });

  it('完整保留反向挂单与平仓价校正明细', () => {
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: [{
        id: 'leg-corrected',
        leg_sequence: 1,
        leg_role: 'main_open',
        pre_simulated_time: '2026-07-14T01:00:00.000Z',
        pre_entry_price: 0.1,
        post_exit_price_snapshot: 0.5,
      } as TradeJournal],
      reverseHedgeOrders: [{
        id: 'reverse-1',
        side: 'SHORT',
        price: 0.12,
        status: 'triggered',
        createdAt: Date.parse('2026-07-14T01:01:00.000Z'),
        triggeredAt: Date.parse('2026-07-14T01:02:00.000Z'),
        cancelledAt: Date.parse('2026-07-14T01:03:00.000Z'),
      } as CampaignBoardExportInput['reverseHedgeOrders'][number]],
      legExitPriceCorrections: {
        'leg-corrected': {
          exitPrice: 0.2,
          originalExitPrice: 0.5,
          candleLow: 0.18,
          candleHigh: 0.22,
        },
      },
    });

    expect(rows[0].cells[4].map(line => line.text)).toEqual([
      '0.200000',
      '原 0.500000',
      'K线 0.180000-0.220000',
    ]);
    expect(rows[0].cells[8].map(line => line.text)).toEqual(expect.arrayContaining([
      '空 0.120000 · 已触发',
    ]));
  });
});
