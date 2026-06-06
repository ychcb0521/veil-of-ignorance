import { describe, it, expect } from 'vitest';
import {
  aggregateStructureMaturity,
  decideMaturityTier,
  type StructureMaturityResult,
  type StructureMaturity,
} from '@/lib/structureMaturity';
import type { TradeJournal } from '@/types/journal';

let seq = 0;
/** 一笔「押注某结构并已复盘」的最小交易；只填聚合实际读取的字段。 */
function bet(
  edge: string | null,
  winPct: number | null,
  outcome: 'win' | 'loss' | 'breakeven',
  dayIdx: number,
  extra: Partial<TradeJournal> = {},
): TradeJournal {
  seq += 1;
  const day = String(dayIdx).padStart(2, '0');
  const iso = `2026-02-${day}T00:00:00.000Z`;
  return {
    id: `j${seq}`,
    symbol: 'BTCUSDT',
    journal_kind: 'trade',
    order_kind: 'main',
    pre_edge_source: edge,
    pre_real_time: iso,
    post_reviewed_at: iso,
    created_at: iso,
    pre_calibration_win_pct: winPct,
    post_outcome: outcome,
    post_r_multiple: outcome === 'win' ? 2 : outcome === 'loss' ? -1 : 0,
    ...extra,
  } as unknown as TradeJournal;
}

const byEdge = (r: StructureMaturityResult, edge: string): StructureMaturity | undefined =>
  r.structures.find(s => s.edge === edge);

/** 准且稳：高预测命中、低预测落空，|误差| 恒定 → Brier 极低、趋势平。 */
const matureSet = (): TradeJournal[] => [
  bet('breakout', 80, 'win', 1),
  bet('breakout', 80, 'win', 2),
  bet('breakout', 80, 'win', 3),
  bet('breakout', 80, 'win', 4),
  bet('breakout', 20, 'loss', 5),
  bet('breakout', 20, 'loss', 6),
];

describe('aggregateStructureMaturity · 分桶与纳入', () => {
  it('空输入 → 空目录', () => {
    expect(aggregateStructureMaturity([])).toEqual({ structures: [], matured: [] });
  });

  it('按 edge 源头分桶；成熟在前', () => {
    const r = aggregateStructureMaturity([
      ...matureSet(),
      bet('mean_reversion', 70, 'win', 7),
      bet('mean_reversion', 70, 'loss', 8),
      bet('mean_reversion', 70, 'win', 9),
    ]);
    expect(r.structures.map(s => s.edge)).toContain('breakout');
    expect(r.structures.map(s => s.edge)).toContain('mean_reversion');
    // 成熟（breakout）排在混沌（mean_reversion，样本不足）前面。
    expect(r.structures[0].edge).toBe('breakout');
  });

  it('排除：对冲单 / 无 edge / 未复盘 / 未入场', () => {
    const r = aggregateStructureMaturity([
      bet('breakout', 80, 'win', 1, { order_kind: 'hedge' }),
      bet(null, 80, 'win', 2),
      bet('breakout', 80, 'win', 3, { post_reviewed_at: null }),
      bet('breakout', 80, 'win', 4, { post_outcome: 'no_entry' as TradeJournal['post_outcome'] }),
    ]);
    expect(r.structures).toEqual([]);
  });
});

describe('成熟度判档', () => {
  it('成熟：准（Brier 低）且稳 → mature，进入「成熟结构」清单', () => {
    const r = aggregateStructureMaturity(matureSet());
    const t = byEdge(r, 'breakout')!;
    expect(t.calibratedN).toBe(6);
    expect(t.brier).toBeCloseTo(0.04, 5);
    expect(t.actualWinRatePct).toBeCloseTo(66.6667, 2);
    expect(t.avgPredictedWinPct).toBeCloseTo(60, 5);
    expect(t.tier).toBe('mature');
    expect(r.matured.map(s => s.edge)).toEqual(['breakout']);
  });

  it('混沌：自信却屡屡落空（Brier 高）→ chaos，且主导误差为过度自信', () => {
    // 给齐结构止损 + 可证伪信号，隔离出「过度自信」这一维度（否则会同时命中「无证伪点开仓」）。
    const F: Partial<TradeJournal> = {
      pre_stop_quality: 'structural',
      pre_falsification_signal: '跌破前低',
      pre_planned_stop_loss: 1,
    };
    const r = aggregateStructureMaturity([
      bet('breakout', 80, 'win', 1, F),
      bet('breakout', 80, 'loss', 2, F),
      bet('breakout', 80, 'win', 3, F),
      bet('breakout', 80, 'loss', 4, F),
      bet('breakout', 80, 'win', 5, F),
      bet('breakout', 80, 'loss', 6, F),
    ]);
    const t = byEdge(r, 'breakout')!;
    expect(t.brier).toBeGreaterThan(0.25);
    expect(t.tier).toBe('chaos');
    expect(t.dominantError?.id).toBe('overconfident');
    expect(r.matured).toEqual([]);
  });

  it('成形中：Brier 在基线附近（0.18–0.25）→ forming', () => {
    const r = aggregateStructureMaturity([
      bet('breakout', 65, 'win', 1),
      bet('breakout', 65, 'win', 2),
      bet('breakout', 65, 'win', 3),
      bet('breakout', 65, 'win', 4),
      bet('breakout', 65, 'loss', 5),
      bet('breakout', 65, 'loss', 6),
    ]);
    const t = byEdge(r, 'breakout')!;
    expect(t.brier).toBeGreaterThan(0.18);
    expect(t.brier).toBeLessThanOrEqual(0.25);
    expect(t.tier).toBe('forming');
  });

  it('样本不足（< 5 校准样本）→ chaos，理由提示攒样本', () => {
    const r = aggregateStructureMaturity([
      bet('mean_reversion', 70, 'win', 1),
      bet('mean_reversion', 70, 'loss', 2),
      bet('mean_reversion', 70, 'win', 3),
    ]);
    const t = byEdge(r, 'mean_reversion')!;
    expect(t.calibratedN).toBe(3);
    expect(t.tier).toBe('chaos');
    expect(t.tierReason).toContain('样本');
  });
});

describe('R 兑现缺口', () => {
  it('目标 R3、实际 -1R → 缺口 4R', () => {
    const r = aggregateStructureMaturity([
      bet('breakout', 60, 'loss', 1, { pre_odds_structure: 'r3_open', post_r_multiple: -1 }),
    ]);
    expect(byEdge(r, 'breakout')!.rShortfall).toBeCloseTo(4, 5);
  });
});

describe('止 · 死法门（闭环完整度）', () => {
  it('胜率准但亏损多从后门走（死法不在预案内）→ 压回 forming，不给毕业', () => {
    const r = aggregateStructureMaturity([
      bet('breakout', 80, 'win', 1),
      bet('breakout', 80, 'win', 2),
      bet('breakout', 80, 'win', 3),
      bet('breakout', 80, 'win', 4),
      bet('breakout', 20, 'loss', 5, { exit_falsification_status: 'not_triggered' }),
      bet('breakout', 20, 'loss', 6, { exit_falsification_status: 'not_triggered' }),
      bet('breakout', 20, 'loss', 7, { exit_falsification_status: 'not_triggered' }),
    ]);
    const t = byEdge(r, 'breakout')!;
    expect(t.brier).toBeCloseTo(0.04, 5); // 胜率本身是准的
    expect(t.judgedDeaths).toBe(3);
    expect(t.deathBack).toBe(3);
    expect(t.backDoorDeathRate).toBeCloseTo(1, 5);
    expect(t.tier).toBe('forming'); // 被止损闭环一票压档
    expect(t.tierReason).toContain('预案外');
    expect(r.matured).toEqual([]);
  });

  it('胜率准且亏损从前门走（按预案触发）→ 正常毕业为 mature', () => {
    const r = aggregateStructureMaturity([
      bet('breakout', 80, 'win', 1),
      bet('breakout', 80, 'win', 2),
      bet('breakout', 80, 'win', 3),
      bet('breakout', 80, 'win', 4),
      bet('breakout', 20, 'loss', 5, { exit_falsification_status: 'triggered_reacted' }),
      bet('breakout', 20, 'loss', 6, { exit_falsification_status: 'triggered_reacted' }),
      bet('breakout', 20, 'loss', 7, { exit_falsification_status: 'triggered_reacted' }),
    ]);
    const t = byEdge(r, 'breakout')!;
    expect(t.deathFront).toBe(3);
    expect(t.frontDoorDeathRate).toBeCloseTo(1, 5);
    expect(t.backDoorDeathRate).toBeCloseTo(0, 5);
    expect(t.tier).toBe('mature');
    expect(r.matured.map(s => s.edge)).toEqual(['breakout']);
  });

  it('未评价证伪状态的亏损不计入死法分母', () => {
    const r = aggregateStructureMaturity([
      bet('breakout', 80, 'win', 1),
      bet('breakout', 80, 'win', 2),
      bet('breakout', 20, 'loss', 3), // 无 exit_falsification_status
    ]);
    const t = byEdge(r, 'breakout')!;
    expect(t.judgedDeaths).toBe(0);
    expect(t.backDoorDeathRate).toBeNull();
    expect(t.frontDoorDeathRate).toBeNull();
  });
});

describe('decideMaturityTier 纯函数', () => {
  it('样本不足 → chaos', () => {
    expect(decideMaturityTier({ calibratedN: 3, brier: 0.05, recentErr: 0.2, errorTrend: 0 }).tier)
      .toBe('chaos');
  });
  it('准且稳 → mature', () => {
    expect(decideMaturityTier({ calibratedN: 6, brier: 0.1, recentErr: 0.2, errorTrend: 0 }).tier)
      .toBe('mature');
  });
  it('准但在恶化 → 退为 forming（不给成熟）', () => {
    expect(decideMaturityTier({ calibratedN: 6, brier: 0.1, recentErr: 0.2, errorTrend: 0.1 }).tier)
      .toBe('forming');
  });
  it('误差大且不在收敛 → chaos', () => {
    expect(decideMaturityTier({ calibratedN: 6, brier: 0.4, recentErr: 0.5, errorTrend: 0 }).tier)
      .toBe('chaos');
  });
  it('误差大但在收敛 → forming', () => {
    expect(decideMaturityTier({ calibratedN: 6, brier: 0.4, recentErr: 0.5, errorTrend: -0.1 }).tier)
      .toBe('forming');
  });
  it('止 后门死法过半且样本足 → 即使准也压回 forming', () => {
    expect(
      decideMaturityTier({ calibratedN: 6, brier: 0.1, recentErr: 0.2, errorTrend: 0, backDoorRate: 0.6, judgedDeaths: 3 }).tier,
    ).toBe('forming');
  });
  it('止 后门死法占比高但样本不足（<3）→ 不压档，仍 mature', () => {
    expect(
      decideMaturityTier({ calibratedN: 6, brier: 0.1, recentErr: 0.2, errorTrend: 0, backDoorRate: 1, judgedDeaths: 2 }).tier,
    ).toBe('mature');
  });
  it('止 后门死法占比低（前门为主）→ mature', () => {
    expect(
      decideMaturityTier({ calibratedN: 6, brier: 0.1, recentErr: 0.2, errorTrend: 0, backDoorRate: 0.25, judgedDeaths: 4 }).tier,
    ).toBe('mature');
  });
});
