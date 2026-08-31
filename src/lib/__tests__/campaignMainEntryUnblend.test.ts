import { describe, expect, it } from 'vitest';
import { resolveUnblendedMainEntry } from '@/lib/campaignMainEntryUnblend';
import { resolveMainRiskAnchors, computeInitialExpectedMaxLoss } from '@/lib/campaignAnalysis';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

const MAIN_E = 0.102754, MAIN_N = 40_000;
const MIRROR_E = 0.102754, MIRROR_N = 60_000;   // 镜像与主力同秒同价，按合并键会并进同一个仓位
const ADD_E = 0.130000, ADD_N = 98_100;
const TOTAL_N = MAIN_N + MIRROR_N + ADD_N;

/** 合并价的定义式：N_总/E_混 = Σ Nᵢ/eᵢ。 */
const BLENDED = TOTAL_N / (MAIN_N / MAIN_E + MIRROR_N / MIRROR_E + ADD_N / ADD_E);

const SIBS = [
  { entryPrice: MIRROR_E, notionalUsd: MIRROR_N },
  { entryPrice: ADD_E, notionalUsd: ADD_N },
];
const base = {
  blendedEntryPrice: BLENDED, totalNotionalUsd: TOTAL_N,
  mainNotionalUsd: MAIN_N, mergedSiblings: SIBS,
};

describe('只在能拿到正面证据时才反解', () => {
  it('主力 + 镜像 + 加仓合并时，解回主力自己的开仓价', () => {
    const r = resolveUnblendedMainEntry(base);
    expect(r.ok).toBe(true);
    expect(r.ok && r.entryPrice).toBeCloseTo(MAIN_E, 10);
    // 混合价比主力真实价高 11.6%，两者不能混为一谈
    expect(BLENDED).toBeGreaterThan(MAIN_E * 1.1);
  });

  it('【判据】新数据不走这条路——分片本来就带自己的价', () => {
    expect(resolveUnblendedMainEntry({ ...base, recordFillId: 'pos-1' }))
      .toMatchObject({ ok: false, reason: 'already-per-fill' });
  });

  it('没有兄弟腿 → 这条记录本来就不是混合的', () => {
    expect(resolveUnblendedMainEntry({ ...base, mergedSiblings: [] }))
      .toMatchObject({ reason: 'no-adds' });
  });

  it('【判据】主力自己的名义不可知时拒绝——验不了「合并」这件事就不动', () => {
    for (const bad of [null, undefined, 0, NaN]) {
      expect(resolveUnblendedMainEntry({ ...base, mainNotionalUsd: bad as number }))
        .toMatchObject({ reason: 'main-size-unknown' });
    }
  });

  it('【判据】名义对不上 → 这笔加仓当初没并进来，减了会把主力算错', () => {
    // 记录里只有主力+镜像，而战役标了一笔加仓：它是单独开的仓位。
    const onlyMainAndMirror = (MAIN_N + MIRROR_N)
      / (MAIN_N / MAIN_E + MIRROR_N / MIRROR_E) * 1;
    expect(resolveUnblendedMainEntry({
      ...base, blendedEntryPrice: onlyMainAndMirror, totalNotionalUsd: MAIN_N + MIRROR_N,
    })).toMatchObject({ reason: 'not-a-merge' });
  });

  it('容差 2%：滑点与取整放行，多算一整笔加仓不放行', () => {
    const ok = resolveUnblendedMainEntry({ ...base, totalNotionalUsd: TOTAL_N * 1.015 });
    expect(ok.ok).toBe(true);
    expect(resolveUnblendedMainEntry({ ...base, totalNotionalUsd: TOTAL_N * 1.05 }))
      .toMatchObject({ reason: 'not-a-merge' });
  });

  it('【判据】解出的价必须落在被平均那些价张成的区间里', () => {
    // 输入自相矛盾时宁可不动，也不要拿一个荒谬的价去给风险定价。
    expect(resolveUnblendedMainEntry({
      ...base, mergedSiblings: [{ entryPrice: 1e-6, notionalUsd: MIRROR_N + ADD_N }],
    }).ok).toBe(false);
  });
});

describe('接进风险锚：老战役补上标注之后自动算对', () => {
  const OPEN = '2026-04-29T19:48:00.000Z';
  const GUARD = 0.0887240;
  const campaign = {
    id: 'c1', user_id: 'u', campaign_code: 'C1', symbol: 'ENJUSDT',
    direction: 'main_long', status: 'closed_loss', strategy_template: 'main_dual_hedge_mirror_tp',
    title: 't', opened_at: OPEN, closed_at: '2026-04-29T23:53:00.000Z',
    initial_main_size_usdt: MAIN_N, initial_leverage: 5,
    final_realized_pnl: null, final_r_multiple: null,
    peak_unrealized_pnl: null, peak_drawdown: null, actual_evolution: [],
  } as unknown as TradeCampaign;

  const mkLeg = (id: string, role: string, entry: number | null, size: number | null, rid: string | null) => ({
    id, leg_role: role, leg_sequence: 1, direction: 'long',
    order_kind: role === 'mirror_tp' ? 'tp' : 'main',
    pre_simulated_time: OPEN, pre_entry_price: entry, pre_position_size: size,
    trade_record_id: rid,
  } as unknown as TradeJournal);

  // 老数据：一次平仓只写一条记录，带合并后的加权价，没有 fillId
  const blendedRecord = {
    id: 'r-blended', symbol: 'ENJUSDT', side: 'LONG', action: 'CLOSE', positionId: 'pos-1',
    openTime: Date.parse(OPEN), closeTime: Date.parse(OPEN) + 3_600_000,
    entryPrice: BLENDED, exitPrice: 0.09, quantity: TOTAL_N / BLENDED, leverage: 5, pnl: -1,
  } as unknown as TradeRecord;

  const LEGS = [
    mkLeg('m1', 'main_open', MAIN_E, MAIN_N, 'pos-1'),
    mkLeg('tp1', 'mirror_tp', MIRROR_E, MIRROR_N, null),
    mkLeg('a1', 'main_add_1', ADD_E, ADD_N, null),
  ];
  const guard: CampaignReverseHedgeOrder = {
    id: 'g1', side: 'SHORT', price: GUARD, createdAt: Date.parse(OPEN) + 60_000,
    triggeredAt: null, cancelledAt: Date.parse(OPEN) + 120_000, status: 'cancelled',
  };

  const TRUE_F = (MAIN_E - GUARD) / MAIN_E;          // 13.65%
  const BLENDED_F = (BLENDED - GUARD) / BLENDED;     // 22.6%

  it('【回归】跌幅按解回来的主力价算，不是合并价', () => {
    const risk = resolveMainRiskAnchors(campaign, LEGS, [blendedRecord], [guard]);
    expect(risk.anchors[0].drawdownFraction).toBeCloseTo(TRUE_F, 8);
    expect(risk.anchors[0].drawdownFraction).not.toBeCloseTo(BLENDED_F, 4);
    expect(BLENDED_F / TRUE_F).toBeGreaterThan(1.6);   // 差得不是一点点
  });

  it('没有标注加仓的战役保持原样，一个数都不动', () => {
    const noAdds = LEGS.filter(l => l.leg_role !== 'main_add_1');
    const risk = resolveMainRiskAnchors(campaign, noAdds, [blendedRecord], [guard]);
    // 名义对不上（记录里含加仓，战役里没标）→ 守卫拒绝 → 走今天的链
    expect(risk.anchors[0].drawdownFraction).toBeCloseTo(BLENDED_F, 8);
  });

  it('预期最大亏损随之回到正确量级', () => {
    const L = computeInitialExpectedMaxLoss(campaign, LEGS, [blendedRecord], [guard]);
    const wrong = computeInitialExpectedMaxLoss(
      campaign, LEGS.filter(l => l.leg_role !== 'main_add_1'), [blendedRecord], [guard]);
    expect(L).toBeGreaterThan(0);
    expect(wrong).toBeGreaterThan(L);                  // 旧口径把风险算高了
  });
});
