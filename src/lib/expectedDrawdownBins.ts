/**
 * 【用户要求】预期回撤的柱状图：柱子按「预期回撤百分比的倒数」等间距分档。
 *
 * 倒数取 100 ÷ D%（D = 2% → 50）：价格回撤多少个 D 才走完 100%，也就是止损距离能被开仓价容下几次。
 * 在 D 上等距分档时，止损很紧的战役（0.5%、1%、2%）全挤在最左一根柱里；换成倒数后它们被拉开，
 * 而回撤很宽的战役（10%、20%）自然聚到左端——要比较的正是「止损有多紧」。
 *
 * 档宽取不超过 12 根柱的最细整齐步长（1、2、2.5、5 × 10ⁿ），档从步长的整数倍起算，所以同一批数据每次分出的档都一样。
 * 中间没有战役的档也保留空柱：「这一段 0 场」本身就是结论。
 * 极少数止损特别紧的战役会把倒数拉到很远：样本够多（≥ 20）且最大值远超 p95 时，
 * 右端收在 p95 附近，更远的并进最后一根「≥ 上界」柱，免得中间几十根空柱把有数的柱压扁。
 */

export type ExpectedDrawdownBin = {
  /** 柱序号，从 0 起，从左到右按倒数升序。 */
  index: number;
  /** 这一档倒数的下界（含）。 */
  lower: number;
  /** 这一档倒数的上界（不含）；最后一根溢出柱为 Infinity。 */
  upper: number;
  label: string;
  /** 对应的预期回撤区间文案（倒数大 = 回撤小），如「2.00%–4.00%」。 */
  drawdownLabel: string;
};

export type ExpectedDrawdownBinning = {
  bins: ExpectedDrawdownBin[];
  step: number;
  /** 预期回撤（百分点，正数）→ 所在柱序号；非正或非有限值给 null。 */
  binOf: (drawdownPct: number) => number | null;
};

/** 窄屏上柱脚还放得下两行字的上限；在这个上限内取最细的整齐步长。 */
const MAX_BIN_COUNT = 12;
const OVERFLOW_MIN_SAMPLES = 20;

export function drawdownReciprocal(drawdownPct: number): number | null {
  return Number.isFinite(drawdownPct) && drawdownPct > 0 ? 100 / drawdownPct : null;
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function tidy(value: number): number {
  return Number(value.toPrecision(12));
}

/** 档界按步长的小数位印：步长 2.5 印一位，步长 5 不带小数。 */
function formatReciprocal(value: number, step: number): string {
  const digits = Math.min(3, String(tidy(step)).split('.')[1]?.length ?? 0);
  return tidy(value).toFixed(digits);
}

function formatDrawdown(reciprocal: number): string {
  return `${(100 / reciprocal).toFixed(2)}%`;
}

function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function buildExpectedDrawdownBins(drawdownPcts: readonly number[]): ExpectedDrawdownBinning {
  const reciprocals = drawdownPcts
    .map(drawdownReciprocal)
    .filter((value): value is number => value != null)
    .sort((left, right) => left - right);

  if (reciprocals.length === 0) {
    return { bins: [], step: 1, binOf: () => null };
  }

  const min = reciprocals[0];
  const max = reciprocals[reciprocals.length - 1];
  const p95 = quantile(reciprocals, 0.95);
  const useOverflow = reciprocals.length >= OVERFLOW_MIN_SAMPLES && max > p95 * 1.5;
  const top = useOverflow ? p95 : max;

  let step = niceStep((top - min) / MAX_BIN_COUNT || top / MAX_BIN_COUNT);
  let start = tidy(Math.floor(min / step) * step);
  let end = tidy(Math.floor(top / step) * step + step);
  while (Math.round((end - start) / step) > MAX_BIN_COUNT) {
    step = niceStep(step * 1.5);
    start = tidy(Math.floor(min / step) * step);
    end = tidy(Math.floor(top / step) * step + step);
  }
  const regularCount = Math.max(1, Math.round((end - start) / step));
  const overflow = useOverflow && max >= end;

  const bins: ExpectedDrawdownBin[] = Array.from({ length: regularCount }, (_, index) => {
    const lower = tidy(start + index * step);
    const upper = tidy(lower + step);
    return {
      index,
      lower,
      upper,
      label: `${formatReciprocal(lower, step)}–${formatReciprocal(upper, step)}`,
      drawdownLabel: lower > 0 ? `${formatDrawdown(upper)}–${formatDrawdown(lower)}` : `≥${formatDrawdown(upper)}`,
    };
  });
  if (overflow) {
    bins.push({
      index: regularCount,
      lower: end,
      upper: Infinity,
      label: `≥${formatReciprocal(end, step)}`,
      drawdownLabel: `≤${formatDrawdown(end)}`,
    });
  }

  const lastIndex = bins.length - 1;
  const binOf = (drawdownPct: number) => {
    const reciprocal = drawdownReciprocal(drawdownPct);
    if (reciprocal == null) return null;
    const index = Math.floor(tidy((reciprocal - start) / step));
    return Math.min(lastIndex, Math.max(0, index));
  };

  return { bins, step, binOf };
}
