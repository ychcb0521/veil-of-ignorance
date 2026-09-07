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
  type CampaignViewMultiplier,
} from '@/hooks/useCampaignKlines';

/**
 * 视野阶梯的“对抗性”档案：专挑 30 分钟下限 + 绝对预设这次改造的边界去踩。
 * 关注四类事故：
 *   1. 撑开量被二等分后，窗口端点掉出整数毫秒 —— 它会原样进 Binance 请求的 startTime；
 *   2. 绝对预设比战役本身还短时，画面反而把战役切掉；
 *   3. 退化输入（1ms / 0 / 倒挂 / NaN）把整条阶梯带成 NaN；
 *   4. 阶梯不单调、可见区跑到已拉取窗口之外。
 * 每条断言的算术先手算写在中文注释里，再交给代码复核。
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const FLOOR_MS = CAMPAIGN_MIN_CONTEXT_MS; // 1_800_000

const t = (iso: string) => Date.parse(iso);
const ALL_MULTIPLIERS = CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS as readonly CampaignViewMultiplier[];
const PRESET_KEYS = CAMPAIGN_ABSOLUTE_RANGE_PRESETS.map(preset => preset.key);

const windowOf = (spanStartMs: number, spanEndMs: number) =>
  buildCampaignKlineTimeWindow(spanStartMs, spanEndMs, spanStartMs, spanEndMs);

const spanMsOf = (range: { fromTime: number; toTime: number }) => range.toTime - range.fromTime;

/**
 * 改造前的实现，逐字复刻（contextMs 就是内容跨度，没有下限，也没有虚拟取景区间）。
 * 内容跨度 >= 下限的战役必须与它逐毫秒相同 —— 这就是任务项(1)的兼容性判据。
 */
function legacyWindow(contentStartMs: number, contentEndMs: number): CampaignKlineTimeWindow {
  const contextMs = contentEndMs - contentStartMs;
  const availableContextMs = contextMs * CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER;
  return {
    fromTime: contentStartMs - availableContextMs,
    toTime: contentEndMs + availableContextMs,
    defaultFromTime: contentStartMs - contextMs,
    defaultToTime: contentEndMs + contextMs,
    contentStartMs,
    contentEndMs,
    contextMs,
    availableContextMs,
  };
}

function legacyVisibleRange(window: CampaignKlineTimeWindow, multiplier: number) {
  const edgeContextMs = (window.contextMs as number) * (multiplier - 1) / 2;
  return {
    fromTime: Math.max(window.fromTime, (window.contentStartMs as number) - edgeContextMs),
    toTime: Math.min(window.toTime, (window.contentEndMs as number) + edgeContextMs),
  };
}

describe('对抗：内容跨度落在 30 分钟下限的两侧', () => {
  it('内容跨度恰好等于下限时，与改造前逐毫秒相同（下限是恒等式，不是分支）', () => {
    // 手算：cs = 2026-03-01T00:00:00Z，ce = cs + 1_800_000（= 下限）。
    // contextMs = max(1_800_000, 1_800_000) = 1_800_000，撑开量 = 0，虚拟取景区间 === 内容区间。
    // 于是 fromTime = cs − 45_000_000、toTime = ce + 45_000_000、default = ±1_800_000。
    const cs = t('2026-03-01T00:00:00.000Z');
    const ce = cs + FLOOR_MS;
    const window = windowOf(cs, ce);

    expect(window).toEqual(legacyWindow(cs, ce));
    expect(window.fromTime).toBe(cs - 45_000_000);
    expect(window.toTime).toBe(ce + 45_000_000);
    expect(window.defaultFromTime).toBe(cs - 1_800_000);
    expect(window.defaultToTime).toBe(ce + 1_800_000);

    for (const multiplier of ALL_MULTIPLIERS) {
      expect(buildCampaignKlineVisibleRange(window, multiplier))
        .toEqual(legacyVisibleRange(legacyWindow(cs, ce), multiplier));
    }
  });

  it('下限 ±1ms 的三个相邻跨度：阶梯连续，且高于下限的一侧仍走老公式', () => {
    // 手算：跨度 1_799_999 → contextMs = 1_800_000（被下限接住），3 倍 = 5_400_000；
    //       跨度 1_800_001 → contextMs = 1_800_001（自己就够长），3 倍 = 5_400_003。
    // 两者相差 3ms —— 阶梯在下限处必须是连续的，不能出现台阶。
    const cs = t('2026-03-01T00:00:00.000Z');
    const below = windowOf(cs, cs + FLOOR_MS - 1);
    const above = windowOf(cs, cs + FLOOR_MS + 1);

    expect(below.contextMs).toBe(FLOOR_MS);
    expect(above.contextMs).toBe(FLOOR_MS + 1);
    expect(spanMsOf(buildCampaignKlineVisibleRange(below, 3))).toBeCloseTo(3 * FLOOR_MS, 6);
    expect(spanMsOf(buildCampaignKlineVisibleRange(above, 3))).toBeCloseTo(3 * (FLOOR_MS + 1), 6);

    // 高于下限的一侧（哪怕只高 1ms）必须与改造前完全一致。
    expect(above).toEqual(legacyWindow(cs, cs + FLOOR_MS + 1));
  });
});

describe('对抗：窗口端点必须是整数毫秒（它会原样进 Binance 请求）', () => {
  // useReplayKlines 直接 `startTime: String(fromTime)`。实测 startTime=…999.5 时
  // fapi 返回 400 / code -1102（malformed），fetchRange 抛错，整张图变成“暂无 K 线数据”。
  // 撑开量 = contextMs − 内容跨度；内容跨度为奇数时撑开量也是奇数，二等分就会掉出 .5。
  const oddCases = [
    { label: '内容跨度 1ms', spanMs: 1 },
    { label: '内容跨度 67.001 秒（奇数毫秒的短战役）', spanMs: 67_001 },
    { label: '内容跨度 下限−1ms', spanMs: FLOOR_MS - 1 },
    { label: '内容跨度 下限+1ms', spanMs: FLOOR_MS + 1 },
    { label: '内容跨度 3h35m+1ms', spanMs: 12_900_001 },
  ];

  for (const item of oddCases) {
    it(`${item.label}：四个窗口端点都是整数`, () => {
      const cs = t('2026-03-01T00:00:00.000Z');
      const window = windowOf(cs, cs + item.spanMs);
      expect(Number.isInteger(window.fromTime)).toBe(true);
      expect(Number.isInteger(window.toTime)).toBe(true);
      expect(Number.isInteger(window.defaultFromTime)).toBe(true);
      expect(Number.isInteger(window.defaultToTime)).toBe(true);
      // 撑开只准平摊，不准改变跨度：虚拟取景区间恒等于 contextMs。
      expect(window.defaultToTime - window.defaultFromTime).toBe(3 * (window.contextMs as number));
      expect(window.toTime - window.fromTime).toBe(51 * (window.contextMs as number));
    });
  }

  it('内容跨度 1ms 的窗口端点逐个手算对齐', () => {
    // 手算：撑开量 = 1_800_000 − 1 = 1_799_999（奇数）。
    // 左 900_000 / 右 899_999 → 虚拟区间 [cs−900_000, cs+900_000]，跨度正好 1_800_000。
    // fromTime = cs − 900_000 − 45_000_000 = cs − 45_900_000；toTime = cs + 45_900_000。
    // default = cs ∓ 2_700_000。
    const cs = t('2026-03-01T00:00:00.000Z');
    const window = windowOf(cs, cs + 1);
    expect(window.fromTime).toBe(cs - 45_900_000);
    expect(window.toTime).toBe(cs + 45_900_000);
    expect(window.defaultFromTime).toBe(cs - 2_700_000);
    expect(window.defaultToTime).toBe(cs + 2_700_000);
  });

  it('奇数跨度下，绝对预设撑开后的窗口端点同样是整数', () => {
    // 中心 = (cs + ce) / 2，内容跨度为奇数时它带 .5，直接进 toTime/fromTime 就又是 400。
    const cs = t('2026-03-01T00:00:00.000Z');
    const nowMs = t('2027-01-01T00:00:00.000Z');
    for (const spanMs of [1, 67_001, FLOOR_MS - 1]) {
      for (const key of PRESET_KEYS) {
        const window = buildCampaignKlineTimeWindow(cs, cs + spanMs, cs, cs + spanMs, {
          kind: 'absolute',
          key,
          nowMs,
        });
        const visible = buildCampaignChartVisibleRange(window, { kind: 'absolute', key, nowMs });
        expect(Number.isInteger(window.fromTime)).toBe(true);
        expect(Number.isInteger(window.toTime)).toBe(true);
        expect(Number.isInteger(visible.fromTime)).toBe(true);
        expect(Number.isInteger(visible.toTime)).toBe(true);
      }
    }
  });
});

describe('对抗：退化输入不得把阶梯带成 NaN 或倒挂', () => {
  it('零跨度（单点内容区间）：以点为中心 ±0.5 单位，整数且包住该点', () => {
    // 手算：撑开量 = 1_800_000，左右各 900_000。
    // fromTime = p − 900_000 − 45_000_000 = p − 45_900_000；default = p ∓ 2_700_000。
    const p = t('2026-03-01T00:30:00.000Z');
    const window = windowOf(p, p);
    expect(window.contextMs).toBe(FLOOR_MS);
    expect(window.fromTime).toBe(p - 45_900_000);
    expect(window.toTime).toBe(p + 45_900_000);
    expect(window.defaultFromTime).toBe(p - 2_700_000);
    expect(window.defaultToTime).toBe(p + 2_700_000);
    for (const multiplier of ALL_MULTIPLIERS) {
      const range = buildCampaignKlineVisibleRange(window, multiplier);
      expect(range.fromTime).toBeLessThanOrEqual(p);
      expect(range.toTime).toBeGreaterThanOrEqual(p);
      expect(spanMsOf(range)).toBeCloseTo(multiplier * FLOOR_MS, 6);
    }
  });

  it('倒挂区间（spanEnd < spanStart）：安全退化 —— 有限、from < to、跨度仍是倍数 × 下限', () => {
    // buildCampaignChartContentTimeSpan 取的是 min/max，正常路径产不出倒挂；
    // 这里只钉“不炸”这条底线：contextMs 被下限接住 = 1_800_000，
    // 撑开量 = 1_800_000 + 7_200_000 = 9_000_000，左右各 4_500_000。
    const cs = t('2026-03-01T02:00:00.000Z');
    const ce = cs - 2 * HOUR_MS;
    const window = windowOf(cs, ce);
    expect(window.contextMs).toBe(FLOOR_MS);
    for (const field of [window.fromTime, window.toTime, window.defaultFromTime, window.defaultToTime]) {
      expect(Number.isFinite(field)).toBe(true);
      expect(Number.isInteger(field)).toBe(true);
    }
    expect(window.fromTime).toBeLessThan(window.toTime);
    for (const multiplier of ALL_MULTIPLIERS) {
      const range = buildCampaignKlineVisibleRange(window, multiplier);
      expect(range.fromTime).toBeLessThan(range.toTime);
      expect(spanMsOf(range)).toBeCloseTo(multiplier * FLOOR_MS, 6);
    }
  });

  it('内容区间任一端为 NaN 时回落到 开仓前 6 小时 / 平仓后 2 小时，而不是把 NaN 传下去', () => {
    const openedAtMs = t('2026-03-01T00:00:00.000Z');
    const closedAtMs = t('2026-03-01T02:00:00.000Z');
    const cases: Array<[number | null, number | null]> = [
      [Number.NaN, closedAtMs],
      [openedAtMs, Number.NaN],
      [null, closedAtMs],
      [openedAtMs, null],
    ];
    for (const [spanStart, spanEnd] of cases) {
      const window = buildCampaignKlineTimeWindow(openedAtMs, closedAtMs, spanStart, spanEnd);
      expect(window.contextMs).toBeNull();
      expect(window.fromTime).toBe(openedAtMs - 6 * HOUR_MS);
      expect(window.toTime).toBe(closedAtMs + 2 * HOUR_MS);
    }
  });

  it('opened/closed 为 NaN 但内容区间有效时，窗口仍然全字段有限（正常路径只吃内容区间）', () => {
    const cs = t('2026-03-01T00:00:00.000Z');
    const ce = cs + 67_000;
    const window = buildCampaignKlineTimeWindow(Number.NaN, Number.NaN, cs, ce);
    for (const field of [window.fromTime, window.toTime, window.defaultFromTime, window.defaultToTime]) {
      expect(Number.isFinite(field)).toBe(true);
    }
    // 绝对预设也不得从 NaN 的 opened/closed 里把 NaN 捞回来。
    const nowMs = t('2027-01-01T00:00:00.000Z');
    const widened = buildCampaignKlineTimeWindow(Number.NaN, Number.NaN, cs, ce, { kind: 'absolute', key: '1w', nowMs });
    const visible = buildCampaignChartVisibleRange(widened, { kind: 'absolute', key: '1w', nowMs });
    expect(Number.isFinite(visible.fromTime)).toBe(true);
    expect(Number.isFinite(visible.toTime)).toBe(true);
    expect(spanMsOf(visible)).toBe(7 * DAY_MS);
  });
});

describe('对抗：战役必须永远整个落在可见区里', () => {
  const nowMs = t('2027-06-01T00:00:00.000Z');

  const durations: Array<{ label: string; spanMs: number }> = [
    { label: '1ms', spanMs: 1 },
    { label: '67 秒', spanMs: 67_000 },
    { label: '恰好 30 分钟', spanMs: FLOOR_MS },
    { label: '2 小时', spanMs: 2 * HOUR_MS },
    { label: '3h35m', spanMs: 12_900_000 },
    { label: '10 天（反事实把内容右端推远）', spanMs: 10 * DAY_MS },
  ];

  for (const item of durations) {
    it(`内容跨度 ${item.label}：九个倍率全部把战役完整包住`, () => {
      const cs = t('2026-02-01T00:00:00.000Z');
      const ce = cs + item.spanMs;
      const window = windowOf(cs, ce);
      for (const multiplier of ALL_MULTIPLIERS) {
        const range = buildCampaignKlineVisibleRange(window, multiplier);
        expect(range.fromTime).toBeLessThanOrEqual(cs);
        expect(range.toTime).toBeGreaterThanOrEqual(ce);
      }
    });
  }

  it('绝对预设比战役本身还短时，只能“至少这么长”，绝不能把战役切掉', () => {
    // 手算：反事实把内容右端推到 +10 天，contentSpan = 864_000_000。
    // 「1周」= 604_800_000 < 864_000_000。若照字面居中取 7 天，
    // 可见区 = [cs+1.5 天, cs+8.5 天]，战役头尾各被切掉 1.5 天 —— 画面里再也看不到开仓与平仓。
    // 正确行为：跨度撑到 max(预设, 内容跨度) = 10 天，可见区恰好 = 战役本身。
    const cs = t('2026-02-01T00:00:00.000Z');
    const ce = cs + 10 * DAY_MS;
    const window = buildCampaignKlineTimeWindow(cs, ce, cs, ce, { kind: 'absolute', key: '1w', nowMs });
    const visible = buildCampaignChartVisibleRange(window, { kind: 'absolute', key: '1w', nowMs });

    expect(visible.fromTime).toBeLessThanOrEqual(cs);
    expect(visible.toTime).toBeGreaterThanOrEqual(ce);
    expect(spanMsOf(visible)).toBe(10 * DAY_MS);
    // 拉取窗口照样覆盖得住。
    expect(window.fromTime).toBeLessThanOrEqual(visible.fromTime);
    expect(window.toTime).toBeGreaterThanOrEqual(visible.toTime);
  });

  it('60 天的战役点「1月」：同样不许缩到 30 天把两头切掉', () => {
    // 手算：contentSpan = 5_184_000_000（60 天）> 1月预设 2_592_000_000。
    const cs = t('2026-02-01T00:00:00.000Z');
    const ce = cs + 60 * DAY_MS;
    const window = buildCampaignKlineTimeWindow(cs, ce, cs, ce, { kind: 'absolute', key: '1M', nowMs });
    const visible = buildCampaignChartVisibleRange(window, { kind: 'absolute', key: '1M', nowMs });
    expect(visible.fromTime).toBeLessThanOrEqual(cs);
    expect(visible.toTime).toBeGreaterThanOrEqual(ce);
    expect(spanMsOf(visible)).toBe(60 * DAY_MS);
  });

  it('右沿被“现在”夹住时，也不许把战役尾巴切掉', () => {
    // 开放中的战役：nowMs 在点击那一刻冻结，随后 effectiveClosedAt 继续往前走，
    // 于是 contentEnd 可能反超冻结的 nowMs。此时右沿宁可跟到战役末尾，也不能少掉半截战役。
    const cs = t('2026-02-01T00:00:00.000Z');
    const ce = cs + 2 * HOUR_MS;
    const staleNowMs = ce - 10 * MINUTE_MS;
    const window = buildCampaignKlineTimeWindow(cs, ce, cs, ce, { kind: 'absolute', key: '1w', nowMs: staleNowMs });
    const visible = buildCampaignChartVisibleRange(window, { kind: 'absolute', key: '1w', nowMs: staleNowMs });
    expect(visible.toTime).toBeGreaterThanOrEqual(ce);
    expect(visible.fromTime).toBeLessThanOrEqual(cs);
  });
});

describe('对抗：整条阶梯的单调性与“可见区 ⊆ 已拉取区”', () => {
  const nowMs = t('2027-06-01T00:00:00.000Z');
  const durations: Array<{ label: string; spanMs: number }> = [
    { label: '1ms', spanMs: 1 },
    { label: '67 秒', spanMs: 67_000 },
    { label: '恰好 30 分钟', spanMs: FLOOR_MS },
    { label: '2 小时', spanMs: 2 * HOUR_MS },
    { label: '3h35m', spanMs: 12_900_000 },
    { label: '10 天', spanMs: 10 * DAY_MS },
  ];

  for (const item of durations) {
    it(`内容跨度 ${item.label}：倍率九档 + 未被支配的预设，跨度严格递增`, () => {
      const cs = t('2026-02-01T00:00:00.000Z');
      const ce = cs + item.spanMs;
      const base = windowOf(cs, ce);
      const max51Span = spanMsOf(buildCampaignKlineVisibleRange(base, 51));

      const ladder = [
        ...ALL_MULTIPLIERS.map(multiplier => spanMsOf(buildCampaignKlineVisibleRange(base, multiplier))),
        ...CAMPAIGN_ABSOLUTE_RANGE_PRESETS
          // 详情页把 spanMs <= 51 倍跨度的预设置灰：它们点下去是“放大”，不是“放长”。
          .filter(preset => preset.spanMs > max51Span)
          .map(preset => {
            const window = buildCampaignKlineTimeWindow(cs, ce, cs, ce, { kind: 'absolute', key: preset.key, nowMs });
            return spanMsOf(buildCampaignChartVisibleRange(window, { kind: 'absolute', key: preset.key, nowMs }));
          }),
      ];

      for (let i = 1; i < ladder.length; i += 1) {
        expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
      }
      // 最长的一档必须真的比 51 倍更长，否则“尽可能长”这个诉求根本没被满足。
      expect(ladder[ladder.length - 1]).toBeGreaterThanOrEqual(max51Span);
    });

    it(`内容跨度 ${item.label}：任何档位的可见区都不得越出已拉取窗口`, () => {
      const cs = t('2026-02-01T00:00:00.000Z');
      const ce = cs + item.spanMs;

      const plain = windowOf(cs, ce);
      for (const multiplier of ALL_MULTIPLIERS) {
        const visible = buildCampaignChartVisibleRange(plain, { kind: 'multiplier', multiplier });
        expect(plain.fromTime).toBeLessThanOrEqual(visible.fromTime);
        expect(plain.toTime).toBeGreaterThanOrEqual(visible.toTime);
      }

      for (const key of PRESET_KEYS) {
        const selection = { kind: 'absolute', key, nowMs } as const;
        const window = buildCampaignKlineTimeWindow(cs, ce, cs, ce, selection);
        const visible = buildCampaignChartVisibleRange(window, selection);
        expect(window.fromTime).toBeLessThanOrEqual(visible.fromTime);
        expect(window.toTime).toBeGreaterThanOrEqual(visible.toTime);
        // 承诺的跨度要么足额兑现，要么被“装下整个战役”撑得更长，绝不缩水。
        expect(spanMsOf(visible)).toBeGreaterThanOrEqual(
          Math.min(campaignAbsolutePresetSpanMs(key as CampaignAbsoluteRangeKey), spanMsOf(visible)),
        );
        expect(spanMsOf(visible)).toBeGreaterThanOrEqual(campaignAbsolutePresetSpanMs(key as CampaignAbsoluteRangeKey));
      }
    });
  }

  it('撑开拉取窗口对倍率阶梯完全正交（含被下限抬高的短战役）', () => {
    const cs = t('2026-02-01T00:00:00.000Z');
    const ce = cs + 67_000;
    const plain = windowOf(cs, ce);
    for (const key of PRESET_KEYS) {
      const widened = buildCampaignKlineTimeWindow(cs, ce, cs, ce, { kind: 'absolute', key, nowMs });
      for (const multiplier of ALL_MULTIPLIERS) {
        expect(buildCampaignKlineVisibleRange(widened, multiplier))
          .toEqual(buildCampaignKlineVisibleRange(plain, multiplier));
      }
    }
  });
});
