/**
 * 一维高斯核密度估计。纯函数、无 React，供分布图画平滑轮廓。
 */

/** 线性插值分位数；输入必须已升序。 */
export function quantileSorted(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/** 样本标准差（n − 1）。 */
export function sampleStd(values: number[]) {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

/**
 * 带宽按 Silverman 经验法则：h = 0.9 · min(σ, IQR/1.34) · n^(−1/5)。
 * 取 σ 与 IQR/1.34 的较小者——+38R 这类尾巴会把 σ 撑大、把 −1R 附近的堆抹平，IQR 不会。
 * 退化样本（全相等 / IQR 为 0）退回另一项，两项都为 0 时给一个极小正数，密度仍有限。
 */
export function silvermanBandwidth(values: number[]) {
  const n = values.length;
  if (n === 0) return 1e-3;
  const sorted = [...values].sort((a, b) => a - b);
  const sigma = sampleStd(values);
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  const iqrTerm = iqr / 1.34;
  const spread = sigma > 0 && iqrTerm > 0
    ? Math.min(sigma, iqrTerm)
    : Math.max(sigma, iqrTerm);
  return Math.max(0.9 * spread * n ** (-1 / 5), 1e-3);
}

const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/**
 * f̂(x) = (1 / (n·h)) · Σ φ((x − xᵢ) / h)。用全部样本，包括画在显示区间之外的点：
 * 它们属于这个分布，只是鼓包落在图外。不在 −1R 做镜像修正——墙外确实有 −1.6R 的亏损，
 * 镜像会把可见点位下方的曲线压成零。
 */
export function gaussianKde(values: number[], bandwidth: number) {
  const n = values.length;
  const h = Math.max(bandwidth, 1e-9);
  return (x: number) => {
    if (n === 0) return 0;
    let sum = 0;
    for (const value of values) {
      const z = (x - value) / h;
      sum += Math.exp(-0.5 * z * z);
    }
    return (sum * INV_SQRT_2PI) / (n * h);
  };
}
