import { describe, it, expect } from 'vitest';
import { aggregateFalsificationFacet } from '@/lib/falsificationFacet';
import type { FalsificationGrade } from '@/lib/falsificationQuality';
import type { TradeJournal } from '@/types/journal';

/** 只填聚合实际读取的字段，其余无关字段用 cast 跳过。默认已复盘真实主力单。 */
function mk(overrides: Partial<TradeJournal>): TradeJournal {
  return {
    id: 'j1',
    symbol: 'BTCUSDT',
    journal_kind: 'trade',
    order_kind: 'main',
    pre_simulated_time: '2026-01-01T00:00:00.000Z',
    pre_real_time: '2026-01-01T00:00:00.000Z',
    post_reviewed_at: '2026-01-02T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    post_outcome: 'loss',
    post_r_multiple: -1,
    ...overrides,
  } as unknown as TradeJournal;
}

/** 富集：结构止损 + 可证伪信号 + 有止损价。 */
const rich = (over: Partial<TradeJournal> = {}) =>
  mk({ pre_stop_quality: 'structural', pre_falsification_signal: '跌破前低', pre_planned_stop_loss: 90, ...over });
/** 稀薄：只有结构止损、没信号。 */
const thin = (over: Partial<TradeJournal> = {}) =>
  mk({ pre_stop_quality: 'structural', pre_planned_stop_loss: 90, ...over });
/** 贫瘠：拍脑袋止损、没信号。 */
const poor = (over: Partial<TradeJournal> = {}) =>
  mk({ pre_stop_quality: 'arbitrary', pre_planned_stop_loss: 90, ...over });

const bucket = (facet: ReturnType<typeof aggregateFalsificationFacet>, g: FalsificationGrade) =>
  facet.buckets.find(b => b.grade === g)!;

describe('aggregateFalsificationFacet 分档', () => {
  it('空输入：三档齐备、固定顺序、全 0', () => {
    const f = aggregateFalsificationFacet([]);
    expect(f.buckets.map(b => b.grade)).toEqual(['rich', 'thin', 'poor']);
    expect(f.totalReviewed).toBe(0);
    expect(f.buckets.every(b => b.count === 0)).toBe(true);
    expect(f.poorBackDoorRate).toBeNull();
    expect(f.richBackDoorRate).toBeNull();
  });

  it('富集 / 稀薄 / 贫瘠 各归各档', () => {
    const f = aggregateFalsificationFacet([rich(), thin(), poor()]);
    expect(bucket(f, 'rich').count).toBe(1);
    expect(bucket(f, 'thin').count).toBe(1);
    expect(bucket(f, 'poor').count).toBe(1);
    expect(f.totalReviewed).toBe(3);
  });

  it('逆势把富集降一级到稀薄（与 errorTypes 同口径）', () => {
    // 趋势市做均值回归 = 逆势：富集材料被降一级到稀薄
    const f = aggregateFalsificationFacet([
      rich({ pre_edge_source: 'mean_reversion', pre_market_regime: 'trending' }),
    ]);
    expect(bucket(f, 'rich').count).toBe(0);
    expect(bucket(f, 'thin').count).toBe(1);
  });

  it('逆势把稀薄降到贫瘠 → 预报后门', () => {
    // 稀薄材料（结构止损、无信号）+ 逆势 → 贫瘠
    const f = aggregateFalsificationFacet([
      thin({ pre_edge_source: 'mean_reversion', pre_market_regime: 'trending' }),
    ]);
    expect(bucket(f, 'thin').count).toBe(0);
    expect(bucket(f, 'poor').count).toBe(1);
  });
});

describe('后门率：ex-ante 病根 → 后门死法', () => {
  it('贫瘠档亏损里 not_triggered 的占比 = backDoorRate', () => {
    const f = aggregateFalsificationFacet([
      poor({ id: 'p1', post_outcome: 'loss', exit_falsification_status: 'not_triggered' }),
      poor({ id: 'p2', post_outcome: 'loss', exit_falsification_status: 'triggered_reacted' }),
      poor({ id: 'p3', post_outcome: 'win', exit_falsification_status: 'not_triggered' }), // 赢不计入亏损
    ]);
    const b = bucket(f, 'poor');
    expect(b.lossCount).toBe(2);
    expect(b.backDoorLossCount).toBe(1);
    expect(b.backDoorRate).toBeCloseTo(0.5, 5);
    expect(f.poorBackDoorRate).toBeCloseTo(0.5, 5);
  });

  it('富集档作对照：后门率应更低', () => {
    const f = aggregateFalsificationFacet([
      // 富集两笔亏损都按预案触发（不是后门）
      rich({ id: 'r1', post_outcome: 'loss', exit_falsification_status: 'triggered_reacted' }),
      rich({ id: 'r2', post_outcome: 'loss', exit_falsification_status: 'triggered_late' }),
      // 贫瘠一笔后门死
      poor({ id: 'p1', post_outcome: 'loss', exit_falsification_status: 'not_triggered' }),
    ]);
    expect(f.richBackDoorRate).toBe(0);
    expect(f.poorBackDoorRate).toBe(1);
    expect(f.poorBackDoorRate! > (f.richBackDoorRate ?? 0)).toBe(true);
  });

  it('该档无亏损 → backDoorRate 为 null', () => {
    const f = aggregateFalsificationFacet([rich({ post_outcome: 'win' })]);
    expect(bucket(f, 'rich').lossCount).toBe(0);
    expect(bucket(f, 'rich').backDoorRate).toBeNull();
  });
});

describe('计数与统计', () => {
  it('win / loss / breakeven 计数 + avgR', () => {
    const f = aggregateFalsificationFacet([
      poor({ id: 'a', post_outcome: 'win', post_r_multiple: 2 }),
      poor({ id: 'b', post_outcome: 'loss', post_r_multiple: -1 }),
      poor({ id: 'c', post_outcome: 'breakeven', post_r_multiple: 0 }),
    ]);
    const b = bucket(f, 'poor');
    expect(b.count).toBe(3);
    expect(b.winCount).toBe(1);
    expect(b.lossCount).toBe(1);
    expect(b.breakevenCount).toBe(1);
    expect(b.avgR).toBeCloseTo((2 - 1 + 0) / 3, 5);
  });

  it('avgR 只计有 post_r_multiple 的样本；都没有 → null', () => {
    const f = aggregateFalsificationFacet([poor({ post_r_multiple: null })]);
    expect(bucket(f, 'poor').avgR).toBeNull();
  });

  it('只纳入已复盘真实主力单（对冲 / 未复盘 / 太难 排除）', () => {
    const f = aggregateFalsificationFacet([
      poor({ id: 'keep' }),
      poor({ id: 'hedge', order_kind: 'hedge' }),
      poor({ id: 'unreviewed', post_reviewed_at: null }),
      poor({ id: 'tooHard', journal_kind: 'no_trade' }),
    ]);
    expect(f.totalReviewed).toBe(1);
    expect(bucket(f, 'poor').journals.map(j => j.id)).toEqual(['keep']);
  });

  it('journals 最近在前', () => {
    const f = aggregateFalsificationFacet([
      poor({ id: 'old', post_reviewed_at: '2026-01-01T00:00:00Z' }),
      poor({ id: 'new', post_reviewed_at: '2026-03-01T00:00:00Z' }),
    ]);
    expect(bucket(f, 'poor').journals.map(j => j.id)).toEqual(['new', 'old']);
  });
});
