import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_ABSOLUTE_RANGE_PRESETS,
  CAMPAIGN_DEFAULT_VIEW_MULTIPLIER,
  CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS,
  CAMPAIGN_VIEW_MULTIPLIERS,
  buildCampaignChartVisibleRange,
  buildCampaignKlineTimeWindow,
  buildCampaignKlineVisibleRange,
  normalizeCampaignViewMultiplier,
  type CampaignChartRangeSelection,
  type CampaignKlineTimeWindow,
  type CampaignViewMultiplier,
} from '@/hooks/useCampaignKlines';
import {
  CAMPAIGN_DEFAULT_DISPLAY_INTERVAL,
  buildCampaignChartContentTimeSpan,
  explainCampaignDisplayIntervalWidening,
  pickCampaignComputeInterval,
  pickCampaignDisplayInterval,
  pickCampaignOverviewInterval,
  type CampaignChartInterval,
} from '@/lib/campaignChartContentSpan';
import { synthCampaign, type SynthCampaignId } from '@/test/fixtures/syntheticCampaignKlines';

/**
 * 【用户要求】原始盘面默认 5 分钟线、2.1 倍；倍数档 1.1 / 2.1 / 3.1 / 5 … 51。
 * 【用户已定】计算与显示分开：计算用周期只看基准窗口，与倍数、手动周期、绝对预设全都无关。
 */

const spanOf = (range: { fromTime: number; toTime: number }) => ({ startMs: range.fromTime, endMs: range.toTime });

function windowsOf(id: SynthCampaignId, selection: CampaignChartRangeSelection | null = null) {
  const { campaign, legs, tradeRecords } = synthCampaign(id);
  const span = buildCampaignChartContentTimeSpan(campaign, legs, tradeRecords, [], null);
  const opened = Date.parse(campaign.opened_at);
  const closed = Date.parse(campaign.closed_at!);
  const base = buildCampaignKlineTimeWindow(opened, closed, span.startMs, span.endMs);
  const fetch = buildCampaignKlineTimeWindow(opened, closed, span.startMs, span.endMs, selection);
  return { base, fetch };
}

/** 详情页的显示周期：与页面同一套入参（显示用拉取窗口 + 当前视窗）。 */
function displayIntervalOf(
  id: SynthCampaignId,
  selection: CampaignChartRangeSelection,
  manual: CampaignChartInterval | null = null,
) {
  const { fetch } = windowsOf(id, selection);
  const visible = buildCampaignChartVisibleRange(fetch, selection);
  return pickCampaignDisplayInterval({
    manual,
    absolute: selection.kind === 'absolute',
    fetch: spanOf(fetch),
    visible: spanOf(visible),
  });
}

/** 改版前「默认打开、没手动改周期」时的周期：拉取窗口 6000 根预算（倍率视图下拉取窗口 = 基准窗口）。 */
const legacyDefaultInterval = (base: CampaignKlineTimeWindow) => pickCampaignOverviewInterval(spanOf(base), 6_000);

const multiplier = (value: CampaignViewMultiplier): CampaignChartRangeSelection => (
  { kind: 'multiplier', multiplier: value }
);
const NOW = Date.parse('2026-09-25T00:00:00.000Z');

describe('倍数档：1.1 / 2.1 / 3.1 / 5 / 11 / 21 / 31 / 41 / 51，默认 2.1', () => {
  it('档位与默认值', () => {
    expect([...CAMPAIGN_VIEW_MULTIPLIERS]).toEqual([2.1, 3.1, 5, 11, 21, 31, 41, 51]);
    expect([...CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS]).toEqual([1.1, 2.1, 3.1, 5, 11, 21, 31, 41, 51]);
    expect(CAMPAIGN_DEFAULT_VIEW_MULTIPLIER).toBe(2.1);
    expect(CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS).not.toContain(2 as never);
    expect(CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS).not.toContain(3 as never);
  });

  it('旧值兼容读入：2 → 2.1、3 → 3.1；档内原样；档外与缺省返回 null', () => {
    expect(normalizeCampaignViewMultiplier(2)).toBe(2.1);
    expect(normalizeCampaignViewMultiplier(3)).toBe(3.1);
    expect(normalizeCampaignViewMultiplier('2')).toBe(2.1);
    expect(normalizeCampaignViewMultiplier('3x')).toBe(3.1);
    for (const value of CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS) {
      expect(normalizeCampaignViewMultiplier(value)).toBe(value);
      expect(normalizeCampaignViewMultiplier(String(value))).toBe(value);
    }
    expect(normalizeCampaignViewMultiplier(1)).toBe(1);
    expect(normalizeCampaignViewMultiplier(4)).toBeNull();
    expect(normalizeCampaignViewMultiplier(undefined)).toBeNull();
    expect(normalizeCampaignViewMultiplier(null)).toBeNull();
    expect(normalizeCampaignViewMultiplier(Number.NaN)).toBeNull();
    expect(normalizeCampaignViewMultiplier('')).toBeNull();
    expect(normalizeCampaignViewMultiplier('abc')).toBeNull();
  });
});

describe('计算用周期：与改版前默认打开时逐位相同，与倍数 / 手动周期 / 预设无关', () => {
  it.each([
    ['tut-1h', '1m'],
    ['tut-5h', '5m'],
    ['tut-8d', '1h'],
  ] as const)('%s 的计算用周期是 %s（= 改版前默认打开时的自动周期）', (id, expected) => {
    const { base } = windowsOf(id);
    expect(pickCampaignComputeInterval(spanOf(base))).toBe(expected);
    expect(pickCampaignComputeInterval(spanOf(base))).toBe(legacyDefaultInterval(base));
  });

  it('绝对预设只撑开显示用拉取窗口，基准窗口（计算用）一毫秒不动', () => {
    for (const id of ['tut-1h', 'tut-5h', 'tut-8d'] as const) {
      const { base } = windowsOf(id);
      for (const preset of CAMPAIGN_ABSOLUTE_RANGE_PRESETS) {
        const selection: CampaignChartRangeSelection = { kind: 'absolute', key: preset.key, nowMs: NOW };
        expect(windowsOf(id, selection).base).toEqual(base);
      }
    }
  });
});

describe('显示周期：默认 5 分钟线，放不下时自动放宽', () => {
  it('默认 2.1 倍：1 小时 / 5 小时战役是 5 分钟线；8 天战役放不下，自动放宽到 1 小时线', () => {
    const selection = multiplier(CAMPAIGN_DEFAULT_VIEW_MULTIPLIER);
    expect(CAMPAIGN_DEFAULT_DISPLAY_INTERVAL).toBe('5m');
    expect(displayIntervalOf('tut-1h', selection)).toBe('5m');
    expect(displayIntervalOf('tut-5h', selection)).toBe('5m');
    expect(displayIntervalOf('tut-8d', selection)).toBe('1h');
  });

  it('5 分钟是下限：计算用周期是 1m 的短战役，盘面也不画 1 分钟线', () => {
    for (const value of CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS) {
      expect(displayIntervalOf('tut-1h', multiplier(value))).toBe('5m');
    }
  });

  it('可读下限：5 小时战役拉到 21 倍以上（可见 ≥ 6300 分钟），5 分钟线超过 1200 根就放宽到 15 分钟线', () => {
    expect(displayIntervalOf('tut-5h', multiplier(11))).toBe('5m'); //  3300 分钟 = 660 根 5m
    expect(displayIntervalOf('tut-5h', multiplier(21))).toBe('15m'); // 6300 分钟 = 1260 根 5m
    expect(displayIntervalOf('tut-5h', multiplier(51))).toBe('15m'); // 15300 分钟 = 1020 根 15m
  });

  it('长战役任何倍数都不会比拉取预算更细（不裁、不卡）', () => {
    for (const value of CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS) {
      expect(displayIntervalOf('tut-8d', multiplier(value))).toBe('1h');
    }
  });

  it('手动选过就按手动：倍率视图原样照手动（与改版前同一条规则）', () => {
    for (const manual of ['1m', '5m', '15m', '1h'] as const) {
      for (const id of ['tut-1h', 'tut-5h', 'tut-8d'] as const) {
        expect(displayIntervalOf(id, multiplier(2.1), manual)).toBe(manual);
      }
    }
  });

  it('绝对预设：没选过按默认 5 分钟线放宽；手动选过也不比可读下限更细', () => {
    const preset = (key: 'day' | 'week' | 'month'): CampaignChartRangeSelection => ({
      kind: 'absolute',
      key: ({ day: '1d', week: '1w', month: '1M' } as const)[key],
      nowMs: NOW,
    });
    expect(displayIntervalOf('tut-1h', preset('day'))).toBe('5m');
    expect(displayIntervalOf('tut-1h', preset('week'))).toBe('15m');
    expect(displayIntervalOf('tut-1h', preset('month'))).toBe('1h');
    expect(displayIntervalOf('tut-1h', preset('day'), '1m')).toBe('5m');
    expect(displayIntervalOf('tut-1h', preset('month'), '5m')).toBe('1h');
    expect(displayIntervalOf('tut-1h', preset('day'), '1h')).toBe('1h');
  });

  it('显示周期怎么变，计算用周期都是同一个', () => {
    for (const id of ['tut-1h', 'tut-5h', 'tut-8d'] as const) {
      const expected = pickCampaignComputeInterval(spanOf(windowsOf(id).base));
      const selections: CampaignChartRangeSelection[] = [
        ...CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS.map(multiplier),
        ...CAMPAIGN_ABSOLUTE_RANGE_PRESETS.map(item => ({ kind: 'absolute' as const, key: item.key, nowMs: NOW })),
      ];
      for (const selection of selections) {
        expect(pickCampaignComputeInterval(spanOf(windowsOf(id, selection).base))).toBe(expected);
      }
    }
  });
});

describe('自动放宽的原因：视窗放不下 vs 拉取预算（悬停提示要说对）', () => {
  const reasonOf = (id: SynthCampaignId, selection: CampaignChartRangeSelection) => {
    const { fetch } = windowsOf(id, selection);
    const visible = buildCampaignChartVisibleRange(fetch, selection);
    return explainCampaignDisplayIntervalWidening(displayIntervalOf(id, selection), spanOf(visible));
  };

  it('盘面就是 5 分钟线时没有放宽', () => {
    expect(reasonOf('tut-1h', multiplier(2.1))).toBeNull();
    expect(reasonOf('tut-5h', multiplier(11))).toBeNull();
  });

  it('8 天战役 2.1 倍、5 小时战役 51 倍：当前视窗放不下 5 分钟线', () => {
    expect(displayIntervalOf('tut-8d', multiplier(2.1))).toBe('1h');
    expect(reasonOf('tut-8d', multiplier(2.1))).toBe('visible');
    expect(displayIntervalOf('tut-5h', multiplier(51))).toBe('15m');
    expect(reasonOf('tut-5h', multiplier(51))).toBe('visible');
  });

  it('12 小时战役 2.1 倍：视窗只有约 300 根 5 分钟线，是 51 倍拉取超过 6000 根才放宽到 15 分钟', () => {
    const selection = multiplier(2.1);
    const { fetch } = windowsOf('tut-12h', selection);
    const visible = buildCampaignChartVisibleRange(fetch, selection);
    expect((visible.toTime - visible.fromTime) / (5 * 60_000)).toBeLessThan(1_200);
    expect(displayIntervalOf('tut-12h', selection)).toBe('15m');
    expect(reasonOf('tut-12h', selection)).toBe('fetch');
  });
});

describe('反事实盘面按它自己的倍数选周期（不跟随原始盘面的倍数）', () => {
  /** 反事实盘面：基准窗口 + 它自己的倍数视窗，没手动选过周期。 */
  const counterfactualIntervalOf = (id: SynthCampaignId, value: CampaignViewMultiplier) => {
    const { base } = windowsOf(id);
    return pickCampaignDisplayInterval({
      manual: null,
      absolute: false,
      fetch: spanOf(base),
      visible: spanOf(buildCampaignKlineVisibleRange(base, value)),
    });
  };

  it('默认 1.1 倍：1 小时 / 5 小时战役 5 分钟线，12 小时 15 分钟，8 天 1 小时（与各自的计算用周期或原始盘面同周期，不多拉）', () => {
    expect(counterfactualIntervalOf('tut-1h', 1.1)).toBe('5m');
    expect(counterfactualIntervalOf('tut-5h', 1.1)).toBe('5m');
    expect(counterfactualIntervalOf('tut-12h', 1.1)).toBe('15m');
    expect(counterfactualIntervalOf('tut-8d', 1.1)).toBe('1h');
    expect(pickCampaignComputeInterval(spanOf(windowsOf('tut-5h').base))).toBe('5m');
    expect(pickCampaignComputeInterval(spanOf(windowsOf('tut-12h').base))).toBe('15m');
  });

  it('5 小时战役：反事实盘面自己拉到 51 倍才放宽到 15 分钟', () => {
    expect(counterfactualIntervalOf('tut-5h', 11)).toBe('5m');
    expect(counterfactualIntervalOf('tut-5h', 51)).toBe('15m');
  });
});
