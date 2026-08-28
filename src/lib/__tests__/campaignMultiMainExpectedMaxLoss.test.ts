import { describe, expect, it } from 'vitest';
import {
  computeInitialExpectedMaxDrawdownPct,
  computeInitialExpectedMaxLoss,
  computeInitialMainExposureNotional,
  computeMirrorTpReductionPct,
  resolveMainRiskAnchors,
} from '@/lib/campaignAnalysis';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

/**
 * 实盘战役 NAORISUSDT 2026-04-29（用户的导出图）。两笔主力，各带一笔镜像止盈。
 *
 * 旧口径的病灶：`findInitialMainLeg` 按名义金额只挑一笔（主力2，89,260 > 40,960），
 * 于是**跌幅取自主力2（6.805%）、敞口却是两笔主力+两笔镜像之和（325,530）**——
 * 主力1 那条 13.384% 宽的止损从头到尾没被计价过。
 */
const opened = '2026-04-29T19:48:00.000Z';
const closed = '2026-04-30T10:16:00.000Z';

const campaign: TradeCampaign = {
  id: 'c-naoris', user_id: 'u', campaign_code: 'C-NAORIS', symbol: 'NAORISUSDT',
  direction: 'main_long', status: 'closed_profit', strategy_template: 'main_dual_hedge_mirror_tp',
  title: 'naoris', opened_at: opened, closed_at: closed,
  initial_main_size_usdt: 40_960, initial_leverage: 5,
  final_realized_pnl: 34_453.64, final_r_multiple: null,
  peak_unrealized_pnl: null, peak_drawdown: null,
  actual_evolution: [{ id: 'e-hist', event_type: 'historical_classification_created', timestamp: opened }],
} as unknown as TradeCampaign;

const leg = (
  id: string, role: TradeJournal['leg_role'], openAt: string, size: number, entry: number, seq: number,
): TradeJournal => ({
  id, leg_role: role, leg_sequence: seq, direction: 'long',
  order_kind: role === 'mirror_tp' ? 'tp' : 'main',
  pre_simulated_time: openAt, pre_entry_price: entry, pre_position_size: size,
  pre_account_equity_usdt: 4_000_000, trade_record_id: `r-${id}`,
} as unknown as TradeJournal);

const M1 = leg('m1', 'main_open', '2026-04-29T19:48:00.000Z', 40_960, 0.102434, 1);
const TP1 = leg('tp1', 'mirror_tp', '2026-04-29T19:48:00.000Z', 61_430, 0.102434, 2);
const ADD2 = leg('add2', 'main_add_2', '2026-04-29T21:54:00.000Z', 98_100, 0.114158, 3);
const M2 = leg('m2', 'main_open', '2026-04-30T04:23:00.000Z', 89_260, 0.111594, 5);
const TP2 = leg('tp2', 'mirror_tp', '2026-04-30T04:23:00.000Z', 133_880, 0.111594, 6);
const LEGS = [M1, TP1, ADD2, M2, TP2];

// quantity 必须让 名义 = 数量 × 开仓价 = 该腿的 USDT 名义，
// 否则 tradeRecordNotionalUsd 会盖过 pre_position_size，敞口退化成价格本身。
const rec = (legId: string, openAt: string, closeAt: string, entry: number, sizeUsdt: number): TradeRecord => ({
  id: `r-${legId}`, symbol: 'NAORISUSDT', side: 'LONG', action: 'CLOSE',
  openTime: Date.parse(openAt), closeTime: Date.parse(closeAt),
  entryPrice: entry, exitPrice: entry, quantity: sizeUsdt / entry, leverage: 5, pnl: 0,
} as unknown as TradeRecord);

const RECORDS: TradeRecord[] = [
  rec('m1', '2026-04-29T19:48:00.000Z', '2026-04-29T23:53:00.000Z', 0.102434, 40_960),
  rec('tp1', '2026-04-29T19:48:00.000Z', '2026-04-29T21:12:00.000Z', 0.102434, 61_430),
  rec('add2', '2026-04-29T21:54:00.000Z', '2026-04-29T23:53:00.000Z', 0.114158, 98_100),
  rec('m2', '2026-04-30T04:23:00.000Z', '2026-04-30T10:16:00.000Z', 0.111594, 89_260),
  rec('tp2', '2026-04-30T04:23:00.000Z', '2026-04-30T08:55:00.000Z', 0.111594, 133_880),
];

const ord = (id: string, price: number, at: string): CampaignReverseHedgeOrder => ({
  id, side: 'SHORT', price, createdAt: Date.parse(at), triggeredAt: null,
  cancelledAt: Date.parse(at) + 60_000, status: 'cancelled',
});

const ORDERS: CampaignReverseHedgeOrder[] = [
  // 主力1 的保护单：开仓后 1 分钟那对是它的 ex-ante 边界
  ord('a1', 0.0887240, '2026-04-29T19:49:00.000Z'),
  ord('a2', 0.0887240, '2026-04-29T19:49:30.000Z'),
  ord('a3', 0.0950520, '2026-04-29T20:19:00.000Z'),
  ord('a4', 0.0950520, '2026-04-29T20:24:00.000Z'),
  ord('a5', 0.104378, '2026-04-29T21:29:00.000Z'),
  ord('a6', 0.104378, '2026-04-29T21:54:00.000Z'),
  // 主力2 的
  ord('b1', 0.104000, '2026-04-30T04:24:00.000Z'),
  ord('b2', 0.104000, '2026-04-30T04:24:30.000Z'),
  ord('b3', 0.117321, '2026-04-30T09:20:00.000Z'),
  ord('b4', 0.120198, '2026-04-30T09:32:00.000Z'),
  ord('b5', 0.125229, '2026-04-30T09:44:00.000Z'),
  ord('b6', 0.128202, '2026-04-30T09:49:00.000Z'),
  ord('b7', 0.130489, '2026-04-30T09:58:00.000Z'),
];

const F1 = Math.abs(0.0887240 - 0.102434) / 0.102434;   // 13.3842%
const F2 = Math.abs(0.104000 - 0.111594) / 0.111594;    // 6.8050%
const N1 = 40_960 + 61_430;    // 102,390
const N2 = 89_260 + 133_880;   // 223,140

describe('多笔主力的预期最大亏损 = 各主力自身之和', () => {
  it('敞口按主力分组，且总额不变（表头那个数不动）', () => {
    const risk = resolveMainRiskAnchors(campaign, LEGS, RECORDS, ORDERS);
    expect(risk.anchors.map(a => a.mainLegId)).toEqual(['m1', 'm2']);
    expect(risk.anchors[0].exposureNotional).toBeCloseTo(N1, 6);
    expect(risk.anchors[1].exposureNotional).toBeCloseTo(N2, 6);
    // 加仓2 不算 ex-ante 敞口
    expect(computeInitialMainExposureNotional(campaign, LEGS, RECORDS)).toBeCloseTo(N1 + N2, 2);
    expect(N1 + N2).toBeCloseTo(325_530, 6);
  });

  it('【回归】每笔主力用**自己**的保护线，不再共用一个跌幅', () => {
    const risk = resolveMainRiskAnchors(campaign, LEGS, RECORDS, ORDERS);
    expect(risk.anchors[0].drawdownFraction).toBeCloseTo(F1, 9);   // 13.38%，旧口径整场丢掉
    expect(risk.anchors[1].drawdownFraction).toBeCloseTo(F2, 9);   // 6.81%，旧口径拿它给两笔计价
  });

  it('【回归】预期最大亏损是两笔之和 28,888.8，不是旧口径的 22,152.4', () => {
    const L = computeInitialExpectedMaxLoss(campaign, LEGS, RECORDS, ORDERS);
    expect(L).toBeCloseTo(F1 * N1 + F2 * N2, 6);
    expect(L).toBeCloseTo(28_888.8, 1);
    const legacy = F2 * (N1 + N2);           // 旧口径：主力2 的跌幅 × 全部敞口
    expect(legacy).toBeCloseTo(22_152.4, 1);
    expect(L).toBeGreaterThan(legacy);
  });

  it('等效回撤率保住恒等式：最大预期亏损 = 名义仓位 × 预期回撤比例', () => {
    const L = computeInitialExpectedMaxLoss(campaign, LEGS, RECORDS, ORDERS);
    const d = computeInitialExpectedMaxDrawdownPct(campaign, LEGS, RECORDS, ORDERS);
    const N = computeInitialMainExposureNotional(campaign, LEGS, RECORDS);
    expect((d / 100) * N).toBeCloseTo(L, 6);
    expect(d).toBeCloseTo(8.8744, 3);
  });

  it('盈亏比随之下移：155.5% → 119.3%', () => {
    // b = 已实现盈亏 / 最大预期亏损（computeProfitCaptureRatio 就是这个式子，
    // 分子走 computeCampaignPnlReconciliation，这里只钉分母的变化）。
    const L = computeInitialExpectedMaxLoss(campaign, LEGS, RECORDS, ORDERS);
    const legacyL = F2 * (N1 + N2);
    expect((34_453.64 / legacyL) * 100).toBeCloseTo(155.5, 1);   // 图上那个数
    expect((34_453.64 / L) * 100).toBeCloseTo(119.3, 1);
  });

  it('【回归】追踪止盈单不得抬高预期最大亏损——那会惩罚正确的移动止盈', () => {
    // 主力2 后面那几张 0.117–0.130 挂在多单开仓价**上方**。
    // 若把「持仓期内所有委托」都算进保护线，|·| 会把它们当成风险，
    // 预期最大亏损随行情走对而变大、盈亏比塌到 0.67。
    const risk = resolveMainRiskAnchors(campaign, LEGS, RECORDS, ORDERS);
    const worst = Math.max(...[0.117321, 0.120198, 0.125229, 0.128202, 0.130489]
      .map(p => Math.abs(p - 0.111594) / 0.111594));
    expect(worst).toBeGreaterThan(F2);                       // 它们确实更"远"
    expect(risk.anchors[1].drawdownFraction).toBeCloseTo(F2, 9);  // 但没被采纳
  });

  it('【回归】镜像减仓% 按各自主力分组，回到策略写死的 60/40', () => {
    expect(computeMirrorTpReductionPct(campaign, TP1, LEGS, RECORDS)).toBeCloseTo(60, 2);
    expect(computeMirrorTpReductionPct(campaign, TP2, LEGS, RECORDS)).toBeCloseTo(60, 2);
    // 旧口径拿全场 325,530 当分母
    expect(61_430 / (N1 + N2) * 100).toBeCloseTo(18.87, 1);
  });

  it('Δb 仍是本场 b 的分解：各腿之和 = 总盈亏 / L', () => {
    // 分母刻意保持**全场 L**：Legs 列表有一行合计，
    // 「Σ Δbᵢ = 本场 b」是那一行成立的前提。
    const L = computeInitialExpectedMaxLoss(campaign, LEGS, RECORDS, ORDERS);
    const legPnls = [3268.41, 8103.41, -3056.00, -5457.27, 1643.58, 10012.75, 19938.76];
    const sum = legPnls.reduce((a, b) => a + b, 0) / L;
    expect(sum).toBeCloseTo(34_453.64 / L, 6);
  });
});

describe('单笔主力必须逐字节不变', () => {
  const soloLegs = [M1, TP1];
  const soloRecords = RECORDS.filter(r => r.id === 'r-m1' || r.id === 'r-tp1');
  const soloOrders = ORDERS.slice(0, 6);

  it('只有一笔主力时走原路径，锚只有一个且等于全场', () => {
    const risk = resolveMainRiskAnchors(campaign, soloLegs, soloRecords, soloOrders);
    expect(risk.anchors).toHaveLength(1);
    expect(risk.expectedMaxLoss).toBeCloseTo(risk.anchors[0].expectedMaxLoss, 9);
    expect(risk.anchoredExposureNotional).toBeCloseTo(risk.anchors[0].exposureNotional, 9);
    expect(risk.unanchoredExposureNotional).toBe(0);
  });

  it('等效回撤率退化成那一笔自己的跌幅', () => {
    const risk = resolveMainRiskAnchors(campaign, soloLegs, soloRecords, soloOrders);
    const d = computeInitialExpectedMaxDrawdownPct(campaign, soloLegs, soloRecords, soloOrders);
    expect(d).toBeCloseTo((risk.anchors[0].drawdownFraction ?? 0) * 100, 9);
  });

  it('单笔主力的镜像减仓% 不走分组路径', () => {
    expect(computeMirrorTpReductionPct(campaign, TP1, soloLegs, soloRecords)).toBeCloseTo(60, 2);
  });
});
