import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, profile: null }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(() => ({ upsert: vi.fn(async () => ({ error: null })) })) },
}));

import { TradingProvider, useTradingContext, type PlaceOrderParams } from '@/contexts/TradingContext';
import { __resetAddSizingPlanForTests, clearAddSizingPlan, getAddSizingPlan, publishAddSizingPlan, touchAddSizingPlan } from '@/lib/addSizingPlan';
import { __resetNotificationCenterForTests, getNotificationSnapshot } from '@/lib/notificationCenter';
import { computePlanBCoverageAtS1, sizeAddAtExpectedFill } from '@/lib/addSizing';
import { addSizingSnapshotLines, evaluateCampaignAddSizing } from '@/lib/campaignAddSizingCheck';
import { calcSlippage, type AddSizingSnapshot, type TradeRecord } from '@/types/trading';
import { executeSettlementFill, isPositionOpen } from '@/lib/tradingSettlement';
import type { TradeJournal } from '@/types/journal';

/**
 * 加仓计划的往返：计算器发布 → 下单入口钉到单子上 → 成交落到仓位（这一笔）→ 平仓写进记录；
 * 以及市价加仓成交后的复判：超限进消息中心，首笔开仓静默。走真实的 TradingProvider。
 */
const T0 = Date.parse('2026-09-15T00:00:00Z');
const SIM0 = Date.parse('2024-01-15T08:00:00Z');

const wrapper = ({ children }: { children: React.ReactNode }) => <TradingProvider>{children}</TradingProvider>;
const mount = () => renderHook(() => useTradingContext(), { wrapper });

const marketLong = (over: Partial<PlaceOrderParams> = {}): PlaceOrderParams => ({
  side: 'LONG', type: 'MARKET', price: 0, stopPrice: 0, quantity: 10, leverage: 10, marginMode: 'isolated',
  priceSelection: 'MARKET', triggerType: 'LAST', currencyUnit: 'BASE', usdtInputMode: 'ORDER_VALUE', inputAmount: 10,
  settlementMode: 'usdt', latestPrice: 100,
  ...over,
});

const plan = (over: Partial<Omit<AddSizingSnapshot, 'at'>> = {}): Omit<AddSizingSnapshot, 'at'> => ({
  plan: 'A', side: 'LONG', settlement: 'usdt', s1: 105, s2Ref: 110, s2Fill: 110.011, slippagePct: 0.01,
  x1: 10, sBar: 100.01, g: 0, gUnit: 'USD', addCoinsMax: 9.96, contracts: null, orderKind: 'market',
  ...over,
});

const warnings = () => getNotificationSnapshot().entries.filter(e => e.level === 'warning');

beforeEach(() => {
  localStorage.clear();
  __resetAddSizingPlanForTests();
  __resetNotificationCenterForTests();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  __resetAddSizingPlanForTests();
  __resetNotificationCenterForTests();
  localStorage.clear();
});

describe('加仓计划的往返：委托 → 成交 → 记录', () => {
  it('市价单：计划钉到仓位（这一笔）上、取走即消费；第二笔没有新计划就不带；平仓时只有那一片记录带着它', () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    publishAddSizingPlan('ETHUSDT', plan());

    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong()); });
    const first = result.current.positionsMap.ETHUSDT[0];
    // 钉上去的是计划的拷贝，补上这张单自己的下单参考价：市价 = 引擎成交的基准价
    expect(first.addSizingSnapshot).toEqual({ ...plan(), at: T0, s2AtOrder: 100 });
    expect(first.fills?.[0].addSizingSnapshot).toEqual({ ...plan(), at: T0, s2AtOrder: 100 });
    expect(getAddSizingPlan()).toBeNull();

    // 同向第二笔并进同一仓位：没有新计划，这一笔不带
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 5, inputAmount: 5 })); });
    const merged = result.current.positionsMap.ETHUSDT[0];
    expect(merged.fills).toHaveLength(2);
    expect(merged.fills![0].addSizingSnapshot).toMatchObject({ s1: 105 });
    expect(merged.fills![1].addSizingSnapshot).toBeUndefined();

    act(() => { result.current.handleClosePosition('ETHUSDT', 0, 1); });
    const records = result.current.tradeHistory.filter(r => r.symbol === 'ETHUSDT' && r.action === 'CLOSE');
    expect(records).toHaveLength(2);
    const withPlan = records.find(r => r.fillId === merged.fills![0].id)!;
    const without = records.find(r => r.fillId === merged.fills![1].id)!;
    expect(withPlan.addSizingSnapshot).toMatchObject({ ...plan(), at: T0 });
    expect(without.addSizingSnapshot).toBeUndefined();
    // 记录整块 JSON 持久化：字段跟着 trade_history 走，云同步不需要任何表结构变更
    const stored = JSON.parse(localStorage.getItem('sim_anon_trade_history') ?? '[]') as Array<{ fillId?: string; addSizingSnapshot?: unknown }>;
    expect(stored.find(r => r.fillId === withPlan.fillId)?.addSizingSnapshot).toMatchObject({ s1: 105 });
    expect(stored.find(r => r.fillId === without.fillId)?.addSizingSnapshot).toBeUndefined();
  });

  it('被拒的单子不消费计划：余额不足被拦下后，改完量再下仍带着同一份计划', () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    publishAddSizingPlan('ETHUSDT', plan());
    // 1,000,000 币 × 100 ÷ 10 倍 = 1,000 万保证金，远超 100 万余额 → 拒单
    let rejected: { id: string } | null = null;
    act(() => { rejected = result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 1_000_000, inputAmount: 1_000_000 })); });
    expect(rejected).toBeNull();
    expect(result.current.positionsMap.ETHUSDT ?? []).toHaveLength(0);
    expect(getAddSizingPlan()).not.toBeNull();
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong()); });
    expect(result.current.positionsMap.ETHUSDT[0].addSizingSnapshot).toMatchObject({ ...plan(), at: T0 });
    expect(getAddSizingPlan()).toBeNull();
  });

  it('限价单：计划随委托走；方向不同的单子取不到；调用方自己传的计划优先', () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    publishAddSizingPlan('ETHUSDT', plan());
    // 空单取不到多头的计划
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ side: 'SHORT', type: 'LIMIT', price: 120, priceSelection: 'LIMIT' })); });
    expect(result.current.ordersMap.ETHUSDT[0].addSizingSnapshot).toBeUndefined();
    expect(getAddSizingPlan()).not.toBeNull();
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 90, priceSelection: 'LIMIT' })); });
    const limit = result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG')!;
    // 限价单的下单参考价是委托价本身
    expect(limit.addSizingSnapshot).toEqual({ ...plan(), at: T0, s2AtOrder: 90 });
    expect(getAddSizingPlan()).toBeNull();

    // 调用方自己传的计划优先；没带 s2AtOrder 就补上这张单的委托价，带了就不动
    const own: AddSizingSnapshot = { ...plan({ s1: 95 }), at: T0 - 1 };
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 91, priceSelection: 'LIMIT', addSizingSnapshot: own })); });
    expect(result.current.ordersMap.ETHUSDT.find(o => o.price === 91)!.addSizingSnapshot).toEqual({ ...own, s2AtOrder: 91 });
    const stamped: AddSizingSnapshot = { ...own, s2AtOrder: 88 };
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 92, priceSelection: 'LIMIT', addSizingSnapshot: stamped })); });
    expect(result.current.ordersMap.ETHUSDT.find(o => o.price === 92)!.addSizingSnapshot).toEqual(stamped);
  });

  it('【回归 · 复审】条件委托：下单参考价是触发价；计划的结算方式与单子不同就不钉', () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    // 币本位的计划不钉在 U 本位的单子上：那是另一张合约
    publishAddSizingPlan('ETHUSDT', plan({ settlement: 'coin', gUnit: 'ETH', contracts: 10 }));
    act(() => {
      result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'CONDITIONAL', stopPrice: 120, priceSelection: 'MARKET' }));
    });
    expect(result.current.ordersMap.ETHUSDT[0].addSizingSnapshot).toBeUndefined();
    expect(getAddSizingPlan('ETHUSDT')).not.toBeNull();

    publishAddSizingPlan('ETHUSDT', plan());
    act(() => {
      result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'CONDITIONAL', stopPrice: 121, priceSelection: 'MARKET' }));
    });
    const breakout = result.current.ordersMap.ETHUSDT.find(o => o.stopPrice === 121)!;
    expect(breakout.addSizingSnapshot).toEqual({ ...plan(), at: T0, s2AtOrder: 121 });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
  });

  it('【回归 · 复审】加仓没能并进旧仓（杠杆不同）：这一笔自己成了一个仓位，平仓记录仍带着它的计划', () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ leverage: 5 })); });
    publishAddSizingPlan('ETHUSDT', plan());
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ leverage: 10, quantity: 3, inputAmount: 3 })); });
    const open = result.current.positionsMap.ETHUSDT;
    expect(open).toHaveLength(2);
    const add = open.find(p => p.leverage === 10)!;
    expect(add.addSizingSnapshot).toEqual({ ...plan(), at: T0, s2AtOrder: 100 });
    // 单笔仓位：buildCloseRecords 走仓位级的字段
    expect(add.fills ?? []).toHaveLength(add.fills ? 1 : 0);
    const addIndex = open.indexOf(add);
    act(() => { result.current.handleClosePosition('ETHUSDT', addIndex, 1); });
    const records = result.current.tradeHistory.filter(r => r.symbol === 'ETHUSDT' && r.action === 'CLOSE');
    expect(records).toHaveLength(1);
    expect(records[0].leverage).toBe(10);
    expect(records[0].addSizingSnapshot).toEqual({ ...plan(), at: T0, s2AtOrder: 100 });
    // 主力那条仓位没有计划
    const mainIndex = result.current.positionsMap.ETHUSDT.findIndex(p => p.leverage === 5);
    act(() => { result.current.handleClosePosition('ETHUSDT', mainIndex, 1); });
    const main = result.current.tradeHistory.find(r => r.symbol === 'ETHUSDT' && r.action === 'CLOSE' && r.leverage === 5)!;
    expect(main.addSizingSnapshot).toBeUndefined();
  });
});

describe('市价加仓成交后的复判', () => {
  it('首笔开仓静默；同向加仓超限 → 消息中心一条 warning，写成交价 / 参考价 / 滑点 / 超出量；单子照旧成交', () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong()); });
    expect(warnings()).toHaveLength(0);

    // 盘口对冲线：主多的空头条件单挂在 105（亏损侧）
    act(() => {
      result.current.handlePlaceOrder('ETHUSDT', marketLong({
        side: 'SHORT', type: 'CONDITIONAL', stopPrice: 105, priceSelection: 'MARKET', quantity: 10, inputAmount: 10,
      }));
    });
    expect(result.current.ordersMap.ETHUSDT.some(o => o.side === 'SHORT' && o.stopPrice === 105)).toBe(true);

    // 价格到 110，计算器给出上限 ≈ 9.96 币的计划；加仓 30 币：Y₁ = 10 × (105 − 100.01) ≈ 49.9，每币险 ≈ 5.01，30 币远超
    act(() => { result.current.setPriceMap({ ETHUSDT: 110 }); });
    publishAddSizingPlan('ETHUSDT', plan());
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 30, inputAmount: 30, latestPrice: 110 })); });
    const position = result.current.positionsMap.ETHUSDT[0];
    expect(position.fills).toHaveLength(2);
    expect(position.quantity).toBeCloseTo(40, 9);
    const warn = warnings();
    expect(warn).toHaveLength(1);
    expect(warn[0].title).toMatch(/^加仓成交后复判：超出 Plan B 上限 \+\d+\.\d\d%$/);
    // 成交 = 110 × (1 + 0.0001 + 3,300/5e9) = 110.01107
    expect(warn[0].description).toContain('ETHUSDT 多：成交 110.0111，参考价 110.0000，滑点 +0.01%');
    expect(warn[0].description).toMatch(/按成交价上限 9\.9\d ETH，实际加 30，超出 20\.0\d ETH/);
    expect(warn[0].description).toContain('实际加 30');
    expect(warn[0].description).toContain('减掉这么多即回到上限之内');
    expect(warn[0].description).toContain('S₁ 105.0000（盘口对冲线）');
    // 量本身超了计划（9.96 → 30），不拿滑点顶罪
    expect(warn[0].description).toContain('实际加仓比计算器的上限多');
    expect(warn[0].description).not.toContain('全部来自成交滑点');
  });

  it('同向加仓在上限之内：不发消息', () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong()); });
    act(() => {
      result.current.handlePlaceOrder('ETHUSDT', marketLong({
        side: 'SHORT', type: 'CONDITIONAL', stopPrice: 105, priceSelection: 'MARKET', quantity: 10, inputAmount: 10,
      }));
    });
    act(() => { result.current.setPriceMap({ ETHUSDT: 110 }); });
    publishAddSizingPlan('ETHUSDT', plan());
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 5, inputAmount: 5, latestPrice: 110 })); });
    expect(result.current.positionsMap.ETHUSDT[0].quantity).toBeCloseTo(15, 9);
    expect(warnings()).toHaveLength(0);
  });

  it('【回归 · 复审】没带计划的同向加仓不判：超了也静默（不是计算器授权的加仓，Legs 另判）', () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong()); });
    act(() => {
      result.current.handlePlaceOrder('ETHUSDT', marketLong({
        side: 'SHORT', type: 'CONDITIONAL', stopPrice: 105, priceSelection: 'MARKET', quantity: 10, inputAmount: 10,
      }));
    });
    act(() => { result.current.setPriceMap({ ETHUSDT: 110 }); });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 30, inputAmount: 30, latestPrice: 110 })); });
    expect(result.current.positionsMap.ETHUSDT[0].quantity).toBeCloseTo(40, 9);
    expect(warnings()).toHaveLength(0);
  });

  it('【回归 · 复审】对冲侧加码：计算器的计划是多头的，市价给对冲加空 5 静默，计划也不被空单拿走', () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    // 主多 10，市价对冲空 10（静默），多头突破条件单 @120 带着计划
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong()); });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ side: 'SHORT' })); });
    publishAddSizingPlan('ETHUSDT', plan({ s1: 120 }));
    act(() => {
      result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'CONDITIONAL', stopPrice: 120, priceSelection: 'MARKET' }));
    });
    expect(warnings()).toHaveLength(0);
    // 给对冲加码：市价空 5——空头侧没有计划
    publishAddSizingPlan('ETHUSDT', plan({ s1: 120 }));
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ side: 'SHORT', quantity: 5, inputAmount: 5 })); });
    const shorts = result.current.positionsMap.ETHUSDT.filter(p => p.side === 'SHORT');
    expect(shorts.reduce((s, p) => s + p.quantity, 0)).toBeCloseTo(15, 9);
    expect(warnings()).toHaveLength(0);
    // 多头计划没被空单拿走，仍在
    expect(getAddSizingPlan('ETHUSDT')).not.toBeNull();
    expect(shorts.every(p => !p.addSizingSnapshot)).toBe(true);
  });

  it('【回归 · 复审】第二条主力腿（镜像腿）没开计算器：对冲线 95 在成本线亏损侧、按 Plan B 上限为 0，也不发「超出上限」', () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    act(() => {
      result.current.handlePlaceOrder('ETHUSDT', marketLong({
        side: 'SHORT', type: 'CONDITIONAL', stopPrice: 95, priceSelection: 'MARKET', quantity: 25, inputAmount: 25,
      }));
    });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong()); });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 15, inputAmount: 15 })); });
    expect(result.current.positionsMap.ETHUSDT[0].quantity).toBeCloseTo(25, 9);
    expect(warnings()).toHaveLength(0);
  });

  it('【回归 · 复审】计算后价格变了：计划按 110 定，十分钟后 113 市价加 9——记录带着下单参考价 113，复判与 Legs 都说价格变动，不说滑点', () => {
    const { result } = mount();
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong()); });
    act(() => {
      result.current.handlePlaceOrder('ETHUSDT', marketLong({
        side: 'SHORT', type: 'CONDITIONAL', stopPrice: 105, priceSelection: 'MARKET', quantity: 10, inputAmount: 10,
      }));
    });
    // 计算器在 110 给出的市价计划：Y₁ = 10 × (105 − 100.01) = 49.9，S₂′ ≈ 110.011 → 上限 9.958
    const main = result.current.positionsMap.ETHUSDT[0];
    const cov = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'usdt', sBar: main.entryPrice, s1: 105, s2: 110, x1: main.quantity, g: 0 })!;
    const sized = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'usdt', coverage: cov.available, s1: 105, s2Ref: 110, orderKind: 'market' })!;
    const calcPlan = plan({ s2Fill: sized.s2Fill, slippagePct: sized.slippagePct, addCoinsMax: sized.addCoinsMax, sBar: main.entryPrice, x1: main.quantity });
    publishAddSizingPlan('ETHUSDT', calcPlan);
    // 十分钟后（保鲜期内）价到 113，市价加 9：按计划的 110 不超，按下单时的 113 超
    vi.setSystemTime(T0 + 10 * 60_000);
    act(() => { result.current.setPriceMap({ ETHUSDT: 113 }); });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 9, inputAmount: 9, latestPrice: 113 })); });
    const merged = result.current.positionsMap.ETHUSDT.find(p => p.side === 'LONG')!;
    const addFill = merged.fills![1];
    expect(addFill.entryPrice).toBeCloseTo(calcSlippage(113, 9 * 113, 'LONG'), 9);
    expect(addFill.addSizingSnapshot).toEqual({ ...calcPlan, at: T0, s2AtOrder: 113 });

    const warn = warnings();
    expect(warn).toHaveLength(1);
    expect(warn[0].description).toContain('滑点 +0.01%');
    expect(warn[0].description).toContain('超出来自计算后的价格变动 +2.73%');
    expect(warn[0].description).not.toContain('全部来自成交滑点');

    // 平仓 → 记录带着计划 → Legs 校验同样归因为价格变动
    act(() => { result.current.handleClosePosition('ETHUSDT', result.current.positionsMap.ETHUSDT.indexOf(merged), 1); });
    const records = result.current.tradeHistory.filter(r => r.symbol === 'ETHUSDT' && r.action === 'CLOSE' && r.side === 'LONG');
    const mainRecord = records.find(r => r.fillId === merged.fills![0].id)!;
    const addRecord = records.find(r => r.fillId === addFill.id)!;
    expect(addRecord.addSizingSnapshot).toEqual({ ...calcPlan, at: T0, s2AtOrder: 113 });
    expect(mainRecord.addSizingSnapshot).toBeUndefined();
    const iso = (ms: number) => new Date(ms).toISOString();
    const legOf = (id: string, role: TradeJournal['leg_role'], record: TradeRecord, openAt: number, seq: number) => ({
      id, user_id: 'u', trade_record_id: record.id, campaign_id: 'c', leg_role: role, leg_sequence: seq,
      source: 'retroactive_from_record', symbol: 'ETHUSDT', direction: 'long', leverage: 10, position_mode: 'isolated',
      order_kind: 'main', pre_simulated_time: iso(openAt), pre_entry_price: record.entryPrice,
      pre_position_size: record.quantity * record.entryPrice,
      created_at: '2026-09-15T00:00:00.000Z', updated_at: '2026-09-15T00:00:00.000Z',
    }) as unknown as TradeJournal;
    const addAt = SIM0 + 60_000;
    const verdict = evaluateCampaignAddSizing({
      legs: [legOf('main', 'main_open', mainRecord, SIM0, 1), legOf('add1', 'main_add_1', addRecord, addAt, 2)],
      tradeRecords: [
        { ...mainRecord, openTime: SIM0, closeTime: addAt + 60_000 },
        { ...addRecord, openTime: addAt, closeTime: addAt + 60_000 },
      ],
      reverseHedgeOrders: [{ id: 'h', side: 'SHORT', price: 105, createdAt: SIM0, cancelledAt: null, status: 'pending' }],
    }).get('add1')!;
    expect(verdict.status).toBe('fail');
    expect(verdict.s1).toBe(105);
    expect(verdict.maxAllowedCoins!).toBeCloseTo(49.9 / (addFill.entryPrice - 105), 3);
    expect(verdict.excess?.cause).toBe('price_drift');
    expect(verdict.withinSnapshotLimit).toBe(false);
    // 括号里的滑点是相对这张单自己的下单价 113，只有 +0.01%
    expect(verdict.fillSlippagePct).toBeCloseTo((addFill.entryPrice / 113 - 1) * 100, 9);
    const lines = addSizingSnapshotLines(verdict)!;
    expect(lines.order).toBe('下单时 参考价 113.0000（计算后价格变动 +2.73%）');
    expect(lines.actual).toContain('（+0.01%）');
    expect(lines.slippage).toBeNull();
    expect(lines.cause).toContain('超出来自计算后的价格变动 +2.73%');
  });
});

/**
 * 二审（流程）：计划的生命周期。
 *   · 下单面板在点「开多」那一刻取好计划放进参数：下单入口用它、只消费同一份，哪怕下单前快照填了半小时、仓库里那份已过保鲜期；
 *   · 撤掉带计划的限价 / 条件单（手动、或成交时保证金不足被撤）：计划仍在保鲜期且没有更新的计划就放回去，
 *     紧接着追价的市价单还带得上、成交后照样复判。
 */
describe('【回归 · 二审】计划的生命周期：点按钮时取、同一份才消费、撤单放回', () => {
  const setup = () => {
    const view = mount();
    const { result } = view;
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong()); });
    act(() => {
      result.current.handlePlaceOrder('ETHUSDT', marketLong({
        side: 'SHORT', type: 'CONDITIONAL', stopPrice: 105, priceSelection: 'MARKET', quantity: 10, inputAmount: 10,
      }));
    });
    act(() => { result.current.setPriceMap({ ETHUSDT: 110 }); });
    return view;
  };

  it('决策模式：点「开多」时取到的计划 31 分钟后才提交——照样钉上、照样复判，仓库里同一份被消费', () => {
    const { result } = setup();
    publishAddSizingPlan('ETHUSDT', plan({ addCoinsMax: 9.96 }));
    const captured = getAddSizingPlan('ETHUSDT')!.snapshot;
    // 下单前快照填了 31 分钟：仓库里那份已过保鲜期，到这里再取就取不到了
    vi.setSystemTime(T0 + 31 * 60_000);
    act(() => {
      result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 30, inputAmount: 30, latestPrice: 110, addSizingSnapshot: captured }));
    });
    const add = result.current.positionsMap.ETHUSDT.find(p => p.side === 'LONG')!.fills![1];
    expect(add.addSizingSnapshot).toEqual({ ...captured, s2AtOrder: 110 });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
    const warn = warnings();
    expect(warn).toHaveLength(1);
    expect(warn[0].title).toMatch(/^加仓成交后复判：超出 Plan B 上限/);
  });

  it('带来的计划只消费同一份：关弹窗续期换了对象、内容没变，仍算同一份；仓库里已是不同的新计划就不动', () => {
    const { result } = setup();
    publishAddSizingPlan('ETHUSDT', plan());
    const captured = getAddSizingPlan('ETHUSDT')!.snapshot;
    vi.setSystemTime(T0 + 60_000);
    touchAddSizingPlan('ETHUSDT');
    expect(getAddSizingPlan('ETHUSDT')!.snapshot).not.toBe(captured);
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 1, inputAmount: 1, latestPrice: 110, addSizingSnapshot: captured })); });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();

    publishAddSizingPlan('ETHUSDT', plan({ s1: 104 }));
    const newer = getAddSizingPlan('ETHUSDT')!.snapshot;
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 1, inputAmount: 1, latestPrice: 110, addSizingSnapshot: captured })); });
    expect(getAddSizingPlan('ETHUSDT')!.snapshot).toBe(newer);
  });

  it('撤掉带计划的限价单：计划放回（去掉那张单的 s2AtOrder、保鲜期不续）；价到 111 追一张市价 9.97——带着计划、成交后复判超限', () => {
    const { result } = setup();
    publishAddSizingPlan('ETHUSDT', plan({ orderKind: 'limit', s2Fill: 110, slippagePct: 0, addCoinsMax: 9.97 }));
    const original = getAddSizingPlan('ETHUSDT')!.snapshot;
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 110, priceSelection: 'LIMIT', quantity: 9.97, inputAmount: 9.97 })); });
    const limit = result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG' && o.type === 'LIMIT')!;
    expect(limit.addSizingSnapshot).toEqual({ ...original, s2AtOrder: 110 });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();

    vi.setSystemTime(T0 + 5 * 60_000);
    act(() => { result.current.setPriceMap({ ETHUSDT: 111 }); });
    act(() => { result.current.handleCancelOrder('ETHUSDT', limit.id); });
    const restored = getAddSizingPlan('ETHUSDT')!;
    expect(restored.snapshot).toEqual(original);
    expect(restored.snapshot.at).toBe(T0);
    expect('s2AtOrder' in restored.snapshot).toBe(false);
    expect(restored.prefill).toBeNull();

    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 9.97, inputAmount: 9.97, latestPrice: 111 })); });
    const add = result.current.positionsMap.ETHUSDT.find(p => p.side === 'LONG')!.fills![1];
    expect(add.addSizingSnapshot).toEqual({ ...original, s2AtOrder: 111 });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
    const warn = warnings();
    expect(warn).toHaveLength(1);
    // Y₁ 49.9 ÷ (111.0111 − 105) ≈ 8.30 币，加了 9.97
    expect(warn[0].description).toMatch(/按成交价上限 8\.3\d* ETH，实际加 9\.97/);
    // 计划按限价 110 定、这张在 111 市价成交：归因是下单价偏离计划，不是滑点
    expect(warn[0].description).toContain('超出来自下单价偏离计划挂单价 +0.91%');
  });

  it('撤单时不放回：仓库里已有同样新或更新的计划（不覆盖）；计划已过保鲜期', () => {
    const { result } = setup();
    publishAddSizingPlan('ETHUSDT', plan({ orderKind: 'limit', s2Fill: 110, slippagePct: 0 }));
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 109, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1 })); });
    const first = result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG' && o.price === 109)!;
    vi.setSystemTime(T0 + 60_000);
    publishAddSizingPlan('ETHUSDT', plan({ s1: 104 }));
    const newer = getAddSizingPlan('ETHUSDT')!.snapshot;
    act(() => { result.current.handleCancelOrder('ETHUSDT', first.id); });
    expect(getAddSizingPlan('ETHUSDT')!.snapshot).toBe(newer);

    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 108, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1 })); });
    const second = result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG' && o.price === 108)!;
    expect(second.addSizingSnapshot).toMatchObject({ s1: 104, at: T0 + 60_000 });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
    vi.setSystemTime(T0 + 60_000 + 31 * 60_000);
    act(() => { result.current.handleCancelOrder('ETHUSDT', second.id); });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
  });

  it('成交时保证金不足被自动撤掉的计划单：计划同样放回', () => {
    const { result } = setup();
    publishAddSizingPlan('ETHUSDT', plan({ orderKind: 'limit', s2Fill: 110, slippagePct: 0 }));
    const original = getAddSizingPlan('ETHUSDT')!.snapshot;
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 110, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1 })); });
    const limit = result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG' && o.type === 'LIMIT')!;
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
    let ok = true;
    act(() => { ok = result.current.settleFillDebit('ETHUSDT', limit, 1e12, 1, SIM0 + 60_000); });
    expect(ok).toBe(false);
    expect(getAddSizingPlan('ETHUSDT')!.snapshot).toEqual(original);
  });

  it('撤单时这个标的已没有同向仓位（停止回放先平掉全部仓位、再撤全部挂单）：计划不放回，保证金不足被撤同理', () => {
    const { result } = setup();
    publishAddSizingPlan('ETHUSDT', plan({ orderKind: 'limit', s2Fill: 110, slippagePct: 0 }));
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 109, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1 })); });
    publishAddSizingPlan('ETHUSDT', plan({ orderKind: 'limit', s2Fill: 108, slippagePct: 0, s1: 104 }));
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 108, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1 })); });
    const [first, second] = [109, 108].map(px => result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG' && o.price === px)!);
    expect(first.addSizingSnapshot).toBeTruthy();
    expect(second.addSizingSnapshot).toMatchObject({ s1: 104 });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();

    // 与 Index 的 handleStop 同一顺序：先平仓，再撤单
    const longIndex = result.current.positionsMap.ETHUSDT.findIndex(p => p.side === 'LONG');
    act(() => { result.current.handleClosePosition('ETHUSDT', longIndex); });
    expect(result.current.positionsMap.ETHUSDT.some(p => p.side === 'LONG')).toBe(false);
    act(() => { result.current.handleCancelOrder('ETHUSDT', first.id); });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
    let ok = true;
    act(() => { ok = result.current.settleFillDebit('ETHUSDT', second, 1e12, 1, SIM0 + 60_000); });
    expect(ok).toBe(false);
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
  });

  /**
   * 【回归 · 三审】撤单放回只认当前这一场、当前这条仓位。
   * 跳到信号时刻：持仓与挂单带进新的一场（Index.handleJumpToSignal：先分叉、再清计划、再改钟）。
   * 那张旧限价单钉着上一场的计划；撤掉它若放回，下一笔没开计算器的市价加仓就会带上它，
   * 复判拿上一场的 S₂ 105.5 解释一笔 250 的成交，重开计算器还会种回上一场的 S₁ / 限价。
   */
  it('【回归 · 三审】跳到信号时刻带过来的旧挂单：撤掉不放回上一场的计划（先分叉未清也不放回）；之后没开计算器的加仓不带计划、不复判', () => {
    const { result } = setup();
    const limitPlan = plan({ orderKind: 'limit', s2Ref: 105.5, s2Fill: 105.5, slippagePct: 0, addCoinsMax: 99.8 });
    publishAddSizingPlan('ETHUSDT', limitPlan);
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 105.5, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1 })); });
    publishAddSizingPlan('ETHUSDT', { ...limitPlan, s1: 104 });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 105, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1 })); });
    const [first, second] = [105.5, 105].map(px => result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG' && o.price === px)!);
    expect(first.addSizingSnapshot).toMatchObject({ at: T0, s2AtOrder: 105.5 });
    expect(second.addSizingSnapshot).toMatchObject({ at: T0, s1: 104 });
    const placedOn = first.createdTimelineId;
    expect(placedOn).toBeTruthy();
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();

    // 分叉：持仓与挂单都还在，时间线换了
    vi.setSystemTime(T0 + 60_000);
    const JUMP = SIM0 + 6 * 3_600_000;
    act(() => { result.current.forkReplayTimeline('ETHUSDT', 'jump', JUMP); });
    expect(result.current.getTimelineId('ETHUSDT')).not.toBe(placedOn);
    // 只看时间线这一道：还没清计划（没有分场水位）就撤，也不放回。Index 里分叉与清计划在同一个同步处理里紧挨着，
    // 这一步在应用里走不到；这里单独验证跳转分出的时间线不算同一场（翻转方向才算，见下一条）
    act(() => { result.current.handleCancelOrder('ETHUSDT', first.id); });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();

    // Index 的顺序：分叉 → 清计划 → 改钟；价到 250
    act(() => {
      clearAddSizingPlan();
      result.current.sim.startSimulation(JUMP);
      result.current.setPriceMap({ ETHUSDT: 250 });
    });
    expect(result.current.positionsMap.ETHUSDT.some(p => p.side === 'LONG' && isPositionOpen(p))).toBe(true);
    act(() => { result.current.handleCancelOrder('ETHUSDT', second.id); });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();

    // 这一场没开计算器的市价加仓：不带计划，复判静默
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 1, inputAmount: 1, latestPrice: 250 })); });
    const long = result.current.positionsMap.ETHUSDT.find(p => p.side === 'LONG')!;
    expect(long.fills).toHaveLength(2);
    expect(long.fills![1].addSizingSnapshot).toBeUndefined();
    expect(warnings()).toHaveLength(0);

    // 这一场自己算、自己挂的计划单：撤掉照常放回
    vi.setSystemTime(T0 + 2 * 60_000);
    publishAddSizingPlan('ETHUSDT', plan({ orderKind: 'limit', s2Ref: 240, s2Fill: 240, slippagePct: 0, addCoinsMax: 0.37 }));
    const fresh = getAddSizingPlan('ETHUSDT')!.snapshot;
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 240, priceSelection: 'LIMIT', quantity: 0.3, inputAmount: 0.3, latestPrice: 250 })); });
    const own = result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG' && o.price === 240)!;
    expect(own.createdTimelineId).toBe(result.current.getTimelineId('ETHUSDT'));
    act(() => { result.current.handleCancelOrder('ETHUSDT', own.id); });
    expect(getAddSizingPlan('ETHUSDT')?.snapshot).toEqual(fresh);
  });

  /**
   * 【回归 · 四审】正放 ↔ 倒放翻转不是分场：翻转会分出一条 direction 时间线，但仓位、挂单、仓库里的计划都原样带过去
   * （setTimeDirection 不清计划）。翻转前挂的计划单翻转后撤掉，计划照样放回——否则追价的那张单没有计划：
   * 成交后不复判，Legs 也没有「计算时」。翻转之后钟被拨回（兜底 implicit 时间线）才是新的一场。
   */
  it('【回归 · 四审】翻转播放方向后撤掉翻转前的计划单：计划照样放回（来回翻两次、保证金不足被撤都一样）；翻转后钟被拨回就不放回', () => {
    const { result } = setup();
    const limitPlan = plan({ orderKind: 'limit', s2Ref: 105.5, s2Fill: 105.5, slippagePct: 0, addCoinsMax: 99.8 });
    publishAddSizingPlan('ETHUSDT', limitPlan);
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 105.5, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1 })); });
    publishAddSizingPlan('ETHUSDT', { ...limitPlan, s1: 104 });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 105, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1 })); });
    const [first, second] = [105.5, 105].map(px => result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG' && o.price === px)!);
    expect(first.addSizingSnapshot).toMatchObject({ at: T0, s2AtOrder: 105.5 });
    expect(second.addSizingSnapshot).toMatchObject({ at: T0, s1: 104 });
    const placedOn = first.createdTimelineId;
    expect(placedOn).toBeTruthy();
    // 仓库里另留一份没下出去的计划
    vi.setSystemTime(T0 + 30_000);
    publishAddSizingPlan('ETHUSDT', plan({ s1: 103 }));

    // 翻到倒放：时间线换了，仓位、两张挂单、仓库里的计划都还在
    vi.setSystemTime(T0 + 60_000);
    act(() => { result.current.setTimeDirection(-1); });
    const reversed = result.current.getTimelineId('ETHUSDT');
    expect(reversed).not.toBe(placedOn);
    expect(result.current.positionsMap.ETHUSDT.some(p => p.side === 'LONG' && isPositionOpen(p))).toBe(true);
    expect(result.current.ordersMap.ETHUSDT.map(o => o.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(getAddSizingPlan('ETHUSDT')?.snapshot).toMatchObject({ s1: 103, at: T0 + 30_000 });
    // 仓库里的计划翻转后照样钉到下一笔加仓上
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 1, inputAmount: 1, latestPrice: 110 })); });
    expect(result.current.positionsMap.ETHUSDT.find(p => p.side === 'LONG')!.fills![1].addSizingSnapshot).toMatchObject({ s1: 103 });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();

    // 翻转前挂的计划单翻转后撤掉：放回，追价的市价单带得上
    act(() => { result.current.handleCancelOrder('ETHUSDT', first.id); });
    expect(getAddSizingPlan('ETHUSDT')?.snapshot).toEqual({ ...limitPlan, at: T0 });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 1, inputAmount: 1, latestPrice: 110 })); });
    expect(result.current.positionsMap.ETHUSDT.find(p => p.side === 'LONG')!.fills![2].addSizingSnapshot)
      .toEqual({ ...limitPlan, at: T0, s2AtOrder: 110 });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();

    // 再翻回正放（隔了两条 direction 时间线）：保证金不足被撤，照样放回
    vi.setSystemTime(T0 + 90_000);
    act(() => { result.current.setTimeDirection(1); });
    expect(result.current.getTimelineId('ETHUSDT')).not.toBe(reversed);
    let ok = true;
    act(() => { ok = result.current.settleFillDebit('ETHUSDT', second, 1e12, 1, SIM0 + 60_000); });
    expect(ok).toBe(false);
    expect(getAddSizingPlan('ETHUSDT')?.snapshot).toEqual({ ...limitPlan, s1: 104, at: T0 });

    // 这一份在这条 direction 时间线上重新挂出；之后钟被拨回、却没有显式分叉——那是新的一场，撤掉不放回
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 104.5, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1, latestPrice: 110 })); });
    const third = result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG' && o.price === 104.5)!;
    expect(third.addSizingSnapshot).toMatchObject({ at: T0, s1: 104, s2AtOrder: 104.5 });
    expect(third.createdTimelineId).toBe(result.current.getTimelineId('ETHUSDT'));
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
    vi.setSystemTime(T0 + 150_000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    act(() => { result.current.sim.startSimulation(SIM0 - 6 * 3_600_000); });
    act(() => { result.current.handleCancelOrder('ETHUSDT', third.id); });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('implicit'), expect.anything());
    warn.mockRestore();
    expect(result.current.getTimelineId('ETHUSDT')).not.toBe(third.createdTimelineId);
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
  });

  /**
   * 【回归 · 三审】平掉又重开是新的持仓周期：上一周期挂的计划单撤掉时，同方向虽然又有仓位，
   * 那条仓位却晚于计划开出——计划不是给它的（与计算器重新打开时的 planSeedOnOpen 同一条规则）。
   */
  it('【回归 · 三审】平掉又重开之后撤掉上一周期的计划单：不放回（手动撤单、保证金不足被撤都一样）；之后没开计算器的加仓不带计划、不复判', () => {
    const { result } = setup();
    publishAddSizingPlan('ETHUSDT', plan({ orderKind: 'limit', s2Ref: 105.5, s2Fill: 105.5, slippagePct: 0, addCoinsMax: 99.8 }));
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 105.5, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1 })); });
    publishAddSizingPlan('ETHUSDT', plan({ orderKind: 'limit', s2Ref: 105, s2Fill: 105, slippagePct: 0, s1: 104 }));
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 105, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1 })); });
    const [first, second] = [105.5, 105].map(px => result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG' && o.price === px)!);
    expect(first.addSizingSnapshot).toMatchObject({ at: T0, x1: 10, sBar: 100.01 });
    expect(second.addSizingSnapshot).toMatchObject({ at: T0, s1: 104 });

    // 平掉整条多头；两分钟后没开计算器，在 120 重新开 5 个
    const longIndex = result.current.positionsMap.ETHUSDT.findIndex(p => p.side === 'LONG');
    act(() => { result.current.handleClosePosition('ETHUSDT', longIndex); });
    expect(result.current.positionsMap.ETHUSDT.some(p => p.side === 'LONG')).toBe(false);
    vi.setSystemTime(T0 + 2 * 60_000);
    act(() => { result.current.setPriceMap({ ETHUSDT: 120 }); });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 5, inputAmount: 5, latestPrice: 120 })); });
    const reopened = result.current.positionsMap.ETHUSDT.find(p => p.side === 'LONG')!;
    expect(reopened.openedRealAt).toBe(T0 + 2 * 60_000);
    expect(reopened.addSizingSnapshot).toBeUndefined();
    // 同一条时间线、仍在保鲜期、没有更新的计划——只因为仓位是新的一轮，不放回
    expect(first.createdTimelineId).toBe(result.current.getTimelineId('ETHUSDT'));

    act(() => { result.current.handleCancelOrder('ETHUSDT', first.id); });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
    let ok = true;
    act(() => { ok = result.current.settleFillDebit('ETHUSDT', second, 1e12, 1, SIM0 + 60_000); });
    expect(ok).toBe(false);
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();

    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ quantity: 2, inputAmount: 2, latestPrice: 120 })); });
    const long = result.current.positionsMap.ETHUSDT.find(p => p.side === 'LONG')!;
    expect(long.fills).toHaveLength(2);
    expect(long.fills![1].addSizingSnapshot).toBeUndefined();
    expect(warnings()).toHaveLength(0);
  });

  it('没带计划的委托撤掉：仓库不变', () => {
    const { result } = setup();
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong({ type: 'LIMIT', price: 109, priceSelection: 'LIMIT', quantity: 1, inputAmount: 1 })); });
    const bare = result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG' && o.price === 109)!;
    expect(bare.addSizingSnapshot).toBeUndefined();
    act(() => { result.current.handleCancelOrder('ETHUSDT', bare.id); });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
  });
});

/**
 * 【回归 · 三审】条件委托触发后在触发价上按 Taker 滑点成交。复判入口挂在 context 上，Index 的条件单触发与后台撮合
 * 在建仓之后、合并之前调它（参考价 = 触发价，heldBefore = 合并前的持仓）；挂单 / 成交历史读 context 自己的 ref。
 * 另：彻底清除一个标的的数据时，计算器的计划一并清掉，不留给下一场。
 */
describe('【回归 · 三审】条件单触发后的复判入口；清除标的数据时清掉计划', () => {
  const setup = () => {
    const view = mount();
    const { result } = view;
    act(() => { result.current.setPriceMap({ ETHUSDT: 100 }); result.current.sim.startSimulation(SIM0); });
    act(() => { result.current.handlePlaceOrder('ETHUSDT', marketLong()); });
    act(() => {
      result.current.handlePlaceOrder('ETHUSDT', marketLong({
        side: 'SHORT', type: 'CONDITIONAL', stopPrice: 105, priceSelection: 'MARKET', quantity: 10, inputAmount: 10,
      }));
    });
    act(() => { result.current.setPriceMap({ ETHUSDT: 110 }); });
    return view;
  };

  it('按「限价 @S₂」定量的突破条件单（112）触发：与 Index 同一顺序（建仓 → 复判 → 合并），按触发价复判，超限进消息中心、S₁ 读盘口线', () => {
    const { result } = setup();
    // Y₁ = 10 × (105 − 100.01) = 49.9 → 限价 112 的上限 49.9 ÷ 7 = 7.1286
    publishAddSizingPlan('ETHUSDT', plan({ orderKind: 'limit', s2Ref: 112, s2Fill: 112, slippagePct: 0, addCoinsMax: 7.1286 }));
    act(() => {
      result.current.handlePlaceOrder('ETHUSDT', marketLong({
        type: 'CONDITIONAL', stopPrice: 112, priceSelection: 'MARKET', quantity: 7.128, inputAmount: 7.128, latestPrice: 110,
      }));
    });
    const order = result.current.ordersMap.ETHUSDT.find(o => o.side === 'LONG' && o.type === 'CONDITIONAL')!;
    expect(order.addSizingSnapshot).toMatchObject({ orderKind: 'limit', s2Fill: 112, s2AtOrder: 112 });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();

    const heldBefore = result.current.positionsMap.ETHUSDT.filter(isPositionOpen);
    const { position } = executeSettlementFill('ETHUSDT', 112, order, false, SIM0 + 60_000, Date.now());
    // 触发后吃单：成交价高于触发价 → 在它上面的上限 49.9 ÷ 7.0112 = 7.117 < 7.128
    expect(position.entryPrice).toBeCloseTo(calcSlippage(112, 7.128 * 112, 'LONG'), 9);
    act(() => { result.current.judgePlannedAddFill('ETHUSDT', heldBefore, position, 112, order.addSizingSnapshot); });
    const warn = warnings();
    expect(warn).toHaveLength(1);
    expect(warn[0].title).toMatch(/^加仓成交后复判：超出 Plan B 上限 \+0\.1\d%$/);
    expect(warn[0].description).toContain('参考价 112.0000');
    expect(warn[0].description).toContain('S₁ 105.0000（盘口对冲线）');
    expect(warn[0].description).toContain('超出部分全部来自成交滑点');
    expect(warn[0].description).toContain('「条件单 @S₂」档定量');

    // 没有计划、首笔开仓（成交前没有同向仓位）：什么都不做
    act(() => { result.current.judgePlannedAddFill('ETHUSDT', heldBefore, position, 112, null); });
    act(() => {
      result.current.judgePlannedAddFill('ETHUSDT', heldBefore.filter(p => p.side !== 'LONG'), position, 112, order.addSizingSnapshot);
    });
    expect(warnings()).toHaveLength(1);
  });

  it('彻底清除一个标的的数据：这个标的的计划一并清掉，别的标的的计划不动', () => {
    const { result } = setup();
    publishAddSizingPlan('ETHUSDT', plan());
    publishAddSizingPlan('BTCUSDT', plan({ s1: 60_000, s2Ref: 62_000, s2Fill: 62_006 }));
    act(() => { result.current.handleClearSymbolData('ETHUSDT'); });
    expect(getAddSizingPlan('ETHUSDT')).toBeNull();
    expect(getAddSizingPlan('BTCUSDT')).not.toBeNull();
  });
});
