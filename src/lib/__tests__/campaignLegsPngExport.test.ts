import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMOTION_DIARY_COLLAPSED_H,
  buildCampaignLegsListCanvas,
  buildCampaignBoardOverview,
  campaignEmotionDiaryPanelHeight,
  drawEmotionDiaryPanel,
  buildCampaignLegsExportRows,
  campaignLegsExportCanvasHeight,
  wrapCampaignLegsExportLine,
  formatCampaignChartInterval,
  campaignKlineTitleName,
  campaignStatusLabel,
  type CampaignBoardExportInput,
} from '@/lib/campaignLegsPngExport';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

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

/** 「委托」列在 COLUMNS 里的下标。插新列时只需改这里，不必逐处改数字。 */
const ORDER_COL = 12;
/** 「手续费」列在 COLUMNS 里的下标。 */
const FEE_COL = 11;
/** 「加仓校验」列在 COLUMNS 里的下标（紧跟「币量 / 仓位」与「占比」）。 */
const ADD_SIZING_COL = 10;
/** 「涨跌幅」列在 COLUMNS 里的下标（紧跟「平仓价」）。 */
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
    expect(legRows.at(-1)?.cells[0][0].text).toBe('14');
    expect(legRows.at(-1)?.cells[5][0].text).toBe('113.0000');
    // 币量在上、名义在下：1013 ÷ 113 = 8.96
    expect(legRows.at(-1)?.cells[8][0].text).toBe('8.96');
    expect(legRows.at(-1)?.cells[8][1].text).toBe('1013.00');
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

    expect(rows[0].cells[6].map(line => line.text)).toEqual([
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
    expect(total.cells[1][0].text).toBe('合计');
    expect(total.cells[2][0].text).toMatch(/^(取自成交记录|成交记录 \+ 复盘快照|取自复盘快照|取自战役事件|取自落库缓存|未结算)$/);
    expect(total.cells[3][0].text).toMatch(/^([+-]?\d+\.\d{2}|—)$/);
    expect(total.cells[4][0].text).toMatch(/^([+-]?\d+\.\d{2}|—)$/);
    expect(total.cells[FEE_COL][0].text).toMatch(/^(\d+\.\d{2}( 估)?|—)$/);
    // 合计行只有一行，不会混进腿的计数
    expect(rows.filter(row => row.kind === 'total')).toHaveLength(1);
    // 【用户要求】「合计」必须一眼看得见：加粗、深色、比腿的角色名大——导出图常被缩小看
    const label = total.cells[1][0];
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
    expect(widths).toEqual(new Set([13]));
    // 列序：币量（及其占比）之后、手续费之前
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
});

describe('【用户要求】主力阶段子行在导出图里也标明「对冲结束切段」', () => {
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

  it('由对冲切出来的阶段带标签，收尾阶段不带；合计行照常在最后', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), legs: phaseLegs, initialExpectedMaxLoss: 20000 });
    const phases = rows.filter(row => row.kind === 'phase');
    expect(phases.length).toBeGreaterThanOrEqual(2);
    const cut = phases.find(row => row.cells[1][0].text === '阶段 1')!;
    const tail = phases.find(row => row.cells[1][0].text.includes('收尾'))!;
    expect(cut.cells[2].map(line => line.text)).toContain('对冲结束切段');
    expect(tail.cells[2].map(line => line.text)).not.toContain('对冲结束切段');
    // 阶段子行的行高跟着多出来的这一行撑开
    expect(cut.height).toBeGreaterThanOrEqual(cut.wrapped[2].length * 17);
    const total = rows.at(-1)!;
    expect(total.kind).toBe('total');
    expect(total.cells[2][0].text).toBe('取自复盘快照');
    expect(total.cells[3][0].text).toBe('+93439.77');
  });

  it('阶段子行与表头同列数，「加仓校验」那一格留空——少一格就会让手续费 / 委托整体左移', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), legs: phaseLegs, initialExpectedMaxLoss: 20000 });
    const phases = rows.filter(row => row.kind === 'phase');
    expect(phases.length).toBeGreaterThanOrEqual(2);
    for (const row of phases) {
      expect(row.cells).toHaveLength(13);
      expect(row.cells[ADD_SIZING_COL].map(line => line.text)).toEqual(['']);
    }
    expect(new Set(rows.map(row => row.cells.length))).toEqual(new Set([13]));
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

describe('【用户要求】导出图也带「涨跌幅」列（平仓价右侧）', () => {
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
    expect(texts.slice(at - 2, at + 2)).toEqual(['开仓价', '平仓价', '涨跌幅', '币量 / 仓位']);
    expect(texts.slice(0, 13)).toEqual(['#', '角色', '时间', '贡献 / 盈亏', 'Δb', '开仓价', '平仓价', '涨跌幅', '币量 / 仓位', '占比', '加仓校验', '手续费', '委托']);
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
    // 左边一格就是平仓价：同一对价
    expect(rows.find(row => row.legId === 'corrected')!.cells[PRICE_CHANGE_COL - 1][0].text).toBe('0.200000');
    expect(rows.find(row => row.legId === 'long')!.cells[PRICE_CHANGE_COL - 1][0].text).toBe('6.5194');
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
    expect(row.cells[PRICE_CHANGE_COL - 1][0].text).toBe('98.0000');
    expect(row.cells[PRICE_CHANGE_COL]).toEqual([{ text: '-2.00%', color: '#F6465D' }]);
    // 「贡献 / 盈亏」：三刀合计 +160，绿
    expect(row.cells[3][0].color).toBe('#0ECB81');
    expect(row.cells[3][1].text).toBe('+160.00');
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
    const phases = rows.filter(row => row.kind === 'phase');
    expect(phases.map(row => row.cells[PRICE_CHANGE_COL])).toEqual([
      [{ text: '+54.40%', color: '#0ECB81' }],
      [{ text: '+30.35%', color: '#0ECB81' }],
    ]);
    expect(rows.find(row => row.legId === 'main')!.cells[PRICE_CHANGE_COL][0].text).toBe('+101.26%');
    // 对冲腿是空单：0.05 → 0.052 按方向计是 -4.00%
    expect(rows.find(row => row.legId === 'hedge-roll')!.cells[PRICE_CHANGE_COL]).toEqual([{ text: '-4.00%', color: '#F6465D' }]);
    const total = rows.at(-1)!;
    expect(total.kind).toBe('total');
    expect(total.cells[PRICE_CHANGE_COL]).toEqual([{ text: '' }]);
    expect(new Set(rows.map(row => row.cells.length))).toEqual(new Set([13]));
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
    const phases = rows.filter(row => row.kind === 'phase');
    expect(phases.map(row => row.cells[PRICE_CHANGE_COL])).toEqual([
      [{ text: '-54.40%', color: '#F6465D' }],
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

describe('【用户要求】导出图也带「占比」列（币量 / 仓位右侧）', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  /** 「币量 / 仓位」与「占比」在 COLUMNS 里的下标。 */
  const COINS_COL = 8;
  const SHARE_COL = 9;

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

  it('表头真的把「占比」画在币量 / 仓位之后、加仓校验之前；腿行与合计行画出格式化后的值', () => {
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

    const at = drawn.indexOf('占比');
    expect(at).toBeGreaterThan(0);
    expect(drawn.slice(at - 1, at + 2)).toEqual(['币量 / 仓位', '占比', '加仓校验']);
    expect(drawn).toEqual(expect.arrayContaining(['34.9%', '33.6%', '44.2%', '45.1%', '79,042,835.4', '8981040.00', '100.0%']));
  });

  it('与页面同一个 helper：截图里的四条腿印出同样的占比，合计行写两个分母与 100.0%', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), legs: screenshotLegs(), reverseHedgeOrders: [] });
    const cell = (id: string) => rows.find(row => row.legId === id)!.cells[SHARE_COL];

    // 左边一格就是截图上的数
    expect(texts(rows.find(row => row.legId === 'main')!.cells[COINS_COL])).toEqual(['27,603,119.02', '3015630.00']);
    expect(texts(cell('main'))).toEqual(['34.9%', '33.6%']);
    expect(texts(cell('add1'))).toEqual(['12.8%', '13.0%']);
    expect(texts(cell('add2'))).toEqual(['8.1%', '8.4%']);
    expect(texts(cell('add3'))).toEqual(['44.2%', '45.1%']);
    // 中性色：上行与币量同色（缺省前景），下行与名义仓位同样淡
    expect(cell('main')).toEqual([{ text: '34.9%' }, { text: '33.6%', color: '#848E9C' }]);
    expect(cell('main')[1].color).toBe(rows.find(row => row.legId === 'main')!.cells[COINS_COL][1].color);

    const total = rows.at(-1)!;
    expect(total.kind).toBe('total');
    expect(texts(total.cells[COINS_COL])).toEqual(['79,042,835.4', '8981040.00']);
    expect(texts(total.cells[SHARE_COL])).toEqual(['100.0%', '100.0%']);
    for (const line of [...total.cells[COINS_COL], ...total.cells[SHARE_COL]]) {
      expect(['#5F6B7A', '#848E9C']).toContain(line.color);
    }
    // 「100.0%」与各腿的占比都一行放下，不折行
    expect(total.wrapped[SHARE_COL]).toHaveLength(2);
    expect(total.wrapped[COINS_COL]).toHaveLength(2);
    for (const row of rows.filter(r => r.kind === 'leg')) expect(row.wrapped[SHARE_COL]).toHaveLength(2);
  });

  it('状态为「挂单中」的腿两行都是「—」、不进分母；缺开仓价的腿上行「—」、名义仍进下行分母', () => {
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
    const cell = (id: string) => texts(rows.find(row => row.legId === id)!.cells[SHARE_COL]);
    expect(texts(rows.find(row => row.legId === 'pending-hedge')!.cells[COINS_COL])).toEqual(['50,000,000', '5000000.00']);
    expect(cell('pending-hedge')).toEqual(['—', '—']);
    expect(texts(rows.find(row => row.legId === 'no-price')!.cells[COINS_COL])).toEqual(['—', '1018960.00']);
    // 名义分母变成 8,981,040 + 1,018,960 = 10,000,000；币量分母不变
    expect(cell('no-price')).toEqual(['—', '10.2%']);
    expect(cell('main')).toEqual(['34.9%', '30.2%']);
    expect(cell('add3')).toEqual(['44.2%', '40.5%']);
    const total = rows.at(-1)!;
    expect(texts(total.cells[COINS_COL])).toEqual(['79,042,835.4', '10000000.00']);
    expect(texts(total.cells[SHARE_COL])).toEqual(['100.0%', '100.0%']);
  });

  it('一条都不计入：合计行两格都是「—」', () => {
    const rows = buildCampaignLegsExportRows({ ...input(), legs: [pendingHedge], reverseHedgeOrders: [] });
    expect(texts(rows.at(-1)!.cells[COINS_COL])).toEqual(['—', '—']);
    expect(texts(rows.at(-1)!.cells[SHARE_COL])).toEqual(['—', '—']);
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
    for (const row of rows.filter(r => r.kind === 'leg')) expect(row.wrapped[COINS_COL]).toHaveLength(2);
    // 合计行不因此被撑高：仍是上下各 12 的留白夹两行 17 高的字（被拆开时会多出一行，变成 75）
    expect(total.height).toBe(12 * 2 + 17 * 2);
  };

  it('百亿级 Σ币量（两位小数，17 个字符）在合计行一行放下：按无画布时的 0.62em 估算', () => {
    expectBillionTotalOnOneLine(buildCampaignLegsExportRows({ ...input(), legs: billionLegs(), reverseHedgeOrders: [] }));
  });

  it('百亿级 Σ币量在合计行一行放下：按真实等宽字体（SF Mono / Menlo 约 0.6em）量宽', async () => {
    const measure = {
      font: '',
      measureText(text: string) {
        const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 13);
        let width = 0;
        for (const character of text) width += /[　-鿿＀-￯]/.test(character) ? size : size * 0.6;
        return { width };
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(measure as never);
    // 量宽画布在模块里只取一次：换一份新模块，让它拿到这支 mock
    vi.resetModules();
    const fresh = await import('@/lib/campaignLegsPngExport');
    expectBillionTotalOnOneLine(fresh.buildCampaignLegsExportRows({ ...input(), legs: billionLegs(), reverseHedgeOrders: [] }));
  });

  it('阶段子行这一格留空；每一行格子数都与表头列数一致，列宽约 96', () => {
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
    const phases = rows.filter(row => row.kind === 'phase');
    expect(phases.length).toBeGreaterThanOrEqual(2);
    for (const row of phases) {
      expect(row.cells[SHARE_COL]).toEqual([{ text: '' }]);
      expect(row.cells[COINS_COL]).toEqual([{ text: '' }]);
    }
    expect(texts(rows.find(row => row.legId === 'main')!.cells[SHARE_COL])).toEqual(['73.7%', '65.3%']);
    expect(texts(rows.find(row => row.legId === 'hedge-roll')!.cells[SHARE_COL])).toEqual(['26.3%', '34.7%']);
    expect(texts(rows.at(-1)!.cells[COINS_COL])).toEqual(['3,799,947.74', '144300.00']);
    expect(texts(rows.at(-1)!.cells[SHARE_COL])).toEqual(['100.0%', '100.0%']);
    expect(new Set(rows.map(row => row.cells.length))).toEqual(new Set([13]));

    // 画布宽度 = 各列宽之和 + 左右边距：加了「占比」96，「币量 / 仓位」由 150 放宽到 160（放得下 17 位的合计币量），合计多 106
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({}, {
      get: (_target, key) => (key === 'measureText' ? () => ({ width: 0 }) : () => undefined),
    }) as never);
    const canvas = buildCampaignLegsListCanvas({ ...input(), legs: [] }, { includeHeader: false, scale: 1 });
    expect(canvas.width).toBe(52 + 152 + 300 + 150 + 104 + 118 + 118 + 120 + 160 + 96 + 170 + 132 + 444 + 40 * 2);
  });
});
