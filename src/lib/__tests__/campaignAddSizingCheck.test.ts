import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeCushionAdd, computePlanBCoverageAtS1, crossCheckPostAddR0, detectBankedMirrorProfit, roundLimitPriceFavorable, sizeAddAtExpectedFill } from '@/lib/addSizing';
import { addSizingSnapshotLines, describeAddSizingVerdict, evaluateCampaignAddSizing, formatAddSizingShortfall } from '@/lib/campaignAddSizingCheck';
import { pickBookLine } from '@/lib/hedgeLines';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { buildCloseRecords } from '@/lib/tradingSettlement';
import type { TradeJournal } from '@/types/journal';
import { calcSlippage, type AddSizingSnapshot, type CampaignReverseHedgeOrder, type Position, type TradeRecord } from '@/types/trading';

/** 成本线式复核的注入口：两条路在数学上恒等，走正门造不出分歧；要测「对不上就不给对错号」只能把成本线算坏。 */
const costLineSeam = vi.hoisted(() => ({ offset: 0 }));
vi.mock('@/lib/addSizing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/addSizing')>('@/lib/addSizing');
  return {
    ...actual,
    evaluatePostAddCostLine: (args: Parameters<typeof actual.evaluatePostAddCostLine>[0]) => {
      const post = actual.evaluatePostAddCostLine(args);
      return post && costLineSeam.offset ? { ...post, blendedCost: post.blendedCost + costLineSeam.offset } : post;
    },
  };
});

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
    const available = v.cushion! + v.banked!;
    const expectedMaxCoins = available / (0.0419705 - 0.034726);
    expect(v.riskPerCoin).toBeCloseTo(0.0419705 - 0.034726, 8);
    expect(v.maxAllowedCoins).toBeCloseTo(expectedMaxCoins, 4);
    expect(v.maxAllowedNotional).toBeCloseTo(expectedMaxCoins * 0.0419705, 2);
    // “正确加仓”的主单位是币；U 只是按 S₂ 乘回去的名义仓位，不能把两者相加。
    expect(v.maxAllowedNotional).toBeCloseTo(v.maxAllowedCoins! * v.s2!, 8);
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
      expect(v.maxAllowedCoins).toBeCloseTo(7_500, 6);
      expect(v.maxAllowedNotional).toBeCloseTo(9_750, 6);
    });
  });

  it('可用覆盖额为负时，正确加仓上限是 0 币 / 0 U，不给出负仓位', () => {
    const t = T0 + 60 * MIN;
    const legs = [
      mainLeg({ pre_entry_price: 1.2, pre_position_size: 12_000 }),
      leg({ id: 'add', leg_role: 'main_add_1', pre_simulated_time: iso(t), pre_entry_price: 1.3, pre_position_size: 1_300 }),
    ];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: [short(1.1, t - MIN, null)] }).get('add')!;
    expect(v.status).toBe('fail');
    expect(v.required).toBeLessThan(0);
    expect(v.maxAllowedCoins).toBe(0);
    expect(v.maxAllowedNotional).toBe(0);
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
      pnl: 500, pnlCoin: 450, fee: 0, slippage: 0, exit_method: 'tp1',
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
        openTime: T0, closeTime: T0 + 60 * MIN, pnl: 900, exit_method: 'tp1',
        openedRealAt: holdingRealStart - 24 * 60 * MIN,
        closedRealAt: holdingRealStart - 23 * 60 * MIN,
      }),
      record({
        id: 'current-mirror-rec', positionId: 'current-mirror-rec', fillId: 'current-mirror-rec', quantity: 5_000,
        openTime: T0, closeTime: T0 + 60 * MIN, pnl: 500, exit_method: 'tp1',
        openedRealAt: holdingRealStart, closedRealAt: currentTpReal,
      }),
      // 模拟时刻同样落在加仓之前，但真实操作发生在加仓之后：历史校验不能倒灌未来利润。
      record({
        id: 'future-mirror-rec', positionId: 'future-mirror-rec', fillId: 'future-mirror-rec', quantity: 5_000,
        openTime: T0, closeTime: T0 + 60 * MIN, pnl: 700, exit_method: 'tp1',
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
      entryPrice: 1, exitPrice: 1.2, pnl: 1_000, pnlCoin: 5_000 * (1 - 1 / 1.2), closeTime: T0 + 60 * MIN, exit_method: 'tp1',
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
      entryPrice: 1, exitPrice: 2, pnl: 5_000, pnlCoin: 2_500, closeTime: T0 + 60 * MIN, exit_method: 'tp1',
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

/**
 * 计算器（detectBankedMirrorProfit + computePlanBCoverageAtS1）与 Legs（evaluateCampaignAddSizing）
 * 必须对同一笔加仓给出同一个 G、同一条 S₁、同一个上限——否则按计算器上限下的单会在 Legs 吃红叉，或反过来。
 */
describe('【复核】计算器与 Legs 同一个 G、同一条 S₁', () => {
  const recordOf = (over: Partial<TradeRecord> & { id: string }): TradeRecord => ({
    symbol: 'TUTUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', settlementMode: 'usdt',
    entryPrice: 1, exitPrice: 1, quantity: 0, leverage: 10, pnl: 0, fee: 0, slippage: 0,
    openTime: T0, closeTime: T0, positionId: over.id, fillId: over.id,
    ...over,
  } as TradeRecord);

  it('【回归】合并仓位的手动减仓按成交占比分给镜像腿的正利润，不进 G（V4）', () => {
    // 主力 10,000 @1.0 与镜像 15,000 @1.0 合并；止盈1 平 15,000 @1.2；加仓1 5,000 @1.3 合并进来；
    // 手动减仓 20% @1.25 拆成主力 +200、镜像 +300、加仓1 −50。加仓2 @1.4，S₁ = 1.2。
    const position = (units: { main: number; mirror: number; add?: number }): Position => {
      const fills = [
        { id: 'P', openTime: T0, entryPrice: 1, units: units.main },
        { id: 'M', openTime: T0, entryPrice: 1, units: units.mirror },
        ...(units.add ? [{ id: 'A', openTime: T0 + 90 * MIN, entryPrice: 1.3, units: units.add }] : []),
      ];
      const quantity = fills.reduce((sum, f) => sum + f.units, 0);
      return {
        id: 'P', side: 'LONG', quantity,
        entryPrice: fills.reduce((sum, f) => sum + f.units * f.entryPrice, 0) / quantity,
        leverage: 10, marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT',
        margin: 100, isolatedMargin: 100, openTime: T0, fills,
      } as Position;
    };
    const tp = buildCloseRecords({
      symbol: 'TUTUSDT', pos: position({ main: 10_000, mirror: 15_000 }), closeQty: 15_000, fillPrice: 1.2,
      closeTime: T0 + 60 * MIN, exitMethod: 'tp1', totals: { netPnl: 3_000, feeUsd: 0, slippageUsd: 0, notionalUsd: 18_000 },
    });
    const reduce = buildCloseRecords({
      symbol: 'TUTUSDT', pos: position({ main: 4_000, mirror: 6_000, add: 5_000 }), closeQty: 3_000, fillPrice: 1.25,
      closeTime: T0 + 150 * MIN, exitMethod: 'manual', totals: { netPnl: 450, feeUsd: 0, slippageUsd: 0, notionalUsd: 3_750 },
    });
    expect(reduce.map(r => Number(r.pnl.toFixed(6)))).toEqual([200, 300, -50]);

    const tAdd2 = T0 + 180 * MIN;
    const legs = [
      mainLeg({ trade_record_id: 'P' }),
      leg({ id: 'mirror', leg_role: 'mirror_tp', trade_record_id: 'M', pre_simulated_time: iso(T0), pre_entry_price: 1, pre_position_size: 15_000 }),
      leg({ id: 'add1', leg_role: 'main_add_1', trade_record_id: 'A', pre_simulated_time: iso(T0 + 90 * MIN), pre_entry_price: 1.3, pre_position_size: 6_500 }),
      // 计算器上限 20,750 × 1.02 ≈ 21,165 币
      leg({ id: 'add2', leg_role: 'main_add_2', pre_simulated_time: iso(tAdd2), pre_entry_price: 1.4, pre_position_size: 21_165 * 1.4 }),
    ];
    const tradeRecords = [...tp, ...reduce];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords, reverseHedgeOrders: [short(1.2, tAdd2 - MIN, null)] }).get('add2')!;
    expect(v.x1Coins).toBeCloseTo(12_000, 6);
    expect(v.cushion).toBeCloseTo(1_200, 6);
    // G = 止盈1 +3,000 − 加仓1 那一片 −50；主力 +200、镜像 +300 是手动减仓，不算
    expect(v.banked).toBeCloseTo(2_950, 6);

    const calc = detectBankedMirrorProfit('TUTUSDT', 'LONG', tradeRecords, T0);
    expect(calc.usd).toBeCloseTo(v.banked!, 6);
    // 仍持有：主力 3,200 @1、镜像 4,800 @1、加仓1 4,000 @1.3 → S̄ = 1.1
    const plan = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'usdt', sBar: 1.1, s1: 1.2, s2: 1.4, x1: 12_000, g: calc.usd })!;
    expect(plan.addCoinsMax).toBeCloseTo(20_750, 6);
    expect(v.maxAllowedCoins).toBeCloseTo(plan.addCoinsMax, 6);
    // 超出计算器上限 2% 的加仓，Legs 也必须是红叉
    expect(v.status).toBe('fail');
  });

  it.each([['CLOSE', 'sl'], ['LIQUIDATION', 'liquidation']] as const)(
    '【回归】本轮亏损多于止盈（%s）：两边都是 G = −700、上限 6,500 币（V5 / V6）',
    (action, exitMethod) => {
      const tAdd1 = T0 + 90 * MIN;
      const tAdd2 = T0 + 180 * MIN;
      const tradeRecords = [
        recordOf({ id: 'main-rec', quantity: 10_000, exitPrice: 1.5, pnl: 5_000, closeTime: T0 + 600 * MIN, exit_method: 'manual' }),
        recordOf({ id: 'mirror-rec', quantity: 15_000, exitPrice: 1.02, pnl: 300, closeTime: T0 + 60 * MIN, exit_method: 'tp1' }),
        // 加仓1 是单独的 20x 仓位，在 1.1 止损 / 强平
        recordOf({
          id: 'add1-rec', entryPrice: 1.3, quantity: 5_000, exitPrice: 1.1, pnl: -1_000, leverage: 20,
          openTime: tAdd1, closeTime: T0 + 120 * MIN, action, exit_method: exitMethod,
        }),
      ];
      const legs = [
        mainLeg({ trade_record_id: 'main-rec' }),
        leg({ id: 'mirror', leg_role: 'mirror_tp', trade_record_id: 'mirror-rec', pre_simulated_time: iso(T0), pre_entry_price: 1, pre_position_size: 15_000 }),
        leg({ id: 'add1', leg_role: 'main_add_1', trade_record_id: 'add1-rec', leverage: 20, pre_simulated_time: iso(tAdd1), pre_entry_price: 1.3, pre_position_size: 6_500 }),
        // 按旧计算器（G 截成 0 / 漏掉强平）的上限下单
        leg({ id: 'add2', leg_role: 'main_add_2', pre_simulated_time: iso(tAdd2), pre_entry_price: 1.4, pre_position_size: 10_000 * 1.4 }),
      ];
      const v = evaluateCampaignAddSizing({ legs, tradeRecords, reverseHedgeOrders: [short(1.2, tAdd2 - MIN, null)] }).get('add2')!;
      expect(v.x1Coins).toBeCloseTo(10_000, 6);
      expect(v.cushion).toBeCloseTo(2_000, 6);
      expect(v.banked).toBeCloseTo(-700, 6);

      const calc = detectBankedMirrorProfit('TUTUSDT', 'LONG', tradeRecords.filter(r => r.closeTime <= tAdd2), T0);
      expect(calc.usd).toBeCloseTo(-700, 6);
      const plan = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'usdt', sBar: 1, s1: 1.2, s2: 1.4, x1: 10_000, g: calc.usd })!;
      expect(plan.addCoinsMax).toBeCloseTo(6_500, 6);
      expect(v.maxAllowedCoins).toBeCloseTo(plan.addCoinsMax, 6);
      expect(v.status).toBe('fail');
      expect(v.shortfall).toBeCloseTo(700, 6);
    },
  );

  it('【回归】多张止损同时挂着：Legs 的 S₁ 与计算器 pickBookLine 选同一张（V7）', () => {
    const t = T0 + 60 * MIN;
    const legs = [
      mainLeg(),
      leg({ id: 'add', leg_role: 'main_add_1', pre_simulated_time: iso(t), pre_entry_price: 1.4, pre_position_size: 1_400 }),
    ];
    const orders = [short(1.15, t - 10 * MIN, null), short(1.2, t - 10 * MIN, null)];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: orders }).get('add')!;
    const book = pickBookLine(orders.map(o => ({ id: o.id, price: o.price, coins: 1, createdAt: o.createdAt })), 'LONG', 1.4);
    expect(v.s1).toBe(1.2);
    expect(book?.price).toBe(v.s1);
  });

  /**
   * COMMONUSDT 那一场：两边同一个 G、同一条 S₁、同一个 X₁，用户严格按计算器上限下单，Legs 仍判超限——
   * 计算器读的 S₂ 是下单前的基准价，市价单在引擎里按 calcSlippage 成交，Legs 读的是成交价。
   * 快照腿以 USD 记落袋：G_usd = G_coin × S₁，与币本位计算器的 G 同值（校验里 realized = coin × S₁）。
   */
  describe('【复核】S₂：计算器按下单前基准价、Legs 按成交价——滑点被 S₁/(S₂−S₁) 放大', () => {
    const FACE = 10;
    const S_BAR = 0.006974;
    const G_COIN = 55_994_538.5;
    const T_ADD1 = T0 + 61 * MIN;
    const T_ADD2 = T0 + 85 * MIN;
    const ADD1 = { s1: 0.007069, fill: 0.0077123, notional: 6_536_020, checkLimit: 834_391_899 };
    const ADD2 = { s1: 0.007487, fill: 0.00808786, notional: 13_809_610, checkLimit: 1_646_579_922 };
    const refOf = (add: { fill: number; notional: number }) => add.fill / (1 + 0.0001 + add.notional / 5e9);
    const X1 = 10_346_400 / S_BAR;
    const add1Coins = ADD1.notional / ADD1.fill;

    /** 加仓 1 / 加仓 2 各自的战役：加仓腿的成交价与名义由调用方给。 */
    const campaign = (which: 1 | 2, addFill: number, addNotional: number) => {
      const s1 = which === 1 ? ADD1.s1 : ADD2.s1;
      const legs = [
        leg({ id: 'main', leg_role: 'main_open', pre_simulated_time: iso(T0), pre_entry_price: S_BAR, pre_position_size: 10_346_400 }),
        leg({
          id: 'mirror', leg_role: 'mirror_tp', pre_simulated_time: iso(T0), pre_entry_price: S_BAR, pre_position_size: 15_519_600,
          post_simulated_close_time: iso(T0 + 12 * MIN), post_realized_pnl: G_COIN * s1,
        }),
        ...(which === 2
          ? [leg({ id: 'add1', leg_role: 'main_add_1', pre_simulated_time: iso(T_ADD1), pre_entry_price: ADD1.fill, pre_position_size: ADD1.notional })]
          : []),
        leg({
          id: `add${which}`, leg_role: `main_add_${which}` as TradeJournal['leg_role'],
          pre_simulated_time: iso(which === 1 ? T_ADD1 : T_ADD2), pre_entry_price: addFill, pre_position_size: addNotional,
        }),
      ];
      const orders = [short(ADD1.s1, T_ADD1 - MIN, T_ADD2 - MIN), short(ADD2.s1, T_ADD2 - MIN, null)];
      return evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: orders }).get(`add${which}`)!;
    };
    const calculator = (which: 1 | 2, s2: number) => {
      const x1 = which === 1 ? X1 : X1 + add1Coins;
      const sBar = which === 1 ? S_BAR : (X1 * S_BAR + add1Coins * ADD1.fill) / x1;
      const s1 = which === 1 ? ADD1.s1 : ADD2.s1;
      return { x1, sBar, s1, plan: computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar, s1, s2, x1, g: G_COIN })! };
    };

    it('【回归】实际成交：Legs 复现 834,391,899 / 1,646,579,922 的上限（< 0.01%），与计算器在同一个成交价上的上限相同；超限 +1.57% / +3.70%', () => {
      for (const [which, add] of [[1, ADD1], [2, ADD2]] as const) {
        const v = campaign(which, add.fill, add.notional);
        expect(v.status).toBe('fail');
        expect(v.s1).toBe(add.s1);
        expect(v.s2).toBe(add.fill);
        expect(Math.abs(v.maxAllowedCoins! / add.checkLimit - 1)).toBeLessThan(1e-4);
        const calc = calculator(which, add.fill);
        expect(v.x1Coins).toBeCloseTo(calc.x1, 3);
        expect(Math.abs(v.maxAllowedCoins! / calc.plan.addCoinsMax - 1)).toBeLessThan(1e-9);
        expect(v.x2Coins! / v.maxAllowedCoins! - 1).toBeCloseTo(which === 1 ? 0.0157 : 0.0370, 3);
      }
    });

    it('【回归】按基准价（不含滑点）取满计算器上限 → 引擎按 calcSlippage 成交 → Legs 判超限，幅度 = (1 − S₁/成交价)/(1 − S₁/基准价) − 1 ≈ 滑点 × S₁/(S₂−S₁)', () => {
      for (const [which, add] of [[1, ADD1], [2, ADD2]] as const) {
        const ref = refOf(add);
        const calc = calculator(which, ref);
        // 计算器（限价档 = 旧版行为）在基准价上给出的张数——那一场就是这么下的
        const plan = sizeAddAtExpectedFill({
          side: 'LONG', settlement: 'coin', coverage: calc.plan.available, s1: calc.s1, s2Ref: ref, orderKind: 'limit', contractFaceUsd: FACE,
        })!;
        expect(Math.abs(plan.contracts! - (which === 1 ? 653_615 : 1_380_978))).toBeLessThanOrEqual(2);
        const notional = plan.contracts! * FACE;
        const fill = calcSlippage(ref, notional, 'LONG');
        const v = campaign(which, fill, notional);
        expect(v.status).toBe('fail');
        const overshoot = v.x2Coins! / v.maxAllowedCoins! - 1;
        // 解析式：X_实际/X_上限 = (1 − S₁/成交价) ÷ (1 − S₁/基准价)；整张取整让名义差不到 10 USD（< 1e-6）
        const analytic = (1 - calc.s1 / fill) / (1 - calc.s1 / ref) - 1;
        expect(Math.abs(overshoot - analytic)).toBeLessThan(2e-6);
        // 一阶：滑点 × S₁/(S₂−S₁)，放大 11–13 倍
        const slip = fill / ref - 1;
        const amplification = calc.s1 / (ref - calc.s1);
        expect(amplification).toBeGreaterThan(11);
        expect(amplification).toBeLessThan(13);
        expect(Math.abs(overshoot / (slip * amplification) - 1)).toBeLessThan(0.01);
        expect(overshoot).toBeCloseTo(which === 1 ? 0.0157 : 0.0370, 3);
      }
    });

    it('按预计成交价定量（市价档）：同一笔在它自己的成交价上 Legs 判 ok，上限与 Legs 相差 < 0.01%', () => {
      for (const [which, add] of [[1, ADD1], [2, ADD2]] as const) {
        const ref = refOf(add);
        const calc = calculator(which, ref);
        const plan = sizeAddAtExpectedFill({
          side: 'LONG', settlement: 'coin', coverage: calc.plan.available, s1: calc.s1, s2Ref: ref, orderKind: 'market', contractFaceUsd: FACE,
        })!;
        expect(plan.converged).toBe(true);
        const notional = plan.contracts! * FACE;
        const fill = calcSlippage(ref, notional, 'LONG');
        const v = campaign(which, fill, notional);
        expect(v.status).toBe('ok');
        expect(v.shortfall).toBe(0);
        expect(Math.abs(v.maxAllowedCoins! / plan.addCoinsMax - 1)).toBeLessThan(1e-4);
        expect(v.x2Coins!).toBeLessThanOrEqual(v.maxAllowedCoins!);
        // 成交价与预计的 S₂′ 只差整张取整那一点名义带来的滑点差
        expect(Math.abs(fill / plan.s2Fill - 1)).toBeLessThan(1e-6);
      }
    });

    /**
     * 成交记录带着计算器当时的计划（addSizingSnapshot）：判定仍按成交价，快照原样交出；
     * 判超限时按**计划定量用的价**归因（attributeAddExcess）——市价计划已含预计滑点，
     * 只有按下单时的价、计入计划预计的滑点仍合规，才说「超出部分全部来自成交滑点」。
     * 默认计划 = 那一场实际发生的：按现价、不计滑点定量（限价档，653,615 张），市价成交。
     */
    const withSnapshot = (
      contracts: number,
      opts: { kind?: 'market' | 'limit' | 'conditional'; s2Plan?: number; fill?: number; snapshot?: Partial<AddSizingSnapshot>; record?: Partial<TradeRecord> } = {},
    ) => {
      const ref = refOf(ADD1);
      const s2Plan = opts.s2Plan ?? ref;
      const kind = opts.kind ?? 'limit';
      const calc = calculator(1, s2Plan);
      const plan = sizeAddAtExpectedFill({
        side: 'LONG', settlement: 'coin', coverage: calc.plan.available, s1: ADD1.s1, s2Ref: s2Plan, orderKind: kind, contractFaceUsd: FACE,
      })!;
      const snapshot: AddSizingSnapshot = {
        at: T_ADD1, plan: 'B', side: 'LONG', settlement: 'coin', s1: ADD1.s1, s2Ref: s2Plan, s2Fill: plan.s2Fill, slippagePct: plan.slippagePct,
        x1: calc.x1, sBar: calc.sBar, g: G_COIN, gUnit: 'COMMON', addCoinsMax: plan.addCoinsMax, contracts: plan.contracts, orderKind: kind,
        // 市价单下单那一刻的引擎基准价；计算后没动过就是计划的现价
        s2AtOrder: s2Plan,
        ...opts.snapshot,
      };
      const notional = contracts * FACE;
      // 默认按引擎的滑点在下单价上成交
      const fill = opts.fill ?? calcSlippage(snapshot.s2AtOrder!, notional, 'LONG');
      const record: TradeRecord = {
        id: 'rec-add1', symbol: 'COMMONUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', entryPrice: fill, exitPrice: 0.00742559,
        quantity: contracts, contracts, leverage: 5, pnl: -246_249, fee: 0, slippage: 0,
        openTime: T_ADD1, closeTime: T_ADD1 + 47 * MIN, settlementMode: 'coin', contractSizeUsd: FACE, addSizingSnapshot: snapshot,
        ...opts.record,
      };
      const legs = [
        leg({ id: 'main', leg_role: 'main_open', pre_simulated_time: iso(T0), pre_entry_price: S_BAR, pre_position_size: 10_346_400 }),
        leg({
          id: 'mirror', leg_role: 'mirror_tp', pre_simulated_time: iso(T0), pre_entry_price: S_BAR, pre_position_size: 15_519_600,
          post_simulated_close_time: iso(T0 + 12 * MIN), post_realized_pnl: G_COIN * ADD1.s1,
        }),
        leg({ id: 'add1', leg_role: 'main_add_1', trade_record_id: 'rec-add1', pre_simulated_time: iso(T_ADD1), pre_entry_price: fill, pre_position_size: notional }),
      ];
      const verdict = evaluateCampaignAddSizing({ legs, tradeRecords: [record], reverseHedgeOrders: [short(ADD1.s1, T_ADD1 - MIN, T_ADD2 - MIN)] }).get('add1')!;
      return { verdict, snapshot, ref, plan, fill };
    };

    it('【回归】那一场：按现价、不计滑点定的 653,615 张（限价档计划），下 653,602 张市价成交 → 判 fail，快照原样交出，超出部分全部来自成交滑点 +0.14%', () => {
      const { verdict: v, snapshot, ref, plan, fill } = withSnapshot(653_602);
      expect(plan.contracts).toBe(653_615);
      expect(fill).toBeCloseTo(ADD1.fill, 12);
      expect(v.status).toBe('fail');
      expect(v.s2).toBe(fill);
      expect(v.snapshot).toEqual(snapshot);
      expect(v.fillSlippagePct).toBeCloseTo((fill / ref - 1) * 100, 6);
      expect(v.fillSlippagePct).toBeCloseTo(0.1407, 3);
      // 本函数自己的 Y₁ + G 在参考价上的上限 ≈ 848.7M，容得下实际的 847.5M
      expect(v.snapshotLimitAtRef).toBeCloseTo(Math.max(0, v.required!) / (ref - ADD1.s1), 3);
      expect(v.snapshotLimitAtRef!).toBeGreaterThan(v.x2Coins!);
      expect(v.slippageOvershootPct).toBeCloseTo((v.snapshotLimitAtRef! / v.maxAllowedCoins! - 1) * 100, 9);
      expect(v.slippageOvershootPct).toBeGreaterThan(1.5);
      expect(v.excess?.cause).toBe('slippage');
      expect(v.excess?.unexpectedSlippagePct).toBeCloseTo(0.1407, 3);
      expect(v.withinSnapshotLimit).toBe(true);
      const lines = addSizingSnapshotLines(v)!;
      // 限价计划的 s2Ref 是手填的限价（快照里没有计算时的盘面价），不叫「现价」
      expect(lines.calc).toMatch(/^计算时 限价 0\.00770146，挂单价 0\.00770146（限价），上限 848,689,579(\.\d+)? 币$/);
      expect(lines.order).toBeNull();
      expect(lines.actual).toMatch(/^实际成交 0\.00771230（\+0\.14%），上限 834,391,89\d(\.\d+)? 币$/);
      expect(lines.slippage).toBe('超出部分全部来自成交滑点 +0.14%（计划按限价、不计滑点，这张却是吃单成交）');
      expect(lines.cause).toBeNull();
      const text = describeAddSizingVerdict(v);
      expect(text).toContain('仓位过大');
      expect(text).toContain('。计算时 限价 0.00770146，挂单价');
      expect(text).not.toContain('现价');
      expect(text).toContain('；实际成交 0.00771230');
      expect(text).toContain('。超出部分全部来自成交滑点 +0.14%');
    });

    it('【回归 · 复审】市价计划（已含 +0.14%，643,648 张），实际下 650,084 张（+1%）：成交只比预计差 0.0013%，归因是量超了计划 +1.00%，不点名滑点', () => {
      const { verdict: v, plan, fill } = withSnapshot(650_084, { kind: 'market' });
      expect(plan.contracts).toBe(643_648);
      expect(Math.abs(fill / plan.s2Fill - 1)).toBeLessThan(2e-5);
      expect(v.status).toBe('fail');
      expect(v.x2Coins! / v.maxAllowedCoins! - 1).toBeCloseTo(0.0101, 4);
      expect(v.excess?.cause).toBe('oversize');
      expect(v.excess?.planOvershootPct).toBeCloseTo(1.0, 2);
      expect(v.withinSnapshotLimit).toBe(false);
      // 括号里的滑点照实写（相对下单价 +0.14%），但不拿它顶罪
      expect(v.fillSlippagePct).toBeCloseTo(0.14, 2);
      const lines = addSizingSnapshotLines(v)!;
      expect(lines.calc).toMatch(/^计算时 现价 0\.00770146，预计成交 0\.00771215（\+0\.14%），上限 834,590,79\d(\.\d+)? 币$/);
      expect(lines.actual).toMatch(/^实际成交 0\.00771225（\+0\.14%），上限 834,462,18\d(\.\d+)? 币$/);
      expect(lines.slippage).toBeNull();
      expect(lines.cause).toBe('实际加仓比计算时的上限多 +1.00%——超出来自仓位本身，不是滑点');
      const text = describeAddSizingVerdict(v);
      expect(text).not.toContain('全部来自成交滑点');
      expect(text).toContain('。实际加仓比计算时的上限多 +1.00%');
      // 同一张市价计划，用户却按旧数 653,602 张下：同样是量的问题（+1.55%）
      const legacy = withSnapshot(653_602, { kind: 'market' }).verdict;
      expect(legacy.excess?.cause).toBe('oversize');
      expect(addSizingSnapshotLines(legacy)!.cause).toBe('实际加仓比计算时的上限多 +1.55%——超出来自仓位本身，不是滑点');
    });

    /**
     * 【回归 · 三审】下单前基准价跌了 0.3%（对多头有利），用户按 665,500 张下（比市价计划的 643,648 张多 3.4%）：
     * 按下单价 × 计划预计的滑点，这个量还放得下——但它比计算器的上限大，多出来的滑点正是多下的量推出来的。
     * 不能说「超出部分全部来自成交滑点」，要说量超了计算时的上限；withinSnapshotLimit 也不能是 true。
     */
    it('【回归 · 三审】有利价格变动后下了比计划大的量（665,500 张 vs 643,648 张）：说量超了计算时的上限 +3.39%，不点名滑点', () => {
      const ref = refOf(ADD1);
      const { verdict: v, plan } = withSnapshot(665_500, { kind: 'market', snapshot: { s2AtOrder: ref * 0.997 } });
      expect(plan.contracts).toBe(643_648);
      expect(v.status).toBe('fail');
      expect(v.excess?.priceDriftPct).toBeCloseTo(-0.3, 9);
      // 旧判据的前提仍在：按应有成交价，这个量在本函数的上限之内
      expect(v.excess!.limitAtAnchor).toBeGreaterThan(v.excess!.coinsAtPlan * (plan.s2Fill / v.excess!.anchorPrice));
      expect(v.excess?.withinPlanLimit).toBe(false);
      expect(v.excess?.cause).toBe('oversize');
      expect(v.excess?.planOvershootPct).toBeCloseTo((v.excess!.coinsAtPlan / plan.addCoinsMax - 1) * 100, 9);
      expect(v.withinSnapshotLimit).toBe(false);
      const lines = addSizingSnapshotLines(v)!;
      expect(lines.order).toBe('下单时 参考价 0.00767836（计算后价格变动 −0.30%）');
      expect(lines.slippage).toBeNull();
      expect(lines.cause).toBe('实际加仓比计算时的上限多 +3.39%——超出来自仓位本身，不是滑点');
      expect(describeAddSizingVerdict(v)).not.toContain('全部来自成交滑点');
      // 同样的有利变动、按计划整张下：合规
      expect(withSnapshot(643_648, { kind: 'market', snapshot: { s2AtOrder: ref * 0.997 } }).verdict.status).toBe('ok');
    });

    it('市价计划按整张下单、成交却比预计更差：这才是「全部来自成交滑点」，写的是多出来的那一截 +0.0020%，不是整段 +0.14%', () => {
      const { verdict: v, plan } = withSnapshot(643_648, { kind: 'market', fill: ADD1.fill });
      expect(v.status).toBe('fail');
      expect(v.excess?.cause).toBe('slippage');
      expect(v.excess?.unexpectedSlippagePct).toBeCloseTo((ADD1.fill / plan.s2Fill - 1) * 100, 9);
      expect(addSizingSnapshotLines(v)!.slippage).toBe('超出部分全部来自成交滑点 +0.0020%（比计划预计的成交价 0.00771215 更差）');
      // 基准价没动、成交正是预计的 S₂′：合规，快照照给，不说原因
      const ok = withSnapshot(643_648, { kind: 'market' }).verdict;
      expect(ok.status).toBe('ok');
      expect(ok.snapshot).not.toBeNull();
      expect(ok.excess).toBeNull();
      expect(ok.withinSnapshotLimit).toBeNull();
      const okLines = addSizingSnapshotLines(ok)!;
      expect(okLines.slippage).toBeNull();
      expect(okLines.cause).toBeNull();
      expect(describeAddSizingVerdict(ok)).not.toContain('计算时');
    });

    it('【回归 · 复审】限价计划、量比参考价上限多 0.10%：即使市价成交带了 +0.14%，也不说「全部来自滑点」（币本位按计划价折币，不按成交价）', () => {
      const refLimit = calculator(1, refOf(ADD1)).plan.addCoinsMax;
      const contracts = Math.floor((refLimit * 1.001 * refOf(ADD1)) / FACE);
      const { verdict: v } = withSnapshot(contracts);
      expect(v.status).toBe('fail');
      // 按成交价折出的币数 < 参考价上限——旧判据正是被这个骗了
      expect(v.x2Coins!).toBeLessThan(refLimit);
      expect(v.excess?.cause).toBe('oversize');
      expect(v.excess?.coinsAtPlan! / refLimit - 1).toBeCloseTo(0.001, 5);
      expect(v.withinSnapshotLimit).toBe(false);
      const lines = addSizingSnapshotLines(v)!;
      expect(lines.slippage).toBeNull();
      expect(lines.cause).toBe('实际加仓比计算时的上限多 +0.10%——超出来自仓位本身，不是滑点');
      // 更多的量同理
      expect(withSnapshot(Math.round(653_602 * 1.05)).verdict.excess?.cause).toBe('oversize');
    });

    it('【回归 · 复审】限价计划按未取整的 S₂ 0.0077018 定量，挂单价却被四舍五入到 0.007702 原价成交：不写「滑点 +0.00%」，写下单价偏离计划挂单价；向有利侧取整则合规', () => {
      const s2Plan = 0.0077018;
      const planned = withSnapshot(0, { s2Plan }).plan;
      expect(planned.contracts).toBe(653_295);
      const { verdict: v } = withSnapshot(653_295, { s2Plan, fill: 0.007702, snapshot: { s2AtOrder: 0.007702 }, record: { type: 'LIMIT' } });
      expect(v.status).toBe('fail');
      expect(v.shortfall).toBeCloseTo(155.63, 1);
      expect(v.fillSlippagePct).toBe(0);
      expect(v.excess?.cause).toBe('price_drift');
      expect(v.withinSnapshotLimit).toBe(false);
      const lines = addSizingSnapshotLines(v)!;
      expect(lines.slippage).toBeNull();
      expect(lines.order).toBe('下单时 参考价 0.00770200（下单价偏离计划挂单价 +0.0026%）');
      expect(lines.cause).toMatch(/^超出来自下单价偏离计划挂单价 \+0\.0026%：按下单时的价，上限只有 847,968,89\d(\.\d+)? 币——限价要挂在计划的价上（多头只能更低、空头只能更高）$/);
      expect(describeAddSizingVerdict(v)).not.toContain('滑点 +0.00%');

      // 计算器现在先把挂单价向有利侧取整（多头向下）再定量：计划、委托、成交是同一个价，合规
      const safe = roundLimitPriceFavorable(s2Plan, 6, 'LONG');
      expect(safe).toBe(0.007701);
      const safePlan = withSnapshot(0, { s2Plan: safe }).plan;
      const ok = withSnapshot(safePlan.contracts!, { s2Plan: safe, fill: safe, snapshot: { s2Ref: s2Plan }, record: { type: 'LIMIT' } }).verdict;
      expect(ok.status).toBe('ok');
      // 手填的限价 0.0077018 与取整后的挂单价 0.007701 各写各的
      expect(addSizingSnapshotLines(ok)!.calc).toMatch(/^计算时 限价 0\.00770180，挂单价 0\.00770100（限价），上限 849,310,61\d(\.\d+)? 币$/);
    });

    it('【回归 · 复审】计算后价格变了：按市价计划的整张下单，但下单时基准价已涨 0.2%——写「计算后价格变动 +0.20%」，括号里的滑点相对下单价 +0.14%，不是 +0.34%', () => {
      const ref = refOf(ADD1);
      const { verdict: v } = withSnapshot(643_648, { kind: 'market', snapshot: { s2AtOrder: ref * 1.002 } });
      expect(v.status).toBe('fail');
      expect(v.excess?.cause).toBe('price_drift');
      expect(v.excess?.priceDriftPct).toBeCloseTo(0.2, 9);
      expect(Math.abs(v.excess!.unexpectedSlippagePct)).toBeLessThan(1e-4);
      expect(v.withinSnapshotLimit).toBe(false);
      expect(v.fillSlippagePct).toBeCloseTo(0.1387, 3);
      const lines = addSizingSnapshotLines(v)!;
      expect(lines.order).toBe('下单时 参考价 0.00771687（计算后价格变动 +0.20%）');
      expect(lines.actual).toMatch(/^实际成交 0\.00772757（\+0\.14%），/);
      expect(lines.slippage).toBeNull();
      expect(lines.cause).toMatch(/^超出来自计算后的价格变动 \+0\.20%：按下单时的价，上限只有 815,043,9\d\d(\.\d+)? 币——下单前该按新价重算$/);
      const text = describeAddSizingVerdict(v);
      expect(text).toContain('；下单时 参考价 0.00771687（计算后价格变动 +0.20%）；实际成交');
      expect(text).not.toContain('全部来自成交滑点');
    });

    /**
     * 【回归 · 三审】条件委托计划（突破加仓）：计算器按**触发价**上的滑点定量，触发后引擎在触发价上吃单成交。
     * 三行话把「现价」换成「触发价」；触发价没挂在计划的价上，写「触发价偏离计划触发价」，不说计算后价格变动。
     */
    it('【回归 · 三审】条件委托计划：计算时写触发价；按计划整张触发成交合规；多挂 1% 说量超了；触发价挂高 0.2% 说触发价偏离', () => {
      const TRIG = 0.0077015;
      const planned = withSnapshot(0, { kind: 'conditional', s2Plan: TRIG }).plan;
      expect(planned.contracts).toBe(643_614);
      const cond = { kind: 'conditional' as const, s2Plan: TRIG, record: { type: 'CONDITIONAL' as const } };
      const ok = withSnapshot(planned.contracts!, cond).verdict;
      expect(ok.status).toBe('ok');
      expect(ok.snapshot?.orderKind).toBe('conditional');
      const okLines = addSizingSnapshotLines(ok)!;
      expect(okLines.calc).toMatch(/^计算时 触发价 0\.00770150，预计成交 0\.00771218（\+0\.14%），上限 834,542,71\d(\.\d+)? 币$/);
      expect(okLines.order).toBeNull();
      expect(okLines.slippage).toBeNull();
      expect(okLines.cause).toBeNull();

      const over = withSnapshot(Math.round(planned.contracts! * 1.01), cond).verdict;
      expect(over.status).toBe('fail');
      expect(over.excess?.cause).toBe('oversize');
      expect(addSizingSnapshotLines(over)!.cause).toBe('实际加仓比计算时的上限多 +1.00%——超出来自仓位本身，不是滑点');

      const moved = withSnapshot(planned.contracts!, { ...cond, snapshot: { s2AtOrder: TRIG * 1.002 } }).verdict;
      expect(moved.status).toBe('fail');
      expect(moved.excess?.cause).toBe('price_drift');
      const lines = addSizingSnapshotLines(moved)!;
      expect(lines.order).toBe('下单时 参考价 0.00771690（触发价偏离计划触发价 +0.20%）');
      expect(lines.cause).toMatch(/^超出来自触发价偏离计划触发价 \+0\.20%：按下单时的价，上限只有 [\d,.]+ 币——触发价要挂在计划的价上，改了触发价就按新触发价重算$/);
      expect(lines.slippage).toBeNull();
      expect(describeAddSizingVerdict(moved)).not.toContain('计算后价格变动');
    });

    it('量在计算器的上限之内、按这里读到的 S₁ 却超了：写输入不一致，两个 S₁ 都摆出来', () => {
      const refLimit = calculator(1, refOf(ADD1)).plan.addCoinsMax;
      const contracts = Math.floor((refLimit * 1.05 * refOf(ADD1)) / FACE);
      const { verdict: v } = withSnapshot(contracts, {
        fill: refOf(ADD1), snapshot: { s1: 0.0071, addCoinsMax: refLimit * 1.2 }, record: { type: 'LIMIT' },
      });
      expect(v.status).toBe('fail');
      expect(v.excess?.cause).toBe('inputs');
      expect(addSizingSnapshotLines(v)!.cause).toBe('实际量在计算器的上限之内，差在计算器的输入与这里读到的不一致（计算器 S₁ 0.00710000，校验 S₁ 0.00706900；或 G / 旧仓不同）');
    });

    it('方向不符的快照不认；没有快照的记录什么也不多说（腿上的 pre_entry_price 不当下单前的价用）', () => {
      const wrongSide = withSnapshot(653_602, { snapshot: { side: 'SHORT' } }).verdict;
      expect(wrongSide.status).toBe('fail');
      expect(wrongSide.snapshot).toBeNull();
      expect(wrongSide.snapshotLimitAtRef).toBeNull();
      expect(wrongSide.excess).toBeNull();
      expect(wrongSide.withinSnapshotLimit).toBeNull();
      expect(addSizingSnapshotLines(wrongSide)).toBeNull();
      const none = withSnapshot(653_602, { record: { addSizingSnapshot: undefined } }).verdict;
      expect(none.status).toBe('fail');
      expect(none.snapshot).toBeNull();
      expect(none.fillSlippagePct).toBeNull();
      expect(describeAddSizingVerdict(none)).not.toContain('计算时');
      // 没有记录、只有腿的老战役：pre_entry_price 是成交价，同样不当参考价
      const plain = campaign(1, ADD1.fill, ADD1.notional);
      expect(plain.snapshot).toBeNull();
      expect(plain.snapshotLimitAtRef).toBeNull();
    });
  });

  it('读屏文字：no_direction / non_finite 各报各的原因；判定文字写明 max(0, Y₁ + G) 与 U', () => {
    const t = T0 + 60 * MIN;
    const noDirection = evaluateCampaignAddSizing({
      legs: [mainLeg(), leg({
        id: 'add', leg_role: 'main_add_1', direction: null as unknown as TradeJournal['direction'],
        pre_simulated_time: iso(t), pre_entry_price: 1.3, pre_position_size: 1_300,
      })],
      tradeRecords: [],
      reverseHedgeOrders: [short(1.1, t - MIN, null)],
    }).get('add')!;
    expect(noDirection.reason).toBe('no_direction');
    expect(describeAddSizingVerdict(noDirection)).toBe('加仓校验：无法判断——加仓腿没有多空方向');
    expect(describeAddSizingVerdict({ ...noDirection, reason: 'non_finite' })).toBe('加仓校验：无法判断——计算结果不是有限数');

    const ok = evaluateCampaignAddSizing({
      legs: [mainLeg(), leg({ id: 'add', leg_role: 'main_add_1', pre_simulated_time: iso(t), pre_entry_price: 1.3, pre_position_size: 1_300 })],
      tradeRecords: [],
      reverseHedgeOrders: [short(1.1, t - MIN, null)],
    }).get('add')!;
    const text = describeAddSizingVerdict(ok);
    expect(text).toContain('加仓校验：仓位合规');
    expect(text).toContain('可用 max(0, Y₁ + G) = 1000.00 U');
    expect(text).toContain('新加仓最大亏损 200.00 U');
  });
});

describe('【复核】Legs 校验也走两条路：垫子式与成本线式对不上就不给对错号', () => {
  afterEach(() => { costLineSeam.offset = 0; });

  // 浮盈垫 1,000 + 落袋 500；新腿每币退回 S₁ 亏 0.2
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

  it('合规与过大都带上成本线式的读数，与垫子式同一个缺口', () => {
    const ok = evaluateCampaignAddSizing({ legs: legsWith(7_000), tradeRecords: [], reverseHedgeOrders: orders }).get('add')!;
    expect(ok.status).toBe('ok');
    // C = (10,000 × 1 + 7,000 × 1.3) ÷ 17,000；17,000 × (C − 1.1) = 400 < G 500
    expect(ok.blendedCost).toBeCloseTo(19_100 / 17_000, 12);
    expect(ok.costLineShortfall).toBe(0);

    const fail = evaluateCampaignAddSizing({ legs: legsWith(8_000), tradeRecords: [], reverseHedgeOrders: orders }).get('add')!;
    expect(fail.status).toBe('fail');
    expect(fail.shortfall).toBeCloseTo(100, 6);
    expect(fail.costLineShortfall).toBeCloseTo(100, 6);
  });

  it('【回归】TUTUSDT：成本线式算出的缺口与垫子式相差不到百万分之一', () => {
    const { legs, orders: tut } = tutusdt();
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: tut }).get('add1')!;
    expect(v.status).toBe('fail');
    expect(v.blendedCost).toBeGreaterThan(v.s1!);
    expect(Math.abs(v.costLineShortfall! - v.shortfall!)).toBeLessThanOrEqual(1e-6 * v.shortfall!);
  });

  it('旧仓在加仓前已全部平掉：这是再入场，X₁ = 0、上一轮的 G 不跨轮；成本线就是 S₂，两条路给同一个缺口', () => {
    const legs = [
      // 主力在止盈之后以零盈亏整腿平掉：加仓那一刻没有任何旧仓还开着
      mainLeg({ post_simulated_close_time: iso(T0 + 90 * MIN), post_realized_pnl: 0 }),
      leg({
        id: 'mirror', leg_role: 'mirror_tp', pre_simulated_time: iso(T0), pre_entry_price: 1,
        pre_position_size: 5_000, post_simulated_close_time: iso(T0 + 60 * MIN), post_realized_pnl: 500,
      }),
      leg({ id: 'add', leg_role: 'main_add_1', pre_simulated_time: iso(t), pre_entry_price: 1.3, pre_position_size: 2_000 * 1.3 }),
    ];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: orders }).get('add')!;
    expect(v.x1Coins).toBe(0);
    expect(v.cushion).toBe(0);
    expect(v.banked).toBe(0);
    expect(v.blendedCost).toBe(1.3);
    // 没有垫子：亏损 2,000 × 0.2 = 400 全是缺口，垫子式与成本线式一致
    expect(v.status).toBe('fail');
    expect(v.shortfall).toBeCloseTo(400, 6);
    expect(v.costLineShortfall).toBeCloseTo(400, 6);
  });

  it('【回归】旧仓深度浮亏被 G 补上（|Y₁| ≫ 可用垫）：缺两分钱 Legs 判 ✗，计算器的交叉复核用同一条截断容差也判非法', () => {
    // 主力 100,000 币 @1.0，S₁ = 0.5 → Y₁ = −50,000；落袋 50,100 → 可用只有 100；加 500.1 币 @0.7 退回 S₁ 亏 100.02
    const legs = [
      mainLeg({ pre_position_size: 100_000 }),
      leg({
        id: 'mirror', leg_role: 'mirror_tp', pre_simulated_time: iso(T0), pre_entry_price: 1,
        pre_position_size: 5_000, post_simulated_close_time: iso(T0 + 60 * MIN), post_realized_pnl: 50_100,
      }),
      leg({ id: 'add', leg_role: 'main_add_1', pre_simulated_time: iso(t), pre_entry_price: 0.7, pre_position_size: 500.1 * 0.7 }),
    ];
    const v = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: [short(0.5, t - MIN, null)] }).get('add')!;
    expect(v.status).toBe('fail');
    expect(v.cushion).toBeCloseTo(-50_000, 6);
    expect(v.required).toBeCloseTo(100, 6);
    expect(v.shortfall).toBeCloseTo(0.02, 6);
    // 同一批数喂给计算器那条交叉复核：截断容差不许被 5 万的成本线越过额放宽到 0.05，两边同判
    const r = crossCheckPostAddR0({
      side: 'LONG', settlement: 'usdt', sBar: v.s1! - v.cushion! / v.x1Coins!, s1: v.s1!, s2: v.s2!,
      x1: v.x1Coins!, addCoins: v.x2Coins!, g: v.banked!,
    })!;
    expect(r.tolerance).toBeCloseTo(0.01, 12);
    expect(r.verdict).toBe('violation');
    expect(r.shortfall).toBeCloseTo(v.shortfall!, 9);
  });

  it('【回归】成本线被算坏：不给 ✓ 也不给 ✗，标 unknown / self_check_mismatch，两个数都留着', () => {
    // 成本线抬高 0.01 → 17,000 币 × 0.01 = 170 USD 的分歧，远超 0.01 的容差
    costLineSeam.offset = 0.01;
    const v = evaluateCampaignAddSizing({ legs: legsWith(7_000), tradeRecords: [], reverseHedgeOrders: orders }).get('add')!;
    expect(v.status).toBe('unknown');
    expect(v.reason).toBe('self_check_mismatch');
    // 垫子式仍说没缺口，成本线式说缺 70：两个数都在
    expect(v.shortfall).toBe(0);
    expect(v.costLineShortfall).toBeCloseTo(70, 6);
    expect(v.maxAllowedCoins).toBeCloseTo(7_500, 6);
    const text = describeAddSizingVerdict(v);
    expect(text).toContain('加仓校验：无法判断——两种算法结果不一致');
    expect(text).toContain('垫子式缺口 0.00 U');
    expect(text).toContain('成本线式缺口 70.00 U');
  });

  it('分歧小于容差不算不一致：抬高 1e-9 仍判 ok', () => {
    costLineSeam.offset = 1e-9;
    const v = evaluateCampaignAddSizing({ legs: legsWith(7_000), tradeRecords: [], reverseHedgeOrders: orders }).get('add')!;
    expect(v.status).toBe('ok');
  });
});
