import { describe, expect, it } from 'vitest';
import { detectBankedMirrorProfit, evaluatePostAddCostLine, readHeldPosition } from '@/lib/addSizing';
import { mergeFilledPosition } from '@/lib/tradingSettlement';
import type { Position, TradeRecord } from '@/types/trading';

/**
 * 实盘 SAGAUSDT 2026-05-12：同一笔落袋 84,742.24 被两次加仓各花了一遍。
 *   主力 12,053,122.94 币 @0.0447220
 *   镜像止盈 23:19 落袋 +84,742.24            ← G 从这一刻起才存在
 *   加仓1 23:49  30,759,267.56 币 @0.0481123  ← ≈ B 账本给的 30,381,185
 *   加仓2 01:00  29,413,587.27 币 @0.0493925  ← ≈ B 账本又给的 30,843,399（同一个 G）
 */
const T = (iso: string) => Date.parse(iso);
const tp = (closeAt: string, pnl: number): TradeRecord => ({
  symbol: 'SAGAUSDT', side: 'LONG', action: 'CLOSE', exit_method: 'tp1',
  closeTime: T(closeAt), pnl, exitPrice: 0.0494271,
} as unknown as TradeRecord);

const MAIN_OPEN = T('2026-05-12T21:42:00Z');
const HISTORY = [tp('2026-05-12T23:19:00Z', 84_742.24)];

describe('落袋是否已经被花掉', () => {
  it('落袋当下还没有新开仓——第一次加仓可以用 B', () => {
    const positions = [{ side: 'LONG' as const, openTime: MAIN_OPEN }];
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, MAIN_OPEN, positions);
    expect(b.usd).toBeCloseTo(84_742.24, 2);
    expect(b.lastBankedAt).toBe(T('2026-05-12T23:19:00Z'));
    expect(b.addsSinceBanked).toBe(0);
  });

  it('【回归】落袋之后已经加过一笔——第二次不能再原样用同一个 G', () => {
    const positions = [
      { side: 'LONG' as const, openTime: MAIN_OPEN },
      { side: 'LONG' as const, openTime: T('2026-05-12T23:49:00Z') },   // 加仓1
    ];
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, MAIN_OPEN, positions);
    expect(b.addsSinceBanked).toBe(1);
  });

  it('同一刻开出的主仓与镜像不算加仓——数持仓条数会误判', () => {
    // 主仓与镜像是同一刻的两条腿；若按「持仓 > 1 条」判断，第一次加仓就会被误拦。
    const positions = [
      { side: 'LONG' as const, openTime: MAIN_OPEN },
      { side: 'LONG' as const, openTime: MAIN_OPEN },
    ];
    expect(detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, MAIN_OPEN, positions).addsSinceBanked).toBe(0);
  });

  it('反方向的仓位不算数', () => {
    const positions = [{ side: 'SHORT' as const, openTime: T('2026-05-13T00:00:00Z') }];
    expect(detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, MAIN_OPEN, positions).addsSinceBanked).toBe(0);
  });

  it('不传持仓时不做这项判断，行为与旧版一致', () => {
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, MAIN_OPEN);
    expect(b.usd).toBeCloseTo(84_742.24, 2);
    expect(b.addsSinceBanked).toBe(0);
  });

  it('本轮已实现亏损会从镜像止盈扣掉；普通手动平仓盈利不会混入 G', () => {
    const loss = { ...tp('2026-05-13T00:10:00Z', -2_000), exit_method: 'sl' } as TradeRecord;
    const unrelatedProfit = { ...tp('2026-05-13T00:20:00Z', 9_000), exit_method: 'manual' } as TradeRecord;
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', [...HISTORY, loss, unrelatedProfit], MAIN_OPEN);
    expect(b.usd).toBeCloseTo(82_742.24, 2);
    expect(b.count).toBe(1);
    expect(b.lastBankedAt).toBe(T('2026-05-12T23:19:00Z'));
  });

  it('【回归】强平也是已实现亏损：LIQUIDATION 记录同样从 G 扣掉（与 Legs 的 isSettlementRecord 同一判据）', () => {
    const liquidated = { ...tp('2026-05-13T00:10:00Z', -90_000), action: 'LIQUIDATION', exit_method: 'liquidation' } as TradeRecord;
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', [...HISTORY, liquidated], MAIN_OPEN);
    expect(b.usd).toBeCloseTo(84_742.24 - 90_000, 2);
    expect(b.usd).toBeLessThan(0);
    expect(b.count).toBe(1);
  });

  it('亏损在止盈之前也扣——「本轮」不论先后', () => {
    const earlierStop = { ...tp('2026-05-12T21:52:00Z', -300), exit_method: 'sl' } as TradeRecord;
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', [earlierStop, ...HISTORY], MAIN_OPEN);
    expect(b.usd).toBeCloseTo(84_742.24 - 300, 2);
  });
});

describe('加仓后的综合成本线（R0 复核）', () => {
  const X1 = 12_053_122.94, SBAR = 0.0447220, S1 = 0.0453230, S2 = 0.0481123;

  it('【实盘】加仓 3,076 万币之后成本线越过止损线 4.05%', () => {
    const r = evaluatePostAddCostLine({ side: 'LONG', sBar: SBAR, s1: S1, s2: S2, x1: X1, addCoins: 30_759_267.56 })!;
    expect(r.blendedCost).toBeCloseTo(0.0471578, 7);
    expect(r.pastStop).toBe(true);
    expect(r.overshootPct).toBeCloseTo(4.05, 1);
  });

  it('只加 A 账本的量时，成本线**恰好落在**止损线上——那正是 A 的定义', () => {
    const cushion = X1 * (S1 - SBAR);
    const xA = cushion / (S2 - S1);
    const r = evaluatePostAddCostLine({ side: 'LONG', sBar: SBAR, s1: S1, s2: S2, x1: X1, addCoins: xA })!;
    expect(r.blendedCost).toBeCloseTo(S1, 9);
    expect(r.pastStop).toBe(false);
    expect(r.overshootPct).toBe(0);
  });

  it('所以任何超出 A 的加量都必然越线——B 账本按定义就会越', () => {
    const cushion = X1 * (S1 - SBAR);
    const xA = cushion / (S2 - S1);
    const r = evaluatePostAddCostLine({ side: 'LONG', sBar: SBAR, s1: S1, s2: S2, x1: X1, addCoins: xA * 1.01 })!;
    expect(r.pastStop).toBe(true);
  });

  it('空单方向相反：成本线低于止损线才算越过', () => {
    const r = evaluatePostAddCostLine({
      side: 'SHORT', sBar: 0.05, s1: 0.049, s2: 0.047, x1: 1_000_000, addCoins: 5_000_000,
    })!;
    expect(r.blendedCost).toBeLessThan(0.049);
    expect(r.pastStop).toBe(true);
  });

  it('参数不合法时返回 null，不编数', () => {
    expect(evaluatePostAddCostLine({ side: 'LONG', sBar: 0, s1: S1, s2: S2, x1: X1, addCoins: 1 })).toBeNull();
    expect(evaluatePostAddCostLine({ side: 'LONG', sBar: SBAR, s1: S1, s2: S2, x1: X1, addCoins: 0 })).toBeNull();
  });
});

/**
 * 时光机：同一段 SAGAUSDT 历史重放了两遍，两遍的模拟时间一模一样。
 * 只按模拟时间框「本场」，上一遍在 23:19 落袋的止盈会被当成这一遍的 G 再填一次。
 * 真实时钟不会倒流——以当前持仓最早一笔成交的真实开仓时刻为界才分得开。
 */
describe('加仓 B 方案：按操作时间框定本场落袋', () => {
  const REAL_START = T('2026-09-10T08:00:00Z');        // 这一遍主力开仓的真实时刻
  const THIS_BANKED_REAL = T('2026-09-10T08:30:00Z');  // 这一遍镜像止盈的操作时间
  const withReal = (r: TradeRecord, closedRealAt?: number): TradeRecord =>
    ({ ...r, ...(closedRealAt != null ? { closedRealAt } : {}) }) as TradeRecord;
  const OTHER_REPLAY = withReal(tp('2026-05-12T23:19:00Z', 50_000), T('2026-09-09T20:00:00Z'));
  const THIS_REPLAY = withReal(tp('2026-05-12T23:19:00Z', 84_742.24), THIS_BANKED_REAL);
  const stampedMain = [{ id: 'm', side: 'LONG' as const, openTime: MAIN_OPEN, openedRealAt: REAL_START }];
  const opts = { earliestOpenedRealAt: REAL_START };

  it('【回归】另一次重放的止盈：模拟时间相同、操作时间早于持仓开仓 → 排除；本场的照算', () => {
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', [OTHER_REPLAY, THIS_REPLAY], MAIN_OPEN, stampedMain, opts);
    expect(b.usd).toBeCloseTo(84_742.24, 2);
    expect(b.count).toBe(1);
    expect(b.excludedByOperationTime).toBe(1);
    expect(b.lastBankedAt).toBe(T('2026-05-12T23:19:00Z'));   // 模拟口径不变
    expect(b.lastBankedRealAt).toBe(THIS_BANKED_REAL);
    expect(b.addsSinceBanked).toBe(0);
  });

  it('操作时间恰好等于持仓开仓时刻也算本场（不早于即可）', () => {
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', [withReal(tp('2026-05-12T23:19:00Z', 10), REAL_START)], MAIN_OPEN, stampedMain, opts);
    expect(b.count).toBe(1);
    expect(b.excludedByOperationTime).toBe(0);
  });

  it('老持仓没有真实开仓时刻 → 与旧版一字不差，只看模拟时间', () => {
    const legacyMain = [{ side: 'LONG' as const, openTime: MAIN_OPEN }];
    const history = [OTHER_REPLAY, THIS_REPLAY];
    const legacy = detectBankedMirrorProfit('SAGAUSDT', 'LONG', history, MAIN_OPEN, legacyMain);
    expect(detectBankedMirrorProfit('SAGAUSDT', 'LONG', history, MAIN_OPEN, legacyMain, { earliestOpenedRealAt: null })).toEqual(legacy);
    expect(legacy.usd).toBeCloseTo(134_742.24, 2);
    expect(legacy.count).toBe(2);
    expect(legacy.excludedByOperationTime).toBe(0);
    // 老记录连 closedRealAt 都没有时，结果与这次改动之前完全相同
    const old = detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, MAIN_OPEN, legacyMain);
    expect(old).toEqual({
      usd: 84_742.24, coin: old.coin, count: 1, lastBankedAt: T('2026-05-12T23:19:00Z'),
      lastBankedRealAt: null, addsSinceBanked: 0, excludedByOperationTime: 0,
    });
  });

  it('持仓带真实时间戳，而止盈记录没有 closedRealAt → 只可能早于本场，排除', () => {
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, MAIN_OPEN, stampedMain, opts);
    expect(b.usd).toBe(0);
    expect(b.count).toBe(0);
    expect(b.lastBankedAt).toBeNull();
    expect(b.excludedByOperationTime).toBe(1);
  });

  describe('合并仓位按 fill 数加仓', () => {
    /** 引擎把同向成交合并成**一个**仓位：加仓只多一笔 fill，仓位条数不变。 */
    const merged = (addFill: { id: string; openTime: number; openedRealAt?: number }) => [{
      id: 'm', side: 'LONG' as const, openTime: MAIN_OPEN, openedRealAt: REAL_START,
      fills: [{ id: 'm', openTime: MAIN_OPEN, openedRealAt: REAL_START }, addFill],
    }];
    const run = (positions: ReturnType<typeof merged>) =>
      detectBankedMirrorProfit('SAGAUSDT', 'LONG', [THIS_REPLAY], MAIN_OPEN, positions, opts);

    it('【回归】落袋之后加的那笔 fill 算一次加仓——按仓位数会是 0，G 被重复使用', () => {
      const positions = merged({ id: 'a1', openTime: T('2026-05-12T23:49:00Z'), openedRealAt: T('2026-09-10T08:45:00Z') });
      expect(positions).toHaveLength(1);
      expect(run(positions).addsSinceBanked).toBe(1);
    });

    it('与主力同一刻开出的 fill（落袋之前）不算加仓', () => {
      expect(run(merged({ id: 'mirror', openTime: MAIN_OPEN, openedRealAt: REAL_START })).addsSinceBanked).toBe(0);
    });

    it('倒带：fill 的模拟时间早于落袋，但真实时刻晚于落袋 → 以真实时钟为准，算加仓', () => {
      const positions = merged({ id: 'a1', openTime: T('2026-05-12T22:30:00Z'), openedRealAt: T('2026-09-10T09:00:00Z') });
      expect(run(positions).addsSinceBanked).toBe(1);
    });

    it('反过来：模拟时间晚于落袋，但真实时刻早于落袋 → 不算加仓', () => {
      const positions = merged({ id: 'a1', openTime: T('2026-05-12T23:49:00Z'), openedRealAt: T('2026-09-10T08:10:00Z') });
      expect(run(positions).addsSinceBanked).toBe(0);
    });

    it('加仓那笔 fill 缺真实时刻时退回模拟时间，不借仓位的真实时刻', () => {
      expect(run(merged({ id: 'a1', openTime: T('2026-05-12T23:49:00Z') })).addsSinceBanked).toBe(1);
    });
  });
});

describe('readHeldPosition · 当前持仓的真实起点', () => {
  const pos = (over: Partial<Position>): Position => ({
    id: 'p', side: 'LONG', entryPrice: 0.0447, quantity: 1_000_000, leverage: 5,
    marginMode: 'isolated', margin: 10_000, openTime: MAIN_OPEN, ...over,
  });
  const fill = (id: string, openTime: number, openedRealAt?: number) =>
    ({ id, openTime, entryPrice: 0.0447, units: 500_000, ...(openedRealAt != null ? { openedRealAt } : {}) });

  it('各仓位 openedRealAt 与各 fill openedRealAt 取最小；模拟起点口径不变', () => {
    const positions = [
      // 仓位级没有真实时刻，但它的 fill 有——最早的那笔在 fill 里
      pos({ id: 'p1', openTime: MAIN_OPEN, fills: [
        fill('p1', MAIN_OPEN, T('2026-09-10T08:00:00Z')),
        fill('a1', MAIN_OPEN + 3_600_000, T('2026-09-10T08:45:00Z')),
      ] }),
      pos({ id: 'p2', openTime: MAIN_OPEN - 60_000, openedRealAt: T('2026-09-10T08:20:00Z') }),
      // 反方向更早的不算
      pos({ id: 's1', side: 'SHORT', openTime: MAIN_OPEN - 3_600_000, openedRealAt: T('2026-09-01T00:00:00Z') }),
    ];
    const h = readHeldPosition('SAGAUSDT', positions, 'LONG', 10)!;
    expect(h.earliestOpenedRealAt).toBe(T('2026-09-10T08:00:00Z'));
    expect(h.earliestOpenTime).toBe(MAIN_OPEN - 60_000);
  });

  it('仓位级真实时刻比 fill 更早时取仓位级的', () => {
    const positions = [pos({ openedRealAt: T('2026-09-10T07:00:00Z'), fills: [fill('p', MAIN_OPEN, T('2026-09-10T08:00:00Z'))] })];
    expect(readHeldPosition('SAGAUSDT', positions, 'LONG', 10)!.earliestOpenedRealAt).toBe(T('2026-09-10T07:00:00Z'));
  });

  it('老仓位没有任何真实时刻（或只有 0 / NaN）→ null', () => {
    expect(readHeldPosition('SAGAUSDT', [pos({})], 'LONG', 10)!.earliestOpenedRealAt).toBeNull();
    const junk = [pos({ openedRealAt: 0, fills: [fill('p', MAIN_OPEN, Number.NaN)] })];
    expect(readHeldPosition('SAGAUSDT', junk, 'LONG', 10)!.earliestOpenedRealAt).toBeNull();
  });

  it('【回归】fills[0] 没有真实时刻、加仓那笔有 → null，不拿加仓那一刀当起点', () => {
    const positions = [pos({ id: 'm', fills: [
      fill('m', MAIN_OPEN),
      fill('a1', MAIN_OPEN + 3_600_000, T('2026-09-08T10:00:00Z')),
    ] })];
    expect(readHeldPosition('SAGAUSDT', positions, 'LONG', 10)!.earliestOpenedRealAt).toBeNull();
  });

  it('两条仓位一条有真实时刻、一条没有 → null', () => {
    const positions = [
      pos({ id: 'old', openTime: MAIN_OPEN }),
      pos({ id: 'new', openTime: MAIN_OPEN + 3_600_000, openedRealAt: T('2026-09-08T10:00:00Z') }),
    ];
    expect(readHeldPosition('SAGAUSDT', positions, 'LONG', 10)!.earliestOpenedRealAt).toBeNull();
  });

  it('fills[0] 自己缺、但仓位级有 → 借仓位级的，照样可知', () => {
    const positions = [pos({ id: 'm', openedRealAt: T('2026-09-10T08:00:00Z'), fills: [
      fill('m', MAIN_OPEN),
      fill('a1', MAIN_OPEN + 3_600_000, T('2026-09-10T08:45:00Z')),
    ] })];
    expect(readHeldPosition('SAGAUSDT', positions, 'LONG', 10)!.earliestOpenedRealAt).toBe(T('2026-09-10T08:00:00Z'));
  });
});

/**
 * 跨 openedRealAt 上线日（2026-09-07）的持仓：用引擎真实的合并函数搭场景。
 *   主力 9-07 之前开出，没有真实开仓时刻
 *   镜像止盈 9-05 落袋——closedRealAt 6 月起就有
 *   9-08 加仓，这一刀带真实时刻，合并进主力
 * 只取有时间戳的最小值，起点会落到 9-08，本场自己的止盈被当成别的重放排除、加仓提醒也丢了。
 */
describe('跨真实时间戳上线日的持仓：起点未知，退回模拟口径', () => {
  const linear = (id: string, qty: number, entryPrice: number, over: Partial<Position> = {}): Position => ({
    id, side: 'LONG', quantity: qty, entryPrice, leverage: 10, marginMode: 'isolated',
    settlementMode: 'usdt', settlementAsset: 'USDT', openTime: MAIN_OPEN,
    margin: qty * entryPrice / 10, isolatedMargin: qty * entryPrice / 10,
    ...over,
  } as Position);
  const REAL_TP = T('2026-09-05T10:00:00Z');
  const REAL_ADD = T('2026-09-08T10:00:00Z');
  const legacyMain = linear('m', 12_053_122.94, 0.044722);
  const ownTp = { ...tp('2026-05-12T23:19:00Z', 84_742.24), closedRealAt: REAL_TP } as TradeRecord;
  const addOver = { openTime: T('2026-05-12T23:49:00Z'), openedRealAt: REAL_ADD };

  const run = (positions: Position[]) => {
    const held = readHeldPosition('SAGAUSDT', positions, 'LONG', 10)!;
    const b = detectBankedMirrorProfit(
      'SAGAUSDT', 'LONG', [ownTp], held.earliestOpenTime, positions,
      { earliestOpenedRealAt: held.earliestOpenedRealAt },
    );
    return { held, b };
  };

  it('【回归】老主力 + 合并进来的新加仓：本场止盈照算，不出排除，加仓照数', () => {
    const { positions } = mergeFilledPosition('SAGAUSDT', [legacyMain], linear('a1', 30_759_267.56, 0.0481123, addOver));
    expect(positions).toHaveLength(1);
    expect(positions[0].fills).toHaveLength(2);
    const { held, b } = run(positions);
    expect(held.earliestOpenedRealAt).toBeNull();
    expect(held.earliestOpenTime).toBe(MAIN_OPEN);
    expect(b.count).toBe(1);
    expect(b.usd).toBeCloseTo(84_742.24, 2);
    expect(b.excludedByOperationTime).toBe(0);
    expect(b.addsSinceBanked).toBe(1);
  });

  it('【回归】杠杆不同没合并，老仓位与新仓位并排：同样退回', () => {
    const merge = mergeFilledPosition('SAGAUSDT', [legacyMain], linear('a1', 30_759_267.56, 0.0481123, { ...addOver, leverage: 5 }));
    expect(merge.blockedBy).toBe('leverage');
    expect(merge.positions).toHaveLength(2);
    const { held, b } = run(merge.positions);
    expect(held.earliestOpenedRealAt).toBeNull();
    expect(b.count).toBe(1);
    expect(b.excludedByOperationTime).toBe(0);
    expect(b.addsSinceBanked).toBe(1);
  });

  it('主力也带真实时刻时照常按操作时间框定：早于主力开仓的止盈排除', () => {
    const stampedMain = linear('m', 12_053_122.94, 0.044722, { openedRealAt: T('2026-09-08T09:00:00Z') });
    const { positions } = mergeFilledPosition('SAGAUSDT', [stampedMain], linear('a1', 30_759_267.56, 0.0481123, addOver));
    const { held, b } = run(positions);
    expect(held.earliestOpenedRealAt).toBe(T('2026-09-08T09:00:00Z'));
    expect(b.count).toBe(0);
    expect(b.excludedByOperationTime).toBe(1);
  });
});
