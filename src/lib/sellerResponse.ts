/** Same observations and zero crossing; strengthen only the negative branch before saturation. */
export function sellerResponse(value: number, gain: number, scale: number): number {
  if (![value,gain,scale].every(Number.isFinite) || !(gain > 0) || !(scale > 0) || Math.abs(value) > scale) return NaN;
  if (value === 0) return 0;
  if (value > 0 || gain === 1 || value === -scale) return value;
  const x = value / scale;
  // tanh(2·atanh(x)) = 2x/(1+x²), including values arbitrarily close to -1.
  return scale * (gain === 2 ? 2*x/(1+x*x) : Math.tanh(gain*Math.atanh(x)));
}
