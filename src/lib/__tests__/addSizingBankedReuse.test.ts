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

  it('【用户要求】G 是本轮已实现的净盈亏：亏损扣掉，手动减仓落袋的利润同样计入（不再只认止盈1）', () => {
    const loss = { ...tp('2026-05-13T00:10:00Z', -2_000), exit_method: 'sl' } as TradeRecord;
    const manualProfit = { ...tp('2026-05-13T00:20:00Z', 9_000), exit_method: 'manual' } as TradeRecord;
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', [...HISTORY, loss, manualProfit], MAIN_OPEN);
    expect(b.usd).toBeCloseTo(84_742.24 - 2_000 + 9_000, 2);
    // 笔数数的是盈利落袋的刀（止盈那一刀 + 手动那一刀），亏损那一刀不算
    expect(b.count).toBe(2);
    expect(b.lastBankedAt).toBe(T('2026-05-13T00:20:00Z'));
    // 镜像止盈整个是手动减仓做的（没有任何止盈1 记录）：照样有 G
    const manualOnly = detectBankedMirrorProfit('SAGAUSDT', 'LONG',
      HISTORY.map(record => (record.exit_method === 'tp1' ? { ...record, exit_method: 'manual' as const } : record)), MAIN_OPEN);
    expect(manualOnly.usd).toBeCloseTo(84_742.24, 2);
    expect(manualOnly.count).toBe(1);
    // 老成交没写退出方式：同样计入
    const legacy = detectBankedMirrorProfit('SAGAUSDT', 'LONG',
      HISTORY.map(record => (record.exit_method === 'tp1' ? { ...record, exit_method: undefined } : record)), MAIN_OPEN);
    expect(legacy.usd).toBeCloseTo(84_742.24, 2);
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

describe('【用户要求】只算镜像止盈的那一部分（仓位卡「保本线」用）', () => {
  // 现在的仓位每一笔成交都带真实开仓时刻；记录带操作时间。各刀的操作时间错开，才是各自独立的一刀。
  const REAL = T('2026-09-10T08:00:00Z');
  const MIN = 60_000;
  const held = [{
    id: 'main-position', side: 'LONG' as const, openTime: MAIN_OPEN, openedRealAt: REAL,
    fills: [{ id: 'main-fill', openTime: MAIN_OPEN, openedRealAt: REAL }, { id: 'mirror-fill', openTime: MAIN_OPEN, openedRealAt: REAL }],
  }];
  const opts = { earliestOpenedRealAt: REAL };
  const at = (r: TradeRecord, minutes: number): TradeRecord => ({ ...r, closedRealAt: REAL + minutes * MIN } as TradeRecord);
  const TP1 = at(tp('2026-05-12T23:19:00Z', 84_742.24), 30);
  const cut = (minutes: number, over: Partial<TradeRecord>): TradeRecord =>
    at({ ...tp('2026-05-13T00:10:00Z', 0), exit_method: 'manual', ...over } as TradeRecord, minutes);
  const detect = (history: TradeRecord[], positions: Parameters<typeof detectBankedMirrorProfit>[4] = held, options = opts) =>
    detectBankedMirrorProfit('SAGAUSDT', 'LONG', history, MAIN_OPEN, positions, options);

  it('止盈委托触发的盈利算；手动从这副仓位上减仓落袋的盈利也算（镜像止盈常常是手动减仓做的）', () => {
    const b = detect([TP1, cut(60, { pnl: 9_000, positionId: 'main-position', fillId: 'mirror-fill' })]);
    expect(b.mirrorUsd).toBeCloseTo(84_742.24 + 9_000, 2);
    expect(b.mirrorCount).toBe(2);
    // 只凭成交片的 id 也认得出（合并仓位里记录的 positionId 可能是存活仓位的 id，也可能只带 fillId）
    expect(detect([cut(60, { pnl: 500, positionId: undefined, fillId: 'mirror-fill' })]).mirrorUsd).toBe(500);
  });

  it('亏损的减仓不扣、止损与强平不算、手动整笔平掉的别的仓位不算——这些仍照常进净额 usd', () => {
    const b = detect([
      TP1,
      cut(60, { pnl: -2_000, positionId: 'main-position' }),                                  // 亏着减仓
      cut(70, { pnl: 700, positionId: 'main-position', exit_method: 'sl' }),                  // 移动止损在盈利处打掉一部分
      cut(80, { pnl: 300, positionId: 'main-position', action: 'LIQUIDATION', exit_method: 'liquidation' }),
      cut(90, { pnl: 1_200, positionId: 'another-position', fillId: 'another-fill' }),        // 另一副已平掉的仓位
    ]);
    expect(b.mirrorUsd).toBeCloseTo(84_742.24, 2);
    expect(b.mirrorCount).toBe(1);
    expect(b.usd).toBeCloseTo(84_742.24 - 2_000 + 700 + 300 + 1_200, 2);
  });

  it('【回归】一刀减仓按成交拆成一赚一亏两条：按整刀净额算，净亏的一刀整刀不计，净赚的一刀只计净额', () => {
    // HEIUSDT：主力 @0.161673 与加仓 @0.172473 合成一副仓位，再减仓 50%，记录按成交拆成两片（同一时刻）。
    const slices = (minutes: number, main: number, add: number) => [
      cut(minutes, { pnl: main, positionId: 'main-position', fillId: 'main-fill' }),
      cut(minutes, { pnl: add, positionId: 'main-position', fillId: 'mirror-fill' }),
    ];
    // 平在 0.1640：主力片 +31,764、加仓片 −46,602，这一刀净亏 −14,838。逐条只收盈利的会多算 31,764。
    const loss = detect([TP1, ...slices(60, 31_764, -46_602)]);
    expect(loss.mirrorUsd).toBeCloseTo(84_742.24, 2);
    expect(loss.mirrorCount).toBe(1);
    // 平在 0.1680：+86,364 与 −24,602，净赚 +61,762——计入的是净额，不是 86,364。
    const win = detect([TP1, ...slices(60, 86_364, -24_602)]);
    expect(win.mirrorUsd).toBeCloseTo(84_742.24 + 61_762, 2);
    expect(win.mirrorCount).toBe(2);
    // 两刀隔得开（不同的操作）就各算各的：先赚的一刀计入，后亏的一刀不计
    const separate = detect([cut(60, { pnl: 86_364, positionId: 'main-position' }), cut(90, { pnl: -24_602, positionId: 'main-position' })]);
    expect(separate.mirrorUsd).toBe(86_364);
    // 合并卡上两笔仓位按同一成数逐笔下发，操作时间只差几百毫秒：仍是同一刀
    const twoPositions = [...held, { id: 'second-position', side: 'LONG' as const, openTime: MAIN_OPEN, openedRealAt: REAL, fills: [] }];
    const together = detect([
      cut(60, { pnl: 5_000, positionId: 'main-position' }),
      { ...cut(60, { pnl: -8_000, positionId: 'second-position' }), closedRealAt: REAL + 60 * MIN + 400 } as TradeRecord,
    ], twoPositions);
    expect(together.mirrorUsd).toBe(0);
    expect(together.mirrorCount).toBe(0);
  });

  it('【回归】老仓位没有真实开仓时刻：分不清是不是别的回放留下的止盈，只认从这副仓位上减下来的', () => {
    const legacyHeld = [{ id: 'main-position', side: 'LONG' as const, openTime: MAIN_OPEN, fills: [{ id: 'main-fill', openTime: MAIN_OPEN }] }];
    const otherReplayTp = tp('2026-05-12T23:19:00Z', 50_000);
    const ownCut = { ...tp('2026-05-13T00:10:00Z', 9_000), exit_method: 'manual', positionId: 'main-position' } as TradeRecord;
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', [otherReplayTp, ownCut], MAIN_OPEN, legacyHeld);
    expect(b.mirrorUsd).toBe(9_000);
    expect(b.mirrorCount).toBe(1);
    // 净额 usd 的口径不变：两条都算
    expect(b.usd).toBe(59_000);
    // 带真实时刻的持仓：操作时间早于开仓的止盈（别的回放）不计，本场的照算
    const stale = at(tp('2026-05-12T23:19:00Z', 50_000), -600);
    expect(detect([stale, TP1]).mirrorUsd).toBeCloseTo(84_742.24, 2);
  });

  it('币本位记录按 pnlCoin 累计利润币并扣掉以币计的平仓手续费；不传持仓时只认止盈1', () => {
    const coinCut = cut(60, { pnl: 420, pnlCoin: 150, positionId: 'main-position' });
    const b = detect([coinCut]);
    expect(b.mirrorCoin).toBe(150);
    expect(b.mirrorUsd).toBe(420);
    expect(detect([cut(60, { pnl: 420, pnlCoin: 150, feeCoin: 6.69, positionId: 'main-position' })]).mirrorCoin).toBeCloseTo(143.31, 6);
    const withoutPositions = detectBankedMirrorProfit('SAGAUSDT', 'LONG', [...HISTORY, coinCut], MAIN_OPEN);
    expect(withoutPositions.mirrorUsd).toBeCloseTo(84_742.24, 2);
    expect(withoutPositions.mirrorCount).toBe(1);
  });

  it('没有持仓（没有「本场」）时都是 0', () => {
    expect(detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, null, held)).toMatchObject({ mirrorUsd: 0, mirrorCoin: 0, mirrorCount: 0 });
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
      // 后加的三项：只算镜像止盈的那一部分（这条记录是止盈1，整笔都算）
      mirrorUsd: 84_742.24, mirrorCoin: old.coin, mirrorCount: 1,
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
