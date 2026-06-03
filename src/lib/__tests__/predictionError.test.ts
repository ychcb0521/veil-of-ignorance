import { describe, it, expect } from 'vitest';
import {
  analyzeTradeError,
  analyzeTrades,
  isAnalyzableTrade,
  summarizeCalibration,
} from '@/lib/predictionError';
import type { TradeJournal } from '@/types/journal';

/** 只填分析函数实际读取的字段，其余无关字段用 cast 跳过。 */
function mk(overrides: Partial<TradeJournal>): TradeJournal {
  return {
    id: 'j1',
    symbol: 'BTCUSDT',
    journal_kind: 'trade',
    order_kind: 'main',
    pre_simulated_time: '2026-01-01T00:00:00.000Z',
    post_reviewed_at: '2026-01-02T00:00:00.000Z',
    post_outcome: 'loss',
    post_realized_pnl: -100,
    post_r_multiple: -1,
    pre_calibration_win_pct: null,
    pre_odds_structure: null,
    exit_falsification_status: null,
    post_decision_quality: null,
    ...overrides,
  } as unknown as TradeJournal;
}

describe('isAnalyzableTrade', () => {
  it('排除：未复盘 / no_entry / 对冲单 / 太难记录', () => {
    expect(isAnalyzableTrade(mk({ post_reviewed_at: null }))).toBe(false);
    expect(isAnalyzableTrade(mk({ post_outcome: 'no_entry' }))).toBe(false);
    expect(isAnalyzableTrade(mk({ order_kind: 'hedge' }))).toBe(false);
    expect(isAnalyzableTrade(mk({ journal_kind: 'no_trade' }))).toBe(false);
  });
  it('纳入：已复盘的真实 win/loss 主力单', () => {
    expect(isAnalyzableTrade(mk({ post_outcome: 'win' }))).toBe(true);
    expect(isAnalyzableTrade(mk({ post_outcome: 'loss' }))).toBe(true);
  });
});

describe('analyzeTradeError 误差计算', () => {
  it('过度自信：预测 80% 却亏损 → calibrationGap 0.8、overconfident', () => {
    const a = analyzeTradeError(mk({ pre_calibration_win_pct: 80, post_outcome: 'loss' }))!;
    expect(a.calibrationGap).toBeCloseTo(0.8, 5);
    expect(a.overconfident).toBe(true);
  });

  it('R 缺口：目标 R3 实际 -1R → rShortfall 4', () => {
    const a = analyzeTradeError(mk({ pre_odds_structure: 'r3_open', post_r_multiple: -1 }))!;
    expect(a.predictedTargetR).toBe(3);
    expect(a.rShortfall).toBe(4);
  });

  it('证伪晚反应 → falsificationLate', () => {
    const a = analyzeTradeError(mk({ exit_falsification_status: 'triggered_late' }))!;
    expect(a.falsificationLate).toBe(true);
  });

  it('盲区候选：亏损且证伪信号从未触发', () => {
    const a = analyzeTradeError(mk({ post_outcome: 'loss', exit_falsification_status: 'not_triggered' }))!;
    expect(a.blindSpotCandidate).toBe(true);
  });

  it('危险幸运：坏决策却赢', () => {
    const a = analyzeTradeError(mk({ post_outcome: 'win', post_decision_quality: 'bad' }))!;
    expect(a.luckyBadDecision).toBe(true);
  });

  it('breakeven 不进校准（calibrationGap 为 null）', () => {
    const a = analyzeTradeError(mk({ post_outcome: 'breakeven', pre_calibration_win_pct: 70 }))!;
    expect(a.actualWin).toBeNull();
    expect(a.calibrationGap).toBeNull();
  });
});

describe('analyzeTrades 排序与 summarizeCalibration', () => {
  const journals = [
    mk({ id: 'small', pre_calibration_win_pct: 55, post_outcome: 'loss' }), // gap 0.55
    mk({
      id: 'big',
      pre_calibration_win_pct: 90,
      post_outcome: 'loss',
      exit_falsification_status: 'not_triggered',
    }), // gap 0.9 + 盲区 + 过度自信
    mk({ id: 'unreviewed', post_reviewed_at: null }), // 被过滤
  ];

  it('按 errorScore 从大到小排序，过滤不可分析项', () => {
    const out = analyzeTrades(journals);
    expect(out.map(a => a.journal.id)).toEqual(['big', 'small']);
  });

  it('汇总：过度自信缺口 = 平均预测胜率 − 实际胜率', () => {
    const out = analyzeTrades(journals);
    const s = summarizeCalibration(out);
    expect(s.reviewedCount).toBe(2);
    expect(s.calibratedCount).toBe(2);
    // 平均预测 (55+90)/2 = 72.5；实际胜率 0%（两笔都亏）
    expect(s.avgPredictedWinPct).toBeCloseTo(72.5, 5);
    expect(s.actualWinRatePct).toBe(0);
    expect(s.overconfidenceGapPP).toBeCloseTo(72.5, 5);
    expect(s.blindSpotCount).toBe(1);
  });
});
