import { describe, it, expect } from 'vitest';
import {
  aggregateErrorTypes,
  isReviewedMainTrade,
  ERROR_FAMILY_META,
  type ErrorTypeAggregate,
} from '@/lib/errorTypes';
import type { TradeJournal } from '@/types/journal';

/** 只填聚合实际读取的字段，其余无关字段用 cast 跳过。 */
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

const byId = (types: ErrorTypeAggregate[], id: string) => types.find(t => t.id === id);

describe('isReviewedMainTrade', () => {
  it('排除：未复盘 / 对冲单 / 太难记录', () => {
    expect(isReviewedMainTrade(mk({ post_reviewed_at: null }))).toBe(false);
    expect(isReviewedMainTrade(mk({ order_kind: 'hedge' }))).toBe(false);
    expect(isReviewedMainTrade(mk({ journal_kind: 'no_trade' }))).toBe(false);
  });
  it('纳入：已复盘真实主力单（不强制 win/loss）', () => {
    expect(isReviewedMainTrade(mk({ post_outcome: 'breakeven' }))).toBe(true);
  });
});

describe('aggregateErrorTypes 基本行为', () => {
  it('空输入 → 空目录', () => {
    expect(aggregateErrorTypes([])).toEqual([]);
  });

  it('有样本可判但未命中 → 该类型记为 0', () => {
    // 一笔干净单：预测 40% 且亏损（不过度自信）、设了证伪信号 → 对应可测类型记 0
    const clean = mk({
      pre_calibration_win_pct: 40,
      post_outcome: 'loss',
      pre_falsification_signal: '跌破前低',
    });
    const types = aggregateErrorTypes([clean]);
    const overconfident = byId(types, 'overconfident')!;
    const noFalsification = byId(types, 'no_falsification_set')!;
    expect(overconfident.count).toBe(0);
    expect(overconfident.applicable).toBe(1);
    expect(overconfident.rate).toBe(0);
    expect(noFalsification.count).toBe(0);
    expect(noFalsification.applicable).toBe(1);
  });

  it('过滤不可分析项：未复盘 / 对冲 / 太难 不计入', () => {
    const journals = [
      mk({ id: 'a', pre_calibration_win_pct: 80, post_outcome: 'loss' }), // 过度自信
      mk({ id: 'b', post_reviewed_at: null, pre_calibration_win_pct: 90, post_outcome: 'loss' }),
      mk({ id: 'c', order_kind: 'hedge', pre_calibration_win_pct: 90, post_outcome: 'loss' }),
    ];
    const oc = byId(aggregateErrorTypes(journals), 'overconfident')!;
    expect(oc.count).toBe(1);
    expect(oc.instances[0].journal.id).toBe('a');
  });
});

describe('各错误类型判定', () => {
  it('过度自信：预测≥60%却亏，代价为亏损 R', () => {
    const t = byId(aggregateErrorTypes([mk({ pre_calibration_win_pct: 75, post_r_multiple: -2 })]), 'overconfident')!;
    expect(t.family).toBe('calibration');
    expect(t.count).toBe(1);
    expect(t.totalCost).toBe(-2);
    expect(t.costUnit).toBe('R');
  });

  it('R 目标落空：目标 R3 实际 -1R → 缺口 4R', () => {
    const t = byId(aggregateErrorTypes([mk({ pre_odds_structure: 'r3_open', post_r_multiple: -1 })]), 'r_shortfall')!;
    expect(t.count).toBe(1);
    expect(t.totalCost).toBe(4);
  });

  it('死法不在预案内：亏损且证伪未触发，且 blindSpotSource', () => {
    const t = byId(
      aggregateErrorTypes([mk({ post_outcome: 'loss', exit_falsification_status: 'not_triggered' })]),
      'death_not_in_plan',
    )!;
    expect(t.count).toBe(1);
    expect(t.blindSpotSource).toBe(true);
  });

  it('看见了却晚动：triggered_late', () => {
    const t = byId(aggregateErrorTypes([mk({ exit_falsification_status: 'triggered_late' })]), 'falsification_late')!;
    expect(t.count).toBe(1);
  });

  it('没设可证伪信号：v2 快照但信号为空才算（旧快照不误判）', () => {
    const v2Missing = mk({ id: 'v2', pre_calibration_win_pct: 50, pre_falsification_signal: null });
    const legacy = mk({ id: 'legacy' }); // 无任何 v2 标记字段
    const types = aggregateErrorTypes([v2Missing, legacy]);
    const t = byId(types, 'no_falsification_set')!;
    expect(t.count).toBe(1);
    expect(t.instances[0].journal.id).toBe('v2');
  });

  it('震荡里追涨：ranging + 顺势/突破 edge', () => {
    const t = byId(
      aggregateErrorTypes([mk({ pre_market_regime: 'ranging', pre_edge_source: 'breakout' })]),
      'chop_chase',
    )!;
    expect(t.count).toBe(1);
    // 均值回归在震荡里是对的 → 不算
    expect(byId(aggregateErrorTypes([mk({ pre_market_regime: 'ranging', pre_edge_source: 'mean_reversion' })]), 'chop_chase')?.count)
      .toBe(0);
  });

  it('带负面情绪入场：pre_pain_tags 含负向标签', () => {
    const t = byId(aggregateErrorTypes([mk({ pre_pain_tags: ['fomo', 'calm'] })]), 'negative_emotion_entry')!;
    expect(t.count).toBe(1);
    // 只有正向标签 → 不算
    expect(byId(aggregateErrorTypes([mk({ pre_pain_tags: ['calm'] })]), 'negative_emotion_entry')?.count).toBe(0);
  });

  it('煎熬交易：纠结度 ≤ 2', () => {
    const t = byId(aggregateErrorTypes([mk({ post_struggle_level: 1, post_outcome: 'win' })]), 'agony_trade')!;
    expect(t.count).toBe(1);
    expect(t.instances[0].detail).toContain('却赢了');
  });

  it('危险的幸运：坏决策却赢', () => {
    const t = byId(aggregateErrorTypes([mk({ post_decision_quality: 'bad', post_outcome: 'win' })]), 'lucky_bad_decision')!;
    expect(t.count).toBe(1);
  });

  it('扛出来的赢：赢单路径质量为 dragged_win', () => {
    const t = byId(
      aggregateErrorTypes([mk({
        post_outcome: 'win',
        post_path_first_move: 'immediate_drawdown',
        post_path_drawdown: 'meaningful',
        post_path_win_quality: 'dragged_win',
      })]),
      'dragged_win',
    )!;
    expect(t.count).toBe(1);
    expect(t.instances[0].detail).toContain('上来先水下');
  });

  it('路径失去主动权：上来先水下或有效浮亏', () => {
    const t = byId(
      aggregateErrorTypes([mk({
        post_path_first_move: 'immediate_drawdown',
        post_path_drawdown: 'none_or_shallow',
      })]),
      'lost_path_initiative',
    )!;
    expect(t.count).toBe(1);
    expect(t.applicable).toBe(1);
  });
});

describe('频率 / 趋势 / 排序', () => {
  it('rate = 命中 / 适用', () => {
    const journals = [
      mk({ id: '1', pre_calibration_win_pct: 80, post_outcome: 'loss' }), // 命中
      mk({ id: '2', pre_calibration_win_pct: 80, post_outcome: 'win' }),  // 适用但未命中
      mk({ id: '3', pre_calibration_win_pct: 80, post_outcome: 'loss' }), // 命中
      mk({ id: '4', pre_calibration_win_pct: 80, post_outcome: 'win' }),  // 适用但未命中
    ];
    const t = byId(aggregateErrorTypes(journals), 'overconfident')!;
    expect(t.applicable).toBe(4);
    expect(t.count).toBe(2);
    expect(t.rate).toBeCloseTo(0.5, 5);
  });

  it('趋势：新半段命中率高于旧半段 → 正（在变差）', () => {
    // 旧两笔不命中、新两笔命中（按 post_reviewed_at 排序）
    const journals = [
      mk({ id: 'old1', post_reviewed_at: '2026-01-01T00:00:00Z', pre_calibration_win_pct: 80, post_outcome: 'win' }),
      mk({ id: 'old2', post_reviewed_at: '2026-01-02T00:00:00Z', pre_calibration_win_pct: 80, post_outcome: 'win' }),
      mk({ id: 'new1', post_reviewed_at: '2026-01-03T00:00:00Z', pre_calibration_win_pct: 80, post_outcome: 'loss' }),
      mk({ id: 'new2', post_reviewed_at: '2026-01-04T00:00:00Z', pre_calibration_win_pct: 80, post_outcome: 'loss' }),
    ];
    const t = byId(aggregateErrorTypes(journals), 'overconfident')!;
    expect(t.trend).toBeCloseTo(1, 5); // 新半段 100% − 旧半段 0%
  });

  it('趋势：样本 < 4 → null', () => {
    const t = byId(aggregateErrorTypes([mk({ pre_calibration_win_pct: 80, post_outcome: 'loss' })]), 'overconfident')!;
    expect(t.trend).toBeNull();
  });

  it('按影响分降序：高严重度多次命中的类型排在前', () => {
    const journals = [
      // 过度自信（severity 50）命中 1 次
      mk({ id: 'oc', pre_calibration_win_pct: 80, post_outcome: 'loss' }),
      // 煎熬（severity 15）命中 1 次
      mk({ id: 'ag', post_struggle_level: 1 }),
    ];
    const types = aggregateErrorTypes(journals);
    expect(types[0].id).toBe('overconfident');
    expect(types.findIndex(t => t.id === 'overconfident'))
      .toBeLessThan(types.findIndex(t => t.id === 'agony_trade'));
  });
});

describe('ERROR_FAMILY_META', () => {
  it('六个维度齐备', () => {
    expect(Object.keys(ERROR_FAMILY_META).sort()).toEqual(
      ['calibration', 'discipline', 'falsification', 'mindset', 'premortem', 'structure'],
    );
  });
});
