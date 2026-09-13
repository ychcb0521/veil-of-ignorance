import { describe, expect, it } from 'vitest';
import {
  EMOTION_DIARY_COLLAPSED_H,
  buildCampaignBoardOverview,
  campaignEmotionDiaryPanelHeight,
  drawEmotionDiaryPanel,
  buildCampaignLegsExportRows,
  campaignLegsExportCanvasHeight,
  wrapCampaignLegsExportLine,
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
const ORDER_COL = 9;
/** 「手续费」列在 COLUMNS 里的下标。 */
const FEE_COL = 8;

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
    expect(legRows.at(-1)?.cells[7][0].text).toBe('8.96');
    expect(legRows.at(-1)?.cells[7][1].text).toBe('1013.00');
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
});
