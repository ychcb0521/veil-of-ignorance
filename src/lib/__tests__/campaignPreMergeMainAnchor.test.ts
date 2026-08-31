import { describe, expect, it } from 'vitest';
import {
  computeInitialExpectedMaxLoss,
  computeInitialMainExposureNotional,
  resolveMainRiskAnchors,
} from '@/lib/campaignAnalysis';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

/**
 * 【用户要求】预期最大亏损**不能**拿合并后的主力单作参照，要用**合并之前**的主力单。
 *
 * 同向成交在持仓期合并成一个仓位是对的——爆仓必须按整仓算。但战役侧读到的
 * 就成了混合开仓价与合计数量，而 L = 跌幅 × 敞口 的**两个因子都从这条记录取**，
 * 误差是相乘的。
 */
const OPEN = '2026-04-29T19:48:00.000Z';
const CLOSE = '2026-04-29T23:53:00.000Z';
const MAIN_ENTRY = 0.102754;      // 合并前的主力单
const ADD_ENTRY = 0.130000;       // 加仓
const GUARD = 0.0887240;          // 保护线
const N_MAIN = 102_390;
const N_ADD = 98_100;

const campaign: TradeCampaign = {
  id: 'c1', user_id: 'u', campaign_code: 'C1', symbol: 'ENJUSDT',
  direction: 'main_long', status: 'closed_loss', strategy_template: 'main_dual_hedge_mirror_tp',
  title: 't', opened_at: OPEN, closed_at: CLOSE,
  initial_main_size_usdt: N_MAIN, initial_leverage: 5,
  final_realized_pnl: null, final_r_multiple: null,
  peak_unrealized_pnl: null, peak_drawdown: null, actual_evolution: [],
} as unknown as TradeCampaign;

/** 实时「记录决策」腿存的是**仓位 id**，不是某条平仓记录的 id。 */
const mainLeg = {
  id: 'm1', leg_role: 'main_open', leg_sequence: 1, direction: 'long', order_kind: 'main',
  pre_simulated_time: OPEN, pre_entry_price: null, pre_position_size: null,
  trade_record_id: 'pos-1',
} as unknown as TradeJournal;

const slice = (id: string, fillId: string, entry: number, notional: number): TradeRecord => ({
  id, symbol: 'ENJUSDT', side: 'LONG', action: 'CLOSE',
  positionId: 'pos-1', fillId,
  openTime: Date.parse(OPEN), closeTime: Date.parse(CLOSE),   // 同一次平仓 → closeTime 相等
  entryPrice: entry, exitPrice: 0.09, quantity: notional / entry, leverage: 5, pnl: -1,
} as unknown as TradeRecord);

const MAIN_SLICE = slice('r-main', 'pos-1', MAIN_ENTRY, N_MAIN);
const ADD_SLICE = slice('r-add', 'add-1', ADD_ENTRY, N_ADD);

const guard: CampaignReverseHedgeOrder = {
  id: 'g1', side: 'SHORT', price: GUARD, createdAt: Date.parse(OPEN) + 60_000,
  triggeredAt: null, cancelledAt: Date.parse(OPEN) + 120_000, status: 'cancelled',
};

const TRUE_FRACTION = (MAIN_ENTRY - GUARD) / MAIN_ENTRY;      // 13.65%
const WRONG_FRACTION = (ADD_ENTRY - GUARD) / ADD_ENTRY;       // 31.75%

describe('预期最大亏损用合并之前的主力单作参照', () => {
  it('【回归】跌幅按主力自己的开仓价算，不是加仓的', () => {
    const risk = resolveMainRiskAnchors(campaign, [mainLeg], [MAIN_SLICE, ADD_SLICE], [guard]);
    expect(risk.anchors[0].drawdownFraction).toBeCloseTo(TRUE_FRACTION, 9);
    expect(risk.anchors[0].drawdownFraction).not.toBeCloseTo(WRONG_FRACTION, 6);
  });

  it('【回归】敞口只含主力，加仓不计入 ex-ante 风险', () => {
    // 角色表里 INITIAL_MAIN_EXPOSURE_ROLES 只有 main_open + mirror_tp，
    // main_add_* 本来就被刻意排除——合并只是把它从后门放了进来。
    const risk = resolveMainRiskAnchors(campaign, [mainLeg], [MAIN_SLICE, ADD_SLICE], [guard]);
    expect(risk.anchors[0].exposureNotional).toBeCloseTo(N_MAIN, 2);
    expect(risk.anchors[0].exposureNotional).not.toBeCloseTo(N_MAIN + N_ADD, 0);
    expect(computeInitialMainExposureNotional(campaign, [mainLeg], [MAIN_SLICE, ADD_SLICE]))
      .toBeCloseTo(N_MAIN, 2);
  });

  it('【判据】两个因子都对，L 才对', () => {
    const L = computeInitialExpectedMaxLoss(campaign, [mainLeg], [MAIN_SLICE, ADD_SLICE], [guard]);
    expect(L).toBeCloseTo(TRUE_FRACTION * N_MAIN, 2);
    // 两个因子各错一次时误差是相乘的
    expect(L).not.toBeCloseTo(WRONG_FRACTION * (N_MAIN + N_ADD), 0);
  });

  it('【回归】记录的数组顺序不得影响结果', () => {
    // 旧写法对 positionId 取「最近的那一条」，而同一次平仓的各片 closeTime 完全相等，
    // `>` 永不成立 → 保留的是数组里**先出现**的那条。主力读到谁全看顺序。
    const a = resolveMainRiskAnchors(campaign, [mainLeg], [MAIN_SLICE, ADD_SLICE], [guard]);
    const b = resolveMainRiskAnchors(campaign, [mainLeg], [ADD_SLICE, MAIN_SLICE], [guard]);
    expect(a.anchors[0].drawdownFraction).toBeCloseTo(b.anchors[0].drawdownFraction!, 12);
    expect(a.anchors[0].exposureNotional).toBeCloseTo(b.anchors[0].exposureNotional, 6);
    expect(b.anchors[0].drawdownFraction).toBeCloseTo(TRUE_FRACTION, 9);
  });
});

describe('记录查找的三级顺序：id → fillId → positionId', () => {
  it('仓位 id 解析到主力那一片，不是「最近的那一片」', () => {
    for (const order of [[MAIN_SLICE, ADD_SLICE], [ADD_SLICE, MAIN_SLICE]]) {
      expect(buildTradeRecordLookup(order).get('pos-1')?.id).toBe('r-main');
    }
  });

  it('加仓腿按自己的成交 id 找得到自己那一片', () => {
    expect(buildTradeRecordLookup([MAIN_SLICE, ADD_SLICE]).get('add-1')?.id).toBe('r-add');
  });

  it('记录自己的 id 优先级最高', () => {
    const l = buildTradeRecordLookup([MAIN_SLICE, ADD_SLICE]);
    expect(l.get('r-main')?.id).toBe('r-main');
    expect(l.get('r-add')?.id).toBe('r-add');
  });

  it('多次部分平仓时，主力那一格取最晚的那一片', () => {
    const later = { ...MAIN_SLICE, id: 'r-main-2', closeTime: Date.parse(CLOSE) + 60_000 };
    expect(buildTradeRecordLookup([MAIN_SLICE, ADD_SLICE, later]).get('pos-1')?.id).toBe('r-main-2');
  });

  it('【回归】没有 fillId 的旧记录仍按「最近的那一条」解析', () => {
    const old1 = { ...MAIN_SLICE, id: 'o1', fillId: undefined, closeTime: 100 };
    const old2 = { ...MAIN_SLICE, id: 'o2', fillId: undefined, closeTime: 200 };
    expect(buildTradeRecordLookup([old1, old2]).get('pos-1')?.id).toBe('o2');
    expect(buildTradeRecordLookup([old2, old1]).get('pos-1')?.id).toBe('o2');
  });
});
