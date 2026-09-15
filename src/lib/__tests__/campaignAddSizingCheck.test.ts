import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeCushionAdd, computePlanBCoverageAtS1, crossCheckPostAddR0, detectBankedMirrorProfit } from '@/lib/addSizing';
import { describeAddSizingVerdict, evaluateCampaignAddSizing, formatAddSizingShortfall } from '@/lib/campaignAddSizingCheck';
import { pickBookLine } from '@/lib/hedgeLines';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { buildCloseRecords } from '@/lib/tradingSettlement';
import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, Position, TradeRecord } from '@/types/trading';

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
