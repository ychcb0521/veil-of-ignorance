/**
 * 封面指标行按当前列表的读数定列宽：【用户要求】「封面上的指标的分布要做得非常均匀、美观，不要有没必要的空隙」。
 * 宽度按字符类别确定性地估算（不测 DOM），只许偏宽、不许偏窄——任何一格都不能被截断。
 */
import { describe, expect, it } from 'vitest';
import {
  CARD_METRIC_CELL_PADDING_X,
  cardMetricColumnWidths,
  estimateCardMetricLabelWidth,
  estimateCardMetricValueWidth,
} from '@/lib/campaignCardMetricWidths';

/** 与战役列表页 CARD_METRIC_LABEL 同一份指标名、同一个次序（页面那份由 JournalCampaignsPage.columns.test 守着）。 */
const LABELS = {
  mirrorTp: '镜像止盈',
  expectedDrawdownPct: '预期回撤',
  mainPriceChange: '涨跌幅',
  mainPriceEfficiency: '涨跌幅倍数',
  captureRate: '盈亏比',
  addEfficiency: '加仓效用',
  geometricExpectancy: '几何期望',
  arithmeticExpectancy: '算术期望',
} as const;
type Mode = keyof typeof LABELS;

/** 用户截图那场（TUTUSDT 2026-08-08 多战役）的八个读数。 */
const TUT: Record<Mode, string> = {
  mirrorTp: '已实现·盈利',
  expectedDrawdownPct: '7.31%',
  mainPriceChange: '+25.90%',
  mainPriceEfficiency: '+3.54',
  captureRate: '34.60',
  addEfficiency: '+9.77',
  geometricExpectancy: '4.46',
  arithmeticExpectancy: '+16.80R',
};

describe('estimateCardMetricValueWidth / estimateCardMetricLabelWidth', () => {
  it('读数 11px 等宽：半角（含「·」「—」「−」）一格按 SF Mono 的 6.80px 算，中文与全角 11px；认不出的字符按 1em 算宽', () => {
    // SF Mono（Safari / iPadOS / iOS 的 ui-monospace）一格 1266/2048 em = 6.7998px，是栈里最宽的等宽字体
    expect(estimateCardMetricValueWidth('0')).toBeGreaterThanOrEqual((1266 / 2048) * 11);
    expect(estimateCardMetricValueWidth('0')).toBeLessThan(6.81);
    expect(estimateCardMetricValueWidth('已')).toBe(11);
    expect(estimateCardMetricValueWidth('（')).toBe(11);
    for (const narrow of ['·', '—', '−', '%', 'R', '+', '-', '.']) {
      expect(estimateCardMetricValueWidth(narrow), narrow).toBeCloseTo(estimateCardMetricValueWidth('0'), 6);
    }
    expect(estimateCardMetricValueWidth('≥')).toBe(11);
    expect(estimateCardMetricValueWidth('')).toBe(0);
  });

  it('估算不小于 Chrome（macOS）实测的宽度：Chrome 不认 ui-monospace，回退到 Menlo 11px font-medium', () => {
    const measured: Array<[string, number]> = [
      ['已实现·进行中', 72.625],
      ['已实现·盈利', 61.625],
      ['未实现', 33],
      ['-1234.57', 52.984375],
      ['+437.21%', 52.984375],
      ['+16.80R', 46.359375],
      ['767.41', 39.75],
      ['34.60', 33.125],
      ['4.46', 26.5],
      ['—', 6.625],
    ];
    for (const [text, px] of measured) {
      const estimate = estimateCardMetricValueWidth(text);
      expect(estimate, text).toBeGreaterThanOrEqual(px);
      // 按 SF Mono 算，比 Menlo 每个半角宽约 0.175px；也不离谱地偏宽：不超过 0.2px / 字
      expect(estimate - px, text).toBeLessThan(0.2 * [...text].length);
    }
  });

  it('估算不小于 SF Mono 的字形宽度之和：Safari / iPadOS / iOS 把 ui-monospace 解析成 SF Mono（每个半角 1266/2048 em），估算窄了就会被省略号截断', () => {
    // Chrome 里注入 SF Mono Medium 后 canvas measureText 实测（未取整的字形宽度之和）
    const sfMono: Array<[string, number]> = [
      ['+437.21%', 54.3984375],
      ['767.41', 40.798828125],
      ['13.86%', 40.798828125],
      ['50.00%', 40.798828125],
      ['-0.80', 33.9990234375],
      ['-12345.67', 61.1982421875],
      ['已实现·盈利', 61.7998046875],
      ['已实现·进行中', 72.7998046875],
    ];
    for (const [text, px] of sfMono) {
      expect(estimateCardMetricValueWidth(text), text).toBeGreaterThanOrEqual(px);
    }
  });

  it('SF Mono 下任何长度的读数都装进列宽：浏览器把整串宽度向上取整到 1/64px 排版，仍不超过格子的内容区', () => {
    const sfMonoNarrow = (1266 / 2048) * 11;
    const layoutWidth = (px: number) => Math.ceil(px * 64) / 64;
    for (let narrow = 0; narrow <= 16; narrow++) {
      for (let wide = 0; wide <= 7; wide++) {
        const text = '0'.repeat(narrow) + '已'.repeat(wide);
        const { captureRate } = cardMetricColumnWidths({ captureRate: '盈亏比' }, [{ captureRate: text }]);
        expect(captureRate - CARD_METRIC_CELL_PADDING_X, text).toBeGreaterThanOrEqual(layoutWidth(narrow * sfMonoNarrow + wide * 11));
      }
    }
  });

  it('指标名 10px：每字 10px', () => {
    expect(estimateCardMetricLabelWidth('盈亏比')).toBe(30);
    expect(estimateCardMetricLabelWidth('涨跌幅倍数')).toBe(50);
  });
});

describe('cardMetricColumnWidths', () => {
  it('用户截图那场：每项取指标名与读数的宽者 + 20px，向上取整到偶数', () => {
    expect(CARD_METRIC_CELL_PADDING_X).toBe(20);
    expect(cardMetricColumnWidths(LABELS, [TUT])).toEqual({
      mirrorTp: 82, // 「已实现·盈利」61.8 > 指标名 40
      expectedDrawdownPct: 60, // 「7.31%」34.0 < 指标名 40
      mainPriceChange: 68, // 「+25.90%」47.6 > 指标名 30
      mainPriceEfficiency: 70, // 「+3.54」34.0 < 指标名 50
      captureRate: 56, // 「34.60」34.0 > 指标名 30：盈亏比只写倍数之后，不再为「3459.89%（34.60）」留 148px
      addEfficiency: 60, // 「+9.77」34.0 < 指标名 40
      geometricExpectancy: 60, // 「4.46」27.2 < 指标名 40：「仓位击穿」徽标已挪到标题行，不再占这一格
      arithmeticExpectancy: 68, // 「+16.80R」47.6 > 指标名 40
    });
  });

  it('列表里出现更宽的读数时整列撑宽，所有卡片同一个宽度；只看列表里真出现的读数', () => {
    const extreme: Record<Mode, string> = {
      mirrorTp: '已实现·进行中',
      expectedDrawdownPct: '100.00%',
      mainPriceChange: '+437.21%',
      mainPriceEfficiency: '+130.41',
      captureRate: '-12345.67',
      addEfficiency: '+130.41',
      geometricExpectancy: '1235.57',
      arithmeticExpectancy: '+383.20R',
    };
    expect(cardMetricColumnWidths(LABELS, [TUT, extreme])).toEqual({
      mirrorTp: 94, // 72.8 + 20
      expectedDrawdownPct: 68, // 47.6 + 20
      mainPriceChange: 76, // 54.4 + 20
      mainPriceEfficiency: 70, // 47.6 < 指标名 50
      captureRate: 82, // 61.2 + 20
      addEfficiency: 68, // 47.6 + 20
      geometricExpectancy: 68, // 47.6 + 20
      arithmeticExpectancy: 76, // 54.4 + 20
    });
    // 次序无关
    expect(cardMetricColumnWidths(LABELS, [extreme, TUT])).toEqual(cardMetricColumnWidths(LABELS, [TUT, extreme]));
    // 一行八项：项与项之间 8px，在 1024px 的屏幕上（卡片内宽 954px）仍放得下一行
    const widths = Object.values(cardMetricColumnWidths(LABELS, [extreme]));
    expect(widths.reduce((sum, width) => sum + width, 0) + 7 * 8).toBeLessThanOrEqual(1024 - 48 - 2 - 20);
  });

  it('读数都比指标名窄（或列表为空）时取指标名宽度 + 20', () => {
    const labelOnly = {
      mirrorTp: 60,
      expectedDrawdownPct: 60,
      mainPriceChange: 50,
      mainPriceEfficiency: 70,
      captureRate: 50,
      addEfficiency: 60,
      geometricExpectancy: 60,
      arithmeticExpectancy: 60,
    };
    expect(cardMetricColumnWidths(LABELS, [])).toEqual(labelOnly);
    const dashes = Object.fromEntries(Object.keys(LABELS).map(mode => [mode, '—'])) as Record<Mode, string>;
    expect(cardMetricColumnWidths(LABELS, [dashes, dashes])).toEqual(labelOnly);
  });
});
