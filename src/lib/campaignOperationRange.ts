/**
 * 战役列表的「操作时间段」筛选。
 *
 * 口径固定为**客观操作时间**（campaignOperationTime）——不是战役的开仓/平仓时间，
 * 也不受无知之幕时间机器的模拟时钟影响：统计要回答「我在这段真实日子里打得怎么样」，
 * 用模拟时间切会把同一场战役切到别的月份去。
 *
 * 自然日按 UTC+8 划分，与页面上所有时间显示、情绪日记的自然日口径一致：
 * 起始日含 00:00:00.000，结束日含 23:59:59.999，两端都进。
 */

const DAY_MS = 86_400_000;
const UTC8_OFFSET_MS = 8 * 3_600_000;

export type CampaignOperationRange = {
  /** YYYY-MM-DD（UTC+8 自然日）；null = 不设下界。 */
  from: string | null;
  /** YYYY-MM-DD（UTC+8 自然日）；null = 不设上界。 */
  to: string | null;
};

/** 默认值：全选。两端都不设界，缺少操作时间的战役也照常计入。 */
export const ALL_CAMPAIGN_OPERATION_RANGE: CampaignOperationRange = { from: null, to: null };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDayKey(day: string | null | undefined): day is string {
  if (typeof day !== 'string' || !DAY_PATTERN.test(day)) return false;
  return Number.isFinite(Date.parse(`${day}T00:00:00.000Z`));
}

/** epoch 毫秒 → UTC+8 自然日键（YYYY-MM-DD）。 */
export function beijingDayKey(timestamp: number): string {
  return new Date(timestamp + UTC8_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC+8 自然日键 → 该日 00:00:00.000 的 epoch 毫秒。 */
export function beijingDayStart(day: string): number | null {
  if (!isValidDayKey(day)) return null;
  return Date.parse(`${day}T00:00:00.000Z`) - UTC8_OFFSET_MS;
}

/** UTC+8 自然日键 → 该日 23:59:59.999 的 epoch 毫秒（结束日含在内）。 */
export function beijingDayEnd(day: string): number | null {
  const start = beijingDayStart(day);
  return start == null ? null : start + DAY_MS - 1;
}

/** 在自然日键上加减天数，跨月跨年都对。 */
export function shiftDayKey(day: string, days: number): string {
  const start = beijingDayStart(day);
  if (start == null) return day;
  return beijingDayKey(start + days * DAY_MS);
}

export function isAllRange(range: CampaignOperationRange): boolean {
  return !isValidDayKey(range.from) && !isValidDayKey(range.to);
}

/**
 * 规范化成毫秒边界。起止写反了也按区间取——日期选择器上手滑很常见，
 * 与其给一个必然为空的结果，不如按用户显然的意思来。
 */
export function resolveRangeBounds(range: CampaignOperationRange): { start: number; end: number } | null {
  const rawFrom = isValidDayKey(range.from) ? range.from : null;
  const rawTo = isValidDayKey(range.to) ? range.to : null;
  if (rawFrom == null && rawTo == null) return null;

  const [fromDay, toDay] = rawFrom != null && rawTo != null && rawFrom > rawTo
    ? [rawTo, rawFrom]
    : [rawFrom, rawTo];

  return {
    start: fromDay == null ? Number.NEGATIVE_INFINITY : beijingDayStart(fromDay) as number,
    end: toDay == null ? Number.POSITIVE_INFINITY : beijingDayEnd(toDay) as number,
  };
}

/**
 * 这一场是否落在所选时间段内。
 *
 * 全选时恒为 true——包括没有客观操作时间的战役。一旦设了界，它们就无从安放：
 * 与其默默塞进任意一侧，不如排除掉并在浮层里把场数报出来。
 */
export function isWithinOperationRange(
  operationTime: number | null | undefined,
  range: CampaignOperationRange,
): boolean {
  const bounds = resolveRangeBounds(range);
  if (bounds == null) return true;
  if (operationTime == null || !Number.isFinite(operationTime)) return false;
  return operationTime >= bounds.start && operationTime <= bounds.end;
}

/** 「全部」/「2026-08-01 起」/「至 2026-09-13」/「2026-08-01 ~ 2026-09-13」 */
export function describeOperationRange(range: CampaignOperationRange): string {
  const bounds = resolveRangeBounds(range);
  if (bounds == null) return '全部';
  const from = isValidDayKey(range.from) ? range.from : null;
  const to = isValidDayKey(range.to) ? range.to : null;
  if (from != null && to != null) {
    return from > to ? `${to} ~ ${from}` : `${from} ~ ${to}`;
  }
  return from != null ? `${from} 起` : `至 ${to}`;
}

export type CampaignRangePresetKey = 'all' | 'last7' | 'last30' | 'last90' | 'thisYear';

export const CAMPAIGN_RANGE_PRESETS: ReadonlyArray<[CampaignRangePresetKey, string]> = [
  ['all', '全部'],
  ['last7', '近 7 天'],
  ['last30', '近 30 天'],
  ['last90', '近 90 天'],
  ['thisYear', '今年'],
];

/** 预设区间。today 是 UTC+8 自然日键，调用方传进来，方便测试与固定时钟。 */
export function presetOperationRange(
  preset: CampaignRangePresetKey,
  today: string,
): CampaignOperationRange {
  if (preset === 'all' || !isValidDayKey(today)) return { ...ALL_CAMPAIGN_OPERATION_RANGE };
  if (preset === 'thisYear') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const days = preset === 'last7' ? 7 : preset === 'last30' ? 30 : 90;
  // 「近 7 天」含今天，所以回退 6 天而不是 7 天。
  return { from: shiftDayKey(today, -(days - 1)), to: today };
}

/** 当前区间与哪个预设一致（用于高亮）；都不一致时为 null（自定义）。 */
export function matchPreset(range: CampaignOperationRange, today: string): CampaignRangePresetKey | null {
  for (const [key] of CAMPAIGN_RANGE_PRESETS) {
    const preset = presetOperationRange(key, today);
    if (preset.from === (isValidDayKey(range.from) ? range.from : null)
      && preset.to === (isValidDayKey(range.to) ? range.to : null)) {
      return key;
    }
  }
  return null;
}
