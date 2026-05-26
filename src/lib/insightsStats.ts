/**
 * Insights 页统计辅助
 * - Wilson 区间：低样本量下比例的诚实置信区间
 * - 规则有效性净化：减去自然学习曲线 baseline，避免把进步误归因到规则
 */

/** Wilson score interval (95% CI). Returns [lower, upper] both in [0,1]. */
export function wilsonInterval(successes: number, trials: number, z = 1.96): [number, number] {
  if (trials <= 0) return [0, 0];
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials)) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

/** Normal-approximation CI for a mean. Returns [mean, mean] when n=1. */
export function meanConfidenceInterval(values: number[], z = 1.96): [number, number] {
  const finite = values.filter(value => Number.isFinite(value));
  if (finite.length === 0) return [0, 0];
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  if (finite.length === 1) return [mean, mean];
  const variance = finite.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (finite.length - 1);
  const margin = z * Math.sqrt(variance) / Math.sqrt(finite.length);
  return [mean - margin, mean + margin];
}

/** Format a count-delta with a "noise floor" indicator when sample is small. */
export function formatDeltaWithCI(before: number, after: number): {
  delta: number;
  significant: boolean;
  note: string;
} {
  const delta = after - before;
  // Two Poisson rates with equal exposure: difference SE ≈ sqrt(before + after)
  const se = Math.sqrt(before + after);
  const significant = Math.abs(delta) >= 1.96 * se && before + after >= 6;
  let note: string;
  if (before + after < 6) note = '样本太小，可能纯噪声';
  else if (!significant) note = `±${Math.round(1.96 * se)} 噪声内`;
  else note = `95% CI: ${delta > 0 ? '+' : ''}${Math.round(delta - 1.96 * se)} ~ ${delta > 0 ? '+' : ''}${Math.round(delta + 1.96 * se)}`;
  return { delta, significant, note };
}

/**
 * 把规则有效性变化与"全局自然进步"baseline 对比。
 * - patternDeltaPct: 该 pattern 出现次数变化百分比 (after - before) / before
 * - globalDeltaPct: 全部 pattern 出现次数变化百分比（用户整体进步）
 * Returns the "rule-attributable improvement", i.e., the portion of decline beyond baseline.
 */
export function ruleEffectNetOfBaseline(
  patternBefore: number,
  patternAfter: number,
  globalBefore: number,
  globalAfter: number,
): { netDeltaPct: number; baselineDeltaPct: number; ruleAttributablePct: number; note: string } {
  const patternDeltaPct = patternBefore === 0 ? 0 : (patternAfter - patternBefore) / patternBefore;
  const baselineDeltaPct = globalBefore === 0 ? 0 : (globalAfter - globalBefore) / globalBefore;
  const ruleAttributablePct = patternDeltaPct - baselineDeltaPct;
  let note = '';
  if (patternBefore + patternAfter < 6) {
    note = '该模式样本量过小，不显示净效应';
  } else if (ruleAttributablePct < -0.1) {
    note = `下降 ${Math.abs(ruleAttributablePct * 100).toFixed(0)}% 超过自然进步`;
  } else if (ruleAttributablePct > 0.1) {
    note = `比基线还差 ${(ruleAttributablePct * 100).toFixed(0)}%`;
  } else {
    note = '与基线持平 — 难以归因到规则';
  }
  return { netDeltaPct: patternDeltaPct, baselineDeltaPct, ruleAttributablePct, note };
}

/** Brier score for calibration accuracy. Lower is better; 0 = perfect, 0.25 = random. */
export function brierScore(samples: { predProb: number; outcomeWin: boolean }[]): number {
  if (samples.length === 0) return 0;
  const sum = samples.reduce((s, x) => s + Math.pow(x.predProb - (x.outcomeWin ? 1 : 0), 2), 0);
  return sum / samples.length;
}
