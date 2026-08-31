import { describe, expect, it } from 'vitest';
import type { Position } from '@/types/trading';
import { buildCloseRecords, scaleSettlementPosition } from '@/lib/tradingSettlement';

/**
 * 事故 ENJUSDT 2025-04-21:主力与镜像**同一秒**(18:51)开出,
 * 镜像开仓价 0.102754、主力却显示 0.112420——高出 9.4%。
 * 那是主力与加仓合并后的加权价:一次平仓只写一条记录,而这个应用没有开仓记录,
 * 回填出来的腿全靠平仓记录,于是加仓整条消失、主力顶着一个混合价。
 */
const MAIN_ENTRY = 0.102754;
const ADD_ENTRY = 0.130000;

const pos = (over: Partial<Position> = {}): Position => ({
  id: 'main', side: 'LONG', quantity: 300, entryPrice: 0.112420,
  leverage: 5, marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT',
  margin: 100, isolatedMargin: 100, openTime: 1_000,
  fills: [
    { id: 'main', openTime: 1_000, entryPrice: MAIN_ENTRY, units: 200 },
    { id: 'add', openTime: 9_000, entryPrice: ADD_ENTRY, units: 100 },
  ],
  ...over,
} as Position);

const coinPos = (over: Partial<Position> = {}): Position => ({
  id: 'main', side: 'LONG', quantity: 300, contracts: 300, contractSizeUsd: 10,
  settlementMode: 'coin', settlementAsset: 'ENJ', entryPrice: 0.112420,
  leverage: 5, marginMode: 'isolated', margin: 100, isolatedMargin: 100, openTime: 1_000,
  fills: [
    { id: 'main', openTime: 1_000, entryPrice: MAIN_ENTRY, units: 200 },
    { id: 'add', openTime: 9_000, entryPrice: ADD_ENTRY, units: 100 },
  ],
  ...over,
} as Position);

const TOTALS = {
  netPnl: -54_651.97, pnlCoin: -520_000, feeUsd: 123.45, feeCoin: 1_100,
  slippageUsd: 7.89, notionalUsd: 1_430_760,
};
const build = (p: Position, closeQty = 300) => buildCloseRecords({
  symbol: 'ENJUSDT', pos: p, closeQty, fillPrice: 0.104860,
  closeTime: 20_000, exitMethod: 'manual', totals: TOTALS,
});

describe('平仓按每笔成交拆条', () => {
  it('【回归】加仓不再消失,主力也不再顶着混合开仓价', () => {
    const recs = build(pos());
    expect(recs).toHaveLength(2);
    expect(recs.map(r => r.fillId)).toEqual(['main', 'add']);
    // 主力那条恢复成它自己的开仓价,不再是 0.112420 那个加权数
    expect(recs[0].entryPrice).toBeCloseTo(MAIN_ENTRY, 9);
    expect(recs[1].entryPrice).toBeCloseTo(ADD_ENTRY, 9);
    expect(recs[0].entryPrice).not.toBeCloseTo(0.112420, 6);
    // 各自的开仓时刻也留着——战役页的腿要靠它排时间线
    expect(recs.map(r => r.openTime)).toEqual([1_000, 9_000]);
  });

  it('positionId 仍然是存活的那个合并仓位,fillId 才是这一片的身份', () => {
    const recs = build(pos());
    expect(recs.every(r => r.positionId === 'main')).toBe(true);
    expect(new Set(recs.map(r => r.fillId)).size).toBe(2);
    expect(new Set(recs.map(r => r.id)).size).toBe(2);   // 记录 id 互不相同
  });

  it('【判据】每一项的 Σ 与整笔相等,残差压在 1 ULP 量级', () => {
    // 做不到严格逐位相等:`total − acc` 再加回 acc 在 IEEE754 下不保证还原
    // (fee 这一项实测会走成 123.45000000000002)。这里钉的是「残差是浮点尘埃,
    // 不是分配错误」——1e-9 比 campaignRealizedPnl 的漂移阈值严格好几个量级。
    const recs = build(pos());
    const sum = (f: (r: typeof recs[number]) => number | undefined) =>
      recs.reduce((s, r) => s + (f(r) ?? 0), 0);
    expect(sum(r => r.quantity)).toBe(300);                       // 数量必须精确
    expect(sum(r => r.pnl)).toBeCloseTo(TOTALS.netPnl, 9);
    expect(sum(r => r.pnlCoin)).toBeCloseTo(TOTALS.pnlCoin, 6);
    expect(sum(r => r.fee)).toBeCloseTo(TOTALS.feeUsd, 9);
    expect(sum(r => r.feeCoin)).toBeCloseTo(TOTALS.feeCoin, 6);
    expect(sum(r => r.slippage)).toBeCloseTo(TOTALS.slippageUsd, 9);
    expect(sum(r => r.notionalUsd)).toBeCloseTo(TOTALS.notionalUsd, 6);
  });

  it('按 units 占比分,不按盈亏占比分', () => {
    const recs = build(pos());
    expect(recs[0].quantity).toBeCloseTo(200, 9);
    expect(recs[1].quantity).toBeCloseTo(100, 9);
    expect(recs[0].fee!).toBeCloseTo(TOTALS.feeUsd * (2 / 3), 6);
  });

  it('【回归】没有 fills 的旧仓位仍然只出一条,与改动前逐字节相同', () => {
    const legacy = pos({ fills: undefined });
    const recs = build(legacy);
    expect(recs).toHaveLength(1);
    expect(recs[0].entryPrice).toBe(legacy.entryPrice);
    expect(recs[0].fillId).toBe('main');
    expect(recs[0].quantity).toBe(300);
    expect(recs[0].pnl).toBe(TOTALS.netPnl);
  });

  it('只有一笔成交时也只出一条', () => {
    const single = pos({ fills: [{ id: 'main', openTime: 1_000, entryPrice: MAIN_ENTRY, units: 300 }] });
    expect(build(single)).toHaveLength(1);
  });

  it('【回归】units 全坏时退回单条,绝不产出零条', () => {
    // 分母为 0 时按占比分会得到 NaN 并产出零条记录,而余额照样入账——
    // 那等于把一次平仓静默删掉。positions_map 是云同步的、没有版本号,脏数据是真实存在的。
    const broken = pos({ fills: [
      { id: 'main', openTime: 1_000, entryPrice: MAIN_ENTRY, units: 0 },
      { id: 'add', openTime: 9_000, entryPrice: ADD_ENTRY, units: NaN },
    ] });
    const recs = build(broken);
    expect(recs).toHaveLength(1);
    expect(recs[0].pnl).toBe(TOTALS.netPnl);
  });
});

describe('币本位的整数张分配', () => {
  it('Σ 张数严格等于平仓张数', () => {
    for (const qty of [300, 299, 101, 7, 1]) {
      const recs = build(coinPos(), qty);
      const total = recs.reduce((s, r) => s + r.quantity, 0);
      expect(total).toBe(qty);
      expect(recs.every(r => Number.isInteger(r.quantity))).toBe(true);
      expect(recs.every(r => r.contracts === r.quantity)).toBe(true);
    }
  });

  it('用最大余额法,不是「余数全丢给最后一笔」', () => {
    // 200:100 的占比,平 7 张 → 精确值 4.667 / 2.333,
    // 下整得 4/2 余 1 张,小数部分大的那笔(4.667)拿到 → 5/2。
    // 「全丢最后一笔」会给出 4/3,是对排在最后那笔的系统性偏袒。
    const recs = build(coinPos(), 7);
    expect(recs.map(r => r.quantity)).toEqual([5, 2]);
  });

  it('分到 0 张的片不产出记录——空腿没有任何可读内容', () => {
    const lopsided = coinPos({ fills: [
      { id: 'main', openTime: 1_000, entryPrice: MAIN_ENTRY, units: 999 },
      { id: 'add', openTime: 9_000, entryPrice: ADD_ENTRY, units: 1 },
    ] });
    const recs = build(lopsided, 1);
    expect(recs).toHaveLength(1);
    expect(recs[0].quantity).toBe(1);
    expect(recs[0].pnl).toBe(TOTALS.netPnl);   // 钱一分不少
  });

  it('币本位下 Σ 盈亏同样逐位相等', () => {
    const recs = build(coinPos(), 299);
    expect(recs.reduce((s, r) => s + r.pnl, 0)).toBeCloseTo(TOTALS.netPnl, 9);
    expect(recs.reduce((s, r) => s + (r.pnlCoin ?? 0), 0)).toBeCloseTo(TOTALS.pnlCoin, 6);
  });
});

describe('部分平仓要按比例缩 fills', () => {
  it('【回归】不缩的话,下一次拆分的分母就是陈的', () => {
    // mergeFilledPosition 是把新成交**追加**到这张表上的,误差会一路累积。
    const after = scaleSettlementPosition(pos(), 150);   // 平掉一半
    expect(after.quantity).toBe(150);
    expect(after.fills?.map(f => f.units)).toEqual([100, 50]);
    expect(after.fills!.reduce((s, f) => s + f.units, 0)).toBe(150);
  });

  it('按比例缩而不是先进先出——先进先出会改变加权开仓价和强平价', () => {
    // 币安单向持仓的减仓不动均价;而且先进先出会让镜像止盈的 60% 全从主力里出,
    // 加仓在主力被消耗完之前一直显示没有已实现盈亏。
    const after = scaleSettlementPosition(pos(), 150);
    expect(after.entryPrice).toBe(pos().entryPrice);       // 均价不动
    expect(after.fills).toHaveLength(2);                    // 两笔都还在
    expect(after.fills?.map(f => f.id)).toEqual(['main', 'add']);
  });

  it('缩完之后 id、开仓价、开仓时刻一概不变', () => {
    const after = scaleSettlementPosition(pos(), 90);
    expect(after.fills?.map(f => f.entryPrice)).toEqual([MAIN_ENTRY, ADD_ENTRY]);
    expect(after.fills?.map(f => f.openTime)).toEqual([1_000, 9_000]);
  });

  it('没有 fills 的旧仓位缩完仍然没有,不凭空造一张表', () => {
    expect(scaleSettlementPosition(pos({ fills: undefined }), 150).fills).toBeUndefined();
  });
});

describe('盈亏按每笔自己的开仓价拆，费用才按张数拆', () => {
  /**
   * 事故:最初把盈亏也按张数占比摊了。Σ 守恒、余额没错、漂移阈值也发现不了,
   * 但按腿分账全错——而按腿分账正是拆分存在的全部理由。
   * 最刺眼的表现:加仓那条记录做多、开仓 0.12、平仓 0.11,却带着**正**盈亏。
   */
  const CS = 10;
  const inv = (fillsOver?: Position['fills']): Position => ({
    id: 'A', side: 'LONG', quantity: 200, contracts: 200, contractSizeUsd: CS,
    settlementMode: 'coin', settlementAsset: 'ENJ',
    entryPrice: 0.10909090909090907,          // 名义加权调和平均
    leverage: 5, marginMode: 'isolated', margin: 100, isolatedMargin: 100, openTime: 1_000,
    fills: fillsOver ?? [
      { id: 'A', openTime: 1_000, entryPrice: 0.10, units: 100 },
      { id: 'B', openTime: 9_000, entryPrice: 0.12, units: 100 },
    ],
  } as Position);

  // 真实分账:A 名义 1000 → 1000×(1/0.10−1/0.11)×0.11 = +100；B → −83.333…
  const TRUE_A = 100, TRUE_B = -1000 / 12;
  const invBuild = (totals: Parameters<typeof buildCloseRecords>[0]['totals'], qty = 200) =>
    buildCloseRecords({ symbol: 'ENJUSD', pos: inv(), closeQty: qty, fillPrice: 0.11,
      closeTime: 20_000, totals });

  it('【回归】加仓那一片的盈亏是负的——按张数摊会把它写成正的', () => {
    const recs = invBuild({ netPnl: TRUE_A + TRUE_B, pnlCoin: 1000 / 0.10 - 2000 / 0.11 + 1000 / 0.12,
      feeUsd: 0, slippageUsd: 0, notionalUsd: 2000 });
    expect(recs[0].pnl).toBeCloseTo(TRUE_A, 6);
    expect(recs[1].pnl).toBeCloseTo(TRUE_B, 6);
    // 三个字段必须自洽:做多、开仓高于平仓 → 必亏
    expect(recs[1].entryPrice).toBeGreaterThan(recs[1].exitPrice!);
    expect(recs[1].pnl).toBeLessThan(0);
    // 旧实现会给出两条一模一样的 +8.3333
    expect(recs[0].pnl).not.toBeCloseTo(recs[1].pnl, 6);
  });

  it('【判据】一赢一亏必须表示得出来——按张数摊时所有分片必然同号', () => {
    const recs = invBuild({ netPnl: TRUE_A + TRUE_B, feeUsd: 0, slippageUsd: 0, notionalUsd: 2000 });
    expect(Math.sign(recs[0].pnl)).toBe(1);
    expect(Math.sign(recs[1].pnl)).toBe(-1);
  });

  it('拆完仍然守恒:Σ 盈亏等于整笔净额', () => {
    const net = TRUE_A + TRUE_B;
    const recs = invBuild({ netPnl: net, feeUsd: 0, slippageUsd: 0, notionalUsd: 2000 });
    expect(recs.reduce((s, r) => s + r.pnl, 0)).toBeCloseTo(net, 9);
  });

  it('【判据】成本按「Σ毛利 − 整笔净额」反推，强平费也能守恒', () => {
    // 强平路径传的 netPnl 是 pnl − closeFee − liqFee，减掉的不止 feeUsd。
    // 若写成 pnl_i = gross_i − fee_i，强平费那一块会漏掉、Σ 当场断掉。
    const gross = TRUE_A + TRUE_B;                 // +16.667
    const net = gross - 4 - 11;                    // 手续费 4 + 强平费 11
    const recs = invBuild({ netPnl: net, feeUsd: 4, slippageUsd: 0, notionalUsd: 2000 });
    expect(recs.reduce((s, r) => s + r.pnl, 0)).toBeCloseTo(net, 9);
    // 成本 15 按张数对半分，各摊 7.5
    expect(recs[0].pnl).toBeCloseTo(TRUE_A - 7.5, 6);
    expect(recs[1].pnl).toBeCloseTo(TRUE_B - 7.5, 6);
  });

  it('U 本位同样按各自开仓价拆', () => {
    // main 200@0.102754、add 100@0.130000，300 张全平在 0.104860
    const recs = build(pos(), 300);
    const trueMain = (0.104860 - MAIN_ENTRY) * 200;      // +0.4212
    const trueAdd = (0.104860 - ADD_ENTRY) * 100;        // −2.5140
    const cost = (trueMain + trueAdd) - TOTALS.netPnl;
    expect(recs[0].pnl).toBeCloseTo(trueMain - cost * (2 / 3), 6);
    expect(recs[1].pnl).toBeCloseTo(trueAdd - cost * (1 / 3), 6);
    // 主力的毛利是**正**的,旧实现把它写成了亏损
    expect(trueMain).toBeGreaterThan(0);
  });

  it('币计盈亏也按各自开仓价拆，不按张数', () => {
    const gc = (e: number) => 1000 * (1 / e - 1 / 0.11);
    const recs = invBuild({ netPnl: TRUE_A + TRUE_B, pnlCoin: gc(0.10) + gc(0.12),
      feeUsd: 0, slippageUsd: 0, notionalUsd: 2000 });
    expect(recs[0].pnlCoin!).toBeCloseTo(gc(0.10), 6);
    expect(recs[1].pnlCoin!).toBeCloseTo(gc(0.12), 6);
    expect(recs[1].pnlCoin!).toBeLessThan(0);
  });

  it('【回归】开仓价坏掉时整体退回按张数摊，不混用两套规则', () => {
    // 「有的片按真实经济学、有的片按占比」比全体一致地退化更难排查。
    const broken = inv([
      { id: 'A', openTime: 1_000, entryPrice: 0, units: 100 },
      { id: 'B', openTime: 9_000, entryPrice: 0.12, units: 100 },
    ]);
    const recs = buildCloseRecords({ symbol: 'ENJUSD', pos: broken, closeQty: 200, fillPrice: 0.11,
      closeTime: 20_000, totals: { netPnl: -50, feeUsd: 0, slippageUsd: 0, notionalUsd: 2000 } });
    expect(recs.map(r => r.pnl)).toEqual([-25, -25]);
  });

  it('费用/滑点/名义仍然按张数摊——它们在固定成交价下确实与张数成正比', () => {
    const recs = invBuild({ netPnl: TRUE_A + TRUE_B - 30, feeUsd: 30, slippageUsd: 6,
      notionalUsd: 2000 });
    expect(recs[0].fee!).toBeCloseTo(15, 9);
    expect(recs[1].fee!).toBeCloseTo(15, 9);
    expect(recs[0].slippage!).toBeCloseTo(3, 9);
    expect(recs[0].notionalUsd!).toBeCloseTo(1000, 9);
  });
});
