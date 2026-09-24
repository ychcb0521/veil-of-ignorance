import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCampaignPnlOverviewItems, type CampaignPnlOverviewMetrics } from '@/lib/campaignPnlOverview';
import {
  EMOTION_DIARY_COLLAPSED_H,
  buildCampaignLegsListCanvas,
  buildCampaignBoardOverview,
  campaignEmotionDiaryPanelHeight,
  drawEmotionDiaryPanel,
  buildCampaignLegsExportRows,
  campaignLegsShareSide,
  campaignLegsExportCanvasHeight,
  wrapCampaignLegsExportLine,
  formatCampaignChartInterval,
  campaignKlineTitleName,
  campaignStatusLabel,
  overviewItemCells,
  type CampaignBoardExportInput,
} from '@/lib/campaignLegsPngExport';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

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
    accountName: '主账户',
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
    emotionDiary: {
      date: '2026-07-14',
      eventText: '盘前出现意外消息，但完整记录事实后再执行。',
      valence: '4/9（中性附近）',
      arousal: '7/9（高唤醒）',
      anxiety: '8/21（临界范围，8–10）',
      depression: '4/21（正常范围，0–7）',
    },
  };
}

/**
 * 各列在 COLUMNS 里的下标。插新列时只需改这里，不必逐处改数字。
 * 与页面一样，第一列就是「角色」（不再有「#」列）。
 */
const ROLE_COL = 0;
const TIME_COL = 1;
const PNL_COL = 2;
const DELTA_B_COL = 3;
const ENTRY_COL = 4;
const EXIT_COL = 5;
/** 开仓和平仓分别记录，不与前后数值列混在一起。 */
const EXECUTION_METHOD_COL = 6;
/** 「委托」列。 */
const ORDER_COL = 12;
/** 「手续费」列。 */
const FEE_COL = 11;
/** 「加仓校验」列（紧跟「币量 / 仓位」与「多单占比」；没有「空单占比」列）。 */
const ADD_SIZING_COL = 10;
/** 导出图的列数（没有页面上的「操作」列）。 */
const EXPORT_COLUMN_COUNT = 13;
/** 「涨跌幅」列（操作方式右侧）。 */
const PRICE_CHANGE_COL = 7;

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
    expect(metadata['战役编号']).toBe('C-主账户-ABC123');
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
    expect(overview.emotionDiary).toEqual(expect.objectContaining({
      date: '2026-07-14',
      eventText: '盘前出现意外消息，但完整记录事实后再执行。',
      anxiety: '8/21（临界范围，8–10）',
    }));
  });

  it('将常用 K 线周期转换为完整的中文线型名称', () => {
    expect(formatCampaignChartInterval('1m')).toBe('1分钟线');
    expect(formatCampaignChartInterval('15m')).toBe('15分钟线');
    expect(formatCampaignChartInterval('1h')).toBe('1小时线');
    expect(formatCampaignChartInterval('1d')).toBe('日线');
  });

  it('亏损结束的战役：标题 slug 为 loss，「方向 / 状态」与「最终 R」跟着传入的行走', () => {
    // 详情页传的是派生后的行（状态与 R 已由校正后的结算推出），导出层不得再去读别的来源。
    const lossInput = {
      ...input(),
      campaign: { ...campaign, status: 'closed_loss', final_r_multiple: -0.18 } as TradeCampaign,
    };
    expect(campaignKlineTitleName(lossInput.campaign)).toBe('BTCUSDT 2026-07-14 loss');
    expect(campaignStatusLabel('closed_loss')).toBe('亏损结束');
    const metadata = Object.fromEntries(
      buildCampaignBoardOverview(lossInput).metadataItems.map(item => [item.label, item.value]),
    );
    expect(metadata['方向 / 状态']).toBe('主多 / 亏损结束');
    expect(metadata['最终 R']).toBe('-0.18');
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

    // 14 条腿 + 表尾合计行
    const legRows = rows.filter(row => row.kind === 'leg');
    expect(legRows).toHaveLength(14);
    expect(rows.at(-1)?.kind).toBe('total');
    expect(legRows.at(-1)?.legId).toBe('leg-14');
    // 第一列是角色标签（不再印腿的序号）
    expect(legRows.at(-1)?.cells[ROLE_COL].map(line => line.text)).toEqual(['加仓1']);
    expect(legRows.at(-1)?.cells[ENTRY_COL][0].text).toBe('113.0000');
    // 币量在上、名义在下：1013 ÷ 113 = 8.96
    expect(legRows.at(-1)?.cells[PRICE_CHANGE_COL + 1][0].text).toBe('8.96');
    expect(legRows.at(-1)?.cells[PRICE_CHANGE_COL + 1][1].text).toBe('1013.00');
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

    expect(rows[0].cells[EXIT_COL].map(line => line.text)).toEqual([
      '0.200000',
      '原 0.500000',
      'K线 0.180000-0.220000',
    ]);
    expect(rows[0].cells[ORDER_COL].map(line => line.text)).toEqual(expect.arrayContaining([
      '空 0.120000 · 已触发',
    ]));
  });

  it('PNG 的反向委托只显示在主力腿，镜像腿独立显示止盈委托时间', () => {
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: [
        {
          id: 'main-shared',
          leg_sequence: 1,
          leg_role: 'main_open',
          order_kind: 'main',
          trade_record_id: 'shared-record',
          pre_simulated_time: '2026-07-14T01:00:00.000Z',
        },
        {
          id: 'mirror-shared',
          leg_sequence: 2,
          leg_role: 'mirror_tp',
          order_kind: 'tp',
          trade_record_id: 'shared-record',
          pre_simulated_time: '2026-07-14T01:00:00.000Z',
        },
      ] as TradeJournal[],
      reverseHedgeOrders: [{
        id: 'reverse-shared',
        tradeRecordId: 'shared-record',
        side: 'SHORT',
        price: 0.12,
        status: 'cancelled',
        createdAt: Date.parse('2026-07-14T01:01:00.000Z'),
        triggeredAt: null,
        cancelledAt: Date.parse('2026-07-14T01:02:00.000Z'),
      }],
    });

    expect(rows[0].cells[ORDER_COL].map(line => line.text)).toContain('空 0.120000 · 已撤');
    expect(rows[1].cells[ORDER_COL].map(line => line.text)).toEqual([
      '镜像止盈',
      '委 2026-07-14 09:00',
      '触 —',
    ]);
  });

  it('PNG 在镜像止盈行显示事件中的止盈挂单时间和触发时间', () => {
    const rows = buildCampaignLegsExportRows({
      ...input(),
      campaign: {
        ...campaign,
        actual_evolution: [
          {
            id: 'mirror-placed',
            timestamp: '2026-07-14T01:05:00.000Z',
            event_type: 'mirror_tp_placed',
            leg_role: 'mirror_tp',
            journal_id: 'mirror-timing',
            trade_record_id: 'mirror-timing-record',
            pending_order_id: null,
            price: 0.12,
            size_usdt: 500,
            notes: null,
            recorded_at: '2026-07-14T01:05:00.000Z',
          },
          {
            id: 'mirror-triggered',
            timestamp: '2026-07-14T01:45:00.000Z',
            event_type: 'mirror_tp_triggered',
            leg_role: 'mirror_tp',
            journal_id: 'mirror-timing',
            trade_record_id: 'mirror-timing-record',
            pending_order_id: null,
            price: 0.13,
            size_usdt: 500,
            notes: null,
            recorded_at: '2026-07-14T01:45:00.000Z',
          },
        ],
      },
      legs: [{
        id: 'mirror-timing',
        leg_sequence: 1,
        leg_role: 'mirror_tp',
        trade_record_id: 'mirror-timing-record',
        pre_simulated_time: '2026-07-14T01:00:00.000Z',
      } as TradeJournal],
      tradeRecords: [{
        id: 'mirror-timing-record',
        openTime: Date.parse('2026-07-14T01:00:00.000Z'),
        closeTime: Date.parse('2026-07-14T02:00:00.000Z'),
      } as CampaignBoardExportInput['tradeRecords'][number]],
      reverseHedgeOrders: [],
    });

    expect(rows[0].cells[ORDER_COL].map(line => line.text)).toEqual([
      '镜像止盈',
      '委 2026-07-14 09:05',
      '触 2026-07-14 09:45',
    ]);
  });

  it('PNG 把已触发反向委托显示在对应对冲腿', () => {
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: [
        {
          id: 'main',
          leg_sequence: 1,
          leg_role: 'main_open',
          order_kind: 'main',
          pre_simulated_time: '2026-07-14T01:00:00.000Z',
        },
        {
          id: 'hedge-a',
          leg_sequence: 2,
          leg_role: 'hedge_initial_a',
          order_kind: 'hedge',
          trade_record_id: 'hedge-record',
          pre_simulated_time: '2026-07-14T01:05:00.000Z',
        },
      ] as TradeJournal[],
      reverseHedgeOrders: [{
        id: 'triggered-hedge',
        tradeRecordId: 'hedge-record',
        side: 'SHORT',
        price: 0.12,
        fillPrice: 0.119,
        status: 'triggered',
        createdAt: Date.parse('2026-07-14T01:01:00.000Z'),
        triggeredAt: Date.parse('2026-07-14T01:05:00.000Z'),
        cancelledAt: Date.parse('2026-07-14T01:10:00.000Z'),
      }],
    });

    expect(rows[0].cells[ORDER_COL].map(line => line.text)).toEqual(['—']);
    expect(rows[1].cells[ORDER_COL].map(line => line.text)).toContain('空 0.120000 · 已触发');
  });
});

describe('【用户要求】情绪日记折叠后，导出图片也只保留标题', () => {
  const diary = {
    date: '2026-09-13',
    eventText: '今天是生理期的第二天。情绪有波动，但是没有影响正常的进程。',
    pomsTotal: '66（TMD）',
    panasPositive: '46/50',
    panasNegative: '11/50',
    personalInitiativeTotal: '49/49',
    personalInitiativeMean: '7.00/7',
    anxiety: '0/21（正常范围，0–7）',
    depression: '0/21（正常范围，0–7）',
    pomsDimensions: '紧张 0 · 愤怒 1 · 疲劳 5 · 抑郁 0 · 精力 21 · 慌乱 0 · 自尊 19',
  } as Parameters<typeof campaignEmotionDiaryPanelHeight>[0];

  /** 只记录 fillText 的假画布：其余绘图调用一律吞掉。 */
  function recordingContext() {
    const texts: string[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get(target, key) {
        if (key === 'fillText') return (text: string) => { texts.push(String(text)); };
        if (key === 'measureText') return (text: string) => ({ width: String(text).length * 8 });
        if (key in target) return target[key];
        return () => undefined;
      },
      set(target, key, value) { target[key] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, texts };
  }

  it('默认（展开）不变；折叠后面板只有标题栏高', () => {
    const expanded = campaignEmotionDiaryPanelHeight(diary, 1200);
    const collapsed = campaignEmotionDiaryPanelHeight(diary, 1200, true);
    expect(collapsed).toBe(EMOTION_DIARY_COLLAPSED_H);
    expect(expanded).toBeGreaterThan(collapsed);
  });

  it('折叠时只画标题与「已折叠」，正文、量表一个字都不画', () => {
    const { ctx, texts } = recordingContext();
    drawEmotionDiaryPanel(ctx, diary, 0, 0, 1200, EMOTION_DIARY_COLLAPSED_H, true);
    const all = texts.join('\n');
    expect(all).toContain('操作日情绪日记 · 2026-09-13');
    expect(all).toContain('已折叠');
    expect(all).not.toContain('生理期');
    expect(all).not.toContain('最近起波澜的事情');
    expect(all).not.toContain('POMS');
    expect(all).not.toContain('HADS');
  });

  it('展开时正文照常画出来', () => {
    const { ctx, texts } = recordingContext();
    drawEmotionDiaryPanel(ctx, diary, 0, 0, 1200, 400, false);
    const all = texts.join('\n');
    expect(all).toContain('最近起波澜的事情');
    expect(all).toContain('POMS TMD');
    expect(all).not.toContain('已折叠');
  });

  it('折叠态经由导出输入进到概览里', () => {
    expect(buildCampaignBoardOverview({ ...input(), emotionDiaryCollapsed: true }).emotionDiaryCollapsed).toBe(true);
    expect(buildCampaignBoardOverview(input()).emotionDiaryCollapsed).toBe(false);
  });
});

describe('【用户要求】导出图要把 Legs 里的信息全部纳入', () => {
  it('表尾有合计行：盈亏取数来源、Σ盈亏、Σ Δb、手续费合计——与页面合计行同源', () => {
    const rows = buildCampaignLegsExportRows(input());
    const total = rows.at(-1)!;
    expect(total.kind).toBe('total');
    expect(total.legId).toBe('legs-total');
    expect(total.cells[ROLE_COL][0].text).toBe('合计');
    expect(total.cells[TIME_COL][0].text).toMatch(/^(取自成交记录|成交记录 \+ 复盘快照|取自复盘快照|取自战役事件|取自落库缓存|未结算)$/);
    expect(total.cells[PNL_COL][0].text).toMatch(/^([+-]?\d+\.\d{2}|—)$/);
    expect(total.cells[DELTA_B_COL][0].text).toMatch(/^([+-]?\d+\.\d{2}|—)$/);
    expect(total.cells[FEE_COL][0].text).toMatch(/^(\d+\.\d{2}( 估)?|—)$/);
    // 合计行只有一行，不会混进腿的计数
    expect(rows.filter(row => row.kind === 'total')).toHaveLength(1);
    // 【用户要求】「合计」必须一眼看得见：加粗、深色、比腿的角色名大——导出图常被缩小看
    const label = total.cells[ROLE_COL][0];
    expect(label.bold).toBe(true);
    expect(label.color).toBe('#111827');
    expect(label.size ?? 13).toBeGreaterThan(13);
  });

  /** 断行处的空格会被吞掉，比较时忽略空白；其余字符必须一个不少。 */
  const squash = (text: string) => text.replace(/\s+/g, '');

  it('放不下的字折行而不是被压扁：一个字都不丢，只多出行', () => {
    const line = { text: 'K线 0.0655170-0.0685660', color: '#848E9C' };
    const narrow = wrapCampaignLegsExportLine(line, 98);
    expect(narrow.length).toBeGreaterThan(1);
    expect(squash(narrow.map(item => item.text).join(''))).toBe(squash(line.text));
    expect(narrow.every(item => item.color === '#848E9C')).toBe(true);
    // 放得下就原样返回
    expect(wrapCampaignLegsExportLine({ text: '0.0677819' }, 98)).toEqual([{ text: '0.0677819' }]);
  });

  it('先按空格断，数字不会被拆成两截', () => {
    const text = '开 468,465 · 平 104,091 1000PEPE';
    const pieces = wrapCampaignLegsExportLine({ text, size: 10 }, 112).map(item => item.text);
    expect(pieces.length).toBeGreaterThan(1);
    const tokens = new Set(text.split(/\s+/));
    // 折出来的每个词都是原文里完整的词——没有「104」「,091」这种半截
    for (const word of pieces.flatMap(piece => piece.split(/\s+/))) {
      expect(tokens.has(word)).toBe(true);
    }
  });

  it('只有单个词比格宽时才逐字拆，拆完拼回去仍是原词', () => {
    const word = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const pieces = wrapCampaignLegsExportLine({ text: word }, 40).map(item => item.text);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join('')).toBe(word);
  });

  it('每一格折行后拼回去与原文完全一致，行高按折好的行数撑开', () => {
    const rows = buildCampaignLegsExportRows(input());
    for (const row of rows) {
      row.cells.forEach((cell, index) => {
        expect(squash(row.wrapped[index].map(line => line.text).join('')))
          .toBe(squash(cell.map(line => line.text).join('')));
        expect(row.wrapped[index].length).toBeGreaterThanOrEqual(cell.length);
      });
      const tallest = Math.max(...row.wrapped.map(cell => cell.length));
      expect(row.height).toBeGreaterThanOrEqual(tallest * 17);
    }
  });
});

describe('【用户要求】导出图也带「加仓校验」列', () => {
  // TUTUSDT 2026-08-08：主力 94,300 @0.0336792；镜像 00:36 落袋 15,117.55；加仓1 @0.0419705；S₁ 空单 0.034726
  const addLegs = (addNotional: number) => [
    {
      id: 'main', leg_sequence: 1, leg_role: 'main_open', order_kind: 'main', direction: 'long',
      pre_simulated_time: '2026-08-07T19:41:00+08:00', pre_entry_price: 0.0336792, pre_position_size: 94_300,
      post_simulated_close_time: '2026-08-09T01:46:00+08:00', post_exit_price_snapshot: 0.0677819,
    },
    {
      id: 'mirror', leg_sequence: 2, leg_role: 'mirror_tp', order_kind: 'tp', direction: 'long',
      pre_simulated_time: '2026-08-07T19:41:00+08:00', pre_entry_price: 0.0336792, pre_position_size: 141_460,
      post_simulated_close_time: '2026-08-08T00:36:00+08:00', post_realized_pnl: 15_117.55,
    },
    {
      id: 'add1', leg_sequence: 3, leg_role: 'main_add_1', order_kind: 'main', direction: 'long',
      pre_simulated_time: '2026-08-08T12:02:00+08:00', pre_entry_price: 0.0419705, pre_position_size: addNotional,
    },
  ] as unknown as TradeJournal[];
  const stopOrder = {
    id: 'stop', side: 'SHORT', price: 0.034726, status: 'cancelled',
    createdAt: Date.parse('2026-08-08T12:01:00+08:00'), triggeredAt: null,
    cancelledAt: Date.parse('2026-08-08T15:18:00+08:00'),
  } as CampaignBoardExportInput['reverseHedgeOrders'][number];
  const rowsFor = (addNotional: number) => buildCampaignLegsExportRows({
    ...input(), legs: addLegs(addNotional), reverseHedgeOrders: [stopOrder],
  });

  it('仓位过大：红色、加粗、放大的 ✗，下面写正确币量上限与 U 折算额；行高跟着撑开', () => {
    const rows = rowsFor(22_057_330);
    const add = rows.find(row => row.legId === 'add1')!;
    const [cross, coins, notional] = add.cells[ADD_SIZING_COL];
    expect(cross.text).toBe('✗');
    expect(cross.color).toBe('#F6465D');
    expect(cross.bold).toBe(true);
    expect(cross.size ?? 13).toBeGreaterThan(16);
    expect(coins.text).toMatch(/^上限 [\d,.]+ 币$/);
    expect(coins.color).toBe('#F6465D');
    expect(notional.text).toMatch(/^≈ [\d,.]+ U$/);
    expect(notional.color).toBe('#F6465D');
    // 列宽足够，币量与 U 额各自保持完整一行
    expect(add.wrapped[ADD_SIZING_COL]).toHaveLength(3);
    // 大字号那一行按字号撑开，不和下一行叠在一起
    expect(add.height).toBeGreaterThanOrEqual(12 * 2 + (cross.size! + 4) + 17 * 2);
    // 非加仓行、合计行留空；每一行格子数都与表头列数一致
    expect(rows.find(row => row.legId === 'main')!.cells[ADD_SIZING_COL].map(line => line.text)).toEqual(['']);
    expect(rows.at(-1)!.cells[ADD_SIZING_COL].map(line => line.text)).toEqual(['']);
    const widths = new Set(rows.map(row => row.cells.length));
    expect(widths).toEqual(new Set([EXPORT_COLUMN_COUNT]));
    // 列序：币量（及其多单占比）之后、手续费之前
    expect(add.cells[ADD_SIZING_COL - 2][0].text).toMatch(/^525,54\d,\d{3}(\.\d+)?$/);
  });

  it('仓位合规：只是一枚淡灰小 ✓，不是红色', () => {
    const add = rowsFor(2_000_000 * 0.0419705).find(row => row.legId === 'add1')!;
    const [check] = add.cells[ADD_SIZING_COL];
    expect(add.cells[ADD_SIZING_COL]).toHaveLength(1);
    expect(check.text).toBe('✓');
    expect(check.color).not.toBe('#F6465D');
    expect(check.bold).toBeFalsy();
    expect(check.size ?? 13).toBeLessThan(13);
  });

  it('读不到止损线：淡灰「—」', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), legs: addLegs(22_057_330), reverseHedgeOrders: [] });
    const add = rows.find(row => row.legId === 'add1')!;
    expect(add.cells[ADD_SIZING_COL]).toEqual([expect.objectContaining({ text: '—', color: '#C4CAD3' })]);
  });

  /**
   * 成交记录带着加仓计算器当时的计划：红叉之下再写「计算时 / 实际成交」两行，再用一句红字说超出从哪来——
   * 真是滑点才点名滑点（attributeAddExcess）。COMMONUSDT 加仓 1：实际 653,602 张 @0.0077123。
   *   · 那一场的计划：按现价 0.00770146、不计滑点（限价档），上限 848,689,579 币 / 653,615 张 → 超出全部来自滑点；
   *   · 若计划是市价档（已含 +0.14%，上限 834,590,798 币 / 643,648 张），同一笔就是量超了计划。
   */
  describe('成交记录带着计算器的快照', () => {
    const T0 = Date.parse('2026-09-01T10:00:00+08:00');
    const MIN = 60_000;
    const T_ADD1 = T0 + 61 * MIN;
    const iso = (ms: number) => new Date(ms).toISOString();
    const FILL = 0.0077123;
    const REF = FILL / (1 + 0.0001 + 6_536_020 / 5e9);
    const common = {
      at: T_ADD1, plan: 'B', side: 'LONG', settlement: 'coin', s1: 0.007069, s2Ref: REF, s2AtOrder: REF,
      x1: 1_483_567_536.56, sBar: 0.006974, g: 55_994_538.5, gUnit: 'COMMON',
    } as const;
    const limitPlan = { ...common, s2Fill: REF, slippagePct: 0, addCoinsMax: 848_689_579.33, contracts: 653_615, orderKind: 'limit' } as const;
    const marketPlan = { ...common, s2Fill: 0.0077121467, slippagePct: 0.1388, addCoinsMax: 834_590_798, contracts: 643_648, orderKind: 'market' } as const;
    type Plan = typeof limitPlan | typeof marketPlan;
    const commonLegs = (addNotional: number) => [
      {
        id: 'main', leg_sequence: 1, leg_role: 'main_open', order_kind: 'main', direction: 'long', symbol: 'COMMONUSDT',
        pre_simulated_time: iso(T0), pre_entry_price: 0.006974, pre_position_size: 10_346_400,
      },
      {
        id: 'mirror', leg_sequence: 2, leg_role: 'mirror_tp', order_kind: 'tp', direction: 'long', symbol: 'COMMONUSDT',
        pre_simulated_time: iso(T0), pre_entry_price: 0.006974, pre_position_size: 15_519_600,
        post_simulated_close_time: iso(T0 + 12 * MIN), post_realized_pnl: 55_994_538.5 * 0.007069,
      },
      {
        id: 'add1', leg_sequence: 3, leg_role: 'main_add_1', order_kind: 'main', direction: 'long', symbol: 'COMMONUSDT',
        trade_record_id: 'rec-add1', pre_simulated_time: iso(T_ADD1), pre_entry_price: FILL, pre_position_size: addNotional,
      },
    ] as unknown as TradeJournal[];
    const recordFor = (addNotional: number, plan: Plan | null): TradeRecord => ({
      id: 'rec-add1', symbol: 'COMMONUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', entryPrice: FILL, exitPrice: 0.00742559,
      quantity: addNotional / 10, contracts: addNotional / 10, leverage: 5, pnl: -246_249, fee: 0, slippage: 0,
      openTime: T_ADD1, closeTime: T_ADD1 + 47 * MIN, settlementMode: 'coin', contractSizeUsd: 10,
      ...(plan ? { addSizingSnapshot: plan } : {}),
    } as TradeRecord);
    const stop = {
      id: 'stop', side: 'SHORT', price: 0.007069, status: 'cancelled', createdAt: T_ADD1 - MIN, triggeredAt: null, cancelledAt: T_ADD1 + 24 * MIN,
    } as CampaignBoardExportInput['reverseHedgeOrders'][number];
    const rowFor = (addNotional: number, plan: Plan | null) => buildCampaignLegsExportRows({
      ...input(), legs: commonLegs(addNotional), tradeRecords: [recordFor(addNotional, plan)], reverseHedgeOrders: [stop],
    }).find(row => row.legId === 'add1')!;

    it('【回归】COMMONUSDT 加仓 1（按现价、不计滑点定的量）：红叉 + 上限之下写出计算时 / 实际成交两行，再点名超出全部来自成交滑点 +0.14%', () => {
      const add = rowFor(6_536_020, limitPlan);
      const cell = add.cells[ADD_SIZING_COL];
      expect(cell).toHaveLength(6);
      const [cross, coins, notional, calc, actual, slip] = cell;
      expect(cross.text).toBe('✗');
      expect(coins.text).toMatch(/^上限 834,391,89\d(\.\d+)? 币$/);
      expect(notional.text).toMatch(/^≈ [\d,.]+ U$/);
      // 限价计划的 s2Ref 是手填的限价，不叫「现价」；市价计划仍叫现价（下一条）
      expect(calc.text).toBe('计算时 限价 0.00770146，挂单价 0.00770146（限价），上限 848,689,579.33 币');
      expect(calc.color).toBe('#848E9C');
      expect(calc.size).toBe(9);
      expect(actual.text).toMatch(/^实际成交 0\.00771230（\+0\.14%），上限 834,391,89\d(\.\d+)? 币$/);
      expect(actual.size).toBe(9);
      expect(slip.text).toBe('超出部分全部来自成交滑点 +0.14%（计划按限价、不计滑点，这张却是吃单成交）');
      expect(slip.color).toBe('#F6465D');
      expect(slip.bold).toBe(true);
      // 长句会折行，行高跟着撑开；格子数不变
      expect(add.wrapped[ADD_SIZING_COL].length).toBeGreaterThanOrEqual(6);
      expect(add.height).toBeGreaterThan(rowFor(6_536_020, null).height);
      expect(add.cells).toHaveLength(EXPORT_COLUMN_COUNT);
    });

    it('【回归 · 复审】市价计划（已含滑点）却下了 653,602 张：红字说量超了计划 +1.55%，不说滑点', () => {
      const cell = rowFor(6_536_020, marketPlan).cells[ADD_SIZING_COL];
      expect(cell).toHaveLength(6);
      expect(cell[3].text).toBe('计算时 现价 0.00770146，预计成交 0.00771215（+0.14%），上限 834,590,798 币');
      expect(cell[5].text).toBe('实际加仓比计算时的上限多 +1.55%——超出来自仓位本身，不是滑点');
      expect(cell[5].color).toBe('#F6465D');
      expect(cell.some(line => line.text.includes('全部来自成交滑点'))).toBe(false);
    });

    it('实际量连参考价上限都超了：两行照写，红字说量超了，没有「全部来自滑点」；没有快照的行仍是三行', () => {
      const over = rowFor(6_536_020 * 1.05, limitPlan).cells[ADD_SIZING_COL];
      expect(over).toHaveLength(6);
      expect(over[3].text).toContain('计算时 限价 0.00770146');
      expect(over[5].text).toMatch(/^实际加仓比计算时的上限多 \+\d\.\d\d%——超出来自仓位本身，不是滑点$/);
      expect(over.some(line => line.text.includes('全部来自成交滑点'))).toBe(false);
      const plain = rowFor(6_536_020, null).cells[ADD_SIZING_COL];
      expect(plain).toHaveLength(3);
      expect(plain.map(line => line.text).join(' ')).not.toContain('计算时');
    });
  });
});

describe('【用户要求】主力及其他多单的阶段子行进入导出图，收尾不呈现', () => {
  const T = (hhmm: string) => `2026-08-07T${hhmm}:00.000Z`;
  const phaseLegs = [
    {
      id: 'main', leg_sequence: 1, leg_role: 'main_open', order_kind: 'main', direction: 'long',
      source: 'retroactive_from_record',
      pre_simulated_time: T('01:00'), pre_entry_price: 0.0336792, pre_position_size: 94300,
      post_exit_price_snapshot: 0.0677819, post_simulated_close_time: T('09:00'), post_realized_pnl: 95439.77,
    },
    {
      id: 'hedge-roll', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
      source: 'retroactive_from_record',
      pre_simulated_time: T('03:00'), pre_entry_price: 0.05, pre_position_size: 50000,
      post_exit_price_snapshot: 0.052, post_simulated_close_time: T('05:00'), post_realized_pnl: -2000,
    },
  ] as unknown as TradeJournal[];

  it('按对冲存续状态显示纯多头 / 对冲阶段；合计行照常在最后', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), legs: phaseLegs, initialExpectedMaxLoss: 20000 });
    const phases = rows.filter(row => row.kind === 'phase');
    expect(phases).toHaveLength(3);
    expect(phases.map(row => row.cells[ROLE_COL][0].text)).toEqual(['纯多头阶段', '对冲1阶段', '纯多头阶段']);
    expect(phases.map(row => row.cells[ROLE_COL][0].color)).toEqual(['#848E9C', '#6F9BD8', '#848E9C']);
    const cut = phases[1];
    expect(rows.some(row => row.cells[ROLE_COL][0]?.text.includes('收尾'))).toBe(false);
    // 阶段子行的行高跟着多出来的这一行撑开
    expect(cut.height).toBeGreaterThanOrEqual(cut.wrapped[TIME_COL].length * 17);
    const total = rows.at(-1)!;
    expect(total.kind).toBe('total');
    expect(total.cells[TIME_COL][0].text).toBe('取自复盘快照');
    expect(total.cells[PNL_COL][0].text).toBe('+93439.77');
  });

  it('阶段名称与主力角色标签里的字左对齐：缩进 = 标签左内边距 8px（与页面一致）', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), legs: phaseLegs, initialExpectedMaxLoss: 20000 });
    const main = rows.find(row => row.kind === 'leg' && row.legId === 'main')!;
    expect(main.cells[ROLE_COL][0].chip).toBeTruthy();
    for (const phase of rows.filter(row => row.kind === 'phase')) {
      expect(phase.cells[ROLE_COL][0].indent).toBe(8);
      expect(phase.cells[ROLE_COL][0].chip).toBeUndefined();
    }
  });

  it('加仓等其他多单也导出阶段，空单对冲自身不导出阶段', () => {
    const add = {
      id: 'add-1', leg_sequence: 3, leg_role: 'main_add_1', order_kind: 'main', direction: 'long',
      source: 'retroactive_from_record', pre_simulated_time: T('04:00'), pre_entry_price: 0.051,
      pre_position_size: 20000, post_exit_price_snapshot: 0.0677819,
      post_simulated_close_time: T('09:00'), post_realized_pnl: 5000,
    } as unknown as TradeJournal;
    const rows = buildCampaignLegsExportRows({
      ...input(), legs: [...phaseLegs, add], initialExpectedMaxLoss: 20000,
    });
    expect(rows.some(row => row.kind === 'phase' && row.legId === 'add-1-phase-1')).toBe(true);
    expect(rows.some(row => row.kind === 'phase' && row.legId.startsWith('hedge-roll-phase-'))).toBe(false);
    expect(rows.some(row => row.kind === 'phase' && row.cells[ROLE_COL][0].text.includes('收尾'))).toBe(false);
  });

  it('阶段子行与表头同列数，「加仓校验」那一格留空——少一格就会让手续费 / 委托整体左移', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), legs: phaseLegs, initialExpectedMaxLoss: 20000 });
    const phases = rows.filter(row => row.kind === 'phase');
    expect(phases).toHaveLength(3);
    for (const row of phases) {
      expect(row.cells).toHaveLength(EXPORT_COLUMN_COUNT);
      expect(row.cells[ADD_SIZING_COL].map(line => line.text)).toEqual(['']);
      expect(row.cells[EXECUTION_METHOD_COL].map(line => line.text)).toEqual(['']);
    }
    expect(new Set(rows.map(row => row.cells.length))).toEqual(new Set([EXPORT_COLUMN_COUNT]));
  });
});

describe('【用户决定】他场委托在导出图里只是表下一行淡注', () => {
  const foreignOrder = {
    id: 'other-live', tradeRecordId: null, side: 'SHORT' as const, price: 0.03005,
    createdAt: Date.parse('2026-08-07T19:42:15+08:00'), triggeredAt: null, cancelledAt: null,
    status: 'pending' as const, foreignReplay: true,
  };

  it('合计行之后多一行 note：横跨整表的一格浅灰小字，腿与合计的行一字不变，画布跟着加高', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), foreignLiveOrders: [foreignOrder] });
    const baseline = buildCampaignLegsExportRows(input());

    expect(rows.slice(0, -1)).toEqual(baseline);
    const note = rows.at(-1)!;
    expect(note.kind).toBe('note');
    expect(rows.at(-2)!.kind).toBe('total');
    expect(note.cells).toHaveLength(1);
    expect(note.cells[0][0].text).toBe('另有 1 张来自另一次回放的委托在本场期间挂在盘上：空 0.0300500 委 08-07 19:42 仍挂着（未计入本场）');
    expect(note.cells[0][0].bold).toBeFalsy();
    expect(note.cells[0][0].color).not.toBe('#111827');
    expect(note.height).toBeGreaterThan(0);
    expect(campaignLegsExportCanvasHeight({ ...input(), foreignLiveOrders: [foreignOrder] }))
      .toBe(campaignLegsExportCanvasHeight(input()) + note.height);
  });

  it('没有他场委托：不多出任何行', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), foreignLiveOrders: [] });
    expect(rows.some(row => row.kind === 'note')).toBe(false);
    expect(rows.at(-1)!.kind).toBe('total');
  });
});

describe('【用户要求】导出图也带开平操作方式，历史实际成交按业务约定兜底手动', () => {
  const at = (hhmm: string) => Date.parse(`2026-08-07T${hhmm}:00.000Z`);
  const record = (id: string, methods: Partial<TradeRecord>): TradeRecord => ({
    id, positionId: id, fillId: id, symbol: 'BTCUSDT', side: 'SHORT', type: 'MARKET', action: 'CLOSE',
    entryPrice: 100, exitPrice: 90, quantity: 10, leverage: 10, pnl: 100, fee: 0, slippage: 0,
    openTime: at('01:00'), closeTime: at('09:00'), ...methods,
  });

  it('隐藏委托仍可证明自动开仓，但不会重新出现在委托列；旧调用方保持回退', () => {
    const closed = record('hidden-order-record', { exit_method: 'manual' });
    const leg = {
      id: 'hidden-order-leg', trade_record_id: closed.id, leg_sequence: 1, leg_role: 'hedge_rolling',
      order_kind: 'hedge', direction: 'short', source: 'retroactive_from_record',
      pre_simulated_time: new Date(closed.openTime).toISOString(),
    } as TradeJournal;
    const hiddenOrder: CampaignReverseHedgeOrder = {
      id: 'hidden-order', tradeRecordId: closed.id, side: 'SHORT', price: 100,
      createdAt: at('00:30'), triggeredAt: at('01:00'), cancelledAt: at('09:00'), status: 'triggered',
    };
    const base = { ...input(), legs: [leg], tradeRecords: [closed] };
    const hidden = buildCampaignLegsExportRows({
      ...base, reverseHedgeOrders: [], executionMethodOrders: [hiddenOrder],
    })[0];
    const visible = buildCampaignLegsExportRows({ ...base, reverseHedgeOrders: [hiddenOrder] })[0];
    expect(hidden.cells[EXECUTION_METHOD_COL].map(line => line.text)).toEqual(['自动（开）', '手动（平）']);
    expect(hidden.cells[EXECUTION_METHOD_COL]).toEqual(visible.cells[EXECUTION_METHOD_COL]);
    expect(hidden.cells[ORDER_COL].map(line => line.text)).toEqual(['—']);
    expect(visible.cells[ORDER_COL].some(line => line.text.includes('已触发'))).toBe(true);
  });

  it('同一列分别显示开仓和平仓方式，并在平仓价之后、涨跌幅之前', () => {
    const records = [
      record('manual-open', { entry_method: 'manual', exit_method: 'tp1' }),
      record('manual-close', { entry_method: 'order', exit_method: 'manual' }),
      record('legacy', {}),
    ];
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: records.map((item, i) => ({
        id: item.id, trade_record_id: item.id, leg_sequence: i + 1, leg_role: 'hedge_rolling',
        order_kind: 'hedge', direction: 'short', source: 'retroactive_from_record',
        pre_simulated_time: new Date(item.openTime).toISOString(),
        post_simulated_close_time: new Date(item.closeTime).toISOString(),
      }) as TradeJournal),
      tradeRecords: records,
      reverseHedgeOrders: [],
    });
    const methodsOf = (id: string) => rows.find(row => row.legId === id)!.cells[EXECUTION_METHOD_COL];
    expect(methodsOf('manual-open').map(line => line.text)).toEqual(['手动（开）', '自动（平）']);
    expect(methodsOf('manual-close').map(line => line.text)).toEqual(['自动（开）', '手动（平）']);
    expect(methodsOf('legacy').map(line => line.text)).toEqual(['手动（开）', '手动（平）']);
    expect(methodsOf('manual-open')[0]).toMatchObject({ color: '#A66B12', bold: true, operation: { action: '开', label: '手动' } });
    expect(methodsOf('manual-open')[1]).toMatchObject({ color: '#848E9C', bold: false });
    expect(methodsOf('manual-close')[0]).toMatchObject({ color: '#848E9C', bold: false });
    expect(methodsOf('manual-close')[1]).toMatchObject({ color: '#848E9C', bold: false });
    expect(methodsOf('legacy')[0]).toMatchObject({ color: '#A66B12', bold: true });
    expect(methodsOf('legacy')[1]).toMatchObject({ color: '#848E9C', bold: false });
    for (const row of rows.filter(row => row.kind === 'leg')) {
      expect(row.cells[EXIT_COL][0].text).toBe('90.0000');
      expect(row.cells[PRICE_CHANGE_COL][0].text).toBe('+10.00%');
      expect(row.wrapped[EXECUTION_METHOD_COL]).toEqual(row.cells[EXECUTION_METHOD_COL]);
    }
    expect(rows.at(-1)!.cells[EXECUTION_METHOD_COL]).toEqual([{ text: '' }]);
    expect(new Set(rows.map(row => row.cells.length))).toEqual(new Set([EXPORT_COLUMN_COUNT]));
  });

  it('没有实际成交记录的未知对冲开平仍标未记录，不突出', () => {
    const row = buildCampaignLegsExportRows({
      ...input(), legs: [{ id: 'unrecorded-hedge', leg_role: 'hedge_rolling', order_kind: 'hedge' } as TradeJournal],
    })[0];
    expect(row.cells[EXECUTION_METHOD_COL].map(line => line.text)).toEqual(['未记录（开）', '未记录（平）']);
    for (const method of row.cells[EXECUTION_METHOD_COL]) {
      expect(method).toMatchObject({ color: '#B4BBC5', bold: false });
    }
  });

  it('主力开仓导出为手动，不把主力规则泛化到加仓', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), legs: [
      { id: 'main', leg_role: 'main_open' } as TradeJournal,
      { id: 'reentry', leg_role: 'reentry_main' } as TradeJournal,
      { id: 'add', leg_role: 'main_add_1' } as TradeJournal,
    ] });
    expect(rows.filter(row => row.kind === 'leg').map(row => row.cells[EXECUTION_METHOD_COL][0].text))
      .toEqual(['手动（开）', '手动（开）', '未记录（开）']);
    for (const id of ['main', 'reentry']) {
      expect(rows.find(row => row.legId === id)!.cells[EXECUTION_METHOD_COL][0])
        .toMatchObject({ color: '#848E9C', bold: false });
    }
  });

  it('仅手动对冲开仓突出，主力和加仓的手动开平保留中性色', () => {
    const roles = ['main_open', 'main_add_1', 'hedge_rolling', 'reentry_hedge', 'standalone', null] as const;
    const records = roles.map((_, index) => record(`manual-${index}`, { entry_method: 'manual', exit_method: 'manual' }));
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: roles.map((role, index) => ({
        id: records[index].id, trade_record_id: records[index].id, leg_sequence: index + 1,
        leg_role: role, order_kind: index < 2 ? 'main' : 'hedge',
        direction: index < 2 ? 'long' : 'short', source: 'retroactive_from_record',
        pre_simulated_time: new Date(records[index].openTime).toISOString(),
        post_simulated_close_time: new Date(records[index].closeTime).toISOString(),
      }) as TradeJournal),
      tradeRecords: records,
      reverseHedgeOrders: [],
    });
    for (const [index, item] of records.entries()) {
      const methods = rows.find(row => row.legId === item.id)!.cells[EXECUTION_METHOD_COL];
      expect(methods.map(line => line.text)).toEqual(['手动（开）', '手动（平）']);
      expect(methods[0]).toMatchObject({ color: index < 2 ? '#848E9C' : '#A66B12', bold: index >= 2 });
      expect(methods[1]).toMatchObject({ color: '#848E9C', bold: false });
    }
  });

  it.each([
    [600, '自动（平）'],
    [599.9, '手动（平）'],
  ] as const)('镜像实际成交 400/%s 的完整导出按严格 60%% 规则显示开平方式，不强调', (mirrorQuantity, expectedClose) => {
    const records = [
      record('main-ratio', {
        fillId: 'same-opening', positionId: 'same-position', side: 'LONG', quantity: 400,
        entry_method: 'manual', exit_method: 'manual',
      }),
      record('mirror-ratio', {
        fillId: 'same-opening', positionId: 'same-position', side: 'LONG', quantity: mirrorQuantity,
        closeTime: at('02:00'), entry_method: 'manual', exit_method: 'manual',
      }),
    ];
    const ratioLegs = records.map((item, index) => ({
      id: item.id, trade_record_id: item.id, leg_sequence: index + 1,
      leg_role: index === 0 ? 'main_open' : 'mirror_tp', order_kind: index === 0 ? 'main' : 'tp',
      symbol: item.symbol, direction: 'long', source: 'retroactive_from_record',
      pre_simulated_time: new Date(item.openTime).toISOString(),
      post_simulated_close_time: new Date(item.closeTime).toISOString(),
      pre_entry_price: item.entryPrice, pre_position_size: item.entryPrice * item.quantity,
      post_exit_price_snapshot: item.exitPrice,
    }) as TradeJournal);
    const rows = buildCampaignLegsExportRows({ ...input(), legs: ratioLegs, tradeRecords: records, reverseHedgeOrders: [] });
    const methods = rows.find(row => row.legId === 'mirror-ratio' && row.kind === 'leg')!.cells[EXECUTION_METHOD_COL];
    expect(methods.map(line => line.text)).toEqual(['自动（开）', expectedClose]);
    for (const method of methods) expect(method).toMatchObject({ color: '#848E9C', bold: false });
    expect(records[1]).toMatchObject({ entry_method: 'manual', exit_method: 'manual' });
    expect(rows.find(row => row.legId === 'main-ratio' && row.kind === 'leg')!.cells[EXECUTION_METHOD_COL][0].text)
      .toBe('手动（开）');
  });

  it('实际画布中状态右端和浅色括号上下对齐，仅手动对冲开仓着色且行距不变', () => {
    const draws: { text: string; x: number; y: number; color: unknown }[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get(target, key) {
        if (key === 'fillText') return (text: string, x: number, y: number) => { draws.push({ text, x, y, color: target.fillStyle }); };
        if (key === 'measureText') return (text: string) => ({ width: text.length * 8 });
        if (key in target) return target[key];
        return () => undefined;
      },
      set(target, key, value) { target[key] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    try {
      buildCampaignLegsListCanvas({ ...input(), legs: [{
        id: 'manual-hedge', leg_role: 'hedge_rolling', order_kind: 'hedge', hedge_order_method: 'market_chase',
      } as TradeJournal] }, { includeHeader: false, scale: 1 });
      const manual = draws.find(draw => draw.text === '手动')!;
      const unknown = draws.find(draw => draw.text === '未记录')!;
      const open = draws.find(draw => draw.text === '（开）')!;
      const close = draws.find(draw => draw.text === '（平）')!;
      expect(manual.color).toBe('#A66B12');
      expect(unknown.color).toBe('#B4BBC5');
      expect(open.color).toBe('#B4BBC5');
      expect(close.color).toBe('#B4BBC5');
      expect(manual.x + '手动'.length * 8).toBe(unknown.x + '未记录'.length * 8);
      expect(open.x).toBe(close.x);
      expect(close.y - open.y).toBe(17);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('【用户要求】导出图也带「涨跌幅」列（操作方式右侧）', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const T = (hhmm: string) => `2026-08-07T${hhmm}:00.000Z`;
  const leg = (over: Partial<TradeJournal> & { id: string }) => ({
    leg_sequence: 1, leg_role: 'main_open', order_kind: 'main', direction: 'long',
    pre_simulated_time: T('01:00'), ...over,
  }) as TradeJournal;

  it('表头真的把「涨跌幅」画在平仓价之后、币量 / 仓位之前；腿行那一格画出格式化后的值', () => {
    const texts: string[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get(target, key) {
        if (key === 'fillText') return (text: string) => { texts.push(String(text)); };
        if (key === 'measureText') return (text: string) => ({ width: String(text).length * 8 });
        if (key in target) return target[key];
        return () => undefined;
      },
      set(target, key, value) { target[key] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);

    const legs = [leg({ id: 'long', pre_entry_price: 2.8717, post_exit_price_snapshot: 6.5194, post_simulated_close_time: T('09:00') })];
    buildCampaignLegsListCanvas({ ...input(), legs }, { includeHeader: false, scale: 1 });

    const at = texts.indexOf('涨跌幅');
    expect(at).toBeGreaterThan(0);
    expect(texts.slice(at - 3, at + 2)).toEqual(['开仓价', '平仓价', '操作方式', '涨跌幅', '币量 / 仓位']);
    expect(texts.slice(0, EXPORT_COLUMN_COUNT)).toEqual(['角色', '时间', '贡献 / 盈亏', 'Δb', '开仓价', '平仓价', '操作方式', '涨跌幅', '币量 / 仓位', '多单占比', '加仓校验', '手续费', '委托']);
    expect(texts).not.toContain('空单占比');
    expect(texts).toContain('+127.02%');
  });

  it('与页面同一个 helper、同一个方向：多单涨绿、空单跌绿、空单涨红、未平仓「—」、按校正后的平仓价算', () => {
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: [
        leg({ id: 'long', pre_entry_price: 2.8717, post_exit_price_snapshot: 6.5194, post_simulated_close_time: T('09:00') }),
        leg({ id: 'short', leg_sequence: 2, leg_role: 'hedge_initial_a', order_kind: 'hedge', direction: 'short', pre_entry_price: 10, post_exit_price_snapshot: 9.659, post_simulated_close_time: T('09:00') }),
        leg({ id: 'open', leg_sequence: 3, leg_role: 'main_add_1', pre_entry_price: 2.8717 }),
        leg({ id: 'corrected', leg_sequence: 4, leg_role: 'reentry_main', pre_entry_price: 0.1, post_exit_price_snapshot: 0.5, post_simulated_close_time: T('09:00') }),
        // ORDIUSDT 的滚动对冲：空单，价格涨了 3.27%、这条腿亏了——不能印成绿色正数
        leg({ id: 'ordi-hedge', leg_sequence: 5, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short', pre_entry_price: 6.3132, post_exit_price_snapshot: 6.5194, post_simulated_close_time: T('09:00') }),
      ],
      reverseHedgeOrders: [],
      legExitPriceCorrections: {
        corrected: { exitPrice: 0.2, originalExitPrice: 0.5, candleLow: 0.18, candleHigh: 0.22 },
      },
    });
    const cell = (id: string) => rows.find(row => row.legId === id)!.cells[PRICE_CHANGE_COL];

    expect(cell('long')).toEqual([{ text: '+127.02%', color: '#0ECB81' }]);
    expect(cell('short')).toEqual([{ text: '+3.41%', color: '#0ECB81' }]);
    expect(cell('ordi-hedge')).toEqual([{ text: '-3.27%', color: '#F6465D' }]);
    expect(cell('open')).toEqual([{ text: '—', color: '#848E9C' }]);
    expect(cell('corrected')[0].text).toBe('+100.00%');
    // 与平仓价格同一对价，中间的操作方式列不改变价格口径
    expect(rows.find(row => row.legId === 'corrected')!.cells[EXIT_COL][0].text).toBe('0.200000');
    expect(rows.find(row => row.legId === 'long')!.cells[EXIT_COL][0].text).toBe('6.5194');
    // 放得下，不折行
    expect(rows.find(row => row.legId === 'long')!.wrapped[PRICE_CHANGE_COL]).toHaveLength(1);
  });

  it('一个仓位分几刀平掉：平仓价只取最后一刀、盈亏是各刀合计——与页面一样，两格符号可能不同', () => {
    const slice = (id: string, exitPrice: number, pnl: number, closeTime: string): TradeRecord => ({
      id, symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', positionId: 'pos-1', fillId: 'pos-1',
      entryPrice: 100, exitPrice, quantity: 10, leverage: 10, pnl, fee: 0, slippage: 0,
      openTime: Date.parse(T('01:00')), closeTime: Date.parse(closeTime),
    });
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: [leg({ id: 'sliced', trade_record_id: 'pos-1', pre_entry_price: 100 })],
      tradeRecords: [slice('c1', 110, 100, T('05:00')), slice('c2', 108, 80, T('06:00')), slice('c3', 98, -20, T('07:00'))],
      reverseHedgeOrders: [],
    });
    const row = rows.find(r => r.legId === 'sliced')!;
    expect(row.cells[EXIT_COL][0].text).toBe('98.0000');
    expect(row.cells[PRICE_CHANGE_COL]).toEqual([{ text: '-2.00%', color: '#F6465D' }]);
    // 「贡献 / 盈亏」：三刀合计 +160，绿
    expect(row.cells[PNL_COL][0].color).toBe('#0ECB81');
    expect(row.cells[PNL_COL][1].text).toBe('+160.00');
  });

  it('阶段子行各算各的，合计行留空；每一行格子数都与表头列数一致', () => {
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: [
        leg({
          id: 'main', pre_entry_price: 0.0336792, pre_position_size: 94300, source: 'retroactive_from_record',
          post_exit_price_snapshot: 0.0677819, post_simulated_close_time: T('09:00'), post_realized_pnl: 95439.77,
        }),
        leg({
          id: 'hedge-roll', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
          source: 'retroactive_from_record', pre_simulated_time: T('03:00'), pre_entry_price: 0.05, pre_position_size: 50000,
          post_exit_price_snapshot: 0.052, post_simulated_close_time: T('05:00'), post_realized_pnl: -2000,
        }),
      ],
      reverseHedgeOrders: [],
      initialExpectedMaxLoss: 20000,
    });
    const phases = rows.filter(row => row.kind === 'phase' && row.legId.startsWith('main-phase-'));
    expect(phases.map(row => row.cells[PRICE_CHANGE_COL])).toEqual([
      [{ text: '+48.46%', color: '#0ECB81' }],
      [{ text: '+4.00%', color: '#0ECB81' }],
      [{ text: '+30.35%', color: '#0ECB81' }],
    ]);
    expect(rows.find(row => row.legId === 'main')!.cells[PRICE_CHANGE_COL][0].text).toBe('+101.26%');
    // 对冲腿是空单：0.05 → 0.052 按方向计是 -4.00%
    expect(rows.find(row => row.legId === 'hedge-roll')!.cells[PRICE_CHANGE_COL]).toEqual([{ text: '-4.00%', color: '#F6465D' }]);
    const total = rows.at(-1)!;
    expect(total.kind).toBe('total');
    expect(total.cells[PRICE_CHANGE_COL]).toEqual([{ text: '' }]);
    expect(new Set(rows.map(row => row.cells.length))).toEqual(new Set([EXPORT_COLUMN_COUNT]));
  });

  it('主力是空单时，阶段子行按主力方向翻号：同一组起止价，正负与多单相反', () => {
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: [
        leg({
          id: 'main', direction: 'short', pre_entry_price: 0.0336792, pre_position_size: 94300, source: 'retroactive_from_record',
          post_exit_price_snapshot: 0.0677819, post_simulated_close_time: T('09:00'), post_realized_pnl: -95439.77,
        }),
        leg({
          id: 'hedge-roll', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'long',
          source: 'retroactive_from_record', pre_simulated_time: T('03:00'), pre_entry_price: 0.05, pre_position_size: 50000,
          post_exit_price_snapshot: 0.052, post_simulated_close_time: T('05:00'), post_realized_pnl: 2000,
        }),
      ],
      reverseHedgeOrders: [],
      initialExpectedMaxLoss: 20000,
    });
    const phases = rows.filter(row => row.kind === 'phase' && row.legId.startsWith('main-phase-'));
    expect(phases.map(row => row.cells[PRICE_CHANGE_COL])).toEqual([
      [{ text: '-48.46%', color: '#F6465D' }],
      [{ text: '-4.00%', color: '#F6465D' }],
      [{ text: '-30.35%', color: '#F6465D' }],
    ]);
    expect(rows.find(row => row.legId === 'main')!.cells[PRICE_CHANGE_COL]).toEqual([{ text: '-101.26%', color: '#F6465D' }]);
    // 对冲腿这回是多单：0.05 → 0.052 是 +4.00%
    expect(rows.find(row => row.legId === 'hedge-roll')!.cells[PRICE_CHANGE_COL]).toEqual([{ text: '+4.00%', color: '#0ECB81' }]);
  });

  it('千倍以上的涨跌幅也一行放下：百分数不被拆成「+199900.00」与「%」两截', () => {
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: [
        leg({ id: 'x2000', pre_entry_price: 0.0001, post_exit_price_snapshot: 0.2, post_simulated_close_time: T('09:00') }),
        leg({ id: 'x12000', leg_sequence: 2, leg_role: 'main_add_1', pre_entry_price: 0.0001, post_exit_price_snapshot: 1.2345689, post_simulated_close_time: T('09:00') }),
      ],
      reverseHedgeOrders: [],
    });
    const wrapped = (id: string) => rows.find(row => row.legId === id)!.wrapped[PRICE_CHANGE_COL];
    expect(wrapped('x2000')).toEqual([expect.objectContaining({ text: '+199900.00%' })]);
    expect(wrapped('x12000')).toHaveLength(1);
    expect(wrapped('x12000')[0].text).toBe('+1234468.90%');
  });
});

describe('【用户要求】导出图也带「占比」一列（币量 / 仓位右侧，按战役主方向取一侧；这一组是主多战役）', () => {
  // 【用户要求 · 续】多单、空单分开算；合计行分别给出多、空两组 Σ——与页面同源
  // 【用户要求 · 三续】「空单仓位的占比也不需要，没必要存在」：只剩「多单占比」一列，空单的行一格空白、不进它的分母；
  // 导出图不跟页面的排序与折叠走
  afterEach(() => { vi.restoreAllMocks(); });

  /** 「币量 / 仓位」「多单占比」在 COLUMNS 里的下标；「多单占比」右边紧跟「加仓校验」。 */
  const COINS_COL = 8;
  const LONG_COL = 9;
  const EMPTY = [{ text: '' }];

  const T = (hhmm: string) => `2026-08-07T${hhmm}:00.000Z`;
  const leg = (over: Partial<TradeJournal> & { id: string }) => ({
    leg_sequence: 1, leg_role: 'main_open', order_kind: 'main', direction: 'long',
    pre_simulated_time: T('01:00'), ...over,
  }) as TradeJournal;

  // 用户截图里的四条腿：币量 / 名义仓位；开仓价按「名义 ÷ 币量」反推
  const SCREENSHOT = [
    { id: 'main', role: 'main_open', coins: 27_603_119.02, notional: 3_015_630 },
    { id: 'add1', role: 'main_add_1', coins: 10_128_701.13, notional: 1_164_280 },
    { id: 'add2', role: 'main_add_2', coins: 6_374_254.98, notional: 751_560 },
    { id: 'add3', role: 'main_add_3', coins: 34_936_760.27, notional: 4_049_570 },
  ] as const;
  const screenshotLegs = () => SCREENSHOT.map((row, index) => leg({
    id: row.id, leg_sequence: index + 1, leg_role: row.role,
    pre_simulated_time: T(`0${index + 1}:00`),
    pre_entry_price: row.notional / row.coins, pre_position_size: row.notional,
    post_exit_price_snapshot: (row.notional / row.coins) * 1.1, post_simulated_close_time: T('09:00'),
  }));
  const pendingHedge = leg({
    id: 'pending-hedge', leg_sequence: 9, leg_role: 'hedge_initial_a', order_kind: 'hedge', direction: 'short',
    pre_simulated_time: T('05:00'), pre_entry_price: 0.1, pre_position_size: 5_000_000,
  });
  const texts = (cell: { text: string }[]) => cell.map(line => line.text);
  const rowOf = (rows: ReturnType<typeof buildCampaignLegsExportRows>, id: string) => rows.find(row => row.legId === id)!;
  /** 按真实等宽字体（SF Mono / Menlo 约 0.6em、汉字 1em）量宽的假画布。 */
  const monospaceMeasure = () => ({
    font: '',
    measureText(text: string) {
      const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 13);
      let width = 0;
      for (const character of text) width += /[\u3000-\u9fff\uff00-\uffef]/.test(character) ? size : size * 0.6;
      return { width };
    },
  });

  it('表头真的把「多单占比」画在币量 / 仓位之后、加仓校验之前，没有「空单占比」；腿行与合计行画出格式化后的值', () => {
    const drawn: string[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get(target, key) {
        if (key === 'fillText') return (text: string) => { drawn.push(String(text)); };
        if (key === 'measureText') return (text: string) => ({ width: String(text).length * 8 });
        if (key in target) return target[key];
        return () => undefined;
      },
      set(target, key, value) { target[key] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);

    buildCampaignLegsListCanvas({ ...input(), legs: screenshotLegs() }, { includeHeader: false, scale: 1 });

    const at = drawn.indexOf('多单占比');
    expect(at).toBeGreaterThan(0);
    expect(drawn.slice(at - 1, at + 2)).toEqual(['币量 / 仓位', '多单占比', '加仓校验']);
    expect(LONG_COL + 1).toBe(ADD_SIZING_COL);
    expect(drawn).not.toContain('空单占比');
    expect(drawn).not.toContain('占比');
    expect(drawn).toEqual(expect.arrayContaining(['34.9%', '33.6%', '44.2%', '45.1%', '79,042,835.4', '8981040.00', '100.0%']));
  });

  it('与页面同一个 helper：截图里的四条腿印出同样的占比；合计行写 Σ 与多单的 100.0%', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), legs: screenshotLegs(), reverseHedgeOrders: [] });
    const cell = (id: string) => rowOf(rows, id).cells[LONG_COL];

    // 左边一格就是截图上的数
    expect(texts(rowOf(rows, 'main').cells[COINS_COL])).toEqual(['27,603,119.02', '3015630.00']);
    expect(texts(cell('main'))).toEqual(['34.9%', '33.6%']);
    expect(texts(cell('add1'))).toEqual(['12.8%', '13.0%']);
    expect(texts(cell('add2'))).toEqual(['8.1%', '8.4%']);
    expect(texts(cell('add3'))).toEqual(['44.2%', '45.1%']);
    // 中性色：上行数字与币量同色（缺省前景），下行与名义仓位同样淡；行里不挂标签（列头已写明方向）
    expect(cell('main')).toEqual([
      { text: '34.9%' },
      { text: '33.6%', color: '#848E9C' },
    ]);
    expect(cell('main').map(line => line.color)).toEqual(rowOf(rows, 'main').cells[COINS_COL].map(line => line.color));
    // 每一行都是 12 格：右边紧挨着的是加仓校验，不是另一列占比
    for (const row of rows) expect(row.cells).toHaveLength(EXPORT_COLUMN_COUNT);

    const total = rows.at(-1)!;
    expect(total.kind).toBe('total');
    // 全是多单：Σ 格只列多单一组；「多单占比」写 100.0%；右边的加仓校验留空
    expect(texts(total.cells[COINS_COL])).toEqual(['79,042,835.4', '8981040.00']);
    expect(total.cells[LONG_COL]).toEqual([
      { text: '100.0%', color: '#5F6B7A' },
      { text: '100.0%', color: '#848E9C' },
    ]);
    expect(total.cells[LONG_COL + 1]).toEqual(EMPTY);
    expect(total.cells[COINS_COL].map(line => line.tag)).toEqual([
      { text: '多', color: '#0ECB81' }, { text: '多', color: '#0ECB81', hidden: true },
    ]);
    for (const line of [...total.cells[COINS_COL], ...total.cells[LONG_COL]]) {
      expect(['#5F6B7A', '#848E9C']).toContain(line.color);
    }
    // 「100.0%」与各腿的占比都一行放下，不折行
    expect(total.wrapped[LONG_COL]).toHaveLength(2);
    expect(total.wrapped[COINS_COL]).toHaveLength(2);
    for (const row of rows.filter(r => r.kind === 'leg')) expect(row.wrapped[LONG_COL]).toHaveLength(2);
  });

  it('状态为「挂单中」的空单在「多单占比」列一格空白、不进 Σ；缺开仓价的腿上行「—」、名义仍进下行分母', () => {
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: [
        ...screenshotLegs(),
        pendingHedge,
        leg({
          id: 'no-price', leg_sequence: 10, leg_role: 'main_add_4', pre_simulated_time: T('06:00'),
          pre_position_size: 1_018_960, post_simulated_close_time: T('09:00'),
        }),
      ],
      reverseHedgeOrders: [],
    });
    const cell = (id: string) => texts(rowOf(rows, id).cells[LONG_COL]);
    expect(texts(rowOf(rows, 'pending-hedge').cells[COINS_COL])).toEqual(['50,000,000', '5000000.00']);
    expect(rowOf(rows, 'pending-hedge').cells[LONG_COL]).toEqual(EMPTY);
    expect(texts(rowOf(rows, 'no-price').cells[COINS_COL])).toEqual(['—', '1018960.00']);
    // 名义分母变成 8,981,040 + 1,018,960 = 10,000,000；币量分母不变
    expect(cell('no-price')).toEqual(['—', '10.2%']);
    expect(cell('main')).toEqual(['34.9%', '30.2%']);
    expect(cell('add3')).toEqual(['44.2%', '40.5%']);
    const total = rows.at(-1)!;
    // 空单那一方向只有挂单中的对冲：不列空单那组
    expect(texts(total.cells[COINS_COL])).toEqual(['79,042,835.4', '10000000.00']);
    expect(texts(total.cells[LONG_COL])).toEqual(['100.0%', '100.0%']);
    // 行里与「多单占比」的合计格都不挂标签
    for (const row of rows) expect(row.cells[LONG_COL].every(line => line.tag == null)).toBe(true);
  });

  it('状态为「挂单中」的多单（镜像止盈还没触发）在「多单占比」列两行「—」、不进分母', () => {
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: [
        ...screenshotLegs(),
        leg({
          id: 'pending-mirror', leg_sequence: 10, leg_role: 'mirror_tp', pre_simulated_time: T('05:30'),
          pre_entry_price: 0.1, pre_position_size: 5_000_000,
        }),
      ],
      reverseHedgeOrders: [],
    });
    expect(rowOf(rows, 'pending-mirror').cells[LONG_COL]).toEqual([{ text: '—' }, { text: '—', color: '#848E9C' }]);
    expect(texts(rowOf(rows, 'main').cells[LONG_COL])).toEqual(['34.9%', '33.6%']);
    expect(texts(rows.at(-1)!.cells[COINS_COL])).toEqual(['79,042,835.4', '8981040.00']);
    expect(texts(rows.at(-1)!.cells[LONG_COL])).toEqual(['100.0%', '100.0%']);
  });

  it('一条都不计入：合计行两格都是「—」，不挂标签', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), legs: [pendingHedge], reverseHedgeOrders: [] });
    expect(rowOf(rows, 'pending-hedge').cells[LONG_COL]).toEqual(EMPTY);
    const total = rows.at(-1)!;
    expect(total.cells[LONG_COL + 1]).toEqual(EMPTY);
    for (const col of [COINS_COL, LONG_COL]) {
      expect(texts(total.cells[col])).toEqual(['—', '—']);
      expect(total.cells[col].every(line => line.tag == null)).toBe(true);
    }
  });

  // 合计行的 Σ币量比任何一条腿都可能多一位：十亿级的腿加起来到了百亿级（17 个字符），也不能被逐字拆成两截
  const BILLION_SCALE = [
    { id: 'main', role: 'main_open', coins: 3_015_630_119.02, notional: 30_000 },
    { id: 'add1', role: 'main_add_1', coins: 3_164_280_701.13, notional: 31_000 },
    { id: 'add2', role: 'main_add_2', coins: 2_751_560_254.97, notional: 28_000 },
    { id: 'add3', role: 'main_add_3', coins: 3_049_570_760.27, notional: 30_808 },
  ] as const;
  const billionLegs = () => BILLION_SCALE.map((row, index) => leg({
    id: row.id, leg_sequence: index + 1, leg_role: row.role,
    pre_simulated_time: T(`0${index + 1}:00`),
    pre_entry_price: row.notional / row.coins, pre_position_size: row.notional,
    post_exit_price_snapshot: (row.notional / row.coins) * 1.1, post_simulated_close_time: T('09:00'),
  }));
  const expectBillionTotalOnOneLine = (rows: ReturnType<typeof buildCampaignLegsExportRows>) => {
    const total = rows.at(-1)!;
    expect(texts(total.cells[COINS_COL])).toEqual(['11,981,041,835.39', '119808.00']);
    expect(texts(total.wrapped[COINS_COL])).toEqual(['11,981,041,835.39', '119808.00']);
    // 前面挂着「多」标签也一行放下
    expect(total.wrapped[COINS_COL][0].tag).toEqual({ text: '多', color: '#0ECB81' });
    for (const row of rows.filter(r => r.kind === 'leg')) expect(row.wrapped[COINS_COL]).toHaveLength(2);
    // 合计行不因此被撑高：仍是上下各 12 的留白夹两行 17 高的字（被拆开时会多出一行，变成 75）
    expect(total.height).toBe(12 * 2 + 17 * 2);
  };
  /** 同样的百亿级，再加一组百亿级的空单：Σ 格两组各两行，一个字都不折，合计行正好四行高；「多单占比」仍只有两行。 */
  const billionBothSides = () => [
    ...billionLegs(),
    leg({
      id: 'hedge', leg_sequence: 5, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
      pre_simulated_time: T('05:00'), pre_entry_price: 30_000 / 11_981_041_835.39, pre_position_size: 30_000,
      post_exit_price_snapshot: 30_000 / 11_981_041_835.39, post_simulated_close_time: T('06:00'),
    }),
  ];
  const expectBillionBothSidesOnOneLine = (rows: ReturnType<typeof buildCampaignLegsExportRows>) => {
    const total = rows.at(-1)!;
    expect(texts(total.cells[COINS_COL])).toEqual(['11,981,041,835.39', '119808.00', '11,981,041,835.39', '30000.00']);
    expect(total.wrapped[COINS_COL]).toEqual(total.cells[COINS_COL]);
    expect(texts(total.cells[LONG_COL])).toEqual(['100.0%', '100.0%']);
    expect(total.wrapped[LONG_COL]).toEqual(total.cells[LONG_COL]);
    expect(total.height).toBe(12 * 2 + 17 * 4);
  };

  it('百亿级 Σ币量（两位小数，17 个字符）在合计行一行放下：按无画布时的 0.62em 估算', () => {
    expectBillionTotalOnOneLine(buildCampaignLegsExportRows({ ...input(), legs: billionLegs(), reverseHedgeOrders: [] }));
    expectBillionBothSidesOnOneLine(buildCampaignLegsExportRows({ ...input(), legs: billionBothSides(), reverseHedgeOrders: [] }));
  });

  it('百亿级 Σ币量在合计行一行放下：按真实等宽字体（SF Mono / Menlo 约 0.6em）量宽', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(monospaceMeasure() as never);
    // 量宽画布在模块里只取一次：换一份新模块，让它拿到这支 mock
    vi.resetModules();
    const fresh = await import('@/lib/campaignLegsPngExport');
    expectBillionTotalOnOneLine(fresh.buildCampaignLegsExportRows({ ...input(), legs: billionLegs(), reverseHedgeOrders: [] }));
    expectBillionBothSidesOnOneLine(fresh.buildCampaignLegsExportRows({ ...input(), legs: billionBothSides(), reverseHedgeOrders: [] }));
  });

  const phaseLegs = () => [
    leg({
      id: 'main', pre_entry_price: 0.0336792, pre_position_size: 94300, source: 'retroactive_from_record',
      post_exit_price_snapshot: 0.0677819, post_simulated_close_time: T('09:00'), post_realized_pnl: 95439.77,
    }),
    leg({
      id: 'hedge-roll', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
      source: 'retroactive_from_record', pre_simulated_time: T('03:00'), pre_entry_price: 0.05, pre_position_size: 50000,
      post_exit_price_snapshot: 0.052, post_simulated_close_time: T('05:00'), post_realized_pnl: -2000,
    }),
  ];

  it('阶段子行这一列留空；每一行格子数都与表头列数一致，「多单占比」88、没有「空单占比」那 88', () => {
    const rows = buildCampaignLegsExportRows({
      ...input(),
      legs: phaseLegs(),
      reverseHedgeOrders: [],
      initialExpectedMaxLoss: 20000,
    });
    const phases = rows.filter(row => row.kind === 'phase');
    expect(phases).toHaveLength(3);
    for (const row of phases) {
      expect(row.cells[LONG_COL]).toEqual(EMPTY);
      expect(row.cells[COINS_COL]).toEqual(EMPTY);
    }
    // 多单主力独占多单的 100%；空单对冲一格空白，不进多单的分母（一个分母时曾是 73.7% / 26.3%）
    expect(texts(rowOf(rows, 'main').cells[LONG_COL])).toEqual(['100.0%', '100.0%']);
    expect(rowOf(rows, 'hedge-roll').cells[LONG_COL]).toEqual(EMPTY);
    // 空单那组 Σ 照旧列出
    expect(texts(rows.at(-1)!.cells[COINS_COL])).toEqual(['2,799,947.74', '94300.00', '1,000,000', '50000.00']);
    // 合计行：「多单占比」只有多单那一组，与 Σ 格的第一组同一行，不垫空白
    expect(texts(rows.at(-1)!.cells[LONG_COL])).toEqual(['100.0%', '100.0%']);
    expect(new Set(rows.map(row => row.cells.length))).toEqual(new Set([EXPORT_COLUMN_COUNT]));

    // 画布宽度 = 各列宽之和 + 左右边距：原来一列「占比」96，拆成「多单占比」「空单占比」各 88，再去掉「空单占比」；
    // 「币量 / 仓位」仍是 184；第一列「#」（52）已去掉，「角色」152 打头
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({}, {
      get: (_target, key) => (key === 'measureText' ? () => ({ width: 0 }) : () => undefined),
    }) as never);
    const canvas = buildCampaignLegsListCanvas({ ...input(), legs: [] }, { includeHeader: false, scale: 1 });
    expect(canvas.width).toBe(152 + 300 + 150 + 104 + 118 + 118 + 102 + 120 + 184 + 88 + 170 + 132 + 444 + 40 * 2);
  });

  it('按真实等宽字体量宽：「100.0%」与「—」在 88 宽的「多单占比」里都不折行；列头「多单占比」（12px 粗体 4 个汉字）放得进去、不被压扁', async () => {
    const measure = monospaceMeasure();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(measure as never);
    vi.resetModules();
    const fresh = await import('@/lib/campaignLegsPngExport');
    const rows = fresh.buildCampaignLegsExportRows({
      ...input(),
      legs: [
        ...phaseLegs(),
        pendingHedge,
        // 挂单中的多单：两行「—」
        leg({ id: 'pending-mirror', leg_sequence: 10, leg_role: 'mirror_tp', pre_entry_price: 0.05, pre_position_size: 1_000 }),
      ],
      reverseHedgeOrders: [],
    });
    expect(texts(rowOf(rows, 'pending-mirror').cells[LONG_COL])).toEqual(['—', '—']);
    for (const row of rows.filter(r => r.kind !== 'note')) {
      expect(row.wrapped[LONG_COL]).toEqual(row.cells[LONG_COL]);
    }
    // 列头画在格内左右各留 10 的宽度里（fillText 的 maxWidth）：量出来的宽不能超过它，否则画布会把字横向压扁
    measure.font = '700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    expect(measure.measureText('多单占比').width).toBeLessThanOrEqual(88 - 20);
  });

  it('导出图不跟页面的排序与折叠走：腿按传入的先后画，只列可见阶段', () => {
    // 空单对冲排在前面——页面上点了排序也好、折叠了阶段也好，导出图照传入顺序画
    const legs = [...phaseLegs()].reverse();
    const rows = buildCampaignLegsExportRows({ ...input(), legs, reverseHedgeOrders: [], initialExpectedMaxLoss: 20000 });
    expect(rows.map(row => `${row.kind}:${row.legId}`)).toEqual([
      'leg:hedge-roll',
      'leg:main',
      'phase:main-phase-1',
      'phase:main-phase-2',
      'phase:main-phase-3',
      'total:legs-total',
    ]);
  });

  describe('【用户要求 · 续】多单与空单分开算：空单不进多单的分母，只在合计行给出 Σ', () => {
    const closed = { post_simulated_close_time: T('09:00') };
    /** 用户截图的形状（KAITOUSDT，主多）：主力多单、镜像止盈多单、滚动对冲空单、加仓多单，全部已平仓。 */
    const userShape = () => [
      leg({ id: 'main', pre_entry_price: 1, pre_position_size: 3_000, post_exit_price_snapshot: 1.2, ...closed }),
      leg({
        id: 'mirror', leg_sequence: 2, leg_role: 'mirror_tp', order_kind: 'main',
        pre_entry_price: 1, pre_position_size: 3_000, post_exit_price_snapshot: 1.1, post_simulated_close_time: T('04:00'),
      }),
      leg({
        id: 'hedge', leg_sequence: 3, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
        pre_simulated_time: T('03:00'), pre_entry_price: 1.1, pre_position_size: 2_000,
        post_exit_price_snapshot: 1.05, post_simulated_close_time: T('05:00'),
      }),
      leg({
        id: 'add', leg_sequence: 4, leg_role: 'main_add_1', pre_simulated_time: T('06:00'),
        pre_entry_price: 1.2, pre_position_size: 1_500, post_exit_price_snapshot: 1.3, ...closed,
      }),
    ];
    const rowsOf = (legs: TradeJournal[]) => buildCampaignLegsExportRows({ ...input(), legs, reverseHedgeOrders: [] });
    const shareOf = (rows: ReturnType<typeof rowsOf>, id: string, col: number) => rowOf(rows, id).cells[col];

    it('用户截图的形状：三条多单在「多单占比」列加起来 100.0%，空单对冲一格空白；合计行照旧列出空单那组 Σ', () => {
      const rows = rowsOf(userShape());
      expect(['main', 'mirror', 'add'].map(id => texts(shareOf(rows, id, LONG_COL)))).toEqual([
        ['41.4%', '40.0%'], ['41.4%', '40.0%'], ['17.2%', '20.0%'],
      ]);
      for (const index of [0, 1]) {
        expect(['main', 'mirror', 'add']
          .map(id => Number.parseFloat(shareOf(rows, id, LONG_COL)[index].text))
          .reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 6);
      }
      expect(shareOf(rows, 'hedge', LONG_COL)).toEqual(EMPTY);

      const total = rows.at(-1)!;
      expect(texts(total.cells[COINS_COL])).toEqual(['7,250', '7500.00', '1,818.18', '2000.00']);
      expect(texts(total.cells[LONG_COL])).toEqual(['100.0%', '100.0%']);
    });

    it('战役方向说了算：主多战役（campaign.direction = main_long）里即使主力是空单，这一列仍看多单——多单对冲有数，空单一格空白、只进空单那组 Σ', () => {
      const rows = rowsOf([
        leg({ id: 'main-short', direction: 'short', pre_entry_price: 2, pre_position_size: 5_000, post_exit_price_snapshot: 1.5, ...closed }),
        leg({
          id: 'hedge-long', leg_sequence: 2, leg_role: 'hedge_initial_a', order_kind: 'hedge', direction: 'long',
          pre_simulated_time: T('02:00'), pre_entry_price: 2, pre_position_size: 2_000,
          post_exit_price_snapshot: 2.1, post_simulated_close_time: T('03:00'),
        }),
        leg({
          id: 'add-short', leg_sequence: 3, leg_role: 'main_add_1', direction: 'short', pre_simulated_time: T('04:00'),
          pre_entry_price: 2, pre_position_size: 3_000, post_exit_price_snapshot: 1.5, ...closed,
        }),
      ]);
      expect(texts(shareOf(rows, 'hedge-long', LONG_COL))).toEqual(['100.0%', '100.0%']);
      expect(shareOf(rows, 'main-short', LONG_COL)).toEqual(EMPTY);
      expect(shareOf(rows, 'add-short', LONG_COL)).toEqual(EMPTY);
      const total = rows.at(-1)!;
      expect(texts(total.cells[COINS_COL])).toEqual(['1,000', '2000.00', '4,000', '8000.00']);
      expect(total.cells[COINS_COL].map(line => line.tag?.hidden ? `(${line.tag.text})` : line.tag?.text))
        .toEqual(['多', '(多)', '空', '(空)']);
      expect(texts(total.cells[LONG_COL])).toEqual(['100.0%', '100.0%']);
    });

    it('主多战役里唯一的多单（对冲）还挂单中：多单那组不列，占比合计一格空白；Σ 格只剩空单那组', () => {
      const rows = rowsOf([
        leg({ id: 'main-short', direction: 'short', pre_entry_price: 2, pre_position_size: 5_000, post_exit_price_snapshot: 1.5, ...closed }),
        leg({
          id: 'pending-long-hedge', leg_sequence: 2, leg_role: 'hedge_initial_a', order_kind: 'hedge', direction: 'long',
          pre_simulated_time: T('02:00'), pre_entry_price: 2.2, pre_position_size: 2_000,
        }),
      ]);
      expect(shareOf(rows, 'pending-long-hedge', LONG_COL)).toEqual([{ text: '—' }, { text: '—', color: '#848E9C' }]);
      expect(shareOf(rows, 'main-short', LONG_COL)).toEqual(EMPTY);
      const total = rows.at(-1)!;
      expect(texts(total.cells[COINS_COL])).toEqual(['2,500', '5000.00']);
      expect(total.cells[COINS_COL][0].tag).toEqual({ text: '空', color: '#F6465D' });
      expect(total.cells[LONG_COL]).toEqual(EMPTY);
      expect(total.height).toBe(12 * 2 + 17 * 2);
    });

    it('合计行：两格逐行对齐——占比的两行与 Σ 格的第 0、1 行（多单那组）同一行；Σ 四行时合计行撑到四行高，腿行不变', () => {
      const rows = rowsOf(userShape());
      const total = rows.at(-1)!;
      const coins = total.cells[COINS_COL];
      const long = total.cells[LONG_COL];
      expect(coins).toHaveLength(4);
      expect(long).toHaveLength(2);
      // Σ 格第 0、1 行是多单那组 → 多单占比的两行；第 2、3 行是空单那组，右边没有对应的占比
      expect(coins.map(line => line.tag?.text)).toEqual(['多', '多', '空', '空']);
      expect(long.map(line => line.text)).toEqual(['100.0%', '100.0%']);
      expect(coins.map(line => line.color)).toEqual(['#5F6B7A', '#848E9C', '#5F6B7A', '#848E9C']);
      expect(long.map(line => line.color)).toEqual(['#5F6B7A', '#848E9C']);
      // 「多单占比」不挂标签，也没有为别的列垫的空白行
      expect(long.every(line => line.tag == null)).toBe(true);
      expect(long.every(line => line.text !== '')).toBe(true);
      // 不折行：绘制行就是逻辑行
      expect(total.wrapped[COINS_COL]).toEqual(coins);
      expect(total.wrapped[LONG_COL]).toEqual(long);
      expect(total.height).toBe(12 * 2 + 17 * 4);
      // 腿行：多单的占比格仍是两行、不折行，空单一格空白；行高由三行的时间格定（开 / 平 / 操作）
      for (const row of rows.filter(r => r.kind === 'leg')) {
        if (row.legId === 'hedge') {
          expect(row.cells[LONG_COL]).toEqual(EMPTY);
        } else {
          expect(row.wrapped[LONG_COL]).toEqual(row.cells[LONG_COL]);
          expect(row.wrapped[LONG_COL]).toHaveLength(2);
        }
        expect(row.wrapped[TIME_COL]).toHaveLength(3);
        expect(row.height).toBe(12 * 2 + 17 * 3);
      }
      expect(new Set(rows.map(row => row.cells.length))).toEqual(new Set([EXPORT_COLUMN_COUNT]));
    });

    it('画出来：标签只画在「币量 / 仓位」合计格里（多绿 / 空红），百分数中性色；「多单占比」的「100.0%」与多单那组 Σ 画在同一条基线上', () => {
      const drawn: { text: string; color: unknown; x: number; y: number; font: unknown }[] = [];
      const state: Record<string | symbol, unknown> = {};
      const ctx = new Proxy(state, {
        get(target, key) {
          if (key === 'fillText') return (text: string, x: number, y: number) => { drawn.push({ text: String(text), color: target.fillStyle, x, y, font: target.font }); };
          if (key === 'measureText') return (text: string) => ({ width: String(text).length * 8 });
          if (key in target) return target[key];
          return () => undefined;
        },
        set(target, key, value) { target[key] = value; return true; },
      }) as unknown as CanvasRenderingContext2D;
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);

      buildCampaignLegsListCanvas({ ...input(), legs: userShape() }, { includeHeader: false, scale: 1 });

      const tags = drawn.filter(item => item.text === '多' || item.text === '空');
      // 只有合计行 Σ 格的两枚；隐藏标签不画，腿行与「多单占比」不画标签
      expect(tags.map(item => item.text)).toEqual(['多', '空']);
      for (const tag of tags) {
        expect(tag.color).toBe(tag.text === '多' ? '#0ECB81' : '#F6465D');
        expect(String(tag.font)).toMatch(/^700 /);
      }
      // 百分数不上红绿
      const pctItems = drawn.filter(item => /^\d+\.\d%$/.test(item.text));
      expect(pctItems.length).toBeGreaterThan(0);
      for (const item of pctItems) expect(['#0ECB81', '#F6465D']).not.toContain(item.color);
      // 合计行：「多」标签那一行的 y 与「多单占比」的第一个「100.0%」相同；空单那组右边不画占比
      const totalPcts = drawn.slice(drawn.findIndex(item => item.text === '合计')).filter(item => item.text === '100.0%');
      expect(totalPcts).toHaveLength(2);
      const [longTop, longBottom] = totalPcts;
      const [longTag, shortTag] = tags;
      expect(longTop.y).toBe(longTag.y);
      expect(longBottom.y).toBe(longTop.y + 17);
      expect(shortTag.y).toBe(longTag.y + 17 * 2);
      // 「多单占比」紧挨在 Σ 格右边（左起差一个 184 宽的「币量 / 仓位」）；它右边 88 处就是「加仓校验」的列头
      expect(longTop.x - longTag.x).toBe(184);
      const header = (title: string) => drawn.find(item => item.text === title)!;
      expect(header('加仓校验').x - header('多单占比').x).toBe(88);
      expect(drawn.some(item => item.text === '空单占比')).toBe(false);
    });

    it('带标签的行放不下时：正文按标签右边剩下的宽度折，续行挂隐藏标签对齐，一个字不丢', () => {
      const tag = { text: '空', color: '#F6465D' };
      // 无画布时按 0.62em 估：「1,818.18」≈ 64、「2000.00」≈ 56，整行 ≈ 129；标签「空」13 + 空隙 6
      const pieces = wrapCampaignLegsExportLine({ text: '1,818.18 2000.00', tag }, 100);
      expect(pieces.map(piece => piece.text)).toEqual(['1,818.18', '2000.00']);
      expect(pieces[0].tag).toEqual(tag);
      for (const piece of pieces.slice(1)) expect(piece.tag).toEqual({ ...tag, hidden: true });
      // 不带标签时 130 放得下整行；带上标签就只剩 111，得折
      expect(wrapCampaignLegsExportLine({ text: '1,818.18 2000.00' }, 130)).toHaveLength(1);
      expect(wrapCampaignLegsExportLine({ text: '1,818.18 2000.00', tag }, 130)).toHaveLength(2);
      // 没有标签时能放下的宽度，挂上标签后要扣掉标签的宽
      const plain = { text: '11,981,041,835.39' };
      const width = 17 * 13 * 0.62;
      expect(wrapCampaignLegsExportLine(plain, Math.ceil(width))).toEqual([plain]);
      expect(wrapCampaignLegsExportLine({ ...plain, tag }, Math.ceil(width)).length).toBeGreaterThan(1);
      // 放得下就原样返回
      expect(wrapCampaignLegsExportLine({ text: '100.0%', tag }, 76)).toEqual([{ text: '100.0%', tag }]);
    });
  });

  /**
   * 【用户要求 · 四续】「主空战役里，这一列改成按战役主方向算（主多看多单、主空看空单）」。
   * 与页面同一个 helper（resolveLegPositionShareSide）：战役方向说了算，导出图的表头列名、腿行与合计行都跟着那一侧。
   */
  describe('【用户要求 · 四续】主空战役：这一列改看空单', () => {
    const closed = { post_simulated_close_time: T('09:00') };
    const mainShortInput = () => ({
      ...input(),
      campaign: { ...campaign, direction: 'main_short' } as TradeCampaign,
      reverseHedgeOrders: [],
      // 主力空单 5,000 U（2,500 币）、多单对冲 2,000 U（1,000 币）、加仓空单 3,000 U（1,500 币）
      legs: [
        leg({ id: 'main-short', direction: 'short', pre_entry_price: 2, pre_position_size: 5_000, post_exit_price_snapshot: 1.5, ...closed }),
        leg({
          id: 'hedge-long', leg_sequence: 2, leg_role: 'hedge_initial_a', order_kind: 'hedge', direction: 'long',
          pre_simulated_time: T('02:00'), pre_entry_price: 2, pre_position_size: 2_000,
          post_exit_price_snapshot: 2.1, post_simulated_close_time: T('03:00'),
        }),
        leg({
          id: 'add-short', leg_sequence: 3, leg_role: 'main_add_1', direction: 'short', pre_simulated_time: T('04:00'),
          pre_entry_price: 2, pre_position_size: 3_000, post_exit_price_snapshot: 1.5, ...closed,
        }),
      ],
    });

    it('与页面同一批数：两条空单在占比列加起来 100.0%，多单对冲一格空白；合计行先垫两行空白，「100.0%」与空单那组 Σ 同一行', () => {
      const rows = buildCampaignLegsExportRows(mainShortInput());
      expect(campaignLegsShareSide(mainShortInput())).toBe('short');
      expect(texts(rowOf(rows, 'main-short').cells[LONG_COL])).toEqual(['62.5%', '62.5%']);
      expect(texts(rowOf(rows, 'add-short').cells[LONG_COL])).toEqual(['37.5%', '37.5%']);
      expect(rowOf(rows, 'hedge-long').cells[LONG_COL]).toEqual(EMPTY);
      // 腿行的颜色与主多时一样：上行随币量（缺省前景），下行淡色；行里不挂标签
      expect(rowOf(rows, 'main-short').cells[LONG_COL]).toEqual([
        { text: '62.5%' },
        { text: '62.5%', color: '#848E9C' },
      ]);
      for (const row of rows) {
        expect(row.cells).toHaveLength(EXPORT_COLUMN_COUNT);
        expect(row.cells[LONG_COL].every(line => line.tag == null)).toBe(true);
      }

      const total = rows.at(-1)!;
      // Σ 照旧先多后空（分组跟腿的方向走）：多单那组是对冲一共开了多大
      expect(texts(total.cells[COINS_COL])).toEqual(['1,000', '2000.00', '4,000', '8000.00']);
      expect(total.cells[COINS_COL].map(line => line.tag?.text)).toEqual(['多', '多', '空', '空']);
      // 占比格：空单那组是第二组，先垫两行空白，第 2、3 行才是「100.0%」——与 Σ 格逐行对齐
      expect(texts(total.cells[LONG_COL])).toEqual(['', '', '100.0%', '100.0%']);
      expect(total.cells[LONG_COL].slice(2).map(line => line.color)).toEqual(['#5F6B7A', '#848E9C']);
      expect(total.cells[LONG_COL].every(line => line.tag == null)).toBe(true);
      expect(total.wrapped[LONG_COL]).toEqual(total.cells[LONG_COL]);
      expect(total.height).toBe(12 * 2 + 17 * 4);
    });

    it('只有空单（没开对冲）时不垫空白：空单那组就是第一组', () => {
      const base = mainShortInput();
      const rows = buildCampaignLegsExportRows({ ...base, legs: base.legs.filter(item => item.id !== 'hedge-long') });
      const total = rows.at(-1)!;
      expect(texts(total.cells[COINS_COL])).toEqual(['4,000', '8000.00']);
      expect(total.cells[COINS_COL][0].tag).toEqual({ text: '空', color: '#F6465D' });
      expect(texts(total.cells[LONG_COL])).toEqual(['100.0%', '100.0%']);
      expect(total.height).toBe(12 * 2 + 17 * 2);
    });

    it('表头画的是「空单占比」（不是「多单占比」），位置不变；「100.0%」与空单那组 Σ 画在同一条基线上', () => {
      const drawn: { text: string; x: number; y: number }[] = [];
      const state: Record<string | symbol, unknown> = {};
      const ctx = new Proxy(state, {
        get(target, key) {
          if (key === 'fillText') return (text: string, x: number, y: number) => { drawn.push({ text: String(text), x, y }); };
          if (key === 'measureText') return (text: string) => ({ width: String(text).length * 8 });
          if (key in target) return target[key];
          return () => undefined;
        },
        set(target, key, value) { target[key] = value; return true; },
      }) as unknown as CanvasRenderingContext2D;
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);

      buildCampaignLegsListCanvas(mainShortInput(), { includeHeader: false, scale: 1 });

      const at = drawn.findIndex(item => item.text === '空单占比');
      expect(at).toBeGreaterThan(0);
      expect(drawn.slice(at - 1, at + 2).map(item => item.text)).toEqual(['币量 / 仓位', '空单占比', '加仓校验']);
      expect(drawn.some(item => item.text === '多单占比')).toBe(false);
      const header = (title: string) => drawn.find(item => item.text === title)!;
      expect(header('加仓校验').x - header('空单占比').x).toBe(88);
      // 合计行：「空」标签那一行的 y 与占比格第一个「100.0%」相同（垫的两行空白把它顶到了第二组）
      const totalFrom = drawn.findIndex(item => item.text === '合计');
      const tags = drawn.slice(totalFrom).filter(item => item.text === '多' || item.text === '空');
      expect(tags.map(item => item.text)).toEqual(['多', '空']);
      const pcts = drawn.slice(totalFrom).filter(item => item.text === '100.0%');
      expect(pcts).toHaveLength(2);
      expect(pcts[0].y).toBe(tags[1].y);
      expect(pcts[1].y).toBe(pcts[0].y + 17);
      expect(pcts[0].x - tags[1].x).toBe(184);
      // 腿行的百分数也画出来了（62.5% / 37.5%）
      expect(drawn.slice(0, totalFrom).filter(item => item.text === '62.5%').length).toBeGreaterThan(0);
    });

    it('战役方向缺失（旧数据）时从主力腿回推：这一批腿照样看空单', () => {
      const base = mainShortInput();
      const legacy = { ...base, campaign: { ...base.campaign, direction: undefined } as unknown as TradeCampaign };
      expect(campaignLegsShareSide(legacy)).toBe('short');
      const rows = buildCampaignLegsExportRows(legacy);
      expect(texts(rowOf(rows, 'main-short').cells[LONG_COL])).toEqual(['62.5%', '62.5%']);
      expect(rowOf(rows, 'hedge-long').cells[LONG_COL]).toEqual(EMPTY);
    });
  });
});

describe('【用户要求】导出图的第一列只有「角色」：不印序号、不挂「回填」，状态画在角色标签上', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const T = (hhmm: string) => `2026-08-07T${hhmm}:00.000Z`;
  const leg = (over: Partial<TradeJournal> & { id: string }) => ({
    leg_sequence: 1, leg_role: 'main_open', order_kind: 'main', direction: 'long', source: 'retroactive_from_record',
    pre_simulated_time: T('01:00'), ...over,
  }) as TradeJournal;
  const shapeLegs = () => [
    leg({ id: 'main', pre_entry_price: 1, pre_position_size: 1_000, post_exit_price_snapshot: 1.2, post_simulated_close_time: T('09:00') }),
    leg({
      id: 'mirror', leg_sequence: 2, leg_role: 'mirror_tp', pre_entry_price: 1, pre_position_size: 1_000,
      post_exit_price_snapshot: 1.1, post_simulated_close_time: T('04:00'),
    }),
    // 挂单中：对冲还没有成交
    leg({ id: 'pending', leg_sequence: 3, leg_role: 'hedge_initial_b', order_kind: 'hedge', direction: 'short', pre_entry_price: 0.9, pre_position_size: 500 }),
    // 进行中：加仓还没平
    leg({ id: 'open', leg_sequence: 4, leg_role: 'main_add_2', pre_simulated_time: T('05:00'), pre_entry_price: 1.1, pre_position_size: 800, source: 'live' }),
    leg({ id: 'unclassified', leg_sequence: 5, leg_role: null, post_simulated_close_time: T('06:00') }),
    // 没有角色、进行中：同样画成标签（中性灰、写「—」），带圆点
    leg({ id: 'unclassified-open', leg_sequence: 6, leg_role: null, pre_simulated_time: T('07:00') }),
  ];
  const rowsOf = () => buildCampaignLegsExportRows({ ...input(), legs: shapeLegs(), reverseHedgeOrders: [] });
  const roleOf = (rows: ReturnType<typeof rowsOf>, id: string) => rows.find(row => row.legId === id)!.cells[ROLE_COL];

  it('没有角色和独立单角色的手动对冲同列编号与蓝色标签，原始归类不改变', () => {
    const manualHedges = [
      leg({ id: 'manual-late', leg_role: 'standalone', order_kind: 'hedge', direction: 'short', pre_simulated_time: T('04:00') }),
      leg({ id: 'manual-early', leg_role: null, order_kind: 'hedge', direction: 'short', pre_simulated_time: T('02:00') }),
      leg({ id: 'rolling', leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short', pre_simulated_time: T('03:00') }),
    ];
    const rows = buildCampaignLegsExportRows({ ...input(), legs: manualHedges, reverseHedgeOrders: [] });
    expect(roleOf(rows, 'manual-early')[0].text).toBe('滚动对冲 1');
    expect(roleOf(rows, 'rolling')[0].text).toBe('滚动对冲 2');
    expect(roleOf(rows, 'manual-late')[0].text).toBe('滚动对冲 3');
    for (const row of rows.filter(item => item.kind === 'leg')) {
      expect(row.cells[ROLE_COL][0].color).toBe('#5BA3FF');
      expect(row.cells[ROLE_COL][0].chip?.color).toBe('#5BA3FF');
    }
    expect(manualHedges.map(item => item.leg_role)).toEqual(['standalone', null, 'hedge_rolling']);
  });

  it('每条腿的角色格只有一行角色名：没有序号、没有「回填」、也没有「挂单中 / 进行中」字样', () => {
    const rows = rowsOf();
    expect(roleOf(rows, 'main').map(line => line.text)).toEqual(['主力开仓']);
    expect(roleOf(rows, 'mirror').map(line => line.text)).toEqual(['镜像止盈']);
    expect(roleOf(rows, 'pending').map(line => line.text)).toEqual(['初始对冲 B']);
    expect(roleOf(rows, 'open').map(line => line.text)).toEqual(['加仓2']);
    expect(roleOf(rows, 'unclassified').map(line => line.text)).toEqual(['—']);
    expect(roleOf(rows, 'unclassified-open').map(line => line.text)).toEqual(['—']);
    const everything = rows.flatMap(row => row.cells.flat().map(line => line.text));
    expect(everything).not.toContain('回填');
    expect(everything).not.toContain('挂单中');
    expect(everything).not.toContain('进行中');
    // 格子数与表头一致：第一列就是角色
    expect(new Set(rows.map(row => row.cells.length))).toEqual(new Set([EXPORT_COLUMN_COUNT]));
    expect(rows.at(-1)!.cells[ROLE_COL][0].text).toBe('合计');
  });

  it('角色标签与页面同色：已平仓实心、挂单中空心虚线、进行中带小圆点；镜像止盈的字压深到 #B98500（与页面浅色主题同色）', () => {
    const rows = rowsOf();
    expect(roleOf(rows, 'main')).toEqual([{ text: '主力开仓', bold: true, size: 12, color: '#0ECB81', chip: { color: '#0ECB81' } }]);
    expect(roleOf(rows, 'mirror')).toEqual([{ text: '镜像止盈', bold: true, size: 12, color: '#B98500', chip: { color: '#F0B90B' } }]);
    expect(roleOf(rows, 'pending')).toEqual([{ text: '初始对冲 B', bold: true, size: 12, color: '#2B80FF', chip: { color: '#2B80FF', hollow: true } }]);
    expect(roleOf(rows, 'open')).toEqual([{ text: '加仓2', bold: true, size: 12, color: '#0ECB81', chip: { color: '#0ECB81', dot: true } }]);
    // 没有角色：中性灰标签；进行中的照样带圆点（页面同样）
    expect(roleOf(rows, 'unclassified')).toEqual([{ text: '—', bold: true, size: 12, color: '#848E9C', chip: { color: '#848E9C' } }]);
    expect(roleOf(rows, 'unclassified-open')).toEqual([{ text: '—', bold: true, size: 12, color: '#848E9C', chip: { color: '#848E9C', dot: true } }]);
    // 标签不折行，行高仍由三行时间决定
    for (const id of ['main', 'mirror', 'pending', 'open', 'unclassified', 'unclassified-open']) {
      const row = rows.find(r => r.legId === id)!;
      expect(row.wrapped[ROLE_COL]).toEqual(row.cells[ROLE_COL]);
      expect(row.height).toBe(12 * 2 + 17 * 3);
    }
    // 挂单中的腿照旧不进合计（与页面同一条状态规则）：它是这场唯一的空单，Σ 格就只列多单那组；空单也没有占比格
    const coinsCol = PRICE_CHANGE_COL + 1;
    expect(rows.find(r => r.legId === 'pending')!.cells[coinsCol + 1]).toEqual([{ text: '' }]);
    expect(rows.at(-1)!.cells[coinsCol].map(line => (line.tag?.hidden ? `(${line.tag.text})` : line.tag?.text))).toEqual(['多', '(多)']);
  });

  it('画出来：实心标签是 10% 的淡底，挂单中用虚线描边、字不淡（白底），进行中在字后面点一个圆点；标签与「开 …」同一条基线', () => {
    const calls: { op: string; args: unknown[]; fill?: unknown; stroke?: unknown; dash?: unknown }[] = [];
    const state: Record<string | symbol, unknown> = { dash: [] };
    const ctx = new Proxy(state, {
      get(target, key) {
        if (key === 'measureText') return (text: string) => ({ width: String(text).length * 8 });
        if (key === 'setLineDash') return (dash: number[]) => { target.dash = dash; };
        if (key === 'save' || key === 'restore') return () => { if (key === 'restore') target.dash = []; };
        if (['fillText', 'roundRect', 'arc', 'fill', 'stroke'].includes(String(key))) {
          return (...args: unknown[]) => { calls.push({ op: String(key), args, fill: target.fillStyle, stroke: target.strokeStyle, dash: target.dash }); };
        }
        if (key in target) return target[key];
        return () => undefined;
      },
      set(target, key, value) { target[key] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);

    buildCampaignLegsListCanvas({ ...input(), legs: shapeLegs() }, { includeHeader: false, scale: 1 });

    const text = (value: string) => calls.find(call => call.op === 'fillText' && call.args[0] === value)!;
    const before = (value: string) => calls.slice(0, calls.indexOf(text(value)));
    // 实心：先铺淡底（主色 + 1A），字用主色、右移 8px 的内边距
    const mainFill = before('主力开仓').filter(call => call.op === 'fill').at(-1)!;
    expect(mainFill.fill).toBe('#0ECB811A');
    expect(text('主力开仓').fill).toBe('#0ECB81');
    expect(text('主力开仓').args[1]).toBe(40 + 10 + 8);
    // 与同一行时间的第一行同一条基线
    const openLines = calls.filter(call => call.op === 'fillText' && String(call.args[0]).startsWith('开 '));
    expect(text('主力开仓').args[2]).toBe(openLines[0].args[2]);
    // 挂单中：虚线描边（主色 75%），不铺底；导出图是白底，字色与实心标签一样不淡（淡了就读不清）
    const pendingStroke = before('初始对冲 B').filter(call => call.op === 'stroke').at(-1)!;
    expect(pendingStroke.stroke).toBe('#2B80FFBF');
    expect(pendingStroke.dash).toEqual([3, 2]);
    expect(text('初始对冲 B').fill).toBe('#2B80FF');
    // 镜像止盈：底色仍是主色的 10%，字压深
    expect(before('镜像止盈').filter(call => call.op === 'fill').at(-1)!.fill).toBe('#F0B90B1A');
    expect(text('镜像止盈').fill).toBe('#B98500');
    // 进行中：字后面一个实心圆点（主色）——加仓2 一个，没有角色的进行中腿一个（中性灰）
    const dots = calls.flatMap((call, index) => (call.op === 'arc' ? [calls[index + 1]] : []));
    expect(dots).toHaveLength(2);
    expect(dots[0]).toEqual(expect.objectContaining({ op: 'fill', fill: '#0ECB81' }));
    expect(dots[1]).toEqual(expect.objectContaining({ op: 'fill', fill: '#848E9C' }));
    // 没有角色的两条腿：中性灰淡底上写「—」
    // （角色列的字右移了标签的内边距，落在 40 + 10 + 8；别的列里的「—」不在这里）
    const dashes = calls.filter(call => call.op === 'fillText' && call.args[0] === '—' && call.args[1] === 40 + 10 + 8);
    expect(dashes).toHaveLength(2);
    for (const dash of dashes) {
      expect(dash.fill).toBe('#848E9C');
      // 底色在字之前画；进行中的那条在底色与字之间还有一个圆点
      const fills = calls.slice(0, calls.indexOf(dash)).filter(call => call.op === 'fill').map(call => call.fill);
      expect(fills.slice(-2)).toContain('#848E9C1A');
    }
    // 画出来的字里没有序号列、「回填」与状态字
    const drawn = calls.filter(call => call.op === 'fillText').map(call => String(call.args[0]));
    expect(drawn).not.toContain('#');
    expect(drawn).not.toContain('回填');
    expect(drawn).not.toContain('挂单中');
    expect(drawn).not.toContain('进行中');
    expect(drawn.slice(0, 2)).toEqual(['角色', '时间']);
  });
});

describe('【用户要求】导出图的盈亏概览与页面同样两栏：递进链排在同一列', () => {
  it('标了 rightColumn 的按栏从上往下排：左栏递进链七项、右栏结果与仓位七项，同一行齐平；战役元数据仍按行排', () => {
    const items = buildCampaignPnlOverviewItems(pnlMetricsForColumns());
    const { cells, rows } = overviewItemCells(items);
    expect(rows).toBe(7);
    const column = (index: number) => cells.filter(cell => cell.column === index).sort((a, b) => a.row - b.row).map(cell => cell.item.label);
    expect(column(0)).toEqual(['预期回撤', '涨跌幅', '涨跌幅倍数', '盈亏比', '加仓效用', '几何期望', '算术期望']);
    expect(column(1)).toEqual(['最大预期亏损', '已实现 P&L', '峰值浮盈', '主力开仓名义仓位', '多方总名义仓位', '杠杆倍数', 'DSI/USI 贡献']);

    const metadata = overviewItemCells([{ label: 'A', value: '1' }, { label: 'B', value: '2' }, { label: 'C', value: '3' }]);
    expect(metadata.cells.map(cell => [cell.item.label, cell.column, cell.row])).toEqual([['A', 0, 0], ['B', 1, 0], ['C', 0, 1]]);
    expect(metadata.rows).toBe(2);
  });
});

function pnlMetricsForColumns(): CampaignPnlOverviewMetrics {
  return {
    realizedPnl: 200,
    settlement: null,
    mainLeverage: 1,
    initialMainExposureNotional: 1000,
    peakUnrealizedPnl: 250.5,
    initialExpectedMaxLoss: 100,
    mainSideNotional: { side: 'long', total: 1500 },
    expectedMaxDrawdownPct: 10,
    payoffRatio: 200,
    mainPriceChangePct: 20,
    hasMainAdd: true,
    asymmetricRiskContribution: null,
    arithmeticExpectancy: 0.5,
    geometricExpectancy: 0.2,
    initialRisk: null,
  };
}
