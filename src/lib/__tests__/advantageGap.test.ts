import { describe, expect, it } from 'vitest';
import { breakEvenWinRate, computeAdvantageGap, computeBankableRatio } from '../advantageGap';

describe('computeAdvantageGap', () => {
  it('多头 K < S < T：P₀ 为已走过的距离占全程的比例', () => {
    // S 位于 K 与 T 的正中 → 市场免费给的胜率是 50%，赔率恰为 1
    const result = computeAdvantageGap(100, 90, 110, 0.6);
    expect(result).toEqual({
      valid: true, direction: 'long', baseline: 0.5, payoffRatio: 1,
      stopBreached: false, gap: expect.closeTo(0.1, 12),
    });
  });

  it('空头 T < S < K：同一套绝对值公式成立', () => {
    const result = computeAdvantageGap(100, 110, 90, 0.6);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.direction).toBe('short');
    expect(result.baseline).toBeCloseTo(0.5, 12);
    expect(result.gap).toBeCloseTo(0.1, 12);
  });

  it('价格逼近目标时基线抬高、优势被吃掉', () => {
    const early = computeAdvantageGap(92, 90, 110, 0.6);
    const late = computeAdvantageGap(108, 90, 110, 0.6);
    expect(early.valid && early.baseline).toBeCloseTo(0.1, 12);
    expect(late.valid && late.baseline).toBeCloseTo(0.9, 12);
    // 同一个主观胜率，越晚进场 gap 越小，直至转负
    expect(early.valid && early.gap).toBeCloseTo(0.5, 12);
    expect(late.valid && late.gap).toBeCloseTo(-0.3, 12);
  });

  it('P 未填写时只给基线，不给 gap', () => {
    const result = computeAdvantageGap(100, 90, 110, null);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.baseline).toBeCloseTo(0.5, 12);
    expect(result.gap).toBeNull();
  });

  it('T === K 判为退化，不出数字', () => {
    expect(computeAdvantageGap(100, 100, 100, 0.6)).toEqual({ valid: false, reason: 'degenerate' });
  });

  it('S 越界时 P₀ 如实越界，不再判「方向不成立」', () => {
    // 多头 K=90,T=110。S 冲破止损 → P₀ 为负（读数保留，说明跑出区间多远）
    const brokeStop = computeAdvantageGap(80, 90, 110, 0.6);
    expect(brokeStop.valid).toBe(true);
    if (brokeStop.valid) expect(brokeStop.baseline).toBeCloseTo(-0.5, 12);
    // S 越过目标 → P₀ > 1
    const pastTarget = computeAdvantageGap(120, 90, 110, 0.6);
    expect(pastTarget.valid).toBe(true);
    if (pastTarget.valid) expect(pastTarget.baseline).toBeCloseTo(1.5, 12);
    // S 恰在目标上 → P₀ = 1（b = 0，仍可算）
    const atTarget = computeAdvantageGap(110, 90, 110, 0.6);
    expect(atTarget.valid && atTarget.baseline).toBe(1);
    // S 恰在止损上 → 风险距离为 0、赔率 b 无定义，仍判退化
    expect(computeAdvantageGap(90, 90, 110, 0.6)).toEqual({ valid: false, reason: 'degenerate' });
  });

  it('触及止损后不出 gap——负 P₀ 绝不能把优势虚增', () => {
    // 用户给的反例：K=90、T=110、S 跌到 80，P=72%
    // 若照 gap = P − P₀ 硬算 = 0.72 −(−0.5) = +122%，破了止损反而「优势最大」。
    // 正解：S 已越过 K，「先摸到 T」这个事件已判负（真实概率 0），线性式失效，不出数。
    const r = computeAdvantageGap(80, 90, 110, 0.72);
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.stopBreached).toBe(true);
    expect(r.gap).toBeNull();
    expect(r.baseline).toBeCloseTo(-0.5, 12); // P₀ 越界值仍保留，用于说明跑出多远
  });

  it('区间内照常出 gap，止损标志为假', () => {
    const r = computeAdvantageGap(100, 90, 110, 0.72);
    expect(r.valid && r.stopBreached).toBe(false);
    expect(r.valid && r.gap).toBeCloseTo(0.22, 12);
  });

  it('越过目标 T 那一侧无需特判：P₀ > 1 自然读作优势已耗尽', () => {
    const r = computeAdvantageGap(120, 90, 110, 0.72);
    expect(r.valid && r.stopBreached).toBe(false);
    expect(r.valid && r.baseline).toBeCloseTo(1.5, 12);
    expect(r.valid && r.gap).toBeCloseTo(-0.78, 12); // 负值 → 「优势已耗尽」
  });

  it('空头对称：S 涨过止损 K 同样不出 gap', () => {
    // 空头 K=110、T=90；S 涨到 120 已越过止损
    const r = computeAdvantageGap(120, 110, 90, 0.72);
    expect(r.valid && r.stopBreached).toBe(true);
    expect(r.valid && r.gap).toBeNull();
  });

  it('方向由 T 相对 K 定义，与 S 的位置无关', () => {
    expect(computeAdvantageGap(80, 90, 110, null).valid && computeAdvantageGap(80, 90, 110, null).direction).toBe('long');
    expect(computeAdvantageGap(200, 110, 90, null).valid && computeAdvantageGap(200, 110, 90, null).direction).toBe('short');
  });

  it('动态赔率 b =（T − S）÷（S − K），多空两向均为正', () => {
    // 多头：上方还有 20、下方风险 10 → b = 2
    const long = computeAdvantageGap(100, 90, 120, null);
    expect(long.valid && long.payoffRatio).toBeCloseTo(2, 12);
    // 空头：下方还有 20、上方风险 10 → 同样 b = 2
    const short = computeAdvantageGap(100, 110, 80, null);
    expect(short.valid && short.payoffRatio).toBeCloseTo(2, 12);
  });

  it('恒等式 1 ÷ (1 + b) ≡ P₀——盈亏平衡胜率就是市场免费给的胜率', () => {
    const cases: Array<[number, number, number]> = [
      [100, 90, 110], [100, 90, 120], [100, 95, 130],
      [100, 110, 80], [100, 105, 70], [0.0178, 0.0176, 0.0197],
    ];
    for (const [s, k, t] of cases) {
      const r = computeAdvantageGap(s, k, t, null);
      expect(r.valid).toBe(true);
      if (!r.valid) continue;
      expect(breakEvenWinRate(r.payoffRatio)).toBeCloseTo(r.baseline, 12);
    }
  });

  it('价格逼近目标时赔率坍缩、平衡胜率抬高', () => {
    const early = computeAdvantageGap(92, 90, 110, null);
    const late = computeAdvantageGap(108, 90, 110, null);
    expect(early.valid && early.payoffRatio).toBeCloseTo(9, 12);   // 赚 18 亏 2
    expect(late.valid && late.payoffRatio).toBeCloseTo(2 / 18, 12); // 赚 2 亏 18
    expect(breakEvenWinRate(early.valid ? early.payoffRatio : 0)).toBeCloseTo(0.1, 12);
    expect(breakEvenWinRate(late.valid ? late.payoffRatio : 0)).toBeCloseTo(0.9, 12);
  });

  it('breakEvenWinRate 的边界：b=0 需要 100%，b≤−1 无意义', () => {
    expect(breakEvenWinRate(0)).toBe(1);
    expect(breakEvenWinRate(-1)).toBeNull();
    expect(breakEvenWinRate(Number.NaN)).toBeNull();
  });

  it('b_可落袋：此刻立即止盈能拿到几个 R', () => {
    // 开仓 100、止损 90 → 每 R = 10；现价 115 → 已浮盈 1.5R
    expect(computeBankableRatio(115, 100, 90)).toBeCloseTo(1.5, 12);
    // 现价回落到开仓价下方 → 落袋即亏
    expect(computeBankableRatio(95, 100, 90)).toBeCloseTo(-0.5, 12);
    // 恰好在开仓价 → 0R
    expect(computeBankableRatio(100, 100, 90)).toBe(0);
    // 跌到止损 → −1R，正是「预期最大亏损」的定义
    expect(computeBankableRatio(90, 100, 90)).toBeCloseTo(-1, 12);
  });

  it('b_可落袋 与「未实现盈亏 ÷ 预期最大亏损」等价——数量会约掉', () => {
    const entry = 100;
    const k = 92;
    const s = 118;
    for (const qty of [0.5, 3, 250]) {
      const unrealized = (s - entry) * qty;
      // L = 名义仓位 × 价距 ÷ 开仓价 = qty × 价距
      const expectedMaxLoss = (qty * entry) * ((entry - k) / entry);
      expect(computeBankableRatio(s, entry, k)).toBeCloseTo(unrealized / expectedMaxLoss, 12);
    }
  });

  it('无多单或止损不在开仓价下方时不出数', () => {
    expect(computeBankableRatio(115, null, 90)).toBeNull();   // 没有多单
    expect(computeBankableRatio(115, 100, 100)).toBeNull();   // 价距为 0
    expect(computeBankableRatio(115, 100, 110)).toBeNull();   // 止损高于开仓价
    expect(computeBankableRatio(Number.NaN, 100, 90)).toBeNull();
  });

  it('缺少任一价格或拿到非有限数时判为未完成', () => {
    expect(computeAdvantageGap(null, 90, 110, 0.6)).toEqual({ valid: false, reason: 'incomplete' });
    expect(computeAdvantageGap(100, null, 110, 0.6)).toEqual({ valid: false, reason: 'incomplete' });
    expect(computeAdvantageGap(100, 90, null, 0.6)).toEqual({ valid: false, reason: 'incomplete' });
    expect(computeAdvantageGap(Number.NaN, 90, 110, 0.6)).toEqual({ valid: false, reason: 'incomplete' });
  });
});
