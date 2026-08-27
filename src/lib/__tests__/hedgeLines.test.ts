import { describe, expect, it } from 'vitest';
import {
  evaluateS1Deviation, hedgeSideFor, readHedgeLines, sameLine, PRE_MAIN_LOOKBACK_MS,
} from '@/lib/hedgeLines';
import type { PendingOrder, Position } from '@/types/trading';

/**
 * 事故复现：SCRTUSDT 2026-04-20，已实现 −7930.74。
 * 计算器被喂 S₁=0.114572，盘口上真实挂着的是 0.114401，差 0.149%。
 */
const SBAR = 0.113532, S2 = 0.116993, X1 = 3_991_483.2, G = 32_299.75;
const BOOK = 0.114401, TYPED = 0.114572;
const T0 = Date.parse('2026-04-20T21:41:00Z');

const order = (o: Partial<PendingOrder>): PendingOrder => ({
  id: 'o', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: BOOK,
  quantity: 4_113_437.29, leverage: 5, marginMode: 'isolated',
  status: 'PENDING', createdAt: T0 + 54 * 60_000,
  ...o,
} as PendingOrder);

describe('盘口对冲线', () => {
  it('主多读空单、主空读多单——方向绝不从持仓猜', () => {
    expect(hedgeSideFor('LONG')).toBe('SHORT');
    expect(hedgeSideFor('SHORT')).toBe('LONG');
  });

  it('读出本场那两张 0.114401 的条件空单，触发价取 stopPrice 而不是 price', () => {
    const r = readHedgeLines('SCRTUSDT', {
      SCRTUSDT: [order({ id: 'a' }), order({ id: 'b', quantity: 15_399_836.12 })],
    }, [], 'LONG', T0 - PRE_MAIN_LOOKBACK_MS, 'usdt', 10);
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0].price).toBeCloseTo(BOOK, 6);   // price=0，必须取 stopPrice
    expect(r.candidates.reduce((s, c) => s + c.coins, 0)).toBeCloseTo(19_513_273.41, 2);
  });

  it('上一场战役遗留的挂单被时间窗滤掉——ordersMap 是持久化的，跨会话都活着', () => {
    const r = readHedgeLines('SCRTUSDT', {
      SCRTUSDT: [order({ id: 'old', createdAt: T0 - 86_400_000 }), order({ id: 'now' })],
    }, [], 'LONG', T0 - PRE_MAIN_LOOKBACK_MS, 'usdt', 10);
    expect(r.candidates.map(c => c.id)).toEqual(['now']);
    expect(r.staleCount).toBe(1);
  });

  it('跟踪委托 / TWAP 没有事前确定的线——列出来但不当候选，不能静默丢掉', () => {
    const r = readHedgeLines('SCRTUSDT', {
      SCRTUSDT: [
        order({ id: 't', type: 'TRAILING_STOP' }),          // stopPrice 是激活价不是触发价
        order({ id: 'w', type: 'TWAP', stopPrice: 0 }),     // price/stopPrice 都是 0
        order({ id: 'ok' }),
      ],
    }, [], 'LONG', T0 - PRE_MAIN_LOOKBACK_MS, 'usdt', 10);
    expect(r.candidates.map(c => c.id)).toEqual(['ok']);
    expect(r.unlineable.map(u => u.kind).sort()).toEqual(['TRAILING_STOP', 'TWAP']);
  });

  it('平仓性质的单子不算对冲；但带止盈止损的开仓单要算', () => {
    const r = readHedgeLines('SCRTUSDT', {
      SCRTUSDT: [
        order({ id: 'tp', reduceOnly: true } as Partial<PendingOrder>),
        order({ id: 'sl', linkedPositionId: 'p1' } as Partial<PendingOrder>),
        // *_TP_SL 在本项目里是「限价+勾选止盈止损」组合出的开仓单，没有 reduceOnly
        order({ id: 'open-with-tpsl', type: 'MARKET_TP_SL' }),
      ],
    }, [], 'LONG', T0 - PRE_MAIN_LOOKBACK_MS, 'usdt', 10);
    expect(r.candidates.map(c => c.id)).toEqual(['open-with-tpsl']);
  });

  it('已成交的对冲计入已挂量——触发后订单离开 ordersMap 变成反向持仓', () => {
    const filled = [{ id: 'h', side: 'SHORT', entryPrice: 0.114379, quantity: 4_113_437.29 }] as Position[];
    const r = readHedgeLines('SCRTUSDT', {}, filled, 'LONG', 0, 'usdt', 10);
    expect(r.filledHedgeCoins).toBeCloseTo(4_113_437.29, 2);
  });

  it('同一条线的浮点尾差不算两条线', () => {
    expect(sameLine(BOOK, BOOK * (1 + 1e-9))).toBe(true);
    expect(sameLine(BOOK, TYPED)).toBe(false);
  });
});

describe('S₁ 偏差定价 —— 把 0.149% 翻译成 USDT', () => {
  it('【回归】复现事故的那三个数：应下 13,799,517 / 实下 15,052,198 / 净值 −3,247', () => {
    const d = evaluateS1Deviation({ side: 'LONG', sBar: SBAR, s1: TYPED, s2: S2, x1: X1, g: G, bookPrice: BOOK })!;
    expect(d.shouldAdd).toBeCloseTo(13_799_517, 0);
    // TYPED 是反解值取到 6 位小数的结果，回代会有 0.03% 的残差；
    // 要害是量级（超一百多万币），不是末位。
    expect(d.typedAdd / 15_052_198).toBeCloseTo(1, 3);
    expect(d.excessCoins / 1_252_681).toBeCloseTo(1, 2);
    // 设计意图是 0；实际到线那一刻已经亏三千多（同上，6 位小数的 S₁ 带 0.3% 残差）
    expect(d.netAtBookLine).toBeLessThan(-3_200);
    expect(d.netAtBookLine).toBeGreaterThan(-3_300);
  });

  it('S₁ 与盘口线一致时，到线净值就是设计意图的 0', () => {
    const d = evaluateS1Deviation({ side: 'LONG', sBar: SBAR, s1: BOOK, s2: S2, x1: X1, g: G, bookPrice: BOOK })!;
    expect(d.netAtBookLine).toBeCloseTo(0, 6);
    expect(d.excessCoins).toBeCloseTo(0, 6);
  });

  it('S₁ 填低于盘口线则是少下——净值为正，不是错误但要让用户看见', () => {
    const d = evaluateS1Deviation({ side: 'LONG', sBar: SBAR, s1: 0.114300, s2: S2, x1: X1, g: G, bookPrice: BOOK })!;
    expect(d.excessCoins).toBeLessThan(0);
    expect(d.netAtBookLine).toBeGreaterThan(0);
  });

  it('主空方向整套反过来', () => {
    const d = evaluateS1Deviation({
      side: 'SHORT', sBar: 0.116993, s1: 0.115000, s2: 0.113532, x1: X1, g: G, bookPrice: 0.115200,
    })!;
    expect(d).not.toBeNull();
    expect(Number.isFinite(d.netAtBookLine)).toBe(true);
  });

  it('输入不成立时返回 null，不硬算出一个假数', () => {
    expect(evaluateS1Deviation({ side: 'LONG', sBar: SBAR, s1: TYPED, s2: S2, x1: X1, g: G, bookPrice: 0 })).toBeNull();
    // S₁ 已经越过 S₂：险为负，锁死无从谈起
    expect(evaluateS1Deviation({ side: 'LONG', sBar: SBAR, s1: 0.12, s2: S2, x1: X1, g: G, bookPrice: BOOK })).toBeNull();
  });
});
