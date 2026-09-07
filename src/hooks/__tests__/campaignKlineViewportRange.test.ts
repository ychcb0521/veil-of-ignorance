import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_ABSOLUTE_RANGE_PRESETS,
  CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER,
  CAMPAIGN_MIN_CONTEXT_MS,
  CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS,
  buildCampaignChartVisibleRange,
  buildCampaignKlineTimeWindow,
  buildCampaignKlineVisibleRange,
  campaignAbsolutePresetSpanMs,
  type CampaignAbsoluteRangeKey,
  type CampaignKlineTimeWindow,
} from '@/hooks/useCampaignKlines';
import { pickCampaignOverviewInterval, pickCoarserCampaignInterval } from '@/lib/campaignChartContentSpan';

/**
 * 战役 K 线视野的“测量档案”。
 * 用户投诉「有的战役只能选取这么一小段时间」的根因：整条视野阶梯原本是战役自身跨度的纯倍数，
 * 内容跨度 67 秒的战役默认 3 倍只有 3.35 分钟（5m 周期下不足一根 K 线），51 倍顶格也才 57 分钟。
 * 现在有两道出口：上下文单位有 30 分钟下限；另有与战役时长完全无关的绝对预设 1天/1周/1月。
 * 长战役（内容跨度 > 下限）必须逐毫秒不变——那是兼容性的机器证明。
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const t = (iso: string) => Date.parse(iso);
const minutes = (ms: number) => ms / MINUTE_MS;
const hours = (ms: number) => ms / HOUR_MS;
const days = (ms: number) => ms / DAY_MS;

type ViewportRow = {
  multiplier: number;
  visibleMs: number;
  visibleMinutes: number;
  /** 该视野在 1m / 5m 周期下会落到画面里的 K 线根数（含边缘不足一根的小数）。 */
  candles1m: number;
  candles5m: number;
};

/** 把 1.1x…51x 全档位跑一遍，得到“可见跨度 + K 线根数”对照表。 */
function viewportTable(window: CampaignKlineTimeWindow): ViewportRow[] {
  return CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS.map(multiplier => {
    const range = buildCampaignKlineVisibleRange(window, multiplier);
    const visibleMs = range.toTime - range.fromTime;
    return {
      multiplier,
      visibleMs,
      visibleMinutes: minutes(visibleMs),
      candles1m: visibleMs / MINUTE_MS,
      candles5m: visibleMs / (5 * MINUTE_MS),
    };
  });
}

function rowAt(table: ViewportRow[], multiplier: number): ViewportRow {
  const row = table.find(item => item.multiplier === multiplier);
  if (!row) throw new Error(`缺少 ${multiplier}x 档位`);
  return row;
}

const spanOf = (range: { fromTime: number; toTime: number }) => ({
  startMs: range.fromTime,
  endMs: range.toTime,
});

/** 复刻详情页的自动周期规则：拉取项 6000 根永远生效，可见项 1200 根只在绝对预设下再收紧一次。 */
function autoInterval(
  window: CampaignKlineTimeWindow,
  visible: { fromTime: number; toTime: number },
  isAbsolute: boolean,
) {
  const fetched = pickCampaignOverviewInterval(spanOf(window), 6_000);
  if (!isAbsolute) return fetched;
  return pickCoarserCampaignInterval(pickCampaignOverviewInterval(spanOf(visible), 1_200), fetched);
}

const INTERVAL_MS: Record<string, number> = {
  '1m': MINUTE_MS,
  '5m': 5 * MINUTE_MS,
  '15m': 15 * MINUTE_MS,
  '1h': HOUR_MS,
};

describe('战役 K 线视野：短战役（QUICKUSDT 型，内容跨度 67 秒）', () => {
  // 用户 2025-09-02 的 QUICKUSDT 截图：改造前 51 倍顶格时 x 轴 19:15→20:12，约 57 分钟。
  const contentStartMs = t('2025-09-02T19:43:00.000Z');
  const contentEndMs = t('2025-09-02T19:44:07.000Z');
  const contentSpanMs = contentEndMs - contentStartMs;
  const window = buildCampaignKlineTimeWindow(
    contentStartMs,
    contentEndMs,
    contentStartMs,
    contentEndMs,
  );

  it('内容跨度仍是 67 秒，但上下文单位被 30 分钟下限接住，不再随战役缩水', () => {
    expect(contentSpanMs).toBe(67_000);
    // 内容边界一个字不动——战役 marker、竖线、居中点都靠它定位。
    expect(window.contentStartMs).toBe(contentStartMs);
    expect(window.contentEndMs).toBe(contentEndMs);

    expect(window.contextMs).toBe(CAMPAIGN_MIN_CONTEXT_MS);
    expect(window.contextMs).toBe(30 * MINUTE_MS);
    expect(window.availableContextMs).toBe(CAMPAIGN_MIN_CONTEXT_MS * CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER);

    // 已拉取（可浏览）窗口 = 51 × 30 分钟 = 25.5 小时（改造前只有 56.95 分钟）。
    const fetchedMs = window.toTime - window.fromTime;
    expect(minutes(fetchedMs)).toBeCloseTo(1530, 6);
    expect(hours(fetchedMs)).toBeCloseTo(25.5, 6);

    // 默认 3 倍窗口 = 90 分钟（改造前 3.35 分钟）。
    const defaultMs = window.defaultToTime - window.defaultFromTime;
    expect(minutes(defaultMs)).toBeCloseTo(90, 6);
  });

  it('1.1x…51x 全档位可见跨度 = 倍数 × 30 分钟，默认 3 倍已有 18 根 5m', () => {
    const table = viewportTable(window);

    expect(table.map(row => Number(row.visibleMinutes.toFixed(4)))).toEqual([
      33, //    1.1x（改造前 1.2283，不足一根 5m）
      60, //    2x
      90, //    3x（默认；改造前 3.35）
      150, //   5x
      330, //   11x
      630, //   21x
      930, //   31x
      1230, //  41x
      1530, //  51x（顶格，等于已拉取窗口；改造前 56.95）
    ]);

    // 新法则：可见跨度 = 倍数 × max(内容跨度, 下限)。
    for (const row of table) {
      expect(row.visibleMs).toBeCloseTo(row.multiplier * CAMPAIGN_MIN_CONTEXT_MS, 6);
    }

    // 默认 3 倍：18 根 5m，越过“至少 12 根才能读出结构”的门槛。
    const defaultRow = rowAt(table, 3);
    expect(defaultRow.candles5m).toBeCloseTo(18, 6);
    expect(defaultRow.candles1m).toBeCloseTo(90, 6);
    // 最紧的 1.1 倍也有 6.6 根 5m，不会再退化成“不足一根 K 线”。
    expect(rowAt(table, 1.1).candles5m).toBeCloseTo(6.6, 6);

    // 51 倍仍然恰好等于已拉取窗口（倍率阶梯的天花板不变，只是被抬高了）。
    expect(buildCampaignKlineVisibleRange(window, 51)).toEqual({
      fromTime: window.fromTime,
      toTime: window.toTime,
    });

    // 每一档都仍然以战役内容为中心。
    for (const row of table) {
      const range = buildCampaignKlineVisibleRange(window, row.multiplier as never);
      expect((range.fromTime + range.toTime) / 2).toBeCloseTo((contentStartMs + contentEndMs) / 2, 6);
    }
  });

  it('自动周期：被抬高的短战役仍然停在 1m，不会因为修 bug 反而被降级', () => {
    // 51 × 30 分钟 = 1530 根 1m，远没吃满 6000 根拉取预算。
    expect(autoInterval(window, buildCampaignKlineVisibleRange(window, 3), false)).toBe('1m');
    expect(autoInterval(window, buildCampaignKlineVisibleRange(window, 51), false)).toBe('1m');
  });

  it('倍率档位的自动周期与倍数无关：点缩放按钮绝不改变 K 线粒度', () => {
    // 这是最关键的兼容护栏：interval 一变，klines 粒度就变，而 klines 同时喂给
    // computeDecisionAccuracy / buildManualLegs / runAndPersistCustomCounterfactual。
    for (const multiplier of CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS) {
      expect(autoInterval(window, buildCampaignKlineVisibleRange(window, multiplier), false)).toBe('1m');
    }
  });
});

describe('战役 K 线视野：长战役（XLMUSDT 型，内容跨度 3h35m）逐毫秒不变', () => {
  const contentStartMs = t('2026-01-02T00:00:00.000Z');
  const contentEndMs = t('2026-01-02T03:35:00.000Z');
  const contentSpanMs = contentEndMs - contentStartMs;
  const window = buildCampaignKlineTimeWindow(
    contentStartMs,
    contentEndMs,
    contentStartMs,
    contentEndMs,
  );

  it('内容跨度 3h35m 远高于 30 分钟下限，窗口六个字段与改造前完全相同', () => {
    expect(contentSpanMs).toBe(12_900_000);
    expect(window).toEqual({
      fromTime: contentStartMs - 322_500_000,
      toTime: contentEndMs + 322_500_000,
      defaultFromTime: contentStartMs - 12_900_000,
      defaultToTime: contentEndMs + 12_900_000,
      contentStartMs,
      contentEndMs,
      contextMs: 12_900_000,
      availableContextMs: 322_500_000,
    });

    const fetchedMs = window.toTime - window.fromTime;
    expect(fetchedMs).toBe(657_900_000);
    expect(days(fetchedMs)).toBeCloseTo(7.6146, 4);
  });

  it('1.1x…51x 全档位可见跨度表：顶格 ≈7.61 天，默认 3 倍 = 10h45m（与改造前逐行相同）', () => {
    const table = viewportTable(window);

    expect(table.map(row => Number(row.visibleMinutes.toFixed(2)))).toEqual([
      236.5, //   1.1x
      430, //     2x
      645, //     3x（默认）
      1075, //    5x
      2365, //    11x
      4515, //    21x
      6665, //    31x
      8815, //    41x
      10965, //   51x（顶格，等于已拉取窗口）
    ]);

    const defaultRow = rowAt(table, 3);
    expect(defaultRow.visibleMs).toBe(38_700_000);
    expect(hours(defaultRow.visibleMs)).toBeCloseTo(10.75, 4); // 10h45m
    expect(defaultRow.candles1m).toBeCloseTo(645, 4);
    expect(defaultRow.candles5m).toBeCloseTo(129, 4);

    const maxRow = rowAt(table, 51);
    expect(days(maxRow.visibleMs)).toBeCloseTo(7.6146, 4);
    expect(maxRow.candles1m).toBeCloseTo(10_965, 4);
    expect(maxRow.candles5m).toBeCloseTo(2_193, 4);

    // 内容跨度 >= 下限时，虚拟取景区间恒等于内容区间，3 倍就是 defaultFrom/To。
    expect(buildCampaignKlineVisibleRange(window, 3)).toEqual({
      fromTime: window.defaultFromTime,
      toTime: window.defaultToTime,
    });
  });

  it('自动周期：全部九个倍率都给 5m，一个字不动（拉取窗口 = 657_900_000ms）', () => {
    expect(pickCampaignOverviewInterval(spanOf(window), 6_000)).toBe('5m');
    for (const multiplier of CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS) {
      expect(autoInterval(window, buildCampaignKlineVisibleRange(window, multiplier), false)).toBe('5m');
    }
  });
});

describe('战役 K 线视野：内容跨度 2 小时的老战役，倍率不得改动周期', () => {
  // campaignChartContentSpan.test.ts 钉在这条跨度上；它落在“1200 根会更粗、6000 根仍是 5m”的危险带里。
  const contentStartMs = t('2026-01-02T00:30:00.000Z');
  const contentEndMs = t('2026-01-02T02:30:00.000Z');
  const window = buildCampaignKlineTimeWindow(contentStartMs, contentEndMs, contentStartMs, contentEndMs);

  it('九个倍率的自动周期全部是 5m：可见项预算绝不允许泄漏到倍率路径', () => {
    expect(window.contextMs).toBe(2 * HOUR_MS);
    expect(pickCampaignOverviewInterval(spanOf(window), 6_000)).toBe('5m');
    // 若把 1200 根的可见项也套到倍率上，51 倍会变成 15m —— 已保存的反事实会因此换一套粒度。
    expect(pickCampaignOverviewInterval(spanOf(buildCampaignKlineVisibleRange(window, 51)), 1_200)).toBe('15m');
    for (const multiplier of CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS) {
      expect(autoInterval(window, buildCampaignKlineVisibleRange(window, multiplier), false)).toBe('5m');
    }
  });
});

describe('战役 K 线视野：绝对时间预设 1天 / 1周 / 1月', () => {
  const contentStartMs = t('2025-09-02T19:43:00.000Z');
  const contentEndMs = t('2025-09-02T19:44:07.000Z');
  const centerMs = (contentStartMs + contentEndMs) / 2;
  // 复盘时刻远晚于战役，右沿不会被“现在”夹到。
  const nowMs = t('2025-12-01T00:00:00.000Z');
  const baseWindow = buildCampaignKlineTimeWindow(contentStartMs, contentEndMs, contentStartMs, contentEndMs);

  const windowFor = (key: CampaignAbsoluteRangeKey) => buildCampaignKlineTimeWindow(
    contentStartMs,
    contentEndMs,
    contentStartMs,
    contentEndMs,
    { kind: 'absolute', key, nowMs },
  );

  it('预设跨度足额兑现，且拉取窗口一定覆盖得住（否则按钮点了等于没点）', () => {
    for (const preset of CAMPAIGN_ABSOLUTE_RANGE_PRESETS) {
      const window = windowFor(preset.key);
      const visible = buildCampaignChartVisibleRange(window, { kind: 'absolute', key: preset.key, nowMs });

      expect(visible.toTime - visible.fromTime).toBe(preset.spanMs);
      expect((visible.fromTime + visible.toTime) / 2).toBeCloseTo(centerMs, 6);
      // 可见区 ⊆ 已拉取区。
      expect(window.fromTime).toBeLessThanOrEqual(visible.fromTime);
      expect(window.toTime).toBeGreaterThanOrEqual(visible.toTime);
      expect(window.toTime - window.fromTime).toBeGreaterThanOrEqual(preset.spanMs);
    }
  });

  it('撑开拉取窗口只放宽两端，六个上下文字段与不带 selection 时逐毫秒相同', () => {
    for (const preset of CAMPAIGN_ABSOLUTE_RANGE_PRESETS) {
      const window = windowFor(preset.key);
      expect(window.defaultFromTime).toBe(baseWindow.defaultFromTime);
      expect(window.defaultToTime).toBe(baseWindow.defaultToTime);
      expect(window.contentStartMs).toBe(baseWindow.contentStartMs);
      expect(window.contentEndMs).toBe(baseWindow.contentEndMs);
      expect(window.contextMs).toBe(baseWindow.contextMs);
      expect(window.availableContextMs).toBe(baseWindow.availableContextMs);
      expect(window.fromTime).toBeLessThanOrEqual(baseWindow.fromTime);
      expect(window.toTime).toBeGreaterThanOrEqual(baseWindow.toTime);
    }
  });

  it('倍率阶梯与绝对预设正交：撑开窗口后九个倍率的可见区一个数都不变', () => {
    const longStart = t('2026-01-02T00:00:00.000Z');
    const longEnd = t('2026-01-02T03:35:00.000Z');
    const plain = buildCampaignKlineTimeWindow(longStart, longEnd, longStart, longEnd);
    const widened = buildCampaignKlineTimeWindow(longStart, longEnd, longStart, longEnd, {
      kind: 'absolute',
      key: '1M',
      nowMs,
    });
    for (const multiplier of CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS) {
      expect(buildCampaignKlineVisibleRange(widened, multiplier))
        .toEqual(buildCampaignKlineVisibleRange(plain, multiplier));
    }
  });

  it('右沿夹到“现在”后左移补足：承诺的时长不缩水，也不向未来要 K 线', () => {
    const justNow = centerMs + HOUR_MS; // 战役刚结束一小时
    const window = buildCampaignKlineTimeWindow(
      contentStartMs,
      contentEndMs,
      contentStartMs,
      contentEndMs,
      { kind: 'absolute', key: '1M', nowMs: justNow },
    );
    const visible = buildCampaignChartVisibleRange(window, { kind: 'absolute', key: '1M', nowMs: justNow });
    expect(visible.toTime).toBe(justNow);
    expect(visible.toTime - visible.fromTime).toBe(30 * DAY_MS);
  });

  it('自动周期：1天→5m、1周→15m、1月→1h，可见根数全部落在可渲染区间内', () => {
    const expected: Record<CampaignAbsoluteRangeKey, string> = { '1d': '5m', '1w': '15m', '1M': '1h' };
    for (const preset of CAMPAIGN_ABSOLUTE_RANGE_PRESETS) {
      const window = windowFor(preset.key);
      const visible = buildCampaignChartVisibleRange(window, { kind: 'absolute', key: preset.key, nowMs });
      const interval = autoInterval(window, visible, true);
      expect(interval).toBe(expected[preset.key]);

      // klinecharts 把 barSpace 夹在 [1, 50]：可见根数超过画布宽度（约 1700）会被静默裁掉，
      // 低于 画布宽度/50（约 34）又会被撑到比承诺更宽。两侧都要守住。
      const candles = (visible.toTime - visible.fromTime) / INTERVAL_MS[interval];
      expect(candles).toBeLessThanOrEqual(1_200);
      expect(candles).toBeGreaterThanOrEqual(34);
    }
    expect(campaignAbsolutePresetSpanMs('1M')).toBe(30 * DAY_MS);
  });

  it('比 51 倍还窄的预设是“放大”而不是“放长”，工具栏必须把它置灰', () => {
    // 短战役：51 倍 = 25.5 小时 > 1 天，所以「1天」是被支配的档位。
    const max51 = buildCampaignKlineVisibleRange(baseWindow, 51);
    const max51Span = max51.toTime - max51.fromTime;
    expect(campaignAbsolutePresetSpanMs('1d')).toBeLessThanOrEqual(max51Span);
    expect(campaignAbsolutePresetSpanMs('1w')).toBeGreaterThan(max51Span);

    // 长战役（3h35m）：51 倍 = 7.61 天，1天/1周都被支配，只剩 1月 是真的“更长”。
    const longStart = t('2026-01-02T00:00:00.000Z');
    const longEnd = t('2026-01-02T03:35:00.000Z');
    const longWindow = buildCampaignKlineTimeWindow(longStart, longEnd, longStart, longEnd);
    const longMax51 = buildCampaignKlineVisibleRange(longWindow, 51);
    const longMax51Span = longMax51.toTime - longMax51.fromTime;
    expect(campaignAbsolutePresetSpanMs('1w')).toBeLessThanOrEqual(longMax51Span);
    expect(campaignAbsolutePresetSpanMs('1M')).toBeGreaterThan(longMax51Span);

    // 只保留没被支配的预设，工具栏从左到右严格变宽（不会出现“右边的按钮反而更窄”）。
    const liveSpans = [
      ...CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS.map(m => {
        const range = buildCampaignKlineVisibleRange(baseWindow, m);
        return range.toTime - range.fromTime;
      }),
      ...CAMPAIGN_ABSOLUTE_RANGE_PRESETS
        .filter(preset => preset.spanMs > max51Span)
        .map(preset => preset.spanMs),
    ];
    for (let i = 1; i < liveSpans.length; i += 1) {
      expect(liveSpans[i]).toBeGreaterThan(liveSpans[i - 1]);
    }
  });
});

describe('战役 K 线视野：退化区间与无区间兜底', () => {
  const openedAtMs = t('2026-01-02T00:00:00.000Z');
  const closedAtMs = t('2026-01-02T02:00:00.000Z');

  describe('单点内容区间（spanEnd <= spanStart）', () => {
    const point = t('2026-01-02T00:30:00.000Z');
    const window = buildCampaignKlineTimeWindow(openedAtMs, closedAtMs, point, point);

    it('与短战役共用同一个 30 分钟单位，已拉取窗口 25.5 小时', () => {
      expect(window.contextMs).toBe(CAMPAIGN_MIN_CONTEXT_MS);
      expect(window.availableContextMs).toBe(CAMPAIGN_MIN_CONTEXT_MS * CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER);
      expect(hours(window.toTime - window.fromTime)).toBeCloseTo(25.5, 6);
      expect(minutes(window.defaultToTime - window.defaultFromTime)).toBeCloseTo(90, 6);
    });

    it('可见跨度 = 倍数 × 30 分钟：不再有“比倍数少一份”的特例', () => {
      const table = viewportTable(window);

      expect(table.map(row => Number(row.visibleMinutes.toFixed(4)))).toEqual([
        33, //    1.1x（改造前 1.5）
        60, //    2x（改造前 15）
        90, //    3x（改造前 30）
        150, //   5x
        330, //   11x
        630, //   21x
        930, //   31x
        1230, //  41x
        1530, //  51x（顶格 = 已拉取窗口 25.5h；改造前 750 分钟）
      ]);

      for (const row of table) {
        expect(row.visibleMs).toBeCloseTo(row.multiplier * CAMPAIGN_MIN_CONTEXT_MS, 6);
      }
    });

    it('自动周期：25.5h = 1530 根 1m，仍停在 1m', () => {
      expect(pickCampaignOverviewInterval(spanOf(window), 6_000)).toBe('1m');
    });
  });

  describe('无内容区间兜底（spanStart/spanEnd 为 null）', () => {
    const window = buildCampaignKlineTimeWindow(openedAtMs, closedAtMs, null, null);

    it('回落到“开仓前 6 小时 + 平仓后 2 小时”，且没有 51 倍预载', () => {
      expect(window).toEqual({
        fromTime: t('2026-01-01T18:00:00.000Z'),
        toTime: t('2026-01-02T04:00:00.000Z'),
        defaultFromTime: t('2026-01-01T18:00:00.000Z'),
        defaultToTime: t('2026-01-02T04:00:00.000Z'),
        contentStartMs: null,
        contentEndMs: null,
        contextMs: null,
        availableContextMs: null,
      });
      expect(hours(window.toTime - window.fromTime)).toBeCloseTo(10, 6);
    });

    it('倍率从 5x 起就被夹死在 10 小时，但绝对预设在这条路径上照样可用', () => {
      const table = viewportTable(window);
      expect(table.map(row => Number(row.visibleMinutes.toFixed(4)))).toEqual([
        220, 400, 600, 600, 600, 600, 600, 600, 600,
      ]);

      const nowMs = t('2026-06-01T00:00:00.000Z');
      const widened = buildCampaignKlineTimeWindow(openedAtMs, closedAtMs, null, null, {
        kind: 'absolute',
        key: '1w',
        nowMs,
      });
      const visible = buildCampaignChartVisibleRange(widened, { kind: 'absolute', key: '1w', nowMs });
      expect(visible.toTime - visible.fromTime).toBe(7 * DAY_MS);
      // 中心退回默认窗口中点，仍然把战役放在画面正中。
      expect((visible.fromTime + visible.toTime) / 2)
        .toBeCloseTo((window.defaultFromTime + window.defaultToTime) / 2, 6);
    });
  });
});
