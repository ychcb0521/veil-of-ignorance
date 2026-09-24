/**
 * 战役封面指标行的列宽：【用户要求】「封面上的指标的分布要做得非常均匀、美观，不要有没必要的空隙」。
 *
 * 每一项的列宽 = 当前时间段里的全部战役（不是视口里的几张；也不随排序筛掉的那几场变，切换排序时文字不挪）里，
 * 这一项「指标名宽度」与「读数宽度」的最大值 + 左右内边距 20px，向上取整到偶数 px；列表空时只看指标名。
 * 上下各张卡同一项同宽，同名项仍落在同一条竖线上；列表里没出现的极端读数不再占位。
 *
 * 宽度按字符类别确定性地估算，不在渲染后测 DOM（不闪、不重排、测试里可复现）：
 *   - 读数：11px 等宽 font-mono font-medium。封面上的 font-mono 是 Tailwind 默认的等宽字体栈
 *     「ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, …」（index.css 里 @layer base 的 .font-mono { 'JetBrains Mono' }
 *     被工具类盖掉，不生效）。同一个栈在不同浏览器里落到不同的字体，半角字符的宽度各不相同：
 *       · Safari / iPadOS / iOS 把 ui-monospace 解析成 SF Mono：1266/2048 = 0.61816em，11px 下每字 6.80px——栈里最宽；
 *       · macOS 上的 Chrome 不认 ui-monospace，回退到 Menlo：1233/2048 = 0.60205em（实测每字 6.625px）；
 *       · Consolas 0.55em，Liberation Mono / DejaVu Sans Mono 约 0.60em，都比 SF Mono 窄。
 *     所以 ASCII 以及「·」「—」「−」一律按 SF Mono 的 0.6182em 算；只按 Chrome 实测的 Menlo 算，Safari 里撑满列宽的读数会被省略号截断。
 *     其余字符（中文、全角标点等）按 1em = 11px 算——中文在任何回退字体里都是 1em，认不出的字符宁可算宽。
 *   - 指标名：10px 无衬线。现有指标名全是中文，每字 1em = 10px；万一出现拉丁字母也按 1em 算（Inter 最宽的字母不到 1em）。
 * 按栈里最宽的 SF Mono 算，估算才「只会偏宽不会偏窄」（不小于字形宽度之和），任何浏览器里任何一格都不会被截断：
 * 浏览器排版时把整串宽度向上取整到 1/64px，而列宽是整数 px、内容区也是整数 px，估算不小于字形宽度之和就一定装得下。
 * 代价是在 Chrome 里每个半角多留约 0.175px，列宽最多宽出 2px。
 */

/** 读数字号（px）：与封面的 text-[11px] 一致。 */
export const CARD_METRIC_VALUE_FONT_PX = 11;
/** 指标名字号（px）：与封面的 text-[10px] 一致。 */
export const CARD_METRIC_LABEL_FONT_PX = 10;
/** 每格左右内边距之和（px-2.5 × 2）。 */
export const CARD_METRIC_CELL_PADDING_X = 20;
/** 等宽字体里一个半角字符的宽度（em）：按栈里最宽的 SF Mono，1266 ÷ 2048 = 0.61816，向上取到 0.6182（11px 下 6.80px）。 */
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

/** 指标名（10px 无衬线）的估算宽度，单位 px：每个字符 1em。 */
export function estimateCardMetricLabelWidth(text: string): number {
  return [...text].length * CARD_METRIC_LABEL_FONT_PX;
}

/** 向上取整到偶数 px；先减去一点浮点噪声，免得 60.0000001 被抬成 62。 */
function ceilToEven(px: number): number {
  return Math.ceil((px - 1e-6) / 2) * 2;
}

/**
 * 整个列表每一项的列宽：指标名与这一项所有读数里最宽的那个 + 左右内边距，向上取整到偶数 px。
 * labels 给出每项的指标名（键就是项），rows 是列表里每张卡片的读数（与卡片上显示的字符串逐字相同）。
 * 列表为空时每项只看指标名。
 */
export function cardMetricColumnWidths<K extends string>(
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
