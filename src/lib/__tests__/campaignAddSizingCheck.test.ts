import { describe, expect, it } from 'vitest';
import { computeCushionAdd } from '@/lib/addSizing';
import { evaluateCampaignAddSizing, formatAddSizingShortfall } from '@/lib/campaignAddSizingCheck';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { buildCloseRecords } from '@/lib/tradingSettlement';
import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, Position, TradeRecord } from '@/types/trading';

const T = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

let seq = 0;
function leg(over: Partial<TradeJournal> & { id: string }): TradeJournal {
  seq += 1;
  return {
    user_id: 'u', trade_record_id: null, campaign_id: 'c', leg_role: 'main_open', leg_sequence: seq,
    source: 'retroactive_from_record', symbol: 'TUTUSDT', direction: 'long', leverage: 10,
    position_mode: 'isolated', order_kind: 'main',
    pre_simulated_time: '2026-08-07T19:41:00+08:00',
    created_at: '2026-08-07T00:00:00.000Z', updated_at: '2026-08-07T00:00:00.000Z',
    ...over,
  } as TradeJournal;
}

function short(price: number, createdAt: number, cancelledAt: number | null, over: Partial<CampaignReverseHedgeOrder> = {}): CampaignReverseHedgeOrder {
  return {
    id: `order-${price}-${createdAt}`, side: 'SHORT', price, createdAt, triggeredAt: null, cancelledAt,
    status: cancelledAt == null ? 'pending' : 'cancelled',
    ...over,
  };
}

/**
 * 实盘 TUTUSDT 2026-08-08：加仓 1 的名义 2,205 万，是主力 9.43 万的 234 倍。
 *   主力     94,300 USD @0.0336792  08-07 19:41 → 08-09 01:46
 *   镜像止盈 141,460 USD @0.0336792  08-08 00:36 落袋 +15,117.55
 *   加仓1    22,057,330 USD @0.0419705  08-08 12:02
 *   反向空单 0.0347260  12:01 挂 → 15:18 撤   ← 加仓那一刻的 S₁
 * 退回 S₁ 新腿要亏 380 万，浮盈垫 + 落袋一共不到 2 万。
 */
function tutusdt() {
  const legs = [
    leg({
      id: 'main', leg_role: 'main_open',
      pre_simulated_time: '2026-08-07T19:41:00+08:00', pre_entry_price: 0.0336792, pre_position_size: 94_300,
      post_simulated_close_time: '2026-08-09T01:46:00+08:00', post_exit_price_snapshot: 0.0677819,
    }),
    leg({
      id: 'mirror', leg_role: 'mirror_tp',
      pre_simulated_time: '2026-08-07T19:41:00+08:00', pre_entry_price: 0.0336792, pre_position_size: 141_460,
      post_simulated_close_time: '2026-08-08T00:36:00+08:00', post_realized_pnl: 15_117.55,
    }),
    leg({
      id: 'add1', leg_role: 'main_add_1',
      pre_simulated_time: '2026-08-08T12:02:00+08:00', pre_entry_price: 0.0419705, pre_position_size: 22_057_330,
      post_simulated_close_time: '2026-08-09T01:46:00+08:00',
    }),
  ];
  const orders = [short(0.034726, T('2026-08-08T12:01:00+08:00'), T('2026-08-08T15:18:00+08:00'))];
  return { legs, orders };
}

/** 主多：主力 10,000 USD @1.0（10,000 币），加仓时刻 t。 */
const T0 = T('2026-09-01T10:00:00+08:00');
const mainLeg = (over: Partial<TradeJournal> = {}) => leg({
  id: 'main', leg_role: 'main_open', pre_simulated_time: iso(T0), pre_entry_price: 1, pre_position_size: 10_000, ...over,
});

describe('加仓校验：浮盈垫 + 落袋 ≥ 新腿退回 S₁ 的亏损', () => {
  it('【回归】TUTUSDT 加仓1 仓位远超两本账——判 fail，缺口三百多万', () => {
    const { legs, orders } = tutusdt();
    const verdicts = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: orders });
    expect([...verdicts.keys()]).toEqual(['add1']);
    const v = verdicts.get('add1')!;
    expect(v.status).toBe('fail');
    expect(v.s1).toBe(0.034726);
    expect(v.s2).toBe(0.0419705);
    const x1 = 94_300 / 0.0336792;
    const x2 = 22_057_330 / 0.0419705;
    expect(v.x1Coins).toBeCloseTo(x1, 4);
    expect(v.x1Coins!).toBeGreaterThan(2_799_900);
    expect(v.x1Coins!).toBeLessThan(2_800_000);
    expect(v.x2Coins).toBeCloseTo(x2, 4);
    expect(v.x2Coins!).toBeGreaterThan(525_540_000);
    expect(v.x2Coins!).toBeLessThan(525_550_000);
    expect(v.cushion).toBeCloseTo(x1 * (0.034726 - 0.0336792), 4);
    // 镜像止盈 00:36 已平，是 G 不是浮盈垫
    expect(v.banked).toBeCloseTo(15_117.55, 2);
    expect(v.maxLoss).toBeCloseTo(x2 * (0.0419705 - 0.034726), 2);
    expect(v.shortfall).toBeCloseTo(v.maxLoss! - v.cushion! - v.banked!, 2);
    expect(v.shortfall!).toBeGreaterThan(3_700_000);
  });

  it('取满计算器 x2Max 的加仓判 ok（浮点误差不许把它判成 fail）', () => {
    const sBar = 0.0336792;
    const s1 = 0.034726;
    const s2 = 0.0419705;
    const x1 = 94_300 / sBar;
    const { x2Max } = computeCushionAdd({ side: 'LONG', sBar, s1, s2, x1 });
    const t = T('2026-08-08T12:02:00+08:00');
    const legs = [
      mainLeg({ pre_simulated_time: '2026-08-07T19:41:00+08:00', pre_entry_price: sBar, pre_position_size: 94_300 }),
      leg({ id: 'add', leg_role: 'main_add_1', pre_simulated_time: iso(t), pre_entry_price: s2, pre_position_size: x2Max * s2 }),
    ];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: [short(s1, t - MIN, null)] }).get('add')!;
    expect(v.status).toBe('ok');
    expect(v.shortfall).toBe(0);
    expect(v.maxLoss).toBeCloseTo(v.cushion!, 6);
  });

  describe('落袋 G 能补上浮盈垫不够的部分', () => {
    // 浮盈垫 = 10,000 × (1.1 − 1.0) = 1,000；新腿每币退回 S₁ 亏 0.2；已落袋 G = 500
    const t = T0 + 120 * MIN;
    const legsWith = (addCoins: number) => [
      mainLeg(),
      leg({
        id: 'mirror', leg_role: 'mirror_tp', pre_simulated_time: iso(T0), pre_entry_price: 1,
        pre_position_size: 5_000, post_simulated_close_time: iso(T0 + 60 * MIN), post_realized_pnl: 500,
      }),
      leg({ id: 'add', leg_role: 'main_add_1', pre_simulated_time: iso(t), pre_entry_price: 1.3, pre_position_size: addCoins * 1.3 }),
    ];
    const orders = [short(1.1, t - MIN, null)];

    it('比浮盈垫大、但 G 兜得住 → ok', () => {
      const v = evaluateCampaignAddSizing({ legs: legsWith(7_000), tradeRecords: [], reverseHedgeOrders: orders }).get('add')!;
      expect(v.cushion).toBeCloseTo(1_000, 6);
      expect(v.banked).toBeCloseTo(500, 6);
      expect(v.maxLoss).toBeCloseTo(1_400, 6);
      expect(v.status).toBe('ok');
    });

    it('比浮盈垫 + G 还大 → fail，缺口正好是超出的部分', () => {
      const v = evaluateCampaignAddSizing({ legs: legsWith(8_000), tradeRecords: [], reverseHedgeOrders: orders }).get('add')!;
      expect(v.maxLoss).toBeCloseTo(1_600, 6);
      expect(v.status).toBe('fail');
      expect(v.shortfall).toBeCloseTo(100, 6);
    });
  });

  it('第二次加仓：先前那笔加仓在新 S₁ 上是亏的，从浮盈垫里扣掉', () => {
    const t1 = T0 + 60 * MIN;
    const t2 = T0 + 180 * MIN;
    const legs = [
      mainLeg(),
      // 加仓1：2,000 币 @1.2，退回 S₁=1.1 亏 200 ≤ 1,000 → ok
      leg({ id: 'add1', leg_role: 'main_add_1', pre_simulated_time: iso(t1), pre_entry_price: 1.2, pre_position_size: 2_400 }),
      // 加仓2 @1.3，新 S₁=1.15：主力垫 1,500，加仓1 在 1.15 上亏 100 → 垫子 1,400；新腿亏 1,450
      leg({ id: 'add2', leg_role: 'main_add_2', pre_simulated_time: iso(t2), pre_entry_price: 1.3, pre_position_size: (1_450 / 0.15) * 1.3 }),
    ];
    const orders = [
      short(1.1, t1 - MIN, t2 - 10 * MIN),
      short(1.15, t2 - 5 * MIN, null),
    ];
    const verdicts = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: orders });
    const first = verdicts.get('add1')!;
    expect(first.s1).toBe(1.1);
    expect(first.status).toBe('ok');

    const second = verdicts.get('add2')!;
    expect(second.s1).toBe(1.15);
    expect(second.x1Coins).toBeCloseTo(12_000, 6);
    expect(second.cushion).toBeCloseTo(1_500 - 100, 6);
    // 只看主力 1,500 会误判 ok；扣掉加仓1 的 −100 才是 fail
    expect(second.status).toBe('fail');
    expect(second.shortfall).toBeCloseTo(50, 6);
  });

  describe('S₁ 的来源', () => {
    const t = T0 + 60 * MIN;
    const legs = [
      mainLeg(),
      leg({ id: 'add', leg_role: 'main_add_1', pre_simulated_time: iso(t), pre_entry_price: 1.3, pre_position_size: 1_300 }),
    ];

    it('加仓后 2 分钟才补挂的对冲算 S₁；加仓前已经撤掉的委托不算', () => {
      const orders = [
        short(1.05, t - 120 * MIN, t - 60 * MIN),     // 早撤了
        short(1.1, t + 2 * MIN, null),                // 加仓后补挂
      ];
      const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: orders }).get('add')!;
      expect(v.s1).toBe(1.1);
      expect(v.status).toBe('ok');
    });

    it('同时挂着多张：离加仓价最近的那张先被打到，取它；盈利侧的不算止损', () => {
      const orders = [
        short(1.05, t - 10 * MIN, null),
        short(1.2, t - 10 * MIN, null),
        short(1.4, t - 10 * MIN, null),               // 在加仓价上方，不是止损
      ];
      const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: orders }).get('add')!;
      expect(v.s1).toBe(1.2);
    });

    it('已触发的委托以触发时刻失效', () => {
      const orders = [short(1.1, t - 10 * MIN, t + 60 * MIN, { status: 'triggered', triggeredAt: t - MIN })];
      const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: orders }).get('add')!;
      expect(v.status).toBe('unknown');
      expect(v.reason).toBe('no_stop_line');
    });

    it('没有任何止损委托 → unknown（no_stop_line），不猜', () => {
      const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: [] }).get('add')!;
      expect(v.status).toBe('unknown');
      expect(v.reason).toBe('no_stop_line');
      expect(v.shortfall).toBeNull();
    });

    it('主空战役：反向委托列表只收空单，读不到 S₁ → unknown', () => {
      const shortLegs = [
        mainLeg({ direction: 'short' }),
        leg({ id: 'add', leg_role: 'main_add_1', direction: 'short', pre_simulated_time: iso(t), pre_entry_price: 0.7, pre_position_size: 700 }),
      ];
      const v = evaluateCampaignAddSizing({ legs: shortLegs, tradeRecords: [], reverseHedgeOrders: [short(1.1, t - MIN, null)] }).get('add')!;
      expect(v.status).toBe('unknown');
      expect(v.reason).toBe('no_stop_line');
    });
  });

  it('币本位：落袋 G 按 pnlCoin × S₁ 估值', () => {
    const t = T0 + 120 * MIN;
    const record = {
      id: 'mirror-rec', symbol: 'TUTUSD_PERP', side: 'LONG', type: 'MARKET', action: 'CLOSE',
      settlementMode: 'coin', entryPrice: 1, exitPrice: 1.2, quantity: 500, leverage: 10,
      pnl: 500, pnlCoin: 450, fee: 0, slippage: 0,
      openTime: T0, closeTime: T0 + 60 * MIN,
    } as TradeRecord;
    const legs = [
      mainLeg({ pre_settlement_mode: 'coin' }),
      leg({
        id: 'mirror', leg_role: 'mirror_tp', trade_record_id: 'mirror-rec', pre_settlement_mode: 'coin',
        pre_simulated_time: iso(T0), pre_entry_price: 1, pre_position_size: 5_000,
      }),
      leg({ id: 'add', leg_role: 'main_add_1', pre_settlement_mode: 'coin', pre_simulated_time: iso(t), pre_entry_price: 1.3, pre_position_size: 1_300 }),
    ];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [record], reverseHedgeOrders: [short(1.1, t - MIN, null)] }).get('add')!;
    expect(v.banked).toBeCloseTo(450 * 1.1, 6);
    expect(v.cushion).toBeCloseTo(1_000, 6);
  });

  it('加仓时镜像止盈还没触发：它是浮盈垫的一部分，不是 G', () => {
    const t = T0 + 60 * MIN;
    const legs = [
      mainLeg(),
      leg({
        id: 'mirror', leg_role: 'mirror_tp', pre_simulated_time: iso(T0), pre_entry_price: 1,
        pre_position_size: 5_000, post_simulated_close_time: iso(t + 60 * MIN), post_realized_pnl: 500,
      }),
      leg({ id: 'add', leg_role: 'main_add_1', pre_simulated_time: iso(t), pre_entry_price: 1.3, pre_position_size: 1_300 }),
    ];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: [short(1.1, t - MIN, null)] }).get('add')!;
    expect(v.x1Coins).toBeCloseTo(15_000, 6);
    expect(v.cushion).toBeCloseTo(1_500, 6);
    expect(v.banked).toBe(0);
  });

  it('缺口金额：千位以上取整带千分位，以下保留两位', () => {
    expect(formatAddSizingShortfall(3_789_250.4)).toBe('3,789,250');
    expect(formatAddSizingShortfall(50.126)).toBe('50.13');
  });
});

describe('【复核】旧仓与落袋按成交记录逐刀读，不看腿的「最后一刀」', () => {
  const t = T0 + 120 * MIN;
  const record = (over: Partial<TradeRecord> & { id: string }): TradeRecord => ({
    symbol: 'TUTUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', settlementMode: 'usdt',
    entryPrice: 1, exitPrice: 1, quantity: 0, leverage: 10, pnl: 0, fee: 0, slippage: 0,
    openTime: T0, closeTime: T0,
    ...over,
  } as TradeRecord);
  const addLeg = (coins: number, over: Partial<TradeJournal> = {}) => leg({
    id: 'add', leg_role: 'main_add_1', pre_simulated_time: iso(t), pre_entry_price: 1.3, pre_position_size: coins * 1.3, ...over,
  });
  const stopAt = (price: number) => [short(price, t - MIN, null)];

  it('【回归】模拟时间撞车时，以正在持有旧仓的操作时间为下界，别次回放的利润不进 G', () => {
    const holdingRealStart = T('2026-09-10T08:00:00Z');
    const currentTpReal = holdingRealStart + 10 * MIN;
    const addReal = holdingRealStart + 20 * MIN;
    const closeLater = T0 + 600 * MIN;
    const tradeRecords = [
      record({
        id: 'main-rec', positionId: 'main-rec', fillId: 'main-rec', quantity: 10_000,
        openTime: T0, closeTime: closeLater, openedRealAt: holdingRealStart,
        closedRealAt: addReal + 60 * MIN,
      }),
      // 模拟开平时刻与本轮完全重合，但真实操作发生在本轮持仓之前：必须排除。
      record({
        id: 'old-mirror-rec', positionId: 'old-mirror-rec', fillId: 'old-mirror-rec', quantity: 5_000,
        openTime: T0, closeTime: T0 + 60 * MIN, pnl: 900,
        openedRealAt: holdingRealStart - 24 * 60 * MIN,
        closedRealAt: holdingRealStart - 23 * 60 * MIN,
      }),
      record({
        id: 'current-mirror-rec', positionId: 'current-mirror-rec', fillId: 'current-mirror-rec', quantity: 5_000,
        openTime: T0, closeTime: T0 + 60 * MIN, pnl: 500,
        openedRealAt: holdingRealStart, closedRealAt: currentTpReal,
      }),
      // 模拟时刻同样落在加仓之前，但真实操作发生在加仓之后：历史校验不能倒灌未来利润。
      record({
        id: 'future-mirror-rec', positionId: 'future-mirror-rec', fillId: 'future-mirror-rec', quantity: 5_000,
        openTime: T0, closeTime: T0 + 60 * MIN, pnl: 700,
        openedRealAt: holdingRealStart, closedRealAt: addReal + 10 * MIN,
      }),
      record({
        id: 'add-rec', positionId: 'add-rec', fillId: 'add-rec', quantity: 7_000,
        entryPrice: 1.3, openTime: t, closeTime: closeLater,
        openedRealAt: addReal, closedRealAt: addReal + 60 * MIN,
      }),
    ];
    const legs = [
      mainLeg({ trade_record_id: 'main-rec' }),
      leg({
        id: 'old-mirror', leg_role: 'mirror_tp', trade_record_id: 'old-mirror-rec',
        pre_simulated_time: iso(T0), pre_entry_price: 1, pre_position_size: 5_000,
      }),
      leg({
        id: 'current-mirror', leg_role: 'mirror_tp', trade_record_id: 'current-mirror-rec',
        pre_simulated_time: iso(T0), pre_entry_price: 1, pre_position_size: 5_000,
      }),
      leg({
        id: 'future-mirror', leg_role: 'mirror_tp', trade_record_id: 'future-mirror-rec',
        pre_simulated_time: iso(T0), pre_entry_price: 1, pre_position_size: 5_000,
      }),
      addLeg(7_000, { trade_record_id: 'add-rec' }),
    ];
    const verdict = evaluateCampaignAddSizing({ legs, tradeRecords, reverseHedgeOrders: stopAt(1.1) }).get('add')!;
    expect(verdict.cushion).toBeCloseTo(1_000, 6);
    expect(verdict.banked).toBeCloseTo(500, 6);
    expect(verdict.maxLoss).toBeCloseTo(1_400, 6);
    expect(verdict.status).toBe('ok');
  });

  it('【回归】合并仓位：止盈那一刀拆到主力、镜像两条记录——已平掉的币不进浮盈垫，两条的利润都进 G', () => {
    // 主力 10,000 币 @1.0 与镜像 15,000 币 @1.02 在引擎里是同一个仓位 P 的两笔成交
    const position = (mainUnits: number, mirrorUnits: number): Position => ({
      id: 'P', side: 'LONG', quantity: mainUnits + mirrorUnits,
      entryPrice: (mainUnits + mirrorUnits * 1.02) / (mainUnits + mirrorUnits),
      leverage: 10, marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT',
      margin: 100, isolatedMargin: 100, openTime: T0,
      fills: [
        { id: 'P', openTime: T0, entryPrice: 1, units: mainUnits },
        { id: 'M', openTime: T0, entryPrice: 1.02, units: mirrorUnits },
      ],
    } as Position);
    // T0+1h 镜像止盈在 1.2 平掉 15,000 币——按成交占比拆成主力 6,000、镜像 9,000
    const tp = buildCloseRecords({
      symbol: 'TUTUSDT', pos: position(10_000, 15_000), closeQty: 15_000, fillPrice: 1.2, closeTime: T0 + 60 * MIN,
      exitMethod: 'tp1', totals: { netPnl: 2_820, feeUsd: 0, slippageUsd: 0, notionalUsd: 18_000 },
    });
    // 剩下的 10,000 币 T0+10h 在 1.5 平完：两条腿「最后一刀」都在加仓之后
    const last = buildCloseRecords({
      symbol: 'TUTUSDT', pos: position(4_000, 6_000), closeQty: 10_000, fillPrice: 1.5, closeTime: T0 + 600 * MIN,
      totals: { netPnl: 4_880, feeUsd: 0, slippageUsd: 0, notionalUsd: 15_000 },
    });
    expect(tp.map(r => r.fillId)).toEqual(['P', 'M']);
    expect(tp.map(r => r.quantity)).toEqual([6_000, 9_000]);

    const legs = [
      mainLeg({ trade_record_id: 'P' }),
      leg({ id: 'mirror', leg_role: 'mirror_tp', trade_record_id: 'M', pre_simulated_time: iso(T0), pre_entry_price: 1.02, pre_position_size: 15_300 }),
      // 17,000 币 @1.3，退回 S₁=1.1 亏 3,400
      addLeg(17_000),
    ];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [...tp, ...last], reverseHedgeOrders: stopAt(1.1) }).get('add')!;
    // 加仓时还拿着：主力 4,000 @1.0 + 镜像 6,000 @1.02
    expect(v.x1Coins).toBeCloseTo(10_000, 6);
    expect(v.cushion).toBeCloseTo(4_000 * 0.1 + 6_000 * 0.08, 6);
    expect(v.banked).toBeCloseTo(tp[0].pnl + tp[1].pnl, 6);
    expect(v.banked).toBeCloseTo(2_820, 6);
    expect(v.maxLoss).toBeCloseTo(3_400, 6);
    // 按「最后一刀」判持有：25,000 币整腿进垫子（2,200）、G 为 0 → 误判成红叉
    expect(v.status).toBe('ok');
  });

  it('部分平仓：加仓前已经减掉的一半不算浮盈垫', () => {
    const tradeRecords = [
      record({ id: 'r1', positionId: 'P', fillId: 'P', quantity: 5_000, exitPrice: 1, pnl: 0, closeTime: T0 + 60 * MIN }),
      record({ id: 'r2', positionId: 'P', fillId: 'P', quantity: 5_000, exitPrice: 1.2, pnl: 1_000, closeTime: T0 + 600 * MIN }),
    ];
    const legs = [mainLeg({ trade_record_id: 'P' }), addLeg(4_500)];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords, reverseHedgeOrders: stopAt(1.1) }).get('add')!;
    expect(v.x1Coins).toBeCloseTo(5_000, 6);
    expect(v.cushion).toBeCloseTo(500, 6);
    expect(v.banked).toBeCloseTo(0, 6);
    expect(v.maxLoss).toBeCloseTo(900, 6);
    expect(v.status).toBe('fail');
    expect(v.shortfall).toBeCloseTo(400, 6);
  });

  it('普通减仓的正利润不混入 G：Plan B 正向垫子只认镜像止盈 / tp1', () => {
    const tradeRecords = [
      record({
        id: 'r1', positionId: 'P', fillId: 'P', quantity: 1_000,
        exitPrice: 1.2, pnl: 200, closeTime: T0 + 60 * MIN, exit_method: 'manual',
      }),
      // 留一刀在加仓之后，明确这条主力当时尚未平完。
      record({
        id: 'r2', positionId: 'P', fillId: 'P', quantity: 9_000,
        exitPrice: 1.2, pnl: 1_800, closeTime: T0 + 600 * MIN, exit_method: 'manual',
      }),
    ];
    const legs = [mainLeg({ trade_record_id: 'P' }), addLeg(5_000)];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords, reverseHedgeOrders: stopAt(1.1) }).get('add')!;
    expect(v.x1Coins).toBeCloseTo(9_000, 6);
    expect(v.cushion).toBeCloseTo(900, 6);
    expect(v.banked).toBe(0);
    expect(v.maxLoss).toBeCloseTo(1_000, 6);
    expect(v.status).toBe('fail');
    expect(v.shortfall).toBeCloseTo(100, 6);
  });

  it('再入场：上一轮落袋的止盈与止损都不是这一轮的 G', () => {
    const tAdd = T0 + 300 * MIN;
    const legs = [
      mainLeg({ post_simulated_close_time: iso(T0 + 180 * MIN), post_realized_pnl: -1_000 }),
      leg({
        id: 'mirror', leg_role: 'mirror_tp', pre_simulated_time: iso(T0), pre_entry_price: 1,
        pre_position_size: 5_000, post_simulated_close_time: iso(T0 + 60 * MIN), post_realized_pnl: 500,
      }),
      leg({ id: 'reentry', leg_role: 'reentry_main', pre_simulated_time: iso(T0 + 240 * MIN), pre_entry_price: 1.2, pre_position_size: 10_000 }),
      // 退回 S₁=1.25 亏 800
      leg({ id: 'add', leg_role: 'main_add_1', pre_simulated_time: iso(tAdd), pre_entry_price: 1.4, pre_position_size: (800 / 0.15) * 1.4 }),
    ];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: [short(1.25, tAdd - MIN, null)] }).get('add')!;
    expect(v.x1Coins).toBeCloseTo(10_000 / 1.2, 6);
    expect(v.cushion).toBeCloseTo((10_000 / 1.2) * 0.05, 6);
    expect(v.banked).toBe(0);
    expect(v.maxLoss).toBeCloseTo(800, 6);
    expect(v.status).toBe('fail');
    expect(v.shortfall).toBeCloseTo(800 - (10_000 / 1.2) * 0.05, 6);
  });

  it('先前那笔加仓止损出局：它亏掉的 −200 从 G 里扣掉', () => {
    const t1 = T0 + 90 * MIN;
    const t2 = T0 + 180 * MIN;
    const legs = [
      mainLeg(),
      leg({
        id: 'mirror', leg_role: 'mirror_tp', pre_simulated_time: iso(T0), pre_entry_price: 1,
        pre_position_size: 5_000, post_simulated_close_time: iso(T0 + 60 * MIN), post_realized_pnl: 500,
      }),
      leg({
        id: 'add1', leg_role: 'main_add_1', pre_simulated_time: iso(t1), pre_entry_price: 1.3, pre_position_size: 2_000 * 1.3,
        post_simulated_close_time: iso(T0 + 120 * MIN), post_realized_pnl: -200,
      }),
      // 7,000 币 @1.3 退回 S₁=1.1 亏 1,400；浮盈垫 1,000 + 剩下的 G 300 = 1,300
      leg({ id: 'add2', leg_role: 'main_add_2', pre_simulated_time: iso(t2), pre_entry_price: 1.3, pre_position_size: 7_000 * 1.3 }),
    ];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: [short(1.1, t1 - MIN, null)] }).get('add2')!;
    expect(v.x1Coins).toBeCloseTo(10_000, 6);
    expect(v.cushion).toBeCloseTo(1_000, 6);
    expect(v.banked).toBeCloseTo(300, 6);
    expect(v.status).toBe('fail');
    expect(v.shortfall).toBeCloseTo(100, 6);
  });

  it('加仓后随手把旧止损换成更近的一张：取补挂的那张，马上要撤的旧单不顶替它', () => {
    const tAdd = T0 + 60 * MIN;
    const legs = [
      mainLeg(),
      leg({ id: 'add', leg_role: 'main_add_1', pre_simulated_time: iso(tAdd), pre_entry_price: 1.3, pre_position_size: 1_300 }),
    ];
    const orders = [
      short(0.95, T0 + 10 * MIN, tAdd + 3 * MIN),   // 主力的老止损，加仓后 3 分钟撤
      short(1.1, tAdd + 2 * MIN, null),             // 加仓后 2 分钟补挂的新线
    ];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: orders }).get('add')!;
    expect(v.s1).toBe(1.1);
    expect(v.cushion).toBeCloseTo(1_000, 6);
    expect(v.maxLoss).toBeCloseTo(200, 6);
    expect(v.status).toBe('ok');
  });

  it('没触发的镜像止盈是挂单不是持仓：开仓价是触发价，不进浮盈垫', () => {
    const legs = [
      mainLeg(),
      // appendUntriggeredMirrorTpLeg 合成的那条：无成交、无盈亏，开仓价 = 止盈触发价，平仓时刻 = 战役结束
      leg({
        id: 'mirror-pending', leg_role: 'mirror_tp', pre_simulated_time: iso(T0), pre_entry_price: 1.5,
        pre_position_size: 5_000, post_simulated_close_time: iso(T0 + 600 * MIN),
      }),
      addLeg(1_000),
    ];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: stopAt(1.1) }).get('add')!;
    expect(v.x1Coins).toBeCloseTo(10_000, 6);
    expect(v.cushion).toBeCloseTo(1_000, 6);
    expect(v.status).toBe('ok');
  });

  it('币本位落袋跟着平仓价校正走：与 Legs「盈亏」列同一个数', () => {
    const rec = record({
      id: 'mirror-rec', symbol: 'TUTUSD_PERP', settlementMode: 'coin', contracts: 500, contractSizeUsd: 10, quantity: 500,
      entryPrice: 1, exitPrice: 1.2, pnl: 1_000, pnlCoin: 5_000 * (1 - 1 / 1.2), closeTime: T0 + 60 * MIN,
    });
    const legs = [
      mainLeg({ pre_settlement_mode: 'coin' }),
      leg({
        id: 'mirror', leg_role: 'mirror_tp', trade_record_id: 'mirror-rec', pre_settlement_mode: 'coin',
        pre_simulated_time: iso(T0), pre_entry_price: 1, pre_position_size: 5_000,
      }),
      addLeg(1_000, { pre_settlement_mode: 'coin' }),
    ];
    const corrections = { mirror: { exitPrice: 1.1, originalExitPrice: 1.2, candleLow: 1, candleHigh: 1.15 } };
    const v = evaluateCampaignAddSizing({
      legs, tradeRecords: [rec], legExitPriceCorrections: corrections, reverseHedgeOrders: stopAt(1.1),
    }).get('add')!;
    // 校正后落袋 5,000 × (1 − 1/1.1) 币，按 S₁ 1.1 估值恰好 500——不是没校正的 833.33 币 × 1.1
    expect(v.banked).toBeCloseTo(500, 6);
    const settlement = computeCampaignRealizedPnl({ final_realized_pnl: null, actual_evolution: [] }, legs, [rec], corrections);
    expect(settlement.byLeg.get('mirror')).toBeCloseTo(500, 6);
  });

  it('事件还原的腿没写结算模式：按记录上的 settlementMode 认币本位，落袋 = pnlCoin × S₁', () => {
    const rec = record({
      id: 'mirror-rec', symbol: 'TUTUSD_PERP', settlementMode: 'coin', contracts: 500, contractSizeUsd: 10, quantity: 500,
      entryPrice: 1, exitPrice: 2, pnl: 5_000, pnlCoin: 2_500, closeTime: T0 + 60 * MIN,
    });
    const legs = [
      mainLeg(),
      leg({
        id: 'mirror', leg_role: 'mirror_tp', trade_record_id: 'mirror-rec', pre_settlement_mode: null,
        pre_simulated_time: iso(T0), pre_entry_price: 1, pre_position_size: 5_000,
      }),
      addLeg(1_000),
    ];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [rec], reverseHedgeOrders: stopAt(1.1) }).get('add')!;
    expect(v.banked).toBeCloseTo(2_500 * 1.1, 6);
    // 镜像 5,000 张面值 ÷ 1.0 = 5,000 币已在加仓前全部平掉，不再占浮盈垫
    expect(v.x1Coins).toBeCloseTo(10_000, 6);
  });
});
