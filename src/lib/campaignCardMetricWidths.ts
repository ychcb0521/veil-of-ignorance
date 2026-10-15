/**
 * 战役封面两排指标的列宽：【用户要求】「两排指标统一向左对齐，不必完全占满右边的空间，我喜欢留白；
 * 在左对齐的基础上，能够完整显示即可，不要有太大间隙。」
 *
 * 网格每一列的宽度 = 落在这一列的那几项（9 列时是第 k 项与第 k+9 项；6 列时是第 k、k+6、k+12 项）
 * 在当前时间段全部战役里「指标名宽度」与「读数宽度」的最大值 + 左右内边距，向上取整到偶数 px。
 * 上下各张卡片用同一组列宽，同名项落在同一条竖线上；按整个时间段算，不随排序筛掉的战役变，切换排序时文字不挪。
 *
 * 宽度按字符类别确定性地估算，不在渲染后测 DOM（不闪、不重排、测试里可复现）：
 *   - 读数：11px 等宽。半角字符按栈里最宽的 SF Mono（1266/2048 = 0.6182em）算，其余字符（中文、全角标点）按 1em；
 *   - 指标名：10px，每个字符按 1em。
 * 只会偏宽不会偏窄，任何浏览器里都不会截断；在 Chrome（Menlo）里每个半角多留约 0.18px。
 */

/** 读数字号（px）：与封面的 text-[11px] 一致。 */
export const CARD_METRIC_VALUE_FONT_PX = 11;
/** 指标名字号（px）：与封面的 text-[10px] 一致。 */
export const CARD_METRIC_LABEL_FONT_PX = 10;
/** 每格左右内边距之和（≥ 640px 时 px-2 × 2），另留 4px 余量（盈亏比后的磨损括号有 2px 外边距）。 */
export const CARD_METRIC_CELL_PADDING_X = 20;
/** 等宽字体里一个半角字符的宽度（em）。 */
export const MONO_NARROW_ADVANCE_EM = 0.6182;

/** 等宽字体里按半角宽度排的非 ASCII 字符：镜像止盈的「·」、缺值的「—」、负号「−」。 */
const MONO_NARROW_EXTRA = new Set(['·', '—', '−']);

function isMonoNarrow(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || MONO_NARROW_EXTRA.has(char);
}

/** 读数（11px 等宽）的估算宽度，单位 px。 */
export function estimateCardMetricValueWidth(text: string): number {
  let em = 0;
  for (const char of text) em += isMonoNarrow(char) ? MONO_NARROW_ADVANCE_EM : 1;
  return em * CARD_METRIC_VALUE_FONT_PX;
}

/** 指标名（10px）的估算宽度，单位 px：每个字符 1em。 */
export function estimateCardMetricLabelWidth(text: string): number {
  return [...text].length * CARD_METRIC_LABEL_FONT_PX;
}

/** 向上取整到偶数 px；先减去一点浮点噪声，免得 60.0000001 被抬成 62。 */
function ceilToEven(px: number): number {
  return Math.ceil((px - 1e-6) / 2) * 2;
}

/** 每一项的所需宽度：指标名与全部读数里最宽的那个 + 内边距。列表为空时只看指标名。 */
export function cardMetricItemWidths<K extends string>(
  labels: Readonly<Record<K, string>>,
  rows: Iterable<Readonly<Record<K, string>>>,
): Record<K, number> {
  const keys = Object.keys(labels) as K[];
  const widest = Object.fromEntries(keys.map(key => [key, estimateCardMetricLabelWidth(labels[key])])) as Record<K, number>;
  for (const row of rows) {
    for (const key of keys) {
      const width = estimateCardMetricValueWidth(row[key]);
      if (width > widest[key]) widest[key] = width;
    }
  }
  return Object.fromEntries(keys.map(key => [key, ceilToEven(widest[key] + CARD_METRIC_CELL_PADDING_X)])) as Record<K, number>;
}

/**
 * 按网格列数排好的列宽模板（CSS grid-template-columns 的值）：第 k 列取 order[k]、order[k + n]、order[k + 2n]… 里最宽的一项。
 * order 是格子在卡片上的先后。
 */
export function cardMetricGridTemplate<K extends string>(order: readonly K[], widths: Readonly<Record<K, number>>, columns: number): string {
  const cols = Array.from({ length: columns }, (_, k) => {
    let max = 0;
    for (let i = k; i < order.length; i += columns) max = Math.max(max, widths[order[i]]);
    return max;
  });
  return cols.map(px => `${px}px`).join(' ');
}
