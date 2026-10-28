/** MBI uses price alone. Never use a span EMA or standardise z by its own variance. */
export const MBI_N = 25;
export const MBI_Z0 = 1.25;
export const MBI_TOOLTIP = 'MBI：价格偏离指数均线多少个无趋势标准差，经 tanh 压到 −1 到 1。≥ 0.8：买方占优确立（无趋势时约 8.5% 的 K 线能达到）；0.5–0.8：偏向买方；−0.5–0.5：无明显优势；≤ −0.8：卖方占优。接近 ±1 是饱和，不代表反转。';

export interface MbiParams { MBI_N?: number; MBI_Z0?: number }
export const mbiNOf = (params: MbiParams = {}) => params.MBI_N ?? MBI_N;
export const mbiZ0Of = (params: MbiParams = {}) => params.MBI_Z0 ?? MBI_Z0;

export function validateMbiParams(n: number, z0: number): void {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('MBI_N 必须是正整数（K 线根数）');
  if (!Number.isFinite(z0) || z0 <= 0) throw new Error('MBI_Z0 必须大于 0');
}

/**
 * Ascending, closed candles only; callers own the anchor/close-time cut.
 * The seed uses the first n returns, all inside the hidden 5n warmup.
 * Invalid prices stay missing: never carry a close forward or add a zero return.
 * warmup=false is solely for verifying the published recurrence, not production.
 */
export function computeMbi(closes: ArrayLike<number>, params: MbiParams = {}, options: { warmup?: boolean } = {}) {
  const n = mbiNOf(params), z0 = mbiZ0Of(params);
  validateMbiParams(n, z0);
  const z = new Float64Array(closes.length).fill(NaN);
  const mbi = new Float64Array(closes.length).fill(NaN);
  const alpha = 1 / n, kappa = 1 / Math.sqrt(alpha * (2 - alpha));
  const x = Float64Array.from(closes, c => c > 0 && Number.isFinite(c) ? Math.log(c) : NaN);
  const first = x.findIndex(Number.isFinite);
  if (first < 0) return { z, mbi, kappa, initialVariance: null };
  let seed = 0, count = 0, seedEnd = first;
  for (let k = first + 1; k < x.length && count < n; k++) {
    if (Number.isFinite(x[k]) && Number.isFinite(x[k - 1])) {
      seed += (x[k] - x[k - 1]) ** 2;
      count++;
      seedEnd = k;
    }
  }
  if (count < n) return { z, mbi, kappa, initialVariance: null };
  const initialVariance = seed / n;
  let M = x[first], S = initialVariance;
  const warmupEnd = Math.max(first + 5 * n, seedEnd + 1);
  for (let t = first + 1; t < x.length; t++) {
    if (!Number.isFinite(x[t])) continue;
    const hasReturn = Number.isFinite(x[t - 1]);
    // Calculate with M(t-1), S(t-1), before either state is updated.
    if (hasReturn && (options.warmup === false || t >= warmupEnd)) {
      z[t] = S > 0 ? (x[t] - M) / (kappa * Math.sqrt(S)) : 0;
      mbi[t] = Math.tanh(z[t] / z0);
    }
    M = (1 - alpha) * M + alpha * x[t];
    if (hasReturn) {
      const r = x[t] - x[t - 1];
      S = (1 - alpha) * S + alpha * r * r;
    }
  }
  return { z, mbi, kappa, initialVariance };
}
